import { createHash } from "node:crypto";
import {
  assertConfidence,
  type ChainDiagnostic,
  type ChainHealth,
  type FeaturePathVariant,
  type FeatureScenario,
  type FeatureSimulationStep,
  type LogicEdge,
  type LogicNode,
  type ProjectCapabilityHint,
} from "@agent-runtime-map/schema";

const MAX_FEATURE_NODES = 120;
const MAX_PATHS = 12;
const MAX_PATH_DEPTH = 48;

export function compileFeatureScenarios(
  nodes: LogicNode[],
  edges: LogicEdge[],
  capabilities: ProjectCapabilityHint[] = [],
): FeatureScenario[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = adjacency(edges);
  const incoming = reverseAdjacency(edges);
  const userRoots = nodes.filter((node) => node.type === "user_action");
  const reachableFromUsers = new Set(userRoots.flatMap((node) => [...reachableNodeIds(node.id, outgoing)]));
  const entryRoots = nodes.filter(
    (node) => node.type === "entrypoint" && !reachableFromUsers.has(node.id),
  );
  const fallbackRoots = nodes.filter(
    (node) =>
      ["ai_process", "process"].includes(node.type) &&
      (incoming.get(node.id)?.length ?? 0) === 0 &&
      (outgoing.get(node.id)?.length ?? 0) > 0,
  );
  const roots = uniqueById([...userRoots, ...entryRoots, ...(userRoots.length || entryRoots.length ? [] : fallbackRoots)]);

  return roots
    .map((root) => compileFeature(root, edges, nodeById, outgoing, capabilities))
    .sort((a, b) => healthWeight(b.health) - healthWeight(a.health) || a.label.localeCompare(b.label));
}

function compileFeature(
  root: LogicNode,
  allEdges: LogicEdge[],
  nodeById: Map<string, LogicNode>,
  outgoing: Map<string, LogicEdge[]>,
  capabilities: ProjectCapabilityHint[],
): FeatureScenario {
  const reachable = reachableNodeIds(root.id, outgoing);
  const limitedNodeIds = [...reachable].slice(0, MAX_FEATURE_NODES);
  const nodeIds = new Set(limitedNodeIds);
  const featureEdges = allEdges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const featureNodes = limitedNodeIds.flatMap((id) => (nodeById.get(id) ? [nodeById.get(id)!] : []));
  const terminalNodes = featureNodes.filter((node) => !(featureEdges.some((edge) => edge.source === node.id)));
  const paths = enumerateMainPaths(root.id, nodeIds, featureEdges, nodeById);
  const diagnostics = diagnoseFeature(
    root,
    featureNodes,
    featureEdges,
    allEdges,
    nodeById,
    reachable.size,
    paths.truncated,
  );
  const variants = buildVariants(root.id, featureNodes, featureEdges, paths, nodeById);
  const entrypoint = nearestEntrypoint(root.id, outgoing, nodeById);
  const documentedCapability = matchDocumentedCapability(featureNodes, capabilities);
  const confidence = featureNodes.length
    ? assertConfidence(Math.min(...featureNodes.map((node) => node.confidence)))
    : root.confidence;
  const health = healthFromDiagnostics(diagnostics);
  const label = documentedCapability?.label ?? entrypoint?.label ?? root.label;

  return {
    id: `feature_${hash(`${root.id}:${label}`)}`,
    label,
    description: documentedCapability?.description ?? `Simulates the code-backed execution chain that starts at ${label}.`,
    entryNodeIds: [root.id],
    resultNodeIds: terminalNodes.map((node) => node.id),
    nodeIds: limitedNodeIds,
    edgeIds: featureEdges.map((edge) => edge.id),
    variants,
    diagnostics,
    health,
    confidence,
  };
}

