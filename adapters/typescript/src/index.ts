import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  Node,
  Project,
  ScriptTarget,
  SyntaxKind,
  type ArrowFunction,
  type BindingElement,
  type CallExpression,
  type ElementAccessExpression,
  type ExportAssignment,
  type Expression,
  type FunctionDeclaration,
  type FunctionExpression,
  type Identifier,
  type MethodDeclaration,
  type ObjectLiteralExpression,
  type PropertyAccessExpression,
  type PropertyAssignment,
  type SourceFile,
  type VariableDeclaration,
} from "ts-morph";
import {
  SCHEMA_VERSION,
  type ControlFlowKind,
  type Diagnostic,
  type Evidence,
  type RawCodeEdge,
  type RawCodeGraph,
  type RawCodeNode,
  type RawNodeKind,
} from "@agent-runtime-map/schema";
import {
  CALLABLE_NODE_KINDS,
  HTTP_METHODS,
  classifyDeclaration,
  dedupeById,
  discoverSourceFiles,
  evidence,
  firstSentence,
  humanize,
  languageForFile,
  makeEdge,
  relativePath,
  stableId,
  templateVariables,
  type Classification,
  type DeclarationFacts,
} from "@agent-runtime-map/analysis-kit";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

/** Tests and type declarations describe the system, they are not the system running. */
const EXCLUDED_FILE_PATTERN = /(\.(test|spec)\.[cm]?[jt]sx?|\.d\.[cm]?ts)$/i;

/** Alias, destructuring, and re-export hops to follow before giving up. */
const MAX_ALIAS_HOPS = 3;
const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "use", "all", "options", "head"]);
/** Constructors whose result is an HTTP application or router, by framework. */
const ROUTE_APP_FACTORIES: ReadonlyArray<{ pattern: RegExp; name: string }> = [
  { pattern: /^(express\.Router|Router|express)$/, name: "express" },
  { pattern: /^Hono$/, name: "hono" },
  { pattern: /^Elysia$/, name: "elysia" },
  { pattern: /^(fastify|Fastify)$/, name: "fastify" },
  { pattern: /^Koa$/, name: "koa" },
];
const DB_OPERATIONS = new Set([
  "aggregate",
  "create",
  "createMany",
  "delete",
  "deleteMany",
  "deleteOne",
  "execute",
  "find",
  "findFirst",
  "findMany",
  "findOne",
  "findUnique",
  "insert",
  "insertMany",
  "insertOne",
  "query",
  "save",
  "select",
  "update",
  "updateMany",
  "updateOne",
  "upsert",
]);
/** Clients whose name alone identifies the store being reached. */
const DB_CLIENTS = new Set(["db", "prisma", "supabase", "drizzle", "knex", "mongoose", "sequelize"]);
/**
 * Receivers that name a data access path without naming the library. Weaker than a
 * known client, and reported as such — the Python adapter already read these, and a
 * rule that means one thing in Python and another in TypeScript is not a rule.
 */
// The suffix match requires a camelCase boundary (`vectorIndex`, `docStore`) or
// the exact word: a bare wildcard would swallow `restore` and `reindex`.
const DB_RECEIVER = /^(database|sql|pool|conn|connection|cursor|session|repo|repository|collection|table|store|dao|entityManager|queryRunner|index|cache|db)$|[a-z0-9][_-]?(Index|Store|Cache|Db|Repo)$/;

export interface TypeScriptAnalyzerOptions {
  maxFiles?: number;
}

/**
 * A callable is not always a `function` keyword. It can be a member of an exported
 * handler object, a default-exported arrow, or the value a factory returned. Every
 * form has to be addressable, otherwise calls inside its body have no enclosing
 * declaration and are dropped from the graph entirely.
 */
type CallableDeclaration =
  | FunctionDeclaration
  | MethodDeclaration
  | VariableDeclaration
  | PropertyAssignment
  | ExportAssignment
  | ArrowFunction
  | FunctionExpression;

interface DeclarationRecord {
  node: RawCodeNode;
  declaration: CallableDeclaration;
}

/** Callee names that invoke their callback argument once per element. */
const ITERATION_METHODS = new Set([
  "every",
  "filter",
  "flatmap",
  "foreach",
  "map",
  "reduce",
  "reduceright",
  "some",
]);

export async function analyzeTypeScriptProject(
  inputRoot: string,
  options: TypeScriptAnalyzerOptions = {},
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
    const fileId = fileNodeIds.get(sourceFile.getFilePath());
    if (fileId) collectSemanticConstructs(sourceFile, root, fileId, nodes, edges, declarations);
  }

  // Indirect callables must be registered before any call pass runs, so that a call
  // written inside one of them resolves to a declaration instead of being dropped.
  const invokedNames = collectInvokedNames(sourceFiles);
  for (const sourceFile of sourceFiles) {
    const fileId = fileNodeIds.get(sourceFile.getFilePath());
    if (fileId) collectIndirectCallables(sourceFile, root, fileId, nodes, edges, declarations, invokedNames);
  }

  // Routes are registered before the call passes for the same reason: an inline
  // handler is the route, so its body needs the route node to attribute calls to.
  const mounts = collectRouterMounts(sourceFiles, declarations);
  for (const sourceFile of sourceFiles) {
    collectFrameworkRoutes(sourceFile, root, declarations, nodes, edges, mounts);
    collectDeclarativeWorkflow(sourceFile, root, declarations, nodes, edges);
  }

  // Registrations are read before calls so a literal-keyed lookup resolves no
  // matter which file the registration lives in.
  const registryIndex = collectRegistryEntries(sourceFiles, declarations);
  // Dedupe of unresolved-call diagnostics is scoped to THIS analysis: a shared
  // module-level set would let concurrent analyses suppress each other's findings.
  const reportedUnresolved = new Set<string>();
  for (const sourceFile of sourceFiles) {
    collectImports(sourceFile, root, fileNodeIds, edges);
    collectCalls(sourceFile, root, declarations, nodes, edges, registryIndex, diagnostics, reportedUnresolved);
    collectSemanticRelations(sourceFile, root, declarations, nodes, edges);
    collectModelCalls(sourceFile, root, declarations, nodes, edges);
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
    const { kind, confidence, detail, method } = classifyDeclaration(declarationFacts(relativeFile, name, declaration));
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
          method,
          detail,
          confidence,
          name,
          declaration.getEndLineNumber(),
        ),
      ],
      metadata: {
        ...declarationMetadata(declaration),
        ...(kind === "route"
          ? { method: name.toUpperCase(), path: nextRoutePath(relativeFile), framework: "nextjs" }
          : {}),
      },
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

/** The function body behind any form a callable can be declared in. */
function callableOf(
  declaration: CallableDeclaration,
): ArrowFunction | FunctionExpression | FunctionDeclaration | MethodDeclaration | undefined {
  if (Node.isArrowFunction(declaration) || Node.isFunctionExpression(declaration)) return declaration;
  if (Node.isFunctionDeclaration(declaration) || Node.isMethodDeclaration(declaration)) return declaration;
  const value = Node.isExportAssignment(declaration) ? declaration.getExpression() : declaration.getInitializer();
  if (!value) return undefined;
  return Node.isArrowFunction(value) || Node.isFunctionExpression(value) ? value : undefined;
}

function declarationMetadata(declaration: CallableDeclaration): Record<string, unknown> {
  const callable = callableOf(declaration);
  if (!callable) return {};
  const parameters = callable.getParameters().map((parameter) => ({
    name: parameter.getName(),
    type: parameter.getTypeNode()?.getText() ?? parameter.getType().getText(parameter),
    optional: parameter.isOptional(),
  }));
  const returnType = callable.getReturnTypeNode()?.getText() ?? callable.getReturnType().getText(callable);
  return {
    parameters,
    returnType,
    async: callable.hasModifier(SyntaxKind.AsyncKeyword),
    returnStatements: callable.getDescendantsOfKind(SyntaxKind.ReturnStatement).length,
    throwStatements: callable.getDescendantsOfKind(SyntaxKind.ThrowStatement).length,
    branches:
      callable.getDescendantsOfKind(SyntaxKind.IfStatement).length +
      callable.getDescendantsOfKind(SyntaxKind.SwitchStatement).length +
      callable.getDescendantsOfKind(SyntaxKind.ConditionalExpression).length,
    loops:
      callable.getDescendantsOfKind(SyntaxKind.ForStatement).length +
      callable.getDescendantsOfKind(SyntaxKind.ForOfStatement).length +
      callable.getDescendantsOfKind(SyntaxKind.ForInStatement).length +
      callable.getDescendantsOfKind(SyntaxKind.WhileStatement).length +
      callable.getDescendantsOfKind(SyntaxKind.DoStatement).length,
    catches: callable.getDescendantsOfKind(SyntaxKind.CatchClause).length,
  };
}

