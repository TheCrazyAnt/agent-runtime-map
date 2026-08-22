import { BLUEPRINT_NODE_HEIGHT, BLUEPRINT_NODE_WIDTH } from "./BlueprintLogicNode.js";

export interface BlueprintPositionedNode {
  position: { x: number; y: number };
  width?: number;
  height?: number;
}

export interface BlueprintBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function measureBlueprintBounds(nodes: BlueprintPositionedNode[], padding = 42): BlueprintBounds | undefined {
  if (!nodes.length) return undefined;
  const left = Math.min(...nodes.map((node) => node.position.x));
  const top = Math.min(...nodes.map((node) => node.position.y));
  const right = Math.max(...nodes.map((node) => node.position.x + (node.width ?? BLUEPRINT_NODE_WIDTH)));
  const bottom = Math.max(...nodes.map((node) => node.position.y + (node.height ?? BLUEPRINT_NODE_HEIGHT)));
  return {
    x: left - padding,
    y: top - padding,
    width: right - left + padding * 2,
    height: bottom - top + padding * 2,
  };
}
