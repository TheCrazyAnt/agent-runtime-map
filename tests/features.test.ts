import { describe, expect, it } from "vitest";
import { compileFeatureScenarios } from "@agent-runtime-map/logic-compiler";
import type { LogicEdge, LogicNode, LogicNodeType } from "@agent-runtime-map/schema";

const source = (symbol: string) => [{ file: `src/${symbol}.ts`, startLine: 1, symbol }];

function node(id: string, type: LogicNodeType, confidence = 0.9): LogicNode {
  return {
    id,
    type,
    label: id.replaceAll("_", " "),
    description: `${id} step`,
    sources: source(id),
    confidence,
    inference: { method: "deterministic", explanation: "test fixture" },
    rawNodeIds: [`raw_${id}`],
  };
}

function edge(sourceId: string, targetId: string, type: LogicEdge["type"] = "flow"): LogicEdge {
  return {
    id: `edge_${sourceId}_${targetId}`,
    source: sourceId,
    target: targetId,
    type,
    confidence: 1,
    rawEdgeIds: [`raw_edge_${sourceId}_${targetId}`],
  };
}

describe("feature chain compiler", () => {
  it("extracts one feature with selectable branch variants and ordered simulation steps", () => {
    const nodes = [
      node("submit", "user_action"),
      node("POST /api/generate", "entrypoint"),
      node("workflow", "ai_process"),
      node("fast_agent", "ai_process"),
      node("quality_agent", "ai_process"),
      node("fast_result", "result"),
      node("quality_result", "result"),
      node("generation_data", "data"),
    ];
    const edges = [
      edge("submit", "POST /api/generate"),
      edge("POST /api/generate", "workflow"),
      edge("workflow", "fast_agent"),
      edge("workflow", "quality_agent"),
      edge("fast_agent", "fast_result"),
      edge("quality_agent", "quality_result"),
      edge("quality_agent", "generation_data", "data_flow"),
    ];

    const features = compileFeatureScenarios(nodes, edges);

    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ label: "POST /api/generate", health: "healthy" });
    expect(features[0].variants).toHaveLength(3);
    expect(features[0].variants[0].steps[0].nodeIds).toEqual(["submit"]);
    expect(features[0].variants.slice(1).every((variant) => variant.resultNodeId)).toBe(true);
  });

  it("marks an entry with no downstream chain as a deterministic error", () => {
    const features = compileFeatureScenarios([node("POST /api/publish", "entrypoint")], []);

    expect(features).toHaveLength(1);
    expect(features[0].health).toBe("error");
    expect(features[0].diagnostics).toContainEqual(expect.objectContaining({
      code: "CHAIN_NO_DOWNSTREAM",
      severity: "error",
      confidence: 1,
      nodeId: "POST /api/publish",
    }));
  });

  it("reports unresolved references and cycles instead of silently guessing", () => {
    const broken = compileFeatureScenarios(
      [node("POST /api/broken", "entrypoint")],
      [edge("POST /api/broken", "missing_workflow")],
    )[0];
    const cyclic = compileFeatureScenarios(
      [node("POST /api/loop", "entrypoint"), node("agent_a", "ai_process"), node("agent_b", "ai_process")],
      [edge("POST /api/loop", "agent_a"), edge("agent_a", "agent_b"), edge("agent_b", "agent_a")],
    )[0];

    expect(broken.health).toBe("error");
    expect(broken.diagnostics.some((item) => item.code === "CHAIN_BROKEN_REFERENCE" && item.severity === "error")).toBe(true);
    expect(cyclic.health).toBe("error");
    expect(cyclic.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["CHAIN_CYCLE", "CHAIN_NO_RESULT"]));
  });

  it("turns low-confidence semantic steps yellow while keeping their evidence", () => {
    const features = compileFeatureScenarios(
      [node("POST /api/review", "entrypoint"), node("maybe_review", "ai_process", 0.42), node("review_result", "result")],
      [edge("POST /api/review", "maybe_review"), edge("maybe_review", "review_result")],
    );

    expect(features[0].health).toBe("warning");
    expect(features[0].diagnostics[0]).toMatchObject({
      code: "CHAIN_LOW_CONFIDENCE",
      severity: "warning",
      nodeId: "maybe_review",
      sources: source("maybe_review"),
    });
  });
});
