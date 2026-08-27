#!/usr/bin/env node
/**
 * Writes the GitHub Step Summary from the map artifacts. Everything shown here is
 * read back from what was actually written to disk — the summary can never claim
 * more than the artifact contains.
 */
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";

const currentDir = process.argv[2];
if (!currentDir) {
  console.error("usage: summary.mjs <current-dir>");
  process.exit(2);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(path.join(currentDir, file), "utf8"));
  } catch {
    return undefined;
  }
}

const status = readJson("status.json");
const manifest = readJson("manifest.json");
const changes = readJson("changes.json");
const graph = readJson("graph.json");

const artifactName = process.env.ARTIFACT_NAME || "agent-runtime-map";
const uploadEnabled = process.env.UPLOAD_ENABLED !== "false";
const buildOk = process.env.BUILD_OK === "true";
const buildUnchanged = process.env.BUILD_UNCHANGED === "true";
const baselineRestored = process.env.BASELINE_RESTORED === "true";

const lines = [];
const short = (sha) => (typeof sha === "string" && sha.length > 10 ? sha.slice(0, 10) : sha);
const escape = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "\\|");

lines.push("# Agent Runtime Map");
lines.push("");

const stateLabel = !buildOk
  ? "❌ failed — the last successful map was preserved"
  : buildUnchanged
    ? "✅ updated (map unchanged by this commit)"
    : "✅ updated";
lines.push("| | |");
lines.push("|---|---|");
lines.push(`| Status | ${stateLabel} |`);
if (manifest?.buildId) lines.push(`| Build | \`${manifest.buildId}\` |`);
if (manifest?.toolVersion || status?.toolVersion) lines.push(`| Tool version | \`${manifest?.toolVersion ?? status?.toolVersion}\` |`);
if (manifest?.commit?.sha) lines.push(`| Commit | \`${short(manifest.commit.sha)}\` |`);
if (manifest?.commit?.baselineSha) lines.push(`| Baseline | \`${short(manifest.commit.baselineSha)}\` (restored: ${manifest.commit.baselineRestored ? "yes" : "no"}) |`);
else if (changes?.initial) lines.push("| Baseline | none — initial build |");
else if (baselineRestored) lines.push("| Baseline | restored from cache |");
if (graph) lines.push(`| Map | ${graph.features?.length ?? 0} features · ${graph.nodes?.length ?? 0} nodes · ${graph.edges?.length ?? 0} flows |`);
if (!buildOk && status?.error?.message) lines.push(`| Failure | ${escape(status.error.message).slice(0, 300)} |`);
if (!buildOk && status?.lastSuccessAt) lines.push(`| Preserved map from | ${status.lastSuccessAt} |`);
lines.push("");

if (buildOk && changes && !buildUnchanged) {
  if (changes.initial) {
    lines.push(`**Initial build** — no baseline to compare against; every node is new by definition (${changes.nodes.added.length} nodes, ${changes.edges.added.length} flows, ${changes.features.added.length} features).`);
  } else {
    lines.push("## What changed");
    lines.push("");
    lines.push("| | added | removed | modified |");
    lines.push("|---|---|---|---|");
    lines.push(`| Nodes | ${changes.nodes.added.length} | ${changes.nodes.removed.length} | ${changes.nodes.modified.length} |`);
    lines.push(`| Flows | ${changes.edges.added.length} | ${changes.edges.removed.length} | ${changes.edges.modified.length} |`);
    lines.push(`| Features | ${changes.features.added.length} | ${changes.features.removed.length} | ${changes.features.modified.length} |`);
    lines.push("");
    const list = (items, render) => items.slice(0, 10).map(render).join(", ") + (items.length > 10 ? ` … +${items.length - 10} more` : "");
    if (changes.affectedFeatures.length) {
      lines.push(`**Affected features:** ${list(changes.affectedFeatures, (f) => escape(f.label))}`);
      lines.push("");
    }
    if (changes.nodes.added.length) {
      lines.push(`**New steps:** ${list(changes.nodes.added, (n) => `${escape(n.label)} (${n.type})`)}`);
      lines.push("");
    }
    if (changes.nodes.removed.length) {
      lines.push(`**Removed steps:** ${list(changes.nodes.removed, (n) => escape(n.label))}`);
      lines.push("");
    }
  }
  const appeared = changes.diagnostics?.appeared ?? [];
  const resolved = changes.diagnostics?.resolved ?? [];
  if (appeared.length) {
    lines.push("### ⚠️ New diagnostics");
    for (const item of appeared.slice(0, 10)) lines.push(`- **${item.level}** \`${item.code}\` ${escape(item.message)}`);
    if (appeared.length > 10) lines.push(`- … +${appeared.length - 10} more`);
    lines.push("");
  }
  if (resolved.length) {
    lines.push("### ✅ Resolved diagnostics");
    for (const item of resolved.slice(0, 10)) lines.push(`- \`${item.code}\` ${escape(item.message)}`);
    if (resolved.length > 10) lines.push(`- … +${resolved.length - 10} more`);
    lines.push("");
  }
  if (changes.trigger?.length) {
    const shown = changes.trigger.slice(0, 15).map((t) => `\`${escape(t)}\``).join(", ");
    lines.push(`**Triggered by:** ${shown}${changes.trigger.length > 15 ? ` … +${changes.trigger.length - 15} more` : ""}`);
    lines.push("");
  }
}

lines.push("## The full map");
lines.push("");
if (uploadEnabled) {
  lines.push(`Download the **${escape(artifactName)}** artifact from this run's page, unzip it, and serve the folder (\`npx serve .\`) to open \`report.html\` — the complete interactive viewer. Opening the file directly shows a static summary.`);
} else {
  lines.push("Artifact upload was disabled for this run; the map exists only in the runner's workspace.");
}
lines.push("");

const summaryFile = process.env.GITHUB_STEP_SUMMARY;
const output = lines.join("\n") + "\n";
if (summaryFile) appendFileSync(summaryFile, output);
else process.stdout.write(output);
