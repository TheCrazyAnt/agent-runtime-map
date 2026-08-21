import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  Node,
  Project,
  ScriptTarget,
  SyntaxKind,
  type CallExpression,
  type FunctionDeclaration,
  type MethodDeclaration,
  type SourceFile,
  type VariableDeclaration,
} from "ts-morph";
import {
  SCHEMA_VERSION,
  type Diagnostic,
  type Evidence,
  type RawCodeEdge,
  type RawCodeGraph,
  type RawCodeNode,
  type RawNodeKind,
  type SourceLanguage,
} from "@agent-runtime-map/schema";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".logic-map",
  ".turbo",
  "__mocks__",
  "__tests__",
  "coverage",
  "dist",
  "build",
  "node_modules",
  "out",
]);

/** Tests and type declarations describe the system, they are not the system running. */
const EXCLUDED_FILE_PATTERN = /(\.(test|spec)\.[cm]?[jt]sx?|\.d\.ts)$/i;

/**
 * Scripts are real code but they are not the running system: smoke tests, one-off
 * migrations, and release helpers live here. They stay in the Raw Code Graph as
 * evidence, but path conventions such as `agents/` must not promote them.
 */
const SUPPORTING_PATH_PATTERN = /(^|\/)(scripts?|tools?\/dev|examples?|fixtures?|benchmarks?)(\/|$)/i;
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
const DB_OPERATIONS = new Set([
  "create",
  "createMany",
  "delete",
  "deleteMany",
  "findFirst",
  "findMany",
  "findUnique",
  "insert",
  "select",
  "update",
  "updateMany",
  "upsert",
]);

export interface TypeScriptAnalyzerOptions {
  maxFiles?: number;
}

interface DeclarationRecord {
  node: RawCodeNode;
  declaration: FunctionDeclaration | MethodDeclaration | VariableDeclaration;
}

export async function analyzeTypeScriptProject(
  inputRoot: string,
  options: TypeScriptAnalyzerOptions = {},
): Promise<RawCodeGraph> {
  const root = path.resolve(inputRoot);
  const diagnostics: Diagnostic[] = [];
  const allFiles = await discoverSourceFiles(root);
  const maxFiles = options.maxFiles ?? 2_000;
  const sourcePaths = allFiles.slice(0, maxFiles);

  if (allFiles.length > maxFiles) {
    diagnostics.push({
      level: "warning",
      code: "FILE_LIMIT_REACHED",
      message: `Found ${allFiles.length} source files; only the first ${maxFiles} were analyzed.`,
    });
  }

  const tsConfigFilePath = await findProjectConfig(root);
  const project = new Project({
    ...(tsConfigFilePath ? { tsConfigFilePath } : {}),
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      jsx: 4,
      target: ScriptTarget.ES2022,
    },
  });
  project.addSourceFilesAtPaths(sourcePaths);
  await project.resolveSourceFileDependencies();

  const nodes: RawCodeNode[] = [];
  const edges: RawCodeEdge[] = [];
  const requestedPaths = new Set(sourcePaths.map((file) => path.resolve(file)));
  const sourceFiles = project
    .getSourceFiles()
    .filter((sourceFile) => requestedPaths.has(path.resolve(sourceFile.getFilePath())));
  const fileNodeIds = new Map<string, string>();
  const declarations = new Map<string, DeclarationRecord>();

  for (const sourceFile of sourceFiles) {
    const relativeFile = relativePath(root, sourceFile.getFilePath());
    const fileId = stableId("file", relativeFile);
    fileNodeIds.set(sourceFile.getFilePath(), fileId);
    const fileKind = isEntrypoint(relativeFile) ? "entrypoint" : "file";
    nodes.push({
      id: fileId,
      kind: fileKind,
      name: relativeFile,
      qualifiedName: relativeFile,
      language: languageForFile(relativeFile),
      evidence: [evidence(relativeFile, 1, "path_heuristic", fileKind === "entrypoint" ? "Framework entrypoint convention" : "Source file discovered", fileKind === "entrypoint" ? 0.86 : 1)],
    });

    collectDeclarations(sourceFile, root, fileId, nodes, edges, declarations);
  }

  for (const sourceFile of sourceFiles) {
    collectImports(sourceFile, root, fileNodeIds, edges);
    collectCalls(sourceFile, root, declarations, nodes, edges);
    collectFrameworkRoutes(sourceFile, root, declarations, nodes, edges);
  }

  const frameworks = await detectFrameworks(root, sourceFiles.map((item) => relativePath(root, item.getFilePath())));
  const languages = [...new Set(sourceFiles.map((sourceFile) => languageForFile(sourceFile.getFilePath())))];

  if (sourceFiles.length === 0) {
    diagnostics.push({
      level: "warning",
      code: "NO_SOURCE_FILES",
      message: "No supported TypeScript or JavaScript source files were found.",
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    project: {
      name: await detectProjectName(root),
      root,
      languages,
      frameworks,
      filesScanned: sourceFiles.length,
    },
    nodes: dedupeById(nodes),
    edges: dedupeById(edges).filter((edge) => edge.source !== edge.target),
    diagnostics,
  };
}

async function findProjectConfig(root: string): Promise<string | undefined> {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const candidate = path.join(root, name);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next conventional project config.
    }
  }
  return undefined;
}

