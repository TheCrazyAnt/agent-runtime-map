import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeTypeScriptProject } from "@agent-runtime-map/typescript";
import { compileLogicGraph } from "@agent-runtime-map/logic-compiler";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(repositoryRoot, "examples", "simple-agent");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("TypeScript analyzer", () => {
  it("extracts routes, agents, database calls, and evidence", async () => {
    const raw = await analyzeTypeScriptProject(fixture);

    expect(raw.project.frameworks).toContain("Next.js");
    expect(raw.nodes.some((node) => node.kind === "route" && node.name === "POST")).toBe(true);
    expect(raw.nodes.filter((node) => node.kind === "agent" || node.kind === "workflow").length).toBeGreaterThanOrEqual(9);
    expect(raw.nodes.some((node) => node.kind === "database" && node.name === "generation data")).toBe(true);
    expect(raw.edges.filter((edge) => edge.kind === "data_flow").length).toBeGreaterThanOrEqual(5);
    expect(raw.nodes.every((node) => node.evidence.length > 0)).toBe(true);
    // Every agent in the fixture names a model; none of them used to reach the graph.
    expect(raw.nodes.filter((node) => node.kind === "model").map((node) => node.name).sort())
      .toEqual(["gpt-5", "text-embedding-3-small"]);
  });

  it("compiles a smaller evidence-backed logic graph", async () => {
    const raw = await analyzeTypeScriptProject(fixture);
    const graph = compileLogicGraph(raw, { maxNodes: 40 });

    expect(graph.graphType).toBe("runtime_logic");
    expect(graph.nodes.length).toBeGreaterThanOrEqual(6);
    expect(graph.nodes.length).toBeLessThan(raw.nodes.length);
    expect(graph.nodes.some((node) => node.type === "ai_process")).toBe(true);
    expect(graph.nodes.every((node) => node.sources.length > 0)).toBe(true);
    expect(graph.edges.length).toBeGreaterThanOrEqual(4);
    const labels = new Map(graph.nodes.map((node) => [node.id, node.label]));
    const flows = graph.edges.map((edge) => `${labels.get(edge.source)} -> ${labels.get(edge.target)}`);
    expect(flows).toContain("Generate Ideas -> Create Story");
    expect(flows).toContain("Create Story -> Build Script");
    expect(flows).toContain("Handle Submit -> POST /api/generate");
    expect(flows).toContain("POST /api/generate -> Execute Content");
    expect(flows.filter((flow) => flow.endsWith("-> OpenAI API")).length).toBeGreaterThanOrEqual(7);
    expect(graph.features).toHaveLength(4);
    expect(graph.features.find((feature) => feature.label === "POST /api/generate")).toMatchObject({ health: "healthy" });
    expect(graph.features.find((feature) => feature.label === "POST /api/review")?.variants.length).toBeGreaterThan(1);
    expect(graph.features.find((feature) => feature.label === "POST /api/publish")).toMatchObject({ health: "error" });
  });

  it("resolves local calls through tsconfig path aliases", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-alias-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src", "services"), { recursive: true });
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }));
    await writeFile(path.join(root, "src", "services", "generate.ts"), "export function generateResult() { return 'done'; }\n");
    await writeFile(path.join(root, "src", "main.ts"), "import { generateResult } from '@/services/generate';\nexport function runService() { return generateResult(); }\n");

    const raw = await analyzeTypeScriptProject(root);
    const names = new Map(raw.nodes.map((node) => [node.id, node.name]));
    expect(raw.edges.some((edge) => edge.kind === "calls" && names.get(edge.source) === "runService" && names.get(edge.target) === "generateResult")).toBe(true);
  });

  it("links Express-style routes to imported handlers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-express-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "express-fixture", dependencies: { express: "latest" } }));
    await writeFile(path.join(root, "src", "handler.ts"), "export function createOrderHandler() { return 'created'; }\n");
    await writeFile(path.join(root, "src", "server.ts"), "import { createOrderHandler } from './handler.js';\nconst app = { post(_path: string, _handler: unknown) {} };\napp.post('/api/orders', createOrderHandler);\n");

    const raw = await analyzeTypeScriptProject(root);
    const names = new Map(raw.nodes.map((node) => [node.id, node.name]));
    expect(raw.edges.some((edge) => edge.kind === "handles" && names.get(edge.source) === "POST /api/orders" && names.get(edge.target) === "createOrderHandler")).toBe(true);
  });

  it("does not promote private class members to services", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-private-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "knowledge.ts"),
      [
        "export class KnowledgeService {",
        "  private cap(actor: string): void { void actor; }",
        "  private async audit(action: string): Promise<void> { void action; }",
        "  public async importDocument(text: string): Promise<string> { this.cap('a'); await this.audit('i'); return text; }",
        "  public async createOrder(text: string): Promise<string> { return text; }",
        "}",
        "",
      ].join("\n"),
    );

    const raw = await analyzeTypeScriptProject(root);
    const byName = new Map(raw.nodes.map((node) => [node.name, node]));
    // Private helpers stay in the graph as facts, but they are plain functions.
    expect(byName.get("cap")?.kind).toBe("function");
    expect(byName.get("audit")?.kind).toBe("function");
    // The public entry point of the service is still a service.
    expect(byName.get("importDocument")?.kind).toBe("service");
    expect(byName.get("createOrder")?.evidence[0]).toMatchObject({
      confidence: 0.6,
      detail: "Public member of a service, controller, or repository class",
    });

    const graph = compileLogicGraph(raw, { maxNodes: 20 });
    const labels = graph.nodes.map((node) => node.label);
    expect(labels).not.toContain("Cap");
    expect(labels).not.toContain("Audit");
  });

  it("does not let a directory convention promote the plumbing beside real Agents", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-plumbing-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src", "agents"), { recursive: true });
    await mkdir(path.join(root, "src", "tools"), { recursive: true });
    await writeFile(path.join(root, "src", "agents", "json.ts"), [
      "export function isRecord(value: unknown): boolean { return typeof value === 'object'; }",
      "export function optionalText(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }",
      "export function parseJsonBlock(text: string): unknown { return JSON.parse(text); }",
    ].join("\n"));
    await writeFile(path.join(root, "src", "agents", "research.ts"),
      "export async function researchTopic(topic: string): Promise<string> { return topic; }\n");
    await writeFile(path.join(root, "src", "tools", "search.ts"),
      "export function searchTool(query: string) { return [query]; }\nexport function toQueryString(value: unknown): string { return String(value); }\n");

    const raw = await analyzeTypeScriptProject(root);
    const kind = (name: string) => raw.nodes.find((node) => node.name === name)?.kind;

    // A predicate, a converter, and a parser are plumbing wherever they sit. As
    // Agents they outranked real steps and pushed them off a compressed map.
    expect(kind("isRecord")).toBe("function");
    expect(kind("optionalText")).toBe("function");
    expect(kind("parseJsonBlock")).toBe("function");
    expect(kind("toQueryString")).toBe("function");
    // The directory still means what it means for the work that lives there.
    expect(kind("researchTopic")).toBe("agent");
    // A name that says "tool" is evidence about the function, not about its folder.
    expect(kind("searchTool")).toBe("tool");
  });

  it("sees data access and outbound calls beyond one hardcoded client each", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-io-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "store.ts"), [
      "declare const pool: { query(sql: string): Promise<unknown[]> };",
      "declare const repository: { save(entity: unknown): Promise<void> };",
      "declare const prisma: { order: { findMany(): Promise<unknown[]> } };",
      "declare const got: { post(url: string, body?: unknown): Promise<unknown> };",
      "export async function loadOrders() { return pool.query('select 1'); }",
      "export async function storeOrder(order: unknown) { return repository.save(order); }",
      "export async function listOrders() { return prisma.order.findMany(); }",
      "export async function notifyPartner(endpoint: string) { return got.post(endpoint); }",
      "export async function callVendor() { return fetch('https://vendor.example.com/ping'); }",
      "export async function readBody(request: Request) { return request.json(); }",
    ].join("\n"));

    const raw = await analyzeTypeScriptProject(root);
    const find = (kind: string, name: string) => raw.nodes.find((node) => node.kind === kind && node.name === name);
    const confidence = (node: ReturnType<typeof find>) => node?.evidence[0]?.confidence ?? 0;

    // A named client is a fact about the library; a data-shaped receiver is a
    // convention, and the two are not reported at the same confidence.
    expect(confidence(find("database", "order data"))).toBe(0.88);
    expect(confidence(find("database", "pool data"))).toBe(0.7);
    // Three different stores must not all read as one node called "Data Data".
    expect(find("database", "repository data")).toBeDefined();

    expect(confidence(find("external_api", "vendor.example.com"))).toBeGreaterThan(0.9);
    // A computed URL still leaves the system; hiding the boundary would be worse
    // than naming it without a host.
    expect(confidence(find("external_api", "got request"))).toBeLessThan(0.75);

    // `request.json()` reads the incoming body. Reading it as an outbound call once
    // turned a route with no downstream work into a healthy chain, so the only
    // outbound calls here are the two that genuinely leave the system.
    expect(raw.nodes.filter((node) => node.kind === "external_api").map((node) => node.name).sort())
      .toEqual(["got request", "vendor.example.com"]);
  });

  it("does not let a directory convention promote helper scripts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-scripts-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "agents", "scripts"), { recursive: true });
    await mkdir(path.join(root, "agents", "src"), { recursive: true });
    await writeFile(path.join(root, "agents", "scripts", "smoke.ts"), "export function markStage(stage: string) { return stage; }\n");
    await writeFile(path.join(root, "agents", "src", "run.ts"), "export function reviewWorkflow(input: string) { return input; }\n");

    const raw = await analyzeTypeScriptProject(root);
    const byName = new Map(raw.nodes.map((node) => [node.name, node]));
    // A smoke script under agents/ is not an agent.
    expect(byName.get("markStage")?.kind).toBe("function");
    // Real code under the same directory still is.
    expect(byName.get("reviewWorkflow")?.kind).toBe("workflow");
  });

  it("skips test files and type declarations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-tests-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src", "__tests__"), { recursive: true });
    await writeFile(path.join(root, "src", "createOrder.ts"), "export function createOrder(id: string) { return id; }\n");
    await writeFile(path.join(root, "src", "createOrder.test.ts"), "export function createOrderFixture() { return 'x'; }\n");
    await writeFile(path.join(root, "src", "createOrder.test.mjs"), "export function createOrderMjsFixture() { return 'z'; }\n");
    await writeFile(path.join(root, "src", "types.d.ts"), "export declare function createOrderType(): void;\n");
    await writeFile(path.join(root, "src", "types.d.mts"), "export declare function createOrderModuleType(): void;\n");
    await writeFile(path.join(root, "src", "modern.mts"), "export function buildModernFlow() { return 'modern'; }\n");
    await writeFile(path.join(root, "src", "__tests__", "helper.ts"), "export function createOrderHelper() { return 'y'; }\n");

    const raw = await analyzeTypeScriptProject(root);
    const names = raw.nodes.map((node) => node.name);
    expect(names).toContain("createOrder");
    expect(names).not.toContain("createOrderFixture");
    expect(names).not.toContain("createOrderMjsFixture");
    expect(names).not.toContain("createOrderType");
    expect(names).not.toContain("createOrderModuleType");
    expect(names).not.toContain("createOrderHelper");
    expect(names).toContain("buildModernFlow");
  });

  it("does not classify a bare category name as that category", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-bare-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "handlers.ts"),
      "export function service() { return 'container'; }\nexport function billingService() { return 'real'; }\n",
    );

    const raw = await analyzeTypeScriptProject(root);
    const byName = new Map(raw.nodes.map((node) => [node.name, node]));
    // `service` names its category, not what it does.
    expect(byName.get("service")?.kind).toBe("function");
    expect(byName.get("billingService")?.kind).toBe("service");

    expect(compileLogicGraph(raw, { maxNodes: 20 }).nodes.map((node) => node.label)).not.toContain("Service");
  });

  it("reports different confidence for different signals", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-confidence-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src", "services"), { recursive: true });
    await writeFile(path.join(root, "src", "billingService.ts"), "export function billingService(id: string) { return id; }\n");
    await writeFile(path.join(root, "src", "services", "refund.ts"), "export function refundOrder(id: string) { return id; }\n");
    await writeFile(path.join(root, "src", "misc.ts"), "export function createSomething(id: string) { return id; }\n");

    const raw = await analyzeTypeScriptProject(root);
    const confidence = (name: string) => raw.nodes.find((node) => node.name === name)?.evidence[0]?.confidence ?? 0;
    const method = (name: string) => raw.nodes.find((node) => node.name === name)?.evidence[0]?.method;

    // Naming convention > directory convention > a verb appearing in the name.
    expect(confidence("billingService")).toBeGreaterThan(confidence("refundOrder"));
    expect(confidence("refundOrder")).toBeGreaterThan(confidence("createSomething"));
    expect(method("billingService")).toBe("name_heuristic");
    expect(method("refundOrder")).toBe("path_heuristic");
    expect(method("createSomething")).toBe("name_heuristic");
    // Regression: every classification used to report exactly 0.86.
    expect(new Set([confidence("billingService"), confidence("refundOrder"), confidence("createSomething")]).size).toBe(3);
  });

  it("understands declarative Agent, Tool, Model, and Prompt configuration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-agent-sdk-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "sdk-agent", dependencies: { "@openai/agents": "latest" } }));
    await writeFile(path.join(root, "src", "research.ts"), [
      "import { Agent, run, tool } from '@openai/agents';",
      "const researchPrompt = 'Research {{topic}} and return cited facts.';",
      "const webSearchTool = tool(async (query: string) => query, { name: 'web_search', description: 'Search the web' });",
      "const researcherAgent = new Agent({ name: 'Researcher', instructions: researchPrompt, model: 'gpt-5', tools: [webSearchTool] });",
      "export async function researchWorkflow(topic: string) { return run(researcherAgent, topic); }",
      "",
    ].join("\n"));

    const raw = await analyzeTypeScriptProject(root);
    const byName = new Map(raw.nodes.map((node) => [node.name, node]));
    const byId = new Map(raw.nodes.map((node) => [node.id, node]));
    const edgeNames = raw.edges.map((edge) => `${byId.get(edge.source)?.name} -> ${byId.get(edge.target)?.name}`);

    expect(raw.project.frameworks).toContain("OpenAI Agents SDK");
    expect(byName.get("Researcher")?.kind).toBe("agent");
    expect(byName.get("web_search")?.kind).toBe("tool");
    expect(byName.get("gpt-5")?.kind).toBe("model");
    expect(byName.get("researchPrompt")?.kind).toBe("prompt");
    expect(edgeNames).toEqual(expect.arrayContaining([
      "Researcher -> web_search",
      "Researcher -> researchPrompt",
      "Researcher -> gpt-5",
      "researchWorkflow -> Researcher",
    ]));
  });

  it("records conditional, parallel, retry, and fallback call semantics", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-control-flow-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "workflow.ts"), [
      "async function ideaAgent() { return 'idea'; }",
      "async function storyAgent() { return 'story'; }",
      "async function reviewAgent() { return true; }",
      "async function retryAgent() { return true; }",
      "async function fallbackAgent() { return false; }",
      "export async function contentWorkflow(approved: boolean) {",
      "  await Promise.all([ideaAgent(), storyAgent()]);",
      "  if (approved) await reviewAgent();",
      "  for (let attempt = 0; attempt < 3; attempt += 1) await retryAgent();",
      "  try { await reviewAgent(); } catch { await fallbackAgent(); }",
      "}",
      "",
    ].join("\n"));

    const raw = await analyzeTypeScriptProject(root);
    const names = new Map(raw.nodes.map((node) => [node.id, node.name]));
    const control = (target: string) => raw.edges.find((edge) => names.get(edge.target) === target && edge.kind === "calls")?.control;

    expect(control("ideaAgent")).toBe("parallel");
    expect(control("storyAgent")).toBe("parallel");
    expect(raw.edges.some((edge) => names.get(edge.target) === "reviewAgent" && edge.control === "conditional")).toBe(true);
    expect(control("retryAgent")).toBe("retry");
    expect(control("fallbackAgent")).toBe("fallback");
  });

  it("reconstructs LangGraph-style declarative workflow topology", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-langgraph-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "langgraph-agent", dependencies: { "@langchain/langgraph": "latest" } }));
    await writeFile(path.join(root, "src", "graph.ts"), [
      "import { StateGraph } from '@langchain/langgraph';",
      "const planAgent = async () => 'plan';",
      "const approveAgent = async () => 'approved';",
      "const reviseAgent = async () => 'revised';",
      "const contentGraph = new StateGraph({});",
      "contentGraph.addNode('plan', planAgent);",
      "contentGraph.addNode('approve', approveAgent);",
      "contentGraph.addNode('revise', reviseAgent);",
      "contentGraph.addEdge('__start__', 'plan');",
      "contentGraph.addConditionalEdges('plan', () => 'approve', { approve: 'approve', revise: 'revise' });",
      "contentGraph.addEdge('approve', '__end__');",
      "contentGraph.addEdge('revise', '__end__');",
      "",
    ].join("\n"));

    const raw = await analyzeTypeScriptProject(root);
    const names = new Map(raw.nodes.map((node) => [node.id, node.name]));
    const topology = raw.edges.map((edge) => ({
      flow: `${names.get(edge.source)} -> ${names.get(edge.target)}`,
      control: edge.control,
    }));

    expect(raw.project.frameworks).toContain("LangGraph");
    expect(raw.nodes.find((node) => node.name === "contentGraph")?.kind).toBe("workflow");
    expect(topology).toContainEqual({ flow: "contentGraph -> planAgent", control: "sequential" });
    expect(topology).toContainEqual({ flow: "planAgent -> approveAgent", control: "conditional" });
    expect(topology).toContainEqual({ flow: "planAgent -> reviseAgent", control: "conditional" });
    expect(raw.nodes.find((node) => node.name === "approveAgent")?.metadata?.terminal).toBe(true);
  });

  it("uses confidence and connectivity without dropping meaningful one-word steps", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-signal-ranking-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src", "workflows"), { recursive: true });
    await mkdir(path.join(root, "app", "api", "start"), { recursive: true });
    await writeFile(path.join(root, "src", "workflows", "review.ts"), "export function review() { return 'approved'; }\n");
    await writeFile(
      path.join(root, "src", "ids.ts"),
      "export function createId(value: string) { return value; }\nexport function createNoise() { return 'unused'; }\n",
    );
    await writeFile(
      path.join(root, "app", "api", "start", "route.ts"),
      "import { createId } from '../../../src/ids.js';\nexport function POST() { return createId('job'); }\n",
    );

    const raw = await analyzeTypeScriptProject(root);
    const graph = compileLogicGraph(raw, { maxNodes: 20 });
    const labels = graph.nodes.map((node) => node.label);

    // A path convention can make a concise business name useful by itself.
    expect(labels).toContain("Review");
    // Weak name evidence is retained when real call flow supports it.
    expect(labels).toContain("Create Id");
    // The same weak signal without any flow stays in the Raw Graph only.
    expect(labels).not.toContain("Create Noise");
  });

  it("registers callables declared as values, not just as named functions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-callable-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "tools.ts"), "export function translate(text: string) { return text; }\nexport function summarize(text: string) { return text; }\n");
    await writeFile(path.join(root, "src", "handlers.ts"), [
      "import { summarize, translate } from './tools.js';",
      "export const routeHandlers = {",
      "  async createDraft(text: string) { return translate(text); },",
      "  buildDigest: (text: string) => summarize(text),",
      "};",
    ].join("\n"));
    await writeFile(path.join(root, "src", "entry.ts"), "import { summarize } from './tools.js';\nexport default async (text: string) => summarize(text);\n");

    const raw = await analyzeTypeScriptProject(root);
    const names = new Map(raw.nodes.map((node) => [node.id, node.name]));
    const flows = raw.edges.filter((edge) => edge.kind === "calls").map((edge) => `${names.get(edge.source)} -> ${names.get(edge.target)}`);

    // An object member is addressable by its owner, so the map cannot show a bare `createDraft`.
    expect(flows).toContain("routeHandlers.createDraft -> translate");
    expect(flows).toContain("routeHandlers.buildDigest -> summarize");
    // A default export borrows the module's name because it has none of its own.
    expect(flows).toContain("entry -> summarize");
    // Regression: calls written inside these bodies used to have no enclosing
    // declaration, so both the caller and the callee vanished from the graph.
    expect(raw.nodes.some((node) => node.name === "translate")).toBe(true);
  });

  it("resolves a callable produced by a factory and links what the factory wrapped", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-factory-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", strict: true } }));
    await writeFile(path.join(root, "src", "main.ts"), [
      "function sendDraft(text: string) { return text; }",
      "function withRetry(fn: (value: string) => string) { return (value: string) => fn(value); }",
      "export const publishDraft = withRetry(sendDraft);",
      "export function runPublish(text: string) { return publishDraft(text); }",
      "export const unusedResult = withRetry(sendDraft);",
    ].join("\n"));

    const raw = await analyzeTypeScriptProject(root);
    const names = new Map(raw.nodes.map((node) => [node.id, node.name]));
    const flows = raw.edges.filter((edge) => edge.kind === "calls").map((edge) => `${names.get(edge.source)} -> ${names.get(edge.target)}`);

    expect(flows).toContain("runPublish -> publishDraft");
    expect(flows).toContain("publishDraft -> sendDraft");
    // Being callable is inferred from the type, never as certain as a declared function.
    const publish = raw.nodes.find((node) => node.name === "publishDraft");
    const declared = raw.nodes.find((node) => node.name === "sendDraft");
    expect(publish?.evidence[0]?.confidence ?? 1).toBeLessThan(declared?.evidence[0]?.confidence ?? 0);
    // Asking the type checker is expensive, so a value nothing invokes is never probed.
    expect(raw.nodes.some((node) => node.name === "unusedResult")).toBe(false);
  });

  it("records a handed-over callback as a call, with how often it receives control", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-callback-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.ts"), [
      "function scoreDraft(text: string) { return text; }",
      "function reportFailure(error: unknown) { return String(error); }",
      "function notifyAuthor(text: string) { return text; }",
      "function approveDraft(text: string) { return text; }",
      "export function reviewAll(drafts: string[]) { return drafts.map(scoreDraft); }",
      "export function publish(text: string) { return Promise.resolve(text).then(approveDraft).then(notifyAuthor).catch(reportFailure); }",
    ].join("\n"));

    const raw = await analyzeTypeScriptProject(root);
    const names = new Map(raw.nodes.map((node) => [node.id, node.name]));
    const flow = (source: string, target: string) =>
      raw.edges.find((edge) => edge.kind === "calls" && names.get(edge.source) === source && names.get(edge.target) === target);

    // An iteration method runs its callback once per element.
    expect(flow("reviewAll", "scoreDraft")?.control).toBe("loop");
    expect(flow("publish", "notifyAuthor")?.control).toBe("sequential");
    // A catch handler only runs when the happy path failed.
    expect(flow("publish", "reportFailure")?.control).toBe("fallback");
    // A gate waits for a person whether it is called directly or handed over.
    expect(flow("publish", "approveDraft")?.control).toBe("human_approval");
    // The reference is factual, but execution is deferred, so it is not a direct call.
    expect(flow("reviewAll", "scoreDraft")?.evidence[0]?.confidence).toBeLessThan(0.96);
  });

  it("follows a destructured binding and a listed step to the real declaration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-binding-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", strict: true } }));
    await writeFile(path.join(root, "src", "tools.ts"), "export function summarize(text: string) { return text; }\nexport function expand(text: string) { return text; }\n");
    await writeFile(path.join(root, "src", "main.ts"), [
      "import * as tools from './tools.js';",
      "const { summarize } = tools;",
      "export function condense(text: string) { return summarize(text); }",
      "export const draftPipeline = [tools.summarize, tools.expand];",
    ].join("\n"));

    const raw = await analyzeTypeScriptProject(root);
    const names = new Map(raw.nodes.map((node) => [node.id, node.name]));
    const flows = raw.edges.filter((edge) => edge.kind === "calls").map((edge) => `${names.get(edge.source)} -> ${names.get(edge.target)}`);

    expect(flows).toContain("condense -> summarize");
    // A named step array lists what a runner will invoke.
    expect(flows).toContain("draftPipeline -> summarize");
    expect(flows).toContain("draftPipeline -> expand");
  });

  it("registers routes on a router the framework built, under the path it is mounted at", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-router-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "router-fixture", dependencies: { express: "latest" } }));
    await writeFile(path.join(root, "src", "steps.ts"), "export function listOrders() { return []; }\nexport function createOrder(id: string) { return id; }\n");
    await writeFile(path.join(root, "src", "orders.ts"), [
      "import { listOrders } from './steps.js';",
      "const Router = () => ({ get(_p: string, _h: unknown) { return this; }, post(_p: string, _h: unknown) { return this; } });",
      "export const orderBook = Router();",
      "orderBook.get('/', listOrders);",
      "orderBook.get('/:id', listOrders);",
    ].join("\n"));
    await writeFile(path.join(root, "src", "server.ts"), [
      "import { orderBook } from './orders.js';",
      "const Router = () => ({ use(_p: string, _h: unknown) { return this; } });",
      "const app = Router();",
      "app.use('/api/orders', orderBook);",
    ].join("\n"));

    const raw = await analyzeTypeScriptProject(root);
    const routes = raw.nodes.filter((node) => node.kind === "route").map((node) => node.name);

    // `orderBook` is named like neither `app` nor `router`; the factory is the evidence.
    expect(routes).toContain("GET /api/orders");
    expect(routes).toContain("GET /api/orders/:id");
    // The path a router registers is not the path the system serves.
    expect(routes).not.toContain("GET /");
    // A mount declares a prefix; it is not an endpoint of its own.
    expect(routes.some((name) => name.startsWith("USE"))).toBe(false);
  });

  it("reads an inline route handler as the route itself", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-inline-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "inline-fixture", dependencies: { hono: "latest" } }));
    await writeFile(path.join(root, "src", "steps.ts"), "export function chargeCard(id: string) { return id; }\nexport function auditPayment(id: string) { return id; }\n");
    await writeFile(path.join(root, "src", "server.ts"), [
      "import { auditPayment, chargeCard } from './steps.js';",
      "const app = { get(_p: string, _h: unknown) { return this; }, post(_p: string, _h: unknown) { return this; } };",
      "app.get('/health', () => 'ok').post('/pay', (c: { id: string }) => auditPayment(chargeCard(c.id)));",
    ].join("\n"));

    const raw = await analyzeTypeScriptProject(root);
    const names = new Map(raw.nodes.map((node) => [node.id, node.name]));
    const flows = raw.edges.filter((edge) => edge.kind === "calls").map((edge) => `${names.get(edge.source)} -> ${names.get(edge.target)}`);

    // A chained registration is still a registration.
    expect(raw.nodes.some((node) => node.kind === "route" && node.name === "POST /pay")).toBe(true);
    // An inline handler has no name to link to, so its body belongs to the route.
    // Regression: these calls used to have no enclosing declaration at all.
    expect(flows).toContain("POST /pay -> chargeCard");
    expect(flows).toContain("POST /pay -> auditPayment");
    // One node per endpoint, not a route plus a nameless handler beside it.
    expect(raw.nodes.filter((node) => node.name.includes("/pay")).length).toBe(1);
  });

  it("reports weaker confidence for a router recognized only by its name", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-owner-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "built.ts"), [
      "const Hono = class { get(_p: string, _h: unknown) { return this; } };",
      "const shop = new Hono();",
      "shop.get('/built', () => 'ok');",
    ].join("\n"));
    await writeFile(path.join(root, "src", "named.ts"), [
      "declare const legacyRouter: { get(path: string, handler: unknown): void };",
      "legacyRouter.get('/named', () => 'ok');",
    ].join("\n"));

    const raw = await analyzeTypeScriptProject(root);
    const confidence = (name: string) => raw.nodes.find((node) => node.name === name)?.evidence[0]?.confidence ?? 0;
    const method = (name: string) => raw.nodes.find((node) => node.name === name)?.evidence[0]?.method;

    // A known constructor is a framework fact; a name ending in `Router` is a convention.
    expect(confidence("GET /built")).toBeGreaterThan(confidence("GET /named"));
    expect(method("GET /built")).toBe("framework_convention");
    expect(method("GET /named")).toBe("name_heuristic");
  });

  it("reads a declarative graph node written inline, and its start and end constants", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-graph-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "graph-fixture", dependencies: { "@langchain/langgraph": "latest" } }));
    await writeFile(path.join(root, "src", "tools.ts"), "export function searchWeb(q: string) { return [q]; }\nexport function saveNote(n: string) { return n; }\n");
    await writeFile(path.join(root, "src", "graph.ts"), [
      "import { saveNote, searchWeb } from './tools.js';",
      "declare const START: string, END: string;",
      "declare class StateGraph { addNode(n: string, h: unknown): this; addEdge(a: string, b: string): this; }",
      "export const researchGraph = new StateGraph();",
      "researchGraph.addNode('research', (state: { q: string }) => searchWeb(state.q));",
      "researchGraph.addNode('archive', (state: { q: string }) => saveNote(state.q));",
      "researchGraph.addEdge(START, 'research');",
      "researchGraph.addEdge('research', 'archive');",
      "researchGraph.addEdge('archive', END);",
    ].join("\n"));

    const raw = await analyzeTypeScriptProject(root);
    const names = new Map(raw.nodes.map((node) => [node.id, node.name]));
    const flows = raw.edges.filter((edge) => edge.kind === "calls").map((edge) => `${names.get(edge.source)} -> ${names.get(edge.target)}`);

    expect(flows).toContain("research -> archive");
    // START and END arrive as imported constants, not string literals.
    expect(flows).toContain("researchGraph -> research");
    expect(raw.nodes.find((node) => node.name === "archive")?.metadata?.terminal).toBe(true);
    // Regression: an inline node body had no enclosing declaration, so its work vanished.
    expect(flows).toContain("research -> searchWeb");
    expect(flows).toContain("archive -> saveNote");
  });

  it("reads the model, prompt, and tools a request configures", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-model-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "ai-fixture", dependencies: { ai: "latest" } }));
    await writeFile(path.join(root, "src", "tools.ts"), "export function searchWeb(q: string) { return [q]; }\n");
    await writeFile(path.join(root, "src", "answer.ts"), [
      "import { searchWeb } from './tools.js';",
      "declare function generateText(opts: Record<string, unknown>): Promise<{ text: string }>;",
      "declare function openai(model: string): unknown;",
      "const supportPrompt = 'You are a careful support agent. Answer using the given context only.';",
      "export async function answerQuestion(question: string) {",
      "  const result = await generateText({ model: openai('gpt-4o'), system: supportPrompt, prompt: question, tools: { searchWeb } });",
      "  return result.text;",
      "}",
    ].join("\n"));

    const raw = await analyzeTypeScriptProject(root);
    const names = new Map(raw.nodes.map((node) => [node.id, node.name]));
    const flow = (kind: string, source: string, target: string) =>
      raw.edges.find((edge) => edge.kind === kind && names.get(edge.source) === source && names.get(edge.target) === target);

    const model = raw.nodes.find((node) => node.kind === "model");
    expect(model?.name).toBe("gpt-4o");
    expect(model?.metadata?.provider).toBe("openai");
    expect(flow("requests", "answerQuestion", "gpt-4o")).toBeDefined();
    // The prompt reaches the request; it is data, not a step.
    expect(flow("data_flow", "supportPrompt", "answerQuestion")).toBeDefined();
    // A tool is offered to the model, which decides whether to call it.
    expect(flow("calls", "answerQuestion", "searchWeb")?.control).toBe("conditional");
  });

  it("keeps a model out of the branch count, because requesting one is not a decision", async () => {
    const raw = await analyzeTypeScriptProject(fixture);
    const graph = compileLogicGraph(raw, { maxNodes: 40 });
    const labels = graph.nodes.map((node) => node.label);

    // The model a step uses is visible on the map...
    expect(labels).toContain("Gpt 5");
    // ...but a step that requests one has not branched.
    expect(graph.features.find((feature) => feature.label === "POST /api/generate")?.variants).toHaveLength(1);
    const review = graph.features.find((feature) => feature.label === "POST /api/review");
    expect(review?.variants.length).toBeGreaterThan(1);
    // Every variant that reaches a step still carries that step's model.
    expect(review?.variants.every((variant) => variant.nodeIds.length > 0)).toBe(true);
  });

  it("does not let a route handler be claimed twice", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-once-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "once-fixture", dependencies: { express: "latest" } }));
    await writeFile(path.join(root, "src", "handler.ts"), "export function createOrderHandler() { return 'created'; }\n");
    await writeFile(path.join(root, "src", "server.ts"), [
      "import { createOrderHandler } from './handler.js';",
      "const app = { post(_path: string, _handler: unknown) {} };",
      "export function registerRoutes() { app.post('/api/orders', createOrderHandler); }",
    ].join("\n"));

    const raw = await analyzeTypeScriptProject(root);
    const names = new Map(raw.nodes.map((node) => [node.id, node.name]));
    // The route node already carries the handler, so registration must not also add a
    // shortcut edge that lets a feature path skip the route.
    expect(raw.edges.some((edge) => edge.kind === "handles" && names.get(edge.target) === "createOrderHandler")).toBe(true);
    expect(raw.edges.some((edge) => edge.kind === "calls" && names.get(edge.source) === "registerRoutes" && names.get(edge.target) === "createOrderHandler")).toBe(false);
  });
});
