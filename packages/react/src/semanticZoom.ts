export type BlueprintDetailLevel = "overview" | "logic" | "evidence";

export interface BlueprintSemanticZoomProgress {
  overview: number;
  logic: number;
  evidence: number;
}

export const BLUEPRINT_SEMANTIC_ZOOM = {
  overviewMax: 0.55,
  evidenceMin: 1.15,
  hysteresis: 0.06,
  logicFadeStart: 0.38,
  logicFadeEnd: 0.72,
  evidenceFadeStart: 0.94,
  evidenceFadeEnd: 1.36,
} as const;

export function blueprintDetailLevelForZoom(
  zoom: number,
  current?: BlueprintDetailLevel,
): BlueprintDetailLevel {
  if (!Number.isFinite(zoom)) return "overview";
  const { overviewMax, evidenceMin, hysteresis } = BLUEPRINT_SEMANTIC_ZOOM;
  if (current === "overview" && zoom < overviewMax + hysteresis) return "overview";
  if (current === "evidence" && zoom >= evidenceMin - hysteresis) return "evidence";
  if (current === "logic") {
    if (zoom < overviewMax - hysteresis) return "overview";
    if (zoom < evidenceMin + hysteresis) return "logic";
    return "evidence";
  }
  if (zoom < overviewMax) return "overview";
  if (zoom >= evidenceMin) return "evidence";
  return "logic";
}

export function blueprintSemanticZoomProgress(zoom: number): BlueprintSemanticZoomProgress {
  const value = Number.isFinite(zoom) ? zoom : 0;
  const logic = smoothstep(BLUEPRINT_SEMANTIC_ZOOM.logicFadeStart, BLUEPRINT_SEMANTIC_ZOOM.logicFadeEnd, value);
  const evidence = smoothstep(BLUEPRINT_SEMANTIC_ZOOM.evidenceFadeStart, BLUEPRINT_SEMANTIC_ZOOM.evidenceFadeEnd, value);
  return { overview: 1 - logic, logic, evidence };
}

function smoothstep(start: number, end: number, value: number): number {
  const progress = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return progress * progress * (3 - 2 * progress);
}
