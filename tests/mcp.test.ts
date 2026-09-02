import { access, cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { generateLogicMap } from "@agent-runtime-map/core";
import type { LogicGraph } from "@agent-runtime-map/schema";
import {
  describeEvidence,
  describeFeature,
  findFeature,
  findNode,
  summarizeFeatures,
  summarizeProject,
} from "../packages/mcp/src/summaries.js";
import { TOOLS, callTool } from "../packages/mcp/src/server.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(repositoryRoot, "examples", "simple-agent");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function analyzedFixture(): Promise<LogicGraph> {
  const result = await generateLogicMap(fixture, { outputFile: false, rawOutputFile: false });
  return result.graph;
}

describe("MCP surface", () => {
  it("leaves nothing behind in a project it was asked to read", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-mcp-"));
    temporaryDirectories.push(root);
    await cp(fixture, root, { recursive: true });
    await rm(path.join(root, ".logic-map"), { recursive: true, force: true });

    const result = await generateLogicMap(root, { outputFile: false, rawOutputFile: false });

    // An agent analyzing someone else's repository must not litter it.
    expect(result.graph.nodes.length).toBeGreaterThan(5);
    expect(result.outputFile).toBeUndefined();
    await expect(access(path.join(root, ".logic-map", "graph.json"))).rejects.toThrow();
  });

  it("answers with an overview rather than the whole graph", async () => {
    const graph = await analyzedFixture();
    const overview = summarizeProject(graph, 40);

    expect(overview).toContain("Next.js");
    expect(overview).toContain("Features (4)");
    // Every feature carries its health, so a broken chain is not read as working.
    expect(overview).toContain("chain error");
    // An agent pays per token: the overview must not be the graph in disguise.
    expect(overview.length).toBeLessThan(JSON.stringify(graph).length / 8);
    // And it has to say where to look next, or the drill-down tools go unused.
    expect(overview).toContain("describe_feature");
  });

  it("walks a route with the confidence and source of every step", async () => {
    const graph = await analyzedFixture();
    const feature = findFeature(graph, "Draft Review");
    const described = describeFeature(graph, feature!);

    expect(described).toContain("POST /api/review");
    expect(described).toContain("app/api/review/route.ts:");
    expect(described).toMatch(/\d+%/);
    // The product's central promise: this is never presented as a recorded run.
    expect(described).toContain("statically inferred route, not a recorded run");
  });

  it("keeps what the code shows apart from what the project claims", async () => {
    const graph = await analyzedFixture();
    const evidence = describeEvidence(findNode(graph, "Score Draft")!);

    expect(evidence).toContain("Code confidence:");
    expect(evidence).toContain("app/src/agents/review.ts");
    expect(evidence).toContain("Product context:");
    // Two separate claims, never merged into one number.
    expect(evidence).toMatch(/Product context:[\s\S]*match \d+%/);
  });

  it("says so when nothing the project writes about itself matched a step", async () => {
    const graph = await analyzedFixture();
    const bare = graph.nodes.find((node) => !node.product);
    expect(bare).toBeDefined();
    expect(describeEvidence(bare!)).toContain("Read from code only");
  });

  it("finds a feature or a step by the name it showed the agent", async () => {
    const graph = await analyzedFixture();

    // An agent repeats the label it was given, not an opaque id.
    expect(findFeature(graph, "draft review")?.label).toBe("Draft Review");
    expect(findNode(graph, "Score Draft")?.label).toBe("Score Draft");
    expect(findNode(graph, findNode(graph, "Score Draft")!.id)?.label).toBe("Score Draft");
    expect(findFeature(graph, "nothing named this")).toBeUndefined();
  });

  it("lists features with the ids the other tools need", async () => {
    const graph = await analyzedFixture();
    const listed = summarizeFeatures(graph);

    for (const feature of graph.features) {
      expect(listed).toContain(feature.label);
      expect(listed).toContain(feature.id);
    }
  });
});

/**
 * The names and descriptions an agent relays must be the ones the Viewer shows,
 * in the language of the person it is talking to. The graph here is the real
 * compiler's output for the fixture, so these tests hold the MCP answers to the
 * same labels a reader sees — not to a hand-written imitation of them.
 */
