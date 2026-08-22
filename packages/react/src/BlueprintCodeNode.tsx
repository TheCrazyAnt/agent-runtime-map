import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Bot, Braces, ChevronDown, Database, FileCode2, GitBranch, Globe2, Route, Wrench } from "lucide-react";
import type { ComponentType, MouseEvent } from "react";

export const BLUEPRINT_CODE_NODE_WIDTH = 176;
export const BLUEPRINT_CODE_NODE_HEIGHT = 88;

export interface BlueprintCodeNodeData extends Record<string, unknown> {
  label: string;
  kind: string;
  source: string;
  relation?: string;
  /** 1 for a direct child, 2 for the one further level a reader can open. */
  depth?: 1 | 2;
  expandable?: boolean;
  expanded?: boolean;
  /**
   * Opens the one further level below this child. Drilling down is an explicit
   * control rather than a double-click: the gesture is undiscoverable, and React
   * Flow does not deliver a double-click to a node that is not draggable.
   */
  onToggle?: () => void;
  /** Supplied by the host so the control speaks the reader's language. */
  toggleLabel?: string;
}

const ICONS: Record<string, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  agent: Bot,
  database: Database,
  external_api: Globe2,
  function: Braces,
  route: Route,
  tool: Wrench,
  workflow: GitBranch,
};

export function BlueprintCodeNode({ data, selected }: NodeProps) {
  const value = data as BlueprintCodeNodeData;
  const Icon = ICONS[value.kind] ?? FileCode2;
  return (
    <article className={`blueprint-code-node${selected ? " is-selected" : ""}${value.depth === 2 ? " is-deep" : ""}${value.expanded ? " is-expanded" : ""}`}>
      <Handle type="target" position={Position.Top} className="blueprint-code-handle" />
      <span className="blueprint-code-node__icon"><Icon size={15} strokeWidth={1.8} /></span>
      <span className="blueprint-code-node__body">
        <small>{value.kind.replaceAll("_", " ")}</small>
        <strong title={value.label}>{value.label}</strong>
        <code title={value.source}>{value.source}</code>
      </span>
      {value.relation && <i>{value.relation}</i>}
      {value.expandable && value.onToggle && (
        <button
          type="button"
          className="blueprint-code-node__toggle"
          aria-expanded={value.expanded ?? false}
          aria-label={value.toggleLabel ?? (value.expanded ? `Collapse ${value.label}` : `Expand ${value.label}`)}
          onClick={(event: MouseEvent) => { event.stopPropagation(); value.onToggle?.(); }}
        >
          <ChevronDown size={12} strokeWidth={2} />
        </button>
      )}
      <Handle type="source" position={Position.Bottom} className="blueprint-code-handle" />
    </article>
  );
}
