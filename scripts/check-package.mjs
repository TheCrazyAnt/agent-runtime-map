import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const packed = spawnSync("npm", ["pack", "--workspace", "agent-runtime-map", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
if (packed.status !== 0) process.exit(packed.status ?? 1);

const [report] = JSON.parse(packed.stdout);
const paths = new Set(report.files.map((file) => file.path));
for (const required of ["dist/cli.js", "dist/viewer/index.html", "dist/licenses/elkjs.txt", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "package.json"]) {
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

const [componentReport] = JSON.parse(componentPacked.stdout);
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

process.stdout.write(`Component package check passed: ${componentReport.filename}, ${componentReport.size} bytes, ${componentReport.entryCount} files.\n`);