function matchDocumentedCapability(
  nodes: LogicNode[],
  capabilities: ProjectCapabilityHint[],
): ProjectCapabilityHint | undefined {
  const tokens = semanticTokens(nodes.map((node) => `${node.label} ${node.metadata?.rawName ?? ""}`).join(" "));
  const entryTokens = semanticTokens(nodes
    .filter((node) => node.type === "entrypoint" || node.type === "user_action")
    .map((node) => `${node.label} ${node.metadata?.rawName ?? ""}`)
    .join(" "));
  const documentedCounts = new Map<string, number>();
  for (const node of nodes) {
    const id = typeof node.metadata?.documentedCapabilityId === "string" ? node.metadata.documentedCapabilityId : undefined;
    if (id) documentedCounts.set(id, (documentedCounts.get(id) ?? 0) + 1);
  }
  let best: { capability: ProjectCapabilityHint; score: number } | undefined;
  for (const capability of capabilities) {
    const capabilityTokens = semanticTokens(`${capability.label} ${capability.keywords.join(" ")}`);
    const entryHits = [...capabilityTokens].filter((token) => entryTokens.has(token)).length;
    const graphHits = [...capabilityTokens].filter((token) => tokens.has(token)).length;
    const score = entryHits * 8 + graphHits + (documentedCounts.get(capability.id) ?? 0) * 0.5;
    if (score > 0 && (!best || score > best.score || (score === best.score && capability.confidence > best.capability.confidence))) {
      best = { capability, score };
    }
  }
  return best?.capability;
}

function semanticTokens(value: string): Set<string> {
  const matches = value.toLowerCase().match(/[a-z][a-z0-9-]{2,}|[\u3400-\u9fff]{2,8}/g) ?? [];
  return new Set(matches.map((token) => semanticStem(token)
    .replace(/^(post|get|put|patch|delete)$/, ""))
    .filter((token) => token.length >= 3));
}

function semanticStem(value: string): string {
  if (/(ations?|tion)$/.test(value)) return value.replace(/ations?$/, "ate").replace(/tion$/, "te");
  return value.replace(/(ing|ed|es|s)$/i, "");
}

