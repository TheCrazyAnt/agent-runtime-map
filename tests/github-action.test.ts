import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildContinuousMap,
  resolveContinuousConfig,
  type ChangesReport,
  type ContinuousManifest,
  type ContinuousStatus,
} from "@agent-runtime-map/core";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(REPO, "examples/simple-agent");

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixtureCopy(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arm-gha-"));
  cleanups.push(dir);
  await cp(FIXTURE, dir, { recursive: true });
  return dir;
}

async function readArtifact<T>(currentDir: string, file: string): Promise<T> {
  return JSON.parse(await readFile(path.join(currentDir, file), "utf8")) as T;
}

describe("cross-run continuity (what the action does between runners)", () => {
  it("diffs against a restored map and records both commit SHAs", { timeout: 60_000 }, async () => {
    const config = resolveContinuousConfig();

    // Run 1, on commit aaa, in a runner that then disappears.
    const runnerOne = await fixtureCopy();
    const first = await buildContinuousMap(runnerOne, config, {
      trigger: ["initial"],
      toolVersion: "test",
      source: { commitSha: "aaa111", ref: "refs/heads/main", baselineRestored: false },
    });
    expect(first.ok).toBe(true);
    const firstManifest = await readArtifact<ContinuousManifest>(first.currentDir, "manifest.json");
    expect(firstManifest.commit?.sha).toBe("aaa111");
    expect(firstManifest.commit?.baselineSha).toBeUndefined();
    expect((await readArtifact<ChangesReport>(first.currentDir, "changes.json")).initial).toBe(true);

    // Run 2, on commit bbb, in a fresh runner: only the cache restore carries
    // the previous map across.
    const runnerTwo = await fixtureCopy();
    await mkdir(path.join(runnerTwo, ".agent-runtime-map"), { recursive: true });
    await cp(first.currentDir, path.join(runnerTwo, ".agent-runtime-map", "current"), { recursive: true });
    await writeFile(
      path.join(runnerTwo, "app/src/agents/script.ts"),
      `${await readFile(path.join(runnerTwo, "app/src/agents/script.ts"), "utf8")}\nexport const crossRunAgent = { name: "Cross Run", instructions: "Added on commit bbb." };\n`,
      "utf8",
    );
    const second = await buildContinuousMap(runnerTwo, config, {
      trigger: ["app/src/agents/script.ts"],
      toolVersion: "test",
      source: { commitSha: "bbb222", ref: "refs/heads/main", baselineRestored: true },
    });
    expect(second.ok).toBe(true);
    const changes = await readArtifact<ChangesReport>(second.currentDir, "changes.json");
    expect(changes.initial).toBe(false);
    expect(changes.previousBuildId).toBe(first.buildId);
    expect(changes.nodes.added.length).toBeGreaterThan(0);
    const manifest = await readArtifact<ContinuousManifest>(second.currentDir, "manifest.json");
    expect(manifest.commit).toEqual({
      sha: "bbb222",
      ref: "refs/heads/main",
      baselineSha: "aaa111",
      baselineRestored: true,
    });
  });

  it("keeps a restored map intact when the new commit's analysis fails", { timeout: 60_000 }, async () => {
    const config = resolveContinuousConfig();
    const runnerOne = await fixtureCopy();
    const first = await buildContinuousMap(runnerOne, config, { toolVersion: "test", source: { commitSha: "aaa111" } });
    expect(first.ok).toBe(true);

    const runnerTwo = await fixtureCopy();
    await mkdir(path.join(runnerTwo, ".agent-runtime-map"), { recursive: true });
    await cp(first.currentDir, path.join(runnerTwo, ".agent-runtime-map", "current"), { recursive: true });
    const restoredGraph = await readFile(path.join(runnerTwo, ".agent-runtime-map/current/graph.json"), "utf8");

    const failed = await buildContinuousMap(runnerTwo, config, {
      trigger: ["app/src/broken.ts"],
      toolVersion: "test",
      source: { commitSha: "bbb222", baselineRestored: true },
      analyze: async () => { throw new Error("SyntaxError: unexpected token on commit bbb222"); },
    });
    expect(failed.ok).toBe(false);
    const currentDir = path.join(runnerTwo, ".agent-runtime-map/current");
    expect(await readFile(path.join(currentDir, "graph.json"), "utf8")).toBe(restoredGraph);
    const status = await readArtifact<ContinuousStatus>(currentDir, "status.json");
    expect(status.state).toBe("failed");
    expect(status.toolVersion).toBe("test");
    expect(status.error?.message).toContain("SyntaxError");
  });
});

