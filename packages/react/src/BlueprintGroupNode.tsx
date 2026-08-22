import type { NodeProps } from "@xyflow/react";

export type BlueprintGroupTone = "amber" | "cyan" | "violet" | "slate";

export interface BlueprintGroupNodeData extends Record<string, unknown> {
  label: string;
  detail?: string;
  tone: BlueprintGroupTone;
  dashed?: boolean;
}

export function BlueprintGroupNode({ data }: NodeProps) {
  const value = data as BlueprintGroupNodeData;
  return (
    <section className={`blueprint-group blueprint-group--${value.tone}${value.dashed ? " is-dashed" : ""}`}>
      <div className="blueprint-group__label">
        <i aria-hidden="true" />
        <strong>{value.label}</strong>
        {value.detail && <span>{value.detail}</span>}
      </div>
    </section>
  );
}
