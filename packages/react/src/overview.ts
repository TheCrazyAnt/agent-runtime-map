import type { LogicEdge, LogicGraph, LogicNode, LogicNodeType } from "@agent-runtime-map/schema";

/**
 * The Overview level of detail.
 *
 * Drawing every node and every edge at once produces a picture no one can read —
 * but hiding data would make the map lie. So Overview is a **projection**: each
 * aggregate node names the real nodes it stands for, and each bus edge names the
 * real edges it merges. Nothing is invented here; opening an aggregate returns
 * the reader to the exact nodes and edges the analyzer produced, with their
 * evidence and confidence untouched.
 *
 * A node that several features share is aggregated once, globally, rather than
 * once per feature: a shared Agent is the same Agent, and duplicating it would
 * claim the system has more of them than it does.
 */

/** The four reading buckets a step falls into at Overview altitude. */
export type OverviewRole = "entry" | "stage" | "capability" | "io" | "result";

export interface OverviewNode {
  id: string;
  role: OverviewRole;
  /** The feature this aggregate belongs to, or undefined when it is shared. */
  featureId?: string;
  featureLabel?: string;
  /** Set when the aggregate stands for exactly one real node. */
  singleNodeId?: string;
  label: string;
  /** Every logic node this aggregate stands for. Never empty. */
  memberIds: string[];
  /** Distinct node types inside, for the icon row. */
  types: LogicNodeType[];
  /** How many feature routes pass through this aggregate. */
  routeCount: number;
}

export interface OverviewEdge {
  id: string;
  source: string;
  target: string;
  /** The real logic edges this bus merges. Never empty. */
  edgeIds: string[];
  /** The strongest control kind among the merged edges, for styling. */
  control?: LogicEdge["control"];
  /** True when any merged edge is a data flow rather than execution. */
  dataFlow: boolean;
}

export interface OverviewModel {
  nodes: OverviewNode[];
  edges: OverviewEdge[];
}

const ROLE_OF_TYPE: Record<LogicNodeType, OverviewRole> = {
  entrypoint: "entry",
  user_action: "entry",
  process: "stage",
  workflow: "stage",
  ai_process: "capability",
  model: "capability",
  tool: "capability",
  human_gate: "stage",
  decision: "stage",
  data: "io",
  external_system: "io",
  result: "result",
};

const ROLE_ORDER: OverviewRole[] = ["entry", "stage", "capability", "io", "result"];

/**
 * Roles whose members stay individually visible. An entry is what a reader looks
 * for first, and a result is what they trace toward; collapsing either would hide
 * the two ends of every chain.
 */
const UNCOLLAPSED_ROLES = new Set<OverviewRole>(["entry", "result"]);

export interface OverviewLabels {
  stage: string;
  capability: string;
  io: string;
  shared: string;
}

export const DEFAULT_OVERVIEW_LABELS: OverviewLabels = {
  stage: "Steps",
  capability: "Agents & tools",
  io: "Data & services",
  shared: "Shared",
};

/**
 * How a single node and a feature are named. Supplied by the host so an aggregate
 * standing for one step carries that step's business name in the reader's own
 * language — reading a raw identifier off `node.label` here is what put English
 * function names on a Chinese canvas.
 */
export interface OverviewResolvers {
  nodeLabel?: (node: LogicNode) => string;
  featureLabel?: (featureId: string, fallback: string) => string;
}

/** Chinese sets words without a space; English needs one. */
function joinLabel(qualifier: string, noun: string): string {
  return /[\u3400-\u9fff]/.test(qualifier) ? `${qualifier}${noun}` : `${qualifier} ${noun.toLowerCase()}`;
}

