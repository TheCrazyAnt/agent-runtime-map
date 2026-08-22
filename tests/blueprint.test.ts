import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import {
  BLUEPRINT_SEMANTIC_ZOOM,
  blueprintEdgeAppearance,
  blueprintDetailLevelForZoom,
  blueprintSemanticZoomProgress,
  measureBlueprintBounds,
  type BlueprintLogicNodeData,
} from "@agent-runtime-map/react";
import type { LogicGraph, LogicNodeType } from "@agent-runtime-map/schema";
import { buildBlueprintGroupNodes } from "@agent-runtime-map/react";

describe("blueprint visual primitives", () => {
  it("maps wheel zoom to stable semantic detail levels", () => {
    expect(blueprintDetailLevelForZoom(0.2)).toBe("overview");
    expect(blueprintDetailLevelForZoom(BLUEPRINT_SEMANTIC_ZOOM.overviewMax)).toBe("logic");
    expect(blueprintDetailLevelForZoom(1)).toBe("logic");
    expect(blueprintDetailLevelForZoom(BLUEPRINT_SEMANTIC_ZOOM.evidenceMin)).toBe("evidence");
    expect(blueprintDetailLevelForZoom(Number.NaN)).toBe("overview");
    expect(blueprintDetailLevelForZoom(0.58, "overview")).toBe("overview");
    expect(blueprintDetailLevelForZoom(0.62, "overview")).toBe("logic");
    expect(blueprintDetailLevelForZoom(1.18, "logic")).toBe("logic");
    expect(blueprintDetailLevelForZoom(1.22, "logic")).toBe("evidence");
    expect(blueprintDetailLevelForZoom(1.1, "evidence")).toBe("evidence");
  });

  it("crossfades semantic detail continuously between named levels", () => {
    expect(blueprintSemanticZoomProgress(BLUEPRINT_SEMANTIC_ZOOM.logicFadeStart)).toEqual({
      overview: 1,
      logic: 0,
      evidence: 0,
    });
    const betweenOverviewAndLogic = blueprintSemanticZoomProgress(0.55);
    expect(betweenOverviewAndLogic.logic).toBeGreaterThan(0);
    expect(betweenOverviewAndLogic.logic).toBeLessThan(1);
    expect(betweenOverviewAndLogic.overview).toBeCloseTo(1 - betweenOverviewAndLogic.logic);
    expect(blueprintSemanticZoomProgress(BLUEPRINT_SEMANTIC_ZOOM.logicFadeEnd).logic).toBe(1);
    expect(blueprintSemanticZoomProgress(BLUEPRINT_SEMANTIC_ZOOM.evidenceFadeStart).evidence).toBe(0);
    expect(blueprintSemanticZoomProgress(BLUEPRINT_SEMANTIC_ZOOM.evidenceFadeEnd).evidence).toBe(1);
  });

  it("measures a padded frame around positioned logic nodes", () => {
    expect(measureBlueprintBounds([
      { position: { x: 100, y: 50 } },
      { position: { x: 400, y: 100 } },
    ], 20)).toEqual({ x: 80, y: 30, width: 530, height: 244 });
    expect(measureBlueprintBounds([])).toBeUndefined();
  });

  it("keeps circuit colors deterministic across playback states", () => {
    expect(blueprintEdgeAppearance("global")).toMatchObject({ color: "#1689cf", animated: false });
    expect(blueprintEdgeAppearance("global", true)).toMatchObject({ color: "#626a73", dash: "6 7" });
    expect(blueprintEdgeAppearance("current")).toMatchObject({ color: "#147fc1", animated: true });
    expect(blueprintEdgeAppearance("warning")).toMatchObject({ color: "#d99a24", opacity: 1 });
    expect(blueprintEdgeAppearance("error")).toMatchObject({ color: "#e5484d", width: 3 });
  });

  it("builds localized runtime, workflow, and service boundaries", () => {
    const types: Record<string, LogicNodeType> = {
      entry: "entrypoint",
      agent: "ai_process",
      process: "process",
      data: "data",
      external: "external_system",
      user: "user_action",
    };
    const nodes = Object.keys(types).map((id, index) => ({
      id,
      type: "logic",
      position: { x: index * 220, y: index % 2 ? 180 : 0 },
      data: {
        label: id,
        description: id,
        nodeType: types[id],
        typeLabel: types[id],
        confidence: 1,
        sourceText: "1 source",
      },
    })) satisfies Node<BlueprintLogicNodeData>[];
    const graph = {
      nodes: Object.entries(types).map(([id, type]) => ({ id, type })),
    } as unknown as LogicGraph;

    const groups = buildBlueprintGroupNodes(nodes, graph, undefined, { runtime: "智能体运行时", workflows: "AGENT 工作流", systems: "数据与外部服务", nodeCount: (count) => `${count} 个节点` });

    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.data.label)).toEqual([
      "智能体运行时",
      "AGENT 工作流",
      "数据与外部服务",
    ]);
    expect(groups[1]?.data.dashed).toBe(true);
    expect(groups.every((group) => group.selectable === false)).toBe(true);
  });
});
