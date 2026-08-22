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
}

export function BlueprintPlaybackEdge(props: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 10,
  });
  const data = (props.data ?? {}) as BlueprintPlaybackEdgeData;
  const markerEnd = typeof props.markerEnd === "string" ? props.markerEnd : undefined;

  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={markerEnd} style={props.style} />
      {props.label && (
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
