import type { Edge, Node, XYPosition } from "@xyflow/react";
import type { ElkNode } from "elkjs/lib/elk-api.js";

/**
 * `elk.bundled.js` ships a default export that TypeScript sees as a namespace rather
 * than a constructor, so the shape actually used is stated here instead of widening
 * the whole import to `any`.
 */
interface ElkConstructor {
  new (): { layout(graph: ElkNode): Promise<ElkNode> };
}
import { BLUEPRINT_NODE_HEIGHT, BLUEPRINT_NODE_WIDTH } from "./BlueprintLogicNode.js";

export async function layoutGraph(nodes: Node[], edges: Edge[]): Promise<Node[]> {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js") as unknown as { default: ElkConstructor };
  const elk = new ELK();
  const graph = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "70",
      "elk.layered.spacing.nodeNodeBetweenLayers": "118",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.padding": "[top=90,left=90,bottom=90,right=90]",
    },
    children: nodes.map((node) => ({ id: node.id, width: BLUEPRINT_NODE_WIDTH, height: BLUEPRINT_NODE_HEIGHT })),
    edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  });

  const positions = new Map<string, XYPosition>(
    (graph.children ?? []).map((child: ElkNode) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]),
  );
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
}
