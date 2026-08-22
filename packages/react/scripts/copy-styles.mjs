import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(path.join(packageRoot, "dist"), { recursive: true });
await copyFile(path.join(packageRoot, "src", "styles.css"), path.join(packageRoot, "dist", "styles.css"));
