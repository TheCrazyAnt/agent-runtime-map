import type { Edge, Node, XYPosition } from "@xyflow/react";
import { BLUEPRINT_CODE_NODE_HEIGHT, BLUEPRINT_CODE_NODE_WIDTH } from "@agent-runtime-map/react";
import type { BlueprintCodeNodeData, BlueprintLogicNodeData } from "@agent-runtime-map/react";
import type { FeaturePathVariant, LogicEdge, LogicNode, RawCodeGraph, RawCodeNode } from "@agent-runtime-map/schema";

export interface CodeDetailExpansion {
  nodes: Node<BlueprintCodeNodeData>[];
  edges: Edge[];
}

export interface VariantTransition {
  enteringNodeIds: Set<string>;
  exitingNodeIds: Set<string>;
  sharedNodeIds: Set<string>;
  enteringEdgeIds: Set<string>;
  exitingEdgeIds: Set<string>;
  sharedEdgeIds: Set<string>;
}

export type LayoutPositions = Record<string, XYPosition>;

export interface CodeDetailOptions {
  limit?: number;
  /**
   * Raw children the reader drilled into. Only one further level is ever built from
   * them: an unbounded drill-down would let a single node redraw the whole call
   * graph underneath the map, which is the readability the compression exists to
   * protect. Reaching further is a breadcrumb's job, not a bigger expansion's.
   */
  expandedRawIds?: ReadonlySet<string>;
  secondLevelLimit?: number;
}

export const MAX_DETAIL_DEPTH = 2;

export function buildCodeDetailExpansion(
  logicNode: LogicNode,
  parentNode: Node<BlueprintLogicNodeData>,
  rawGraph: RawCodeGraph,
  options: CodeDetailOptions = {},
): CodeDetailExpansion {
  const limit = options.limit ?? 9;
  const secondLevelLimit = options.secondLevelLimit ?? 5;
  const rawById = new Map(rawGraph.nodes.map((node) => [node.id, node]));
  const seedIds = logicNode.rawNodeIds.filter((id) => rawById.has(id));
  const neighborIds = internalsOf(seedIds, rawGraph, rawById);
  const firstLevelIds = unique([...seedIds, ...neighborIds])
    .sort((left, right) => detailRank(rawById.get(left)) - detailRank(rawById.get(right)))
    .slice(0, limit);
  const firstLevel = new Set(firstLevelIds);

  // Second level only from children the reader opened, and only from children that
  // are actually on screen, so an expansion can never grow from something hidden.
  const focusIds = [...(options.expandedRawIds ?? [])].filter((id) => firstLevel.has(id));
  const secondLevelIds = unique(internalsOf(focusIds, rawGraph, rawById))
    .filter((id) => !firstLevel.has(id) && rawById.has(id))
    .sort((left, right) => detailRank(rawById.get(left)) - detailRank(rawById.get(right)))
    .slice(0, secondLevelLimit);

  const rankedIds = [...firstLevelIds, ...secondLevelIds];
  const visibleIds = new Set(rankedIds);
  const depthOf = (rawId: string): 1 | 2 => (firstLevel.has(rawId) ? 1 : 2);
  const columns = Math.min(3, Math.max(1, rankedIds.length));
  const centerOffset = ((columns - 1) * 196) / 2;
  const relations = new Map<string, string>();
  for (const edge of rawGraph.edges) {
    if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) continue;
    if (!relations.has(edge.target)) relations.set(edge.target, edge.label ?? edge.kind);
  }

  const nodes = rankedIds.flatMap((rawId, index) => {
    const rawNode = rawById.get(rawId);
    if (!rawNode) return [];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const depth = depthOf(rawId);
    return [{
      id: detailNodeId(logicNode.id, rawId),
      type: "codeDetail",
      position: {
        x: parentNode.position.x + 7 + column * 196 - centerOffset,
        y: parentNode.position.y + 220 + row * 112,
      },
      data: {
        label: rawNode.name,
        kind: rawNode.kind,
        source: sourceLabel(rawNode),
        relation: relations.get(rawId),
        depth,
        // The last level says so, rather than offering an interaction that does nothing.
        expandable: depth < MAX_DETAIL_DEPTH,
        expanded: options.expandedRawIds?.has(rawId) ?? false,
      },
      // Detail nodes are not part of the Viewer's node state, so React Flow's
      // measurement change for them is filtered out by `onNodesChange` and never
      // applied — which left every expanded child stuck at `visibility: hidden`.
      // The visual package fixes this size, so state it instead of measuring it.
      width: BLUEPRINT_CODE_NODE_WIDTH,
      height: BLUEPRINT_CODE_NODE_HEIGHT,
      draggable: false,
      connectable: false,
      className: `detail-node-enter detail-node--depth-${depth}`,
      zIndex: 3,
    } satisfies Node<BlueprintCodeNodeData>];
  });

  const internalEdges = rawGraph.edges.flatMap((edge) => {
    if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) return [];
    return [{
      id: `detail-edge:${logicNode.id}:${edge.id}`,
      source: detailNodeId(logicNode.id, edge.source),
      target: detailNodeId(logicNode.id, edge.target),
      type: "smoothstep",
      label: edge.label ?? edge.kind,
      className: "detail-edge detail-edge-enter",
      style: { stroke: "#8293a2", strokeWidth: 1.15, strokeDasharray: "4 5", opacity: 0.72 },
      labelStyle: { fill: "#7b8794", fontSize: 7 },
    } satisfies Edge];
  });
  const targets = new Set(internalEdges.map((edge) => edge.target));
  const anchorNodes = nodes.filter((node) => seedIds.includes(rawIdFromDetailNode(node.id)) && !targets.has(node.id));
  const anchors = (anchorNodes.length ? anchorNodes : nodes.slice(0, 1)).map((node, index) => ({
    id: `detail-anchor:${logicNode.id}:${index}`,
    source: logicNode.id,
    target: node.id,
    type: "smoothstep",
    className: "detail-edge detail-edge-enter",
    style: { stroke: "#4b9dcc", strokeWidth: 1.45, strokeDasharray: "3 4", opacity: 0.78 },
  } satisfies Edge));
  return { nodes, edges: [...anchors, ...internalEdges] };
}

