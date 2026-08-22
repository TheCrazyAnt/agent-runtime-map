import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import type { BlueprintLogicNodeData } from "@agent-runtime-map/react";
import type { FeaturePathVariant, LogicNode, RawCodeGraph } from "@agent-runtime-map/schema";
import {
  applyLayoutPositions,
  buildCodeDetailExpansion,
  captureLayout,
  compareVariants,
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
