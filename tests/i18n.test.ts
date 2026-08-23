import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeTypeScriptProject } from "@agent-runtime-map/typescript";
import { compileLogicGraph } from "@agent-runtime-map/logic-compiler";
import { helpText, localizedViewerUrl, resolveCliLocale } from "../packages/cli/src/i18n.js";
import {
  localizeDiagnostic,
  localizeFeatureLabel,
  localizeGraphTitle,
  localizeNode,
  localizeVariantLabel,
  nodeTypeLabel,
} from "../apps/viewer/src/i18n.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(repositoryRoot, "examples", "simple-agent");

describe("localization", () => {
  it("chooses Chinese for Chinese environments and accepts explicit overrides", () => {
    expect(resolveCliLocale(undefined, { LANG: "zh_CN.UTF-8" })).toBe("zh-CN");
    expect(resolveCliLocale("en", { LANG: "zh_CN.UTF-8" })).toBe("en");
    expect(resolveCliLocale("zh-CN", { LANG: "en_US.UTF-8" })).toBe("zh-CN");
    expect(helpText("zh-CN", "0.1.0")).toContain("Agent 功能电路图");
    expect(localizedViewerUrl("http://127.0.0.1:4173", "zh-CN")).toBe("http://127.0.0.1:4173/?locale=zh-CN");
  });

  it("localizes generated graph semantics while preserving code-backed metadata", async () => {
    const raw = await analyzeTypeScriptProject(fixture);
    const graph = compileLogicGraph(raw, { maxNodes: 40 });
    const ideas = graph.nodes.find((node) => node.label === "Generate Ideas");

    expect(ideas?.metadata?.rawName).toBe("generateIdeasAgent");
    // The node map is what lets a description name other steps the way those steps
    // name themselves, rather than from their English labels.
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    const localized = ideas && localizeNode(ideas, "zh-CN", nodesById);
    expect(localized?.label).toBe("生成灵感");
    // A description that restates its own label costs a line and says nothing, so it
    // says what the step does instead — and names the other steps in Chinese too,
    // rather than pointing a Chinese sentence at English labels.
    expect(localized?.description).toBe("请求“OpenAI API”，结果流向“创建故事”。");
    expect(localized?.description).not.toContain("生成灵感");
    expect(localizeGraphTitle(graph, "zh-CN")).toContain("运行逻辑");
    expect(nodeTypeLabel("ai_process", "zh-CN")).toBe("AI 处理");
    expect(ideas && localizeNode(ideas, "en").label).toBe("Generate Ideas");
    // A referenced step is named exactly as it names itself, everywhere it appears.
    const entry = graph.nodes.find((node) => node.label === "Execute Content");
    const caller = graph.nodes.find((node) => node.behavior?.calls.includes(entry?.id ?? ""));
    expect(localizeNode(caller!, "zh-CN", nodesById).description)
      .toContain(localizeNode(entry!, "zh-CN", nodesById).label);

    const generateFeature = graph.features.find((feature) => feature.label === "POST /api/generate");
    expect(generateFeature && localizeFeatureLabel(generateFeature, graph, "zh-CN")).toBe("生成");
    expect(generateFeature && localizeVariantLabel(generateFeature.variants[0], graph, "zh-CN")).toBe("默认路径");
    const publishFeature = graph.features.find((feature) => feature.label === "POST /api/publish");
    const publishDiagnostic = publishFeature?.diagnostics[0];
    expect(publishDiagnostic && localizeDiagnostic(publishDiagnostic, graph, "zh-CN").message).toContain("没有可解析的下游执行步骤");
  });
});
