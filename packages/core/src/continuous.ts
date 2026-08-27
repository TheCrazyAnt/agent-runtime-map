import { createHash, randomBytes } from "node:crypto";
import { watch as fsWatch, type FSWatcher } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Diagnostic, LogicGraph, RawCodeGraph } from "@agent-runtime-map/schema";
import { generateLogicMap, type GenerateLogicMapOptions, type GenerateLogicMapResult } from "./index.js";

/**
 * The continuous map: a project installs the analyzer, and the map stays current as
 * the code and product documents change. The invariants this file exists to protect:
 *
 * - `current/` always holds the **last successful** map. A failed analysis writes a
 *   failure into `status.json` and touches nothing else, so a syntax error mid-edit
 *   never costs the team the map they had.
 * - A new map is written to a staging directory first and promoted with renames, so
 *   an interrupted build can leave a stale map but never a torn one.
 * - Every successful update explains itself: `changes.json` says what appeared,
 *   disappeared, and changed — and which files triggered the rebuild.
 * - The watcher never watches the output directory, because a map that rebuilds
 *   itself in response to its own output is a loop, not a product.
 */

// ---------------------------------------------------------------------------
// Configuration

export interface ContinuousWatchConfig {
  include: string[];
  exclude: string[];
  debounceMs: number;
}

export interface ContinuousConfig {
  /** Relative to the project root unless absolute. */
  outDir: string;
  watch: ContinuousWatchConfig;
  history: { limit: number };
}

export const DEFAULT_OUT_DIR = ".agent-runtime-map";

/**
 * Source plus everything the Project Reader treats as product context: README,
 * docs, PRD, prompts, package metadata, and the analyzer's own configuration.
 */
export const DEFAULT_WATCH_INCLUDE = [
  "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs", "**/*.py",
  "**/*.md", "**/*.mdx", "**/*.txt",
  "package.json",
  "agent-runtime-map.config.json",
];

/** Directories no rebuild should ever be triggered from, on top of the output directory. */
const IGNORED_SEGMENTS = new Set([
  ".git", ".hg", ".svn", ".next", ".turbo", ".venv", ".logic-map",
  "node_modules", "dist", "build", "out", "coverage", "__pycache__", "venv", "site-packages",
]);

export function resolveContinuousConfig(raw?: Partial<ContinuousConfig>): ContinuousConfig {
  const watch = raw?.watch;
  return {
    outDir: typeof raw?.outDir === "string" && raw.outDir.trim() ? raw.outDir.trim() : DEFAULT_OUT_DIR,
    watch: {
      include: stringList(watch?.include) ?? [...DEFAULT_WATCH_INCLUDE],
      exclude: stringList(watch?.exclude) ?? [],
      debounceMs: clampInteger(watch?.debounceMs, 50, 60_000) ?? 800,
    },
    history: { limit: clampInteger(raw?.history?.limit, 0, 10_000) ?? 30 },
  };
}

/**
 * Reads the continuous settings out of `agent-runtime-map.config.json`. The same file
 * carries the Project Reader's `description`/`features`, so unknown keys are left
 * alone, and an unreadable file falls back to defaults with a warning instead of
 * refusing to map the project: configuration trouble must not cost anyone the map.
 */
export async function loadContinuousConfig(
  root: string,
): Promise<{ config: ContinuousConfig; configFile: string; warning?: string }> {
  const configFile = path.join(path.resolve(root), "agent-runtime-map.config.json");
  try {
    const parsed: unknown = JSON.parse(await readFile(configFile, "utf8"));
    return { config: resolveContinuousConfig(parsed as Partial<ContinuousConfig>), configFile };
  } catch (error) {
    const exists = await stat(configFile).then(() => true, () => false);
    return {
      config: resolveContinuousConfig(),
      configFile,
      warning: exists
        ? `Could not parse agent-runtime-map.config.json (${error instanceof Error ? error.message : String(error)}); using defaults.`
        : undefined,
    };
  }
}

export interface InitResult {
  configFile: string;
  created: boolean;
  /** Keys added to an existing config. Empty when the file was complete or new. */
  addedKeys: string[];
  /** For the caller to print. This function never edits package.json. */
  suggestedScripts: Record<string, string>;
}

