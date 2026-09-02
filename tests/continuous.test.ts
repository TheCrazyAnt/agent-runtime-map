import { appendFile, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import type { LogicGraph } from "@agent-runtime-map/schema";
import {
  buildContinuousMap,
  initContinuousProject,
  isWatchedPath,
  loadContinuousConfig,
  promoteStaging,
  resolveContinuousConfig,
  watchContinuousMap,
  watchProject,
  type ChangesReport,
  type ContinuousManifest,
  type ContinuousStatus,
} from "@agent-runtime-map/core";

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../examples/simple-agent");

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixtureCopy(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arm-continuous-"));
  cleanups.push(dir);
  await cp(FIXTURE, dir, { recursive: true });
  return dir;
}

async function readArtifact<T>(currentDir: string, file: string): Promise<T> {
  return JSON.parse(await readFile(path.join(currentDir, file), "utf8")) as T;
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (predicate()) return resolve(true);
      if (Date.now() - startedAt > timeoutMs) return resolve(false);
      setTimeout(tick, 40);
    };
    tick();
  });
}

/**
 * Runs report.html's inline file:// fallback against a fake browser. The fallback
 * is the one inline script written as an IIFE; the embed script before it only
 * assigns globals, so the graph is supplied through `window` here instead.
 */
function renderFallback(reportHtml: string, graph: unknown, search: string, languages: string[] = ["en-US"]): string {
  const script = /<script>\n\(function \(\) \{[\s\S]*?<\/script>/.exec(reportHtml)?.[0];
  expect(script).toBeDefined();
  const root = { childElementCount: 0, innerHTML: "" };
  const context = {
    window: { __ARM_GRAPH__: graph, location: { search } },
    document: { readyState: "complete", getElementById: () => root, body: { style: {} }, addEventListener: () => undefined },
    navigator: { languages, language: languages[0] },
    setTimeout: (fn: () => void) => fn(),
  };
  vm.runInNewContext(script!.replace(/^<script>|<\/script>$/g, ""), context);
  return root.innerHTML;
}

describe("init", () => {
  it("creates the config with defaults and completes an existing one without clobbering it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arm-init-"));
    cleanups.push(root);

    const first = await initContinuousProject(root);
    expect(first.created).toBe(true);
    expect(first.suggestedScripts["map:watch"]).toContain("agent-runtime-map watch");
    const written = JSON.parse(await readFile(first.configFile, "utf8"));
    expect(written.outDir).toBe(".agent-runtime-map");
    expect(written.watch.debounceMs).toBe(800);

    await writeFile(first.configFile, JSON.stringify({ description: "kept", outDir: "custom-out" }), "utf8");
    const second = await initContinuousProject(root);
    expect(second.created).toBe(false);
    expect(second.addedKeys).toEqual(["watch", "history"]);
    const merged = JSON.parse(await readFile(first.configFile, "utf8"));
    expect(merged.description).toBe("kept");
    expect(merged.outDir).toBe("custom-out");
  });

  it("loads continuous settings from the shared config file and survives a corrupt one", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arm-load-"));
    cleanups.push(root);
    await writeFile(path.join(root, "agent-runtime-map.config.json"), JSON.stringify({
      outDir: "maps", watch: { debounceMs: 120, exclude: ["generated/**"] },
    }), "utf8");
    const loaded = await loadContinuousConfig(root);
    expect(loaded.config.outDir).toBe("maps");
    expect(loaded.config.watch.debounceMs).toBe(120);
    expect(loaded.config.watch.exclude).toEqual(["generated/**"]);
    expect(loaded.config.watch.include.length).toBeGreaterThan(0);
    expect(loaded.warning).toBeUndefined();

    await writeFile(path.join(root, "agent-runtime-map.config.json"), "{ not json", "utf8");
    const fallback = await loadContinuousConfig(root);
    expect(fallback.config.outDir).toBe(".agent-runtime-map");
    expect(fallback.warning).toContain("agent-runtime-map.config.json");
  });
});