async function discoverSourceFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) await visit(absolute);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !EXCLUDED_FILE_PATTERN.test(entry.name)) {
        found.push(absolute);
      }
    }
  }
  await visit(root);
  return found;
}

function collectDeclarations(
  sourceFile: SourceFile,
  root: string,
  fileId: string,
  nodes: RawCodeNode[],
  edges: RawCodeEdge[],
  declarations: Map<string, DeclarationRecord>,
): void {
  const relativeFile = relativePath(root, sourceFile.getFilePath());
  const candidates: Array<FunctionDeclaration | MethodDeclaration | VariableDeclaration> = [
    ...sourceFile.getFunctions(),
    ...sourceFile.getClasses().flatMap((classDeclaration) => classDeclaration.getMethods()),
    ...sourceFile.getVariableDeclarations().filter((declaration) => {
      const initializer = declaration.getInitializer();
      return Boolean(initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)));
    }),
  ];

  for (const declaration of candidates) {
    const name = declarationName(declaration);
    if (!name) continue;
    const line = declaration.getStartLineNumber();
    const { kind, confidence, detail } = classifyDeclaration(relativeFile, name, declaration);
    const id = stableId(kind, `${relativeFile}:${name}:${line}`);
    const node: RawCodeNode = {
      id,
      kind,
      name,
      qualifiedName: `${relativeFile}#${name}`,
      language: languageForFile(relativeFile),
      evidence: [
        evidence(
          relativeFile,
          line,
          kind === "function" ? "ast" : kind === "route" ? "framework_convention" : "name_heuristic",
          detail,
          confidence,
          name,
          declaration.getEndLineNumber(),
        ),
      ],
      metadata:
        kind === "route"
          ? { method: name.toUpperCase(), path: nextRoutePath(relativeFile), framework: "nextjs" }
          : undefined,
    };
    nodes.push(node);
    edges.push(makeEdge(fileId, id, "contains", node.evidence));
    declarations.set(declarationKey(declaration), { node, declaration });
  }

  for (const classDeclaration of sourceFile.getClasses()) {
    const name = classDeclaration.getName();
    if (!name) continue;
    const line = classDeclaration.getStartLineNumber();
    const id = stableId("class", `${relativeFile}:${name}:${line}`);
    const itemEvidence = [evidence(relativeFile, line, "ast", "Class declaration", 1, name, classDeclaration.getEndLineNumber())];
    nodes.push({ id, kind: "class", name, qualifiedName: `${relativeFile}#${name}`, language: languageForFile(relativeFile), evidence: itemEvidence });
    edges.push(makeEdge(fileId, id, "contains", itemEvidence));
  }
}

function collectImports(
  sourceFile: SourceFile,
  root: string,
  fileNodeIds: Map<string, string>,
  edges: RawCodeEdge[],
): void {
  const sourceId = fileNodeIds.get(sourceFile.getFilePath());
  if (!sourceId) return;
  const relativeFile = relativePath(root, sourceFile.getFilePath());
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const targetFile = importDeclaration.getModuleSpecifierSourceFile();
    const targetId = targetFile ? fileNodeIds.get(targetFile.getFilePath()) : undefined;
    if (!targetId) continue;
    const itemEvidence = [evidence(relativeFile, importDeclaration.getStartLineNumber(), "ast", `Imports ${importDeclaration.getModuleSpecifierValue()}`, 1)];
    edges.push(makeEdge(sourceId, targetId, "imports", itemEvidence));
  }
}

