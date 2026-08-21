import { createHash } from "node:crypto";
import {
  SCHEMA_VERSION,
  assertConfidence,
  type GraphType,
  type LogicEdge,
  type LogicGraph,
  type LogicNode,
  type LogicNodeType,
  type RawCodeEdge,
  type RawCodeGraph,
  type RawCodeNode,
} from "@logic-map/schema";

export interface CompileOptions {
  graphType?: GraphType;
  maxNodes?: number;
  productDescription?: string;
}

const FLOW_EDGE_KINDS = new Set(["calls", "data_flow", "handles", "reads", "writes", "requests"]);

export function compileLogicGraph(raw: RawCodeGraph, options: CompileOptions = {}): LogicGraph {
  const maxNodes = Math.max(4, options.maxNodes ?? 20);
  const diagnostics = [...raw.diagnostics];
  const candidates = raw.nodes.filter(isLogicCandidate);
  const ranked = rankCandidates(candidates, raw.edges);
  const kept = ranked.slice(0, maxNodes);
  const keptIds = new Set(kept.map((node) => node.id));

  if (ranked.length > kept.length) {
    diagnostics.push({
      level: "info",
      code: "LOGIC_GRAPH_COMPRESSED",
      message: `Compressed ${ranked.length} business-relevant code nodes to the ${kept.length} highest-signal logic nodes.`,
    });
  }

  const logicNodes = kept.map(toLogicNode);
  const logicNodeIds = new Map(logicNodes.map((node) => [node.rawNodeIds[0], node.id]));
  const logicEdges = removeRedundantFlowEdges(projectFlowEdges(raw, keptIds, logicNodeIds), logicNodes);
  markResultNodes(logicNodes, logicEdges);

  const graphType = options.graphType ?? "runtime_logic";
  if (graphType === "product_logic") {
    diagnostics.push({
      level: "warning",
      code: "PRODUCT_LOGIC_HEURISTIC_ONLY",
      message: "Product logic is currently inferred from code structure and optional user context only; document and LLM semantic analysis are not enabled yet.",
    });
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    graphType,
    title: `${raw.project.name} ${graphType === "runtime_logic" ? "runtime logic" : "product logic"}`,
    description:
      options.productDescription ??
      (graphType === "runtime_logic"
        ? "A static, evidence-backed view of how work flows through the codebase."
        : "A code-informed view of how user actions become product value."),
    project: raw.project,
    nodes: logicNodes,
    edges: logicEdges,
    diagnostics,
  };
}

/**
 * Names that describe plumbing rather than a step in the system's logic. A reader
 * scanning the map learns nothing from a node called `log` or `cap`; these crowd
 * out the flows that do explain how the system runs.
 */
const UTILITY_NAME_PATTERN =
  /^(assert|audit|cap|clamp|clone|debug|dedupe|ensure|equals|error|format|from|get|has|hash|id|is|log|map|merge|noop|normali[sz]e|now|parse|pick|print|require|serialize|set|sleep|sort|to|trace|trim|truncate|unique|validate|warn|wrap)([A-Z_]|$)/;

/** A one-word name carries no object, so it cannot describe a step on its own. */
function isBareVerb(name: string): boolean {
  return /^[a-z]+$/.test(name) && name.length <= 6;
}

function isLogicCandidate(node: RawCodeNode): boolean {
  // A route is an entrypoint no matter what it is called.
  if (node.kind === "route" || node.kind === "database" || node.kind === "external_api") return true;
  if (["service", "agent", "tool"].includes(node.kind)) {
    return !UTILITY_NAME_PATTERN.test(node.name) && !isBareVerb(node.name);
  }
  if (node.kind === "function") return /^(handle|on)(submit|click|upload|save|create|generate)|submit|upload/i.test(node.name);
  return false;
}

function rankCandidates(nodes: RawCodeNode[], edges: RawCodeEdge[]): RawCodeNode[] {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    if (!FLOW_EDGE_KINDS.has(edge.kind)) continue;
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const kindWeight: Record<RawCodeNode["kind"], number> = {
    route: 100,
    agent: 95,
    tool: 85,
    database: 82,
    external_api: 80,
    service: 75,
    function: 60,
    entrypoint: 30,
    class: 20,
    file: 0,
  };
  return [...nodes].sort((a, b) => {
    const aScore = kindWeight[a.kind] + (degree.get(a.id) ?? 0) * 4 + maxEvidenceConfidence(a) * 10;
    const bScore = kindWeight[b.kind] + (degree.get(b.id) ?? 0) * 4 + maxEvidenceConfidence(b) * 10;
    return bScore - aScore || a.name.localeCompare(b.name);
  });
}

function toLogicNode(raw: RawCodeNode): LogicNode {
  const type = logicType(raw);
  const confidence = maxEvidenceConfidence(raw);
  const heuristic = raw.evidence.some((item) => item.method.includes("heuristic") || item.method === "framework_convention");
  return {
    id: `logic_${raw.id}`,
    type,
    label: logicLabel(raw),
    description: logicDescription(raw, type),
    sources: uniqueSources(raw.evidence.map((item) => item.source)),
    confidence: assertConfidence(confidence),
    inference: {
      method: heuristic ? "heuristic" : "deterministic",
      explanation: raw.evidence.map((item) => item.detail).join("; "),
    },
    rawNodeIds: [raw.id],
    metadata: { rawKind: raw.kind, ...raw.metadata },
  };
}

