import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateLogicMap } from "@agent-runtime-map/core";
import {
  composeFeatureNames,
  localizeEdge,
  localizeNodeSemantics,
  readIdentifier,
  type LocalizationInput,
} from "@agent-runtime-map/logic-compiler";
import { VOCABULARY, tokenizeIdentifier } from "@agent-runtime-map/analysis-kit";
import {
  detectViewerLocale,
  localeUrl,
  rememberViewerLocale,
  resolveFeatureText,
  resolveNodeText,
} from "../apps/viewer/src/i18n.js";
import type { FeatureScenario, LogicEdge, LogicGraph, LogicNode } from "@agent-runtime-map/schema";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The contract these tests hold the localization to: a displayed name is either
 * read from evidence or reported as unread. There is no third option where the
 * tool makes something up, and no state where a Chinese reader is shown an
 * English identifier on the canvas.
 */

function node(id: string, type: LogicNode["type"], rawName: string, extra: Partial<LogicNode> = {}): LogicNode {
  return {
    id, type, label: rawName, description: "",
    sources: [{ file: "src/x.ts", startLine: 1 }],
    confidence: 0.9,
    inference: { method: "deterministic", explanation: "test" },
    rawNodeIds: [`raw_${id}`],
    metadata: { rawName, generatedDescription: true },
    ...extra,
  };
}

const NO_CONTEXT: LocalizationInput = { capabilities: [] };

function semanticsOf(item: LogicNode, input: LocalizationInput = NO_CONTEXT) {
  return localizeNodeSemantics(item, input, new Map([[item.id, item]]));
}

describe("reading an identifier as business language", () => {
  it("reads a fully understood name in both languages", () => {
    const semantic = semanticsOf(node("n1", "ai_process", "createStoryAgent"));
    expect(semantic.label["zh-CN"]).toBe("创建故事");
    expect(semantic.label.en).toBe("Create story");
    expect(semantic.labelSource["zh-CN"]).toBe("identifier");
    expect(semantic.pending).toBe(false);
    expect(semantic.technicalName).toBe("createStoryAgent");
  });

  it("never leaves an English word inside a Chinese name", () => {
    // `ledger` is in the vocabulary; `zorblat` is in no vocabulary anywhere.
    const read = readIdentifier("reconcileZorblatLedger", "zh-CN");
    expect(read.source).toBe("pending");
    expect(read.text).toBe("");
    // The unresolved token is reported rather than dropped or guessed at.
    expect(read.tokens.some((token) => token.token === "zorblat" && token.via === "unresolved")).toBe(true);
  });

  it("marks a name it cannot read as pending, keeping the technical name", () => {
    const semantic = semanticsOf(node("n2", "ai_process", "zorblatFrobnicate"));
    expect(semantic.pending).toBe(true);
    expect(semantic.label["zh-CN"]).toMatch(/^待确认 · /);
    expect(semantic.label.en).toMatch(/^Unconfirmed · /);
    expect(semantic.technicalName).toBe("zorblatFrobnicate");
    expect(semantic.confidence["zh-CN"]).toBeLessThan(1);
    // The description says why, and names the code, rather than inventing meaning.
    expect(semantic.description["zh-CN"]).toContain("zorblatFrobnicate");
  });

  it("does not repeat what the node's own kind already says", () => {
    const agent = semanticsOf(node("n3", "ai_process", "generateIdeasAgent", { metadata: { rawName: "generateIdeasAgent", rawKind: "agent", generatedDescription: true } }));
    expect(agent.label["zh-CN"]).toBe("生成创意");
    expect(agent.label["zh-CN"]).not.toContain("智能体");
  });

  it("keeps a route and a vendor name exactly as written", () => {
    const route = semanticsOf(node("n4", "entrypoint", "POST /api/tickets"));
    expect(route.label["zh-CN"]).toBe("POST /api/tickets");
    expect(route.labelSource["zh-CN"]).toBe("route");

    const model = semanticsOf(node("n5", "model", "gpt-5", { metadata: { rawName: "gpt-5", rawKind: "model" } }));
    // A model id is an address; "Gpt 5" identifies nothing.
    expect(model.label["zh-CN"]).toBe("gpt-5");
    expect(model.label.en).toBe("gpt-5");
    expect(model.labelSource.en).toBe("vendor");
  });

  it("says the same thing in both languages when both can be read", () => {
    // The two languages are allowed to disagree about whether a name is READABLE:
    // English can render an unknown token as a word, Chinese cannot without
    // becoming the mixed state this exists to end. What they must never do is
    // describe two different concepts.
    for (const name of ["approveRefund", "handleTicket", "createStory", "generateIdeas"]) {
      const semantic = semanticsOf(node("n", "process", name));
      expect(semantic.labelSource["zh-CN"]).toBe(semantic.labelSource.en);
      const zhTokens = tokenizeIdentifier(name).length;
      expect(semantic.label.en.split(" ").length).toBeLessThanOrEqual(zhTokens);
    }
  });

  it("lets English read a name Chinese must withhold, without either inventing", () => {
    // `script` is one industry's word, deliberately absent from the shared
    // vocabulary. English still reads it as a word; Chinese declines.
    const semantic = semanticsOf(node("n", "ai_process", "buildScriptAgent"));
    expect(semantic.labelSource.en).toBe("identifier");
    expect(semantic.label.en).toBe("Build script");
    expect(semantic.labelSource["zh-CN"]).toBe("pending");
    expect(semantic.label["zh-CN"]).toMatch(/^待确认 · /);
    // Marked pending overall, so no surface presents it as settled.
    expect(semantic.pending).toBe(true);
    // And the unresolved token is named, so a config line can settle it.
    expect(semantic.glossary?.some((token) => token.token === "script" && token.via === "unresolved")).toBe(true);
  });

  it("produces the same answer twice for the same input", () => {
    const item = node("n6", "process", "createDirectorTask");
    expect(semanticsOf(item)).toEqual(semanticsOf(item));
  });
});

