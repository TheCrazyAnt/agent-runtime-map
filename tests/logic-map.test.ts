import { describe, expect, it } from "vitest";
import type { FeatureScenario, LogicEdge, LogicGraph } from "@agent-runtime-map/schema";
import {
  buildSimulationFrame,
  edgeState,
  nodeStateClass,
  toFlowEdge,
  toFlowNode,
} from "@agent-runtime-map/react";

const logicNode = {
  id: "logic_a",
  type: "ai_process",
  label: "Generate Ideas",
  description: "An AI workflow performs generate ideas.",
  sources: [{ file: "src/agents/idea.ts", startLine: 4, symbol: "generateIdeasAgent" }],
  confidence: 0.84,
  inference: { method: "heuristic", explanation: "Agent naming convention" },
  rawNodeIds: ["agent_1"],
} as unknown as LogicGraph["nodes"][number];

const variant = {
  id: "v1",
  nodeIds: ["logic_a", "logic_b"],
  edgeIds: ["e1"],
  steps: [
    { nodeIds: ["logic_a"], incomingEdgeIds: [] },
    { nodeIds: ["logic_b"], incomingEdgeIds: ["e1"] },
  ],
} as unknown as FeatureScenario["variants"][number];

const feature = { id: "f1", diagnostics: [], variants: [variant] } as unknown as FeatureScenario;

describe("embeddable logic map", () => {
  it("keeps a node addressable by its compiled identity and evidence", () => {
    const node = toFlowNode(logicNode);

    expect(node.id).toBe("logic_a");
    expect(node.type).toBe("logic");
    expect(node.data.label).toBe("Generate Ideas");
    // An embedded map must still say where a conclusion came from, or it is a poster.
    expect(node.data.sourceDetail).toBe("src/agents/idea.ts:4 · generateIdeasAgent");
    expect(node.data.sourceText).toBe("1 source");
    expect(node.data.confidence).toBe(0.84);
  });

  it("shows the whole system when no route is framed", () => {
    const edge = { id: "e1", source: "logic_a", target: "logic_b", type: "flow" } as LogicEdge;

    expect(edgeState(edge, buildSimulationFrame(undefined, undefined, -1), undefined)).toBe("global");
    expect(nodeStateClass("logic_a", buildSimulationFrame(undefined, undefined, -1), undefined)).toBe("");
  });

  it("separates the framed route from everything around it", () => {
    const frame = buildSimulationFrame(feature, variant, -1);
    const onPath = { id: "e1", source: "logic_a", target: "logic_b", type: "flow" } as LogicEdge;
    const elsewhere = { id: "e9", source: "logic_x", target: "logic_y", type: "flow" } as LogicEdge;

    expect(edgeState(onPath, frame, variant)).toBe("path");
    expect(edgeState(elsewhere, frame, variant)).toBe("outside");
    expect(nodeStateClass("logic_a", frame, variant)).toBe("is-path-pending");
    expect(nodeStateClass("logic_x", frame, variant)).toBe("is-outside-path");
  });

  it("advances the static route without claiming a live run", () => {
    const frame = buildSimulationFrame(feature, variant, 1);

    expect(nodeStateClass("logic_a", frame, variant)).toBe("is-chain-complete");
    expect(nodeStateClass("logic_b", frame, variant)).toBe("is-current");
    const current = toFlowEdge({ id: "e1", source: "logic_a", target: "logic_b", type: "flow" } as LogicEdge, edgeState({ id: "e1" } as LogicEdge, frame, variant));
    // Exactly one moving token, on the current edge only.
    expect(current.data?.showToken).toBe(true);
    expect(toFlowEdge({ id: "e9" } as LogicEdge, "path").data?.showToken).toBe(false);
  });

  it("renders a data flow differently from a control flow", () => {
    const control = toFlowEdge({ id: "e1", type: "flow" } as LogicEdge, "path");
    const data = toFlowEdge({ id: "e2", type: "data_flow" } as LogicEdge, "path");

    expect(control.style?.strokeDasharray).toBeUndefined();
    expect(data.style?.strokeDasharray).toBeDefined();
  });
});