/**
 * Creates or completes `agent-runtime-map.config.json`. An existing file keeps every
 * key it has — including the Project Reader's `description` and `features` — and only
 * gains the continuous defaults it is missing. Suggested package.json scripts are
 * returned for the caller to show; nothing outside the config file is written.
 */
export async function initContinuousProject(root: string): Promise<InitResult> {
  const resolvedRoot = path.resolve(root);
  const configFile = path.join(resolvedRoot, "agent-runtime-map.config.json");
  const defaults = resolveContinuousConfig();
  const suggestedScripts = {
    "map:build": "agent-runtime-map build .",
    "map:watch": "agent-runtime-map watch .",
  };

  let existing: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(await readFile(configFile, "utf8"));
    existing = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch (error) {
    const fileExists = await stat(configFile).then(() => true, () => false);
    if (fileExists) throw new Error(`agent-runtime-map.config.json exists but could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const next: Record<string, unknown> = existing ? { ...existing } : {};
  const addedKeys: string[] = [];
  if (next.outDir === undefined) { next.outDir = defaults.outDir; addedKeys.push("outDir"); }
  if (next.watch === undefined) { next.watch = defaults.watch; addedKeys.push("watch"); }
  if (next.history === undefined) { next.history = defaults.history; addedKeys.push("history"); }

  if (!existing || addedKeys.length) {
    await writeFile(configFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }
  return { configFile, created: !existing, addedKeys, suggestedScripts };
}

// ---------------------------------------------------------------------------
// Artifacts

export interface ContinuousStatus {
  schemaVersion: 1;
  state: "updated" | "stale" | "failed";
  /** The exact analyzer version that produced (or failed to produce) this state. */
  toolVersion?: string;
  /** Of the map in `current/`, i.e. the last successful build. */
  buildId?: string;
  generatedAt?: string;
  lastSuccessAt?: string;
  durationMs?: number;
  /** Files (project-relative) whose change caused the last transition. */
  trigger?: string[];
  /** Present only when `state` is `failed`. */
  error?: { message: string; failedAt: string };
  /**
   * The commit whose analysis failed. Kept apart from the map's own commit in
   * manifest.json on purpose: the preserved map still belongs to its last
   * successful commit, and conflating the two would misplace the failure.
   */
  attemptedCommit?: string;
  attemptedRef?: string;
  /** Present only when `state` is `stale`. */
  staleSince?: string;
}

export interface ContinuousManifest {
  schemaVersion: 1;
  name: "agent-runtime-map";
  toolVersion: string;
  buildId: string;
  generatedAt: string;
  graphType: LogicGraph["graphType"];
  project: { name: string };
  /**
   * Where this map came from, when the caller runs in CI. `baselineSha` is read
   * from the restored previous manifest, so a diff can always be traced to the two
   * commits it compares — and when there is no baseline, the build says `initial`
   * in changes.json rather than inventing a comparison.
   */
  commit?: {
    sha?: string;
    ref?: string;
    baselineSha?: string;
    baselineRestored?: boolean;
  };
  files: {
    graph: string;
    rawGraph?: string;
    changes: string;
    status: string;
    report: string;
  };
}

export interface ChangeRef { id: string; label: string; type?: string }
export interface EdgeChangeRef { id: string; source: string; target: string; type?: string }
export interface DiagnosticRef {
  level: Diagnostic["level"];
  code: string;
  message: string;
  featureId?: string;
  nodeId?: string;
}

export interface ChangesReport {
  schemaVersion: 1;
  generatedAt: string;
  buildId: string;
  previousBuildId?: string;
  /** True on the first build, when everything is necessarily "added". */
  initial: boolean;
  /** Project-relative files whose change triggered this build, or ["manual"]. */
  trigger: string[];
  nodes: { added: ChangeRef[]; removed: ChangeRef[]; modified: ChangeRef[] };
  edges: { added: EdgeChangeRef[]; removed: EdgeChangeRef[]; modified: EdgeChangeRef[] };
  features: { added: ChangeRef[]; removed: ChangeRef[]; modified: ChangeRef[] };
  /** Features whose route contains any changed node or edge, or that changed themselves. */
  affectedFeatures: ChangeRef[];
  diagnostics: { appeared: DiagnosticRef[]; resolved: DiagnosticRef[] };
}

export function computeBuildId(graph: LogicGraph): string {
  // generatedAt would make every build "different"; the id must track content.
  const { generatedAt: _ignored, ...content } = graph;
  return createHash("sha1").update(JSON.stringify(content)).digest("hex").slice(0, 16);
}

/**
 * What changed between two successful maps. Ids are content-stable across builds, so
 * this is set arithmetic, not matching heuristics: an id present in both with
 * different content is "modified", never a delete-plus-add.
 */
export function diffGraphs(
  previous: LogicGraph | undefined,
  next: LogicGraph,
  options: { trigger: string[]; generatedAt: string },
): ChangesReport {
  const nodeChanges = diffById(previous?.nodes ?? [], next.nodes, nodeRef);
  const edgeChanges = diffById(previous?.edges ?? [], next.edges, edgeRef);
  const featureChanges = diffById(previous?.features ?? [], next.features, featureRef);

  const changedElementIds = new Set([
    ...nodeChanges.added.map((item) => item.id),
    ...nodeChanges.removed.map((item) => item.id),
    ...nodeChanges.modified.map((item) => item.id),
    ...edgeChanges.added.map((item) => item.id),
    ...edgeChanges.removed.map((item) => item.id),
    ...edgeChanges.modified.map((item) => item.id),
  ]);
  const changedFeatureIds = new Set([
    ...featureChanges.added.map((item) => item.id),
    ...featureChanges.modified.map((item) => item.id),
  ]);
  const affectedFeatures = next.features
    .filter((feature) => changedFeatureIds.has(feature.id)
      || feature.nodeIds.some((id) => changedElementIds.has(id))
      || feature.edgeIds.some((id) => changedElementIds.has(id)))
    .map(featureRef);

  const previousDiagnostics = previous ? collectDiagnostics(previous) : new Map<string, DiagnosticRef>();
  const nextDiagnostics = collectDiagnostics(next);

  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt,
    buildId: computeBuildId(next),
    previousBuildId: previous ? computeBuildId(previous) : undefined,
    initial: !previous,
    trigger: options.trigger,
    nodes: nodeChanges,
    edges: edgeChanges,
    features: featureChanges,
    affectedFeatures,
    diagnostics: {
      appeared: [...nextDiagnostics].filter(([key]) => !previousDiagnostics.has(key)).map(([, value]) => value),
      resolved: [...previousDiagnostics].filter(([key]) => !nextDiagnostics.has(key)).map(([, value]) => value),
    },
  };
}

function diffById<T extends { id: string }, R>(
  previous: readonly T[],
  next: readonly T[],
  toRef: (item: T) => R,
): { added: R[]; removed: R[]; modified: R[] } {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const nextById = new Map(next.map((item) => [item.id, item]));
  return {
    added: next.filter((item) => !previousById.has(item.id)).map(toRef),
    removed: previous.filter((item) => !nextById.has(item.id)).map(toRef),
    modified: next
      .filter((item) => {
        const before = previousById.get(item.id);
        return before !== undefined && JSON.stringify(before) !== JSON.stringify(item);
      })
      .map(toRef),
  };
}

function nodeRef(node: LogicGraph["nodes"][number]): ChangeRef {
  return { id: node.id, label: node.label, type: node.type };
}

function edgeRef(edge: LogicGraph["edges"][number]): EdgeChangeRef {
  return { id: edge.id, source: edge.source, target: edge.target, type: edge.type };
}

function featureRef(feature: LogicGraph["features"][number]): ChangeRef {
  return { id: feature.id, label: feature.label };
}

function collectDiagnostics(graph: LogicGraph): Map<string, DiagnosticRef> {
  const collected = new Map<string, DiagnosticRef>();
  const add = (ref: DiagnosticRef) => {
    collected.set(`${ref.featureId ?? ""}|${ref.level}|${ref.code}|${ref.message}`, ref);
  };
  for (const diagnostic of graph.diagnostics) {
    add({ level: diagnostic.level, code: diagnostic.code, message: diagnostic.message });
  }
  for (const feature of graph.features) {
    for (const diagnostic of feature.diagnostics) {
      add({
        level: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        featureId: feature.id,
        nodeId: diagnostic.nodeId,
      });
    }
  }
  return collected;
}

// ---------------------------------------------------------------------------
// Building

export interface ContinuousBuildOptions {
  /** Project-relative files that caused this build; defaults to ["manual"]. */
  trigger?: string[];
  analyzeOptions?: GenerateLogicMapOptions;
  /**
   * The analysis to run. Defaults to the real pipeline; a test that needs a failing
   * analysis injects one here rather than hoping for a file the analyzers choke on.
   */
  analyze?: (root: string, options: GenerateLogicMapOptions) => Promise<GenerateLogicMapResult>;
  /** Built Viewer assets for the interactive report. Optional: without them the report is a static summary. */
  viewerAssetsDir?: string;
  toolVersion?: string;
  /** CI provenance. The baseline SHA is not an input: it comes from the restored manifest. */
  source?: { commitSha?: string; ref?: string; baselineRestored?: boolean };
  now?: () => Date;
}

export interface ContinuousBuildResult {
  ok: boolean;
  /** True when analysis succeeded but produced a byte-identical map, so nothing was rewritten. */
  unchanged?: boolean;
  buildId?: string;
  graph?: LogicGraph;
  changes?: ChangesReport;
  currentDir: string;
  outDir: string;
  error?: string;
  durationMs: number;
}

const REQUIRED_STAGING_FILES = ["graph.json", "manifest.json", "status.json", "changes.json", "report.html"];

export async function buildContinuousMap(
  root: string,
  config: ContinuousConfig,
  options: ContinuousBuildOptions = {},
): Promise<ContinuousBuildResult> {
  const resolvedRoot = path.resolve(root);
  const outDir = path.isAbsolute(config.outDir) ? config.outDir : path.join(resolvedRoot, config.outDir);
  const currentDir = path.join(outDir, "current");
  const now = options.now ?? (() => new Date());
  const trigger = options.trigger?.length ? options.trigger : ["manual"];
  const analyze = options.analyze ?? generateLogicMap;
  const startedAt = Date.now();

  const previousGraph = await readJsonIfPresent<LogicGraph>(path.join(currentDir, "graph.json"));
  const previousStatus = await readJsonIfPresent<ContinuousStatus>(path.join(currentDir, "status.json"));
  const previousManifest = await readJsonIfPresent<ContinuousManifest>(path.join(currentDir, "manifest.json"));

  let result: GenerateLogicMapResult;
  try {
    // The analyzer writes nothing itself: every artifact goes through staging below.
    result = await analyze(resolvedRoot, { ...options.analyzeOptions, outputFile: false, rawOutputFile: false });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    await writeFailureStatus(currentDir, {
      message: message.slice(0, 2000),
      failedAt: now().toISOString(),
      trigger,
      previous: previousStatus,
      toolVersion: options.toolVersion,
      source: options.source,
    });
    return { ok: false, currentDir, outDir, error: message, durationMs };
  }

  const buildId = computeBuildId(result.graph);
  const generatedAt = now().toISOString();
  const durationMs = Date.now() - startedAt;

  if (previousGraph && computeBuildId(previousGraph) === buildId) {
    // The map did not change: graph, raw graph, report, and history stay untouched.
    // Provenance still advances — this commit was analyzed and produced this very
    // map, and the next build must diff against this commit, not a stale one.
    await writeJson(path.join(currentDir, "status.json"), statusFor({
      state: "updated", toolVersion: options.toolVersion, buildId,
      generatedAt: previousStatus?.generatedAt ?? generatedAt,
      lastSuccessAt: generatedAt, durationMs, trigger,
    }));
    if (previousManifest) {
      await writeJson(path.join(currentDir, "manifest.json"), {
        ...previousManifest,
        toolVersion: options.toolVersion ?? previousManifest.toolVersion,
        generatedAt,
        commit: options.source ? {
          sha: options.source.commitSha,
          ref: options.source.ref,
          baselineSha: previousManifest.commit?.sha,
          baselineRestored: options.source.baselineRestored,
        } : previousManifest.commit,
      } satisfies ContinuousManifest);
    }
    return { ok: true, unchanged: true, buildId, graph: result.graph, currentDir, outDir, durationMs };
  }

  const changes = diffGraphs(previousGraph, result.graph, { trigger, generatedAt });
  const manifest: ContinuousManifest = {
    schemaVersion: 1,
    name: "agent-runtime-map",
    toolVersion: options.toolVersion ?? "0.0.0",
    buildId,
    generatedAt,
    graphType: result.graph.graphType,
    project: { name: path.basename(resolvedRoot) },
    commit: options.source ? {
      sha: options.source.commitSha,
      ref: options.source.ref,
      baselineSha: previousManifest?.commit?.sha,
      baselineRestored: options.source.baselineRestored,
    } : undefined,
    files: {
      graph: "graph.json",
      rawGraph: "raw-graph.json",
      changes: "changes.json",
      status: "status.json",
      report: "report.html",
    },
  };

  const stagingDir = path.join(outDir, `.staging-${randomBytes(6).toString("hex")}`);
  try {
    await mkdir(stagingDir, { recursive: true });
    await writeJson(path.join(stagingDir, "graph.json"), result.graph);
    await writeJson(path.join(stagingDir, "raw-graph.json"), result.rawGraph);
    await writeJson(path.join(stagingDir, "changes.json"), changes);
    await writeJson(path.join(stagingDir, "manifest.json"), manifest);
    await writeJson(path.join(stagingDir, "status.json"), statusFor({
      state: "updated", toolVersion: options.toolVersion, buildId, generatedAt,
      lastSuccessAt: generatedAt, durationMs, trigger,
    }));
    await writeReport(stagingDir, result.graph, result.rawGraph, options.viewerAssetsDir);

    await snapshotHistory(outDir, stagingDir, generatedAt, config.history.limit);
    await promoteStaging(outDir, stagingDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    await writeFailureStatus(currentDir, {
      message: message.slice(0, 2000),
      failedAt: now().toISOString(),
      trigger,
      previous: previousStatus,
      toolVersion: options.toolVersion,
      source: options.source,
    });
    return { ok: false, currentDir, outDir, error: message, durationMs: Date.now() - startedAt };
  }

  return { ok: true, buildId, graph: result.graph, changes, currentDir, outDir, durationMs };
}

/**
 * Replaces `current/` with a validated staging directory using renames. The window in
 * which neither directory is in place is two renames wide; a crash inside it leaves
 * `.previous` on disk, which the next promotion clears. An incomplete staging
 * directory is rejected before `current/` is touched at all.
 */
export async function promoteStaging(outDir: string, stagingDir: string): Promise<void> {
  await assertStagingComplete(stagingDir);
  const currentDir = path.join(outDir, "current");
  const previousDir = path.join(outDir, ".previous");
  await rm(previousDir, { recursive: true, force: true });
  const hadCurrent = await stat(currentDir).then((details) => details.isDirectory(), () => false);
  if (hadCurrent) await rename(currentDir, previousDir);
  try {
    await rename(stagingDir, currentDir);
  } catch (error) {
    if (hadCurrent) await rename(previousDir, currentDir).catch(() => undefined);
    throw error;
  }
  await rm(previousDir, { recursive: true, force: true });
}

async function assertStagingComplete(stagingDir: string): Promise<void> {
  for (const file of REQUIRED_STAGING_FILES) {
    const filePath = path.join(stagingDir, file);
    const details = await stat(filePath).catch(() => undefined);
    if (!details?.isFile() || details.size === 0) {
      throw new Error(`Staging is incomplete: ${file} is missing or empty. The current map was left untouched.`);
    }
    if (file.endsWith(".json")) JSON.parse(await readFile(filePath, "utf8"));
  }
}

async function snapshotHistory(outDir: string, stagingDir: string, generatedAt: string, limit: number): Promise<void> {
  if (limit <= 0) return;
  const historyDir = path.join(outDir, "history");
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const snapshotDir = path.join(historyDir, stamp);
  await mkdir(snapshotDir, { recursive: true });
  for (const file of ["graph.json", "changes.json", "manifest.json"]) {
    await cp(path.join(stagingDir, file), path.join(snapshotDir, file));
  }
  const entries = (await readdir(historyDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const stale of entries.slice(0, Math.max(0, entries.length - limit))) {
    await rm(path.join(historyDir, stale), { recursive: true, force: true });
  }
}

/** Marks the current map as behind the code, before a rebuild starts. */
export async function markStale(currentDir: string, trigger: string[], now: () => Date = () => new Date()): Promise<void> {
  const previous = await readJsonIfPresent<ContinuousStatus>(path.join(currentDir, "status.json"));
  await writeJson(path.join(currentDir, "status.json"), statusFor({
    state: "stale",
    buildId: previous?.buildId,
    generatedAt: previous?.generatedAt,
    lastSuccessAt: previous?.lastSuccessAt,
    staleSince: now().toISOString(),
    trigger,
  }));
}

async function writeFailureStatus(
  currentDir: string,
  failure: {
    message: string;
    failedAt: string;
    trigger: string[];
    previous?: ContinuousStatus;
    toolVersion?: string;
    source?: ContinuousBuildOptions["source"];
  },
): Promise<void> {
  // Only status.json is written: the last successful map must survive every failure.
  await writeJson(path.join(currentDir, "status.json"), statusFor({
    state: "failed",
    toolVersion: failure.toolVersion,
    buildId: failure.previous?.buildId,
    generatedAt: failure.previous?.generatedAt,
    lastSuccessAt: failure.previous?.lastSuccessAt,
    trigger: failure.trigger,
    error: { message: failure.message, failedAt: failure.failedAt },
    attemptedCommit: failure.source?.commitSha,
    attemptedRef: failure.source?.ref,
  }));
}

function statusFor(partial: Omit<ContinuousStatus, "schemaVersion">): ContinuousStatus {
  return { schemaVersion: 1, ...partial };
}

// ---------------------------------------------------------------------------
// Report

/**
 * `report.html` is a standalone entry over the same graph. Served over HTTP next to
 * its `assets/`, it boots the full interactive Viewer from the embedded graph and
 * upgrades to live refresh when `manifest.json` is reachable. Opened as a plain file
 * (`file://`), browsers refuse module scripts, so an inline fallback renders a static
 * summary from the same embedded data — degraded, never blank.
 */
async function writeReport(
  stagingDir: string,
  graph: LogicGraph,
  rawGraph: RawCodeGraph,
  viewerAssetsDir?: string,
): Promise<void> {
  const graphJson = embedJson(graph);
  const rawJson = JSON.stringify(rawGraph).length <= 4_000_000 ? embedJson(rawGraph) : undefined;
  const embed = `<script>window.__ARM_GRAPH__=${graphJson};${rawJson ? `window.__ARM_RAW_GRAPH__=${rawJson};` : ""}</script>`;

  if (viewerAssetsDir) {
    const indexHtml = await readFile(path.join(viewerAssetsDir, "index.html"), "utf8");
    const withEmbed = indexHtml.replace(/<script type="module"/, `${embed}\n    <script type="module"`);
    const withFallback = withEmbed.replace("</body>", `${FALLBACK_SCRIPT}\n</body>`);
    if (withFallback === indexHtml) throw new Error("Viewer index.html has an unexpected shape; report.html was not generated.");
    await writeFile(path.join(stagingDir, "report.html"), withFallback, "utf8");
    await cp(path.join(viewerAssetsDir, "assets"), path.join(stagingDir, "assets"), { recursive: true });
    return;
  }

  await writeFile(path.join(stagingDir, "report.html"), [
    "<!doctype html>",
    `<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>`,
    `<title>Agent Runtime Map · ${escapeHtml(graph.title ?? "Report")}</title></head>`,
    `<body><div id="root"></div>${embed}${FALLBACK_SCRIPT}</body></html>`,
  ].join("\n"), "utf8");
}

function embedJson(value: unknown): string {
  // "</script>" inside a string would end the tag; escaping "<" prevents every variant.
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const FALLBACK_SCRIPT = `<script>
(function () {
  function ready(fn) { document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn(); }
  ready(function () {
    setTimeout(function () {
      var root = document.getElementById("root");
      if (!root || root.childElementCount > 0 || !window.__ARM_GRAPH__) return;
      var graph = window.__ARM_GRAPH__;
      var health = { healthy: "#3fb27f", warning: "#d99a2b", error: "#d4574e" };
      var rows = (graph.features || []).map(function (feature) {
        var diagnostics = (feature.diagnostics || []).map(function (item) {
          return '<li><code>' + item.code + '</code> ' + item.message.replace(/</g, "&lt;") + "</li>";
        }).join("");
        return '<section style="border:1px solid #2a3242;border-radius:8px;padding:12px 16px;margin:10px 0">'
          + '<h2 style="margin:0;font-size:16px"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px;background:' + (health[feature.health] || "#888") + '"></span>'
          + feature.label.replace(/</g, "&lt;") + " <small style=\\"color:#8a94a6;font-weight:400\\">" + Math.round((feature.confidence || 0) * 100) + "%</small></h2>"
          + (feature.description ? '<p style="color:#aeb6c4;margin:6px 0 0">' + feature.description.replace(/</g, "&lt;") + "</p>" : "")
          + (diagnostics ? '<ul style="color:#d99a2b;margin:8px 0 0;padding-left:18px">' + diagnostics + "</ul>" : "")
          + "</section>";
      }).join("");
      root.innerHTML = '<main style="max-width:760px;margin:32px auto;padding:0 16px;font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:#e8ebf1">'
        + '<h1 style="font-size:20px">' + (graph.title || "Agent Runtime Map").replace(/</g, "&lt;") + "</h1>"
        + '<p style="color:#8a94a6">' + (graph.nodes || []).length + " steps · " + (graph.edges || []).length + " flows · generated " + (graph.generatedAt || "") + "</p>"
        + '<p style="color:#8a94a6">Static summary. For the interactive map, serve this folder over HTTP (for example: <code>npx serve .</code>) and open report.html again.</p>'
        + rows + "</main>";
      document.body.style.background = "#0b0d12";
    }, 1500);
  });
})();
</script>`;

// ---------------------------------------------------------------------------
// Watching

export interface ProjectWatcher {
  close(): Promise<void>;
}

/**
 * Whether a change to this project-relative path should rebuild the map. The output
 * directory and dot-directories are ignored before include patterns are consulted,
 * so no configuration mistake can make the map watch itself.
 */
export function isWatchedPath(relativePath: string, config: ContinuousConfig): boolean {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("..")) return false;
  const outDir = config.outDir.replaceAll("\\", "/").replace(/\/+$/, "");
  if (normalized === outDir || normalized.startsWith(`${outDir}/`)) return false;
  const segments = normalized.split("/");
  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment) || (segment.startsWith(".") && segment !== "."))) {
    // The analyzer's own config lives at the root and never starts with a dot;
    // everything dot-prefixed (VCS, caches, the legacy .logic-map) is machinery.
    return false;
  }
  if (config.watch.exclude.some((pattern) => globToRegExp(pattern).test(normalized))) return false;
  return config.watch.include.some((pattern) => globToRegExp(pattern).test(normalized));
}

