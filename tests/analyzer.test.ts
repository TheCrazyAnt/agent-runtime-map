import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeTypeScriptProject } from "@logic-map/typescript";
import { compileLogicGraph } from "@logic-map/logic-compiler";

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
    expect(flows).toContain("Handle Submit -> Post /api/generate");
    expect(flows).toContain("Post /api/generate -> Execute Content Workflow");
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
});
