import type { FeatureScenario, LocaleTag, LogicGraph, LogicNode, SemanticLabel } from "@agent-runtime-map/schema";

/**
 * What each tool hands back.
 *
 * An agent pays for every token it reads, so no tool returns the whole graph: a
 * compiled map of a real repository is hundreds of kilobytes, and an agent that
 * receives it spends its context on JSON punctuation. Each of these answers one
 * question and names the tool that answers the next.
 *
 * What they never drop is evidence. A map without a path and a confidence beside
 * each claim is an architecture poster, and an agent repeating it would be stating
 * as fact something nobody can check.
 *
 * Only the names and descriptions follow `locale`. The sentences around them —
 * "Route (…)", "Chain Doctor:", "This is a statically inferred route, not a
 * recorded run." — are protocol text an agent parses, so they stay English in
 * both locales rather than becoming a second format to keep in step.
 */

/** Only these two spellings; the Viewer and the compiler know no other locale. */
export const LOCALES: readonly LocaleTag[] = ["zh-CN", "en"];

/**
 * A name the deterministic pass could not read from evidence is still shown,
 * because hiding it would make the step vanish from the route. It is flagged in
 * the reader's language so an agent does not repeat a placeholder as a finding.
 */
const UNCONFIRMED: Record<LocaleTag, string> = { en: "[name unconfirmed]", "zh-CN": "[名称待确认]" };
/** What the compiler puts in front of a name it could not read; see localizeNodeSemantics. */
const PLACEHOLDER: Record<LocaleTag, string> = { en: "Unconfirmed · ", "zh-CN": "待确认 · " };

/** The slice of a semantic label the summaries read; `evidence` and the rest are not needed here. */
type Named = { label: string; semantic?: Pick<SemanticLabel, "label" | "technicalName" | "pending"> };
type Described = { description: string; semantic?: Pick<SemanticLabel, "description"> };

/**
 * The name an agent should use for a step, and the one a person sees on the map.
 *
 * These must be the same string. When they were not, an agent reported
 * `executeReviewWorkflow` while the human it was talking to was looking at
 * 执行审核 — and neither could tell they meant the same step. English is the
 * default because it is the language of this protocol; `zh-CN` gives the same
 * name the Viewer shows a Chinese reader, for an agent talking to one. Either
 * way the technical name is shown beside it so a lookup by either one succeeds,
 * and a pending name carries its marker rather than passing for a confirmed one.
 */
function displayName(item: Named, locale: LocaleTag = "en"): string {
  const semantic = item.semantic;
  if (!semantic) return item.label;
  const name = semantic.label[locale];
  const shown = name === semantic.technicalName ? name : `${name} (${semantic.technicalName})`;
  // A node the compiler could not name already says so in the name itself; a
  // feature composed from such a node does not, so the marker is added only where
  // the placeholder is absent, rather than saying "unconfirmed" twice.
  const flagged = semantic.pending && !name.startsWith(PLACEHOLDER[locale]);
  return flagged ? `${shown} ${UNCONFIRMED[locale]}` : shown;
}

/**
 * The description in the reader's language. The raw `description` is the fallback
 * for a graph compiled with `localize: false`, which carries no semantic block at
 * all; there it is the only description that exists.
 */
function displayDescription(item: Described, locale: LocaleTag = "en"): string {
  return item.semantic ? item.semantic.description[locale] : item.description;
}

const HEALTH_MARK: Record<string, string> = { healthy: "ok", warning: "needs review", error: "chain error" };

export function summarizeProject(graph: LogicGraph, rawNodeCount: number, locale: LocaleTag = "en"): string {
  const languages = graph.project.languages.join(", ") || "none detected";
  const frameworks = graph.project.frameworks.join(", ") || "none detected";
  const lines = [
    `${graph.project.name} — ${languages}`,
    `Frameworks: ${frameworks}`,
    `${graph.project.filesScanned} files scanned, ${rawNodeCount} code nodes compiled to ${graph.nodes.length} logic steps.`,
    "",
    summarizeFeatures(graph, locale),
  ];
  const blocking = graph.diagnostics.filter((item) => item.level !== "info");
  if (blocking.length) {
    lines.push("", "Analyzer notes:", ...blocking.map((item) => `  ${item.level}: ${item.message}`));
  }
  lines.push(
    "",
    "describe_feature gives the steps of one feature. get_evidence gives the source behind one step.",
  );
  return lines.join("\n");
}

export function summarizeFeatures(graph: LogicGraph, locale: LocaleTag = "en"): string {
  if (!graph.features.length) {
    return "No feature circuits were found. Nothing in this project reached an entry point the analyzer recognises.";
  }
  const rows = graph.features.map((feature) => {
    const steps = feature.variants[0]?.steps.length ?? 0;
    const branches = feature.variants.length > 1 ? `, ${feature.variants.length} variants` : "";
    const product = feature.product ? ` [name from ${feature.product.origin}]` : "";
    return `  ${displayName(feature, locale)} — ${HEALTH_MARK[feature.health] ?? feature.health}, ${steps} steps${branches}${product}\n    id: ${feature.id}`;
  });
  return [`Features (${graph.features.length}):`, ...rows].join("\n");
}

