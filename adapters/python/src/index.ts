import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCHEMA_VERSION,
  type Diagnostic,
  type Evidence,
  type RawCodeEdge,
  type RawCodeGraph,
  type RawCodeNode,
  type RawNodeKind,
} from "@agent-runtime-map/schema";
import {
  CALLABLE_NODE_KINDS,
  classifyDeclaration,
  dedupeById,
  discoverSourceFiles,
  evidence,
  firstSentence,
  languageForFile,
  makeEdge,
  relativePath,
  stableId,
  templateVariables,
} from "@agent-runtime-map/analysis-kit";
import type { PythonCall, PythonFacts, PythonFile } from "./facts.js";

const SOURCE_EXTENSIONS = new Set([".py"]);
const EXCLUDED_FILE_PATTERN = /(^test_.*\.py$|_test\.py$|^conftest\.py$|\.pyi$)/i;

/** Decorators that register an HTTP route, by the framework that defines them. */
const ROUTE_DECORATOR = /^(app|router|api|server|[a-z_]*(?:router|app|api))\.(get|post|put|patch|delete|head|options)$/i;
/** Constructors whose result is an HTTP application or router. */
const ROUTE_APP_FACTORIES = /^(FastAPI|APIRouter|Flask|Blueprint|Quart|Starlette|Sanic)$/;

const MODEL_CALL = /(^|\.)((responses|chat\.completions|completions|messages|embeddings)\.create|generate_content|invoke|ainvoke)$/;

export interface PythonAnalyzerOptions {
  maxFiles?: number;
  /** Interpreter to run the extractor with. Defaults to `python3`, then `python`. */
  pythonPath?: string;
}

/**
 * Produces the same Raw Code Graph as every other adapter.
 *
 * Parsing is delegated to Python's own `ast` module, because a hand-rolled parser
 * for an indentation-sensitive grammar would produce guesses dressed as facts —
 * exactly what this graph must not contain. `ast.parse` builds a tree; it does not
 * import or execute the code being read. Nothing Python-shaped reaches the protocol:
 * decorators, dunders, and `self` are read here and discarded, and what comes out is
 * the same node kinds, edge kinds, and evidence every other adapter emits.
 */
export async function analyzePythonProject(
  inputRoot: string,
  options: PythonAnalyzerOptions = {},
): Promise<RawCodeGraph> {
  const root = path.resolve(inputRoot);
  const diagnostics: Diagnostic[] = [];
  const allFiles = await discoverSourceFiles(root, SOURCE_EXTENSIONS, EXCLUDED_FILE_PATTERN);
  const maxFiles = options.maxFiles ?? 2_000;
  const sourcePaths = allFiles.slice(0, maxFiles);

  if (allFiles.length > maxFiles) {
    diagnostics.push({
      level: "warning",
      code: "FILE_LIMIT_REACHED",
      message: `Found ${allFiles.length} Python files; only the first ${maxFiles} were analyzed.`,
    });
  }

  const nodes: RawCodeNode[] = [];
  const edges: RawCodeEdge[] = [];
  let facts: PythonFacts | undefined;

  if (sourcePaths.length) {
    facts = await runExtractor(sourcePaths, options.pythonPath, diagnostics);
  }

  const declarations = new Map<string, RawCodeNode>();
  for (const file of facts?.files ?? []) {
    if (file.error) {
      // A file the interpreter itself cannot parse is reported, never guessed at.
      diagnostics.push({
        level: "warning",
        code: "PYTHON_FILE_UNREADABLE",
        message: `${relativePath(root, file.path)}: ${file.error}`,
      });
      continue;
    }
    collectFile(file, root, nodes, edges, declarations);
  }

  for (const file of facts?.files ?? []) {
    if (!file.error) collectRelations(file, root, nodes, edges, declarations);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    project: {
      name: path.basename(root),
      root,
      languages: sourcePaths.length ? ["python"] : [],
      frameworks: await detectFrameworks(root, facts),
      filesScanned: facts?.files.filter((file) => !file.error).length ?? 0,
    },
    nodes: dedupeById(nodes),
    edges: dedupeById(edges).filter((edge) => edge.source !== edge.target),
    diagnostics,
  };
}

