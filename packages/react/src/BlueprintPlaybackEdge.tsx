import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";

export interface BlueprintPlaybackEdgeData extends Record<string, unknown> {
  showToken?: boolean;
  tokenColor?: string;
  tokenDuration?: number;
  /**
   * Labels are drawn on demand rather than always. Every edge carrying its label
   * at once produces a wall of repeated words that hides the graph beneath it, so
   * the host sets this for the edges the reader is actually asking about.
   */
  labelVisible?: boolean;
  /** Routes the edge through a channel above the nodes: loops and retries. */
  loopback?: boolean;
}

export function BlueprintPlaybackEdge(props: EdgeProps) {
  const data = (props.data ?? {}) as BlueprintPlaybackEdgeData;
  // A backward edge routed straight would cut through every node between its
  // ends. Lifting it into a channel above them keeps the forward flow readable
  // and makes the loop legible as a loop.
  const backward = props.targetX < props.sourceX;
  const [path, labelX, labelY] = data.loopback && backward
    ? loopbackPath(props)
    : getSmoothStepPath({
      sourceX: props.sourceX,
      sourceY: props.sourceY,
      sourcePosition: props.sourcePosition,
      targetX: props.targetX,
      targetY: props.targetY,
      targetPosition: props.targetPosition,
      borderRadius: 10,
    });
  const markerEnd = typeof props.markerEnd === "string" ? props.markerEnd : undefined;

  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={markerEnd} style={props.style} />
      {props.label && data.labelVisible !== false && (
        <EdgeLabelRenderer>
          <span
            className="blueprint-playback-edge__label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {String(props.label)}
          </span>
        </EdgeLabelRenderer>
      )}
      {data.showToken && (
        <circle className="blueprint-playback-edge__token" r="4" fill={data.tokenColor ?? "#1689cf"}>
          <animateMotion dur={`${data.tokenDuration ?? 0.9}s`} repeatCount="indefinite" path={path} />
        </circle>
      )}
    </>
  );
}

/** An arc through the channel above both endpoints, returning leftward. */
function loopbackPath(props: EdgeProps): [string, number, number] {
  const lift = 54 + Math.min(120, Math.abs(props.sourceX - props.targetX) * 0.12);
  const top = Math.min(props.sourceY, props.targetY) - lift;
  const midX = (props.sourceX + props.targetX) / 2;
  const path = [
    `M ${props.sourceX},${props.sourceY}`,
    `C ${props.sourceX + 40},${props.sourceY} ${props.sourceX + 40},${top} ${midX},${top}`,
    `C ${props.targetX - 40},${top} ${props.targetX - 40},${props.targetY} ${props.targetX},${props.targetY}`,
  ].join(" ");
  return [path, midX, top];
}