/**
 * One feature, step by step. Confidence travels with every step, because the point
 * of the route is that a reader can weigh it rather than take it.
 */
export function describeFeature(graph: LogicGraph, feature: FeatureScenario, variantId?: string, locale: LocaleTag = "en"): string {
  const variant = variantId ? feature.variants.find((item) => item.id === variantId) : feature.variants[0];
  if (!variant) {
    return `Feature ${displayName(feature, locale)} has no variant ${variantId}. Variants: ${feature.variants.map((item) => item.id).join(", ")}`;
  }
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const lines = [
    `${displayName(feature, locale)} — ${HEALTH_MARK[feature.health] ?? feature.health}`,
    displayDescription(feature, locale),
    "",
    `Route (${variant.label}), ${variant.steps.length} steps:`,
  ];

  variant.steps.forEach((step, index) => {
    for (const nodeId of step.nodeIds) {
      const node = byId.get(nodeId);
      if (!node) continue;
      lines.push(`  ${index + 1}. ${describeStep(node, locale)}`);
    }
  });

  if (feature.variants.length > 1) {
    lines.push("", `Other variants: ${feature.variants.filter((item) => item.id !== variant.id).map((item) => `${item.label} (${item.id})`).join(", ")}`);
  }
  if (feature.diagnostics.length) {
    lines.push("", "Chain Doctor:");
    for (const item of feature.diagnostics) {
      lines.push(`  ${item.severity}: ${item.message}`);
      if (item.suggestion) lines.push(`    suggestion: ${item.suggestion}`);
    }
  }
  lines.push("", "This is a statically inferred route, not a recorded run.");
  return lines.join("\n");
}

function describeStep(node: LogicNode, locale: LocaleTag = "en"): string {
  const source = node.sources[0];
  const where = source ? ` — ${source.file}:${source.startLine}` : "";
  return `${displayName(node, locale)} [${node.type}] ${Math.round(node.confidence * 100)}%${where}\n     ${displayDescription(node, locale)}\n     id: ${node.id}`;
}

/** Everything behind one step: where it was read, how, and what the project claims. */
export function describeEvidence(node: LogicNode, locale: LocaleTag = "en"): string {
  const lines = [
    `${displayName(node, locale)} [${node.type}]`,
    displayDescription(node, locale),
    "",
    `Code confidence: ${Math.round(node.confidence * 100)}% (${node.inference.method})`,
    `  ${node.inference.explanation}`,
    "",
    "Source:",
    ...node.sources.map((source) => `  ${source.file}:${source.startLine}${source.endLine && source.endLine !== source.startLine ? `-${source.endLine}` : ""}${source.symbol ? ` — ${source.symbol}` : ""}`),
  ];
  if (!node.sources.length) lines.push("  (none recorded)");

  // Kept separate from code confidence on purpose: a document describing the same
  // capability is not evidence that the code does it.
  lines.push("", "Product context:");
  if (node.product) {
    lines.push(
      `  ${node.product.label} — from ${node.product.origin}, match ${Math.round(node.product.match * 100)}%`,
      `  matched on ${node.product.matchedOn}: ${node.product.matchedTerms.join(", ")}`,
      ...node.product.sources.map((source) => `  ${source.file}:${source.startLine}`),
    );
  } else {
    lines.push("  Read from code only. Nothing the project writes about itself was matched to this step.");
  }

  lines.push("", `Raw node ids: ${node.rawNodeIds.join(", ")}`);
  return lines.join("\n");
}

/**
 * Finds a node by id, or by its label when an agent repeats what it was shown.
 * Both locales' names are tried whatever locale the answer was given in, so a
 * name copied from the Viewer by a Chinese reader resolves in an English session.
 */
export function findNode(graph: LogicGraph, idOrLabel: string): LogicNode | undefined {
  const normalized = idOrLabel.trim().toLowerCase();
  return graph.nodes.find((node) => node.id === idOrLabel)
    ?? graph.nodes.find((node) => node.label.toLowerCase() === normalized)
    ?? graph.nodes.find((node) => node.semantic?.technicalName.toLowerCase() === normalized)
    ?? graph.nodes.find((node) => node.semantic?.label.en.toLowerCase() === normalized)
    ?? graph.nodes.find((node) => node.semantic?.label["zh-CN"].toLowerCase() === normalized);
}

export function findFeature(graph: LogicGraph, idOrLabel: string): FeatureScenario | undefined {
  const normalized = idOrLabel.trim().toLowerCase();
  return graph.features.find((feature) => feature.id === idOrLabel)
    ?? graph.features.find((feature) => feature.label.toLowerCase() === normalized)
    ?? graph.features.find((feature) => feature.semantic?.label.en.toLowerCase() === normalized)
    ?? graph.features.find((feature) => feature.semantic?.label["zh-CN"].toLowerCase() === normalized);
}
