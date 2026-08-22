export type BlueprintEdgeState = "global" | "outside" | "path" | "reached" | "current" | "warning" | "error";

export interface BlueprintEdgeAppearance {
  color: string;
  width: number;
  opacity: number;
  dash?: string;
  animated: boolean;
}

export function blueprintEdgeAppearance(state: BlueprintEdgeState, dataFlow = false): BlueprintEdgeAppearance {
  if (state === "error") return { color: "#e5484d", width: 3, opacity: 1, animated: false };
  if (state === "warning") return { color: "#d99a24", width: 2.7, opacity: 1, dash: dataFlow ? "7 5" : undefined, animated: false };
  if (state === "current") return { color: "#147fc1", width: 3, opacity: 1, animated: true };
  if (state === "reached") return { color: "#1f9d72", width: 2.4, opacity: 1, animated: false };
  if (state === "outside") return { color: "#a8b0ba", width: 1.25, opacity: 0.16, dash: dataFlow ? "6 7" : undefined, animated: false };
  if (state === "path") return { color: "#1689cf", width: 2, opacity: 0.72, dash: dataFlow ? "7 6" : undefined, animated: false };
  return dataFlow
    ? { color: "#626a73", width: 1.55, opacity: 0.72, dash: "6 7", animated: false }
    : { color: "#1689cf", width: 1.9, opacity: 0.88, animated: false };
}
