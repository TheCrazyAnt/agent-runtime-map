import type { ComponentType } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Bot,
  CheckCircle2,
  Database,
  GitBranch,
  Globe2,
  MousePointerClick,
  Play,
  Route,
} from "lucide-react";
import type { LogicNodeType } from "@agent-runtime-map/schema";

export interface LogicNodeData extends Record<string, unknown> {
  label: string;
  description: string;
  nodeType: LogicNodeType;
  typeLabel: string;
  confidence: number;
  sourceText: string;
}

const ICONS: Record<LogicNodeType, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  user_action: MousePointerClick,
  entrypoint: Route,
  process: Play,
  ai_process: Bot,
  decision: GitBranch,
  data: Database,
  external_system: Globe2,
  result: CheckCircle2,
};

export function LogicNodeCard({ data, selected }: NodeProps) {
  const value = data as LogicNodeData;
  const Icon = ICONS[value.nodeType];
  return (
    <article className={`logic-node logic-node--${value.nodeType}${selected ? " is-selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="logic-handle" />
      <div className="logic-node__topline">
        <span className="logic-node__icon"><Icon size={15} strokeWidth={2.2} /></span>
        <span className="logic-node__type">{value.typeLabel}</span>
        <span className="logic-node__confidence">{Math.round(value.confidence * 100)}%</span>
      </div>
      <h3>{value.label}</h3>
      <p>{value.description}</p>
      <div className="logic-node__sources">{value.sourceText}</div>
      <Handle type="source" position={Position.Right} className="logic-handle" />
    </article>
  );
}
