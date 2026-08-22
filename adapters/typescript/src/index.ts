import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  Node,
  Project,
  ScriptTarget,
  SyntaxKind,
  type CallExpression,
  type Expression,
  type FunctionDeclaration,
  type MethodDeclaration,
  type ObjectLiteralExpression,
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
  type SourceLanguage,
} from "@agent-runtime-map/schema";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
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
const EXCLUDED_FILE_PATTERN = /(\.(test|spec)\.[cm]?[jt]sx?|\.d\.[cm]?ts)$/i;

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
    const fileId = fileNodeIds.get(sourceFile.getFilePath());
    if (fileId) collectSemanticConstructs(sourceFile, root, fileId, nodes, edges, declarations);
  }

  for (const sourceFile of sourceFiles) {
    collectImports(sourceFile, root, fileNodeIds, edges);
    collectCalls(sourceFile, root, declarations, nodes, edges);
    collectFrameworkRoutes(sourceFile, root, declarations, nodes, edges);
    collectSemanticRelations(sourceFile, root, declarations, nodes, edges);
    collectDeclarativeWorkflow(sourceFile, root, declarations, nodes, edges);
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
    const { kind, confidence, detail, method } = classifyDeclaration(relativeFile, name, declaration);
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

function declarationMetadata(
  declaration: FunctionDeclaration | MethodDeclaration | VariableDeclaration,
): Record<string, unknown> {
  const initializer = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
  const callable = initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
    ? initializer
    : Node.isFunctionDeclaration(declaration) || Node.isMethodDeclaration(declaration)
      ? declaration
      : undefined;
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
  for (const declaration of sourceFile.getVariableDeclarations()) {
    if (declarations.has(declarationKey(declaration))) continue;
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const name = declaration.getName();
    const promptText = promptLiteral(name, initializer);
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

function templateVariables(value: string): string[] {
  return [...new Set([
    ...value.matchAll(/\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g),
    ...value.matchAll(/\$\{\s*([A-Za-z_][\w.-]*)\s*\}/g),
  ].map((match) => match[1]).filter((item): item is string => Boolean(item)))];
}

function firstSentence(value: string): string {
  return value.replace(/\s+/g, " ").trim().split(/(?<=[.!?。！？])\s*/)[0]?.slice(0, 320) ?? "";
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
    const object = semanticObject(initializer);
    if (!object) continue;
    for (const propertyName of ["tools", "agents", "tasks", "handoffs", "instructions", "prompt", "systemPrompt", "model"]) {
      const property = object.getProperty(propertyName);
      if (!property || !Node.isPropertyAssignment(property)) continue;
      const value = property.getInitializer();
      if (!value) continue;
      const identifiers = Node.isIdentifier(value) ? [value] : value.getDescendantsOfKind(SyntaxKind.Identifier);
      for (const identifier of identifiers) {
        const target = resolveSymbolTarget(identifier.getSymbol(), declarations);
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
    if (!sourceArgument || !Node.isStringLiteral(sourceArgument)) continue;
    const sourceName = sourceArgument.getLiteralValue();
    const sourceNode = isFrameworkStart(sourceName) ? owner?.node : namedMembers.get(sourceName);
    if (!sourceNode) continue;
    const targetNames = method === "addConditionalEdges"
      ? conditionalTargets(pathMapArgument)
      : targetArgument && Node.isStringLiteral(targetArgument)
        ? [targetArgument.getLiteralValue()]
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
): void {
  const relativeFile = relativePath(root, sourceFile.getFilePath());
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const caller = findEnclosingDeclaration(call, declarations);
    if (!caller) continue;
    const target = resolveCallTarget(call, declarations) ?? resolveAgentRunTarget(call, declarations);
    const expressionText = call.getExpression().getText();
    const internalRoute = internalFetchRoute(call, expressionText, nodes);
    const control = target?.node.kind === "human_gate" ? "human_approval" : inferControlFlow(call, expressionText);
    const controlMetadata = inferControlMetadata(call, control);
    const callEvidence = [evidence(relativeFile, call.getStartLineNumber(), "ast", `${control === "sequential" ? "Calls" : `${control} call to`} ${expressionText}`, target || internalRoute ? 0.96 : 0.8)];
    if (target) edges.push(makeEdge(caller.node.id, target.node.id, "calls", callEvidence, { control, metadata: controlMetadata }));
    if (target) collectArgumentDataFlows(call, target, declarations, relativeFile, edges);

    if (internalRoute) edges.push(makeEdge(caller.node.id, internalRoute.id, "requests", callEvidence, { control, metadata: controlMetadata }));

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
      edges.push(makeEdge(caller.node.id, externalId, "requests", callEvidence, { control, metadata: controlMetadata }));
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
      edges.push(makeEdge(caller.node.id, databaseId, database.edgeKind, databaseEvidence, { control, metadata: controlMetadata }));
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
  const expression = call.getExpression();
  const direct = resolveSymbolTarget(expression.getSymbol(), declarations);
  if (direct) return direct;
  if (Node.isPropertyAccessExpression(expression)) {
    return resolveSymbolTarget(expression.getExpression().getSymbol(), declarations);
  }
  return undefined;
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
  readonly method: Evidence["method"];
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
    return { kind: "route", confidence: 0.95, detail: "Next.js App Router route handler convention", method: "framework_convention" };
  }
  if (/(^|\/)(page|layout)\.[jt]sx?$/.test(normalizedPath) && /(page|layout)$/.test(normalizedName)) {
    return { kind: "function", confidence: 1, detail: "Declared in source", method: "ast" };
  }
  // A private helper of a Service class is not itself a service.
  if (isInternalMember(declaration)) {
    return { kind: "function", confidence: 1, detail: "Private class member, treated as an implementation detail", method: "ast" };
  }
  if (hasQualifiedSuffix(normalizedName, /(workflow|orchestrator|pipeline|graph|crew)$/)) {
    return { kind: "workflow", confidence: 0.84, detail: "Workflow or orchestrator naming convention", method: "name_heuristic" };
  }
  if (pathConventionsApply && /(^|\/)(workflows?|orchestrators?|pipelines?|graphs?|crews?)(\/|$)/.test(normalizedPath)) {
    return { kind: "workflow", confidence: 0.72, detail: "Declared under a workflow or orchestrator directory", method: "path_heuristic" };
  }
  if (hasQualifiedSuffix(normalizedName, /agent$/)) {
    return { kind: "agent", confidence: 0.84, detail: "Agent naming convention", method: "name_heuristic" };
  }
  if (pathConventionsApply && /(^|\/)(agents?)(\/|$)/.test(normalizedPath)) {
    return { kind: "agent", confidence: 0.72, detail: "Declared under an Agent directory", method: "path_heuristic" };
  }
  if (/(approve|approval|humanreview|human_review|confirm|moderate)/.test(normalizedName)) {
    return { kind: "human_gate", confidence: 0.68, detail: "Human approval or review naming convention", method: "name_heuristic" };
  }
  if (hasQualifiedSuffix(normalizedName, /(tool|action)$/)) {
    return { kind: "tool", confidence: 0.8, detail: "Tool or action naming convention", method: "name_heuristic" };
  }
  if (pathConventionsApply && /(^|\/)(tools?|actions?)(\/|$)/.test(normalizedPath)) {
    return { kind: "tool", confidence: 0.65, detail: "Declared under a tool or action directory", method: "path_heuristic" };
  }
  if (hasQualifiedSuffix(normalizedName, /(service|usecase)$/)) {
    return { kind: "service", confidence: 0.8, detail: "Service naming convention", method: "name_heuristic" };
  }
  if (pathConventionsApply && /(^|\/)(services?|use-cases?|commands?)(\/|$)/.test(normalizedPath)) {
    return { kind: "service", confidence: 0.7, detail: "Declared under a service or use-case directory", method: "path_heuristic" };
  }
  if (Node.isMethodDeclaration(declaration) && /(service|controller|repository)$/i.test(enclosingClassName(declaration))) {
    return { kind: "service", confidence: 0.6, detail: "Public member of a service, controller, or repository class", method: "name_heuristic" };
  }
  if (/(handler|execute|process|generate|create|build)/.test(normalizedName)) {
    // The loosest signal in the set: a verb anywhere in the name. Many ordinary
    // helpers match it, so it is reported as such rather than as a confident fact.
    return { kind: "service", confidence: 0.5, detail: "Business verb in the declaration name", method: "name_heuristic" };
  }
  return { kind: "function", confidence: 1, detail: "Declared in source", method: "ast" };
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

function makeEdge(
  source: string,
  target: string,
  kind: RawCodeEdge["kind"],
  itemEvidence: Evidence[],
  options: { label?: string; control?: ControlFlowKind; metadata?: Record<string, unknown> } = {},
): RawCodeEdge {
  return {
    id: stableId("edge", `${source}:${kind}:${target}:${options.control ?? "sequential"}:${options.label ?? ""}`),
    source,
    target,
    kind,
    label: options.label,
    control: options.control,
    metadata: options.metadata,
    evidence: itemEvidence,
  };
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