const GLOB_CACHE = new Map<string, RegExp>();

function globToRegExp(glob: string): RegExp {
  const cached = GLOB_CACHE.get(glob);
  if (cached) return cached;
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!;
    if (char === "*") {
      if (glob[index + 1] === "*") {
        // `**/` matches zero or more whole segments; `**` alone matches anything.
        if (glob[index + 2] === "/") { pattern += "(?:[^/]+/)*"; index += 2; }
        else { pattern += ".*"; index += 1; }
      } else pattern += "[^/]*";
    } else if (char === "?") pattern += "[^/]";
    else pattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const compiled = new RegExp(`^${pattern}$`);
  GLOB_CACHE.set(glob, compiled);
  return compiled;
}

/**
 * Watches a project and reports debounced batches of changed files. Uses the
 * platform's recursive watcher where available and falls back to one watcher per
 * directory elsewhere. Full correctness over cleverness: the caller re-analyzes the
 * whole project, so a duplicate or coarse event costs a rebuild, never the truth.
 */
export function watchProject(
  root: string,
  config: ContinuousConfig,
  onBatch: (files: string[]) => void,
): ProjectWatcher {
  const resolvedRoot = path.resolve(root);
  const watchers = new Map<string, FSWatcher>();
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const schedule = (relativePath: string) => {
    if (closed || !isWatchedPath(relativePath, config)) return;
    pending.add(relativePath.replaceAll("\\", "/"));
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const batch = [...pending].sort();
      pending.clear();
      if (!closed && batch.length) onBatch(batch);
    }, config.watch.debounceMs);
  };

  const watchDirectoryTree = async (directory: string): Promise<void> => {
    if (closed || watchers.has(directory)) return;
    const relative = path.relative(resolvedRoot, directory).replaceAll(path.sep, "/");
    if (relative && !directoryCouldMatter(relative, config)) return;
    let watcher: FSWatcher;
    try {
      watcher = fsWatch(directory, (_event, filename) => {
        if (!filename) return;
        const relativePath = path.join(relative, filename.toString()).replaceAll(path.sep, "/");
        schedule(relativePath);
        // A new subdirectory needs its own watcher in per-directory mode.
        const absolute = path.join(resolvedRoot, relativePath);
        void stat(absolute).then((details) => {
          if (details.isDirectory()) void watchDirectoryTree(absolute);
        }).catch(() => undefined);
      });
    } catch {
      return;
    }
    watcher.on("error", () => undefined);
    watchers.set(directory, watcher);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await watchDirectoryTree(path.join(directory, entry.name));
    }
  };

  try {
    const watcher = fsWatch(resolvedRoot, { recursive: true }, (_event, filename) => {
      if (filename) schedule(filename.toString());
    });
    watcher.on("error", () => undefined);
    watchers.set(resolvedRoot, watcher);
  } catch {
    void watchDirectoryTree(resolvedRoot);
  }

  return {
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending.clear();
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}

