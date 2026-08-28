/**
 * Scores an analysis against a hand-confirmed expectation file. Pure data in,
 * verdict out — the test suite fails on any miss, and the report script prints
 * the same verdicts as a table.
 *
 * Matching is deliberately loose on wording (case-insensitive substrings) and
 * strict on facts: a required node must exist with the right kind and evidence
 * file; a forbidden label must not appear on the map; a required diagnostic must
 * point at the right file; a forbidden edge must not have been invented.
 */

const contains = (haystack, needle) => haystack.toLowerCase().includes(needle.toLowerCase());

function nodeMatches(node, matcher) {
  if (matcher.kind && node.kind !== matcher.kind) return false;
  if (matcher.name && !contains(node.name, matcher.name)) return false;
  if (matcher.evidenceFile && !node.evidence?.some((item) => contains(item.source?.file ?? "", matcher.evidenceFile))) return false;
  return true;
}

const label = (matcher) => [matcher.kind, matcher.name].filter(Boolean).join(":");

/**
 * @returns {{ failures: string[], stats: Record<string, number> }}
 */
export function evaluateExpectations(expected, { rawGraph, graph }) {
  const failures = [];
  const rawNodes = rawGraph.nodes;
  const byId = new Map(rawNodes.map((node) => [node.id, node]));

  for (const matcher of expected.rawNodes?.required ?? []) {
    if (!rawNodes.some((node) => nodeMatches(node, matcher))) {
      failures.push(`missing node: ${label(matcher)}${matcher.evidenceFile ? ` (evidence in ${matcher.evidenceFile})` : ""}`);
    }
  }

  const findEdge = (matcher) => rawGraph.edges.find((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) return false;
    if (!nodeMatches(source, matcher.from) || !nodeMatches(target, matcher.to)) return false;
    if (matcher.control && edge.control !== matcher.control) return false;
    return true;
  });
  for (const matcher of expected.rawEdges?.required ?? []) {
    if (!findEdge(matcher)) {
      failures.push(`missing edge: ${label(matcher.from)} -> ${label(matcher.to)}${matcher.control ? ` (${matcher.control})` : ""}`);
    }
  }
  for (const matcher of expected.rawEdges?.forbidden ?? []) {
    if (findEdge(matcher)) {
      failures.push(`invented edge: ${label(matcher.from)} -> ${label(matcher.to)} — no code evidence supports it`);
    }
  }

  for (const matcher of expected.diagnostics?.required ?? []) {
    const found = rawGraph.diagnostics.some((diagnostic) =>
      diagnostic.code === matcher.code && (!matcher.file || contains(diagnostic.source?.file ?? "", matcher.file)));
    if (!found) failures.push(`missing diagnostic: ${matcher.code} in ${matcher.file ?? "any file"}`);
  }

  for (const forbidden of expected.logic?.forbiddenTypes ?? []) {
    const offender = graph.nodes.find((node) => node.type === forbidden);
    if (offender) failures.push(`forbidden logic type on the map: ${forbidden} ("${offender.label}")`);
  }
  for (const forbidden of expected.logic?.forbiddenLabels ?? []) {
    const offender = graph.nodes.find((node) => contains(node.label, forbidden));
    if (offender) failures.push(`forbidden label on the map: "${offender.label}"`);
  }

  const features = graph.features;
  const count = expected.logic?.featureCount;
  if (count && (features.length < count.min || features.length > count.max)) {
    failures.push(`feature count ${features.length} outside [${count.min}, ${count.max}]: ${features.map((f) => f.label).join(", ")}`);
  }
  for (const matcher of expected.logic?.features ?? []) {
    const feature = features.find((item) => contains(item.label, matcher.label));
    if (!feature) {
      failures.push(`missing feature: ${matcher.label}`);
      continue;
    }
    if (matcher.health && feature.health !== matcher.health) {
      failures.push(`feature ${feature.label} is ${feature.health}, expected ${matcher.health}`);
    }
    const routeLabels = feature.nodeIds
      .map((id) => graph.nodes.find((node) => node.id === id)?.label ?? "")
      .filter(Boolean);
    for (const step of matcher.routeIncludes ?? []) {
      if (!routeLabels.some((route) => contains(route, step))) {
        failures.push(`feature ${feature.label} route is missing "${step}" (route: ${routeLabels.join(", ")})`);
      }
    }
    for (const step of matcher.routeExcludes ?? []) {
      if (routeLabels.some((route) => contains(route, step))) {
        failures.push(`feature ${feature.label} route wrongly contains "${step}"`);
      }
    }
  }

  // Every visible element must trace to code evidence — no exceptions per sample.
  for (const node of graph.nodes) {
    if (!node.sources?.length) failures.push(`logic node without source evidence: ${node.label}`);
  }

  return {
    failures,
    stats: {
      rawNodes: rawNodes.filter((node) => node.kind !== "file").length,
      rawEdges: rawGraph.edges.filter((edge) => edge.kind !== "contains").length,
      logicNodes: graph.nodes.length,
      logicEdges: graph.edges.length,
      features: features.length,
      unresolved: rawGraph.diagnostics.filter((d) => d.code === "CALL_UNRESOLVED_DYNAMIC").length,
    },
  };
}
