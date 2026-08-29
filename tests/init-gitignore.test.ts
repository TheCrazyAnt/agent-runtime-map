import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { initContinuousProject, initGithubWorkflow } from "@agent-runtime-map/core";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arm-ignore-"));
  cleanups.push(dir);
  return dir;
}

/**
 * The generated map is a build product — rebuilt from source on every run, and
 * ~600KB once the Viewer bundle is inside it. Committing it turns every build
 * into a diff. `init` is the one moment we can prevent that, and it has to do so
 * without touching anything else in a file the project owns.
 */
describe("init keeps the generated map out of version control", () => {
  it("creates .gitignore when the project has none", async () => {
    const root = await tempProject();
    const result = await initContinuousProject(root);

    expect(result.gitignore.outcome).toBe("created");
    expect(result.gitignore.rule).toBe(".agent-runtime-map/");
    const contents = await readFile(path.join(root, ".gitignore"), "utf8");
    expect(contents).toContain(".agent-runtime-map/");
    expect(contents).toContain("agent-runtime-map");
  });

  it("appends to an existing .gitignore without disturbing a line of it", async () => {
    const root = await tempProject();
    const original = [
      "# My project",
      "node_modules/",
      "dist/",
      "",
      "# secrets",
      ".env",
      ".env.local",
    ].join("\n") + "\n";
    await writeFile(path.join(root, ".gitignore"), original, "utf8");

    const result = await initContinuousProject(root);
    expect(result.gitignore.outcome).toBe("appended");

    const contents = await readFile(path.join(root, ".gitignore"), "utf8");
    // Every original line survives, in its original order.
    expect(contents.startsWith(original)).toBe(true);
    expect(contents).toContain(".agent-runtime-map/");
    // Nothing was reordered, rewritten, or dropped.
    const originalLines = original.trimEnd().split("\n");
    expect(contents.split("\n").slice(0, originalLines.length)).toEqual(originalLines);
  });

  it("adds a newline first when the file does not end with one", async () => {
    const root = await tempProject();
    // A file with no trailing newline must not have the rule welded onto its last line.
    await writeFile(path.join(root, ".gitignore"), "dist/", "utf8");
    await initContinuousProject(root);
    const lines = (await readFile(path.join(root, ".gitignore"), "utf8")).split("\n");
    expect(lines[0]).toBe("dist/");
    expect(lines).toContain(".agent-runtime-map/");
  });

  it("does nothing when a rule already covers the directory", async () => {
    for (const existingRule of [".agent-runtime-map/", ".agent-runtime-map", "/.agent-runtime-map/"]) {
      const root = await tempProject();
      const original = `node_modules/\n${existingRule}\n`;
      await writeFile(path.join(root, ".gitignore"), original, "utf8");

      const result = await initContinuousProject(root);
      expect(result.gitignore.outcome, `for rule ${existingRule}`).toBe("already-ignored");
      expect(await readFile(path.join(root, ".gitignore"), "utf8")).toBe(original);
    }
  });

  it("is not fooled by a comment or a negation that only looks like the rule", async () => {
    const root = await tempProject();
    // Neither of these ignores anything; both used to be easy to mistake for it.
    await writeFile(path.join(root, ".gitignore"), "# .agent-runtime-map/\n!.agent-runtime-map/\n", "utf8");
    const result = await initContinuousProject(root);
    expect(result.gitignore.outcome).toBe("appended");
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toContain("\n.agent-runtime-map/\n");
  });

  it("ignores the configured outDir, not a hardcoded default", async () => {
    const root = await tempProject();
    await writeFile(
      path.join(root, "agent-runtime-map.config.json"),
      JSON.stringify({ outDir: "build/agent-map" }),
      "utf8",
    );

    const result = await initContinuousProject(root);
    expect(result.gitignore.rule).toBe("build/agent-map/");
    const contents = await readFile(path.join(root, ".gitignore"), "utf8");
    expect(contents).toContain("build/agent-map/");
    // The default must not appear when the project chose something else.
    expect(contents).not.toContain(".agent-runtime-map/");
  });

  it("is idempotent across repeated runs, of either init", async () => {
    const root = await tempProject();
    const first = await initContinuousProject(root);
    expect(first.gitignore.outcome).toBe("created");
    const afterFirst = await readFile(path.join(root, ".gitignore"), "utf8");

    const second = await initContinuousProject(root);
    expect(second.gitignore.outcome).toBe("already-ignored");
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toBe(afterFirst);

    // `init --github` runs the same setup, so it must not add the rule twice.
    await initContinuousProject(root);
    await initGithubWorkflow(root);
    const final = await readFile(path.join(root, ".gitignore"), "utf8");
    expect(final).toBe(afterFirst);
    expect(final.split("\n").filter((line) => line.trim() === ".agent-runtime-map/")).toHaveLength(1);
  });
});

