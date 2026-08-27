import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// tsup inlines the Python adapter's JavaScript but not the extractor script it
// reads, so it is copied beside the bundle. Without it the adapter degrades to
// "no interpreter" and a Python project silently reads as having no features.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(packageRoot, "../../adapters/python/scripts/extract.py");
const destination = path.join(packageRoot, "dist", "python");
await mkdir(destination, { recursive: true });
await cp(source, path.join(destination, "extract.py"));
