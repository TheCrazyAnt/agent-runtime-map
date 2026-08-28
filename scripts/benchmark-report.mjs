#!/usr/bin/env node
/**
 * Runs every benchmark project through the built analyzer and prints one line
 * per sample: counts, feature routes, unresolved sites, and expectation
 * verdicts. Run `npm run build` first; the test suite (`tests/benchmark.test.ts`)
 * is the gating version of the same checks.
 *
 * Usage: node scripts/benchmark-report.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateExpectations } from "../benchmarks/evaluate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { generateLogicMap } = await import(path.join(root, "packages/core/dist/index.js"));

const projectsDir = path.join(root, "benchmarks/projects");
const projects = readdirSync(projectsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

let failed = false;
for (const project of projects) {
  const expected = JSON.parse(readFileSync(path.join(projectsDir, project, "expected.json"), "utf8"));
  const result = await generateLogicMap(path.join(projectsDir, project), { outputFile: false, rawOutputFile: false });
  const { failures, counts, stats } = evaluateExpectations(expected, result);
  const features = result.graph.features.map((feature) => `${feature.label}(${feature.health})`).join(", ");
  console.log(`\n== ${project}`);
  console.log(`   business ${stats.rawNodes} nodes / ${stats.rawEdges} edges · logic ${stats.logicNodes}/${stats.logicEdges} · ${stats.features} features · ${stats.unresolved} unresolved`);
  console.log(`   nodes TP ${counts.nodes.tp} / FP ${counts.nodes.fp} / FN ${counts.nodes.fn} · edges TP ${counts.edges.tp} / FP ${counts.edges.fp} / FN ${counts.edges.fn}`);
  console.log(`   features: ${features}`);
  if (failures.length) {
    failed = true;
    for (const failure of failures) console.log(`   FAIL ${failure}`);
  } else {
    console.log("   expectations: all met");
  }
}

process.exit(failed ? 1 : 0);
