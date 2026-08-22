import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import {
  blueprintEdgeAppearance,
  measureBlueprintBounds,
  type BlueprintLogicNodeData,
} from "@agent-runtime-map/react";
import type { LogicGraph, LogicNodeType } from "@agent-runtime-map/schema";
import { buildBlueprintGroupNodes } from "../apps/viewer/src/blueprintGroups.js";

describe("blueprint visual primitives", () => {
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

    const groups = buildBlueprintGroupNodes(nodes, graph, undefined, "zh-CN");

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