function collectFile(
  file: PythonFile,
  root: string,
  nodes: RawCodeNode[],
  edges: RawCodeEdge[],
  declarations: Map<string, RawCodeNode>,
): void {
  const relativeFile = relativePath(root, file.path);
  const fileId = stableId("file", relativeFile);
  const entry = isEntrypoint(relativeFile);
  const fileEvidence = [evidence(
    relativeFile,
    1,
    "path_heuristic",
    entry ? "Framework entrypoint convention" : "Source file discovered",
    entry ? 0.86 : 1,
  )];
  nodes.push({
    id: fileId,
    kind: entry ? "entrypoint" : "file",
    name: relativeFile,
    qualifiedName: relativeFile,
    language: "python",
    evidence: fileEvidence,
  });

  for (const declaration of file.classes) {
    const id = stableId("class", `${relativeFile}:${declaration.name}:${declaration.line}`);
    const itemEvidence = [evidence(relativeFile, declaration.line, "ast", "Class declaration", 1, declaration.name, declaration.endLine)];
    const node: RawCodeNode = {
      id,
      kind: "class",
      name: declaration.name,
      qualifiedName: `${relativeFile}#${declaration.name}`,
      description: declaration.docstring ? firstSentence(declaration.docstring) : undefined,
      language: "python",
      metadata: { bases: declaration.bases },
      evidence: itemEvidence,
    };
    nodes.push(node);
    edges.push(makeEdge(fileId, id, "contains", itemEvidence));
    declarations.set(declaration.name, node);
  }

  for (const declaration of file.functions) {
    const route = routeFromDecorators(declaration.decorators, file);
    const classification = classifyDeclaration({
      relativeFile,
      name: declaration.name,
      // A leading underscore is Python's way of saying "implementation detail".
      internal: Boolean(declaration.enclosingClass) && declaration.name.startsWith("_"),
      enclosingClass: declaration.enclosingClass ?? undefined,
      routeConvention: Boolean(route),
    });
    const id = stableId(classification.kind, `${relativeFile}:${declaration.name}:${declaration.line}`);
    const itemEvidence = [evidence(
      relativeFile,
      declaration.line,
      classification.method,
      route ? `${classification.detail} via ${route.decorator}` : classification.detail,
      classification.confidence,
      declaration.name,
      declaration.endLine,
    )];
    const node: RawCodeNode = {
      id,
      kind: classification.kind,
      name: route ? `${route.method} ${route.path}` : declaration.name,
      qualifiedName: `${relativeFile}#${declaration.name}`,
      description: declaration.docstring ? firstSentence(declaration.docstring) : undefined,
      language: "python",
      metadata: {
        ...(route ? { method: route.method, path: route.path, framework: route.framework } : {}),
        async: declaration.isAsync,
        parameters: declaration.parameters.filter((name) => name !== "self" && name !== "cls"),
        returnType: declaration.returns ?? undefined,
        branches: declaration.branches,
        loops: declaration.loops,
        catches: declaration.catches,
      },
      evidence: itemEvidence,
    };
    nodes.push(node);
    edges.push(makeEdge(fileId, id, "contains", itemEvidence));
    declarations.set(declaration.name, node);
  }

  for (const assignment of file.assignments) {
    if (assignment.scope) continue;
    const promptText = promptLiteral(assignment.name, assignment.text);
    if (promptText) {
      const id = stableId("prompt", `${relativeFile}:${assignment.name}:${assignment.line}`);
      const itemEvidence = [evidence(relativeFile, assignment.line, "name_heuristic", "Prompt or instructions constant", 0.88, assignment.name, assignment.endLine)];
      const node: RawCodeNode = {
        id,
        kind: "prompt",
        name: assignment.name,
        qualifiedName: `${relativeFile}#${assignment.name}`,
        description: firstSentence(promptText),
        language: "python",
        metadata: { excerpt: promptText.slice(0, 4_000), variables: templateVariables(promptText) },
        evidence: itemEvidence,
      };
      nodes.push(node);
      edges.push(makeEdge(fileId, id, "contains", itemEvidence));
      declarations.set(assignment.name, node);
      continue;
    }

    const semantic = semanticConstruct(assignment.name, assignment.factory);
    if (!semantic) continue;
    const id = stableId(semantic.kind, `${relativeFile}:${assignment.name}:${assignment.line}`);
    const itemEvidence = [evidence(relativeFile, assignment.line, semantic.method, semantic.detail, semantic.confidence, assignment.name, assignment.endLine)];
    const options = assignment.options ?? {};
    const instructions = stringOption(options, "instructions") ?? stringOption(options, "system_prompt") ?? stringOption(options, "prompt");
    const model = stringOption(options, "model");
    const node: RawCodeNode = {
      id,
      kind: semantic.kind,
      name: stringOption(options, "name") ?? assignment.name,
      qualifiedName: `${relativeFile}#${assignment.name}`,
      description: stringOption(options, "description") ?? stringOption(options, "goal") ?? (instructions ? firstSentence(instructions) : undefined),
      language: "python",
      metadata: {
        factory: assignment.factory ?? undefined,
        role: stringOption(options, "role"),
        instructions: instructions?.slice(0, 2_000),
        model,
        toolNames: nameOption(options, "tools"),
        taskNames: nameOption(options, "tasks"),
      },
      evidence: itemEvidence,
    };
    nodes.push(node);
    edges.push(makeEdge(fileId, id, "contains", itemEvidence));
    declarations.set(assignment.name, node);
  }
}