function collectCalls(
  sourceFile: SourceFile,
  root: string,
  declarations: Map<string, DeclarationRecord>,
  nodes: RawCodeNode[],
  edges: RawCodeEdge[],
): void {
  const relativeFile = relativePath(root, sourceFile.getFilePath());
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const caller = findEnclosingDeclaration(call, declarations);
    if (!caller) continue;
    const target = resolveCallTarget(call, declarations);
    const expressionText = call.getExpression().getText();
    const internalRoute = internalFetchRoute(call, expressionText, nodes);
    const callEvidence = [evidence(relativeFile, call.getStartLineNumber(), "ast", `Calls ${expressionText}`, target || internalRoute ? 0.96 : 0.8)];
    if (target) edges.push(makeEdge(caller.node.id, target.node.id, "calls", callEvidence));
    if (target) collectArgumentDataFlows(call, target, declarations, relativeFile, edges);

    if (internalRoute) edges.push(makeEdge(caller.node.id, internalRoute.id, "requests", callEvidence));

    const external = externalCall(call, expressionText);
    if (external) {
      const externalId = stableId("external_api", external.key);
      nodes.push({
        id: externalId,
        kind: "external_api",
        name: external.label,
        qualifiedName: external.key,
        language: languageForFile(relativeFile),
        metadata: external.metadata,
        evidence: callEvidence,
      });
      edges.push(makeEdge(caller.node.id, externalId, "requests", callEvidence));
    }

    const database = databaseCall(expressionText);
    if (database) {
      const databaseId = stableId("database", database.key);
      const databaseEvidence = [evidence(relativeFile, call.getStartLineNumber(), "name_heuristic", `Recognized database operation ${expressionText}`, 0.88)];
      nodes.push({
        id: databaseId,
        kind: "database",
        name: database.label,
        qualifiedName: database.key,
        language: languageForFile(relativeFile),
        metadata: { operation: database.operation },
        evidence: databaseEvidence,
      });
      edges.push(makeEdge(caller.node.id, databaseId, database.edgeKind, databaseEvidence));
    }
  }
}

function collectArgumentDataFlows(
  call: CallExpression,
  consumer: DeclarationRecord,
  declarations: Map<string, DeclarationRecord>,
  relativeFile: string,
  edges: RawCodeEdge[],
): void {
  for (const argument of call.getArguments()) {
    const identifiers = Node.isIdentifier(argument) ? [argument] : argument.getDescendantsOfKind(SyntaxKind.Identifier);
    for (const identifier of identifiers) {
      for (const declaration of identifier.getSymbol()?.getDeclarations() ?? []) {
        if (!Node.isVariableDeclaration(declaration)) continue;
        const initializer = declaration.getInitializer();
        const producerCall = initializer && Node.isAwaitExpression(initializer) ? initializer.getExpression() : initializer;
        if (!producerCall || !Node.isCallExpression(producerCall)) continue;
        const producer = resolveCallTarget(producerCall, declarations);
        if (!producer || producer.node.id === consumer.node.id) continue;
        const itemEvidence = [
          evidence(
            relativeFile,
            call.getStartLineNumber(),
            "ast",
            `${identifier.getText()} carries the result of ${producer.node.name} into ${consumer.node.name}`,
            0.97,
          ),
        ];
        edges.push(makeEdge(producer.node.id, consumer.node.id, "data_flow", itemEvidence));
      }
    }
  }
}

