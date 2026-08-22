import type { Node } from "@xyflow/react";
import { measureBlueprintBounds } from "./measureBlueprintBounds.js";
import type { BlueprintGroupNodeData, BlueprintGroupTone } from "./BlueprintGroupNode.js";
import type { BlueprintLogicNodeData } from "./BlueprintLogicNode.js";
import type { LogicGraph, LogicNodeType } from "@agent-runtime-map/schema";

/**
 * Boundary titles are supplied by the host rather than resolved from a locale, so an
 * embedder can label the frames in its own product language without this package
 * carrying a translation table it cannot keep current.
 */
export interface BlueprintGroupLabels {
  runtime: string;
  workflows: string;
  systems: string;
  nodeCount: (count: number) => string;
}

export const DEFAULT_BLUEPRINT_GROUP_LABELS: BlueprintGroupLabels = {
  runtime: "AGENT RUNTIME",
  workflows: "AGENT WORKFLOWS",
  systems: "DATA & SERVICES",
  nodeCount: (count) => `${count} ${count === 1 ? "node" : "nodes"}`,
};

interface GroupDefinition {
  id: string;
  types: LogicNodeType[];
  labelKey: keyof Omit<BlueprintGroupLabels, "nodeCount">;
  tone: BlueprintGroupTone;
  dashed?: boolean;
  padding: number;
  minimumNodes: number;
}

const GROUPS: GroupDefinition[] = [
  {
    id: "runtime",
    types: ["entrypoint", "process", "workflow", "ai_process", "tool", "model", "human_gate", "decision", "data", "external_system", "result"],
    labelKey: "runtime",
    tone: "amber",
    padding: 62,
    minimumNodes: 1,
  },
  {
    id: "workflows",
    types: ["process", "workflow", "ai_process", "tool", "human_gate", "decision"],
    labelKey: "workflows",
    tone: "violet",
    dashed: true,
    padding: 34,
    minimumNodes: 2,
  },
  {
    id: "systems",
    types: ["data", "model", "external_system"],
    labelKey: "systems",
    tone: "cyan",
    padding: 30,
    minimumNodes: 2,
  },
];

export function buildBlueprintGroupNodes(
  nodes: Node<BlueprintLogicNodeData>[],
  graph: LogicGraph,
  activeNodeIds: Set<string> | undefined,
  labels: BlueprintGroupLabels = DEFAULT_BLUEPRINT_GROUP_LABELS,
): Node<BlueprintGroupNodeData>[] {
  const typeById = new Map(graph.nodes.map((node) => [node.id, node.type]));
  const focused = activeNodeIds ? nodes.filter((node) => activeNodeIds.has(node.id)) : nodes;

  return GROUPS.flatMap((group) => {
    const members = focused.filter((node) => group.types.includes(typeById.get(node.id) ?? "user_action"));
    if (members.length < group.minimumNodes) return [];
    const bounds = measureBlueprintBounds(members, group.padding);
    if (!bounds) return [];
    return [{
      id: `blueprint_group_${group.id}`,
      type: "blueprintGroup",
      position: { x: bounds.x, y: bounds.y },
      data: {
        label: labels[group.labelKey],
        detail: labels.nodeCount(members.length),
        tone: group.tone,
        dashed: group.dashed,
      },
      style: { width: bounds.width, height: bounds.height, zIndex: -2 },
      width: bounds.width,
      height: bounds.height,
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      zIndex: -2,
    } satisfies Node<BlueprintGroupNodeData>];
  });
}
