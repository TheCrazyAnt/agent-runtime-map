import { parseArgs } from "node:util";
import { generateLogicMap } from "@agent-runtime-map/core";
import { openBrowser, startViewerServer } from "./server.js";

const VERSION = "0.1.0";

export async function run(argv = process.argv.slice(2)): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        out: { type: "string", short: "o" },
        "raw-out": { type: "string" },
        "no-raw": { type: "boolean" },
        "max-files": { type: "string" },
        "max-nodes": { type: "string" },
        "graph-type": { type: "string" },
        description: { type: "string" },
        port: { type: "string", short: "p" },
        host: { type: "string" },
        "no-open": { type: "boolean" },
        debug: { type: "boolean" },
      },
    });
  } catch (error) {
    process.stderr.write(`agent-runtime-map: ${error instanceof Error ? error.message : String(error)}\n\n${helpText()}`);
    return 1;
  }

  if (parsed.values.help) {
    process.stdout.write(helpText());
    return 0;
  }
  if (parsed.values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const first = parsed.positionals[0];
  const command = first === "analyze" || first === "serve" ? first : "serve";
  const projectPath = command === "serve" && first !== "serve" ? first ?? "." : parsed.positionals[1] ?? ".";
  const unexpected = command === "serve" && first !== "serve" ? parsed.positionals.slice(1) : parsed.positionals.slice(2);
  if (unexpected.length) {
    process.stderr.write(`agent-runtime-map: unexpected positional argument ${unexpected[0]}\n`);
    return 1;
  }
  const graphType = parsed.values["graph-type"] ?? "runtime_logic";
  if (graphType !== "runtime_logic" && graphType !== "product_logic") {
    process.stderr.write("agent-runtime-map: --graph-type must be runtime_logic or product_logic\n");
    return 1;
  }

  try {
    process.stdout.write(`Analyzing ${projectPath}...\n`);
    const result = await generateLogicMap(projectPath, {
      outputFile: parsed.values.out,
      rawOutputFile: parsed.values["no-raw"] ? false : parsed.values["raw-out"],
      maxFiles: positiveInteger(parsed.values["max-files"], "--max-files"),
      maxNodes: positiveInteger(parsed.values["max-nodes"], "--max-nodes"),
      graphType,
      productDescription: parsed.values.description,
    });

    process.stdout.write(
      [
        `Scanned ${result.rawGraph.project.filesScanned} files.`,
        `Found ${result.rawGraph.nodes.length} code nodes and ${result.rawGraph.edges.length} relationships.`,
        `Compiled ${result.graph.nodes.length} logic nodes and ${result.graph.edges.length} flows.`,
        `Logic graph: ${result.outputFile}`,
        result.rawOutputFile ? `Raw graph: ${result.rawOutputFile}` : undefined,
      ]
        .filter(Boolean)
        .join("\n") + "\n",
    );
    if (command === "analyze") return 0;

    const host = parsed.values.host ?? "127.0.0.1";
    const port = portNumber(parsed.values.port);
    const server = await startViewerServer({
      graphFile: result.outputFile,
      rawGraphFile: result.rawOutputFile,
      host,
      port,
    });
    process.stdout.write(`Viewer: ${server.url}\nPress Ctrl+C to stop.\n`);
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
      process.stdout.write(`Warning: the viewer is exposed on ${host}; its graph may contain source paths and code structure.\n`);
    }
    if (!parsed.values["no-open"] && !openBrowser(server.url)) {
      process.stdout.write(`Could not open a browser automatically. Open ${server.url} manually.\n`);
    }
    await waitForShutdown(server.close);
    return 0;
  } catch (error) {
    const message = error instanceof Error
      ? parsed.values.debug
        ? error.stack ?? error.message
        : error.message
      : String(error);
    process.stderr.write(`agent-runtime-map: ${message}\n`);
    return 1;
  }
}

function portNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("--port must be an integer between 1 and 65535");
  return port;
}

async function waitForShutdown(close: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolve) => {
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      void close().then(resolve, resolve);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

function positiveInteger(value: string | undefined, option: string): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${option} must be a positive integer`);
  return number;
}

function helpText(): string {
  return `Agent Runtime Map ${VERSION}

Turn your codebase into an evidence-backed logic map.

Usage:
  agent-runtime-map [project] [options]          Analyze and open the interactive viewer
  agent-runtime-map serve [project] [options]    Analyze and open the interactive viewer
  agent-runtime-map analyze [project] [options]  Generate JSON without starting a server

Alias: logic-map

Options:
  -o, --out <file>            Logic Graph output (default: .logic-map/graph.json)
      --raw-out <file>        Raw Code Graph output (default: .logic-map/raw-graph.json)
      --no-raw                Do not write the Raw Code Graph
      --max-files <number>    Maximum source files to analyze (default: 2000)
      --max-nodes <number>    Maximum compiled logic nodes (default: 20)
      --graph-type <type>     runtime_logic or product_logic
      --description <text>    Optional product context for the graph
  -p, --port <number>         Viewer port (default: 4173; increments if busy)
      --host <host>           Viewer host (default: 127.0.0.1)
      --no-open               Do not open the browser automatically
      --debug                 Print stack traces for failures
  -h, --help                  Show help
  -v, --version               Show version
`;
}

process.exitCode = await run();