function collectFrameworkRoutes(
  sourceFile: SourceFile,
  root: string,
  declarations: Map<string, DeclarationRecord>,
  nodes: RawCodeNode[],
  edges: RawCodeEdge[],
): void {
  const relativeFile = relativePath(root, sourceFile.getFilePath());
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) continue;
    const method = expression.getName().toLowerCase();
    if (!["get", "post", "put", "patch", "delete", "use"].includes(method)) continue;
    const owner = expression.getExpression().getText();
    if (!/^(app|router|server|api)$/.test(owner)) continue;
    const routeArgument = call.getArguments()[0];
    if (!routeArgument || !Node.isStringLiteral(routeArgument)) continue;
    const routePath = routeArgument.getLiteralValue();
    const id = stableId("route", `${method}:${routePath}:${relativeFile}`);
    const routeEvidence = [evidence(relativeFile, call.getStartLineNumber(), "framework_convention", `Recognized ${owner}.${method} route registration`, 0.94)];
    nodes.push({
      id,
      kind: "route",
      name: `${method.toUpperCase()} ${routePath}`,
      qualifiedName: `${method}:${routePath}`,
      language: languageForFile(relativeFile),
      metadata: { method: method.toUpperCase(), path: routePath, framework: owner === "router" ? "express" : "hono_or_express" },
      evidence: routeEvidence,
    });
    const handlerArgument = call.getArguments().at(-1);
    if (handlerArgument && Node.isIdentifier(handlerArgument)) {
      const handler = resolveSymbolTarget(handlerArgument.getSymbol(), declarations);
      if (handler) edges.push(makeEdge(id, handler.node.id, "handles", routeEvidence));
    }
  }
}

function findEnclosingDeclaration(call: CallExpression, declarations: Map<string, DeclarationRecord>): DeclarationRecord | undefined {
  let current: Node | undefined = call;
  while (current) {
    if (Node.isFunctionDeclaration(current) || Node.isMethodDeclaration(current) || Node.isVariableDeclaration(current)) {
      const found = declarations.get(declarationKey(current));
      if (found) return found;
    }
    current = current.getParent();
  }
  return undefined;
}

function resolveCallTarget(call: CallExpression, declarations: Map<string, DeclarationRecord>): DeclarationRecord | undefined {
  return resolveSymbolTarget(call.getExpression().getSymbol(), declarations);
}

function resolveSymbolTarget(
  symbol: ReturnType<Node["getSymbol"]>,
  declarations: Map<string, DeclarationRecord>,
): DeclarationRecord | undefined {
  const symbols = [symbol, symbol?.getAliasedSymbol()].filter((item) => item !== undefined);
  for (const declaration of symbols.flatMap((item) => item.getDeclarations())) {
    const direct = declarations.get(declarationKey(declaration));
    if (direct) return direct;
    if (Node.isVariableDeclaration(declaration)) {
      const found = declarations.get(declarationKey(declaration));
      if (found) return found;
    }
  }
  return undefined;
}

function declarationName(declaration: FunctionDeclaration | MethodDeclaration | VariableDeclaration): string | undefined {
  return declaration.getName();
}

function declarationKey(node: Node): string {
  return `${node.getSourceFile().getFilePath()}:${node.getStart()}`;
}

/**
 * A classification plus how much the signal that produced it is worth.
 *
 * Confidence is calibrated by **which signal fired**, not by the resulting kind.
 * A directory convention (`agents/`) is stronger evidence than a name suffix,
 * which is stronger than a verb appearing somewhere inside a name. Reporting one
 * flat number for every classification makes the score carry no information.
 */
interface Classification {
  readonly kind: RawNodeKind;
  readonly confidence: number;
  readonly detail: string;
}

/**
 * A naming convention needs a qualifier in front of the suffix. A function called
 * exactly `service` or `agent` names its category, not what it does, so treating it
 * as a high-confidence classification puts a node labelled "Service" on the map.
 */
function hasQualifiedSuffix(name: string, pattern: RegExp): boolean {
  const match = pattern.exec(name);
  return match !== null && match.index > 0;
}

/** The class a method belongs to, or an empty string for object-literal methods. */
function enclosingClassName(declaration: MethodDeclaration): string {
  const parent = declaration.getParent();
  return Node.isClassDeclaration(parent) || Node.isClassExpression(parent) ? parent.getName() ?? "" : "";
}

/** A private helper is an implementation detail of its class, not a unit of system logic. */
function isInternalMember(declaration: Node): boolean {
  if (!Node.isMethodDeclaration(declaration)) return false;
  if (declaration.getName().startsWith("#") || declaration.getName().startsWith("_")) return true;
  return declaration.hasModifier(SyntaxKind.PrivateKeyword) || declaration.hasModifier(SyntaxKind.ProtectedKeyword);
}