function collectRelations(
  file: PythonFile,
  root: string,
  nodes: RawCodeNode[],
  edges: RawCodeEdge[],
  declarations: Map<string, RawCodeNode>,
): void {
  const relativeFile = relativePath(root, file.path);

  for (const call of file.calls) {
    const caller = call.enclosingFunction ? declarations.get(call.enclosingFunction) : undefined;
    if (!caller) continue;
    const control = controlFor(call);
    const callEvidence = [evidence(relativeFile, call.line, "ast", `Calls ${call.callee}`, 0.96, call.enclosingFunction ?? undefined)];

    const target = lookup(declarations, call.callee);
    if (target && target.id !== caller.id) {
      // `PROMPT.format(...)` names a prompt, not a callable. Reading it as a call
      // would put a step on the map that nothing actually executes.
      if (CALLABLE_NODE_KINDS.has(target.kind)) {
        edges.push(makeEdge(caller.id, target.id, "calls", callEvidence, { control }));
      } else if (target.kind === "prompt" || target.kind === "model") {
        edges.push(makeEdge(target.id, caller.id, "data_flow", [
          evidence(relativeFile, call.line, "ast", `${target.name} is used by ${caller.name}`, 0.92),
        ], { label: target.kind }));
      }
    }

    // A value handed to another call still runs, exactly as in the other adapters.
    for (const name of call.nameArguments) {
      const handed = lookup(declarations, name);
      if (!handed || handed.id === caller.id || handed.id === target?.id) continue;
      if (handed.kind === "prompt" || handed.kind === "model") {
        edges.push(makeEdge(handed.id, caller.id, "data_flow", [
          evidence(relativeFile, call.line, "ast", `${handed.name} is passed into ${call.callee}`, 0.94),
        ], { label: handed.kind }));
        continue;
      }
      edges.push(makeEdge(caller.id, handed.id, "calls", [
        evidence(relativeFile, call.line, "ast", `${handed.name} is handed to ${call.callee} as a callback`, 0.9),
      ], { control }));
    }

    if (MODEL_CALL.test(call.callee)) {
      const model = stringOption(call.options, "model");
      if (model) {
        const modelId = stableId("model", model);
        const modelEvidence = [evidence(relativeFile, call.line, "framework_convention", `${call.callee} requests model ${model}`, 0.96, call.enclosingFunction ?? undefined)];
        nodes.push({
          id: modelId,
          kind: "model",
          name: model,
          qualifiedName: `model:${model}`,
          language: "python",
          metadata: { model },
          evidence: modelEvidence,
        });
        edges.push(makeEdge(caller.id, modelId, "requests", modelEvidence, { label: "model" }));
      }
      for (const promptName of nameOption(call.options, "input").concat(nameOption(call.options, "messages"), nameOption(call.options, "prompt"))) {
        const prompt = lookup(declarations, promptName);
        if (prompt?.kind !== "prompt") continue;
        edges.push(makeEdge(prompt.id, caller.id, "data_flow", [
          evidence(relativeFile, call.line, "framework_convention", `${caller.name} sends ${prompt.name} to the model`, 0.96),
        ], { label: "prompt" }));
      }
    }

    const database = databaseCall(call.callee);
    if (database) {
      const databaseId = stableId("database", database.key);
      const databaseEvidence = [evidence(relativeFile, call.line, "name_heuristic", `Recognized database operation ${call.callee}`, 0.88)];
      nodes.push({
        id: databaseId,
        kind: "database",
        name: database.label,
        qualifiedName: database.key,
        language: "python",
        metadata: { operation: database.operation },
        evidence: databaseEvidence,
      });
      edges.push(makeEdge(caller.id, databaseId, database.edgeKind, databaseEvidence, { control }));
    }

    const external = externalCall(call);
    if (external) {
      const externalId = stableId("external_api", external.key);
      const externalEvidence = [evidence(relativeFile, call.line, "name_heuristic", `Outbound request through ${call.callee}`, 0.9)];
      nodes.push({
        id: externalId,
        kind: "external_api",
        name: external.label,
        qualifiedName: external.key,
        language: "python",
        metadata: external.metadata,
        evidence: externalEvidence,
      });
      edges.push(makeEdge(caller.id, externalId, "requests", externalEvidence, { control }));
    }
  }
}