export function buildOverviewModel(
  graph: LogicGraph,
  labels: Partial<OverviewLabels> = {},
  resolvers: OverviewResolvers = {},
): OverviewModel {
  const text = { ...DEFAULT_OVERVIEW_LABELS, ...labels };
  const nameOf = (node: LogicNode) => resolvers.nodeLabel?.(node) ?? node.label;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  // Which features reach each node. A node reached by more than one is shared, and
  // is aggregated globally so the map shows one of it rather than several.
  const featuresByNode = new Map<string, string[]>();
  for (const feature of graph.features) {
    for (const nodeId of feature.nodeIds) {
      const owners = featuresByNode.get(nodeId) ?? [];
      if (!owners.includes(feature.id)) owners.push(feature.id);
      featuresByNode.set(nodeId, owners);
    }
  }

  const bucketOf = (node: LogicNode): { key: string; role: OverviewRole; featureId?: string } => {
    const role = ROLE_OF_TYPE[node.type] ?? "stage";
    const owners = featuresByNode.get(node.id) ?? [];
    // An uncollapsed role, or a node no feature claims, keeps its own identity.
    if (UNCOLLAPSED_ROLES.has(role) || owners.length === 0) return { key: `single:${node.id}`, role, featureId: owners[0] };
    if (owners.length > 1) return { key: `shared:${role}`, role };
    return { key: `${owners[0]}:${role}`, role, featureId: owners[0] };
  };

  const buckets = new Map<string, { role: OverviewRole; featureId?: string; members: LogicNode[] }>();
  for (const node of graph.nodes) {
    const { key, role, featureId } = bucketOf(node);
    const bucket = buckets.get(key) ?? { role, featureId, members: [] };
    bucket.members.push(node);
    buckets.set(key, bucket);
  }

  const featureLabelById = new Map(graph.features.map((feature) =>
    [feature.id, resolvers.featureLabel?.(feature.id, feature.label) ?? feature.label]));
  const nodes: OverviewNode[] = [...buckets.entries()].map(([key, bucket]) => {
    const memberIds = bucket.members.map((member) => member.id);
    const types = [...new Set(bucket.members.map((member) => member.type))];
    const single = bucket.members.length === 1 ? bucket.members[0] : undefined;
    const shared = key.startsWith("shared:");
    const roleLabel = bucket.role === "capability" ? text.capability : bucket.role === "io" ? text.io : text.stage;
    return {
      id: key,
      role: bucket.role,
      featureId: bucket.featureId,
      featureLabel: bucket.featureId ? featureLabelById.get(bucket.featureId) : undefined,
      singleNodeId: single?.id,
      // The host supplies both words already spelled for its language; joining
      // them with a Latin space and lowercasing is an English typography rule
      // that produces "共用 处理步骤" on a Chinese canvas.
      label: single ? nameOf(single) : shared ? joinLabel(text.shared, roleLabel) : roleLabel,
      memberIds,
      types,
      routeCount: countRoutes(graph, memberIds),
    };
  });

  // Every edge is projected onto the buckets holding its endpoints; edges inside
  // one bucket disappear into it rather than becoming self-loops.
  const bucketIdByNode = new Map<string, string>();
  for (const [key, bucket] of buckets) for (const member of bucket.members) bucketIdByNode.set(member.id, key);

  const merged = new Map<string, OverviewEdge>();
  for (const edge of graph.edges) {
    const source = bucketIdByNode.get(edge.source);
    const target = bucketIdByNode.get(edge.target);
    if (!source || !target || source === target) continue;
    const id = `bus:${source}->${target}`;
    const existing = merged.get(id);
    const dataFlow = (existing?.dataFlow ?? false) || edge.type === "data_flow" || nodeById.get(edge.target)?.type === "data";
    merged.set(id, {
      id,
      source,
      target,
      edgeIds: [...(existing?.edgeIds ?? []), edge.id],
      control: strongestControl(existing?.control, edge.control),
      dataFlow,
    });
  }

  return {
    nodes: nodes.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.label.localeCompare(b.label)),
    edges: [...merged.values()],
  };
}

/** How many feature routes (variants) touch any of these nodes. */
function countRoutes(graph: LogicGraph, memberIds: string[]): number {
  const members = new Set(memberIds);
  let count = 0;
  for (const feature of graph.features) {
    for (const variant of feature.variants) {
      if (variant.nodeIds.some((id) => members.has(id))) count += 1;
    }
  }
  return count;
}

/**
 * When a bus merges edges of different kinds, the one a reader most needs to see
 * wins. A retry hidden behind a plain arrow is the kind of omission that makes a
 * map misleading rather than merely simplified.
 */
const CONTROL_PRIORITY: Array<NonNullable<LogicEdge["control"]>> = [
  "human_approval", "retry", "fallback", "loop", "parallel", "conditional", "sequential",
];

function strongestControl(
  a: LogicEdge["control"],
  b: LogicEdge["control"],
): LogicEdge["control"] {
  if (!a) return b;
  if (!b) return a;
  return CONTROL_PRIORITY.indexOf(a) <= CONTROL_PRIORITY.indexOf(b) ? a : b;
}
