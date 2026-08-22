import type {
  LogicGraph,
  TraceEvent,
  TraceEventKind,
  TraceMatch,
  TraceObservation,
  TraceOverlay,
} from "@agent-runtime-map/schema";

/**
 * A failure is the one thing a later event must not erase. Everything else reflects
 * the most recent observation, because a step that started and then completed did
 * complete — but a step that failed and was retried elsewhere still failed here, and
 * hiding that would make the overlay comforting rather than true.
 */
function resolveState(previous: TraceEventKind | undefined, next: TraceEventKind): TraceEventKind {
  if (previous === "failed") return "failed";
  return next;
}

/**
 * Maps a run's events onto the ids the graph already has.
 *
 * This is deliberately not a tracing system. It adds no nodes, no edges, and no
 * confidence: it reports which existing, evidence-backed elements a run touched, and
 * hands back everything it could not place so the gap is visible instead of quietly
 * filled in. A caller that wants topology from spans wants a different product.
 */
export function applyTraceEvents(graph: LogicGraph, events: readonly TraceEvent[]): TraceOverlay {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edgeIds = new Set(graph.edges.map((edge) => edge.id));
  // A run usually reports the fine-grained symbol it executed, not the compressed
  // step the map shows, so a raw id is lifted to the logic node that contains it.
  const byRawId = new Map<string, string>();
  for (const node of graph.nodes) {
    for (const rawId of node.rawNodeIds) if (!byRawId.has(rawId)) byRawId.set(rawId, node.id);
  }

  const nodes: Record<string, TraceObservation> = {};
  const edges: Record<string, TraceObservation> = {};
  const unmatched: TraceEvent[] = [];

  for (const event of events) {
    const target = resolveTarget(event.target, nodeIds, edgeIds, byRawId);
    if (!target) {
      unmatched.push(event);
      continue;
    }
    const bucket = target.matchedVia === "logic_edge" ? edges : nodes;
    const existing = bucket[target.id];
    bucket[target.id] = {
      state: resolveState(existing?.state, event.kind),
      events: (existing?.events ?? 0) + 1,
      matchedVia: target.matchedVia,
      totalDurationMs: sumDuration(existing?.totalDurationMs, event.durationMs),
      lastDetail: event.detail ?? existing?.lastDetail,
      lastAt: event.at ?? existing?.lastAt,
    };
  }

  return {
    nodes,
    edges,
    unmatched,
    coverage: graph.nodes.length ? Object.keys(nodes).length / graph.nodes.length : 0,
  };
}

function resolveTarget(
  target: string,
  nodeIds: ReadonlySet<string>,
  edgeIds: ReadonlySet<string>,
  byRawId: ReadonlyMap<string, string>,
): { id: string; matchedVia: TraceMatch } | undefined {
  if (nodeIds.has(target)) return { id: target, matchedVia: "logic_node" };
  if (edgeIds.has(target)) return { id: target, matchedVia: "logic_edge" };
  const lifted = byRawId.get(target);
  return lifted ? { id: lifted, matchedVia: "raw_node" } : undefined;
}

function sumDuration(previous: number | undefined, next: number | undefined): number | undefined {
  if (previous === undefined && next === undefined) return undefined;
  return (previous ?? 0) + (next ?? 0);
}

/**
 * The class for an observed element. Kept distinct from the static simulation's
 * classes on purpose: a reader must never mistake "this is the inferred route" for
 * "this actually ran", and one palette for both would do exactly that.
 */
export function traceStateClass(observation: TraceObservation | undefined): string {
  return observation ? `is-observed is-observed-${observation.state}` : "";
}
