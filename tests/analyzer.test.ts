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
    expect(raw.nodes.filter((node) => node.kind === "agent")).toHaveLength(4);
    expect(raw.nodes.some((node) => node.kind === "database" && node.name === "generation data")).toBe(true);
    expect(raw.edges.filter((edge) => edge.kind === "data_flow")).toHaveLength(3);
    expect(raw.nodes.every((node) => node.evidence.length > 0)).toBe(true);
  });

  it("compiles a smaller evidence-backed logic graph", async () => {
    const raw = await analyzeTypeScriptProject(fixture);
    const graph = compileLogicGraph(raw, { maxNodes: 12 });

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
    expect(flows).toContain("POST /api/generate -> Execute Content Workflow");
    expect(flows.filter((flow) => flow.endsWith("-> OpenAI API"))).toHaveLength(3);
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
    expect(byName.get("reviewWorkflow")?.kind).toBe("agent");
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
});