/**
 * Everything one step reaches, including itself.
 *
 * Focus hides the rest of the map rather than dimming it, which is the difference
 * between framing a feature and narrowing to a step. Positions are untouched: the
 * remaining nodes stay exactly where the reader last saw them, because a focus that
 * rearranged the map would cost the spatial memory it is meant to serve.
 */
export function collectFocusIds(edges: Array<Pick<LogicEdge, "source" | "target">>, rootId: string): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.source);
    if (targets) targets.push(edge.target);
    else outgoing.set(edge.source, [edge.target]);
  }
  const reached = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of outgoing.get(current) ?? []) {
      // A cycle in the graph must not become a loop here.
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}

/** Whether a step has anything below it worth narrowing to. */
export function canFocusNode(edges: Array<Pick<LogicEdge, "source" | "target">>, nodeId: string): boolean {
  return edges.some((edge) => edge.source === nodeId);
}

/**
 * Which steps a query matches, over what a reader can actually see plus the source
 * paths behind it. Kept here, and given its describe function rather than reaching
 * for one, so the search can be tested without a browser — and so it cannot close
 * over a value declared later in the component, which is what once turned typing
 * into a blank page.
 */
export function matchingNodeIds(
  nodes: LogicNode[],
  query: string,
  describe: (node: LogicNode) => { label: string; description: string },
): Set<string> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return new Set(nodes.map((node) => node.id));
  return new Set(nodes.filter((node) => {
    const shown = describe(node);
    const haystack = [shown.label, shown.description, node.label, ...node.sources.map((source) => source.file)];
    return haystack.join(" ").toLowerCase().includes(normalized);
  }).map((node) => node.id));
}