function collectSemanticConstructs(
  sourceFile: SourceFile,
  root: string,
  fileId: string,
  nodes: RawCodeNode[],
  edges: RawCodeEdge[],
  declarations: Map<string, DeclarationRecord>,
): void {
  const relativeFile = relativePath(root, sourceFile.getFilePath());
  // Prompts live where they are used: a `systemPrompt` template inside a route
  // handler's body is a prompt as much as a top-level constant is, so the walk
  // covers every variable declaration in the file, nested ones included.
  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (declarations.has(declarationKey(declaration))) continue;
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const name = declaration.getName();
    const promptText = promptLiteral(name, initializer);
    // Nested declarations participate only in prompt detection: a `tool`
    // variable inside a handler body is a local, not a construct declaration.
    const nested = declaration.getFirstAncestorByKind(SyntaxKind.Block) !== undefined;
    if (nested && !promptText) continue;
    if (promptText) {
      const promptId = stableId("prompt", `${relativeFile}:${name}:${declaration.getStartLineNumber()}`);
      const promptEvidence = [evidence(relativeFile, declaration.getStartLineNumber(), "name_heuristic", "Prompt or instructions constant", 0.88, name, declaration.getEndLineNumber())];
      const promptNode: RawCodeNode = {
        id: promptId,
        kind: "prompt",
        name,
        qualifiedName: `${relativeFile}#${name}`,
        description: firstSentence(promptText),
        language: languageForFile(relativeFile),
        metadata: { excerpt: promptText.slice(0, 4_000), variables: templateVariables(promptText) },
        evidence: promptEvidence,
      };
      nodes.push(promptNode);
      edges.push(makeEdge(fileId, promptId, "contains", promptEvidence));
      declarations.set(declarationKey(declaration), { node: promptNode, declaration });
      continue;
    }

    const semantic = semanticConstruct(name, initializer, relativeFile);
    if (!semantic) continue;
    const line = declaration.getStartLineNumber();
    const id = stableId(semantic.kind, `${relativeFile}:${name}:${line}`);
    const itemEvidence = [evidence(relativeFile, line, semantic.method, semantic.detail, semantic.confidence, name, declaration.getEndLineNumber())];
    const object = semanticObject(initializer);
    const role = object ? propertyLiteral(object, "role") : undefined;
    const description = object
      ? propertyLiteral(object, "description") ?? propertyLiteral(object, "goal") ?? role
      : undefined;
    const instructions = object
      ? propertyLiteral(object, "instructions") ?? propertyLiteral(object, "systemPrompt") ?? propertyLiteral(object, "prompt")
      : undefined;
    const model = object ? propertyLiteral(object, "model") : undefined;
    const node: RawCodeNode = {
      id,
      kind: semantic.kind,
      name: object ? propertyLiteral(object, "name") ?? name : name,
      qualifiedName: `${relativeFile}#${name}`,
      description: description ?? (instructions ? firstSentence(instructions) : undefined),
      language: languageForFile(relativeFile),
      metadata: {
        factory: semantic.factory,
        role,
        instructions: instructions?.slice(0, 2_000),
        model,
        toolNames: object ? propertyIdentifierNames(object, "tools") : [],
        taskNames: object ? propertyIdentifierNames(object, "tasks") : [],
      },
      evidence: itemEvidence,
    };
    nodes.push(node);
    edges.push(makeEdge(fileId, id, "contains", itemEvidence));
    declarations.set(declarationKey(declaration), { node, declaration });

    if (model) {
      const modelId = stableId("model", model);
      const modelEvidence = [evidence(relativeFile, line, "framework_convention", `Configured model ${model}`, 0.94, name)];
      nodes.push({
        id: modelId,
        kind: "model",
        name: model,
        qualifiedName: `model:${model}`,
        language: languageForFile(relativeFile),
        metadata: { model },
        evidence: modelEvidence,
      });
      edges.push(makeEdge(id, modelId, "requests", modelEvidence, { label: "model" }));
    }
    if (instructions && instructions.length >= 24) {
      const promptId = stableId("prompt", `${relativeFile}:${name}:inline-instructions`);
      const promptEvidence = [evidence(relativeFile, line, "framework_convention", `Inline instructions configured for ${name}`, 0.94, name)];
      nodes.push({
        id: promptId,
        kind: "prompt",
        name: `${name} instructions`,
        qualifiedName: `${relativeFile}#${name}:instructions`,
        description: firstSentence(instructions),
        language: languageForFile(relativeFile),
        metadata: { excerpt: instructions.slice(0, 4_000), variables: templateVariables(instructions) },
        evidence: promptEvidence,
      });
      edges.push(makeEdge(id, promptId, "data_flow", promptEvidence, { label: "instructions" }));
    }
  }
}

interface SemanticConstruct {
  kind: Extract<RawNodeKind, "agent" | "workflow" | "tool" | "model" | "human_gate">;
  factory: string;
  confidence: number;
  detail: string;
  method: Evidence["method"];
}

