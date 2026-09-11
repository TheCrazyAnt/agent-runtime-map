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

  it("names a feature after the Chinese capability its documentation declares", () => {
    // The reader keeps Han terms whole and in 2-grams; the matcher used to drop every
    // token shorter than three characters, which is every second Chinese term. The two
    // sides then tokenized the same words differently and a documented Chinese
    // capability could never win, so features fell back to their code names — the
    // reason a Chinese project's list read as "(底层)创作库事务" instead of "成片".
    const nodes = [
      node("生成成片", "entrypoint"),
      node("渲染", "ai_process"),
      node("成片文件", "result"),
    ];
    const edges = [edge("生成成片", "渲染"), edge("渲染", "成片文件")];

    const features = compileFeatureScenarios(nodes, edges, [{
      id: "capability_render",
      label: "成片",
      description: "自动拍成可导进剪映的成片。",
      keywords: ["成片", "剪映"],
      origin: "readme",
      sources: [{ file: "README.md", startLine: 3 }],
      confidence: 0.8,
    }]);

    expect(features).toHaveLength(1);
    expect(features[0].label).toBe("成片");
  });

  it("matches a capability named inside a step when the project has no route for it", () => {
    // Not every capability arrives through an HTTP route. A project whose business
    // logic is exported functions has no entrypoint node to carry the high-weight
    // entry match, so the capability 选题 fell to step evidence and was rejected by
    // the weak-match floor even though a step is literally called 热点选题. A
    // capability's own name appearing in a step is strong evidence; a word from its
    // description appearing there is not.
    const nodes = [node("热点选题", "process"), node("大模型", "ai_process"), node("选题结果", "result")];
    const edges = [edge("热点选题", "大模型"), edge("大模型", "选题结果")];

    const features = compileFeatureScenarios(nodes, edges, [{
      id: "capability_topic",
      label: "选题",
      description: "从热点里找选题。",
      keywords: ["选题", "热点"],
      origin: "readme",
      sources: [{ file: "README.md", startLine: 3 }],
      confidence: 0.8,
    }]);

    expect(features[0].label).toBe("选题");
    expect(features[0].product?.label).toBe("选题");
  });

  it("refuses to borrow a capability name on a word from its description", () => {
    // Entry hits weigh 8, so one is decisive. A common word that appears in a
    // capability's *description* — 自动, 生成, 处理 — is not evidence that an entry
    // implements it, and splitting Han runs into 2-grams puts many such words in
    // reach. Naming a retry loop "成片" is worse than leaving it named after code:
    // it is wrong and it looks right. Only the capability's own name can carry an
    // entry match; its description still contributes ordinary step evidence.
    const nodes = [node("自动重试", "entrypoint"), node("等待", "process"), node("重试结果", "result")];
    const edges = [edge("自动重试", "等待"), edge("等待", "重试结果")];

    const features = compileFeatureScenarios(nodes, edges, [{
      id: "capability_render",
      label: "成片",
      description: "自动拍成可导进剪映的成片。",
      keywords: ["成片", "自动拍成可导进剪映的成片"],
      origin: "readme",
      sources: [{ file: "README.md", startLine: 3 }],
      confidence: 0.8,
    }]);

    expect(features[0].label).toBe("自动重试");
    expect(features[0].product).toBeUndefined();
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
