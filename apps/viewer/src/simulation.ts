import type { ChainDiagnostic, FeaturePathVariant, FeatureScenario } from "@agent-runtime-map/schema";

export type SimulationOutcome = "idle" | "running" | "complete" | "error";

export interface SimulationFrame {
  stepIndex: number;
  completedNodeIds: Set<string>;
  currentNodeIds: Set<string>;
  reachedNodeIds: Set<string>;
  reachedEdgeIds: Set<string>;
  currentEdgeIds: Set<string>;
  errorNodeIds: Set<string>;
  errorEdgeIds: Set<string>;
  warningNodeIds: Set<string>;
  halted: boolean;
  outcome: SimulationOutcome;
}

export function buildSimulationFrame(
  feature: FeatureScenario | undefined,
  variant: FeaturePathVariant | undefined,
  requestedStepIndex: number,
): SimulationFrame {
  if (!feature || !variant || !variant.steps.length) return emptyFrame();
  const stepIndex = Math.max(-1, Math.min(requestedStepIndex, variant.steps.length - 1));
  const completedSteps = stepIndex > 0 ? variant.steps.slice(0, stepIndex) : [];
  const reachedSteps = stepIndex >= 0 ? variant.steps.slice(0, stepIndex + 1) : [];
  const currentStep = stepIndex >= 0 ? variant.steps[stepIndex] : undefined;
  const errorDiagnostics = feature.diagnostics.filter((item) => item.severity === "error");
  const warningDiagnostics = feature.diagnostics.filter((item) => item.severity === "warning");
  const reachedNodeIds = new Set(reachedSteps.flatMap((step) => step.nodeIds));
  const reachedEdgeIds = new Set(reachedSteps.flatMap((step) => step.incomingEdgeIds));
  const currentNodeIds = new Set(currentStep?.nodeIds ?? []);
  const currentEdgeIds = new Set(currentStep?.incomingEdgeIds ?? []);
  const errorNodeIds = diagnosticIds(errorDiagnostics, "nodeId", reachedNodeIds);
  const errorEdgeIds = diagnosticIds(errorDiagnostics, "edgeId", reachedEdgeIds);
  const warningNodeIds = diagnosticIds(warningDiagnostics, "nodeId", reachedNodeIds);
  const halted = errorNodeIds.size > 0 || errorEdgeIds.size > 0;
  const atEnd = stepIndex === variant.steps.length - 1;

  return {
    stepIndex,
    completedNodeIds: new Set(completedSteps.flatMap((step) => step.nodeIds)),
    currentNodeIds,
    reachedNodeIds,
    reachedEdgeIds,
    currentEdgeIds,
    errorNodeIds,
    errorEdgeIds,
    warningNodeIds,
    halted,
    outcome: stepIndex < 0 ? "idle" : halted ? "error" : atEnd ? "complete" : "running",
  };
}

export function nextSimulationStep(variant: FeaturePathVariant | undefined, stepIndex: number): number {
  if (!variant?.steps.length) return -1;
  if (stepIndex >= variant.steps.length - 1) return 0;
  return stepIndex + 1;
}

function diagnosticIds(
  diagnostics: ChainDiagnostic[],
  field: "nodeId" | "edgeId",
  reachedIds: Set<string>,
): Set<string> {
  return new Set(diagnostics.flatMap((item) => {
    const id = item[field];
    return id && reachedIds.has(id) ? [id] : [];
  }));
}

function emptyFrame(): SimulationFrame {
  return {
    stepIndex: -1,
    completedNodeIds: new Set(),
    currentNodeIds: new Set(),
    reachedNodeIds: new Set(),
    reachedEdgeIds: new Set(),
    currentEdgeIds: new Set(),
    errorNodeIds: new Set(),
    errorEdgeIds: new Set(),
    warningNodeIds: new Set(),
    halted: false,
    outcome: "idle",
  };
}
