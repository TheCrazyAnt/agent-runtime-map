import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeTypeScriptProject } from "@agent-runtime-map/typescript";
import type { RawCodeGraph } from "@agent-runtime-map/schema";

/**
 * Minimal reproductions of the resolution capabilities the accuracy benchmark
 * exercises at scale. Each case is one mechanism, so a regression names its
 * culprit directly instead of failing a whole benchmark project.
 */

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function analyzeFixture(files: Record<string, string>): Promise<RawCodeGraph> {
  const root = await mkdtemp(path.join(os.tmpdir(), "arm-resolver-"));
  temporary.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), contents, "utf8");
  }
  return analyzeTypeScriptProject(root);
}

function callEdges(raw: RawCodeGraph): string[] {
  const names = new Map(raw.nodes.map((node) => [node.id, node.name]));
  return raw.edges
    .filter((edge) => edge.kind === "calls")
    .map((edge) => `${names.get(edge.source)} -> ${names.get(edge.target)}`);
}

describe("registry resolution", () => {
  it("connects literal-keyed set/get across files, and reports dynamic keys", async () => {
    const raw = await analyzeFixture({
      "src/tools.ts": "export const searchTool = { name: 'search', async execute(q: string) { return q; } };\n",
      "src/registry.ts": [
        "import { searchTool } from './tools.js';",
        "export const registry = new Map<string, { execute(q: string): Promise<string> }>();",
        "registry.set('search', searchTool);",
      ].join("\n"),
      "src/use.ts": [
        "import { registry } from './registry.js';",
        "export async function answer(q: string) { return registry.get('search')!.execute(q); }",
        "export async function probe(name: string, q: string) { return registry.get(name)?.execute(q); }",
      ].join("\n"),
    });

    expect(callEdges(raw)).toContain("answer -> searchTool");
    const dynamic = raw.diagnostics.filter((d) => d.code === "CALL_UNRESOLVED_DYNAMIC");
    expect(dynamic).toHaveLength(1);
    expect(dynamic[0]!.source?.file).toBe("src/use.ts");
    expect(dynamic[0]!.metadata?.reason).toContain("runtime");
    // The dynamic lookup must NOT have produced an edge to any tool.
    expect(callEdges(raw).filter((edge) => edge.startsWith("probe ->"))).toEqual([]);
  });
});

describe("object-member dispatch", () => {
  it("resolves literal member access and reports computed member access", async () => {
    const raw = await analyzeFixture({
      "src/crew.ts": [
        "function makeAgent(config: { name: string }) { return { ...config, async run(input: string) { return input; } }; }",
        "export const plannerAgent = makeAgent({ name: 'Planner' });",
        "export const writerAgent = makeAgent({ name: 'Writer' });",
        "export const agents = { planner: plannerAgent, writer: writerAgent };",
      ].join("\n"),
      "src/run.ts": [
        "import { agents } from './crew.js';",
        "export async function fixedStep(input: string) { return agents.planner.run(input); }",
        "export async function literalStep(input: string) { return agents['writer'].run(input); }",
        "export async function dynamicStep(role: string, input: string) { return agents[role as keyof typeof agents].run(input); }",
      ].join("\n"),
    });

    const edges = callEdges(raw);
    expect(edges).toContain("fixedStep -> plannerAgent");
    expect(edges).toContain("literalStep -> writerAgent");
    expect(edges.filter((edge) => edge.startsWith("dynamicStep ->"))).toEqual([]);
    const dynamic = raw.diagnostics.filter((d) => d.code === "CALL_UNRESOLVED_DYNAMIC");
    expect(dynamic.some((d) => d.source?.file === "src/run.ts")).toBe(true);
  });

  it("registers factory-produced instances by their classified names", async () => {
    const raw = await analyzeFixture({
      "src/crew.ts": [
        "function makeAgent(config: { name: string }) { return { ...config, async run(input: string) { return input; } }; }",
        "export const plannerAgent = makeAgent({ name: 'Planner' });",
      ].join("\n"),
    });
    const planner = raw.nodes.find((node) => node.name === "plannerAgent");
    expect(planner?.kind).toBe("agent");
    // The construction call is not an execution edge: the instance does not
    // "call" its factory, and the factory gains no inbound flow from it.
    expect(callEdges(raw)).not.toContain("plannerAgent -> makeAgent");
  });
});

