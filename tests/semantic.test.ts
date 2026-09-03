import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { LogicGraph, RawCodeGraph } from "@agent-runtime-map/schema";
import { SCHEMA_VERSION } from "@agent-runtime-map/schema";
import { analyzeTypeScriptProject } from "@agent-runtime-map/typescript";
import { compileLogicGraph } from "@agent-runtime-map/logic-compiler";
import { applySemanticPatch, enrichLogicGraphWithOpenAI, semanticSnapshot, type SemanticPatch } from "@agent-runtime-map/semantic";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../examples/simple-agent");

const raw: RawCodeGraph = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: "2026-01-01T00:00:00.000Z",
  project: { name: "agent", root: "/private/source", languages: ["typescript"], frameworks: ["OpenAI Agents SDK"], filesScanned: 2 },
  context: {
    description: "Creates reports.",
    scripts: [],
    dependencies: [],
    documents: [{ path: "README.md", kind: "readme", title: "Agent", summary: "Creates reports.", headings: [], excerpt: "Create a sourced report.", truncated: false }],
    prompts: [],
    configurationFiles: [],
    capabilityHints: [],
    diagnostics: [],
  },
  nodes: [],
  edges: [],
  diagnostics: [],
};

const graph: LogicGraph = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: raw.generatedAt,
  graphType: "runtime_logic",
  title: "agent runtime logic",
  description: "fixture",
  project: raw.project,
  understanding: {
    summary: "Creates reports.",
    capabilities: [],
    agentNodeIds: ["agent"],
    workflowNodeIds: [],
    toolNodeIds: [],
    modelNodeIds: [],
    documentsUsed: ["README.md"],
    confidence: 0.8,
  },
  nodes: [{
    id: "agent",
    type: "ai_process",
    label: "Research Agent",
    description: "Runs research.",
    sources: [{ file: "src/agent.ts", startLine: 3 }],
    confidence: 0.9,
    inference: { method: "heuristic", explanation: "Agent name" },
    rawNodeIds: ["raw_agent"],
  }],
  edges: [],
  features: [{
    id: "feature",
    label: "POST /api/report",
    description: "fixture",
    entryNodeIds: ["agent"],
    resultNodeIds: ["agent"],
    nodeIds: ["agent"],
    edgeIds: [],
    variants: [],
    diagnostics: [],
    health: "healthy",
    confidence: 0.9,
  }],
  diagnostics: [],
};

describe("optional semantic compiler", () => {
  it("builds a bounded evidence snapshot without the absolute project root", () => {
    const snapshot = semanticSnapshot(raw, graph);
    expect(JSON.stringify(snapshot)).not.toContain("/private/source");
    expect(snapshot).toMatchObject({ project: { name: "agent" }, nodes: [{ id: "agent" }] });
  });

  it("applies only existing IDs and never changes graph topology or evidence", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      expect(request.store).toBe(false);
      expect(request.text.format.type).toBe("json_schema");
      return new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
          summary: "Turns research into a sourced report.",
          confidence: 0.84,
          nodes: [
            { id: "agent", label: "Research sources", description: "Finds and verifies sources for the report.", confidence: 0.86, reason: "Code and README agree." },
            { id: "invented", label: "Invented", description: "Must be ignored.", confidence: 1, reason: "No evidence." },
          ],
          features: [{ id: "feature", label: "Generate sourced report", description: "Research and produce a cited report.", confidence: 0.85, reason: "Route and documentation agree." }],
        }) }] }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const enriched = await enrichLogicGraphWithOpenAI(raw, graph, {
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(enriched.nodes).toHaveLength(1);
    expect(enriched.nodes[0]).toMatchObject({ label: "Research sources", sources: graph.nodes[0].sources, inference: { method: "mixed" } });
    expect(enriched.edges).toEqual(graph.edges);
    // This fixture was compiled without a semantic slot, so the model's reading can
    // only land in the description; the label is hashed into the id and stays.
    expect(enriched.features[0]).toMatchObject({ label: "POST /api/report", description: "Research and produce a cited report.", confidence: 0.85 });
    expect(enriched.features[0]?.semantic).toBeUndefined();
    expect(enriched.diagnostics).toContainEqual(expect.objectContaining({ code: "SEMANTIC_ENRICHMENT_APPLIED" }));
  });
});

describe("feature semantics", () => {
  const patchFor = (id: string): SemanticPatch => ({
    summary: "Turns a brief into a story.",
    confidence: 0.9,
    nodes: [],
    features: [{ id, label: " Write a story ", description: " Turns a brief into a finished story. ", confidence: 0.7, reason: "README describes the flow." }],
  });

  async function compiledFixture(): Promise<LogicGraph> {
    return compileLogicGraph(await analyzeTypeScriptProject(fixture), { maxNodes: 40 });
  }

  it("fills a pending feature slot in both locales and leaves the hashed label alone", async () => {
    const compiled = await compiledFixture();
    const target = compiled.features.find((feature) => feature.semantic)!;
    // The fixture names every feature from evidence; marking one pending is the
    // only edit needed to reach the fill path, and it copies `evidence` untouched.
    const withPending: LogicGraph = {
      ...compiled,
      features: compiled.features.map((feature) => feature.id === target.id
        ? { ...feature, semantic: { ...feature.semantic!, pending: true } }
        : feature),
    };

    const enriched = applySemanticPatch(withPending, patchFor(target.id), "test-model");
    const feature = enriched.features.find((item) => item.id === target.id)!;

    expect(feature.label).toBe(target.label);
    expect(feature.description).toBe("Turns a brief into a finished story.");
    expect(feature.confidence).toBe(Math.min(target.confidence, 0.7));
    expect(feature.semantic).toEqual({
      ...target.semantic,
      label: { "zh-CN": "Write a story", en: "Write a story" },
      description: { "zh-CN": "Turns a brief into a finished story.", en: "Turns a brief into a finished story." },
      labelSource: { "zh-CN": "llm", en: "llm" },
      confidence: { "zh-CN": 0.7, en: 0.7 },
      pending: false,
    });
    const untouched = enriched.features.filter((item) => item.id !== target.id);
    expect(untouched).toEqual(compiled.features.filter((item) => item.id !== target.id));
  });

  it("never overwrites a feature name the compiler composed from evidence", async () => {
    const compiled = await compiledFixture();
    const target = compiled.features.find((feature) => feature.semantic?.pending === false)!;

    const enriched = applySemanticPatch(compiled, patchFor(target.id), "test-model");
    const feature = enriched.features.find((item) => item.id === target.id)!;

    expect(feature.semantic).toEqual(target.semantic);
    expect(feature.label).toBe(target.label);
    expect(feature.description).toBe(target.description);
    // The model's doubt still counts even when its name does not.
    expect(feature.confidence).toBe(Math.min(target.confidence, 0.7));
  });
});