function semanticConstruct(name: string, initializer: Expression, relativeFile: string): SemanticConstruct | undefined {
  const factory = initializerExpressionName(initializer);
  const normalized = `${factory} ${name}`.toLowerCase();
  const framework = /stategraph|messagegraph|create(react)?agent|defineagent|new agent|agent\(|crew\(|crewai|task\(|tool\(|createtool|definetool|chatopenai|chatanthropic/.test(normalized);
  const make = (kind: SemanticConstruct["kind"], detail: string, confidence = framework ? 0.96 : 0.82): SemanticConstruct => ({
    kind,
    factory,
    confidence,
    detail,
    method: framework ? "framework_convention" : "name_heuristic",
  });
  if (/chatopenai|chatanthropic|azurechatopenai|generative(model|ai)|createmodel|language.?model/.test(normalized)) return make("model", `Recognized model construction through ${factory}`);
  if (/stategraph|messagegraph|workflow|orchestrator|pipeline|\bcrew\b/.test(normalized)) return make("workflow", `Recognized workflow construction through ${factory || name}`);
  if (/createtool|definetool|dynamicstructuredtool|\btool\b/.test(normalized)) return make("tool", `Recognized tool construction through ${factory || name}`);
  if (/human.?approval|human.?review|approval.?gate|confirm.?step|interruptbefore/.test(normalized)) return make("human_gate", `Recognized human approval gate through ${factory || name}`, 0.86);
  if (/create(react)?agent|defineagent|\bagent\b/.test(normalized)) return make("agent", `Recognized Agent construction through ${factory || name}`);
  if (/(^|\/)(agents?|crews?)\//i.test(relativeFile)) return make("agent", "Declared under an Agent directory", 0.72);
  return undefined;
}

function initializerExpressionName(initializer: Expression): string {
  if (Node.isCallExpression(initializer) || Node.isNewExpression(initializer)) return initializer.getExpression().getText();
  return initializer.getKindName();
}

function semanticObject(initializer: Expression): ObjectLiteralExpression | undefined {
  if (Node.isObjectLiteralExpression(initializer)) return initializer;
  if (Node.isCallExpression(initializer) || Node.isNewExpression(initializer)) {
    return initializer.getArguments().find(Node.isObjectLiteralExpression);
  }
  return undefined;
}

function propertyLiteral(object: ObjectLiteralExpression, name: string): string | undefined {
  const property = object.getProperty(name);
  if (!property || !Node.isPropertyAssignment(property)) return undefined;
  const value = property.getInitializer();
  if (!value) return undefined;
  if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value)) return value.getLiteralText();
  return undefined;
}

function propertyIdentifierNames(object: ObjectLiteralExpression, name: string): string[] {
  const property = object.getProperty(name);
  if (!property || !Node.isPropertyAssignment(property)) return [];
  const value = property.getInitializer();
  if (!value) return [];
  const identifiers = Node.isIdentifier(value) ? [value] : value.getDescendantsOfKind(SyntaxKind.Identifier);
  return [...new Set(identifiers.map((identifier) => identifier.getText()))];
}

function promptLiteral(name: string, initializer: Expression): string | undefined {
  if (!/(prompt|instructions?|system(message|text)?|persona)/i.test(name)) return undefined;
  if (Node.isStringLiteral(initializer) || Node.isNoSubstitutionTemplateLiteral(initializer)) return initializer.getLiteralText();
  if (Node.isTemplateExpression(initializer)) return initializer.getText().slice(1, -1);
  return undefined;
}

function collectSemanticRelations(
  sourceFile: SourceFile,
  root: string,
  declarations: Map<string, DeclarationRecord>,
  _nodes: RawCodeNode[],
  edges: RawCodeEdge[],
): void {
  const relativeFile = relativePath(root, sourceFile.getFilePath());
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const source = declarations.get(declarationKey(declaration));
    const initializer = declaration.getInitializer();
    if (!source || !initializer || !["agent", "workflow", "tool", "human_gate"].includes(source.node.kind)) continue;

    // A bare step array lists what a runner will invoke. Holding a reference is a
    // weaker fact than calling, so it is recorded at a lower confidence.
    if (Node.isArrayLiteralExpression(initializer)) {
      for (const element of initializer.getElements()) {
        if (!Node.isIdentifier(element) && !Node.isPropertyAccessExpression(element)) continue;
        const target = resolveReference(element, declarations);
        if (!target || target.node.id === source.node.id || !CALLABLE_NODE_KINDS.has(target.node.kind)) continue;
        const stepEvidence = [evidence(
          relativeFile,
          element.getStartLineNumber(),
          "ast",
          `${source.node.name} lists ${target.node.name} as a step`,
          0.8,
          declaration.getName(),
        )];
        edges.push(makeEdge(source.node.id, target.node.id, "calls", stepEvidence, { label: "step", control: "sequential" }));
      }
      continue;
    }

    const object = semanticObject(initializer);
    if (!object) continue;
    for (const propertyName of ["tools", "agents", "tasks", "handoffs", "instructions", "prompt", "systemPrompt", "model"]) {
      const property = object.getProperty(propertyName);
      if (!property || !Node.isPropertyAssignment(property)) continue;
      const value = property.getInitializer();
      if (!value) continue;
      const identifiers = Node.isIdentifier(value) ? [value] : value.getDescendantsOfKind(SyntaxKind.Identifier);
      for (const identifier of identifiers) {
        const target = resolveReference(identifier, declarations);
        if (!target || target.node.id === source.node.id) continue;
        const kind: RawCodeEdge["kind"] = target.node.kind === "model"
          ? "requests"
          : target.node.kind === "prompt"
            ? "data_flow"
            : "calls";
        const relationEvidence = [evidence(
          relativeFile,
          property.getStartLineNumber(),
          "framework_convention",
          `${source.node.name} configures ${propertyName} with ${target.node.name}`,
          0.96,
          declaration.getName(),
        )];
        edges.push(makeEdge(source.node.id, target.node.id, kind, relationEvidence, {
          label: propertyName,
          control: propertyName === "handoffs" ? "conditional" : "sequential",
        }));
      }
    }
  }
}

function collectDeclarativeWorkflow(
  sourceFile: SourceFile,
  root: string,
  declarations: Map<string, DeclarationRecord>,
  nodes: RawCodeNode[],
  edges: RawCodeEdge[],
): void {
  const relativeFile = relativePath(root, sourceFile.getFilePath());
  const namedMembers = new Map<string, RawCodeNode>();
  const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of calls) {
    const expression = call.getExpression();
    if (!Node.isPropertyAccessExpression(expression) || expression.getName() !== "addNode") continue;
    const [nameArgument, handlerArgument] = call.getArguments();
    if (!nameArgument || !Node.isStringLiteral(nameArgument)) continue;
    const frameworkName = nameArgument.getLiteralValue();
    const handler = handlerArgument && Node.isIdentifier(handlerArgument)
      ? resolveSymbolTarget(handlerArgument.getSymbol(), declarations)
      : undefined;
    const itemEvidence = [evidence(relativeFile, call.getStartLineNumber(), "framework_convention", `Registers workflow node ${frameworkName}`, 0.98, frameworkName)];
    const member = handler?.node ?? createFrameworkMember(frameworkName, relativeFile, call.getStartLineNumber(), itemEvidence);
    if (!handler) nodes.push(member);
    // An inline node body has no name of its own; it is what the graph node does.
    if (!handler && handlerArgument && (Node.isArrowFunction(handlerArgument) || Node.isFunctionExpression(handlerArgument))) {
      declarations.set(declarationKey(handlerArgument), { node: member, declaration: handlerArgument });
    }
    member.metadata = { ...member.metadata, frameworkNodeName: frameworkName };
    namedMembers.set(frameworkName, member);
    const owner = resolveSymbolTarget(expression.getExpression().getSymbol(), declarations);
    if (owner && owner.node.id !== member.id) {
      edges.push(makeEdge(owner.node.id, member.id, "calls", itemEvidence, { label: "node", control: "sequential" }));
    }
  }

  for (const call of calls) {
    const expression = call.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) continue;
    const method = expression.getName();
    if (!["addEdge", "addConditionalEdges"].includes(method)) continue;
    const owner = resolveSymbolTarget(expression.getExpression().getSymbol(), declarations);
    const [sourceArgument, targetArgument, pathMapArgument] = call.getArguments();
    const sourceName = graphEndpointName(sourceArgument);
    if (!sourceName) continue;
    const sourceNode = isFrameworkStart(sourceName) ? owner?.node : namedMembers.get(sourceName);
    if (!sourceNode) continue;
    const targetName = graphEndpointName(targetArgument);
    const targetNames = method === "addConditionalEdges"
      ? conditionalTargets(pathMapArgument)
      : targetName
        ? [targetName]
        : [];
    for (const targetName of targetNames) {
      if (isFrameworkEnd(targetName)) {
        sourceNode.metadata = { ...sourceNode.metadata, terminal: true, terminalReason: "workflow_end" };
        continue;
      }
      const targetNode = namedMembers.get(targetName);
      if (!targetNode || sourceNode.id === targetNode.id) continue;
      const control: ControlFlowKind = method === "addConditionalEdges" ? "conditional" : "sequential";
      const itemEvidence = [evidence(relativeFile, call.getStartLineNumber(), "framework_convention", `${method} connects ${sourceName} to ${targetName}`, 0.98, sourceName)];
      edges.push(makeEdge(sourceNode.id, targetNode.id, "calls", itemEvidence, {
        label: method === "addConditionalEdges" ? "branch" : undefined,
        control,
      }));
    }
  }
}

function createFrameworkMember(name: string, relativeFile: string, line: number, itemEvidence: Evidence[]): RawCodeNode {
  const kind: RawNodeKind = /(agent|research|writer|review|planner)/i.test(name) ? "agent" : "service";
  return {
    id: stableId(kind, `${relativeFile}:framework-node:${name}:${line}`),
    kind,
    name,
    qualifiedName: `${relativeFile}#workflow:${name}`,
    language: languageForFile(relativeFile),
    metadata: { frameworkNodeName: name },
    evidence: itemEvidence,
  };
}

function conditionalTargets(node: Node | undefined): string[] {
  if (!node || !Node.isObjectLiteralExpression(node)) return [];
  return node.getProperties().flatMap((property) => {
    if (!Node.isPropertyAssignment(property)) return [];
    const initializer = property.getInitializer();
    return initializer && Node.isStringLiteral(initializer) ? [initializer.getLiteralValue()] : [];
  });
}

/**
 * A graph endpoint is written either as a literal node name or as the framework's
 * exported `START`/`END` constant, which reaches the AST as a plain identifier.
 */
function graphEndpointName(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node)) return node.getLiteralValue();
  return Node.isIdentifier(node) ? node.getText() : undefined;
}

function isFrameworkStart(value: string): boolean {
  return ["__start__", "START", "start"].includes(value);
}