describe("terms a project states for itself", () => {
  const overrides = {
    terms: { zorblat: { "zh-CN": "涡轮", en: "turbine" } },
    nodes: {
      handleTicket: {
        label: { "zh-CN": "受理客户工单", en: "Take in a customer ticket" },
        description: { "zh-CN": "把客户来信登记成一张工单。", en: "Records an inbound message as a ticket." },
      },
    },
  };

  it("lets a configured term resolve a name the vocabulary cannot", () => {
    const withoutConfig = semanticsOf(node("n7", "process", "syncZorblat"));
    expect(withoutConfig.pending).toBe(true);

    const withConfig = semanticsOf(node("n7", "process", "syncZorblat"), { capabilities: [], overrides });
    expect(withConfig.pending).toBe(false);
    expect(withConfig.label["zh-CN"]).toBe("同步涡轮");
    expect(withConfig.label.en).toBe("Sync turbine");
  });

  it("lets a stated name outrank every derivation, and records where it came from", () => {
    const semantic = semanticsOf(node("n8", "process", "handleTicket"), { capabilities: [], overrides });
    expect(semantic.label["zh-CN"]).toBe("受理客户工单");
    expect(semantic.label.en).toBe("Take in a customer ticket");
    expect(semantic.labelSource["zh-CN"]).toBe("config");
    expect(semantic.confidence["zh-CN"]).toBe(1);
    expect(semantic.evidence.some((item) => item.file === "agent-runtime-map.config.json")).toBe(true);
    // The name in code is never lost.
    expect(semantic.technicalName).toBe("handleTicket");
  });
});

describe("edge wording", () => {
  it("says what kind of connection each edge is, in both languages", () => {
    const controls = ["conditional", "retry", "loop", "human_approval", "fallback", "parallel"] as const;
    const said = controls.map((control) => {
      const edge: LogicEdge = { id: `e_${control}`, source: "a", target: "b", type: "flow", control, confidence: 1, rawEdgeIds: ["r"] };
      return localizeEdge(edge, new Map());
    });
    expect(said.map((item) => item["zh-CN"])).toEqual([
      "条件分支", "失败重试", "循环执行", "等待人工确认", "降级备选", "并行执行",
    ]);
    // Each kind is distinguishable in English too, and none is left in Chinese.
    expect(new Set(said.map((item) => item.en)).size).toBe(controls.length);
    for (const item of said) expect(item.en).not.toMatch(/[一-鿿]/);
  });
});

