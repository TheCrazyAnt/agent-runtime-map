import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeTypeScriptProject } from "@agent-runtime-map/typescript";
import { analyzePythonProject } from "@agent-runtime-map/python";
import { compileLogicGraph, type CompileOptions } from "@agent-runtime-map/logic-compiler";
import { readProjectContext } from "@agent-runtime-map/project-reader";
import { enrichLogicGraphWithOpenAI, type OpenAISemanticOptions } from "@agent-runtime-map/semantic";
import type { LogicGraph, RawCodeGraph } from "@agent-runtime-map/schema";

export interface GenerateLogicMapOptions extends CompileOptions {
  /**
   * Where to write the Logic Graph, or `false` to write nothing. A caller analyzing
   * someone else's repository on their behalf should not leave files in it.
   */
  outputFile?: string | false;
  rawOutputFile?: string | false;
  maxFiles?: number;
  maxContextFiles?: number;
  maxContextBytes?: number;
  readContext?: boolean;
  /** Interpreter for the Python adapter. Defaults to `python3`, then `python`. */
  pythonPath?: string;
  semantic?: OpenAISemanticOptions;
}

export interface GenerateLogicMapResult {
  graph: LogicGraph;
  rawGraph: RawCodeGraph;
  /** Absent when the caller asked for nothing to be written. */
  outputFile?: string;
  rawOutputFile?: string;
}

export async function generateLogicMap(
  projectPath: string,
  options: GenerateLogicMapOptions = {},
): Promise<GenerateLogicMapResult> {
  const root = path.resolve(projectPath);
  const details = await stat(root).catch(() => undefined);
  if (!details?.isDirectory()) throw new Error(`Project path does not exist or is not a directory: ${root}`);
  const outputFile = options.outputFile === false
    ? undefined
    : resolveOutput(root, options.outputFile ?? ".logic-map/graph.json");
  const rawOutputFile =
    options.rawOutputFile === false
      ? undefined
      : resolveOutput(root, options.rawOutputFile ?? ".logic-map/raw-graph.json");

  const context = options.readContext === false
    ? undefined
    : await readProjectContext(root, {
      maxDocuments: options.maxContextFiles,
      maxTotalBytes: options.maxContextBytes,
      // A description the person supplied is a capability claim as well as a
      // summary; without this it only ever reached the summary.
      productDescription: options.productDescription,
    });
  // Every adapter produces the same Raw Code Graph, so a project that mixes
  // languages produces one map rather than one map per language.
  const [typescriptGraph, pythonGraph] = await Promise.all([
    analyzeTypeScriptProject(root, { maxFiles: options.maxFiles }),
    analyzePythonProject(root, { maxFiles: options.maxFiles, pythonPath: options.pythonPath }),
  ]);
  const rawGraph = mergeRawGraphs(typescriptGraph, pythonGraph);
  if (context) {
    const codePrompts = rawGraph.nodes.filter((node) => node.kind === "prompt").flatMap((node) => {
      const source = node.evidence[0]?.source;
      const excerpt = typeof node.metadata?.excerpt === "string" ? node.metadata.excerpt : undefined;
      if (!source || !excerpt) return [];
      return [{
        path: source.file,
        name: node.name,
        excerpt,
        variables: Array.isArray(node.metadata?.variables)
          ? node.metadata.variables.filter((value): value is string => typeof value === "string")
          : [],
        source: "code" as const,
      }];
    });
    const promptKeys = new Set(context.prompts.map((prompt) => `${prompt.path}:${prompt.name}`));
    context.prompts.push(...codePrompts.filter((prompt) => !promptKeys.has(`${prompt.path}:${prompt.name}`)));
    rawGraph.context = context;
    rawGraph.diagnostics.push(...context.diagnostics);
  }
  let graph = compileLogicGraph(rawGraph, options);
  if (options.semantic) graph = await enrichLogicGraphWithOpenAI(rawGraph, graph, options.semantic);

  if (outputFile) await writeJson(outputFile, graph);
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

/**
 * Joins the adapters' graphs into one. Ids are content-hashed from paths that cannot
 * collide across languages, so this is a concatenation rather than a reconciliation —
 * and deliberately so: a merge step that had to resolve conflicts would be a place
 * for facts to get quietly rewritten.
 */
function mergeRawGraphs(primary: RawCodeGraph, secondary: RawCodeGraph): RawCodeGraph {
  if (!secondary.nodes.length && !secondary.diagnostics.length) return primary;
  return {
    ...primary,
    project: {
      ...primary.project,
      languages: [...new Set([...primary.project.languages, ...secondary.project.languages])],
      frameworks: [...new Set([...primary.project.frameworks, ...secondary.project.frameworks])],
      filesScanned: primary.project.filesScanned + secondary.project.filesScanned,
    },
    nodes: [...primary.nodes, ...secondary.nodes],
    edges: [...primary.edges, ...secondary.edges],
    diagnostics: [...primary.diagnostics, ...secondary.diagnostics],
  };
}

export * from "./continuous.js";