function isFrameworkEnd(value: string): boolean {
  return ["__end__", "END", "end"].includes(value);
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
  registryIndex: RegistryIndex,
  diagnostics: Diagnostic[],
  reportedUnresolved: Set<string>,
): void {
  const relativeFile = relativePath(root, sourceFile.getFilePath());
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const caller = findEnclosingDeclaration(call, declarations);
    if (!caller) continue;
    // `const plannerAgent = makeAgent(...)`: the factory call constructs the
    // instance; it is not the instance executing anything. Drawing it as a call
    // edge gives every factory an inbound flow and every idle instance an outbound
    // one, which turns dynamically-dispatched instances into phantom entry points.
    if (
      caller.node.kind !== "function"
      && Node.isVariableDeclaration(caller.declaration)
      && isDirectInitializerCall(call, caller.declaration)
    ) continue;
    const expressionText = call.getExpression().getText();
    let indirectDetail: string | undefined;
    let target = resolveCallTarget(call, declarations) ?? resolveAgentRunTarget(call, declarations);
    if (!target) {
      const indirect = resolveIndirectTarget(call, declarations, registryIndex);
      if (indirect?.target) {
        target = indirect.target;
        indirectDetail = indirect.detail;
      } else if (indirect?.unresolved) {
        const key = `${relativeFile}:${call.getStartLineNumber()}:${indirect.unresolved.expression}`;
        if (!reportedUnresolved.has(key)) {
          reportedUnresolved.add(key);
          diagnostics.push({
            level: "info",
            code: "CALL_UNRESOLVED_DYNAMIC",
            message: `The target of \`${indirect.unresolved.expression}\` is decided at runtime (${indirect.unresolved.reason}); no edge was drawn.`,
            source: { file: relativeFile, startLine: call.getStartLineNumber() },
            metadata: {
              reason: indirect.unresolved.reason,
              expression: indirect.unresolved.expression,
              method: "ast",
              confidence: 1,
              caller: caller.node.name,
            },
          });
        }
      }
    }
    const internalRoute = internalFetchRoute(call, expressionText, nodes);
    const control = target?.node.kind === "human_gate" ? "human_approval" : inferControlFlow(call, expressionText);
    const controlMetadata = inferControlMetadata(call, control);
    const callEvidence = [evidence(relativeFile, call.getStartLineNumber(), "ast", `${control === "sequential" ? "Calls" : `${control} call to`} ${expressionText}${indirectDetail ? ` — ${indirectDetail.toLowerCase()}` : ""}`, indirectDetail ? 0.92 : target || internalRoute ? 0.96 : 0.8)];
    if (target) edges.push(makeEdge(caller.node.id, target.node.id, "calls", callEvidence, { control, metadata: controlMetadata }));
    if (target) collectArgumentDataFlows(call, target, declarations, relativeFile, edges);
    collectCallbackHandoffs(call, caller, target, declarations, relativeFile, control, edges);

    if (internalRoute) edges.push(makeEdge(caller.node.id, internalRoute.id, "requests", callEvidence, { control, metadata: controlMetadata }));

    const external = externalCall(call, expressionText) ?? awsSdkCall(call);
    if (external) {
      const externalId = stableId("external_api", external.key);
      const externalEvidence = [evidence(
        relativeFile,
        call.getStartLineNumber(),
        "name_heuristic",
        `Outbound request through ${expressionText}`,
        external.confidence,
      )];
      nodes.push({
        id: externalId,
        kind: "external_api",
        name: external.label,
        qualifiedName: external.key,
        language: languageForFile(relativeFile),
        metadata: external.metadata,
        evidence: externalEvidence,
      });
      edges.push(makeEdge(caller.node.id, externalId, "requests", externalEvidence, { control, metadata: controlMetadata }));
    }

    const database = databaseCall(expressionText);
    if (database) {
      const databaseId = stableId("database", database.key);
      const databaseEvidence = [evidence(relativeFile, call.getStartLineNumber(), "name_heuristic", `Recognized database operation ${expressionText}`, database.confidence)];
      nodes.push({
        id: databaseId,
        kind: "database",
        name: database.label,
        qualifiedName: database.key,
        language: languageForFile(relativeFile),
        metadata: { operation: database.operation },
        evidence: databaseEvidence,
      });
      edges.push(makeEdge(caller.node.id, databaseId, database.edgeKind, databaseEvidence, { control, metadata: controlMetadata }));
    }
  }
}


/**
 * True only for a call evaluated while the variable initializes — not for calls
 * inside function bodies the initializer merely defines. `makeAgent(...)` runs at
 * initialization; the `fetch` inside a tool's `execute` method runs later, when
 * the tool does, and suppressing it would erase the tool's real behavior.
 */
function isDirectInitializerCall(call: CallExpression, declaration: VariableDeclaration): boolean {
  let current: Node | undefined = call.getParent();
  while (current) {
    if (current === declaration) return true;
    if (
      Node.isArrowFunction(current)
      || Node.isFunctionExpression(current)
      || Node.isMethodDeclaration(current)
      || Node.isFunctionDeclaration(current)
    ) return false;
    current = current.getParent();
  }
  return false;
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
  mounts: Map<string, string>,
): void {
  const relativeFile = relativePath(root, sourceFile.getFilePath());
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const registration = routeRegistration(call, declarations);
    if (!registration) continue;
    const { method, owner, ownerKey, framework, confidence, evidenceMethod, detail } = registration;
    const routeArgument = call.getArguments()[0];
    if (!routeArgument || !Node.isStringLiteral(routeArgument)) continue;
    const handlerArgument = call.getArguments().at(-1);
    // A mount is a prefix declaration, not an endpoint of its own.
    if (method === "use" && handlerArgument && Node.isIdentifier(handlerArgument)) continue;

    const prefix = ownerKey ? mounts.get(ownerKey) : undefined;
    const routePath = prefix ? joinRoutePath(prefix, routeArgument.getLiteralValue()) : routeArgument.getLiteralValue();
    const id = stableId("route", `${method}:${routePath}:${relativeFile}`);
    const routeEvidence = [evidence(
      relativeFile,
      call.getStartLineNumber(),
      evidenceMethod,
      prefix ? `${detail}, mounted under ${prefix}` : detail,
      confidence,
    )];
    const routeNode: RawCodeNode = {
      id,
      kind: "route",
      name: `${method.toUpperCase()} ${routePath}`,
      qualifiedName: `${method}:${routePath}`,
      language: languageForFile(relativeFile),
      metadata: { method: method.toUpperCase(), path: routePath, framework, owner, mountedUnder: prefix },
      evidence: routeEvidence,
    };
    nodes.push(routeNode);

    if (!handlerArgument) continue;
    // An inline handler has no name to link to, and it is the route: attributing its
    // body to the route node keeps one node per endpoint instead of two.
    if (Node.isArrowFunction(handlerArgument) || Node.isFunctionExpression(handlerArgument)) {
      declarations.set(declarationKey(handlerArgument), { node: routeNode, declaration: handlerArgument });
      continue;
    }
    if (Node.isIdentifier(handlerArgument) || Node.isPropertyAccessExpression(handlerArgument)) {
      const handler = resolveSymbolTarget(handlerArgument.getSymbol(), declarations);
      if (handler) edges.push(makeEdge(id, handler.node.id, "handles", routeEvidence));
    }
  }
}

/**
 * `app.post('/orders', handler)` registers a route; the route node already carries
 * the handler link. Both this pass and the callback pass would otherwise claim the
 * same handler, so the predicate is shared rather than duplicated.
 */
function routeRegistration(
  call: CallExpression,
  declarations: Map<string, DeclarationRecord>,
): RouteOwner & { method: string } | undefined {
  const expression = call.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return undefined;
  const method = expression.getName().toLowerCase();
  if (!ROUTE_METHODS.has(method)) return undefined;
  // A registered path is a string starting with `/`. Requiring it before resolving
  // the receiver keeps `map.get(key)` — which shares the method name — from paying
  // for a symbol lookup on every call in the project.
  const first = call.getArguments()[0];
  if (!first || !Node.isStringLiteral(first) || !first.getLiteralValue().startsWith("/")) return undefined;
  const owner = routeOwner(expression.getExpression(), declarations);
  return owner ? { ...owner, method } : undefined;
}

interface RouteOwner {
  readonly owner: string;
  readonly ownerKey?: string;
  readonly framework: string;
  readonly confidence: number;
  readonly evidenceMethod: Evidence["method"];
  readonly detail: string;
}

/**
 * Which value a route is being registered on. A router built by a known factory is
 * a framework fact; a name ending in `Router` is only a convention, and says so.
 * `app.get(...).post(...)` chains, so the receiver may itself be a registration.
 */
function routeOwner(node: Expression, declarations: Map<string, DeclarationRecord>): RouteOwner | undefined {
  if (Node.isCallExpression(node)) {
    const inner = node.getExpression();
    return Node.isPropertyAccessExpression(inner) ? routeOwner(inner.getExpression(), declarations) : undefined;
  }
  if (!Node.isIdentifier(node)) return undefined;
  const owner = node.getText();
  if (!/^(app|router|server|api)$/i.test(owner) && !/(router|app|server|routes)$/i.test(owner)) {
    return routeOwnerFromFactory(node, owner);
  }
  const declaration = routerDeclaration(node);
  if (declaration) {
    const initializer = declaration.getInitializer();
    const factory = initializer && (Node.isCallExpression(initializer) || Node.isNewExpression(initializer))
      ? initializer.getExpression().getText()
      : undefined;
    const framework = factory ? ROUTE_APP_FACTORIES.find((entry) => entry.pattern.test(factory)) : undefined;
    if (framework && factory) {
      return {
        owner,
        ownerKey: declarationKey(declaration),
        framework: framework.name,
        confidence: 0.96,
        evidenceMethod: "framework_convention",
        detail: `Route registered on a ${framework.name} instance built by ${factory}`,
      };
    }
  }
  const ownerKey = declaration ? declarationKey(declaration) : undefined;
  void declarations;
  if (/^(app|router|server|api)$/i.test(owner)) {
    return { owner, ownerKey, framework: "hono_or_express", confidence: 0.94, evidenceMethod: "framework_convention", detail: `Recognized ${owner}.* route registration` };
  }
  return { owner, ownerKey, framework: "hono_or_express", confidence: 0.78, evidenceMethod: "name_heuristic", detail: `Route registered on ${owner}, named as a router` };
}

/**
 * `{ searchWeb }` names a value, but the identifier's own symbol is the property it
 * declares, not the function it refers to. Shorthand is the normal way tool maps are
 * written, so every reference lookup goes through here.
 */
function resolveReference(
  node: Identifier | PropertyAccessExpression,
  declarations: Map<string, DeclarationRecord>,
): DeclarationRecord | undefined {
  const parent = node.getParent();
  if (Node.isShorthandPropertyAssignment(parent)) {
    const found = resolveSymbolTarget(parent.getValueSymbol(), declarations);
    if (found) return found;
  }
  return resolveSymbolTarget(node.getSymbol(), declarations);
}