/** Whether a directory can contain watched files, for the per-directory fallback. */
function directoryCouldMatter(relative: string, config: ContinuousConfig): boolean {
  const outDir = config.outDir.replaceAll("\\", "/").replace(/\/+$/, "");
  if (relative === outDir || relative.startsWith(`${outDir}/`)) return false;
  const segments = relative.split("/");
  return !segments.some((segment) => IGNORED_SEGMENTS.has(segment) || segment.startsWith("."));
}

// ---------------------------------------------------------------------------
// Orchestration

export interface ContinuousWatchHandle {
  close(): Promise<void>;
}

export interface ContinuousWatchOptions extends ContinuousBuildOptions {
  /** Called after every attempt, successful or not. */
  onBuild?: (result: ContinuousBuildResult) => void;
  /** Called when changes are detected, before the rebuild starts. */
  onChangesDetected?: (files: string[]) => void;
}

/**
 * The watch loop: build once, then rebuild on every debounced batch. Builds never
 * overlap — a batch that arrives mid-build is merged into one follow-up rebuild, so
 * a burst of saves costs one analysis, not one per save.
 */
export async function watchContinuousMap(
  root: string,
  config: ContinuousConfig,
  options: ContinuousWatchOptions = {},
): Promise<{ handle: ContinuousWatchHandle; initial: ContinuousBuildResult }> {
  const currentDir = path.join(
    path.isAbsolute(config.outDir) ? config.outDir : path.join(path.resolve(root), config.outDir),
    "current",
  );
  const initial = await buildContinuousMap(root, config, { ...options, trigger: options.trigger ?? ["watch-start"] });
  options.onBuild?.(initial);

  let building = false;
  let queued: Set<string> | undefined;
  let closed = false;

  const runBuild = async (files: string[]): Promise<void> => {
    building = true;
    try {
      while (!closed) {
        const result = await buildContinuousMap(root, config, { ...options, trigger: files });
        options.onBuild?.(result);
        if (!queued) break;
        files = [...queued].sort();
        queued = undefined;
      }
    } finally {
      building = false;
    }
  };

  const watcher = watchProject(root, config, (files) => {
    if (closed) return;
    options.onChangesDetected?.(files);
    if (building) {
      queued = new Set([...(queued ?? []), ...files]);
      return;
    }
    void markStale(currentDir, files).then(() => runBuild(files));
  });

  return {
    initial,
    handle: {
      close: async () => {
        closed = true;
        await watcher.close();
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Small helpers

async function readJsonIfPresent<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length || value.length === 0 ? items : undefined;
}

function clampInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
