import type { ComponentType } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Bot,
  BrainCircuit,
  CheckCircle2,
  Database,
  GitBranch,
  Globe2,
  MousePointerClick,
  Play,
  Scan,
  Route,
  UserCheck,
  Workflow,
  Wrench,
} from "lucide-react";
import type { BlueprintDetailLevel } from "./semanticZoom.js";

export type BlueprintLogicNodeType =
  | "user_action"
  | "entrypoint"
  | "process"
  | "workflow"
  | "ai_process"
  | "tool"
  | "model"
  | "human_gate"
  | "decision"
  | "data"
  | "external_system"
  | "result";

export const BLUEPRINT_NODE_WIDTH = 190;
export const BLUEPRINT_NODE_HEIGHT = 154;

export interface BlueprintLogicNodeData extends Record<string, unknown> {
  label: string;
  description: string;
  nodeType: BlueprintLogicNodeType;
  typeLabel: string;
  confidence: number;
  sourceText: string;
  /**
   * True when the analyzer could not read this step's business meaning from
   * evidence. Marked rather than guessed: a reader who sees the badge knows the
   * tool declined, and the name it was given in code is in the detail panel.
   */
  pending?: boolean;
  sourceDetail?: string;
  inferenceText?: string;
  detailLevel?: BlueprintDetailLevel;
  /**
   * Narrows the map to this step and everything below it. An explicit control
   * rather than a gesture: double-click already means "show me the code inside",
   * and one gesture cannot honestly mean both "show the evidence" and "hide
   * everything else".
   */
  onFocus?: () => void;
  focusLabel?: string;
}

const ICONS: Record<BlueprintLogicNodeType, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  user_action: MousePointerClick,
  entrypoint: Route,
  process: Play,
  workflow: Workflow,
  ai_process: Bot,
  tool: Wrench,
  model: BrainCircuit,
  human_gate: UserCheck,
  decision: GitBranch,
  data: Database,
  external_system: Globe2,
  result: CheckCircle2,
};

export function BlueprintLogicNode({ data, selected }: NodeProps) {
  const value = data as BlueprintLogicNodeData;
  const Icon = ICONS[value.nodeType];
  const detailClass = value.detailLevel ? ` blueprint-node--detail-${value.detailLevel}` : "";
  return (
    <article
      className={`blueprint-node blueprint-node--${value.nodeType}${detailClass}${selected ? " is-selected" : ""}${value.pending ? " is-pending" : ""}`}
      data-detail-level={value.detailLevel}
    >
      <Handle type="target" position={Position.Left} className="blueprint-handle" />
      <div className="blueprint-node__tile">
        <span className="blueprint-node__type">{value.typeLabel}</span>
        <span className="blueprint-node__confidence">{Math.round(value.confidence * 100)}%</span>
        <span className="blueprint-node__icon"><Icon size={35} strokeWidth={1.75} /></span>
      </div>
      <h3>{value.label}</h3>
      <p>{value.description}</p>
      <small>{value.sourceText}</small>
      {value.sourceDetail && (
        <div className="blueprint-node__evidence">
          <code>{value.sourceDetail}</code>
          {value.inferenceText && <span>{value.inferenceText}</span>}
        </div>
      )}
      {value.onFocus && (
        <button
          type="button"
          className="blueprint-node__focus"
          aria-label={value.focusLabel ?? `Focus ${value.label}`}
          title={value.focusLabel ?? `Focus ${value.label}`}
          onClick={(event) => { event.stopPropagation(); value.onFocus?.(); }}
        >
          <Scan size={13} strokeWidth={2} />
        </button>
      )}
      <Handle type="source" position={Position.Right} className="blueprint-handle" />
    </article>
  );
}
