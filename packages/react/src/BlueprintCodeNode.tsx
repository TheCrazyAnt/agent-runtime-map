import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Bot, Braces, Database, FileCode2, GitBranch, Globe2, Route, Wrench } from "lucide-react";
import type { ComponentType } from "react";

export const BLUEPRINT_CODE_NODE_WIDTH = 176;
export const BLUEPRINT_CODE_NODE_HEIGHT = 88;

export interface BlueprintCodeNodeData extends Record<string, unknown> {
  label: string;
  kind: string;
  source: string;
  relation?: string;
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
    <article className={`blueprint-code-node${selected ? " is-selected" : ""}`}>
      <Handle type="target" position={Position.Top} className="blueprint-code-handle" />
      <span className="blueprint-code-node__icon"><Icon size={15} strokeWidth={1.8} /></span>
      <span className="blueprint-code-node__body">
        <small>{value.kind.replaceAll("_", " ")}</small>
        <strong title={value.label}>{value.label}</strong>
        <code title={value.source}>{value.source}</code>
      </span>
      {value.relation && <i>{value.relation}</i>}
      <Handle type="source" position={Position.Bottom} className="blueprint-code-handle" />
    </article>
  );
}
