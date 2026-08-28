#!/usr/bin/env node
/**
 * Publishes the three packages through npm Trusted Publishing (OIDC).
 *
 * There is no token anywhere: in CI, npm exchanges the workflow's OIDC identity
 * for a short-lived publish credential, which is why the workflow needs
 * `id-token: write` and why this script must run from the exact repository and
 * workflow the npm Trusted Publisher configuration names.
 *
 * The script is deliberately re-runnable: versions the registry already has are
 * skipped, so a run that failed halfway is completed by running it again — and a
 * fully published release is a no-op, never an error.
 *
 * Usage:
 *   node scripts/publish-npm.mjs [--tag vX.Y.Z] [--dry-run]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLISH_ORDER, planPublish } from "./publish-plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tagIndex = args.indexOf("--tag");
const tag = tagIndex >= 0 ? args[tagIndex + 1] : undefined;

const manifests = {};
for (const { name, directory } of PUBLISH_ORDER) {
  manifests[name] = JSON.parse(readFileSync(path.join(root, directory, "package.json"), "utf8"));
}

const publishedVersions = {};
for (const { name } of PUBLISH_ORDER) {
  try {
    const output = execFileSync("npm", ["view", name, "versions", "--json"], { encoding: "utf8" });
    const parsed = JSON.parse(output);
    publishedVersions[name] = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // A package that has never been published returns E404; that is simply
    // "no versions yet", not a failure.
    publishedVersions[name] = [];
  }
}

const plan = planPublish({ manifests, tag, publishedVersions });
if (!plan.ok) {
  console.error("publish-npm: refusing to publish:");
  for (const error of plan.errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`publish-npm: release ${plan.version}${tag ? ` (tag ${tag})` : " (manual dispatch)"}${dryRun ? " [dry run]" : ""}`);
let published = 0;
for (const step of plan.steps) {
  if (step.action === "skip") {
    console.log(`  skip    ${step.name} — ${step.reason}`);
    continue;
  }
  console.log(`  publish ${step.name}@${plan.version} from ${step.directory}`);
  if (dryRun) continue;
  execFileSync("npm", ["publish", `./${step.directory}`, "--access", "public"], {
    cwd: root,
    stdio: "inherit",
  });
  // Trust nothing that was not read back: the registry must now report the version.
  const seen = execFileSync("npm", ["view", `${step.name}@${plan.version}`, "version"], { encoding: "utf8" }).trim();
  if (seen !== plan.version) {
    console.error(`publish-npm: registry reports ${step.name}@${seen} after publishing ${plan.version}; stopping.`);
    process.exit(1);
  }
  published += 1;
}

console.log(`publish-npm: done — ${published} published, ${plan.steps.length - published} skipped.`);