describe("classification precedence", () => {
  it("keeps a human approval gate a gate, even inside a workflows directory", async () => {
    const raw = await analyzeFixture({
      "src/workflows/refund.ts": [
        "export async function approveRefund(id: string) { return Promise.resolve(true); }",
        "export async function refundWorkflow(id: string) { return approveRefund(id); }",
      ].join("\n"),
    });
    expect(raw.nodes.find((node) => node.name === "approveRefund")?.kind).toBe("human_gate");
    expect(raw.nodes.find((node) => node.name === "refundWorkflow")?.kind).toBe("workflow");
  });
});

describe("outbound request naming", () => {
  it("names the host of a template-literal URL", async () => {
    const raw = await analyzeFixture({
      "src/search.ts": "export async function searchWeb(q: string) { return fetch(`https://api.search.example.com/v1?q=${q}`); }\n",
    });
    expect(raw.nodes.some((node) => node.kind === "external_api" && node.name === "api.search.example.com")).toBe(true);
  });

  it("does not mistake ordinary objects for databases", async () => {
    const raw = await analyzeFixture({
      "src/ops.ts": [
        "declare const restore: { query(sql: string): Promise<void> };",
        "declare const reindex: { find(id: string): Promise<void> };",
        "export async function rebuild(id: string) { await restore.query('x'); await reindex.find(id); }",
      ].join("\n"),
    });
    // `restore` and `reindex` merely END in store/index as plain words; without a
    // camelCase boundary they are not data receivers.
    expect(raw.nodes.filter((node) => node.kind === "database")).toEqual([]);
  });

  it("names an AWS service from its SDK client import, even uninstalled", async () => {
    const raw = await analyzeFixture({
      "src/rag.ts": [
        "import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';",
        "const bedrockClient = new BedrockAgentRuntimeClient({ region: 'us-east-1' });",
        "export async function retrieveContext(query: string) {",
        "  return bedrockClient.send(new RetrieveCommand({ retrievalQuery: { text: query } }));",
        "}",
      ].join("\n"),
    });
    const external = raw.nodes.find((node) => node.kind === "external_api");
    expect(external?.name).toBe("AWS Bedrock Agent Runtime");
  });

  it("recognizes suffix-named data stores", async () => {
    const raw = await analyzeFixture({
      "src/store.ts": [
        "declare const vectorIndex: { upsert(args: object): Promise<void> };",
        "export async function persist(text: string) { await vectorIndex.upsert({ text }); }",
      ].join("\n"),
    });
    expect(raw.nodes.some((node) => node.kind === "database" && /vector/i.test(node.name))).toBe(true);
  });
});

describe("concurrent analyses", () => {
  it("keeps unresolved diagnostics independent across simultaneous projects", async () => {
    const registryProject = {
      "src/registry.ts": [
        "export const echoTool = { name: 'echo', async execute(q: string) { return q; } };",
        "export const registry = new Map<string, { execute(q: string): Promise<string> }>();",
        "registry.set('echo', echoTool);",
        "export async function lookup(name: string, q: string) { return registry.get(name)?.execute(q); }",
      ].join("\n"),
    };
    // Two projects with the SAME file path and SAME unresolved expression: a
    // shared dedupe set would report the site once and silently swallow the twin.
    const [first, second] = await Promise.all([
      analyzeFixture(registryProject),
      analyzeFixture(registryProject),
    ]);
    const unresolvedIn = (raw: RawCodeGraph) => raw.diagnostics.filter((d) => d.code === "CALL_UNRESOLVED_DYNAMIC");
    expect(unresolvedIn(first)).toHaveLength(1);
    expect(unresolvedIn(second)).toHaveLength(1);
  });
});
