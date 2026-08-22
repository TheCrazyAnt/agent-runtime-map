import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readProjectContext } from "@agent-runtime-map/project-reader";
import { generateLogicMap } from "@agent-runtime-map/core";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("project reader", () => {
  it("reads product documents, prompts, dependencies, and safe capability overrides", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-map-context-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "docs"));
    await mkdir(path.join(root, "prompts"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "context-fixture",
      description: "An Agent that researches and writes reports.",
      scripts: { dev: "tsx src.ts", test: "vitest" },
      dependencies: { "@openai/agents": "1.0.0" },
    }));
    await writeFile(path.join(root, "README.md"), "# Research Agent\n\n## Report Generation\n\nResearch a topic and write a sourced report.\n");
    await writeFile(path.join(root, "docs", "PRD.md"), "# Product requirements\n\n## Human Approval\n\nAn editor approves the final report.\n");
    await writeFile(path.join(root, "prompts", "research.md"), "# Research prompt\n\nInvestigate {{topic}} for ${audience}.\n");
    await writeFile(path.join(root, ".env"), "OPENAI_API_KEY=must-not-be-read\n");
    await writeFile(path.join(root, "docs", "secrets.md"), "# Secret\n\nmust-not-be-read-either\n");
    await writeFile(path.join(root, "agent-runtime-map.config.json"), JSON.stringify({
      description: "Configured product description.",
      features: { report: { label: "Generate Report", description: "Create a sourced report.", keywords: ["research", "write"] } },
    }));

    const context = await readProjectContext(root);

    expect(context.description).toBe("Configured product description.");
    expect(context.dependencies).toContainEqual({ name: "@openai/agents", version: "1.0.0", category: "runtime" });
    expect(context.scripts).toEqual(["dev", "test"]);
    expect(context.documents.map((document) => document.path)).toEqual(expect.arrayContaining(["README.md", "docs/PRD.md", "prompts/research.md"]));
    expect(context.prompts[0]).toMatchObject({ path: "prompts/research.md", variables: ["topic", "audience"] });
    expect(context.capabilityHints.map((capability) => capability.label)).toEqual(expect.arrayContaining(["Report Generation", "Human Approval", "Generate Report"]));
    expect(JSON.stringify(context)).not.toContain("must-not-be-read");
  });

  it("sanitizes malformed optional configuration instead of aborting analysis", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-map-invalid-context-"));
    temporaryDirectories.push(root);
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "invalid-context" }));
    await writeFile(path.join(root, "agent-runtime-map.config.json"), JSON.stringify({
      description: 42,
      features: {
        broken: { label: 42, description: ["not", "text"], keywords: "not-an-array" },
        usable: { label: "Safe Feature", keywords: ["safe", 42, "agent"] },
      },
    }));

    const context = await readProjectContext(root);

    expect(context.description).toBeUndefined();
    expect(context.capabilityHints.map((capability) => capability.label)).toEqual(["Safe Feature"]);
  });

  it("feeds project understanding and documented feature names into the generated graph", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-map-understanding-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "app", "api", "research"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "research-agent", dependencies: { next: "latest" } }));
    await writeFile(path.join(root, "README.md"), "# Research Agent\n\n## Sourced Research\n\nResearch a question and return a cited answer.\n");
    await writeFile(path.join(root, "agent-runtime-map.config.json"), JSON.stringify({
      features: { research: { label: "Sourced Research", description: "Research a question and return a cited answer.", keywords: ["research"] } },
    }));
    await writeFile(path.join(root, "app", "api", "research", "route.ts"), [
      "async function researchAgent(question: string) { return { answer: question }; }",
      "export async function POST() { return researchAgent('question'); }",
      "",
    ].join("\n"));

    const result = await generateLogicMap(root, { rawOutputFile: false });

    expect(result.rawGraph.context?.documents.map((document) => document.path)).toContain("README.md");
    expect(result.graph.understanding).toMatchObject({ summary: expect.any(String), confidence: 1 });
    expect(result.graph.understanding?.capabilities.map((capability) => capability.label)).toContain("Sourced Research");
    expect(result.graph.features[0]?.label).toBe("Sourced Research");
  });
});