function classifyDeclaration(relativeFile: string, name: string, declaration: Node): Classification {
  const normalizedPath = relativeFile.toLowerCase();
  const normalizedName = name.toLowerCase();
  // Path conventions describe a whole directory, so they must not promote helper
  // scripts that merely happen to live under it.
  const pathConventionsApply = !SUPPORTING_PATH_PATTERN.test(normalizedPath);

  if (/\/app\/api\/.+\/route\.[jt]sx?$/.test(`/${normalizedPath}`) && HTTP_METHODS.has(name.toUpperCase())) {
    return { kind: "route", confidence: 0.95, detail: "Next.js App Router route handler convention" };
  }
  if (/(^|\/)(page|layout)\.[jt]sx?$/.test(normalizedPath) && /(page|layout)$/.test(normalizedName)) {
    return { kind: "function", confidence: 1, detail: "Declared in source" };
  }
  // A private helper of a Service class is not itself a service.
  if (isInternalMember(declaration)) {
    return { kind: "function", confidence: 1, detail: "Private class member, treated as an implementation detail" };
  }
  if (hasQualifiedSuffix(normalizedName, /(agent|crew|workflow|orchestrator)$/)) {
    return { kind: "agent", confidence: 0.8, detail: "Agent or workflow naming convention" };
  }
  if (pathConventionsApply && /(^|\/)(agents?|crews?|workflows?)(\/|$)/.test(normalizedPath)) {
    return { kind: "agent", confidence: 0.65, detail: "Declared under an agent or workflow directory" };
  }
  if (hasQualifiedSuffix(normalizedName, /(tool|action)$/)) {
    return { kind: "tool", confidence: 0.8, detail: "Tool or action naming convention" };
  }
  if (pathConventionsApply && /(^|\/)(tools?|actions?)(\/|$)/.test(normalizedPath)) {
    return { kind: "tool", confidence: 0.65, detail: "Declared under a tool or action directory" };
  }
  if (hasQualifiedSuffix(normalizedName, /(service|usecase)$/)) {
    return { kind: "service", confidence: 0.8, detail: "Service naming convention" };
  }
  if (pathConventionsApply && /(^|\/)(services?|use-cases?|commands?)(\/|$)/.test(normalizedPath)) {
    return { kind: "service", confidence: 0.7, detail: "Declared under a service or use-case directory" };
  }
  if (/(handler|execute|process|generate|create|build)/.test(normalizedName)) {
    // The loosest signal in the set: a verb anywhere in the name. Many ordinary
    // helpers match it, so it is reported as such rather than as a confident fact.
    return { kind: "service", confidence: 0.5, detail: "Business verb in the declaration name" };
  }
  if (Node.isMethodDeclaration(declaration) && /(service|controller|repository)$/i.test(enclosingClassName(declaration))) {
    return { kind: "service", confidence: 0.6, detail: "Public member of a service, controller, or repository class" };
  }
  return { kind: "function", confidence: 1, detail: "Declared in source" };
}

function internalFetchRoute(call: CallExpression, expressionText: string, nodes: RawCodeNode[]): RawCodeNode | undefined {
  if (expressionText !== "fetch") return undefined;
  const [urlArgument, optionsArgument] = call.getArguments();
  if (!urlArgument || !Node.isStringLiteral(urlArgument)) return undefined;
  const url = urlArgument.getLiteralValue();
  if (!url.startsWith("/")) return undefined;
  let method = "GET";
  if (optionsArgument && Node.isObjectLiteralExpression(optionsArgument)) {
    const methodProperty = optionsArgument.getProperty("method");
    if (methodProperty && Node.isPropertyAssignment(methodProperty)) {
      const initializer = methodProperty.getInitializer();
      if (initializer && Node.isStringLiteral(initializer)) method = initializer.getLiteralValue().toUpperCase();
    }
  }
  return nodes.find((node) => node.kind === "route" && node.metadata?.path === url && node.metadata?.method === method);
}

function nextRoutePath(relativeFile: string): string {
  const match = relativeFile.match(/(?:^|\/)app\/(api\/.+)\/route\.[jt]sx?$/);
  return match ? `/${match[1]}` : relativeFile;
}

function isEntrypoint(relativeFile: string): boolean {
  return /(^|\/)(page|layout|route|index|main|server|app)\.[jt]sx?$/.test(relativeFile) || /(^|\/)pages\/api\//.test(relativeFile);
}