describe("git agrees the map is ignored", () => {
  it("keeps a built map out of `git add -A`", { timeout: 180_000 }, async () => {
    const root = await tempProject();
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "T");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "ignore-check", private: true }), "utf8");
    await writeFile(
      path.join(root, "agent.ts"),
      "export const helperAgent = { name: 'Helper', instructions: 'Answer.' };\n"
      + "export async function handleAsk(q: string) { return helperAgent.instructions + q; }\n",
      "utf8",
    );

    await initContinuousProject(root);
    git("add", "-A");
    git("commit", "-q", "-m", "setup");

    // Build the map the way `agent-runtime-map build .` does.
    const { buildContinuousMap, resolveContinuousConfig } = await import("@agent-runtime-map/core");
    const built = await buildContinuousMap(root, resolveContinuousConfig(), { toolVersion: "test" });
    expect(built.ok).toBe(true);

    git("add", "-A");
    const staged = git("diff", "--cached", "--name-only").trim();
    // The whole point: nothing from the map reaches the index.
    expect(staged.split("\n").filter((line) => line.includes("agent-runtime-map/"))).toEqual([]);
    expect(staged).toBe("");

    // And git itself says the directory is ignored, by the rule init wrote.
    const check = execFileSync("git", ["-C", root, "check-ignore", "-v", ".agent-runtime-map/current/graph.json"], {
      encoding: "utf8",
    });
    expect(check).toContain(".agent-runtime-map/");
  });

  it("ignores a custom outDir just as well", { timeout: 180_000 }, async () => {
    const root = await tempProject();
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "T");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "custom-out", private: true }), "utf8");
    await writeFile(path.join(root, "agent.ts"), "export function handleAsk(q: string) { return q; }\n", "utf8");
    await writeFile(
      path.join(root, "agent-runtime-map.config.json"),
      JSON.stringify({ outDir: "artifacts/map" }, null, 2),
      "utf8",
    );

    await initContinuousProject(root);
    const { buildContinuousMap, loadContinuousConfig } = await import("@agent-runtime-map/core");
    const { config } = await loadContinuousConfig(root);
    const built = await buildContinuousMap(root, config, { toolVersion: "test" });
    expect(built.ok).toBe(true);

    git("add", "-A");
    const staged = git("diff", "--cached", "--name-only").trim().split("\n").filter(Boolean);
    expect(staged.filter((line) => line.startsWith("artifacts/"))).toEqual([]);
    expect(staged).toContain("agent-runtime-map.config.json");
  });
});

/** The published CLI must behave the same way; the library is not the product. */
describe("the CLI command itself", () => {
  it("writes the rule through `init` and says so", { timeout: 180_000 }, async () => {
    const root = await tempProject();
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "cli-check", private: true }), "utf8");
    const output = execFileSync("node", [path.join(REPO, "packages/cli/dist/cli.js"), "init", root], {
      encoding: "utf8",
      env: { ...process.env, AGENT_RUNTIME_MAP_LOCALE: "en" },
    });
    expect(output).toMatch(/\.agent-runtime-map\//);
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toContain(".agent-runtime-map/");
  });
});
