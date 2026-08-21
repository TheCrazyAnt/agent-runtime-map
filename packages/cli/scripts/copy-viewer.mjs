import { cp, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viewerBuild = path.resolve(packageRoot, "../../apps/viewer/dist");
const destination = path.join(packageRoot, "dist", "viewer");
await mkdir(destination, { recursive: true });
await cp(viewerBuild, destination, { recursive: true });

const bundledPackages = [
  "elkjs",
  "@xyflow/react",
  "@xyflow/system",
  "classcat",
  "zustand",
  "react",
  "react-dom",
  "scheduler",
  "lucide-react",
  "d3-color",
  "d3-dispatch",
  "d3-drag",
  "d3-ease",
  "d3-interpolate",
  "d3-selection",
  "d3-timer",
  "d3-transition",
  "d3-zoom",
  "use-sync-external-store",
];
const licenseDestination = path.join(packageRoot, "dist", "licenses");
await mkdir(licenseDestination, { recursive: true });
for (const packageName of bundledPackages) {
  const packageDirectory = path.resolve(packageRoot, "../../node_modules", packageName);
  const licenseFile = (await readdir(packageDirectory)).find((name) => /^licen[cs]e/i.test(name));
  if (!licenseFile) throw new Error(`No license file found for bundled package ${packageName}`);
  const safeName = packageName.replace(/^@/, "").replaceAll("/", "__");
  await cp(path.join(packageDirectory, licenseFile), path.join(licenseDestination, `${safeName}.txt`));
}
