#!/usr/bin/env node
/**
 * Gates the artifact upload: the output directory must contain exactly the map
 * artifacts, and nothing that smells like source, secrets, or environment. This is
 * defense in depth — the builder never writes anything else there — so a violation
 * means something is wrong enough that uploading would be the worse failure.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const ALLOWED_TOP_LEVEL = new Set([
  "graph.json",
  "raw-graph.json",
  "manifest.json",
  "status.json",
  "changes.json",
  "report.html",
  "assets",
]);

/** Nothing with these shapes belongs in a map artifact, at any depth. */
const FORBIDDEN_NAME = /(^|\.)(env(\..+)?$)|\.pem$|\.key$|^id_rsa|^id_ed25519|\.p12$|\.pfx$|\.keystore$|credentials/i;

const ALLOWED_ASSET_EXTENSIONS = new Set([".js", ".css", ".map", ".svg", ".woff", ".woff2", ".png", ".ico"]);

const target = process.argv[2];
if (!target) {
  console.error("usage: verify-artifact.mjs <current-dir>");
  process.exit(2);
}

let entries;
try {
  entries = readdirSync(target);
} catch {
  // No output at all (for example, a first build that failed before writing
  // anything). There is nothing to upload, and nothing unsafe about that.
  console.log(`verify-artifact: ${target} does not exist; nothing to verify.`);
  process.exit(0);
}

const problems = [];

for (const entry of entries) {
  if (!ALLOWED_TOP_LEVEL.has(entry)) {
    problems.push(`unexpected top-level entry: ${entry}`);
    continue;
  }
  const absolute = path.join(target, entry);
  if (entry === "assets" && statSync(absolute).isDirectory()) {
    for (const asset of readdirSync(absolute)) {
      if (FORBIDDEN_NAME.test(asset)) problems.push(`forbidden file in assets/: ${asset}`);
      else if (!ALLOWED_ASSET_EXTENSIONS.has(path.extname(asset).toLowerCase())) {
        problems.push(`unexpected asset type: assets/${asset}`);
      }
    }
  } else if (FORBIDDEN_NAME.test(entry)) {
    problems.push(`forbidden file: ${entry}`);
  }
}

if (problems.length) {
  console.error("verify-artifact: refusing to upload; the map directory is not clean:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`verify-artifact: ${entries.length} entries verified; only map artifacts present.`);
