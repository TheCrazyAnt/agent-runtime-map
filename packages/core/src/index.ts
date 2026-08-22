import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeTypeScriptProject } from "@agent-runtime-map/typescript";
import { compileLogicGraph, type CompileOptions } from "@agent-runtime-map/logic-compiler";
import { readProjectContext } from "@agent-runtime-map/project-reader";
import { enrichLogicGraphWithOpenAI, type OpenAISemanticOptions } from "@agent-runtime-map/semantic";
import type { LogicGraph, RawCodeGraph } from "@agent-runtime-map/schema";

export interface GenerateLogicMapOptions extends CompileOptions {
  outputFile?: string;
  rawOutputFile?: string | false;
  maxFiles?: number;
  maxContextFiles?: number;
  maxContextBytes?: number;
  readContext?: boolean;
  semantic?: OpenAISemanticOptions;
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

  const context = options.readContext === false
    ? undefined
    : await readProjectContext(root, {
      maxDocuments: options.maxContextFiles,
      maxTotalBytes: options.maxContextBytes,
      // A description the person supplied is a capability claim as well as a
      // summary; without this it only ever reached the summary.
      productDescription: options.productDescription,
    });
  const rawGraph = await analyzeTypeScriptProject(root, { maxFiles: options.maxFiles });
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