describe("artifact privacy", () => {
  it("current/ contains only map artifacts even when the project holds secrets", { timeout: 60_000 }, async () => {
    const root = await fixtureCopy();
    const secret = "hunter2-super-secret-value-9f8e7d";
    await writeFile(path.join(root, ".env"), `OPENAI_API_KEY=${secret}\n`, "utf8");
    await writeFile(path.join(root, "deploy.pem"), `-----BEGIN RSA PRIVATE KEY-----\n${secret}\n`, "utf8");

    const result = await buildContinuousMap(root, resolveContinuousConfig(), { toolVersion: "test" });
    expect(result.ok).toBe(true);

    const entries = (await readdir(result.currentDir)).sort();
    for (const entry of entries) {
      expect(["assets", "changes.json", "graph.json", "manifest.json", "raw-graph.json", "report.html", "status.json"]).toContain(entry);
    }
    for (const file of entries.filter((entry) => entry !== "assets")) {
      expect(await readFile(path.join(result.currentDir, file), "utf8")).not.toContain(secret);
    }
    // And the gate script agrees.
    const verify = () => execFileSync("node", [path.join(REPO, "action/verify-artifact.mjs"), result.currentDir], { encoding: "utf8" });
    expect(verify()).toContain("verified");

    // Plant a secret inside the artifact directory: the gate must refuse.
    await writeFile(path.join(result.currentDir, ".env"), "leak=1\n", "utf8");
    expect(() => verify()).toThrow();
  });
});

describe("step summary", () => {
  it("reports status, buildId, changes, diagnostics, trigger, and the artifact", { timeout: 60_000 }, async () => {
    const root = await fixtureCopy();
    const config = resolveContinuousConfig();
    const first = await buildContinuousMap(root, config, { toolVersion: "0.8.0", source: { commitSha: "aaa111" } });
    expect(first.ok).toBe(true);
    await writeFile(
      path.join(root, "app/src/agents/script.ts"),
      `${await readFile(path.join(root, "app/src/agents/script.ts"), "utf8")}\nexport const summaryProbeAgent = { name: "Summary Probe", instructions: "For the summary test." };\n`,
      "utf8",
    );
    const second = await buildContinuousMap(root, config, {
      trigger: ["app/src/agents/script.ts"],
      toolVersion: "0.8.0",
      source: { commitSha: "bbb222", baselineRestored: true },
    });
    expect(second.ok).toBe(true);

    const summaryFile = path.join(root, "step-summary.md");
    execFileSync("node", [path.join(REPO, "action/summary.mjs"), second.currentDir], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_STEP_SUMMARY: summaryFile,
        ARTIFACT_NAME: "my-map",
        BUILD_OK: "true",
        BUILD_UNCHANGED: "false",
        BASELINE_RESTORED: "true",
      },
    });
    const summary = await readFile(summaryFile, "utf8");
    expect(summary).toContain("# Agent Runtime Map");
    expect(summary).toContain(second.buildId!);
    expect(summary).toContain("0.8.0");
    expect(summary).toContain("bbb222".slice(0, 6));
    expect(summary).toContain("aaa111".slice(0, 6));
    expect(summary).toContain("What changed");
    expect(summary).toContain("Summary Probe");
    expect(summary).toContain("features ·");
    expect(summary).toContain("app/src/agents/script.ts");
    expect(summary).toContain("my-map");

    // A failed build's summary names the failure and the preserved map.
    const failed = await buildContinuousMap(root, config, {
      toolVersion: "0.8.0",
      analyze: async () => { throw new Error("SyntaxError: for the summary"); },
    });
    expect(failed.ok).toBe(false);
    const failedSummaryFile = path.join(root, "failed-summary.md");
    execFileSync("node", [path.join(REPO, "action/summary.mjs"), second.currentDir], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: failedSummaryFile, BUILD_OK: "false", ARTIFACT_NAME: "my-map" },
    });
    const failedSummary = await readFile(failedSummaryFile, "utf8");
    expect(failedSummary).toContain("failed");
    expect(failedSummary).toContain("preserved");
    expect(failedSummary).toContain("SyntaxError");
  });
});
