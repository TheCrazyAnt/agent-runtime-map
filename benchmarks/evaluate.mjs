/**
 * Scores an analysis against a hand-confirmed expectation file, as an exact
 * topology check over business semantics — not a spot check.
 *
 * The expectation file is an ALLOWLIST: every business node and every business
 * edge the analyzer emits must match an entry, or it counts as a false
 * positive; every non-optional entry must be matched, or it counts as a false
 * negative. Structural noise (files, `contains`, `imports`) is out of scope on
 * both sides. Feature routes are verified in order, per variant, with their
 * control kinds — and every visible logic node and edge must carry a complete
 * evidence chain back to a file and line.
 */

/** The node kinds that carry business meaning and are held to the allowlist. */
const BUSINESS_NODE_KINDS = new Set([
  "route", "service", "agent", "workflow", "tool", "model", "prompt", "human_gate", "database", "external_api",
]);

/** Edge kinds that claim behavior; `contains`/`imports` are structure, not claims. */
const BUSINESS_EDGE_KINDS = new Set(["calls", "handles", "reads", "writes", "requests", "data_flow", "triggers", "uses"]);

/** Kinds an edge endpoint may have and still describe business flow. */
const FLOW_ENDPOINT_KINDS = new Set([...BUSINESS_NODE_KINDS, "function"]);

const contains = (haystack, needle) => haystack.toLowerCase().includes(needle.toLowerCase());

function nodeMatches(node, matcher) {
  if (matcher.kind && node.kind !== matcher.kind) return false;
  if (matcher.name && !contains(node.name, matcher.name)) return false;
  if (matcher.evidenceFile && !node.evidence?.some((item) => contains(item.source?.file ?? "", matcher.evidenceFile))) return false;
  return true;
}

const describeMatcher = (matcher) => [matcher.kind, matcher.name].filter(Boolean).join(":");
const describeNode = (node) => `${node.kind}:${node.name}`;