export function compareVariants(
  previous: FeaturePathVariant | undefined,
  current: FeaturePathVariant | undefined,
): VariantTransition {
  return {
    ...compareSets(previous?.nodeIds ?? [], current?.nodeIds ?? [], "NodeIds"),
    ...compareSets(previous?.edgeIds ?? [], current?.edgeIds ?? [], "EdgeIds"),
  } as VariantTransition;
}

export function captureLayout(nodes: Array<Pick<Node, "id" | "position">>): LayoutPositions {
  return Object.fromEntries(nodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }]));
}

export function applyLayoutPositions<T extends Node>(nodes: T[], positions: LayoutPositions | undefined): T[] {
  if (!positions) return nodes;
  return nodes.map((node) => positions[node.id] ? { ...node, position: positions[node.id] } : node);
}

export function parseLayoutPositions(value: string | null): LayoutPositions | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const entries = Object.entries(parsed).filter((entry): entry is [string, XYPosition] => {
      const position = entry[1] as Partial<XYPosition>;
      return Number.isFinite(position?.x) && Number.isFinite(position?.y);
    });
    return Object.fromEntries(entries);
  } catch {
    return undefined;
  }
}

function compareSets(previous: string[], current: string[], suffix: "NodeIds" | "EdgeIds") {
  const previousIds = new Set(previous);
  const currentIds = new Set(current);
  const prefix = suffix === "NodeIds" ? "" : "";
  return {
    [`entering${suffix}`]: new Set(current.filter((id) => !previousIds.has(id))),
    [`exiting${suffix}`]: new Set(previous.filter((id) => !currentIds.has(id))),
    [`shared${suffix}`]: new Set(current.filter((id) => previousIds.has(id))),
    ...(prefix ? { prefix } : {}),
  };
}

/**
 * What a step is made of, which is what it reaches — not what reaches it.
 *
 * Following edges in both directions pulled in the file that contains the step and
 * the route that calls it, and showed them beside its actual internals as if they
 * were peers. Expanding "Execute Review" then answered with its own function, its
 * file, its caller, and only then the three agents that do the work.
 */
function internalsOf(ids: string[], rawGraph: RawCodeGraph, rawById: Map<string, RawCodeNode>): string[] {
  const seeds = new Set(ids);
  return rawGraph.edges.flatMap((edge) => {
    if (!seeds.has(edge.source)) return [];
    const target = rawById.get(edge.target);
    // A file or a module entrypoint is a container, never an internal.
    return target && target.kind !== "file" && target.kind !== "entrypoint" ? [edge.target] : [];
  });
}

function detailNodeId(logicId: string, rawId: string): string {
  return `detail:${logicId}:${rawId}`;
}

/** Splits `detail:<logic id>:<raw id>` back apart; raw ids may contain colons. */
export function parseDetailNodeId(id: string): { logicId: string; rawId: string } | undefined {
  const parts = id.split(":");
  if (parts[0] !== "detail" || parts.length < 3) return undefined;
  return { logicId: parts[1]!, rawId: parts.slice(2).join(":") };
}

function rawIdFromDetailNode(id: string): string {
  return id.split(":").slice(2).join(":");
}

function sourceLabel(node: RawCodeNode): string {
  const source = node.evidence[0]?.source;
  return source ? `${source.file}:${source.startLine}` : node.qualifiedName ?? node.name;
}

function detailRank(node: RawCodeNode | undefined): number {
  const ranks: Record<string, number> = {
    agent: 0,
    workflow: 1,
    function: 2,
    tool: 3,
    route: 4,
    service: 5,
    model: 6,
    database: 7,
    external_api: 8,
    prompt: 9,
    class: 10,
    entrypoint: 11,
    file: 12,
  };
  return node ? ranks[node.kind] ?? 20 : 30;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
