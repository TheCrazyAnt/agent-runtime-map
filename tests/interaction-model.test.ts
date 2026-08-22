import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import type { BlueprintLogicNodeData } from "@agent-runtime-map/react";
import type { FeaturePathVariant, LogicNode, RawCodeGraph } from "@agent-runtime-map/schema";
import {
  MAX_DETAIL_DEPTH,
  applyLayoutPositions,
  buildCodeDetailExpansion,
  captureLayout,
  compareVariants,
  parseDetailNodeId,
  parseLayoutPositions,
} from "../apps/viewer/src/interactionModel.js";

describe("viewer interaction model", () => {
  it("expands a logic node into evidence-backed raw code nodes", () => {
    const rawGraph = {
      nodes: [
        { id: "agent", kind: "agent", name: "ideaAgent", evidence: [{ source: { file: "src/agent.ts", startLine: 8 } }] },
        { id: "tool", kind: "tool", name: "searchTool", evidence: [{ source: { file: "src/tool.ts", startLine: 3 } }] },
      ],
      edges: [{ id: "call", source: "agent", target: "tool", kind: "calls" }],
    } as unknown as RawCodeGraph;
    const logicNode = { id: "generate", rawNodeIds: ["agent"] } as LogicNode;
    const parent = { id: "generate", position: { x: 200, y: 100 }, data: {} } as Node<BlueprintLogicNodeData>;

    const expansion = buildCodeDetailExpansion(logicNode, parent, rawGraph);

    expect(expansion.nodes.map((node) => node.data.label)).toEqual(["ideaAgent", "searchTool"]);
    expect(expansion.nodes[0]?.data.source).toBe("src/agent.ts:8");
    expect(expansion.edges.some((edge) => edge.source.includes("agent") && edge.target.includes("tool"))).toBe(true);
    // Regression: detail nodes are not in the Viewer's node state, so React Flow's
    // measurement change for them is filtered out and never applied. Without stated
    // dimensions every expanded child stayed at `visibility: hidden` forever.
    expect(expansion.nodes.every((node) => node.width === 176 && node.height === 88)).toBe(true);
  });

  it("opens one further level only from a child the reader chose, and stops there", () => {
    // agent → tool → http → vendor: a chain deep enough that an unbounded drill-down
    // would pull the whole thing under one logic node.
    const rawGraph = {
      nodes: [
        { id: "agent", kind: "agent", name: "ideaAgent", evidence: [{ source: { file: "src/agent.ts", startLine: 8 } }] },
        { id: "tool", kind: "tool", name: "searchTool", evidence: [{ source: { file: "src/tool.ts", startLine: 3 } }] },
        { id: "http", kind: "function", name: "httpFetch", evidence: [{ source: { file: "src/http.ts", startLine: 5 } }] },
        { id: "vendor", kind: "external_api", name: "vendorApi", evidence: [{ source: { file: "src/http.ts", startLine: 9 } }] },
      ],
      edges: [
        { id: "e1", source: "agent", target: "tool", kind: "calls" },
        { id: "e2", source: "tool", target: "http", kind: "calls" },
        { id: "e3", source: "http", target: "vendor", kind: "requests" },
      ],
    } as unknown as RawCodeGraph;
    const logicNode = { id: "generate", rawNodeIds: ["agent"] } as LogicNode;
    const parent = { id: "generate", position: { x: 0, y: 0 }, data: {} } as Node<BlueprintLogicNodeData>;

    const collapsed = buildCodeDetailExpansion(logicNode, parent, rawGraph);
    expect(collapsed.nodes.map((node) => node.data.label)).toEqual(["ideaAgent", "searchTool"]);
    expect(collapsed.nodes.every((node) => node.data.depth === 1)).toBe(true);

    const opened = buildCodeDetailExpansion(logicNode, parent, rawGraph, { expandedRawIds: new Set(["tool"]) });
    const byLabel = new Map(opened.nodes.map((node) => [node.data.label, node.data]));
    expect(byLabel.get("httpFetch")?.depth).toBe(2);
    // The chain continues past httpFetch, but a third level is never built.
    expect(byLabel.has("vendorApi")).toBe(false);
    expect(byLabel.get("httpFetch")?.expandable).toBe(false);
    expect(byLabel.get("searchTool")?.expanded).toBe(true);
    expect(MAX_DETAIL_DEPTH).toBe(2);

    // A child that is not on screen cannot grow an expansion.
    const hidden = buildCodeDetailExpansion(logicNode, parent, rawGraph, { expandedRawIds: new Set(["http"]) });
    expect(hidden.nodes.map((node) => node.data.label)).toEqual(["ideaAgent", "searchTool"]);
  });

  it("splits a detail node id back into the step and the raw child it belongs to", () => {
    expect(parseDetailNodeId("detail:logic_a:agent_b")).toEqual({ logicId: "logic_a", rawId: "agent_b" });
    // Raw ids are free to contain colons; only the first two segments are structural.
    expect(parseDetailNodeId("detail:logic_a:model:gpt-5")).toEqual({ logicId: "logic_a", rawId: "model:gpt-5" });
    expect(parseDetailNodeId("logic_a")).toBeUndefined();
  });

  it("keeps shared branches stable while identifying entering and exiting paths", () => {
    const previous = { nodeIds: ["entry", "agent", "fallback"], edgeIds: ["a", "b"] } as FeaturePathVariant;
    const current = { nodeIds: ["entry", "agent", "success"], edgeIds: ["a", "c"] } as FeaturePathVariant;
    const transition = compareVariants(previous, current);
    expect([...transition.sharedNodeIds]).toEqual(["entry", "agent"]);
    expect([...transition.exitingNodeIds]).toEqual(["fallback"]);
    expect([...transition.enteringNodeIds]).toEqual(["success"]);
    expect([...transition.sharedEdgeIds]).toEqual(["a"]);
  });

  it("round-trips valid layout positions and ignores malformed values", () => {
    const nodes = [{ id: "a", position: { x: 12, y: 34 } }] as Node[];
    const snapshot = captureLayout(nodes);
    expect(applyLayoutPositions(nodes, snapshot)[0]?.position).toEqual({ x: 12, y: 34 });
    expect(parseLayoutPositions(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(parseLayoutPositions("not-json")).toBeUndefined();
  });
});
