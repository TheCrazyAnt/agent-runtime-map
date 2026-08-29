import path from "node:path";
import { readFile } from "node:fs/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { generateLogicMap } from "@agent-runtime-map/core";
import type { LogicGraph } from "@agent-runtime-map/schema";
import {
  describeEvidence,
  describeFeature,
  findFeature,
  findNode,
  summarizeFeatures,
  summarizeProject,
} from "./summaries.js";

const NAME = "agent-runtime-map";
const VERSION = "0.8.2";

/**
 * One analyzed project, kept so the follow-up questions are free.
 *
 * Analysis walks a repository and runs a type checker over it; asking an agent to
 * pay that cost again to look at a second feature would push it toward reading one
 * big dump instead, which is the opposite of what these tools are for.
 */
interface Analyzed {
  root: string;
  graph: LogicGraph;
  rawNodeCount: number;
  analyzedAt: string;
}

const analyzed = new Map<string, Analyzed>();

function toolText(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function toolError(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

function resolveRoot(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("A project path is required.");
  return path.resolve(value.trim());
}

function requireAnalyzed(value: unknown): Analyzed {
  const explicit = typeof value === "string" && value.trim() ? path.resolve(value.trim()) : undefined;
  if (explicit) {
    const found = analyzed.get(explicit);
    if (!found) throw new Error(`${explicit} has not been analyzed yet. Call analyze_project first.`);
    return found;
  }
  if (analyzed.size === 1) return [...analyzed.values()][0]!;
  if (!analyzed.size) throw new Error("No project has been analyzed yet. Call analyze_project first.");
  throw new Error(`Several projects are analyzed; pass one of: ${[...analyzed.keys()].join(", ")}`);
}

const TOOLS = [
  {
    name: "analyze_project",
    description:
      "Read a repository and compile an evidence-backed map of what it does: entry points, Agents, workflows, tools, models, data stores, and outbound calls, grouped into feature circuits. Returns an overview; use describe_feature and get_evidence to go deeper. Analysis reads source but never executes it, and writes nothing into the project unless asked.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the repository to analyze." },
        maxNodes: { type: "number", description: "How many logic steps to keep after compression. Default 40." },
        description: { type: "string", description: "What the product does, in your words. Recorded as your claim, kept apart from what the code shows." },
        write: { type: "boolean", description: "Write .logic-map/graph.json into the project. Default false." },
      },
      required: ["path"],
    },
  },
  {
    name: "list_features",
    description: "List the feature circuits found in an already analyzed project, with health and step counts.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Analyzed project path. Optional when only one is analyzed." } },
    },
  },
  {
    name: "describe_feature",
    description: "Walk one feature's inferred route step by step, with the confidence and source location of each step, plus any Chain Doctor findings. The route is statically inferred, not a recorded run.",
    inputSchema: {
      type: "object",
      properties: {
        feature: { type: "string", description: "Feature id or label, as shown by analyze_project." },
        variant: { type: "string", description: "Variant id, when the feature has more than one inferred branch." },
        path: { type: "string", description: "Analyzed project path. Optional when only one is analyzed." },
      },
      required: ["feature"],
    },
  },
  {
    name: "get_evidence",
    description: "Show what one step was read from: source locations, how it was classified and how confidently, what the project's own documents claim about it, and optionally the source lines themselves.",
    inputSchema: {
      type: "object",
      properties: {
        node: { type: "string", description: "Node id or label, as shown by describe_feature." },
        includeSource: { type: "boolean", description: "Include the source lines behind the step. Default false." },
        path: { type: "string", description: "Analyzed project path. Optional when only one is analyzed." },
      },
      required: ["node"],
    },
  },
];

/** At most this many source lines, so one call cannot flood an agent's context. */
const MAX_SOURCE_LINES = 80;

/**
 * Reads the lines behind a step, under the same rule the Viewer's server follows: a
 * path is readable only because the graph already points at it, and only inside the
 * analyzed project. This is not a file-reading tool, and must never become one.
 */
async function readSource(entry: Analyzed, file: string, startLine: number, endLine?: number): Promise<string> {
  const allowed = new Set(entry.graph.nodes.flatMap((node) => node.sources.map((source) => source.file)));
  if (!allowed.has(file)) return `  (${file} is not referenced by this graph)`;
  const resolved = path.resolve(entry.root, file);
  if (resolved !== entry.root && !resolved.startsWith(`${entry.root}${path.sep}`)) {
    return "  (refused: outside the analyzed project)";
  }
  try {
    const lines = (await readFile(resolved, "utf8")).split(/\r?\n/);
    const from = Math.max(1, startLine - 2);
    const to = Math.min(lines.length, Math.max(endLine ?? startLine, startLine) + 2, from + MAX_SOURCE_LINES);
    return lines.slice(from - 1, to).map((text, index) => `  ${from + index} | ${text}`).join("\n");
  } catch {
    return `  (${file} could not be read)`;
  }
}

async function callTool(name: string, args: Record<string, unknown>) {
  if (name === "analyze_project") {
    const root = resolveRoot(args.path);
    const result = await generateLogicMap(root, {
      outputFile: args.write === true ? undefined : false,
      rawOutputFile: args.write === true ? undefined : false,
      maxNodes: typeof args.maxNodes === "number" ? args.maxNodes : undefined,
      productDescription: typeof args.description === "string" ? args.description : undefined,
    });
    const entry: Analyzed = {
      root,
      graph: result.graph,
      rawNodeCount: result.rawGraph.nodes.length,
      analyzedAt: new Date().toISOString(),
    };
    analyzed.set(root, entry);
    const written = result.outputFile ? `\n\nWritten to ${result.outputFile}` : "";
    return toolText(summarizeProject(entry.graph, entry.rawNodeCount) + written);
  }

  if (name === "list_features") {
    return toolText(summarizeFeatures(requireAnalyzed(args.path).graph));
  }

  if (name === "describe_feature") {
    const entry = requireAnalyzed(args.path);
    const key = typeof args.feature === "string" ? args.feature : "";
    const feature = findFeature(entry.graph, key);
    if (!feature) {
      return toolError(`No feature matches "${key}".\n\n${summarizeFeatures(entry.graph)}`);
    }
    return toolText(describeFeature(entry.graph, feature, typeof args.variant === "string" ? args.variant : undefined));
  }

  if (name === "get_evidence") {
    const entry = requireAnalyzed(args.path);
    const key = typeof args.node === "string" ? args.node : "";
    const node = findNode(entry.graph, key);
    if (!node) return toolError(`No step matches "${key}". Use describe_feature to see the steps of a feature.`);
    let text = describeEvidence(node);
    if (args.includeSource === true && node.sources[0]) {
      const source = node.sources[0];
      text += `\n\nSource lines:\n${await readSource(entry, source.file, source.startLine, source.endLine)}`;
    }
    return toolText(text);
  }

  throw new Error(`Unknown tool: ${name}`);
}

export async function startMcpServer(): Promise<void> {
  const server = new Server({ name: NAME, version: VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await callTool(request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>);
    } catch (error) {
      // A failure an agent can act on beats a stack trace it cannot.
      return toolError(error instanceof Error ? error.message : String(error));
    }
  });

  await server.connect(new StdioServerTransport());
}