function diagnoseFeature(
  root: LogicNode,
  nodes: LogicNode[],
  edges: LogicEdge[],
  allEdges: LogicEdge[],
  nodeById: Map<string, LogicNode>,
  reachableCount: number,
  pathsTruncated: boolean,
): ChainDiagnostic[] {
  const diagnostics: ChainDiagnostic[] = [];
  const featureNodeIds = new Set(nodes.map((node) => node.id));
  const broken = allEdges.filter(
    (edge) => featureNodeIds.has(edge.source) && (!nodeById.has(edge.source) || !nodeById.has(edge.target)),
  );
  for (const edge of broken) {
    diagnostics.push({
      id: `diagnostic_${hash(`broken:${edge.id}`)}`,
      code: "CHAIN_BROKEN_REFERENCE",
      severity: "error",
      message: "The chain references a logic node that does not exist in the graph.",
      suggestion: "Check the unresolved call, import, or generated edge at this point.",
      edgeId: edge.id,
      nodeId: edge.source,
      sources: nodeById.get(edge.source)?.sources ?? [],
      confidence: 1,
    });
  }

  if (edges.length === 0) {
    diagnostics.push({
      id: `diagnostic_${hash(`downstream:${root.id}`)}`,
      code: "CHAIN_NO_DOWNSTREAM",
      severity: "error",
      message: "The feature entry has no resolvable downstream execution step.",
      suggestion: "Check whether the entry calls a workflow, agent, service, or tool that the analyzer can resolve.",
      nodeId: root.id,
      sources: root.sources,
      confidence: 1,
    });
  }

  const cycleNode = findCycleNode(nodes, edges);
  const terminalCount = nodes.filter((node) => !(edges.some((edge) => edge.source === node.id))).length;
  if (cycleNode) {
    diagnostics.push({
      id: `diagnostic_${hash(`cycle:${cycleNode.id}`)}`,
      code: "CHAIN_CYCLE",
      severity: terminalCount === 0 ? "error" : "warning",
      message: terminalCount === 0
        ? "The feature chain contains a cycle with no resolvable exit."
        : "The feature chain contains a cycle; verify that its runtime exit condition is intentional.",
      suggestion: "Inspect the loop guard or add an explicit terminal path.",
      nodeId: cycleNode.id,
      sources: cycleNode.sources,
      confidence: terminalCount === 0 ? 0.95 : 0.75,
    });
  }

  if (nodes.length > 1 && terminalCount === 0) {
    diagnostics.push({
      id: `diagnostic_${hash(`result:${root.id}`)}`,
      code: "CHAIN_NO_RESULT",
      severity: "error",
      message: "The analyzer could not find a terminal result for this feature.",
      suggestion: "Add or expose a return, persistence, response, or handoff that completes the chain.",
      nodeId: root.id,
      sources: root.sources,
      confidence: 0.9,
    });
  }

  const lowConfidenceNodes = nodes.filter((node) => node.confidence < 0.6);
  for (const node of lowConfidenceNodes.slice(0, 6)) {
    diagnostics.push({
      id: `diagnostic_${hash(`confidence:${node.id}`)}`,
      code: "CHAIN_LOW_CONFIDENCE",
      severity: "warning",
      message: `The step “${node.label}” is inferred with ${Math.round(node.confidence * 100)}% confidence.`,
      suggestion: "Confirm the call relationship or add a clearer workflow, agent, tool, or service name.",
      nodeId: node.id,
      sources: node.sources,
      confidence: node.confidence,
    });
  }

  for (const edge of edges.filter((edge) => edge.control === "retry" && edge.metadata?.retryBounded !== true)) {
    const source = nodeById.get(edge.source);
    diagnostics.push({
      id: `diagnostic_${hash(`retry:${edge.id}`)}`,
      code: "CHAIN_RETRY_WITHOUT_LIMIT",
      severity: "warning",
      message: "A retry path was detected without a statically resolvable attempt limit.",
      suggestion: "Set a maximum retry count, backoff policy, and explicit failure exit.",
      nodeId: edge.source,
      edgeId: edge.id,
      sources: source?.sources ?? [],
      confidence: 0.82,
    });
  }

  const outgoing = adjacency(edges);
  for (const node of nodes.filter((candidate) => candidate.type === "external_system")) {
    const callers = edges.filter((edge) => edge.target === node.id).flatMap((edge) => nodeById.get(edge.source) ?? []);
    const protectedCall = callers.some((caller) => Number(caller.metadata?.catches ?? 0) > 0 || (outgoing.get(caller.id) ?? []).some((edge) => edge.control === "fallback"));
    if (callers.length && !protectedCall) {
      diagnostics.push({
        id: `diagnostic_${hash(`fallback:${node.id}`)}`,
        code: "CHAIN_EXTERNAL_NO_FALLBACK",
        severity: "info",
        message: `The external call to ${node.label} has no statically resolvable fallback path.`,
        suggestion: "Add error handling, a bounded retry, or a degraded response for this dependency.",
        nodeId: node.id,
        sources: node.sources,
        confidence: 0.72,
      });
    }
  }

  for (const node of nodes.filter((candidate) => candidate.type === "ai_process")) {
    const mainOutgoing = (outgoing.get(node.id) ?? []).filter((edge) => {
      const target = nodeById.get(edge.target);
      return target && !["data", "external_system", "model"].includes(target.type);
    });
    const returnType = typeof node.metadata?.returnType === "string" ? node.metadata.returnType : "";
    if (!mainOutgoing.length && /(^|<)(void|undefined)(>|$)/i.test(returnType) && node.metadata?.terminal !== true) {
      diagnostics.push({
        id: `diagnostic_${hash(`agent-output:${node.id}`)}`,
        code: "CHAIN_AGENT_NO_OUTPUT",
        severity: "warning",
        message: `The Agent step “${node.label}” has no structured output or downstream handoff.`,
        suggestion: "Declare an output type or schema, persist a result, or connect the Agent to its next step.",
        nodeId: node.id,
        sources: node.sources,
        confidence: 0.86,
      });
    }
  }

  if (reachableCount > MAX_FEATURE_NODES || pathsTruncated) {
    diagnostics.push({
      id: `diagnostic_${hash(`limit:${root.id}`)}`,
      code: "CHAIN_PATH_LIMIT",
      severity: "warning",
      message: pathsTruncated
        ? `The feature has more than ${MAX_PATHS} branches or exceeds ${MAX_PATH_DEPTH} steps; simulation uses a bounded path set.`
        : `The feature reaches ${reachableCount} nodes; simulation is limited to ${MAX_FEATURE_NODES}.`,
      suggestion: "Increase graph compression or split the feature into explicit workflows.",
      nodeId: root.id,
      sources: root.sources,
      confidence: 1,
    });
  }

  return diagnostics;
}