describe("feature names", () => {
  it("are unique, and describe the work rather than the address", () => {
    const nodes = [
      node("entry_a", "entrypoint", "POST /api/x"),
      node("entry_b", "entrypoint", "POST /api/y"),
      node("work_a", "ai_process", "generateStory"),
      node("work_b", "ai_process", "generateStory"),
      node("out_a", "result", "saveDraft"),
      node("out_b", "result", "publishDraft"),
    ];
    const byId = new Map(nodes.map((item) => [item.id, item]));
    for (const item of nodes) item.semantic = localizeNodeSemantics(item, NO_CONTEXT, byId);

    const feature = (id: string, entry: string, work: string, out: string): FeatureScenario => ({
      id, label: entry, description: "",
      entryNodeIds: [entry], resultNodeIds: [out], nodeIds: [entry, work, out], edgeIds: [],
      variants: [{ id: `${id}_v`, label: "main", description: "", nodeIds: [entry, work, out], edgeIds: [], steps: [], resultNodeId: out, confidence: 1 }],
      diagnostics: [], health: "healthy", confidence: 1,
    });
    const features = [feature("f_a", "entry_a", "work_a", "out_a"), feature("f_b", "entry_b", "work_b", "out_b")];
    composeFeatureNames(features, byId);

    for (const locale of ["zh-CN", "en"] as const) {
      const names = features.map((item) => item.semantic!.label[locale]);
      // Both features do "generate story"; the names must still tell them apart.
      expect(new Set(names).size).toBe(names.length);
      for (const name of names) expect(name).not.toMatch(/^POST /);
    }
    expect(features[0]!.semantic!.label["zh-CN"]).toContain("生成故事");
    // The one-sentence summary names entry, work, and result.
    expect(features[0]!.semantic!.description["zh-CN"]).toContain("最终产出");
    // The id-bearing label is untouched, so saved layouts keep working.
    expect(features[0]!.label).toBe("entry_a");
  });
});

describe("the Viewer as a selector", () => {
  it("reads the compiled semantics rather than deriving anything", () => {
    const item = node("n9", "ai_process", "createStoryAgent");
    item.semantic = semanticsOf(item);
    expect(resolveNodeText(item, "zh-CN").label).toBe("创建故事");
    expect(resolveNodeText(item, "en").label).toBe("Create story");
    expect(resolveNodeText(item, "zh-CN").technicalName).toBe("createStoryAgent");
  });

  it("still renders a graph compiled before semantics existed", () => {
    // Exactly the shape an older graph.json has: no `semantic` anywhere.
    const legacy = node("n10", "ai_process", "generateIdeas");
    delete legacy.semantic;
    const text = resolveNodeText(legacy, "zh-CN", new Map([[legacy.id, legacy]]));
    expect(text.label.length).toBeGreaterThan(0);
    expect(text.pending).toBe(false);
    expect(text.technicalName).toBe("generateIdeas");

    const legacyFeature: FeatureScenario = {
      id: "f", label: "Generate", description: "old", entryNodeIds: [], resultNodeIds: [],
      nodeIds: [], edgeIds: [], variants: [], diagnostics: [], health: "healthy", confidence: 1,
    };
    const graph = { nodes: [legacy], edges: [], features: [legacyFeature] } as unknown as LogicGraph;
    expect(resolveFeatureText(legacyFeature, graph, "zh-CN").label.length).toBeGreaterThan(0);
  });
});