describe("MCP locale", () => {
  it("describes a feature in Chinese with the Viewer's names and descriptions", async () => {
    const graph = await analyzedFixture();
    const feature = findFeature(graph, "Draft Review")!;
    const scoreDraft = findNode(graph, "Score Draft")!;
    const described = describeFeature(graph, feature, undefined, "zh-CN");

    expect(described).toContain(feature.semantic!.label["zh-CN"]);
    expect(described).toContain(feature.semantic!.description["zh-CN"]);
    expect(described).toContain(scoreDraft.semantic!.label["zh-CN"]);
    expect(described).toContain(scoreDraft.semantic!.description["zh-CN"]);
    // The business reading replaces the technical description; it is not added beside it.
    expect(described).not.toContain(feature.description);
    expect(described).not.toContain(scoreDraft.description);
    // The technical name stays beside the business one, so a lookup by either works.
    expect(described).toContain(`(${feature.semantic!.technicalName})`);
  });

  it("defaults to English, pairing the English label with the English description", async () => {
    const graph = await analyzedFixture();
    const feature = findFeature(graph, "Draft Review")!;
    const scoreDraft = findNode(graph, "Score Draft")!;
    const described = describeFeature(graph, feature);

    expect(described).toContain(feature.semantic!.label.en);
    expect(described).toContain(feature.semantic!.description.en);
    expect(described).toContain(scoreDraft.semantic!.description.en);
    // A business label next to a technical description was the defect: neither raw text may leak.
    expect(described).not.toContain(feature.description);
    expect(described).not.toContain(scoreDraft.description);
    expect(described).toBe(describeFeature(graph, feature, undefined, "en"));
  });

  it("gives evidence in the requested language", async () => {
    const graph = await analyzedFixture();
    const node = findNode(graph, "Score Draft")!;

    const chinese = describeEvidence(node, "zh-CN");
    expect(chinese).toContain(node.semantic!.label["zh-CN"]);
    expect(chinese).toContain(node.semantic!.description["zh-CN"]);
    expect(chinese).not.toContain(node.description);

    const english = describeEvidence(node);
    expect(english).toContain(node.semantic!.label.en);
    expect(english).toContain(node.semantic!.description.en);
    expect(english).not.toContain(node.description);
    // Code evidence is never translated: the path is the path.
    expect(chinese).toContain("app/src/agents/review.ts");
  });

  it("marks a name the compiler could not confirm instead of hiding it", async () => {
    const graph = await analyzedFixture();
    const pending = graph.nodes.find((node) => node.semantic?.pending);
    const confirmed = findNode(graph, "Score Draft")!;
    expect(pending).toBeDefined();
    expect(confirmed.semantic!.pending).toBe(false);

    expect(describeEvidence(pending!)).toContain("[name unconfirmed]");
    expect(describeEvidence(pending!, "zh-CN")).toContain("[名称待确认]");
    expect(describeEvidence(confirmed)).not.toContain("[name unconfirmed]");
    expect(describeEvidence(confirmed, "zh-CN")).not.toContain("[名称待确认]");

    // The marker travels into the route too, beside the step it belongs to.
    const feature = graph.features.find((item) => item.nodeIds.includes(pending!.id));
    expect(feature).toBeDefined();
    expect(describeFeature(graph, feature!)).toContain(`${pending!.semantic!.label.en} (${pending!.semantic!.technicalName}) [name unconfirmed]`);
  });

  it("offers the same locale choice on every tool", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(names).toEqual(["analyze_project", "list_features", "describe_feature", "get_evidence"]);
    for (const tool of TOOLS) {
      const locale = (tool.inputSchema.properties as unknown as Record<string, { type: string; enum?: string[] }>).locale;
      expect(locale?.type).toBe("string");
      expect(locale?.enum).toEqual(["zh-CN", "en"]);
    }
  });

  it("refuses an unknown locale rather than answering in the wrong language", async () => {
    const result = await callTool("list_features", { locale: "fr" });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("zh-CN");
    expect(result.content[0]!.text).toContain("en");
  });

  it("answers a Chinese session with Chinese names, and finds a name from either language", async () => {
    const overview = await callTool("analyze_project", { path: fixture, locale: "zh-CN" });
    expect(overview.isError).toBeUndefined();
    const graph = await analyzedFixture();
    const feature = findFeature(graph, "Draft Review")!;
    expect(overview.content[0]!.text).toContain(feature.semantic!.label["zh-CN"]);

    // A Chinese reader copies the Chinese name; an English session still resolves it.
    const english = await callTool("describe_feature", { path: fixture, feature: feature.semantic!.label["zh-CN"], locale: "en" });
    expect(english.isError).toBeUndefined();
    expect(english.content[0]!.text).toContain(feature.semantic!.label.en);
    expect(english.content[0]!.text).toContain(feature.semantic!.description.en);

    // And the other way round, with the CLI's spelling of the tag accepted too.
    const chinese = await callTool("get_evidence", { path: fixture, node: "Score Draft", locale: "zh-cn" });
    expect(chinese.isError).toBeUndefined();
    expect(chinese.content[0]!.text).toContain(findNode(graph, "Score Draft")!.semantic!.description["zh-CN"]);
  });
});
