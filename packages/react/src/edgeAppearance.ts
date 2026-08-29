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

/**
 * How a control kind reads on the canvas. The rule a reader learns once and then
 * relies on: solid means the work simply proceeds, dashes mean it might not, and
 * a colour break means something went wrong or is being retried.
 *
 * This layers on top of the state appearance: state says where the step is in the
 * simulation, control says what kind of connection it is, and both must stay
 * legible at the same time.
 */
export type ControlKind = "sequential" | "conditional" | "parallel" | "loop" | "retry" | "fallback" | "human_approval";

export interface ControlAppearance {
  dash?: string;
  /** Overrides the state colour, for the kinds that must be unmistakable. */
  color?: string;
  /** Routes the edge through a dedicated channel above or below the nodes. */
  loopback: boolean;
  widthScale: number;
}

export function blueprintControlAppearance(control: ControlKind | undefined): ControlAppearance {
  switch (control) {
    case "conditional":
      return { dash: "4 5", loopback: false, widthScale: 0.78 };
    case "retry":
      return { dash: "9 5", color: "#d9822b", loopback: true, widthScale: 0.95 };
    case "loop":
      return { dash: "2 6", color: "#3b7dd8", loopback: true, widthScale: 0.9 };
    case "fallback":
      return { dash: "10 4 3 4", color: "#e5484d", loopback: false, widthScale: 0.9 };
    case "human_approval":
      return { dash: "12 4", color: "#8b5cf6", loopback: false, widthScale: 1 };
    case "parallel":
      return { dash: "14 4", loopback: false, widthScale: 0.9 };
    default:
      return { loopback: false, widthScale: 1 };
  }
}

/**
 * Whether an edge label should be drawn. Every edge carrying its label at once
 * produces a wall of repeated words like "invoke" that hides the graph beneath
 * it, so a label appears when the reader is actually asking about that edge.
 */
export function shouldShowEdgeLabel(options: {
  hovered?: boolean;
  selected?: boolean;
  playing?: boolean;
  state?: BlueprintEdgeState;
}): boolean {
  if (options.hovered || options.selected) return true;
  // The step being played is the one the reader is watching; naming it helps.
  return Boolean(options.playing && options.state === "current");
}
