import { describe, expect, it } from "vitest";
import {
  blueprintControlAppearance,
  buildOverviewModel,
  shouldShowEdgeLabel,
} from "@agent-runtime-map/react";
import type { LogicEdge, LogicGraph, LogicNode } from "@agent-runtime-map/schema";

/**
 * The Overview level is a projection, and these tests hold it to that: every
 * aggregate names the real nodes behind it, every bus names the real edges it
 * merges, and nothing appears that the graph did not already contain.
 */

function node(id: string, type: LogicNode["type"], label = id): LogicNode {
  return {
    id, type, label, description: label,
    sources: [{ file: "src/x.ts", startLine: 1 }],
    confidence: 0.9,
    inference: { method: "deterministic", explanation: "test" },
    rawNodeIds: [`raw_${id}`],
  };
}

function edge(id: string, source: string, target: string, control?: LogicEdge["control"], type: LogicEdge["type"] = "flow"): LogicEdge {
  return { id, source, target, type, control, confidence: 0.9, rawEdgeIds: [`rawedge_${id}`] };
}

/** Two features that share one agent, with a retry and a conditional branch. */
function fixture(): LogicGraph {
  const nodes = [
    node("route_a", "entrypoint", "POST /a"),
    node("route_b", "entrypoint", "POST /b"),
    node("step_a1", "process", "Handle A"),
    node("step_a2", "workflow", "Refund"),
    node("gate", "human_gate", "Approve"),
    node("shared_agent", "ai_process", "Triage"),
    node("tool_a", "tool", "Search"),
    node("db", "data", "Tickets"),
    node("api", "external_system", "stripe.com"),
    node("result_a", "result", "Done"),
  ];
  const edges = [
    edge("e1", "route_a", "step_a1"),
    edge("e2", "step_a1", "shared_agent"),
    edge("e3", "step_a1", "step_a2", "conditional"),
    edge("e4", "step_a2", "gate", "human_approval"),
    edge("e5", "step_a2", "api", "retry"),
    edge("e6", "step_a1", "db", undefined, "data_flow"),
    edge("e7", "step_a1", "result_a"),
    edge("e8", "route_b", "shared_agent"),
    edge("e9", "route_b", "tool_a"),
  ];
  return {
    schemaVersion: "0.1.0", generatedAt: "2026-01-01T00:00:00.000Z", graphType: "runtime_logic",
    title: "t", description: "d",
    project: { name: "p", root: "/p", languages: ["typescript"], frameworks: [], filesScanned: 1 },
    nodes, edges,
    features: [
      {
        id: "f_a", label: "Feature A", description: "",
        entryNodeIds: ["route_a"], resultNodeIds: ["result_a"],
        nodeIds: ["route_a", "step_a1", "step_a2", "gate", "shared_agent", "db", "api", "result_a"],
        edgeIds: ["e1", "e2", "e3", "e4", "e5", "e6", "e7"],
        variants: [{
          id: "v_a1", label: "main", description: "", nodeIds: ["route_a", "step_a1", "result_a"],
          edgeIds: ["e1", "e7"], steps: [
            { order: 0, nodeIds: ["route_a"], incomingEdgeIds: [] },
            { order: 1, nodeIds: ["step_a1"], incomingEdgeIds: ["e1"] },
            { order: 2, nodeIds: ["result_a"], incomingEdgeIds: ["e7"] },
          ], resultNodeId: "result_a", confidence: 0.9,
        }],
        diagnostics: [], health: "healthy", confidence: 0.9,
      },
      {
        id: "f_b", label: "Feature B", description: "",
        entryNodeIds: ["route_b"], resultNodeIds: [],
        nodeIds: ["route_b", "shared_agent", "tool_a"], edgeIds: ["e8", "e9"],
        variants: [{
          id: "v_b1", label: "main", description: "", nodeIds: ["route_b", "shared_agent"],
          edgeIds: ["e8"], steps: [
            { order: 0, nodeIds: ["route_b"], incomingEdgeIds: [] },
            { order: 1, nodeIds: ["shared_agent"], incomingEdgeIds: ["e8"] },
          ], confidence: 0.9,
        }],
        diagnostics: [], health: "healthy", confidence: 0.9,
      },
    ],
    diagnostics: [],
  };
}