function buildVariants(
  rootId: string,
  nodes: LogicNode[],
  edges: LogicEdge[],
  paths: EnumeratedPaths,
  nodeById: Map<string, LogicNode>,
): FeaturePathVariant[] {
  const allNodeIds = nodes.map((node) => node.id);
  const allVariant = makeVariant(
    `variant_${hash(`${rootId}:all`)}`,
    paths.paths.length > 1 ? "All paths" : "Default path",
    paths.paths.length > 1 ? "Checks every inferred branch in the feature." : "Checks the inferred execution path.",
    rootId,
    allNodeIds,
    edges.map((edge) => edge.id),
    edges,
    nodeById,
  );
  if (paths.paths.length <= 1) return [allVariant];

  const pathVariants = paths.paths.slice(0, MAX_PATHS).map((path, index) => {
    const expanded = includeSideDependencies(path.nodeIds, edges, nodeById);
    const expandedIds = new Set(expanded);
    const edgeIds = edges
      .filter((edge) => expandedIds.has(edge.source) && expandedIds.has(edge.target))
      .map((edge) => edge.id);
    const result = nodeById.get(path.nodeIds.at(-1) ?? "");
    return makeVariant(
      `variant_${hash(`${rootId}:${path.edgeIds.join(":")}`)}`,
      `Path ${index + 1}${result ? ` · ${result.label}` : ""}`,
      `Checks the branch that reaches ${result?.label ?? "its terminal step"}.`,
      rootId,
      expanded,
      edgeIds,
      edges,
      nodeById,
    );
  });
  return [allVariant, ...pathVariants];
}

function makeVariant(
  id: string,
  label: string,
  description: string,
  rootId: string,
  nodeIds: string[],
  edgeIds: string[],
  allEdges: LogicEdge[],
  nodeById: Map<string, LogicNode>,
): FeaturePathVariant {
  const selected = new Set(nodeIds);
  const edges = allEdges.filter((edge) => edgeIds.includes(edge.id));
  const steps = simulationSteps(rootId, selected, edges);
  const terminal = [...selected]
    .map((id) => nodeById.get(id))
    .find((node) => node?.type === "result") ??
    [...selected].map((id) => nodeById.get(id)).find((node) => node && !edges.some((edge) => edge.source === node.id));
  const nodeConfidences = [...selected].flatMap((nodeId) => (nodeById.get(nodeId) ? [nodeById.get(nodeId)!.confidence] : []));
  const confidence = nodeConfidences.length ? assertConfidence(Math.min(...nodeConfidences)) : 0;
  return { id, label, description, nodeIds: [...selected], edgeIds, steps, resultNodeId: terminal?.id, confidence };
}

function simulationSteps(rootId: string, nodeIds: Set<string>, edges: LogicEdge[]): FeatureSimulationStep[] {
  const distance = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length) {
    const source = queue.shift();
    if (!source) continue;
    const current = distance.get(source) ?? 0;
    for (const edge of edges.filter((candidate) => candidate.source === source)) {
      if (!nodeIds.has(edge.target)) continue;
      const next = current + 1;
      if (!distance.has(edge.target) || next < distance.get(edge.target)!) {
        distance.set(edge.target, next);
        queue.push(edge.target);
      }
    }
  }
  const maxDistance = Math.max(0, ...distance.values());
  return Array.from({ length: maxDistance + 1 }, (_, order) => {
    const stepNodeIds = [...nodeIds].filter((nodeId) => distance.get(nodeId) === order);
    return {
      order,
      nodeIds: stepNodeIds,
      incomingEdgeIds: edges
        .filter((edge) => stepNodeIds.includes(edge.target) && distance.has(edge.source))
        .map((edge) => edge.id),
    };
  }).filter((step) => step.nodeIds.length > 0);
}

interface MainPath {
  nodeIds: string[];
  edgeIds: string[];
}

