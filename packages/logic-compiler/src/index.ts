import { createHash } from "node:crypto";
import {
  SCHEMA_VERSION,
  assertConfidence,
  type GraphType,
  type LogicEdge,
  type LogicGraph,
  type LogicNode,
  type LogicNodeType,
  type LogicBehavior,
  type ProductEvidence,
  type ProductMatchKind,
  type ProjectCapabilityHint,
  type ProjectUnderstanding,
  type RawCodeEdge,
  type RawCodeGraph,
  type RawCodeNode,
} from "@agent-runtime-map/schema";
import { composeFeatureNames } from "./featureNames.js";
import { localizeEdge, localizeNodeSemantics, type LocalizationOverrides } from "./localization.js";
import { compileFeatureScenarios } from "./features.js";

export { compileFeatureScenarios } from "./features.js";

export interface CompileOptions {
  graphType?: GraphType;
  maxNodes?: number;
  productDescription?: string;
  /** Set false to emit a graph with no bilingual semantics, as before this existed. */
  localize?: boolean;
  /** Terms and names the project itself states, which outrank every derivation. */
  localizationOverrides?: LocalizationOverrides;
}

const FLOW_EDGE_KINDS = new Set(["calls", "data_flow", "handles", "reads", "writes", "requests"]);

export function compileLogicGraph(raw: RawCodeGraph, options: CompileOptions = {}): LogicGraph {
  const maxNodes = Math.max(4, options.maxNodes ?? 40);
  const diagnostics = [...raw.diagnostics];
  const flowDegree = calculateFlowDegree(raw.edges);
  const orchestrators = findOrchestrators(raw);
  const candidates = raw.nodes.filter((node) => isLogicCandidate(node, flowDegree.get(node.id) ?? 0, orchestrators));
  const ranked = rankCandidates(candidates, flowDegree);
  const kept = ranked.slice(0, maxNodes);
  const keptIds = new Set(kept.map((node) => node.id));

  if (ranked.length > kept.length) {
    diagnostics.push({
      level: "info",
      code: "LOGIC_GRAPH_COMPRESSED",
      message: `Compressed ${ranked.length} business-relevant code nodes to the ${kept.length} highest-signal logic nodes.`,
    });
  }

  const logicNodes = kept.map((node) => toLogicNode(node, raw.context?.capabilityHints ?? []));
  const logicNodeIds = new Map(logicNodes.map((node) => [node.rawNodeIds[0], node.id]));
  const logicEdges = removeRedundantFlowEdges(projectFlowEdges(raw, keptIds, logicNodeIds), logicNodes);
  markResultNodes(logicNodes, logicEdges);
  describeBehavior(logicNodes, logicEdges);
  const features = compileFeatureScenarios(logicNodes, logicEdges, raw.context?.capabilityHints ?? []);

  // Reading the graph as business language is the last compile step: it needs the
  // finished nodes, edges, and features, and it needs the project's own documents
  // and configuration — evidence that exists here and nowhere downstream. Doing it
  // here makes every displayed name a fact in the artifact, diffable and testable,
  // rather than a guess the Viewer would have to make on every render.
  if (options.localize !== false) {
    const localizationInput = {
      capabilities: raw.context?.capabilityHints ?? [],
      // A caller may state overrides directly; otherwise the project's own
      // configuration file is the authority on its domain terms.
      overrides: options.localizationOverrides ?? raw.context?.localization,
    };
    const nodesById = new Map(logicNodes.map((node) => [node.id, node]));
    for (const node of logicNodes) node.semantic = localizeNodeSemantics(node, localizationInput, nodesById);
    // A second pass so a behavior sentence names other steps by their settled
    // business names rather than by whichever ones happened to be ready first.
    for (const node of logicNodes) node.semantic = localizeNodeSemantics(node, localizationInput, nodesById);
    for (const edge of logicEdges) edge.semantic = { label: localizeEdge(edge, nodesById) };
    composeFeatureNames(features, nodesById);
  }

  const graphType = options.graphType ?? "runtime_logic";
  if (graphType === "product_logic") {
    diagnostics.push({
      level: "info",
      code: "PRODUCT_LOGIC_CONTEXTUAL_INFERENCE",
      message: "Product logic combines code structure with README, docs, PRD, prompt, and configuration evidence when available; uncertain matches retain confidence scores.",
    });
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    graphType,
    title: `${raw.project.name} ${graphType === "runtime_logic" ? "runtime logic" : "product logic"}`,
    description:
      options.productDescription ??
      raw.context?.description ??
      raw.context?.documents.find((document) => document.kind === "readme")?.summary ??
      (graphType === "runtime_logic"
        ? "A static, evidence-backed view of how work flows through the codebase."
        : "A code-informed view of how user actions become product value."),
    project: raw.project,
    understanding: buildProjectUnderstanding(raw, logicNodes, options.productDescription),
    nodes: logicNodes,
    edges: logicEdges,
    features,
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

function isUtilityName(name: string): boolean {
  const camelCaseName = name ? `${name[0].toLowerCase()}${name.slice(1)}` : name;
  return UTILITY_NAME_PATTERN.test(camelCaseName);
}

function isLogicCandidate(node: RawCodeNode, flowDegree: number, orchestrators: ReadonlySet<string>): boolean {
  // A route is an entrypoint no matter what it is called.
  if (node.kind === "route" || node.kind === "database" || node.kind === "external_api") return true;
  if (["service", "agent", "workflow", "tool", "human_gate"].includes(node.kind)) {
    // Keep connected steps: calls and data flow are stronger evidence than a
    // generic-looking name. Suppress isolated nodes when their only signal was
    // the weakest business-verb heuristic, plus isolated utility plumbing.
    if (flowDegree === 0 && maxEvidenceConfidence(node) <= 0.5) return false;
    return flowDegree > 0 || !isUtilityName(node.name);
  }
  if (node.kind === "function") {
    // A function that dispatches to an agent, workflow, tool, gate, or model is an
    // orchestration step — often the only entry a library-style project has.
    // Dropping it beheads the chain: the agents it drives become parentless roots.
    if (orchestrators.has(node.id)) return true;
    return /^(handle|on)(submit|click|upload|save|create|generate)|submit|upload/i.test(node.name);
  }
  if (["model", "prompt"].includes(node.kind)) return flowDegree > 0;
  return false;
}

const ORCHESTRATED_KINDS = new Set([
  "agent", "workflow", "tool", "human_gate", "model",
  // Integration steps: a function that reaches an external system, a data
  // store, or an internal route is a step in the business flow — dropping it
  // severs the chain between the entrypoint and the boundary it crosses.
  "external_api", "database", "route",
]);

/** Function nodes with an observed flow edge into something the map must show. */
function findOrchestrators(raw: RawCodeGraph): ReadonlySet<string> {
  const kindById = new Map(raw.nodes.map((node) => [node.id, node.kind]));
  const orchestrators = new Set<string>();
  for (const edge of raw.edges) {
    if (!FLOW_EDGE_KINDS.has(edge.kind)) continue;
    if (kindById.get(edge.source) !== "function") continue;
    if (ORCHESTRATED_KINDS.has(kindById.get(edge.target) ?? "")) orchestrators.add(edge.source);
  }
  return orchestrators;
}

function calculateFlowDegree(edges: RawCodeEdge[]): Map<string, number> {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    if (!FLOW_EDGE_KINDS.has(edge.kind)) continue;
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return degree;
}

function rankCandidates(nodes: RawCodeNode[], degree: Map<string, number>): RawCodeNode[] {
  const kindWeight: Record<RawCodeNode["kind"], number> = {
    route: 100,
    agent: 95,
    workflow: 98,
    tool: 85,
    model: 81,
    prompt: 64,
    human_gate: 92,
    database: 82,
    external_api: 80,
    service: 75,
    function: 60,
    entrypoint: 30,
    class: 20,
    file: 0,
  };
  return [...nodes].sort((a, b) => {
    const aScore = kindWeight[a.kind] + (degree.get(a.id) ?? 0) * 4 + maxEvidenceConfidence(a) * 20;
    const bScore = kindWeight[b.kind] + (degree.get(b.id) ?? 0) * 4 + maxEvidenceConfidence(b) * 20;
    return bScore - aScore || a.name.localeCompare(b.name);
  });
}

function toLogicNode(raw: RawCodeNode, capabilities: ProjectCapabilityHint[]): LogicNode {
  const type = logicType(raw);
  const confidence = maxEvidenceConfidence(raw);
  // How this conclusion was reached is a fact about the code. A document that
  // happens to describe the same capability does not change it, so product evidence
  // stays a separate channel rather than relabelling every node "mixed".
  const heuristic = raw.evidence.some((item) => item.method.includes("heuristic") || item.method === "framework_convention");
  const match = bestCapabilityForText(`${raw.name} ${raw.qualifiedName ?? ""} ${raw.description ?? ""}`, capabilities);
  const product = productEvidence(match);
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
    product,
    metadata: {
      rawKind: raw.kind,
      rawName: raw.name,
      documentedCapabilityId: match?.capability.id,
      documentedCapabilityLabel: match?.capability.label,
      generatedDescription: !raw.description,
      ...raw.metadata,
    },
  };
}

function logicType(node: RawCodeNode): LogicNodeType {
  if (node.kind === "function" && /submit|click|upload/i.test(node.name)) return "user_action";
  if (node.kind === "route") return "entrypoint";
  if (node.kind === "workflow") return "workflow";
  if (node.kind === "agent") return "ai_process";
  if (node.kind === "tool") return "tool";
  if (node.kind === "model") return "model";
  if (node.kind === "human_gate") return "human_gate";
  if (node.kind === "prompt") return "data";
  if (node.kind === "database") return "data";
  if (node.kind === "external_api") return "external_system";
  return "process";
}

function logicLabel(node: RawCodeNode): string {
  if (node.kind === "route") {
    const method = typeof node.metadata?.method === "string" ? node.metadata.method : undefined;
    const routePath = typeof node.metadata?.path === "string" ? node.metadata.path : undefined;
    if (method && routePath) return `${method.toUpperCase()} ${routePath}`;
  }
  if (node.kind === "external_api") return node.name;
  return titleCase(humanize(node.name).replace(/\b(agent|service|handler|controller|workflow|orchestrator)\b/gi, "").trim() || humanize(node.name));
}

/** At most this many names before a list stops being readable and starts being a dump. */
const MAX_BEHAVIOR_ITEMS = 4;

/**
 * Replaces a generated description that only restated its own label with what the
 * step actually does. A description written by a person — a docstring, an Agent's
 * configured `description` — always wins: it says why, and this can only say what.
 */
function describeBehavior(nodes: LogicNode[], edges: LogicEdge[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    const behavior: LogicBehavior = { calls: [], branches: [], requests: [], data: [], feeds: [] };
    for (const edge of edges) {
      if (edge.source !== node.id) continue;
      const target = byId.get(edge.target);
      if (!target) continue;
      if (target.type === "model" || target.type === "external_system") push(behavior.requests, target.id);
      else if (target.type === "data") push(behavior.data, target.id);
      else if (edge.control === "conditional" || edge.control === "fallback") push(behavior.branches, target.id);
      else if (edge.type === "data_flow") push(behavior.feeds, target.id);
      else push(behavior.calls, target.id);
    }
    node.behavior = behavior;
    if (node.metadata?.generatedDescription !== true) continue;
    const described = describeInEnglish(behavior, (id) => byId.get(id)?.label ?? id);
    if (described) node.description = described;
  }
}

function push(items: string[], label: string): void {
  if (!items.includes(label)) items.push(label);
}

function describeInEnglish(behavior: LogicBehavior, label: (id: string) => string): string | undefined {
  const named = (ids: string[], conjunction: string) => joinLabels(ids.map(label), conjunction);
  const parts = [
    behavior.calls.length ? `calls ${named(behavior.calls, "and")}` : undefined,
    behavior.branches.length ? `branches to ${named(behavior.branches, "or")}` : undefined,
    behavior.requests.length ? `requests ${named(behavior.requests, "and")}` : undefined,
    behavior.data.length ? `reads or writes ${named(behavior.data, "and")}` : undefined,
    behavior.feeds.length ? `passes its result to ${named(behavior.feeds, "and")}` : undefined,
  ].filter((part): part is string => Boolean(part));
  if (!parts.length) return undefined;
  const [first, ...rest] = parts;
  const opening = first!.charAt(0).toUpperCase() + first!.slice(1);
  if (!rest.length) return `${opening}.`;
  return `${[opening, ...rest.slice(0, -1)].join(", ")}, and ${rest.at(-1)}.`;
}

function joinLabels(labels: string[], conjunction: string): string {
  const shown = labels.slice(0, MAX_BEHAVIOR_ITEMS);
  const suffix = labels.length > shown.length ? ` and ${labels.length - shown.length} more` : "";
  if (shown.length === 1) return `${shown[0]}${suffix}`;
  if (shown.length === 2 && !suffix) return `${shown[0]} ${conjunction} ${shown[1]}`;
  return `${shown.slice(0, -1).join(", ")}, ${conjunction} ${shown.at(-1)}${suffix}`;
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
    workflow: `The workflow coordinates ${semanticName}.`,
    ai_process: `An AI workflow performs ${semanticName}.`,
    tool: `An Agent uses the tool ${semanticName}.`,
    model: `The Agent uses the model ${node.name}.`,
    human_gate: `A person reviews or approves ${semanticName}.`,
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
  const control = strongestControl(path.map((edge) => edge.control));
  const type = kinds.has("data_flow") || kinds.has("reads") || kinds.has("writes")
    ? "data_flow"
    : control === "conditional" || control === "fallback" || control === "human_approval"
      ? "branch"
      : "flow";
  return {
    id: `logic_edge_${hash(`${source}:${type}:${control ?? "sequential"}:${target}`)}`,
    source,
    target,
    type,
    label: path.find((edge) => edge.label)?.label ?? controlLabel(control),
    control,
    metadata: control ? {
      retryBounded: control === "retry" ? path.some((edge) => edge.metadata?.retryBounded === true) : undefined,
      rawControls: [...new Set(path.flatMap((edge) => edge.control ? [edge.control] : []))],
    } : undefined,
    confidence: assertConfidence(Math.min(...path.flatMap((edge) => edge.evidence.map((item) => item.confidence)))),
    rawEdgeIds: path.map((edge) => edge.id),
  };
}

function strongestControl(values: Array<RawCodeEdge["control"]>): RawCodeEdge["control"] {
  const priority: Array<NonNullable<RawCodeEdge["control"]>> = ["human_approval", "fallback", "retry", "loop", "parallel", "conditional", "sequential"];
  return priority.find((candidate) => values.includes(candidate));
}

function controlLabel(control: RawCodeEdge["control"]): string | undefined {
  return control && control !== "sequential" ? control.replace("_", " ") : undefined;
}

function buildProjectUnderstanding(
  raw: RawCodeGraph,
  nodes: LogicNode[],
  productDescription?: string,
): ProjectUnderstanding {
  const context = raw.context;
  const summary = productDescription ?? context?.description ?? context?.documents.find((document) => document.kind === "readme")?.summary
    ?? `An evidence-backed understanding of ${raw.project.name}.`;
  const capabilities = context?.capabilityHints ?? [];
  const contextualConfidence = capabilities.length
    ? Math.min(1, capabilities.reduce((total, capability) => total + capability.confidence, 0) / capabilities.length)
    : context?.documents.length
      ? 0.7
      : 0.55;
  return {
    summary,
    capabilities,
    agentNodeIds: nodes.filter((node) => node.type === "ai_process").map((node) => node.id),
    workflowNodeIds: nodes.filter((node) => node.type === "workflow").map((node) => node.id),
    toolNodeIds: nodes.filter((node) => node.type === "tool").map((node) => node.id),
    modelNodeIds: nodes.filter((node) => node.type === "model").map((node) => node.id),
    documentsUsed: context?.documents.map((document) => document.path) ?? [],
    confidence: assertConfidence(contextualConfidence),
  };
}

/** A documented name, or at least two documented terms, before a link is claimed. */
const MIN_CAPABILITY_SCORE = 2;

interface CapabilityMatch {
  capability: ProjectCapabilityHint;
  score: number;
  matchedOn: ProductMatchKind;
  matchedTerms: string[];
}

function bestCapabilityForText(text: string, capabilities: ProjectCapabilityHint[]): CapabilityMatch | undefined {
  const normalized = normalizeSemanticText(text);
  let best: CapabilityMatch | undefined;
  for (const capability of capabilities) {
    const label = normalizeSemanticText(capability.label);
    const hits = capability.keywords.filter((keyword) => normalized.includes(normalizeSemanticText(keyword)));
    const labelHit = label.length >= 3 && normalized.includes(label) ? 3 : 0;
    const score = labelHit + hits.length;
    if (score > 0 && (!best || score > best.score || (score === best.score && capability.confidence > best.capability.confidence))) {
      best = {
        capability,
        score,
        matchedOn: labelHit ? "documented_name" : "documented_terms",
        matchedTerms: labelHit ? [capability.label] : hits.slice(0, 4),
      };
    }
  }
  return best;
}

/**
 * How strongly a code path and a documented capability were linked. This is the
 * strength of the *link*, not of the document or of the code: a confident
 * specification matched on one shared word is still a weak match, and saying so is
 * the point of showing it at all.
 */
function productEvidence(match: CapabilityMatch | undefined): ProductEvidence | undefined {
  // One shared word between a node name and a document is a coincidence, not a
  // product conclusion. Attributing every node to the same capability at a weak
  // score would make the attribution worth nothing wherever it is real.
  if (!match || match.score < MIN_CAPABILITY_SCORE) return undefined;
  return {
    capabilityId: match.capability.id,
    label: match.capability.label,
    origin: match.capability.origin,
    sources: match.capability.sources,
    match: assertConfidence(Math.min(0.95, 0.4 + match.score * 0.15) * match.capability.confidence),
    matchedOn: match.matchedOn,
    matchedTerms: match.matchedTerms,
  };
}

function normalizeSemanticText(value: string): string {
  return humanize(value).toLowerCase().replace(/\b(agent|api|handler|route|service|workflow)\b/g, " ").replace(/\s+/g, " ").trim();
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
    const key = `${edge.source}:${edge.target}:${edge.type}:${edge.control ?? "sequential"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

export { localizeNodeSemantics, localizeEdge, readIdentifier, controlFlowName, LOCALES, PENDING_THRESHOLD } from "./localization.js";
export type { LocalizationOverrides, LocalizationInput, NodeOverride } from "./localization.js";
export { composeFeatureNames } from "./featureNames.js";