describe("Overview: the whole-system level of detail", () => {
  const graph = fixture();
  const model = buildOverviewModel(graph);

  it("is smaller than the raw graph but accounts for every node exactly once", () => {
    expect(model.nodes.length).toBeLessThan(graph.nodes.length);
    const covered = model.nodes.flatMap((item) => item.memberIds);
    expect(covered.slice().sort()).toEqual(graph.nodes.map((item) => item.id).sort());
    expect(new Set(covered).size).toBe(covered.length);
  });

  it("keeps entries and results individually visible", () => {
    const entries = model.nodes.filter((item) => item.role === "entry");
    expect(entries.map((item) => item.label).sort()).toEqual(["POST /a", "POST /b"]);
    expect(model.nodes.find((item) => item.role === "result")?.label).toBe("Done");
  });

  it("aggregates a node two features share exactly once, not once per feature", () => {
    const holders = model.nodes.filter((item) => item.memberIds.includes("shared_agent"));
    expect(holders).toHaveLength(1);
    expect(holders[0]!.featureId).toBeUndefined();
  });

  it("invents no edge: every bus names real graph edges, and every graph edge is represented or internal", () => {
    const realIds = new Set(graph.edges.map((item) => item.id));
    const busIds = model.edges.flatMap((item) => item.edgeIds);
    for (const id of busIds) expect(realIds.has(id)).toBe(true);
    expect(new Set(busIds).size).toBe(busIds.length);

    const bucketOf = new Map<string, string>();
    for (const item of model.nodes) for (const member of item.memberIds) bucketOf.set(member, item.id);
    for (const item of graph.edges) {
      const internal = bucketOf.get(item.source) === bucketOf.get(item.target);
      expect(internal || busIds.includes(item.id)).toBe(true);
    }
  });

  it("surfaces the control kind a reader most needs when a bus merges several", () => {
    const withRetry = model.edges.find((item) => item.edgeIds.includes("e5"));
    // The bus carrying a retry must not present itself as a plain sequential call.
    expect(withRetry?.control).toBe("retry");
  });

  it("states how much each aggregate stands for", () => {
    for (const item of model.nodes) {
      expect(item.memberIds.length).toBeGreaterThan(0);
      expect(item.routeCount).toBeGreaterThanOrEqual(0);
    }
    const aggregate = model.nodes.find((item) => item.memberIds.length > 1);
    expect(aggregate?.routeCount).toBeGreaterThan(0);
  });

  it("uses the caller's language for bucket names", () => {
    const zh = buildOverviewModel(graph, { capability: "智能体与工具", io: "数据与外部服务", stage: "处理步骤", shared: "共用" });
    expect(zh.nodes.some((item) => item.label.includes("智能体") || item.label.includes("处理步骤") || item.label.includes("数据"))).toBe(true);
  });
});

describe("Feature: one chain at a time", () => {
  const graph = fixture();

  it("names exactly the nodes and edges of the selected route, leaving the rest to be dimmed", () => {
    const feature = graph.features[0]!;
    // Everything on the feature is nameable; everything else stays in the graph
    // rather than being deleted, which is what lets the Viewer dim it.
    expect(feature.nodeIds).toContain("step_a2");
    expect(feature.nodeIds).not.toContain("tool_a");
    const outside = graph.nodes.filter((item) => !feature.nodeIds.includes(item.id));
    expect(outside.map((item) => item.id)).toEqual(["route_b", "tool_a"]);
  });

  it("keeps each branch a separate ordered route rather than one merged blur", () => {
    for (const feature of graph.features) {
      for (const variant of feature.variants) {
        const orders = variant.steps.map((step) => step.order);
        expect(orders).toEqual([...orders].sort((a, b) => a - b));
      }
    }
  });
});

describe("Line rules", () => {
  it("gives every control kind a distinct, learnable appearance", () => {
    const kinds = ["sequential", "conditional", "retry", "loop", "fallback", "human_approval", "parallel"] as const;
    const signatures = kinds.map((kind) => {
      const item = blueprintControlAppearance(kind);
      return `${item.dash ?? "solid"}|${item.color ?? "state"}`;
    });
    expect(new Set(signatures).size).toBe(kinds.length);
    // Sequential is the plain case: solid, and coloured by simulation state.
    expect(blueprintControlAppearance("sequential").dash).toBeUndefined();
    expect(blueprintControlAppearance("conditional").dash).toBeDefined();
    // Retry and loop return leftward, so they must take the dedicated channel.
    expect(blueprintControlAppearance("retry").loopback).toBe(true);
    expect(blueprintControlAppearance("loop").loopback).toBe(true);
    expect(blueprintControlAppearance("conditional").loopback).toBe(false);
    // Retry, loop, fallback, and approval break colour so they cannot be missed.
    expect(blueprintControlAppearance("retry").color).toBeDefined();
    expect(blueprintControlAppearance("fallback").color).toBe("#e5484d");
  });

  it("shows an edge label only when the reader is asking about that edge", () => {
    expect(shouldShowEdgeLabel({})).toBe(false);
    expect(shouldShowEdgeLabel({ state: "path" })).toBe(false);
    expect(shouldShowEdgeLabel({ hovered: true })).toBe(true);
    expect(shouldShowEdgeLabel({ selected: true })).toBe(true);
    expect(shouldShowEdgeLabel({ playing: true, state: "current" })).toBe(true);
    // Playback does not label every edge — only the step being played.
    expect(shouldShowEdgeLabel({ playing: true, state: "path" })).toBe(false);
  });
});