/** A receiver whose name says nothing still counts if a known factory produced it. */
function routeOwnerFromFactory(node: Identifier, owner: string): RouteOwner | undefined {
  const declaration = routerDeclaration(node);
  const initializer = declaration?.getInitializer();
  if (!initializer || (!Node.isCallExpression(initializer) && !Node.isNewExpression(initializer))) return undefined;
  const factory = initializer.getExpression().getText();
  const framework = ROUTE_APP_FACTORIES.find((entry) => entry.pattern.test(factory));
  if (!framework || !declaration) return undefined;
  return {
    owner,
    ownerKey: declarationKey(declaration),
    framework: framework.name,
    confidence: 0.96,
    evidenceMethod: "framework_convention",
    detail: `Route registered on a ${framework.name} instance built by ${factory}`,
  };
}

/** The variable a router identifier was declared as, following import aliases. */
function routerDeclaration(node: Identifier): VariableDeclaration | undefined {
  const symbol = node.getSymbol();
  for (const candidate of [symbol, symbol?.getAliasedSymbol()].filter((item) => item !== undefined)) {
    for (const declaration of candidate.getDeclarations()) {
      if (Node.isVariableDeclaration(declaration)) return declaration;
    }
  }
  return undefined;
}

/**
 * `app.use('/api/orders', orderRouter)` mounts a router under a prefix, so the paths
 * that router registers are not the paths the system actually serves. Mounts are
 * gathered across the whole project first, because the mount and the routes it
 * renames are usually written in different files.
 */
function collectRouterMounts(
  sourceFiles: SourceFile[],
  declarations: Map<string, DeclarationRecord>,
): Map<string, string> {
  const mounts = new Map<string, string>();
  for (const sourceFile of sourceFiles) {
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const registration = routeRegistration(call, declarations);
      if (!registration || registration.method !== "use") continue;
      const [pathArgument, mounted] = call.getArguments();
      if (!pathArgument || !Node.isStringLiteral(pathArgument) || !mounted || !Node.isIdentifier(mounted)) continue;
      const declaration = routerDeclaration(mounted);
      if (declaration) mounts.set(declarationKey(declaration), pathArgument.getLiteralValue());
    }
  }
  return mounts;
}

/** Joins a mount prefix with a registered path without doubling or dropping slashes. */
function joinRoutePath(prefix: string, routePath: string): string {
  const joined = `${prefix.replace(/\/+$/, "")}/${routePath.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : "/";
}

/**
 * Registers the callables that `collectDeclarations` cannot see, because they are
 * declared as values rather than as named functions:
 *
 * - members of an exported handler object (`export const routes = { create() {} }`)
 * - a default-exported arrow (`export default async () => {}`)
 * - the callable a factory returned (`const publish = withRetry(send)`)
 *
 * Each one is a real unit of system logic, and until it is registered every call in
 * its body has no enclosing declaration and is silently discarded.
 */
function collectIndirectCallables(
  sourceFile: SourceFile,
  root: string,
  fileId: string,
  nodes: RawCodeNode[],
  edges: RawCodeEdge[],
  declarations: Map<string, DeclarationRecord>,
  invokedNames: ReadonlySet<string>,
): void {
  const relativeFile = relativePath(root, sourceFile.getFilePath());
  const register = (declaration: CallableDeclaration, name: string, detail: string, ceiling = 1): void => {
    if (declarations.has(declarationKey(declaration))) return;
    const line = declaration.getStartLineNumber();
    const classification = classifyDeclaration(declarationFacts(relativeFile, name, declaration));
    const id = stableId(classification.kind, `${relativeFile}:${name}:${line}`);
    const itemEvidence = [
      evidence(
        relativeFile,
        line,
        classification.method,
        `${detail}; ${classification.detail.toLowerCase()}`,
        Math.min(classification.confidence, ceiling),
        name,
        declaration.getEndLineNumber(),
      ),
    ];
    const node: RawCodeNode = {
      id,
      kind: classification.kind,
      name,
      qualifiedName: `${relativeFile}#${name}`,
      language: languageForFile(relativeFile),
      metadata: declarationMetadata(declaration),
      evidence: itemEvidence,
    };
    nodes.push(node);
    edges.push(makeEdge(fileId, id, "contains", itemEvidence));
    declarations.set(declarationKey(declaration), { node, declaration });
  };

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const owner = declaration.getName();

    if (Node.isObjectLiteralExpression(initializer)) {
      // A named container is the unit other code refers to: `kbSearchTool` is one
      // tool, and registering it as such lets registrations and property calls
      // resolve to it. Its members stay implementation detail. This applies only
      // to confident classifications — a suffix or directory convention — never
      // to the weak business-verb fallback, where `routeHandlers` would swallow
      // the individually-addressable members it merely groups.
      const containerClass = classifyDeclaration(declarationFacts(relativeFile, owner, declaration));
      if (containerClass.kind !== "function" && containerClass.confidence >= 0.65) {
        register(declaration, owner, "Object literal named as a construct");
        continue;
      }
      for (const property of initializer.getProperties()) {
        if (Node.isMethodDeclaration(property)) {
          register(property, `${owner}.${property.getName()}`, "Callable member of an object literal");
        } else if (Node.isPropertyAssignment(property) && callableOf(property)) {
          register(property, `${owner}.${property.getName()}`, "Callable member of an object literal");
        }
      }
      continue;
    }

    // A factory result is callable by inference, not by syntax, so it never reaches
    // the certainty of a declared function even when the type checker agrees. Asking
    // the checker is expensive, so a name nothing ever invokes is rejected first —
    // otherwise every `useMemo` result in a UI file pays for a full type resolution.
    // The exception is a name that classifies as something (an agent, a tool, a
    // service): `plannerAgent = makeAgent(...)` is an instance other code reaches
    // through containers, so "never invoked by name" proves nothing about it.
    if (declarations.has(declarationKey(declaration))) continue;
    const classified = classifyDeclaration(declarationFacts(relativeFile, owner, declaration)).kind !== "function";
    if (!classified && !invokedNames.has(owner)) continue;
    const produced = Node.isAwaitExpression(initializer) ? initializer.getExpression() : initializer;
    if (!Node.isCallExpression(produced)) continue;
    if (!classified && declaration.getType().getCallSignatures().length === 0) continue;
    register(declaration, owner, `Instance produced by ${produced.getExpression().getText()}`, 0.9);
  }

  for (const assignment of sourceFile.getExportAssignments()) {
    if (assignment.isExportEquals() || !callableOf(assignment)) continue;
    register(assignment, moduleCallableName(relativeFile), "Default-exported callable");
  }
}

/**
 * Every name that is either invoked or handed to another call anywhere in the
 * project. A value in neither position cannot receive control, so this is a cheap
 * precondition before asking the type checker whether it is callable at all.
 */
function collectInvokedNames(sourceFiles: SourceFile[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const sourceFile of sourceFiles) {
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      if (Node.isIdentifier(expression)) names.add(expression.getText());
      else if (Node.isPropertyAccessExpression(expression)) names.add(expression.getName());
      for (const argument of referenceArguments(call)) {
        names.add(Node.isIdentifier(argument) ? argument.getText() : argument.getName());
      }
    }
  }
  return names;
}

/** A default export has no name of its own, so the module supplies one. */
function moduleCallableName(relativeFile: string): string {
  const base = path.basename(relativeFile).replace(/\.[cm]?[jt]sx?$/i, "");
  if (!/^(index|route)$/i.test(base)) return base;
  const parent = path.basename(path.dirname(relativeFile));
  return parent && parent !== "." ? `${parent} ${base}` : base;
}

/**
 * A function handed to another function still runs. `steps.map(runStep)`,
 * `queue.then(onDone)`, and `withRetry(publish)` are control handoffs, and the
 * reference is as factual as a direct invocation — only the moment of execution is
 * deferred, which the control kind records. A value that cannot receive control,
 * such as a prompt or a model, is recorded as data reaching the call instead.
 */
function collectCallbackHandoffs(
  call: CallExpression,
  caller: DeclarationRecord,
  directTarget: DeclarationRecord | undefined,
  declarations: Map<string, DeclarationRecord>,
  relativeFile: string,
  control: ControlFlowKind,
  edges: RawCodeEdge[],
): void {
  if (routeRegistration(call, declarations)) return;
  const expressionText = call.getExpression().getText();
  for (const argument of referenceArguments(call)) {
    const resolved = resolveReference(argument, declarations);
    if (!resolved || resolved.node.id === caller.node.id || resolved.node.id === directTarget?.node.id) continue;
    const line = argument.getStartLineNumber();
    if (CALLABLE_NODE_KINDS.has(resolved.node.kind)) {
      const itemEvidence = [
        evidence(relativeFile, line, "ast", `${resolved.node.name} is handed to ${expressionText} as a callback`, 0.9),
      ];
      // A gate waits for a person whether it is called directly or handed over.
      const handoffControl = resolved.node.kind === "human_gate"
        ? "human_approval"
        : referenceControl(expressionText, control);
      edges.push(makeEdge(caller.node.id, resolved.node.id, "calls", itemEvidence, { control: handoffControl }));
      continue;
    }
    if (resolved.node.kind === "prompt" || resolved.node.kind === "model") {
      const itemEvidence = [
        evidence(relativeFile, line, "ast", `${resolved.node.name} is passed into ${expressionText}`, 0.94),
      ];
      edges.push(makeEdge(resolved.node.id, caller.node.id, "data_flow", itemEvidence, { label: resolved.node.kind }));
    }
  }
}

