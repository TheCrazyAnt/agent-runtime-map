import type { Edge, Node, XYPosition } from "@xyflow/react";
import type { BlueprintCodeNodeData, BlueprintLogicNodeData } from "@agent-runtime-map/react";
import type { FeaturePathVariant, LogicNode, RawCodeGraph, RawCodeNode } from "@agent-runtime-map/schema";

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

export function buildCodeDetailExpansion(
  logicNode: LogicNode,
  parentNode: Node<BlueprintLogicNodeData>,
  rawGraph: RawCodeGraph,
  limit = 9,
): CodeDetailExpansion {
  const rawById = new Map(rawGraph.nodes.map((node) => [node.id, node]));
  const seedIds = logicNode.rawNodeIds.filter((id) => rawById.has(id));
  const neighborIds = rawGraph.edges.flatMap((edge) => {
    if (seedIds.includes(edge.source)) return [edge.target];
    if (seedIds.includes(edge.target)) return [edge.source];
    return [];
  });
  const rankedIds = unique([...seedIds, ...neighborIds])
    .sort((left, right) => detailRank(rawById.get(left)) - detailRank(rawById.get(right)))
    .slice(0, limit);
  const visibleIds = new Set(rankedIds);
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
      },
      draggable: false,
      connectable: false,
      className: "detail-node-enter",
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

function detailNodeId(logicId: string, rawId: string): string {
  return `detail:${logicId}:${rawId}`;
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
