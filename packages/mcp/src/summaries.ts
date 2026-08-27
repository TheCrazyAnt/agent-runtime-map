import type { FeatureScenario, LogicGraph, LogicNode } from "@agent-runtime-map/schema";

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
 */

const HEALTH_MARK: Record<string, string> = { healthy: "ok", warning: "needs review", error: "chain error" };

export function summarizeProject(graph: LogicGraph, rawNodeCount: number): string {
  const languages = graph.project.languages.join(", ") || "none detected";
  const frameworks = graph.project.frameworks.join(", ") || "none detected";
  const lines = [
    `${graph.project.name} — ${languages}`,
    `Frameworks: ${frameworks}`,
    `${graph.project.filesScanned} files scanned, ${rawNodeCount} code nodes compiled to ${graph.nodes.length} logic steps.`,
    "",
    summarizeFeatures(graph),
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

export function summarizeFeatures(graph: LogicGraph): string {
  if (!graph.features.length) {
    return "No feature circuits were found. Nothing in this project reached an entry point the analyzer recognises.";
  }
  const rows = graph.features.map((feature) => {
    const steps = feature.variants[0]?.steps.length ?? 0;
    const branches = feature.variants.length > 1 ? `, ${feature.variants.length} variants` : "";
    const product = feature.product ? ` [name from ${feature.product.origin}]` : "";
    return `  ${feature.label} — ${HEALTH_MARK[feature.health] ?? feature.health}, ${steps} steps${branches}${product}\n    id: ${feature.id}`;
  });
  return [`Features (${graph.features.length}):`, ...rows].join("\n");
}

/**
 * One feature, step by step. Confidence travels with every step, because the point
 * of the route is that a reader can weigh it rather than take it.
 */
export function describeFeature(graph: LogicGraph, feature: FeatureScenario, variantId?: string): string {
  const variant = variantId ? feature.variants.find((item) => item.id === variantId) : feature.variants[0];
  if (!variant) {
    return `Feature ${feature.label} has no variant ${variantId}. Variants: ${feature.variants.map((item) => item.id).join(", ")}`;
  }
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const lines = [
    `${feature.label} — ${HEALTH_MARK[feature.health] ?? feature.health}`,
    feature.description,
    "",
    `Route (${variant.label}), ${variant.steps.length} steps:`,
  ];

  variant.steps.forEach((step, index) => {
    for (const nodeId of step.nodeIds) {
      const node = byId.get(nodeId);
      if (!node) continue;
      lines.push(`  ${index + 1}. ${describeStep(node)}`);
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

function describeStep(node: LogicNode): string {
  const source = node.sources[0];
  const where = source ? ` — ${source.file}:${source.startLine}` : "";
  return `${node.label} [${node.type}] ${Math.round(node.confidence * 100)}%${where}\n     ${node.description}\n     id: ${node.id}`;
}

/** Everything behind one step: where it was read, how, and what the project claims. */
export function describeEvidence(node: LogicNode): string {
  const lines = [
    `${node.label} [${node.type}]`,
    node.description,
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

/** Finds a node by id, or by its label when an agent repeats what it was shown. */
export function findNode(graph: LogicGraph, idOrLabel: string): LogicNode | undefined {
  const normalized = idOrLabel.trim().toLowerCase();
  return graph.nodes.find((node) => node.id === idOrLabel)
    ?? graph.nodes.find((node) => node.label.toLowerCase() === normalized);
}

export function findFeature(graph: LogicGraph, idOrLabel: string): FeatureScenario | undefined {
  const normalized = idOrLabel.trim().toLowerCase();
  return graph.features.find((feature) => feature.id === idOrLabel)
    ?? graph.features.find((feature) => feature.label.toLowerCase() === normalized);
}