export function evaluateExpectations(expected, { rawGraph, graph }) {
  const failures = [];
  const counts = { nodes: { tp: 0, fp: 0, fn: 0 }, edges: { tp: 0, fp: 0, fn: 0 } };
  const byId = new Map(rawGraph.nodes.map((node) => [node.id, node]));
  /**
   * A sample may opt out of the exact raw allowlist. Only one does: `large-platform`
   * asks what survives *compression*, and enumerating its ~150 extracted nodes would
   * bury that one claim under an inventory the four small samples already guarantee.
   * Extraction accuracy stays their job; this flag never relaxes a logic-level check.
   */
  const exactRawTopology = expected.scope?.exactRawTopology !== false;

  // ---- Business nodes: exact allowlist -------------------------------------
  const allowedNodes = exactRawTopology ? (expected.nodes ?? []) : [];
  const businessNodes = rawGraph.nodes.filter((node) => BUSINESS_NODE_KINDS.has(node.kind));
  const matchedNodeEntries = new Set();
  for (const node of exactRawTopology ? businessNodes : []) {
    const entry = allowedNodes.find((matcher) => nodeMatches(node, matcher));
    if (entry) {
      counts.nodes.tp += 1;
      matchedNodeEntries.add(entry);
    } else {
      counts.nodes.fp += 1;
      failures.push(`FP node: ${describeNode(node)} — not in the hand-confirmed answer`);
    }
  }
  for (const entry of allowedNodes) {
    if (!entry.optional && !matchedNodeEntries.has(entry)) {
      counts.nodes.fn += 1;
      failures.push(`FN node: ${describeMatcher(entry)}${entry.evidenceFile ? ` (evidence in ${entry.evidenceFile})` : ""}`);
    }
  }

  // ---- Business edges: exact allowlist -------------------------------------
  const allowedEdges = exactRawTopology ? (expected.edges ?? []) : [];
  const businessEdges = rawGraph.edges.filter((edge) => {
    if (!BUSINESS_EDGE_KINDS.has(edge.kind)) return false;
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target || !FLOW_ENDPOINT_KINDS.has(source.kind) || !FLOW_ENDPOINT_KINDS.has(target.kind)) return false;
    // A call between two plain functions is implementation flow, not a business
    // claim; the allowlist governs edges that touch at least one semantic node.
    return BUSINESS_NODE_KINDS.has(source.kind) || BUSINESS_NODE_KINDS.has(target.kind);
  });
  const edgeMatches = (edge, matcher) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!nodeMatches(source, matcher.from) || !nodeMatches(target, matcher.to)) return false;
    if (matcher.kind && edge.kind !== matcher.kind) return false;
    if (matcher.control && edge.control !== matcher.control) return false;
    return true;
  };
  const matchedEdgeEntries = new Set();
  for (const edge of exactRawTopology ? businessEdges : []) {
    const entry = allowedEdges.find((matcher) => edgeMatches(edge, matcher));
    if (entry) {
      counts.edges.tp += 1;
      matchedEdgeEntries.add(entry);
    } else {
      counts.edges.fp += 1;
      failures.push(`FP edge: ${describeNode(byId.get(edge.source))} -[${edge.kind}${edge.control && edge.control !== "sequential" ? `/${edge.control}` : ""}]-> ${describeNode(byId.get(edge.target))} — not in the hand-confirmed answer`);
    }
  }
  for (const entry of allowedEdges) {
    if (!entry.optional && !matchedEdgeEntries.has(entry)) {
      counts.edges.fn += 1;
      failures.push(`FN edge: ${describeMatcher(entry.from)} -> ${describeMatcher(entry.to)}${entry.control ? ` (${entry.control})` : ""}`);
    }
  }

  // ---- Diagnostics ---------------------------------------------------------
  // Extraction diagnostics land on the raw graph, compression diagnostics on the logic
  // graph; a required diagnostic is a claim about the analysis, not about which of the
  // two layers happened to record it.
  for (const matcher of expected.diagnostics?.required ?? []) {
    const found = [...rawGraph.diagnostics, ...graph.diagnostics].some((diagnostic) =>
      diagnostic.code === matcher.code && (!matcher.file || contains(diagnostic.source?.file ?? "", matcher.file)));
    if (!found) failures.push(`missing diagnostic: ${matcher.code} in ${matcher.file ?? "any file"}`);
  }

  // ---- Logic-level prohibitions -------------------------------------------
  for (const forbidden of expected.logic?.forbiddenTypes ?? []) {
    const offender = graph.nodes.find((node) => node.type === forbidden);
    if (offender) failures.push(`forbidden logic type on the map: ${forbidden} ("${offender.label}")`);
  }
  for (const forbidden of expected.logic?.forbiddenLabels ?? []) {
    const offender = graph.nodes.find((node) => contains(node.label, forbidden));
    if (offender) failures.push(`forbidden label on the map: "${offender.label}"`);
  }
  /**
   * Nodes that must survive compression. When the code has more business nodes than
   * the budget draws, "which ones" is the whole question: a map that keeps a feature's
   * entry but drops the agent it calls has not compressed the feature, it has hidden it.
   */
  for (const required of expected.logic?.requiredNodes ?? []) {
    const found = graph.nodes.find((node) =>
      contains(node.label, required.label) && (!required.type || node.type === required.type));
    if (!found) {
      const near = graph.nodes.find((node) => contains(node.label, required.label));
      failures.push(near
        ? `required logic node "${required.label}" survived as type ${near.type}, expected ${required.type}`
        : `required logic node missing from the compressed map: ${required.type ?? "any"}:${required.label}`);
    }
  }
  /**
   * An entry with nothing downstream is a doorway drawn without the room behind it.
   * A handful is normal (a health check really does end there); a map made mostly of
   * them means the budget went to breadth and every chain was cut off at the door.
   */
  const danglingCap = expected.logic?.maxDanglingEntrypoints;
  if (typeof danglingCap === "number") {
    const dangling = graph.nodes.filter((node) =>
      node.type === "entrypoint" && !graph.edges.some((edge) => edge.source === node.id));
    if (dangling.length > danglingCap) {
      failures.push(`${dangling.length} entrypoints have no downstream step (cap ${danglingCap}): ${dangling.slice(0, 6).map((node) => node.label).join(", ")}${dangling.length > 6 ? ", …" : ""}`);
    }
  }

  // ---- Features: ordered routes, per variant, with control kinds -----------
  const features = graph.features;
  const count = expected.featureCount;
  if (count && (features.length < count.min || features.length > count.max)) {
    failures.push(`feature count ${features.length} outside [${count.min}, ${count.max}]: ${features.map((f) => f.label).join(", ")}`);
  }
  const labelOf = (id) => graph.nodes.find((node) => node.id === id)?.label ?? "";
  const entryNodesOf = (feature) => feature.entryNodeIds
    .map((id) => graph.nodes.find((node) => node.id === id))
    .filter(Boolean);
  const matchesEntry = (feature, entry) => entryNodesOf(feature).some((node) =>
    contains(node.label, entry.label) && (!entry.type || node.type === entry.type));
  for (const matcher of expected.features ?? []) {
    // Select by entry when one is given. A feature's *label* can be borrowed from a
    // document, so pinning an expectation to it would test the project's prose; its
    // entry is a code fact, and on this sample it is the fact under test.
    const feature = matcher.entry
      ? features.find((item) => matchesEntry(item, matcher.entry))
        ?? (matcher.label ? features.find((item) => contains(item.label, matcher.label)) : undefined)
      : features.find((item) => contains(item.label, matcher.label));
    if (!feature) {
      failures.push(`missing feature: ${matcher.label ?? `${matcher.entry.type ?? "any"}:${matcher.entry.label}`}`);
      continue;
    }
    if (matcher.health && feature.health !== matcher.health) {
      failures.push(`feature ${feature.label} is ${feature.health}, expected ${matcher.health}`);
    }
    if (matcher.healthNot && feature.health === matcher.healthNot) {
      failures.push(`feature ${feature.label} is ${feature.health}, which it must not be`);
    }
    /**
     * Where the feature begins, as a person tracing the code would name it. A feature
     * rooted at an interior step is not a smaller answer to "how does this run" — it is
     * a wrong one, because it asserts work starts somewhere it does not.
     */
    if (matcher.entry && !matchesEntry(feature, matcher.entry)) {
      const entries = entryNodesOf(feature);
      failures.push(`feature ${feature.label} begins at ${entries.map((node) => `${node.type}:${node.label}`).join(", ") || "nothing"}, expected ${matcher.entry.type ?? "any"}:${matcher.entry.label}`);
    }
    /** Chain diagnostics the feature must carry — an honest "unknown" beats a clean lie. */
    for (const required of matcher.diagnostics ?? []) {
      if (!feature.diagnostics.some((item) => item.code === required.code)) {
        failures.push(`feature ${feature.label} is missing diagnostic ${required.code} (has: ${feature.diagnostics.map((item) => item.code).join(", ") || "none"})`);
      }
    }
    const variantCount = matcher.variantCount;
    if (variantCount && (feature.variants.length < variantCount.min || feature.variants.length > variantCount.max)) {
      failures.push(`feature ${feature.label} has ${feature.variants.length} variants, expected [${variantCount.min}, ${variantCount.max}]`);
    }
    // Each expected variant must be realized by some analyzed variant whose
    // ordered step labels contain the expected route as a subsequence.
    const variantRoutes = feature.variants.map((variant) => ({
      variant,
      route: [...variant.steps].sort((a, b) => a.order - b.order).flatMap((step) => step.nodeIds.map(labelOf)),
    }));
    for (const expectedVariant of matcher.variants ?? []) {
      const realized = variantRoutes.find(({ route }) => isOrderedSubsequence(expectedVariant.orderedRoute, route, contains));
      if (!realized) {
        failures.push(`feature ${feature.label}: no variant realizes the ordered route [${expectedVariant.orderedRoute.join(" -> ")}] (variants: ${variantRoutes.map(({ route }) => route.join(" -> ")).join(" | ")})`);
        continue;
      }
      for (const controlMatcher of expectedVariant.controls ?? []) {
        const found = realized.variant.edgeIds
          .map((id) => graph.edges.find((edge) => edge.id === id))
          .some((edge) => edge
            && contains(labelOf(edge.source), controlMatcher.from)
            && contains(labelOf(edge.target), controlMatcher.to)
            && edge.control === controlMatcher.control);
        if (!found) {
          failures.push(`feature ${feature.label}: variant [${expectedVariant.orderedRoute.join(" -> ")}] is missing ${controlMatcher.control} control on ${controlMatcher.from} -> ${controlMatcher.to}`);
        }
      }
    }
    const allRouteLabels = feature.nodeIds.map(labelOf);
    for (const step of matcher.routeExcludes ?? []) {
      if (allRouteLabels.some((route) => contains(route, step))) {
        failures.push(`feature ${feature.label} route wrongly contains "${step}"`);
      }
    }
  }

  // ---- Evidence chain: every visible element traces to file and line -------
  const rawEdgeById = new Map(rawGraph.edges.map((edge) => [edge.id, edge]));
  for (const node of graph.nodes) {
    const source = node.sources?.[0];
    if (!source?.file || !(source.startLine > 0)) {
      failures.push(`logic node without file:line evidence: ${node.label}`);
    }
  }
  for (const edge of graph.edges) {
    const from = labelOf(edge.source);
    const to = labelOf(edge.target);
    if (!edge.rawEdgeIds?.length) {
      failures.push(`logic edge without raw provenance: ${from} -> ${to}`);
      continue;
    }
    for (const rawId of edge.rawEdgeIds) {
      const rawEdge = rawEdgeById.get(rawId);
      if (!rawEdge) {
        failures.push(`logic edge ${from} -> ${to} references missing raw edge ${rawId}`);
        continue;
      }
      const evidence = rawEdge.evidence?.[0];
      if (!evidence?.source?.file || !(evidence.source.startLine > 0)) {
        failures.push(`raw edge behind ${from} -> ${to} has no file:line evidence`);
      }
    }
  }

  return {
    failures,
    counts,
    stats: {
      rawNodes: businessNodes.length,
      rawEdges: businessEdges.length,
      logicNodes: graph.nodes.length,
      logicEdges: graph.edges.length,
      features: features.length,
      unresolved: rawGraph.diagnostics.filter((d) => d.code === "CALL_UNRESOLVED_DYNAMIC").length,
    },
  };
}

/** Whether `needles` appear in `haystack` in order (gaps allowed). */
function isOrderedSubsequence(needles, haystack, matches) {
  let position = 0;
  for (const needle of needles) {
    while (position < haystack.length && !matches(haystack[position], needle)) position += 1;
    if (position >= haystack.length) return false;
    position += 1;
  }
  return true;
}
