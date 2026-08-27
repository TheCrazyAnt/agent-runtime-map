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