function externalCall(call: CallExpression, expressionText: string): { key: string; label: string; metadata: Record<string, unknown> } | undefined {
  const firstArgument = call.getArguments()[0];
  if (expressionText === "fetch" && firstArgument && Node.isStringLiteral(firstArgument)) {
    const url = firstArgument.getLiteralValue();
    if (/^https?:\/\//.test(url)) {
      const host = safeHost(url);
      return { key: `http:${host}`, label: host, metadata: { provider: "http", url } };
    }
  }
  if (/^axios(\.(get|post|put|patch|delete))?$/.test(expressionText) && firstArgument && Node.isStringLiteral(firstArgument)) {
    const url = firstArgument.getLiteralValue();
    if (/^https?:\/\//.test(url)) {
      const host = safeHost(url);
      return { key: `http:${host}`, label: host, metadata: { provider: "axios", url } };
    }
  }
  const sdk = [
    { pattern: /(^|\.)openai\.|\.responses\.create$|\.chat\.completions\.create$/, key: "sdk:openai", label: "OpenAI API" },
    { pattern: /(^|\.)anthropic\.|\.messages\.create$/, key: "sdk:anthropic", label: "Anthropic API" },
    { pattern: /(^|\.)stripe\./, key: "sdk:stripe", label: "Stripe API" },
  ].find((candidate) => candidate.pattern.test(expressionText.toLowerCase()));
  return sdk ? { key: sdk.key, label: sdk.label, metadata: { provider: sdk.key.slice(4) } } : undefined;
}

function databaseCall(expressionText: string): { key: string; label: string; operation: string; edgeKind: "reads" | "writes" } | undefined {
  const parts = expressionText.split(".");
  if (parts.length < 2) return undefined;
  const operation = parts.at(-1) ?? "";
  const root = parts[0]?.toLowerCase();
  if (!root || !["db", "prisma", "supabase", "drizzle", "knex"].includes(root) || !DB_OPERATIONS.has(operation)) return undefined;
  const model = parts.length > 2 ? parts.at(-2) ?? "data" : "data";
  const reads = /^(find|select)/.test(operation);
  return {
    key: `${root}:${model}`,
    label: `${humanize(model)} data`,
    operation,
    edgeKind: reads ? "reads" : "writes",
  };
}

async function detectFrameworks(root: string, files: string[]): Promise<string[]> {
  const frameworks = new Set<string>();
  try {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as Record<string, unknown>;
    const dependencies = { ...objectValue(packageJson.dependencies), ...objectValue(packageJson.devDependencies) };
    const known: Record<string, string> = {
      next: "Next.js",
      react: "React",
      express: "Express",
      hono: "Hono",
      "@nestjs/core": "NestJS",
      "@langchain/langgraph": "LangGraph",
      "@openai/agents": "OpenAI Agents SDK",
    };
    for (const [dependency, label] of Object.entries(known)) if (dependency in dependencies) frameworks.add(label);
  } catch {
    // package.json is optional.
  }
  if (files.some((file) => /(^|\/)app\/api\/.+\/route\.[jt]s$/.test(file))) frameworks.add("Next.js");
  return [...frameworks];
}

async function detectProjectName(root: string): Promise<string> {
  try {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { name?: string };
    if (packageJson.name) return packageJson.name;
  } catch {
    // Fall back to the directory name.
  }
  return path.basename(root);
}

function evidence(
  file: string,
  startLine: number,
  method: Evidence["method"],
  detail: string,
  confidence: number,
  symbol?: string,
  endLine?: number,
): Evidence {
  return { source: { file, startLine, endLine, symbol }, method, detail, confidence };
}

function makeEdge(source: string, target: string, kind: RawCodeEdge["kind"], itemEvidence: Evidence[]): RawCodeEdge {
  return { id: stableId("edge", `${source}:${kind}:${target}`), source, target, kind, evidence: itemEvidence };
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha1").update(value).digest("hex").slice(0, 12)}`;
}

function relativePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function languageForFile(file: string): SourceLanguage {
  return /\.[cm]?jsx?$/.test(file) ? "javascript" : "typescript";
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function humanize(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").trim();
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
