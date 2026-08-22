import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { generateLogicMap } from "@agent-runtime-map/core";
import { startViewerServer, type ViewerServer } from "../packages/cli/src/server.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(repositoryRoot, "examples", "simple-agent");
const temporaryDirectories: string[] = [];
const servers: ViewerServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("viewer server", () => {
  it("serves packaged assets and generated graphs with security headers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-server-"));
    temporaryDirectories.push(root);
    await cp(fixture, root, { recursive: true });
    const viewerDirectory = path.join(root, "viewer");
    await mkdir(viewerDirectory);
    await writeFile(path.join(viewerDirectory, "index.html"), '<!doctype html><div id="root"></div>');
    const result = await generateLogicMap(root);
    const server = await startViewerServer({
      graphFile: result.outputFile,
      rawGraphFile: result.rawOutputFile,
      projectRoot: result.rawGraph.project.root,
      sourceFiles: [...new Set(result.graph.nodes.flatMap((node) => node.sources.map((source) => source.file)))],
      viewerDirectory,
      port: 0,
    });
    servers.push(server);

    const health = await fetch(`${server.url}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const graph = await fetch(`${server.url}/graph.json`);
    expect(graph.status).toBe(200);
    expect(graph.headers.get("cache-control")).toBe("no-store");
    expect(graph.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect((await graph.json()).nodes.length).toBeGreaterThan(5);

    const viewer = await fetch(server.url);
    expect(viewer.status).toBe(200);
    expect(await viewer.text()).toContain('<div id="root"></div>');

    const traversal = await fetch(`${server.url}/..%2F..%2Fpackage.json`);
    expect(traversal.status).toBe(403);

    const source = result.graph.nodes.flatMap((node) => node.sources)[0];
    expect(source).toBeDefined();
    const snippet = await fetch(`${server.url}/source.json?file=${encodeURIComponent(source!.file)}&start=${source!.startLine}&end=${source!.endLine ?? source!.startLine}`);
    expect(snippet.status).toBe(200);
    expect(snippet.headers.get("cache-control")).toBeNull();
    expect(await snippet.json()).toMatchObject({
      file: source!.file,
      highlightStart: source!.startLine,
    });

    const unlisted = await fetch(`${server.url}/source.json?file=${encodeURIComponent("package.json")}`);
    expect(unlisted.status).toBe(403);
    const sourceTraversal = await fetch(`${server.url}/source.json?file=${encodeURIComponent("../../package.json")}`);
    expect(sourceTraversal.status).toBe(403);
  });

  it("previews a document a product claim came from, and still refuses everything else", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-product-server-"));
    temporaryDirectories.push(root);
    await cp(fixture, root, { recursive: true });
    await writeFile(path.join(root, "SECRET.md"), "# Not part of the graph\n");
    const result = await generateLogicMap(root);
    const productFiles = [
      ...result.graph.nodes.flatMap((node) => node.product?.sources.map((source) => source.file) ?? []),
      ...result.graph.features.flatMap((feature) => feature.product?.sources.map((source) => source.file) ?? []),
    ];
    expect(productFiles.length).toBeGreaterThan(0);

    const server = await startViewerServer({
      graphFile: result.outputFile,
      rawGraphFile: result.rawOutputFile,
      projectRoot: result.rawGraph.project.root,
      // The CLI widens the allow-list the same way, so attribution is checkable.
      sourceFiles: [...new Set([
        ...result.graph.nodes.flatMap((node) => node.sources.map((source) => source.file)),
        ...productFiles,
      ])],
      port: 0,
    });
    servers.push(server);

    const documented = await fetch(`${server.url}/source.json?file=${encodeURIComponent(productFiles[0]!)}&start=1&end=4`);
    expect(documented.status).toBe(200);
    expect((await documented.json()).file).toBe(productFiles[0]);

    // Widening the allow-list must not turn it into a general file endpoint.
    const unrelated = await fetch(`${server.url}/source.json?file=${encodeURIComponent("SECRET.md")}`);
    expect(unrelated.status).toBe(403);
  });
});
