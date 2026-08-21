import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeTypeScriptProject } from "@agent-runtime-map/typescript";
import { compileLogicGraph } from "@agent-runtime-map/logic-compiler";
import { helpText, localizedViewerUrl, resolveCliLocale } from "../packages/cli/src/i18n.js";
import { localizeGraphTitle, localizeNode, nodeTypeLabel } from "../apps/viewer/src/i18n.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(repositoryRoot, "examples", "simple-agent");

describe("localization", () => {
  it("chooses Chinese for Chinese environments and accepts explicit overrides", () => {
    expect(resolveCliLocale(undefined, { LANG: "zh_CN.UTF-8" })).toBe("zh-CN");
    expect(resolveCliLocale("en", { LANG: "zh_CN.UTF-8" })).toBe("en");
    expect(resolveCliLocale("zh-CN", { LANG: "en_US.UTF-8" })).toBe("zh-CN");
    expect(helpText("zh-CN", "0.1.0")).toContain("交互式运行逻辑图");
    expect(localizedViewerUrl("http://127.0.0.1:4173", "zh-CN")).toBe("http://127.0.0.1:4173/?locale=zh-CN");
  });

  it("localizes generated graph semantics while preserving code-backed metadata", async () => {
    const raw = await analyzeTypeScriptProject(fixture);
    const graph = compileLogicGraph(raw, { maxNodes: 12 });
    const ideas = graph.nodes.find((node) => node.label === "Generate Ideas");

    expect(ideas?.metadata?.rawName).toBe("generateIdeasAgent");
    expect(ideas && localizeNode(ideas, "zh-CN")).toEqual({
      label: "生成灵感",
      description: "AI 工作流执行“生成灵感”。",
    });
    expect(localizeGraphTitle(graph, "zh-CN")).toContain("运行逻辑");
    expect(nodeTypeLabel("ai_process", "zh-CN")).toBe("AI 处理");
    expect(ideas && localizeNode(ideas, "en").label).toBe("Generate Ideas");
  });
});