interface EnumeratedPaths {
  paths: MainPath[];
  truncated: boolean;
}

function enumerateMainPaths(
  rootId: string,
  featureNodeIds: Set<string>,
  edges: LogicEdge[],
  nodeById: Map<string, LogicNode>,
): EnumeratedPaths {
  const paths: MainPath[] = [];
  let truncated = false;
  const mainEdges = edges.filter((edge) => {
    const target = nodeById.get(edge.target);
    return target && !["data", "external_system"].includes(target.type);
  });
  const outgoing = adjacency(mainEdges);

  function visit(nodeId: string, nodeIds: string[], edgeIds: string[], seen: Set<string>): void {
    if (paths.length >= MAX_PATHS) {
      truncated = true;
      return;
    }
    const next = (outgoing.get(nodeId) ?? []).filter((edge) => featureNodeIds.has(edge.target) && !seen.has(edge.target));
    if (!next.length || nodeIds.length >= MAX_PATH_DEPTH) {
      paths.push({ nodeIds, edgeIds });
      if (nodeIds.length >= MAX_PATH_DEPTH) truncated = true;
      return;
    }
    for (const edge of next) visit(edge.target, [...nodeIds, edge.target], [...edgeIds, edge.id], new Set([...seen, edge.target]));
  }

  visit(rootId, [rootId], [], new Set([rootId]));
  return { paths: paths.length ? paths : [{ nodeIds: [rootId], edgeIds: [] }], truncated };
}

function includeSideDependencies(pathNodeIds: string[], edges: LogicEdge[], nodeById: Map<string, LogicNode>): string[] {
  const selected = new Set(pathNodeIds);
  for (const edge of edges) {
    const target = nodeById.get(edge.target);
    if (selected.has(edge.source) && target && ["data", "external_system"].includes(target.type)) selected.add(target.id);
  }
  return [...selected];
}

function nearestEntrypoint(rootId: string, outgoing: Map<string, LogicEdge[]>, nodeById: Map<string, LogicNode>): LogicNode | undefined {
  const queue = [rootId];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    const node = nodeById.get(current);
    if (node?.type === "entrypoint") return node;
    queue.push(...(outgoing.get(current) ?? []).map((edge) => edge.target));
  }
  return undefined;
}

function reachableNodeIds(rootId: string, outgoing: Map<string, LogicEdge[]>): Set<string> {
  const reached = new Set<string>();
  const queue = [rootId];
  while (queue.length && reached.size < MAX_FEATURE_NODES + 1) {
    const current = queue.shift();
    if (!current || reached.has(current)) continue;
    reached.add(current);
    queue.push(...(outgoing.get(current) ?? []).map((edge) => edge.target));
  }
  return reached;
}

function findCycleNode(nodes: LogicNode[], edges: LogicEdge[]): LogicNode | undefined {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = adjacency(edges);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(nodeId: string): LogicNode | undefined {
    if (visiting.has(nodeId)) return nodeById.get(nodeId);
    if (visited.has(nodeId)) return undefined;
    visiting.add(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) {
      const found = visit(edge.target);
      if (found) return found;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return undefined;
  }
  for (const node of nodes) {
    const found = visit(node.id);
    if (found) return found;
  }
  return undefined;
}

function adjacency(edges: LogicEdge[]): Map<string, LogicEdge[]> {
  const result = new Map<string, LogicEdge[]>();
  for (const edge of edges) result.set(edge.source, [...(result.get(edge.source) ?? []), edge]);
  return result;
}

function reverseAdjacency(edges: LogicEdge[]): Map<string, LogicEdge[]> {
  const result = new Map<string, LogicEdge[]>();
  for (const edge of edges) result.set(edge.target, [...(result.get(edge.target) ?? []), edge]);
  return result;
}

function healthFromDiagnostics(diagnostics: ChainDiagnostic[]): ChainHealth {
  if (diagnostics.some((item) => item.severity === "error")) return "error";
  if (diagnostics.some((item) => item.severity === "warning")) return "warning";
  return "healthy";
}

function healthWeight(health: ChainHealth): number {
  return health === "error" ? 2 : health === "warning" ? 1 : 0;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)));
}

function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}
