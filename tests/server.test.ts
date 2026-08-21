import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { generateLogicMap } from "@logic-map/core";
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
  });
});
