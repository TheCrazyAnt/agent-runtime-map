export type BlueprintDetailLevel = "overview" | "logic" | "evidence";

export const BLUEPRINT_SEMANTIC_ZOOM = {
  overviewMax: 0.55,
  evidenceMin: 1.15,
} as const;

export function blueprintDetailLevelForZoom(zoom: number): BlueprintDetailLevel {
  if (!Number.isFinite(zoom) || zoom < BLUEPRINT_SEMANTIC_ZOOM.overviewMax) return "overview";
  if (zoom >= BLUEPRINT_SEMANTIC_ZOOM.evidenceMin) return "evidence";
  return "logic";
}
