import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

// The shape of `npm pack --json` differs by npm major: npm 10 prints a
// one-element array, npm 12 prints an object keyed by package name. The publish
// workflow runs npm@latest for OIDC support, so this script must read both.
function packReport(stdout, packageName) {
  const parsed = JSON.parse(stdout);
  const report = Array.isArray(parsed) ? parsed[0] : parsed[packageName] ?? parsed;
  if (!report?.files) throw new Error(`Unrecognized npm pack --json output for ${packageName}`);
  return { entryCount: report.files.length, ...report };
}

const packed = spawnSync("npm", ["pack", "--workspace", "agent-runtime-map", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
if (packed.status !== 0) process.exit(packed.status ?? 1);

const report = packReport(packed.stdout, "agent-runtime-map");
const paths = new Set(report.files.map((file) => file.path));
for (const required of ["dist/cli.js", "dist/viewer/index.html", "dist/python/extract.py", "dist/licenses/elkjs.txt", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "package.json"]) {
  if (!paths.has(required)) throw new Error(`Publish package is missing ${required}`);
}
if (report.size > 2_000_000) throw new Error(`Publish tarball is unexpectedly large: ${report.size} bytes`);

const manifest = JSON.parse(await readFile(new URL("../packages/cli/package.json", import.meta.url), "utf8"));
if (
  manifest.name !== "agent-runtime-map" ||
  manifest.bin?.["agent-runtime-map"] !== "dist/cli.js" ||
  manifest.bin?.["logic-map"] !== "dist/cli.js"
) {
  throw new Error("Public package name or binary mapping is invalid.");
}
if (Object.keys(manifest.dependencies ?? {}).some((name) => name.startsWith("@agent-runtime-map/"))) {
  throw new Error("Public package must not depend on unpublished workspace packages.");
}

process.stdout.write(`Package check passed: ${report.filename}, ${report.size} bytes, ${report.entryCount} files.\n`);

const componentPacked = spawnSync("npm", ["pack", "--workspace", "@agent-runtime-map/react", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
if (componentPacked.status !== 0) process.exit(componentPacked.status ?? 1);

const componentReport = packReport(componentPacked.stdout, "@agent-runtime-map/react");
const componentPaths = new Set(componentReport.files.map((file) => file.path));
for (const required of ["dist/index.js", "dist/index.d.ts", "dist/styles.css", "README.md", "package.json"]) {
  if (!componentPaths.has(required)) throw new Error(`React component package is missing ${required}`);
}

const componentManifest = JSON.parse(await readFile(new URL("../packages/react/package.json", import.meta.url), "utf8"));
if (
  componentManifest.name !== "@agent-runtime-map/react" ||
  componentManifest.publishConfig?.access !== "public" ||
  !componentManifest.peerDependencies?.["@xyflow/react"] ||
  !componentManifest.peerDependencies?.react
) {
  throw new Error("React component package metadata or peer dependencies are invalid.");
}

const mcpPacked = spawnSync("npm", ["pack", "--workspace", "@agent-runtime-map/mcp", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
if (mcpPacked.status !== 0) process.exit(mcpPacked.status ?? 1);
const mcpReport = packReport(mcpPacked.stdout, "@agent-runtime-map/mcp");
const mcpPaths = new Set(mcpReport.files.map((file) => file.path));
for (const required of ["dist/index.js", "dist/python/extract.py", "README.md", "package.json"]) {
  if (!mcpPaths.has(required)) throw new Error(`MCP package is missing ${required}`);
}
const mcpManifest = JSON.parse(await readFile(new URL("../packages/mcp/package.json", import.meta.url), "utf8"));
// Workspace packages are bundled into the server, so declaring them would make the
// published package depend on names npm cannot resolve.
if (Object.keys(mcpManifest.dependencies ?? {}).some((name) => name.startsWith("@agent-runtime-map/"))) {
  throw new Error("MCP package must not depend on unpublished workspace packages.");
}
process.stdout.write(`MCP package check passed: ${mcpReport.filename}, ${mcpReport.size} bytes, ${mcpReport.entryCount} files.\n`);

process.stdout.write(`Component package check passed: ${componentReport.filename}, ${componentReport.size} bytes, ${componentReport.entryCount} files.\n`);

// The repository moved to its canonical owner; the retired slug must never
// reappear in anything a user copies, installs, or that GitHub resolves as an
// action reference. Redirects work for browsers, not for a published identity.
{
  const { execFileSync } = await import("node:child_process");
  const RETIRED_SLUG = ["tangyishun9846", "agent-runtime-map"].join("/");
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).trim().split("\n");
  const offenders = [];
  for (const file of tracked) {
    const contents = await readFile(new URL(`../${file}`, import.meta.url), "utf8").catch(() => "");
    if (contents.includes(RETIRED_SLUG)) offenders.push(file);
  }
  if (offenders.length) {
    throw new Error(`Retired repository slug "${RETIRED_SLUG}" found in: ${offenders.join(", ")}`);
  }
  process.stdout.write("Repository identity check passed: no retired slug in tracked files.\n");
}
