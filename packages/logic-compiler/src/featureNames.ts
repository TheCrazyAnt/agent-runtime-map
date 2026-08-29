import type {
  FeatureScenario,
  LocaleTag,
  LogicNode,
  LogicNodeType,
  SemanticLabel,
  SourceLocation,
} from "@agent-runtime-map/schema";
import { LOCALES } from "./localization.js";

/**
 * Composes a feature's business name from what it actually does: where it starts,
 * the step that carries its weight, and what it produces.
 *
 * Two routes named after the same capability read as the same feature on the left
 * rail, which is worse than a clumsy name — the reader cannot tell which one they
 * clicked. So names are disambiguated **minimally**: a name that is already unique
 * stays short, and only a collision earns extra words.
 *
 * `FeatureScenario.label` is deliberately left alone. It is hashed into the
 * feature's id, and renaming it would invalidate every saved layout and trace
 * overlay that refers to this feature by that id.
 */

/**
 * Which interior step best represents the feature, most representative first.
 *
 * A data store and an external service are deliberately absent: they are what a
 * step touches, not the work itself. Naming a feature "工单数据" after the table it
 * writes tells the reader nothing about what the feature is for.
 */
const MAIN_STEP_PRIORITY: LogicNodeType[] = [
  "ai_process", "workflow", "human_gate", "tool", "decision", "process",
];

interface Parts {
  entry?: LogicNode;
  /** Candidate main steps, most representative first. */
  mains: LogicNode[];
  result?: LogicNode;
}

export function composeFeatureNames(
  features: FeatureScenario[],
  nodesById: ReadonlyMap<string, LogicNode>,
): void {
  const parts = new Map<string, Parts>(features.map((feature) => [feature.id, featureParts(feature, nodesById)]));

  // Round one: the shortest honest name for each feature.
  const base = new Map<string, Record<LocaleTag, string>>();
  for (const feature of features) {
    const item = parts.get(feature.id)!;
    base.set(feature.id, {
      "zh-CN": baseName(item, "zh-CN") ?? feature.label,
      en: baseName(item, "en") ?? feature.label,
    });
  }

  // Round two: only where a name collides does it earn distinguishing words.
  for (const locale of LOCALES) {
    const byName = new Map<string, FeatureScenario[]>();
    for (const feature of features) {
      const name = base.get(feature.id)![locale];
      byName.set(name, [...(byName.get(name) ?? []), feature]);
    }
    for (const [, group] of byName) {
      if (group.length < 2) continue;
      for (const feature of group) {
        const item = parts.get(feature.id)!;
        const distinguishing = namedResult(item.result, locale)
          ?? (item.entry?.semantic?.labelSource[locale] === "route" ? nameOf(item.entry, locale) : undefined)
          ?? mainName(item, locale);
        const current = base.get(feature.id)!;
        if (!distinguishing || distinguishing === current[locale]) continue;
        current[locale] = `${current[locale]} · ${distinguishing}`;
      }
    }
    // Features that collide *because* they share a result take the same suffix,
    // so one more pass falls back to the entry — which is unique by construction.
    const stillColliding = new Map<string, FeatureScenario[]>();
    for (const feature of features) {
      const name = base.get(feature.id)![locale];
      stillColliding.set(name, [...(stillColliding.get(name) ?? []), feature]);
    }
    for (const [, group] of stillColliding) {
      if (group.length < 2) continue;
      for (const feature of group) {
        const entry = nameOf(parts.get(feature.id)!.entry, locale) ?? feature.label;
        const current = base.get(feature.id)!;
        if (!current[locale].includes(entry)) current[locale] = `${current[locale]} · ${entry}`;
      }
    }
  }

  for (const feature of features) {
    const item = parts.get(feature.id)!;
    const names = base.get(feature.id)!;
    const composedIn = (locale: LocaleTag) => baseName(item, locale) !== undefined;
    feature.semantic = {
      label: { "zh-CN": names["zh-CN"], en: names.en },
      description: {
        "zh-CN": sentence("zh-CN", item) ?? feature.description,
        en: sentence("en", item) ?? feature.description,
      },
      technicalName: feature.label,
      // A feature that fell back to its raw technical label did not compose
      // anything, and saying it did would make the fallback invisible.
      labelSource: {
        "zh-CN": composedIn("zh-CN") ? "composed" : "pending",
        en: composedIn("en") ? "composed" : "pending",
      },
      confidence: {
        "zh-CN": partsConfidence(item, "zh-CN"),
        en: partsConfidence(item, "en"),
      },
      pending: [item.entry, item.mains[0], item.result].some((node) => node?.semantic?.pending === true),
      evidence: evidenceOf(item),
    } satisfies SemanticLabel;
  }
}

