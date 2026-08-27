import path from "node:path";
import {
  buildContinuousMap,
  initContinuousProject,
  loadContinuousConfig,
  watchContinuousMap,
  type ContinuousBuildResult,
  type GenerateLogicMapOptions,
  type LogicGraph,
} from "@agent-runtime-map/core";
import { openBrowser, resolveViewerDirectory, startViewerServer } from "./server.js";
import { localizedViewerUrl, type CliText } from "./i18n.js";

/**
 * The continuous commands: `init` writes configuration, `build` produces one
 * versioned map, `watch` keeps it current and serves the Viewer over it. All three
 * are thin wrappers over `@agent-runtime-map/core`; the CLI owns only the terminal
 * output and the Viewer server.
 */

export async function runInit(projectPath: string, text: CliText): Promise<number> {
  const result = await initContinuousProject(projectPath);
  if (result.created) process.stdout.write(`${text.initCreated(result.configFile)}\n`);
  else if (result.addedKeys.length) process.stdout.write(`${text.initCompleted(result.configFile, result.addedKeys.join(", "))}\n`);
  else process.stdout.write(`${text.initUnchanged(result.configFile)}\n`);
  const scripts = Object.entries(result.suggestedScripts)
    .map(([name, command]) => `  "${name}": "${command}"`)
    .join("\n");
  process.stdout.write(`${text.initScripts(scripts)}\n`);
  return 0;
}

export interface ContinuousCommandOptions {
  analyzeOptions: GenerateLogicMapOptions;
  toolVersion: string;
  host?: string;
  port?: number;
  open?: boolean;
  localeParam?: string;
}

export async function runContinuousBuild(
  projectPath: string,
  options: ContinuousCommandOptions,
  text: CliText,
): Promise<number> {
  const { config, warning } = await loadContinuousConfig(projectPath);
  if (warning) process.stderr.write(`${text.configWarning(warning)}\n`);
  const result = await buildContinuousMap(projectPath, config, {
    analyzeOptions: options.analyzeOptions,
    toolVersion: options.toolVersion,
    viewerAssetsDir: await resolveViewerDirectory().catch(() => undefined),
  });
  printBuildResult(result, text);
  if (result.ok && !result.unchanged) {
    process.stdout.write(`${text.reportHint(path.join(result.currentDir, "report.html"))}\n`);
  }
  return result.ok ? 0 : 1;
}

export async function runContinuousWatch(
  projectPath: string,
  options: ContinuousCommandOptions,
  text: CliText,
): Promise<number> {
  const { config, warning } = await loadContinuousConfig(projectPath);
  if (warning) process.stderr.write(`${text.configWarning(warning)}\n`);

  // The allow-list follows the latest successful map, so a file that joins the
  // graph becomes previewable without restarting the watcher — and nothing else does.
  let allowList: string[] = [];
  const handleBuild = (result: ContinuousBuildResult) => {
    if (result.ok && result.graph) allowList = sourceAllowList(result.graph);
    printBuildResult(result, text);
  };

  const { handle, initial } = await watchContinuousMap(projectPath, config, {
    analyzeOptions: options.analyzeOptions,
    toolVersion: options.toolVersion,
    viewerAssetsDir: await resolveViewerDirectory().catch(() => undefined),
    onChangesDetected: (files) => process.stdout.write(`${text.watchChanges(files.length)}\n`),
    onBuild: handleBuild,
  });
  if (!initial.ok) {
    // The first build failing is not fatal to watching: the map catches up on the
    // next successful analysis, exactly as it would mid-session.
    process.stdout.write(`${text.watchStarted(initial.currentDir)}\n`);
  }

  const server = await startViewerServer({
    graphFile: path.join(initial.currentDir, "graph.json"),
    rawGraphFile: path.join(initial.currentDir, "raw-graph.json"),
    currentDir: initial.currentDir,
    projectRoot: path.resolve(projectPath),
    sourceFiles: () => allowList,
    host: options.host,
    port: options.port,
  });
  const viewerUrl = localizedViewerUrl(server.url, options.localeParam);
  process.stdout.write(`${text.watchStarted(initial.currentDir)}\n${text.viewer(viewerUrl)}\n${text.stop}\n`);
  if (options.open !== false && !openBrowser(viewerUrl)) {
    process.stdout.write(`${text.openFailed(viewerUrl)}\n`);
  }

  await new Promise<void>((resolve) => {
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      void handle.close().then(() => server.close()).then(resolve, resolve);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  return 0;
}

function printBuildResult(result: ContinuousBuildResult, text: CliText): void {
  if (!result.ok) {
    process.stderr.write(`${text.buildFailed(result.error ?? "unknown")}\n`);
    return;
  }
  if (result.unchanged) {
    process.stdout.write(`${text.buildUnchanged(result.buildId ?? "")}\n`);
    return;
  }
  process.stdout.write(`${text.buildUpdated(result.currentDir, result.buildId ?? "", result.durationMs)}\n`);
  if (result.changes && !result.changes.initial) {
    process.stdout.write(`${text.changesSummary(
      result.changes.nodes.added.length,
      result.changes.nodes.removed.length,
      result.changes.nodes.modified.length,
      result.changes.affectedFeatures.length,
    )}\n`);
  }
}

function sourceAllowList(graph: LogicGraph): string[] {
  return [...new Set([
    ...graph.nodes.flatMap((node) => node.sources.map((source) => source.file)),
    ...graph.nodes.flatMap((node) => node.product?.sources.map((source) => source.file) ?? []),
    ...graph.features.flatMap((feature) => feature.product?.sources.map((source) => source.file) ?? []),
  ])];
}