describe("uncertainty is reported per language", () => {
  /**
   * A reader is told their own view is unreliable only when it actually is.
   * English reading `kbSearchTool` as "Kb search" is a complete answer, and
   * marking it Unconfirmed because Chinese could not resolve `kb` would make the
   * one honest signal on the map cry wolf.
   */
  function withSources(zh: string, en: string): LogicNode {
    const item = node("n_pending", "tool", "kbSearchTool");
    item.semantic = {
      label: { "zh-CN": zh === "pending" ? "待确认 · 工具" : "知识库搜索", en: en === "pending" ? "Unconfirmed · tool" : "Kb search" },
      description: { "zh-CN": "描述", en: "description" },
      technicalName: "kbSearchTool",
      labelSource: { "zh-CN": zh as never, en: en as never },
      confidence: { "zh-CN": zh === "pending" ? 0.5 : 1, en: en === "pending" ? 0.5 : 1 },
      // The flat flag stays true whenever EITHER language failed; the per-locale
      // answer must not be taken from it.
      pending: zh === "pending" || en === "pending",
      evidence: [],
    };
    return item;
  }

  it("marks Chinese pending while English reads the name", () => {
    const item = withSources("pending", "identifier");
    expect(resolveNodeText(item, "zh-CN").pending).toBe(true);
    expect(resolveNodeText(item, "zh-CN").label).toMatch(/^待确认 · /);
    expect(resolveNodeText(item, "en").pending).toBe(false);
    expect(resolveNodeText(item, "en").label).toBe("Kb search");
  });

  it("marks English pending while Chinese reads the name", () => {
    const item = withSources("identifier", "pending");
    expect(resolveNodeText(item, "en").pending).toBe(true);
    expect(resolveNodeText(item, "zh-CN").pending).toBe(false);
    expect(resolveNodeText(item, "zh-CN").label).toBe("知识库搜索");
  });

  it("marks neither when both languages read the name", () => {
    const item = withSources("identifier", "identifier");
    expect(resolveNodeText(item, "zh-CN").pending).toBe(false);
    expect(resolveNodeText(item, "en").pending).toBe(false);
  });

  it("falls back to the flat flag for a graph compiled before labelSource existed", () => {
    const item = node("n_old", "tool", "kbSearchTool");
    // Exactly the shape an older artifact has: a summary flag, no per-locale source.
    item.semantic = {
      label: { "zh-CN": "待确认", en: "Unconfirmed" },
      description: { "zh-CN": "描述", en: "description" },
      technicalName: "kbSearchTool",
      confidence: { "zh-CN": 0.4, en: 0.4 },
      pending: true,
      evidence: [],
    } as unknown as NonNullable<LogicNode["semantic"]>;
    expect(resolveNodeText(item, "zh-CN").pending).toBe(true);
    expect(resolveNodeText(item, "en").pending).toBe(true);
    expect(resolveNodeText(item, "zh-CN").label).toBe("待确认");
  });

  it("reports a feature's uncertainty per language too", () => {
    const feature: FeatureScenario = {
      id: "f_p", label: "raw", description: "", entryNodeIds: [], resultNodeIds: [],
      nodeIds: [], edgeIds: [], variants: [], diagnostics: [], health: "healthy", confidence: 1,
      semantic: {
        label: { "zh-CN": "待确认 · 工具", en: "Kb search" },
        description: { "zh-CN": "描述", en: "description" },
        technicalName: "raw",
        labelSource: { "zh-CN": "pending", en: "composed" },
        confidence: { "zh-CN": 0.4, en: 1 },
        pending: true,
        evidence: [],
      },
    };
    const graph = { nodes: [], edges: [], features: [feature] } as unknown as LogicGraph;
    expect(resolveFeatureText(feature, graph, "zh-CN").pending).toBe(true);
    expect(resolveFeatureText(feature, graph, "en").pending).toBe(false);
  });

  it("reports the real project the same way, per language", { timeout: 120_000 }, async () => {
    const result = await generateLogicMap(path.join(REPO, "examples/simple-agent"), { outputFile: false, rawOutputFile: false });
    for (const item of result.graph.nodes) {
      for (const locale of ["zh-CN", "en"] as const) {
        const text = resolveNodeText(item, locale);
        // The badge and the label must agree: a step shown as 待确认 is pending,
        // and one shown with a real name is not.
        expect(text.pending).toBe(/^(待确认|Unconfirmed) · /.test(text.label));
      }
    }
  });
});

describe("choosing a language", () => {
  it("prefers an explicit choice, then a remembered one, then the system", () => {
    expect(detectViewerLocale({ search: "?locale=en", stored: "zh-CN", languages: ["zh-CN"] })).toBe("en");
    expect(detectViewerLocale({ search: "", stored: "zh-CN", languages: ["en-US"] })).toBe("zh-CN");
    expect(detectViewerLocale({ search: "", stored: null, languages: ["zh-TW", "en"] })).toBe("zh-CN");
    expect(detectViewerLocale({ search: "", stored: null, languages: ["en-GB"] })).toBe("en");
    expect(detectViewerLocale({ search: "", stored: null, languages: [] })).toBe("en");
  });

  it("remembers a choice, and survives storage that refuses to store", () => {
    const written: Record<string, string> = {};
    rememberViewerLocale("zh-CN", { setItem: (key, value) => { written[key] = value; } });
    expect(Object.values(written)).toEqual(["zh-CN"]);
    expect(detectViewerLocale({ search: "", stored: Object.values(written)[0]!, languages: ["en"] })).toBe("zh-CN");
    // Private browsing throws on write; a language preference is not worth a crash.
    expect(() => rememberViewerLocale("en", { setItem: () => { throw new Error("denied"); } })).not.toThrow();
  });

  it("carries the choice in a shared link", () => {
    expect(localeUrl("http://x/report?a=1", "zh-CN")).toBe("http://x/report?a=1&locale=zh-CN");
    // A stale locale from someone else's link is replaced, not appended twice.
    expect(localeUrl("http://x/?locale=en", "zh-CN")).toBe("http://x/?locale=zh-CN");
  });
});

