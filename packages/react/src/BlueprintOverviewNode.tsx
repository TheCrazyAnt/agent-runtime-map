import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { LogicNodeType } from "@agent-runtime-map/schema";
import type { OverviewRole } from "./overview.js";

export interface BlueprintOverviewNodeData extends Record<string, unknown> {
  label: string;
  role: OverviewRole;
  memberCount: number;
  routeCount: number;
  types: LogicNodeType[];
  featureLabel?: string;
  /** Set when this aggregate stands for exactly one real node. */
  singleNodeId?: string;
  countsLabel?: string;
  onOpen?: () => void;
  openLabel?: string;
}

/**
 * One aggregate on the Overview canvas. It states how much it stands for — steps
 * and routes — because a box that hides an unknown quantity is worse than the
 * tangle it replaced: the reader cannot tell whether opening it is worth it.
 */
export function BlueprintOverviewNode({ data, selected }: NodeProps) {
  const item = data as BlueprintOverviewNodeData;
  const aggregate = item.memberCount > 1;
  return (
    <div
      className={`blueprint-overview blueprint-overview--${item.role}${selected ? " is-selected" : ""}${aggregate ? " is-aggregate" : ""}`}
      onDoubleClick={item.onOpen}
    >
      <Handle type="target" position={Position.Left} className="blueprint-handle" />
      {item.featureLabel && <p className="blueprint-overview__feature">{item.featureLabel}</p>}
      <p className="blueprint-overview__label">{item.label}</p>
      {aggregate && (
        <p className="blueprint-overview__counts">
          {item.countsLabel ?? `${item.memberCount} steps · ${item.routeCount} routes`}
        </p>
      )}
      {aggregate && item.onOpen && (
        <button type="button" className="blueprint-overview__open" onClick={item.onOpen} aria-label={item.openLabel ?? item.label}>
          {item.openLabel ?? "Open"}
        </button>
      )}
      <Handle type="source" position={Position.Right} className="blueprint-handle" />
    </div>
  );
}