/**
 * Calls whose options object configures a model request. The Vercel AI SDK, the
 * OpenAI SDK, and the Anthropic SDK all take the model, the instructions, and the
 * available tools as named properties of a single argument, so one rule reads all
 * three without guessing at a provider.
 */
const MODEL_CALL_PATTERN = /^(generateText|streamText|generateObject|streamObject|embed|embedMany|create|complete|invoke)$/;

function collectModelCalls(
  sourceFile: SourceFile,
  root: string,
  declarations: Map<string, DeclarationRecord>,
  nodes: RawCodeNode[],
  edges: RawCodeEdge[],
): void {
  const relativeFile = relativePath(root, sourceFile.getFilePath());
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expressionText = call.getExpression().getText();
    if (!MODEL_CALL_PATTERN.test(expressionText.split(".").at(-1) ?? "")) continue;
    const options = call.getArguments().find(Node.isObjectLiteralExpression);
    if (!options || !options.getProperty("model")) continue;
    const caller = findEnclosingDeclaration(call, declarations);
    if (!caller) continue;
    const line = call.getStartLineNumber();

    const model = modelIdentifier(options.getProperty("model"))
      // The exact model is chosen at runtime, but that an LLM is called HERE, via
      // THIS client, is static fact — losing the call site would hide the one
      // step readers most want to see.
      ?? runtimeModelIdentifier(call, expressionText);
    if (model) {
      const modelId = stableId("model", model.name);
      const modelEvidence = [evidence(relativeFile, line, "framework_convention", `${expressionText} requests model ${model.name}`, 0.96, caller.node.name)];
      nodes.push({
        id: modelId,
        kind: "model",
        name: model.name,
        qualifiedName: `model:${model.name}`,
        language: languageForFile(relativeFile),
        metadata: { model: model.name, provider: model.provider },
        evidence: modelEvidence,
      });
      edges.push(makeEdge(caller.node.id, modelId, "requests", modelEvidence, { label: "model" }));
    }

    for (const propertyName of ["system", "prompt", "instructions", "messages"]) {
      const property = options.getProperty(propertyName);
      if (!property || !Node.isPropertyAssignment(property)) continue;
      const value = property.getInitializer();
      if (!value) continue;
      for (const identifier of Node.isIdentifier(value) ? [value] : value.getDescendantsOfKind(SyntaxKind.Identifier)) {
        const target = resolveReference(identifier, declarations);
        if (target?.node.kind !== "prompt") continue;
        const promptEvidence = [evidence(relativeFile, property.getStartLineNumber(), "framework_convention", `${caller.node.name} sends ${target.node.name} as ${propertyName}`, 0.96, caller.node.name)];
        edges.push(makeEdge(target.node.id, caller.node.id, "data_flow", promptEvidence, { label: propertyName }));
      }
    }

    const toolsProperty = options.getProperty("tools");
    if (!toolsProperty || !Node.isPropertyAssignment(toolsProperty)) continue;
    const toolsValue = toolsProperty.getInitializer();
    if (!toolsValue) continue;
    for (const identifier of toolsValue.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const target = resolveReference(identifier, declarations);
      if (!target || target.node.id === caller.node.id || !CALLABLE_NODE_KINDS.has(target.node.kind)) continue;
      // A tool is offered to the model, which decides whether to call it.
      const toolEvidence = [evidence(relativeFile, toolsProperty.getStartLineNumber(), "framework_convention", `${caller.node.name} offers ${target.node.name} as a tool to the model`, 0.94, caller.node.name)];
      edges.push(makeEdge(caller.node.id, target.node.id, "calls", toolEvidence, { label: "tool", control: "conditional" }));
    }
  }
}

/** The model a request names, and the provider helper that produced it. */

/** SDK roots whose `create`/`complete` calls are unmistakably LLM requests. */
const MODEL_SDK_EXPRESSION = /(^|\.)(anthropic|openai|client)\.(messages|chat\.completions|completions|responses)\./;

function runtimeModelIdentifier(call: CallExpression, expressionText: string): { name: string; provider?: string } | undefined {
  if (!MODEL_SDK_EXPRESSION.test(expressionText)) return undefined;
  const provider = /anthropic/i.test(expressionText) ? "anthropic" : /openai/i.test(expressionText) ? "openai" : undefined;
  return { name: `${provider ? humanize(provider) : "LLM"} model (runtime-selected)`, provider };
}

function modelIdentifier(property: Node | undefined): { name: string; provider?: string } | undefined {
  if (!property || !Node.isPropertyAssignment(property)) return undefined;
  const value = property.getInitializer();
  if (!value) return undefined;
  if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value)) return { name: value.getLiteralText() };
  if (Node.isCallExpression(value)) {
    const provider = value.getExpression().getText();
    const argument = value.getArguments()[0];
    if (argument && Node.isStringLiteral(argument)) return { name: argument.getLiteralValue(), provider };
    return { name: value.getText(), provider };
  }
  return undefined;
}

/** Arguments that name an existing declaration, including the members of a step array. */
function referenceArguments(call: CallExpression): Array<Identifier | PropertyAccessExpression> {
  const found: Array<Identifier | PropertyAccessExpression> = [];
  const consider = (node: Node): void => {
    if (Node.isIdentifier(node) || Node.isPropertyAccessExpression(node)) found.push(node);
  };
  for (const argument of call.getArguments()) {
    if (Node.isArrayLiteralExpression(argument)) argument.getElements().forEach(consider);
    else consider(argument);
  }
  return found;
}

/** How often, and under what condition, a handed-over callable receives control. */
function referenceControl(expressionText: string, ambient: ControlFlowKind): ControlFlowKind {
  if (/^promise\s*\.\s*(all|allsettled|race|any)$/i.test(expressionText)) return "parallel";
  const method = expressionText.split(".").at(-1)?.toLowerCase() ?? "";
  if (ITERATION_METHODS.has(method)) return "loop";
  if (method === "catch") return "fallback";
  return ambient;
}

function findEnclosingDeclaration(call: CallExpression, declarations: Map<string, DeclarationRecord>): DeclarationRecord | undefined {
  let current: Node | undefined = call;
  while (current) {
    if (
      Node.isFunctionDeclaration(current) ||
      Node.isMethodDeclaration(current) ||
      Node.isVariableDeclaration(current) ||
      Node.isPropertyAssignment(current) ||
      Node.isExportAssignment(current) ||
      Node.isArrowFunction(current) ||
      Node.isFunctionExpression(current)
    ) {
      const found = declarations.get(declarationKey(current));
      if (found) return found;
    }
    current = current.getParent();
  }
  return undefined;
}

function resolveCallTarget(call: CallExpression, declarations: Map<string, DeclarationRecord>): DeclarationRecord | undefined {
  const expression = call.getExpression();
  const direct = resolveSymbolTarget(expression.getSymbol(), declarations);
  if (direct) return direct;
  if (Node.isPropertyAccessExpression(expression)) {
    return resolveSymbolTarget(expression.getExpression().getSymbol(), declarations);
  }
  return undefined;
}


/**
 * A registry maps string keys to callables at runtime; when both the `set` and the
 * `get` use string literals on the same registry declaration, the connection is a
 * static fact, not a guess. A dynamic key is the opposite: the honest output is an
 * unresolved diagnostic, never an invented edge.
 */
interface RegistryIndex {
  /** `${registryDeclarationKey}|${literalKey}` -> the registered callable. */
  entries: Map<string, DeclarationRecord>;
  /** Declaration keys of everything observed being registered into. */
  registries: Set<string>;
}

const REGISTRY_WRITE_METHODS = new Set(["set", "register", "add"]);

function collectRegistryEntries(
  sourceFiles: SourceFile[],
  declarations: Map<string, DeclarationRecord>,
): RegistryIndex {
  const index: RegistryIndex = { entries: new Map(), registries: new Set() };
  for (const sourceFile of sourceFiles) {
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      if (!Node.isPropertyAccessExpression(expression) || !REGISTRY_WRITE_METHODS.has(expression.getName())) continue;
      const [keyArgument, valueArgument] = call.getArguments();
      const key = literalKeyOf(keyArgument);
      if (key === undefined || !valueArgument) continue;
      if (!Node.isIdentifier(valueArgument) && !Node.isPropertyAccessExpression(valueArgument)) continue;
      const registryDeclaration = variableDeclarationOf(expression.getExpression());
      if (!registryDeclaration) continue;
      const target = resolveSymbolTarget(valueArgument.getSymbol(), declarations);
      index.registries.add(declarationKey(registryDeclaration));
      if (target) index.entries.set(`${declarationKey(registryDeclaration)}|${key}`, target);
    }
  }
  return index;
}

