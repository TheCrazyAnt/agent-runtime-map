import type { Node } from "@xyflow/react";
import {
  measureBlueprintBounds,
  type BlueprintGroupNodeData,
  type BlueprintGroupTone,
  type BlueprintLogicNodeData,
} from "@agent-runtime-map/react";
import type { LogicGraph, LogicNodeType } from "@agent-runtime-map/schema";
import type { UiLocale } from "./i18n.js";

interface GroupDefinition {
  id: string;
  types: LogicNodeType[];
  label: Record<UiLocale, string>;
  tone: BlueprintGroupTone;
  dashed?: boolean;
  padding: number;
  minimumNodes: number;
}

const GROUPS: GroupDefinition[] = [
  {
    id: "runtime",
    types: ["entrypoint", "process", "ai_process", "decision", "data", "external_system", "result"],
    label: { en: "AGENT RUNTIME", "zh-CN": "智能体运行时" },
    tone: "amber",
    padding: 62,
    minimumNodes: 1,
  },
  {
    id: "workflows",
    types: ["process", "ai_process", "decision"],
    label: { en: "AGENT WORKFLOWS", "zh-CN": "AGENT 工作流" },
    tone: "violet",
    dashed: true,
    padding: 34,
    minimumNodes: 2,
  },
  {
    id: "systems",
    types: ["data", "external_system"],
    label: { en: "DATA & SERVICES", "zh-CN": "数据与外部服务" },
    tone: "cyan",
    padding: 30,
    minimumNodes: 2,
  },
];

export function buildBlueprintGroupNodes(
  nodes: Node<BlueprintLogicNodeData>[],
  graph: LogicGraph,
  activeNodeIds: Set<string> | undefined,
  locale: UiLocale,
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
        label: group.label[locale],
        detail: `${members.length} ${locale === "zh-CN" ? "个节点" : members.length === 1 ? "node" : "nodes"}`,
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
