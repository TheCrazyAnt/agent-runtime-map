import type { Edge, Node } from "@xyflow/react";
import { BLUEPRINT_NODE_HEIGHT, BLUEPRINT_NODE_WIDTH } from "@agent-runtime-map/react";

export async function layoutGraph(nodes: Node[], edges: Edge[]): Promise<Node[]> {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
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

  const positions = new Map(graph.children?.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]));
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
}