function literalKeyOf(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
  return undefined;
}

function variableDeclarationOf(node: Node): VariableDeclaration | undefined {
  const symbol = node.getSymbol();
  if (!symbol) return undefined;
  // An imported name is an alias; the declaration lives behind it. Without this
  // hop, a registry defined in one file is invisible to every other file.
  for (const candidate of [symbol, symbol.getAliasedSymbol()].filter((item) => item !== undefined)) {
    for (const declaration of candidate.getDeclarations()) {
      if (Node.isVariableDeclaration(declaration)) return declaration;
    }
  }
  return undefined;
}

interface IndirectResolution {
  target?: DeclarationRecord;
  detail?: string;
  unresolved?: { reason: string; expression: string };
}

/**
 * Resolves calls that reach their target through a container: a registry `get`
 * with a literal key, or an object member picked by a literal index. A dynamic
 * key on a known container is reported, not guessed.
 */
function resolveIndirectTarget(
  call: CallExpression,
  declarations: Map<string, DeclarationRecord>,
  registryIndex: RegistryIndex,
): IndirectResolution | undefined {
  const expression = call.getExpression();

  // `registry.get(...)` as the call itself: with a literal key the retrieved
  // callable is the data-flow target; with a computed key it is unresolved.
  const selfLookup = registryLookup(call, registryIndex);
  if (selfLookup) return selfLookup;

  // `registry.get("key")(...)` — the lookup itself is invoked.
  const directLookup = registryLookup(expression, registryIndex);
  if (directLookup) return directLookup;

  if (Node.isPropertyAccessExpression(expression)) {
    let container: Node = expression.getExpression();

    // `const tool = registry.get("key"); tool.execute(...)` — follow the variable
    // back to the lookup that produced it.
    if (Node.isIdentifier(container)) {
      const producer = variableDeclarationOf(container)?.getInitializer();
      if (producer) {
        const viaVariable = registryLookup(producer, registryIndex);
        if (viaVariable) return viaVariable;
      }
    }

    // `registry.get("key").execute(...)` — the lookup is the receiver.
    const viaReceiver = registryLookup(container, registryIndex);
    if (viaReceiver) return viaReceiver;

    // `agents["planner"].run(...)` / `agents[role].run(...)` — object member access.
    if (Node.isElementAccessExpression(container)) {
      return resolveElementAccess(container, declarations);
    }
    // Unwrap a non-null assertion: `registry.get("k")!.execute(...)`.
    if (Node.isNonNullExpression(container)) {
      const inner = container.getExpression();
      const unwrapped = registryLookup(inner, registryIndex);
      if (unwrapped) return unwrapped;
      if (Node.isElementAccessExpression(inner)) return resolveElementAccess(inner, declarations);
    }
  }
  if (Node.isElementAccessExpression(expression)) {
    return resolveElementAccess(expression, declarations);
  }
  return undefined;
}

function registryLookup(node: Node, registryIndex: RegistryIndex): IndirectResolution | undefined {
  let lookup: Node = node;
  if (Node.isNonNullExpression(lookup)) lookup = lookup.getExpression();
  if (Node.isAwaitExpression(lookup)) lookup = lookup.getExpression();
  if (!Node.isCallExpression(lookup)) return undefined;
  const expression = lookup.getExpression();
  if (!Node.isPropertyAccessExpression(expression) || expression.getName() !== "get") return undefined;
  const registryDeclaration = variableDeclarationOf(expression.getExpression());
  if (!registryDeclaration || !registryIndex.registries.has(declarationKey(registryDeclaration))) return undefined;
  const keyArgument = lookup.getArguments()[0];
  const key = literalKeyOf(keyArgument);
  if (key === undefined) {
    return {
      unresolved: {
        reason: "the registry key is computed at runtime",
        expression: lookup.getText().slice(0, 160),
      },
    };
  }
  const target = registryIndex.entries.get(`${declarationKey(registryDeclaration)}|${key}`);
  if (!target) return undefined;
  return { target, detail: `Resolved through registry key "${key}"` };
}

function resolveElementAccess(
  access: ElementAccessExpression,
  declarations: Map<string, DeclarationRecord>,
): IndirectResolution | undefined {
  const containerDeclaration = variableDeclarationOf(access.getExpression());
  const initializer = containerDeclaration?.getInitializer();
  if (!initializer || !Node.isObjectLiteralExpression(initializer)) return undefined;
  // Only a container that actually holds known callables is worth reporting on.
  const holdsKnown = initializer.getProperties().some((property) =>
    Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property)
      ? resolveSymbolTarget(property.getSymbol(), declarations) !== undefined
      : false);
  const argument = access.getArgumentExpression();
  const key = literalKeyOf(argument)
    ?? (argument && Node.isAsExpression(argument) ? literalKeyOf(argument.getExpression()) : undefined);
  if (key === undefined) {
    if (!holdsKnown) return undefined;
    return {
      unresolved: {
        reason: "the member is selected by a runtime value",
        expression: access.getText().slice(0, 160),
      },
    };
  }
  const property = initializer.getProperty(key);
  if (!property) return undefined;
  const target = resolveSymbolTarget(property.getSymbol(), declarations);
  return target ? { target, detail: `Resolved object member "${key}"` } : undefined;
}

function resolveAgentRunTarget(call: CallExpression, declarations: Map<string, DeclarationRecord>): DeclarationRecord | undefined {
  const expressionText = call.getExpression().getText().toLowerCase();
  if (!/(^|\.)(run|runstreamed|invoke|execute)$/.test(expressionText)) return undefined;
  const firstArgument = call.getArguments()[0];
  if (!firstArgument || !Node.isIdentifier(firstArgument)) return undefined;
  const target = resolveSymbolTarget(firstArgument.getSymbol(), declarations);
  return target && ["agent", "workflow"].includes(target.node.kind) ? target : undefined;
}

function inferControlFlow(call: CallExpression, expressionText: string): ControlFlowKind {
  if (/retry|backoff|withretry/i.test(expressionText)) return "retry";
  for (const ancestor of call.getAncestors()) {
    if (Node.isFunctionDeclaration(ancestor) || Node.isMethodDeclaration(ancestor) || Node.isArrowFunction(ancestor) || Node.isFunctionExpression(ancestor)) break;
    if (Node.isCallExpression(ancestor) && /^(Promise\.(all|allSettled|race|any)|parallel|all)$/.test(ancestor.getExpression().getText())) return "parallel";
    if (Node.isCatchClause(ancestor)) return "fallback";
    if (
      Node.isForStatement(ancestor) ||
      Node.isForOfStatement(ancestor) ||
      Node.isForInStatement(ancestor) ||
      Node.isWhileStatement(ancestor) ||
      Node.isDoStatement(ancestor)
    ) {
      return /retry|attempt|backoff/i.test(ancestor.getText().slice(0, 240)) ? "retry" : "loop";
    }
    if (Node.isIfStatement(ancestor) || Node.isSwitchStatement(ancestor) || Node.isConditionalExpression(ancestor)) return "conditional";
  }
  return "sequential";
}

function inferControlMetadata(call: CallExpression, control: ControlFlowKind): Record<string, unknown> | undefined {
  if (control !== "retry") return undefined;
  const texts = [call.getText().slice(0, 600)];
  for (const ancestor of call.getAncestors()) {
    if (Node.isFunctionDeclaration(ancestor) || Node.isMethodDeclaration(ancestor) || Node.isArrowFunction(ancestor) || Node.isFunctionExpression(ancestor)) break;
    texts.push(ancestor.getText().slice(0, 600));
    if (Node.isForStatement(ancestor) || Node.isWhileStatement(ancestor) || Node.isDoStatement(ancestor)) break;
  }
  const context = texts.join(" ");
  const bounded = /max[A-Z_\s-]?(attempts?|retries)|retryLimit|attempt\s*[<>=!]+\s*\d+|retries\s*:\s*\d+|maxRetries\s*:\s*\d+/i.test(context);
  return { retryBounded: bounded };
}

/**
 * A name does not always sit on the declaration it refers to. Imports alias it,
 * destructuring rebinds it, and an object literal can hold a reference rather than a
 * body. Resolution follows those hops, bounded so a cyclic re-export cannot loop.
 */
