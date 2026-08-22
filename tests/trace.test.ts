import { describe, expect, it } from "vitest";
import type { LogicGraph, TraceEvent } from "@agent-runtime-map/schema";
import { applyTraceEvents, traceStateClass } from "@agent-runtime-map/react";

const graph = {
  nodes: [
    { id: "logic_a", rawNodeIds: ["agent_1", "fn_1"] },
    { id: "logic_b", rawNodeIds: ["agent_2"] },
    { id: "logic_c", rawNodeIds: [] },
  ],
  edges: [{ id: "edge_ab", source: "logic_a", target: "logic_b" }],
} as unknown as LogicGraph;

describe("trace bridge", () => {
  it("lights up ids the graph already has, by node and by edge", () => {
    const overlay = applyTraceEvents(graph, [
      { target: "logic_a", kind: "completed", durationMs: 120 },
      { target: "edge_ab", kind: "completed" },
    ]);

    expect(overlay.nodes.logic_a?.state).toBe("completed");
    expect(overlay.nodes.logic_a?.matchedVia).toBe("logic_node");
    expect(overlay.edges.edge_ab?.matchedVia).toBe("logic_edge");
    // The edge is not also recorded as a node.
    expect(overlay.nodes.edge_ab).toBeUndefined();
  });

  it("lifts a raw symbol to the step that contains it", () => {
    // A runtime reports the function it executed, not the compressed step shown on
    // the map, so the bridge has to meet it where it is.
    const overlay = applyTraceEvents(graph, [{ target: "fn_1", kind: "started" }]);

    expect(overlay.nodes.logic_a?.state).toBe("started");
    expect(overlay.nodes.logic_a?.matchedVia).toBe("raw_node");
  });

  it("reports what it could not place instead of inventing a node for it", () => {
    const events: TraceEvent[] = [
      { target: "span_from_somewhere_else", kind: "completed" },
      { target: "logic_b", kind: "completed" },
    ];
    const overlay = applyTraceEvents(graph, events);

    expect(overlay.unmatched).toHaveLength(1);
    expect(overlay.unmatched[0]?.target).toBe("span_from_somewhere_else");
    // The graph gained nothing: only ids that were already in it appear.
    expect(Object.keys(overlay.nodes)).toEqual(["logic_b"]);
  });

  it("does not let a later event erase a failure", () => {
    const overlay = applyTraceEvents(graph, [
      { target: "logic_a", kind: "started" },
      { target: "logic_a", kind: "failed", detail: "timeout" },
      { target: "logic_a", kind: "completed" },
    ]);

    // A retry elsewhere does not mean this step stopped failing here.
    expect(overlay.nodes.logic_a?.state).toBe("failed");
    expect(overlay.nodes.logic_a?.events).toBe(3);
    expect(overlay.nodes.logic_a?.lastDetail).toBe("timeout");
  });

  it("accumulates duration and reports how much of the map a run touched", () => {
    const overlay = applyTraceEvents(graph, [
      { target: "logic_a", kind: "completed", durationMs: 40 },
      { target: "logic_a", kind: "completed", durationMs: 60 },
    ]);

    expect(overlay.nodes.logic_a?.totalDurationMs).toBe(100);
    // One of three steps was observed; the other two are not claimed as anything.
    expect(overlay.coverage).toBeCloseTo(1 / 3);
  });

  it("keeps observation visually separate from the inferred route", () => {
    const overlay = applyTraceEvents(graph, [{ target: "logic_a", kind: "failed" }]);
    const observed = traceStateClass(overlay.nodes.logic_a);

    expect(observed).toBe("is-observed is-observed-failed");
    // Nothing here reuses the static simulation's class names.
    expect(observed).not.toContain("is-chain");
    expect(traceStateClass(undefined)).toBe("");
  });
});