function logicType(node: RawCodeNode): LogicNodeType {
  if (node.kind === "function" && /submit|click|upload/i.test(node.name)) return "user_action";
  if (node.kind === "route") return "entrypoint";
  if (node.kind === "agent") return "ai_process";
  if (node.kind === "database") return "data";
  if (node.kind === "external_api") return "external_system";
  return "process";
}

function logicLabel(node: RawCodeNode): string {
  if (node.kind === "route") {
    const method = typeof node.metadata?.method === "string" ? node.metadata.method : undefined;
    const routePath = typeof node.metadata?.path === "string" ? node.metadata.path : undefined;
    if (method && routePath) return `${titleCase(method.toLowerCase())} ${routePath}`;
  }
  if (node.kind === "external_api") return node.name;
  return titleCase(humanize(node.name).replace(/\b(agent|service|handler|controller)\b/gi, "").trim() || humanize(node.name));
}

function logicDescription(node: RawCodeNode, type: LogicNodeType): string {
  if (node.description) return node.description;
  const semanticName = humanize(node.name)
    .replace(/\b(agent|service|handler|controller)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const descriptions: Record<LogicNodeType, string> = {
    user_action: `The user initiates ${semanticName}.`,
    entrypoint: `The system receives work through ${node.name}.`,
    process: `The system runs ${semanticName}.`,
    ai_process: `An AI workflow performs ${semanticName}.`,
    decision: `The system evaluates ${semanticName}.`,
    data: `The system reads or changes ${semanticName}.`,
    external_system: `The flow communicates with ${node.name}.`,
    result: `The flow produces ${semanticName}.`,
  };
  return descriptions[type];
}

function projectFlowEdges(
  raw: RawCodeGraph,
  keptIds: Set<string>,
  logicNodeIds: Map<string, string>,
): LogicEdge[] {
  const adjacency = new Map<string, RawCodeEdge[]>();
  for (const edge of raw.edges) {
    if (!FLOW_EDGE_KINDS.has(edge.kind)) continue;
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge);
    adjacency.set(edge.source, list);
  }

  const projected: LogicEdge[] = [];
  for (const source of keptIds) {
    const queue = [...(adjacency.get(source) ?? [])].map((edge) => ({ nodeId: edge.target, path: [edge] }));
    const visited = new Set<string>();
    while (queue.length) {
      const current = queue.shift();
      if (!current || visited.has(current.nodeId)) continue;
      visited.add(current.nodeId);
      if (keptIds.has(current.nodeId)) {
        const sourceId = logicNodeIds.get(source);
        const targetId = logicNodeIds.get(current.nodeId);
        if (sourceId && targetId && sourceId !== targetId) projected.push(toLogicEdge(sourceId, targetId, current.path));
        continue;
      }
      if (current.path.length >= 8) continue;
      for (const next of adjacency.get(current.nodeId) ?? []) queue.push({ nodeId: next.target, path: [...current.path, next] });
    }
  }
  return dedupeEdges(projected);
}

function toLogicEdge(source: string, target: string, path: RawCodeEdge[]): LogicEdge {
  const kinds = new Set(path.map((edge) => edge.kind));
  const type = kinds.has("data_flow") || kinds.has("reads") || kinds.has("writes") ? "data_flow" : "flow";
  return {
    id: `logic_edge_${hash(`${source}:${type}:${target}`)}`,
    source,
    target,
    type,
    confidence: assertConfidence(Math.min(...path.flatMap((edge) => edge.evidence.map((item) => item.confidence)))),
    rawEdgeIds: path.map((edge) => edge.id),
  };
}

function removeRedundantFlowEdges(edges: LogicEdge[], nodes: LogicNode[]): LogicEdge[] {
  const nodeTypes = new Map(nodes.map((node) => [node.id, node.type]));
  return edges.filter((edge) => {
    if (edge.type !== "flow") return true;
    if (["external_system", "data"].includes(nodeTypes.get(edge.target) ?? "")) return true;
    const adjacency = new Map<string, string[]>();
    for (const candidate of edges) {
      if (candidate.id === edge.id) continue;
      const targets = adjacency.get(candidate.source) ?? [];
      targets.push(candidate.target);
      adjacency.set(candidate.source, targets);
    }
    const queue = [...(adjacency.get(edge.source) ?? [])];
    const visited = new Set<string>();
    while (queue.length) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      if (current === edge.target) return false;
      visited.add(current);
      queue.push(...(adjacency.get(current) ?? []));
    }
    return true;
  });
}

function markResultNodes(nodes: LogicNode[], edges: LogicEdge[]): void {
  const outgoing = new Set(edges.map((edge) => edge.source));
  for (const node of nodes) {
    if (!outgoing.has(node.id) && node.type === "process" && !/save|store|persist/i.test(node.label)) {
      node.type = "result";
      node.description = `The flow produces ${node.label.toLowerCase()}.`;
    }
  }
}

function maxEvidenceConfidence(node: RawCodeNode): number {
  return node.evidence.length ? Math.max(...node.evidence.map((item) => item.confidence)) : 0.5;
}

function humanize(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_/.]+/g, " ").replace(/\s+/g, " ").trim();
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function uniqueSources<T extends { file: string; startLine: number }>(sources: T[]): T[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.file}:${source.startLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeEdges(edges: LogicEdge[]): LogicEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.source}:${edge.target}:${edge.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}
