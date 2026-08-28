import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeBuildId, generateLogicMap, type GenerateLogicMapResult } from "@agent-runtime-map/core";
// @ts-expect-error plain-JS benchmark tooling carries no type declarations.
import { evaluateExpectations } from "../benchmarks/evaluate.mjs";

const PROJECTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../benchmarks/projects");

/**
 * The accuracy benchmark:每个样本的 expected.json 是人工确认的正确答案 —— which
 * nodes and edges the code proves, which the map must not invent, and which
 * relations are honestly unresolved. The analyzer changes; these stay put.
 */
const analyses = new Map<string, Promise<GenerateLogicMapResult>>();

function analyze(project: string): Promise<GenerateLogicMapResult> {
  let pending = analyses.get(project);
  if (!pending) {
    pending = generateLogicMap(path.join(PROJECTS_DIR, project), { outputFile: false, rawOutputFile: false });
    analyses.set(project, pending);
  }
  return pending;
}

describe("map accuracy benchmark", async () => {
  const projects = (await readdir(PROJECTS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  it("covers every sample with an expectation file", () => {
    expect(projects.length).toBeGreaterThanOrEqual(3);
  });

  for (const project of projects) {
    it(`matches the hand-confirmed graph for ${project}`, { timeout: 90_000 }, async () => {
      const expected = JSON.parse(await readFile(path.join(PROJECTS_DIR, project, "expected.json"), "utf8"));
      const result = await analyze(project);
      const { failures, stats } = evaluateExpectations(expected, result);
      if (failures.length) {
        expect.fail(`${project} (${JSON.stringify(stats)}):\n  - ${failures.join("\n  - ")}`);
      }
    });
  }

  it("produces the same graph for the same code, twice", { timeout: 90_000 }, async () => {
    const first = await analyze("support-desk");
    const second = await generateLogicMap(path.join(PROJECTS_DIR, "support-desk"), { outputFile: false, rawOutputFile: false });
    expect(computeBuildId(second.graph)).toBe(computeBuildId(first.graph));
  });
});