describe("the vocabulary itself", () => {
  it("holds generic software and business words, not one project's jargon", () => {
    for (const [token, term] of Object.entries(VOCABULARY)) {
      expect(token).toBe(token.toLowerCase());
      expect(term.zhCN.length).toBeGreaterThan(0);
      // A Chinese reading must not smuggle Latin letters back in.
      expect(term.zhCN).not.toMatch(/[a-zA-Z]{2,}/);
    }
    // Words that belong to one product, not to software in general, stay out —
    // that is what the config `terms` block is for.
    for (const jargon of ["zorblat", "acmecorp", "widgetron"]) {
      expect(VOCABULARY[jargon]).toBeUndefined();
    }
  });
});

describe("a real project, end to end", () => {
  // Compiling the example is the expensive part; both tests read the same run.
  const SAMPLE = path.join(REPO, "examples/simple-agent");
  let localized: Promise<Awaited<ReturnType<typeof generateLogicMap>>> | undefined;
  const analyze = () => (localized ??= generateLogicMap(SAMPLE, { outputFile: false, rawOutputFile: false }));

  it("names every step in both languages, and leaves no English on a Chinese canvas", { timeout: 120_000 }, async () => {
    const result = await analyze();
    const nodes = result.graph.nodes;
    expect(nodes.length).toBeGreaterThan(10);

    for (const item of nodes) {
      const semantic = item.semantic;
      expect(semantic).toBeDefined();
      for (const locale of ["zh-CN", "en"] as const) {
        expect(semantic!.label[locale].length).toBeGreaterThan(0);
        expect(semantic!.description[locale].length).toBeGreaterThan(0);
      }
      // Every name is either read from evidence or declared unread.
      if (semantic!.labelSource["zh-CN"] === "pending") {
        expect(semantic!.label["zh-CN"]).toMatch(/^待确认 · /);
      } else if (!["route", "vendor"].includes(semantic!.labelSource["zh-CN"])) {
        // A derived Chinese name carries no English run at all.
        expect(semantic!.label["zh-CN"]).not.toMatch(/[a-zA-Z]{3,}/);
      }
      // English never falls back to a raw camelCase identifier.
      if (!["route", "vendor"].includes(semantic!.labelSource.en)) {
        expect(semantic!.label.en).not.toMatch(/[a-z][A-Z]|_/);
      }
    }

    // Feature names are distinguishable in both languages.
    for (const locale of ["zh-CN", "en"] as const) {
      const names = result.graph.features.map((feature) => feature.semantic!.label[locale]);
      expect(new Set(names).size).toBe(names.length);
    }
    // Every edge says what kind of connection it is.
    for (const edge of result.graph.edges) expect(edge.semantic?.label["zh-CN"].length).toBeGreaterThan(0);
  });

  it("changes nothing but adds semantics when localization is off", { timeout: 120_000 }, async () => {
    const withSemantics = await analyze();
    const without = await generateLogicMap(SAMPLE, { outputFile: false, rawOutputFile: false, localize: false });

    const strip = (graph: LogicGraph) => JSON.parse(JSON.stringify({
      ...graph,
      generatedAt: "",
      nodes: graph.nodes.map(({ semantic, ...rest }) => rest),
      edges: graph.edges.map(({ semantic, ...rest }) => rest),
      features: graph.features.map(({ semantic, ...rest }) => rest),
    }));
    // Topology, sources, evidence, and confidence are untouched by naming.
    expect(strip(withSemantics.graph)).toEqual(strip(without.graph));
    expect(without.graph.nodes.every((item) => item.semantic === undefined)).toBe(true);
  });
});