/** Runs the bundled extractor. A missing interpreter degrades, it does not fail. */
async function runExtractor(
  paths: string[],
  pythonPath: string | undefined,
  diagnostics: Diagnostic[],
): Promise<PythonFacts | undefined> {
  let script: string;
  try {
    script = await readExtractor();
  } catch (error) {
    diagnostics.push({
      level: "warning",
      code: "PYTHON_EXTRACTOR_MISSING",
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
  const candidates = pythonPath ? [pythonPath] : ["python3", "python"];
  let lastError = "";
  for (const interpreter of candidates) {
    try {
      return await runOnce(interpreter, script, paths);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  diagnostics.push({
    level: "warning",
    code: "PYTHON_UNAVAILABLE",
    message: `Python source was found but no interpreter could analyze it (${lastError}). Install Python 3 or pass a path to analyze these files.`,
  });
  return undefined;
}

function runOnce(interpreter: string, script: string, paths: string[]): Promise<PythonFacts> {
  return new Promise((resolve, reject) => {
    const child = spawn(interpreter, ["-c", script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => reject(new Error(`${interpreter}: ${error.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${interpreter} exited with ${code}: ${stderr.trim().slice(0, 200)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as PythonFacts);
      } catch {
        reject(new Error(`${interpreter} returned output that was not valid JSON`));
      }
    });
    child.stdin.end(JSON.stringify(paths));
  });
}

/**
 * The CLI bundles every workspace module into a single file, so at runtime this
 * module lives in the CLI's `dist`, not the adapter's. Both layouts are tried, and a
 * missing extractor is reported rather than silently producing an empty graph.
 */
async function readExtractor(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", "scripts", "extract.py"),
    path.join(here, "python", "extract.py"),
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // Try the next layout.
    }
  }
  throw new Error("the bundled Python extractor is missing from this installation");
}

interface RouteConvention {
  method: string;
  path: string;
  framework: string;
  decorator: string;
}

function routeFromDecorators(decorators: string[], file: PythonFile): RouteConvention | undefined {
  for (const decorator of decorators) {
    const match = ROUTE_DECORATOR.exec(decorator);
    if (!match) continue;
    const owner = match[1]!;
    const method = match[2]!.toUpperCase();
    const call = file.calls.find((item) => item.callee === decorator && item.stringArguments.length);
    const routePath = call?.stringArguments[0] ?? "/";
    return { method, path: routePath, framework: frameworkForOwner(owner, file), decorator };
  }
  return undefined;
}

function frameworkForOwner(owner: string, file: PythonFile): string {
  const built = file.assignments.find((item) => item.name === owner && item.factory && ROUTE_APP_FACTORIES.test(item.factory));
  if (!built?.factory) return "python_http";
  return built.factory === "Flask" || built.factory === "Blueprint" ? "flask" : built.factory.toLowerCase();
}

interface SemanticConstruct {
  kind: Extract<RawNodeKind, "agent" | "workflow" | "tool" | "model" | "human_gate">;
  confidence: number;
  detail: string;
  method: Evidence["method"];
}

function semanticConstruct(name: string, factory: string | null | undefined): SemanticConstruct | undefined {
  const normalized = `${factory ?? ""} ${name}`.toLowerCase();
  const framework = /stategraph|messagegraph|create_react_agent|createagent|\bagent\(|\bcrew\(|crewai|\btask\(|\btool\(|chatopenai|chatanthropic|assistant/.test(normalized);
  const make = (kind: SemanticConstruct["kind"], detail: string, confidence = framework ? 0.96 : 0.82): SemanticConstruct => ({
    kind,
    confidence,
    detail,
    method: framework ? "framework_convention" : "name_heuristic",
  });
  if (/chatopenai|chatanthropic|azurechatopenai|generativemodel|language_?model/.test(normalized)) return make("model", `Recognized model construction through ${factory}`);
  if (/stategraph|messagegraph|workflow|orchestrator|pipeline|\bcrew\b/.test(normalized)) return make("workflow", `Recognized workflow construction through ${factory ?? name}`);
  if (/structuredtool|\btool\b/.test(normalized)) return make("tool", `Recognized tool construction through ${factory ?? name}`);
  if (/human_?approval|human_?review|approval_?gate|interrupt_before/.test(normalized)) return make("human_gate", `Recognized human approval gate through ${factory ?? name}`, 0.86);
  if (/create_react_agent|createagent|\bagent\b/.test(normalized)) return make("agent", `Recognized Agent construction through ${factory ?? name}`);
  return undefined;
}

function controlFor(call: PythonCall): "sequential" | "conditional" | "loop" | "fallback" | "retry" {
  if (/retry|backoff/i.test(call.callee)) return "retry";
  return "sequential";
}

function promptLiteral(name: string, text: string | null | undefined): string | undefined {
  if (!text || text.length < 24) return undefined;
  return /prompt|instruction|system|template|persona/i.test(name) ? text : undefined;
}

function stringOption(options: PythonCall["options"], key: string): string | undefined {
  const option = options?.[key];
  return option?.kind === "string" ? option.value : undefined;
}

function nameOption(options: PythonCall["options"], key: string): string[] {
  const option = options?.[key];
  return option?.kind === "names" ? option.value : [];
}

function lastSegment(callee: string): string {
  return callee.split(".").at(-1) ?? callee;
}

/**
 * A reference reaches the graph as written: `send`, `client.send`, or
 * `PROMPT.format`. The declaration can be at either end of the dotted name, so both
 * are tried before giving up rather than silently dropping the relation.
 */
function lookup(declarations: Map<string, RawCodeNode>, name: string): RawCodeNode | undefined {
  const segments = name.split(".");
  return declarations.get(name)
    ?? declarations.get(segments.at(-1) ?? name)
    ?? declarations.get(segments[0] ?? name);
}

function databaseCall(callee: string): { key: string; label: string; operation: string; edgeKind: "reads" | "writes" } | undefined {
  const method = lastSegment(callee).toLowerCase();
  const reads = ["all", "filter", "first", "get", "query", "scalar", "select", "fetchall", "fetchone", "find", "find_one"];
  const writes = ["add", "bulk_save_objects", "commit", "create", "delete", "insert", "save", "update", "upsert", "insert_one", "update_one"];
  if (!reads.includes(method) && !writes.includes(method)) return undefined;
  const owner = callee.split(".").slice(0, -1).join(".") || "database";
  if (!/session|db|database|repo|repository|table|collection|cursor|conn/i.test(owner)) return undefined;
  return {
    key: `db:${owner}`,
    label: `${owner} data`,
    operation: method,
    edgeKind: writes.includes(method) ? "writes" : "reads",
  };
}

function externalCall(call: PythonCall): { key: string; label: string; metadata: Record<string, unknown> } | undefined {
  if (!/^(requests|httpx|aiohttp|urllib\.request)\.[a-z]+$/i.test(call.callee)) return undefined;
  const url = call.stringArguments.find((value) => /^https?:\/\//.test(value));
  const host = url ? safeHost(url) : call.callee.split(".")[0]!;
  return { key: `http:${host}`, label: host, metadata: { host, url, client: call.callee.split(".")[0] } };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function isEntrypoint(relativeFile: string): boolean {
  return /(^|\/)(main|app|__main__|server|asgi|wsgi|manage)\.py$/i.test(relativeFile);
}

async function detectFrameworks(root: string, facts: PythonFacts | undefined): Promise<string[]> {
  const frameworks = new Set<string>();
  const known: Record<string, string> = {
    fastapi: "FastAPI",
    flask: "Flask",
    django: "Django",
    starlette: "Starlette",
    langgraph: "LangGraph",
    langchain: "LangChain",
    crewai: "CrewAI",
    llama_index: "LlamaIndex",
    autogen: "AutoGen",
    openai: "OpenAI SDK",
    anthropic: "Anthropic SDK",
    pydantic_ai: "Pydantic AI",
  };
  for (const file of facts?.files ?? []) {
    for (const item of file.imports ?? []) {
      const top = item.module.split(".")[0]?.toLowerCase() ?? "";
      const label = known[top];
      if (label) frameworks.add(label);
    }
  }
  for (const manifest of ["requirements.txt", "pyproject.toml"]) {
    try {
      const text = (await readFile(path.join(root, manifest), "utf8")).toLowerCase();
      for (const [dependency, label] of Object.entries(known)) {
        if (text.includes(dependency.replace("_", "-")) || text.includes(dependency)) frameworks.add(label);
      }
    } catch {
      // A manifest is optional; imports are the stronger signal anyway.
    }
  }
  return [...frameworks];
}

export { languageForFile };
