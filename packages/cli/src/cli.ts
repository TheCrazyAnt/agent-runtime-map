import { parseArgs } from "node:util";
import { generateLogicMap } from "@agent-runtime-map/core";
import { openBrowser, startViewerServer } from "./server.js";
import {
  cliText,
  helpText,
  isLocaleOption,
  localeArgument,
  localizedViewerUrl,
  resolveCliLocale,
  type CliText,
} from "./i18n.js";

const VERSION = "0.1.2";

export async function run(argv = process.argv.slice(2)): Promise<number> {
  const requestedLocale = localeArgument(argv);
  const locale = resolveCliLocale(requestedLocale);
  const text = cliText(locale);
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
        "max-context-files": { type: "string" },
        "max-context-bytes": { type: "string" },
        "no-context": { type: "boolean" },
        "max-nodes": { type: "string" },
        "graph-type": { type: "string" },
        description: { type: "string" },
        semantic: { type: "string" },
        "semantic-model": { type: "string" },
        "semantic-base-url": { type: "string" },
        locale: { type: "string" },
        port: { type: "string", short: "p" },
        host: { type: "string" },
        "no-open": { type: "boolean" },
        debug: { type: "boolean" },
      },
    });
  } catch (error) {
    process.stderr.write(`agent-runtime-map: ${error instanceof Error ? error.message : String(error)}\n\n${helpText(locale, VERSION)}`);
    return 1;
  }

  if (parsed.values.help) {
    process.stdout.write(helpText(locale, VERSION));
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
    process.stderr.write(`agent-runtime-map: ${text.unexpected(unexpected[0])}\n`);
    return 1;
  }
  if (!isLocaleOption(parsed.values.locale)) {
    process.stderr.write(`agent-runtime-map: ${text.localeInvalid}\n`);
    return 1;
  }
  const graphType = parsed.values["graph-type"] ?? "runtime_logic";
  if (graphType !== "runtime_logic" && graphType !== "product_logic") {
    process.stderr.write(`agent-runtime-map: ${text.graphTypeInvalid}\n`);
    return 1;
  }
  const semanticProvider = parsed.values.semantic;
  if (semanticProvider !== undefined && semanticProvider !== "openai") {
    process.stderr.write(`agent-runtime-map: ${text.semanticProviderInvalid}\n`);
    return 1;
  }
  if (semanticProvider === "openai" && !parsed.values["semantic-model"]) {
    process.stderr.write(`agent-runtime-map: ${text.semanticModelRequired}\n`);
    return 1;
  }
  if (semanticProvider === "openai" && !process.env.OPENAI_API_KEY) {
    process.stderr.write(`agent-runtime-map: ${text.semanticApiKeyMissing}\n`);
    return 1;
  }

  try {
    process.stdout.write(`${text.analyzing(projectPath)}\n`);
    const result = await generateLogicMap(projectPath, {
      outputFile: parsed.values.out,
      rawOutputFile: parsed.values["no-raw"] ? false : parsed.values["raw-out"],
      maxFiles: positiveInteger(parsed.values["max-files"], "--max-files", text),
      maxContextFiles: positiveInteger(parsed.values["max-context-files"], "--max-context-files", text),
      maxContextBytes: positiveInteger(parsed.values["max-context-bytes"], "--max-context-bytes", text),
      readContext: !parsed.values["no-context"],
      maxNodes: positiveInteger(parsed.values["max-nodes"], "--max-nodes", text),
      graphType,
      productDescription: parsed.values.description,
      semantic: semanticProvider === "openai" ? {
        apiKey: process.env.OPENAI_API_KEY!,
        model: parsed.values["semantic-model"]!,
        baseUrl: parsed.values["semantic-base-url"],
      } : undefined,
    });

    process.stdout.write(
      [
        text.scanned(result.rawGraph.project.filesScanned),
        result.rawGraph.context
          ? text.contextSummary(
            result.rawGraph.context.documents.length,
            result.rawGraph.context.prompts.length,
            result.rawGraph.context.capabilityHints.length,
          )
          : undefined,
        text.found(result.rawGraph.nodes.length, result.rawGraph.edges.length),
        text.compiled(result.graph.nodes.length, result.graph.edges.length),
        text.featureSummary(
          result.graph.features.length,
          result.graph.features.filter((feature) => feature.health === "error").length,
          result.graph.features.filter((feature) => feature.health === "warning").length,
        ),
        text.logicGraph(result.outputFile),
        result.rawOutputFile ? text.rawGraph(result.rawOutputFile) : undefined,
      ]
        .filter(Boolean)
        .join("\n") + "\n",
    );
    if (command === "analyze") return 0;

    const host = parsed.values.host ?? "127.0.0.1";
    const port = portNumber(parsed.values.port, text);
    const server = await startViewerServer({
      graphFile: result.outputFile,
      rawGraphFile: result.rawOutputFile,
      host,
      port,
    });
    const viewerUrl = localizedViewerUrl(server.url, parsed.values.locale);
    process.stdout.write(`${text.viewer(viewerUrl)}\n${text.stop}\n`);
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
      process.stdout.write(`${text.exposed(host)}\n`);
    }
    if (!parsed.values["no-open"] && !openBrowser(viewerUrl)) {
      process.stdout.write(`${text.openFailed(viewerUrl)}\n`);
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

function portNumber(value: string | undefined, text: CliText): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(text.portInvalid);
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

function positiveInteger(value: string | undefined, option: string, text: CliText): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(text.positiveInteger(option));
  return number;
}

process.exitCode = await run();
