import { describe, expect, it } from "vitest";
import type { FeaturePathVariant, FeatureScenario } from "@agent-runtime-map/schema";
import { buildSimulationFrame, nextSimulationStep } from "../apps/viewer/src/simulation.js";

const variant: FeaturePathVariant = {
  id: "default",
  label: "Default path",
  description: "fixture",
  nodeIds: ["entry", "agent", "result"],
  edgeIds: ["entry-agent", "agent-result"],
  steps: [
    { order: 0, nodeIds: ["entry"], incomingEdgeIds: [] },
    { order: 1, nodeIds: ["agent"], incomingEdgeIds: ["entry-agent"] },
    { order: 2, nodeIds: ["result"], incomingEdgeIds: ["agent-result"] },
  ],
  resultNodeId: "result",
  confidence: 0.9,
};

const feature: FeatureScenario = {
  id: "feature",
  label: "Generate",
  description: "fixture",
  entryNodeIds: ["entry"],
  resultNodeIds: ["result"],
  nodeIds: variant.nodeIds,
  edgeIds: variant.edgeIds,
  variants: [variant],
  diagnostics: [],
  health: "healthy",
  confidence: 0.9,
};

describe("chain simulation", () => {
  it("advances through a static feature path and completes at its result", () => {
    expect(nextSimulationStep(variant, -1)).toBe(0);
    expect(buildSimulationFrame(feature, variant, 1)).toMatchObject({ outcome: "running", halted: false });
    expect([...buildSimulationFrame(feature, variant, 1).completedNodeIds]).toEqual(["entry"]);
    expect([...buildSimulationFrame(feature, variant, 2).currentNodeIds]).toEqual(["result"]);
    expect(buildSimulationFrame(feature, variant, 2).outcome).toBe("complete");
    expect(nextSimulationStep(variant, 2)).toBe(0);
  });

  it("halts and exposes a red node when an error diagnostic is reached", () => {
    const brokenFeature: FeatureScenario = {
      ...feature,
      health: "error",
      diagnostics: [{
        id: "broken-agent",
        code: "CHAIN_BROKEN_REFERENCE",
        severity: "error",
        message: "broken",
        suggestion: "fix it",
        nodeId: "agent",
        sources: [{ file: "src/agent.ts", startLine: 7 }],
        confidence: 1,
      }],
    };

    expect(buildSimulationFrame(brokenFeature, variant, 0).halted).toBe(false);
    expect(buildSimulationFrame(brokenFeature, variant, 1)).toMatchObject({ halted: true, outcome: "error" });
    expect([...buildSimulationFrame(brokenFeature, variant, 1).errorNodeIds]).toEqual(["agent"]);
  });
});
