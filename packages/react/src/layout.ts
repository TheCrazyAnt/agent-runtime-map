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
      // Spacing is what keeps edges out of node bodies: ELK routes orthogonally
      // in the gaps it is given, so a gap too small forces a line across a node.
      "elk.spacing.nodeNode": "88",
      "elk.layered.spacing.nodeNodeBetweenLayers": "150",
      "elk.spacing.edgeNode": "42",
      "elk.spacing.edgeEdge": "22",
      "elk.layered.spacing.edgeNodeBetweenLayers": "38",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "18",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      // Thoroughness over speed: these graphs are tens of nodes, not thousands,
      // and a crossing a reader has to untangle costs far more than the layout.
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.thoroughness": "40",
      "elk.layered.cycleBreaking.strategy": "GREEDY",
      "elk.layered.mergeEdges": "true",
      "elk.edgeRouting": "ORTHOGONAL",
      // Ports stay on the left and right faces, so flow always reads rightward.
      "elk.portConstraints": "FIXED_SIDE",
      "elk.padding": "[top=90,left=90,bottom=90,right=90]",
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: (node.width as number | undefined) ?? BLUEPRINT_NODE_WIDTH,
      height: (node.height as number | undefined) ?? BLUEPRINT_NODE_HEIGHT,
      layoutOptions: { "elk.portConstraints": "FIXED_SIDE" },
    })),
    edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  });

  const positions = new Map<string, XYPosition>(
    (graph.children ?? []).map((child: ElkNode) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]),
  );
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
}
