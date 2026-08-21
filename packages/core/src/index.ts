import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeTypeScriptProject } from "@agent-runtime-map/typescript";
import { compileLogicGraph, type CompileOptions } from "@agent-runtime-map/logic-compiler";
import type { LogicGraph, RawCodeGraph } from "@agent-runtime-map/schema";

export interface GenerateLogicMapOptions extends CompileOptions {
  outputFile?: string;
  rawOutputFile?: string | false;
  maxFiles?: number;
}

export interface GenerateLogicMapResult {
  graph: LogicGraph;
  rawGraph: RawCodeGraph;
  outputFile: string;
  rawOutputFile?: string;
}

export async function generateLogicMap(
  projectPath: string,
  options: GenerateLogicMapOptions = {},
): Promise<GenerateLogicMapResult> {
  const root = path.resolve(projectPath);
  const details = await stat(root).catch(() => undefined);
  if (!details?.isDirectory()) throw new Error(`Project path does not exist or is not a directory: ${root}`);
  const outputFile = resolveOutput(root, options.outputFile ?? ".logic-map/graph.json");
  const rawOutputFile =
    options.rawOutputFile === false
      ? undefined
      : resolveOutput(root, options.rawOutputFile ?? ".logic-map/raw-graph.json");

  const rawGraph = await analyzeTypeScriptProject(root, { maxFiles: options.maxFiles });
  const graph = compileLogicGraph(rawGraph, options);

  await writeJson(outputFile, graph);
  if (rawOutputFile) await writeJson(rawOutputFile, rawGraph);

  return { graph, rawGraph, outputFile, rawOutputFile };
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveOutput(root: string, file: string): string {
  return path.isAbsolute(file) ? file : path.resolve(root, file);
}

export type { CompileOptions } from "@agent-runtime-map/logic-compiler";
export type { LogicGraph, RawCodeGraph } from "@agent-runtime-map/schema";
