import type { FeatureScenario, LogicEdge, LogicGraph } from "@agent-runtime-map/schema";
import type { Edge, Node } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import { blueprintEdgeAppearance, type BlueprintEdgeState } from "./edgeAppearance.js";
import type { BlueprintLogicNodeData } from "./BlueprintLogicNode.js";
import type { BlueprintGroupLabels } from "./blueprintGroups.js";
import type { SimulationFrame } from "./simulation.js";

type Variant = FeatureScenario["variants"][number];

export const DEFAULT_LABELS: BlueprintGroupLabels = {
  runtime: "AGENT RUNTIME",
  workflows: "AGENT WORKFLOWS",
  systems: "DATA & SERVICES",
  nodeCount: (count) => `${count} ${count === 1 ? "node" : "nodes"}`,
};

export function toFlowNode(node: LogicGraph["nodes"][number]): Node<BlueprintLogicNodeData> {
  const primarySource = node.sources[0];
  return {
    id: node.id,
    type: "logic",
    position: { x: 0, y: 0 },
    data: {
      label: node.label,
      description: node.description,
      nodeType: node.type,
      typeLabel: node.type.replaceAll("_", " ").toUpperCase(),
      confidence: node.confidence,
      sourceText: `${node.sources.length} ${node.sources.length === 1 ? "source" : "sources"}`,
      sourceDetail: primarySource
        ? `${primarySource.file}:${primarySource.startLine}${primarySource.symbol ? ` · ${primarySource.symbol}` : ""}`
        : undefined,
      inferenceText: node.inference.method,
    },
  };
}

export function toFlowEdge(edge: LogicEdge, state: BlueprintEdgeState): Edge {
  const dataFlow = edge.type === "data_flow";
  const appearance = blueprintEdgeAppearance(state, dataFlow);
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "playback",
    label: edge.label,
    className: `chain-edge chain-edge--${state}`,
    markerEnd: { type: MarkerType.ArrowClosed, width: 17, height: 17, color: appearance.color },
    style: {
      stroke: appearance.color,
      strokeWidth: appearance.width,
      opacity: appearance.opacity,
      strokeDasharray: appearance.dash,
    },
    data: { showToken: state === "current", tokenColor: appearance.color, tokenDuration: 0.9 },
  };
}

export function edgeState(edge: LogicEdge, frame: SimulationFrame, variant: Variant | undefined): BlueprintEdgeState {
  if (!variant) return "global";
  if (!variant.edgeIds.includes(edge.id)) return "outside";
  if (frame.errorEdgeIds.has(edge.id)) return "error";
  if (frame.warningEdgeIds.has(edge.id)) return "warning";
  if (frame.currentEdgeIds.has(edge.id)) return "current";
  if (frame.reachedEdgeIds.has(edge.id)) return "reached";
  return "path";
}

export function nodeStateClass(nodeId: string, frame: SimulationFrame, variant: Variant | undefined): string {
  if (!variant) return "";
  if (!variant.nodeIds.includes(nodeId)) return "is-outside-path";
  if (frame.errorNodeIds.has(nodeId)) return "is-chain-error";
  if (frame.warningNodeIds.has(nodeId)) return "is-chain-warning";
  if (frame.currentNodeIds.has(nodeId)) return "is-current";
  if (frame.completedNodeIds.has(nodeId)) return "is-chain-complete";
  return "is-path-pending";
}