function featureParts(feature: FeatureScenario, nodesById: ReadonlyMap<string, LogicNode>): Parts {
  const nodes = feature.nodeIds.flatMap((id) => { const node = nodesById.get(id); return node ? [node] : []; });
  const entry = nodesById.get(feature.entryNodeIds[0] ?? "") ?? nodes[0];
  const result = nodesById.get(feature.resultNodeIds[0] ?? "")
    ?? nodesById.get(feature.variants[0]?.resultNodeId ?? "");
  // The step that carries the feature: the most representative kind, and among
  // equals the one the most routes pass through.
  const interior = nodes.filter((node) =>
    node.id !== entry?.id && node.id !== result?.id && MAIN_STEP_PRIORITY.includes(node.type));
  const routesThrough = (node: LogicNode) =>
    feature.variants.filter((variant) => variant.nodeIds.includes(node.id)).length;
  const mains = [...interior].sort((a, b) =>
    MAIN_STEP_PRIORITY.indexOf(a.type) - MAIN_STEP_PRIORITY.indexOf(b.type)
    || routesThrough(b) - routesThrough(a)
    || a.id.localeCompare(b.id));
  return { entry, mains, result };
}

/**
 * A feature is named after the work it does, not the address it answers on.
 * `POST /api/tickets` tells a reader where to send a request; 处理工单 tells them
 * what the system will do with it — and the address is still the disambiguator
 * when two features would otherwise share a name.
 */
function baseName(parts: Parts, locale: LocaleTag): string | undefined {
  const entry = nameOf(parts.entry, locale);
  const entryIsAddress = parts.entry?.semantic?.labelSource[locale] === "route";
  if (entryIsAddress) return mainName(parts, locale) ?? namedResult(parts.result, locale) ?? entry;
  return entry ?? mainName(parts, locale);
}

/**
 * The most representative step this language can actually name. A step that is
 * pending in Chinese may be readable in English and vice versa, so each language
 * walks the same ranked list and takes the first one it can say — which is what
 * keeps a feature from being called 处理工单 in one language and by its raw route
 * in the other.
 */
function mainName(parts: Parts, locale: LocaleTag): string | undefined {
  return nameOf(namedMain(parts, locale), locale);
}

/** The first candidate this language can actually name. */
function namedMain(parts: Parts, locale: LocaleTag): LogicNode | undefined {
  return parts.mains.find((candidate) => nameOf(candidate, locale) !== undefined);
}

/**
 * A result may name a feature only when it is the product of the work. A chain
 * that ends at a database table or a third-party host ends there incidentally;
 * naming the feature "工单数据" or "kb.internal.example.com" tells the reader what
 * it touched last, not what it is for.
 */
function namedResult(result: LogicNode | undefined, locale: LocaleTag): string | undefined {
  if (!result || result.type === "data" || result.type === "external_system") return undefined;
  return nameOf(result, locale);
}

function nameOf(node: LogicNode | undefined, locale: LocaleTag): string | undefined {
  if (!node) return undefined;
  const semantic = node.semantic;
  // A pending step contributes nothing to a feature name: naming a feature after
  // 待确认 would spread one unread step's uncertainty over the whole chain.
  if (!semantic || semantic.labelSource[locale] === "pending") return undefined;
  return semantic.label[locale];
}

function sentence(locale: LocaleTag, parts: Parts): string | undefined {
  const entry = nameOf(parts.entry, locale);
  const main = mainName(parts, locale);
  // A route whose result IS its entry produced "从「X」开始…最终产出「X」" — a
  // sentence that says the chain goes nowhere, in more words than saying nothing.
  const result = parts.result && parts.result.id !== parts.entry?.id
    ? nameOf(parts.result, locale)
    : undefined;
  if (!entry) return undefined;
  if (locale === "zh-CN") {
    const middle = main ? `，经过「${main}」` : "";
    const end = result ? `，最终产出「${result}」` : "";
    return `从「${entry}」开始${middle}${end}。`;
  }
  const middle = main ? `, runs ${main}` : "";
  const end = result ? `, and produces ${result}` : "";
  return `Starts at ${entry}${middle}${end}.`;
}

function partsConfidence(parts: Parts, locale: LocaleTag): number {
  // The steps the name was actually built from — not whichever candidate ranked
  // first, which may have been skipped as unnameable in this language.
  const scores = [parts.entry, namedMain(parts, locale), parts.result]
    .flatMap((node) => (node?.semantic ? [node.semantic.confidence[locale]] : []));
  if (!scores.length) return 0;
  return Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 100) / 100;
}

function evidenceOf(parts: Parts): SourceLocation[] {
  const sources: SourceLocation[] = [];
  for (const node of [parts.entry, parts.mains[0], parts.result]) {
    const first = node?.sources[0];
    if (first && !sources.some((item) => item.file === first.file && item.startLine === first.startLine)) {
      sources.push(first);
    }
  }
  return sources;
}