function resolveSymbolTarget(
  symbol: ReturnType<Node["getSymbol"]>,
  declarations: Map<string, DeclarationRecord>,
  depth = 0,
): DeclarationRecord | undefined {
  if (!symbol || depth > MAX_ALIAS_HOPS) return undefined;
  const symbols = [symbol, symbol.getAliasedSymbol()].filter((item) => item !== undefined);
  for (const declaration of symbols.flatMap((item) => item.getDeclarations())) {
    const direct = declarations.get(declarationKey(declaration));
    if (direct) return direct;
    if (Node.isBindingElement(declaration)) {
      const found = resolveBindingTarget(declaration, declarations, depth);
      if (found) return found;
    }
    if (Node.isPropertyAssignment(declaration) || Node.isVariableDeclaration(declaration)) {
      const value = declaration.getInitializer();
      if (value && (Node.isIdentifier(value) || Node.isPropertyAccessExpression(value))) {
        const found = resolveSymbolTarget(value.getSymbol(), declarations, depth + 1);
        if (found) return found;
      }
    }
  }
  return undefined;
}

/**
 * `const { search } = tools` names a callable without declaring one. The binding
 * points at a property of the source value, so resolution continues from there.
 */
function resolveBindingTarget(
  binding: BindingElement,
  declarations: Map<string, DeclarationRecord>,
  depth: number,
): DeclarationRecord | undefined {
  const pattern = binding.getParent();
  if (!Node.isObjectBindingPattern(pattern)) return undefined;
  const owner = pattern.getParent();
  if (!Node.isVariableDeclaration(owner)) return undefined;
  const source = owner.getInitializer();
  if (!source) return undefined;
  const propertyName = binding.getPropertyNameNode()?.getText() ?? binding.getName();
  return resolveSymbolTarget(source.getType().getProperty(propertyName), declarations, depth + 1);
}

function declarationName(declaration: FunctionDeclaration | MethodDeclaration | VariableDeclaration): string | undefined {
  return declaration.getName();
}

function declarationKey(node: Node): string {
  return `${node.getSourceFile().getFilePath()}:${node.getStart()}`;
}

/** The class a method belongs to, or an empty string for object-literal methods. */
/**
 * Answers the shared classifier's questions in TypeScript's own terms. The rules
 * themselves live in the analysis kit so this adapter and the Python one cannot
 * drift apart about what an Agent is.
 */
function declarationFacts(relativeFile: string, name: string, declaration: Node): DeclarationFacts {
  const method = Node.isMethodDeclaration(declaration) ? declaration : undefined;
  const callable = Node.isFunctionDeclaration(declaration) || Node.isMethodDeclaration(declaration)
    ? declaration
    : Node.isVariableDeclaration(declaration) || Node.isPropertyAssignment(declaration) || Node.isExportAssignment(declaration)
      ? callableOf(declaration)
      : undefined;
  return {
    relativeFile,
    name,
    // Written annotations only: an inferred type would make this a guess about the
    // whole call graph rather than a fact about the declaration.
    returnType: callable?.getReturnTypeNode()?.getText(),
    internal: isInternalMember(declaration),
    enclosingClass: method ? enclosingClassName(method) : undefined,
    // Next.js names the HTTP method with the exported function, so the convention is
    // recognised here rather than pushed into a language-neutral rule.
    routeConvention: /\/app\/api\/.+\/route\.[jt]sx?$/.test(`/${relativeFile.toLowerCase()}`)
      && HTTP_METHODS.has(name.toUpperCase()),
  };
}

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

interface ExternalCall {
  key: string;
  label: string;
  metadata: Record<string, unknown>;
  confidence: number;
}

/**
 * HTTP clients whose call is a request whatever the URL turns out to be.
 *
 * `request` is deliberately absent: it is overwhelmingly the name of a handler's
 * parameter, and reading `request.json()` as an outbound call turned a route with no
 * downstream work into a healthy chain. A widened detector that invents a boundary
 * is worse than a narrow one that misses it.
 */
const HTTP_CLIENTS = /^(fetch|nodeFetch|axios|got|ky|superagent|undici)(\.(get|post|put|patch|delete|head|request))?$/;


/**
 * `client.send(command)` on a client constructed from an `@aws-sdk/client-*`
 * import is a boundary crossing into a named AWS service — a fact read from the
 * import specifier, not guessed from the variable name.
 */
function awsSdkCall(call: CallExpression): ExternalCall | undefined {
  const expression = call.getExpression();
  if (!Node.isPropertyAccessExpression(expression) || expression.getName() !== "send") return undefined;
  const clientDeclaration = variableDeclarationOf(expression.getExpression());
  const initializer = clientDeclaration?.getInitializer();
  if (!initializer || !Node.isNewExpression(initializer)) return undefined;
  const classExpression = initializer.getExpression();
  const classSymbol = classExpression.getSymbol();
  // When the package is not installed, the aliased symbol exists but is
  // "unknown" with zero declarations — an empty array, which `??` never
  // falls through. Both symbol layers are searched instead.
  const classDeclarations = [classSymbol, classSymbol?.getAliasedSymbol()]
    .filter((symbol) => symbol !== undefined)
    .flatMap((symbol) => symbol.getDeclarations());
  for (const declaration of classDeclarations) {
    const importDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
    const module = importDeclaration?.getModuleSpecifierValue();
    const match = module?.match(/^@aws-sdk\/client-([a-z0-9-]+)$/);
    if (match) {
      const service = match[1]!;
      return {
        key: `aws:${service}`,
        label: `AWS ${humanize(service).replace(/\b\w/g, (letter) => letter.toUpperCase())}`,
        metadata: { provider: "aws", service },
        confidence: 0.9,
      };
    }
  }
  return undefined;
}

function externalCall(call: CallExpression, expressionText: string): ExternalCall | undefined {
  const firstArgument = call.getArguments()[0];
  if (HTTP_CLIENTS.test(expressionText)) {
    const client = expressionText.split(".")[0]!;
    // A template literal's head still names the host: `https://api.x.com/v1/${id}`
    // is a fact about where the request goes, even though the path is computed.
    const url = firstArgument === undefined
      ? undefined
      : Node.isStringLiteral(firstArgument) || Node.isNoSubstitutionTemplateLiteral(firstArgument)
        ? firstArgument.getLiteralValue()
        : Node.isTemplateExpression(firstArgument)
          ? firstArgument.getHead().getLiteralText()
          : undefined;
    if (url && /^https?:\/\//.test(url)) {
      const host = safeHost(url);
      return { key: `http:${host}`, label: host, metadata: { provider: client, url }, confidence: 0.92 };
    }
    // The destination is computed, so the host cannot be named. That the call leaves
    // the system is still a fact, and saying nothing would hide the boundary
    // entirely — which is exactly what a reader is looking for on an architecture map.
    if (!url) {
      return {
        key: `http:${client}`,
        label: `${humanize(client)} request`,
        metadata: { provider: client, url: undefined },
        confidence: 0.68,
      };
    }
  }
  const sdk = [
    { pattern: /(^|\.)openai\.|\.responses\.create$|\.chat\.completions\.create$/, key: "sdk:openai", label: "OpenAI API" },
    { pattern: /(^|\.)anthropic\.|\.messages\.create$/, key: "sdk:anthropic", label: "Anthropic API" },
    { pattern: /(^|\.)stripe\./, key: "sdk:stripe", label: "Stripe API" },
  ].find((candidate) => candidate.pattern.test(expressionText.toLowerCase()));
  return sdk ? { key: sdk.key, label: sdk.label, metadata: { provider: sdk.key.slice(4) }, confidence: 0.9 } : undefined;
}

interface DatabaseCall {
  key: string;
  label: string;
  operation: string;
  edgeKind: "reads" | "writes";
  confidence: number;
}

function databaseCall(expressionText: string): DatabaseCall | undefined {
  const parts = expressionText.split(".");
  if (parts.length < 2) return undefined;
  const operation = parts.at(-1) ?? "";
  const root = parts[0] ?? "";
  if (!DB_OPERATIONS.has(operation)) return undefined;
  // A named client is a fact about the library; a data-shaped receiver is only a
  // convention, so the two cannot be reported at the same confidence.
  const known = DB_CLIENTS.has(root.toLowerCase());
  if (!known && !DB_RECEIVER.test(root)) return undefined;
  const model = parts.length > 2 ? parts.at(-2) ?? "data" : "data";
  // `prisma.order.findMany` names its table; `pool.query` does not, and calling every
  // such store "Data Data" makes three different stores read as one.
  const named = model === "data" ? root : model;
  const reads = /^(find|select|query|aggregate)/.test(operation);
  return {
    key: `${root.toLowerCase()}:${model}`,
    label: `${humanize(named)} data`,
    operation,
    edgeKind: reads ? "reads" : "writes",
    confidence: known ? 0.88 : 0.7,
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
      "langchain": "LangChain",
      "@openai/agents": "OpenAI Agents SDK",
      "@mastra/core": "Mastra",
      "ai": "Vercel AI SDK",
      "openai": "OpenAI SDK",
      "@anthropic-ai/sdk": "Anthropic SDK",
      "@temporalio/workflow": "Temporal",
      "inngest": "Inngest",
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

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