describe("build", () => {
  it("renders business names in the file:// fallback in the reader's language", { timeout: 60_000 }, async () => {
    const root = await fixtureCopy();
    const built = await buildContinuousMap(root, resolveContinuousConfig(), { toolVersion: "test" });
    expect(built.ok).toBe(true);
    const report = await readFile(path.join(built.currentDir, "report.html"), "utf8");
    const graph = await readArtifact<LogicGraph>(built.currentDir, "graph.json");
    const named = graph.features.find((feature) => feature.semantic
      && feature.semantic.label["zh-CN"] !== feature.semantic.label.en
      && feature.semantic.label.en !== feature.label)!;
    expect(named).toBeDefined();
    const semantic = named.semantic!;

    const zh = renderFallback(report, graph, "?locale=zh-CN");
    const en = renderFallback(report, graph, "?locale=en");
    expect(zh).toContain(semantic.label["zh-CN"]);
    expect(zh).toContain(semantic.description["zh-CN"]);
    expect(zh).not.toContain(semantic.label.en);
    expect(zh).toContain("静态摘要");
    expect(en).toContain(semantic.label.en);
    expect(en).toContain(semantic.description.en);
    expect(en).not.toContain(semantic.label["zh-CN"]);
    expect(en).toContain("Static summary");
    // The technical name stays visible beside the business name, never in its place.
    expect(en).toContain(`<code>${named.label}</code>`);
    for (const feature of graph.features.filter((item) => item.semantic)) {
      expect(zh).not.toContain(`</span>${feature.label} <small`);
      expect(en).not.toContain(`</span>${feature.label} <small`);
    }

    // The same aliases the Viewer accepts, then the browser's language.
    expect(renderFallback(report, graph, "?locale=zh-hans")).toContain(semantic.label["zh-CN"]);
    expect(renderFallback(report, graph, "?locale=fr")).toContain(semantic.label.en);
    expect(renderFallback(report, graph, "", ["zh-CN", "en"])).toContain(semantic.label["zh-CN"]);
    expect(renderFallback(report, graph, "", ["en-GB"])).toContain(semantic.label.en);

    const withPending = {
      ...graph,
      features: graph.features.map((feature) => feature.id === named.id ? { ...feature, semantic: { ...semantic, pending: true } } : feature),
    };
    expect(renderFallback(report, withPending, "?locale=zh-CN")).toContain("待确认");
    expect(renderFallback(report, withPending, "?locale=en")).toContain("Unconfirmed");
  });

  it("writes the artifact set, then records what a code change did to the map", { timeout: 60_000 }, async () => {
    const root = await fixtureCopy();
    const config = resolveContinuousConfig();

    const first = await buildContinuousMap(root, config, { toolVersion: "test" });
    expect(first.ok).toBe(true);
    const currentDir = first.currentDir;
    for (const file of ["graph.json", "raw-graph.json", "manifest.json", "status.json", "changes.json", "report.html"]) {
      expect((await stat(path.join(currentDir, file))).size).toBeGreaterThan(0);
    }
    const manifest = await readArtifact<ContinuousManifest>(currentDir, "manifest.json");
    expect(manifest.buildId).toBe(first.buildId);
    expect(manifest.files.graph).toBe("graph.json");
    const initialChanges = await readArtifact<ChangesReport>(currentDir, "changes.json");
    expect(initialChanges.initial).toBe(true);
    expect(initialChanges.nodes.added.length).toBeGreaterThan(0);
    const status = await readArtifact<ContinuousStatus>(currentDir, "status.json");
    expect(status.state).toBe("updated");
    // report.html embeds the graph so it renders without a server.
    expect(await readFile(path.join(currentDir, "report.html"), "utf8")).toContain("__ARM_GRAPH__");

    // An unchanged project refreshes status without rewriting the map.
    const unchanged = await buildContinuousMap(root, config, { trigger: ["manual"] });
    expect(unchanged.ok).toBe(true);
    expect(unchanged.unchanged).toBe(true);
    expect(unchanged.buildId).toBe(first.buildId);

    // A new agent must appear as added, and shifting the file's lines must show up
    // as modified evidence on the nodes a feature already contains.
    const editedFile = "app/src/agents/script.ts";
    const before = await readFile(path.join(root, editedFile), "utf8");
    await writeFile(
      path.join(root, editedFile),
      `// Tuned during the continuous-map test.\n${before}\nexport const proofreaderAgent = { name: "Proofreader", instructions: "Check the script." };\n`,
      "utf8",
    );
    const second = await buildContinuousMap(root, config, { trigger: [editedFile], toolVersion: "test" });
    expect(second.ok).toBe(true);
    expect(second.buildId).not.toBe(first.buildId);
    const changes = await readArtifact<ChangesReport>(currentDir, "changes.json");
    expect(changes.initial).toBe(false);
    expect(changes.previousBuildId).toBe(first.buildId);
    expect(changes.trigger).toEqual([editedFile]);
    const touched = changes.nodes.added.length + changes.nodes.modified.length;
    expect(touched).toBeGreaterThan(0);
    expect(changes.affectedFeatures.length).toBeGreaterThan(0);

    // Both builds are in history, oldest first.
    const history = await readArtifact<ChangesReport>(currentDir, "changes.json");
    expect(history.buildId).toBe(second.buildId);
  });

  it("rebuilds product logic when a README gains a capability", { timeout: 60_000 }, async () => {
    const root = await fixtureCopy();
    const config = resolveContinuousConfig();
    const first = await buildContinuousMap(root, config, {});
    expect(first.ok).toBe(true);

    await appendFile(path.join(root, "README.md"), "\n## Draft Export\n\nExport an approved draft as a shareable PDF document.\n");
    const second = await buildContinuousMap(root, config, { trigger: ["README.md"] });
    expect(second.ok).toBe(true);
    // The documented capability changes the graph's understanding, so the map rebuilt.
    expect(second.buildId).not.toBe(first.buildId);
    const changes = await readArtifact<ChangesReport>(first.currentDir, "changes.json");
    expect(changes.trigger).toEqual(["README.md"]);
    const status = await readArtifact<ContinuousStatus>(first.currentDir, "status.json");
    expect(status.state).toBe("updated");
    expect(status.lastSuccessAt).toBeDefined();
  });

  it("keeps the last successful map when analysis fails, and says so in status.json", { timeout: 60_000 }, async () => {
    const root = await fixtureCopy();
    const config = resolveContinuousConfig();
    const first = await buildContinuousMap(root, config, {});
    expect(first.ok).toBe(true);
    const graphBefore = await readFile(path.join(first.currentDir, "graph.json"), "utf8");

    const failed = await buildContinuousMap(root, config, {
      trigger: ["app/src/broken.ts"],
      analyze: async () => { throw new Error("SyntaxError: Unexpected token in app/src/broken.ts"); },
    });
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("SyntaxError");
    // The map itself must be byte-identical to the last success.
    expect(await readFile(path.join(first.currentDir, "graph.json"), "utf8")).toBe(graphBefore);
    const status = await readArtifact<ContinuousStatus>(first.currentDir, "status.json");
    expect(status.state).toBe("failed");
    expect(status.error?.message).toContain("SyntaxError");
    expect(status.error?.failedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(status.trigger).toEqual(["app/src/broken.ts"]);
    expect(status.lastSuccessAt).toBeDefined();

    // The next successful build recovers on its own.
    const recovered = await buildContinuousMap(root, config, {});
    expect(recovered.ok).toBe(true);
    expect((await readArtifact<ContinuousStatus>(first.currentDir, "status.json")).state).toBe("updated");
  });

  it("refuses to promote an incomplete staging directory", { timeout: 60_000 }, async () => {
    const root = await fixtureCopy();
    const config = resolveContinuousConfig();
    const first = await buildContinuousMap(root, config, {});
    expect(first.ok).toBe(true);
    const graphBefore = await readFile(path.join(first.currentDir, "graph.json"), "utf8");

    const staging = path.join(first.outDir, ".staging-test");
    await mkdir(staging, { recursive: true });
    await writeFile(path.join(staging, "status.json"), JSON.stringify({ schemaVersion: 1, state: "updated" }), "utf8");
    await expect(promoteStaging(first.outDir, staging)).rejects.toThrow(/incomplete/i);
    expect(await readFile(path.join(first.currentDir, "graph.json"), "utf8")).toBe(graphBefore);
  });
});

describe("watch filtering", () => {
  const config = resolveContinuousConfig();

  it("never watches the output directory or build machinery", () => {
    expect(isWatchedPath(".agent-runtime-map/current/graph.json", config)).toBe(false);
    expect(isWatchedPath(".agent-runtime-map/history/x/changes.json", config)).toBe(false);
    expect(isWatchedPath("node_modules/lib/index.js", config)).toBe(false);
    expect(isWatchedPath("dist/out.js", config)).toBe(false);
    expect(isWatchedPath("build/main.py", config)).toBe(false);
    expect(isWatchedPath(".git/HEAD", config)).toBe(false);
    expect(isWatchedPath(".logic-map/graph.json", config)).toBe(false);
  });

  it("watches source, docs, prompts, and configuration", () => {
    expect(isWatchedPath("src/agents/writer.ts", config)).toBe(true);
    expect(isWatchedPath("app/api/generate/route.ts", config)).toBe(true);
    expect(isWatchedPath("pipeline/tasks.py", config)).toBe(true);
    expect(isWatchedPath("README.md", config)).toBe(true);
    expect(isWatchedPath("docs/prd.md", config)).toBe(true);
    expect(isWatchedPath("prompts/reviewer.txt", config)).toBe(true);
    expect(isWatchedPath("package.json", config)).toBe(true);
    expect(isWatchedPath("agent-runtime-map.config.json", config)).toBe(true);
    expect(isWatchedPath("assets/logo.png", config)).toBe(false);
  });

  it("respects a custom outDir and custom excludes", () => {
    const custom = resolveContinuousConfig({ outDir: "maps", watch: { exclude: ["generated/**"], include: [], debounceMs: 800 } });
    const withDefaults = resolveContinuousConfig({ outDir: "maps", watch: { exclude: ["generated/**"] } as never });
    expect(isWatchedPath("maps/current/graph.json", withDefaults)).toBe(false);
    expect(isWatchedPath("generated/schema.ts", withDefaults)).toBe(false);
    expect(isWatchedPath("src/index.ts", withDefaults)).toBe(true);
    expect(custom.watch.include).toEqual([]);
  });
});

describe("watcher", () => {
  it("fires one debounced batch for project changes and stays silent for output writes", { timeout: 20_000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arm-watch-"));
    cleanups.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, ".agent-runtime-map", "current"), { recursive: true });
    await writeFile(path.join(root, "src", "index.ts"), "export const a = 1;\n", "utf8");

    const config = resolveContinuousConfig({ watch: { debounceMs: 100 } as never });
    const batches: string[][] = [];
    const watcher = watchProject(root, config, (files) => batches.push(files));
    try {
      // Let the watcher attach and flush any events from setting up the fixture:
      // macOS FSEvents can deliver changes from just before the watcher existed.
      await new Promise((resolve) => setTimeout(resolve, 800));
      batches.length = 0;

      // Writes into the output directory must never trigger a rebuild loop.
      await writeFile(path.join(root, ".agent-runtime-map", "current", "graph.json"), "{}", "utf8");
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(batches).toEqual([]);

      await writeFile(path.join(root, "src", "index.ts"), "export const a = 2;\n", "utf8");
      const fired = await waitFor(() => batches.length > 0, 5_000);
      expect(fired).toBe(true);
      expect(batches[0]).toContain("src/index.ts");
    } finally {
      await watcher.close();
    }
  });

  it("stops delivering batches after close and can be closed twice", { timeout: 20_000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arm-close-"));
    cleanups.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    const config = resolveContinuousConfig({ watch: { debounceMs: 60 } as never });
    const batches: string[][] = [];
    const watcher = watchProject(root, config, (files) => batches.push(files));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await watcher.close();
    await watcher.close();
    await writeFile(path.join(root, "src", "late.ts"), "export {}\n", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(batches).toEqual([]);
  });

  it("rebuilds through the full watch loop when a source file changes", { timeout: 90_000 }, async () => {
    const root = await fixtureCopy();
    const config = resolveContinuousConfig({ watch: { debounceMs: 120 } as never });
    const builds: Array<{ ok: boolean; unchanged?: boolean }> = [];
    const { handle, initial } = await watchContinuousMap(root, config, {
      onBuild: (result) => builds.push({ ok: result.ok, unchanged: result.unchanged }),
    });
    try {
      expect(initial.ok).toBe(true);
      await appendFile(
        path.join(root, "app/src/agents/script.ts"),
        "\nexport const continuityAgent = { name: \"Continuity\", instructions: \"Keep the story consistent.\" };\n",
      );
      const rebuilt = await waitFor(() => builds.length >= 2, 60_000);
      expect(rebuilt).toBe(true);
      const changes = JSON.parse(await readFile(path.join(initial.currentDir, "changes.json"), "utf8")) as ChangesReport;
      expect(changes.trigger).toContain("app/src/agents/script.ts");
      const status = JSON.parse(await readFile(path.join(initial.currentDir, "status.json"), "utf8")) as ContinuousStatus;
      expect(status.state).toBe("updated");
    } finally {
      await handle.close();
    }
  });
});
