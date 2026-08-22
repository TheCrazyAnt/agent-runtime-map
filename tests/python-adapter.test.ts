import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { analyzePythonProject } from "@agent-runtime-map/python";
import { compileLogicGraph } from "@agent-runtime-map/logic-compiler";
import { classifyDeclaration } from "@agent-runtime-map/analysis-kit";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(repositoryRoot, "examples", "simple-python-agent");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Python adapter", () => {
  it("produces the same protocol as every other adapter", async () => {
    const raw = await analyzePythonProject(fixture);
    const names = new Map(raw.nodes.map((node) => [node.id, node.name]));
    const flows = raw.edges
      .filter((edge) => edge.kind !== "contains")
      .map((edge) => `${edge.kind}:${names.get(edge.source)} -> ${names.get(edge.target)}`);

    expect(raw.project.frameworks).toEqual(expect.arrayContaining(["FastAPI", "OpenAI SDK"]));
    expect(raw.project.languages).toEqual(["python"]);
    // A FastAPI decorator is a framework fact, and carries the path it registers.
    expect(raw.nodes.some((node) => node.kind === "route" && node.name === "POST /api/briefings")).toBe(true);
    expect(flows).toContain("calls:POST /api/briefings -> research_agent");
    expect(flows).toContain("calls:research_agent -> search_web");
    // The model a request names, and the prompt it sends, both reach the graph.
    expect(flows).toContain("requests:research_agent -> gpt-5");
    expect(flows).toContain("data_flow:RESEARCH_PROMPT -> research_agent");
    // Every node is evidence-backed, exactly as the TypeScript adapter guarantees.
    expect(raw.nodes.every((node) => node.evidence.length > 0)).toBe(true);
    expect(raw.nodes.every((node) => node.language === "python")).toBe(true);
  });

  it("keeps Python's own shapes out of the Viewer protocol", async () => {
    const raw = await analyzePythonProject(fixture);
    const serialized = JSON.stringify(raw);

    // Decorators, dunders, and `self` are read by the extractor and stop there.
    expect(serialized).not.toContain("decorator");
    expect(serialized).not.toContain("__main__");
    expect(raw.nodes.flatMap((node) => (node.metadata?.parameters as string[]) ?? [])).not.toContain("self");
    // Only kinds the shared schema defines.
    const allowed = new Set(["entrypoint", "file", "function", "class", "route", "service", "agent", "workflow", "tool", "model", "prompt", "human_gate", "database", "external_api"]);
    expect(raw.nodes.every((node) => allowed.has(node.kind))).toBe(true);
  });

  it("compiles into a feature circuit like any other project", async () => {
    const raw = await analyzePythonProject(fixture);
    const graph = compileLogicGraph(raw, { maxNodes: 30 });

    const feature = graph.features.find((item) => item.label.includes("/api/briefings"));
    expect(feature).toBeDefined();
    expect(feature?.variants[0]?.steps.length).toBeGreaterThan(1);
    expect(graph.nodes.every((node) => node.sources.length > 0)).toBe(true);
  });

  it("classifies a Python declaration by the same rules as a TypeScript one", () => {
    // The rules are shared, so the same names and directories must mean the same
    // thing in either language — otherwise one repository reads two ways.
    const python = classifyDeclaration({ relativeFile: "app/agents/research.py", name: "research_agent" });
    const typescript = classifyDeclaration({ relativeFile: "src/agents/research.ts", name: "researchAgent" });

    expect(python.kind).toBe(typescript.kind);
    expect(python.confidence).toBe(typescript.confidence);
    expect(python.method).toBe(typescript.method);
  });

  it("reports a file the interpreter cannot parse instead of guessing at it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-py-broken-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "app"), { recursive: true });
    await writeFile(path.join(root, "app", "broken.py"), "def oops(:\n    pass\n");
    await writeFile(path.join(root, "app", "fine.py"), "def handle_order(order: str) -> str:\n    return order\n");

    const raw = await analyzePythonProject(root);

    expect(raw.diagnostics.some((item) => item.code === "PYTHON_FILE_UNREADABLE")).toBe(true);
    // One unparseable file does not cost the rest of the project.
    expect(raw.nodes.some((node) => node.name === "handle_order")).toBe(true);
  });

  it("says so when no interpreter can analyze the Python it found", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-py-missing-"));
    temporaryDirectories.push(root);
    await writeFile(path.join(root, "main.py"), "def run():\n    return 1\n");

    const raw = await analyzePythonProject(root, { pythonPath: "definitely-not-a-python-interpreter" });

    // Silence would read as "this project has no Python logic", which is a lie.
    expect(raw.diagnostics.some((item) => item.code === "PYTHON_UNAVAILABLE")).toBe(true);
    expect(raw.nodes).toHaveLength(0);
  });

  it("skips tests and virtual environments", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-py-skip-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, ".venv", "lib"), { recursive: true });
    await mkdir(path.join(root, "app"), { recursive: true });
    await writeFile(path.join(root, ".venv", "lib", "vendored.py"), "def vendored():\n    return 1\n");
    await writeFile(path.join(root, "app", "test_orders.py"), "def test_orders():\n    assert True\n");
    await writeFile(path.join(root, "app", "orders.py"), "def place_order():\n    return 1\n");

    const raw = await analyzePythonProject(root);
    const names = raw.nodes.map((node) => node.name);

    expect(names).toContain("place_order");
    expect(names).not.toContain("vendored");
    expect(names).not.toContain("test_orders");
  });
});
