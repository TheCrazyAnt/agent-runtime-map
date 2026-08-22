import type {
  ChainDiagnostic,
  ChainHealth,
  FeaturePathVariant,
  FeatureScenario,
  LogicGraph,
  LogicNode,
  ProductEvidence,
  ProductEvidenceOrigin,
  LogicNodeType,
} from "@agent-runtime-map/schema";

import { DEFAULT_BLUEPRINT_GROUP_LABELS, type BlueprintGroupLabels } from "@agent-runtime-map/react";

export type UiLocale = "zh-CN" | "en";

const STORAGE_KEY = "agent-runtime-map.locale";

const EN = {
  runtimeLogic: "Runtime logic",
  productLogic: "Product logic",
  generated: "Generated",
  projectMap: "PROJECT MAP",
  logicNodes: "logic nodes",
  flows: "flows",
  files: "files",
  search: "Find logic or source…",
  clearSearch: "Clear search",
  nodeTypes: "NODE TYPES",
  staticAnalysis: "Evidence-backed static analysis",
  logicGraph: "Logic graph",
  selectedLogic: "SELECTED LOGIC",
  closeEvidence: "Close evidence",
  confidence: "Confidence",
  sourceEvidence: "SOURCE EVIDENCE",
  selectedCode: "SELECTED CODE",
  detailTerminal: "Deepest level shown. Use the breadcrumb to step back.",
  expandDetail: "Expand",
  collapseDetail: "Collapse",
  productContext: "PRODUCT CONTEXT",
  productMatch: "Match",
  productCodeOnly: "Read from code only. Nothing the project writes about itself was matched to this step.",
  productMatchedOn: "Matched on",
  lines: "Lines",
  rawReferences: "Raw references",
  loadingTitle: "Compiling the view",
  loadingDescription: "Loading the evidence-backed logic graph…",
  errorTitle: "Graph unavailable",
  errorHint: "Run agent-runtime-map analyze . and restart the viewer.",
  loadError: "Could not load graph.json",
  switchLanguage: "切换到中文",
  featureCircuits: "FEATURE CIRCUITS",
  featureHint: "Choose a feature to simulate its code-backed route on the full Agent graph.",
  wholeSystem: "Whole system",
  features: "features",
  healthy: "Healthy",
  warning: "Needs review",
  chainError: "Chain error",
  choosePath: "EXECUTION PATH",
  chainCheck: "CHAIN CHECK",
  play: "Play",
  pause: "Pause",
  nextStep: "Next step",
  replay: "Replay",
  speed: "Speed",
  ready: "Ready to inspect",
  running: "Checking chain",
  completed: "Chain verified",
  stopped: "Stopped at error",
  step: "Step",
  diagnostics: "DIAGNOSTICS",
  noDiagnostics: "No deterministic chain problems found.",
  recommendation: "Suggested fix",
  selectFeature: "Select a feature to inspect its execution route.",
  globalView: "All nodes and dependencies",
  zoomLevel: "VIEW LEVEL",
  semanticZoomHint: "Scroll to move between overview, logic, and source evidence.",
  expandDetails: "Expand code details",
  collapseDetails: "Collapse code details",
  detailHint: "Double-click a logic node to inspect its code-backed internals.",
  cameraFollow: "Follow execution",
  cameraFollowing: "Following",
  resumeFollow: "Resume follow",
  layout: "LAYOUT",
  undoLayout: "Undo move",
  resetLayout: "Reset layout",
  pinnedNodes: "pinned",
  sourceCode: "SOURCE CODE",
  sourceUnavailable: "Source preview is unavailable for this map.",
  loadingSource: "Loading source…",
  openSource: "Open source",
  searchResults: "SEARCH RESULTS",
  noSearchResults: "No matching logic or source found.",
  result: "result",
} as const;

const ZH: Record<keyof typeof EN, string> = {
  runtimeLogic: "运行逻辑",
  productLogic: "产品逻辑",
  generated: "生成于",
  projectMap: "项目逻辑图",
  logicNodes: "逻辑节点",
  flows: "逻辑流",
  files: "代码文件",
  search: "搜索逻辑或源文件…",
  clearSearch: "清除搜索",
  nodeTypes: "节点类型",
  staticAnalysis: "基于代码证据的静态分析",
  logicGraph: "逻辑图",
  selectedLogic: "当前逻辑节点",
  closeEvidence: "关闭证据面板",
  confidence: "置信度",
  sourceEvidence: "源码证据",
  selectedCode: "选中的代码",
  detailTerminal: "已到最深一层，可用面包屑返回。",
  expandDetail: "展开",
  collapseDetail: "收起",
  productContext: "产品语境",
  productMatch: "匹配度",
  productCodeOnly: "仅来自代码。项目自述中没有内容与这一步匹配。",
  productMatchedOn: "匹配依据",
  lines: "代码行",
  rawReferences: "原始节点引用",
  loadingTitle: "正在编译逻辑图",
  loadingDescription: "正在加载基于代码证据的逻辑图…",
  errorTitle: "无法加载逻辑图",
  errorHint: "请运行 agent-runtime-map analyze . 后重新启动 Viewer。",
  loadError: "无法加载 graph.json",
  switchLanguage: "Switch to English",
  featureCircuits: "功能电路",
  featureHint: "选择一个功能，在完整 Agent 图上模拟它的代码执行路线。",
  wholeSystem: "全局系统",
  features: "个功能",
  healthy: "链路正常",
  warning: "需要确认",
  chainError: "链路错误",
  choosePath: "执行路径",
  chainCheck: "链路检查",
  play: "播放",
  pause: "暂停",
  nextStep: "下一步",
  replay: "重新检查",
  speed: "速度",
  ready: "等待检查",
  running: "正在检查链路",
  completed: "链路检查通过",
  stopped: "已在错误处停止",
  step: "步骤",
  diagnostics: "诊断结果",
  noDiagnostics: "未发现确定性的链路问题。",
  recommendation: "修复建议",
  selectFeature: "请选择一个功能，检查它的执行路线。",
  globalView: "显示全部节点与依赖",
  zoomLevel: "查看层级",
  semanticZoomHint: "滚轮缩放可切换全局、逻辑与源码证据。",
  expandDetails: "展开代码细节",
  collapseDetails: "收起代码细节",
  detailHint: "双击逻辑节点，查看有源码证据支撑的内部调用。",
  cameraFollow: "跟随执行",
  cameraFollowing: "正在跟随",
  resumeFollow: "继续跟随",
  layout: "布局",
  undoLayout: "撤销移动",
  resetLayout: "重置布局",
  pinnedNodes: "已固定",
  sourceCode: "源代码",
  sourceUnavailable: "此逻辑图暂时无法读取源码预览。",
  loadingSource: "正在读取源码…",
  openSource: "打开源码",
  searchResults: "搜索结果",
  noSearchResults: "未找到匹配的逻辑或源码。",
  result: "条结果",
};

const TYPE_LABELS: Record<UiLocale, Record<LogicNodeType, string>> = {
  en: {
    user_action: "USER ACTION",
    entrypoint: "ENTRYPOINT",
    process: "PROCESS",
    workflow: "WORKFLOW",
    ai_process: "AI PROCESS",
    tool: "TOOL",
    model: "MODEL",
    human_gate: "HUMAN GATE",
    decision: "DECISION",
    data: "DATA",
    external_system: "EXTERNAL",
    result: "RESULT",
  },
  "zh-CN": {
    user_action: "用户操作",
    entrypoint: "系统入口",
    process: "处理过程",
    workflow: "工作流",
    ai_process: "AI 处理",
    tool: "工具",
    model: "模型",
    human_gate: "人工审批",
    decision: "逻辑判断",
    data: "数据",
    external_system: "外部系统",
    result: "运行结果",
  },
};

const ZH_WORDS: Record<string, string> = {
  agent: "智能体",
  approve: "批准",
  apply: "应用",
  analyze: "分析",
  billing: "计费",
  build: "构建",
  canonical: "标准",
  compile: "编译",
  content: "内容",
  create: "创建",
  data: "数据",
  decision: "决策",
  document: "文档",
  draft: "草稿",
  enqueue: "加入队列",
  execute: "执行",
  final: "最终",
  fast: "快速",
  generate: "生成",
  generation: "生成",
  handle: "处理",
  idea: "灵感",
  ideas: "灵感",
  import: "导入",
  index: "建立索引",
  knowledge: "知识",
  lock: "锁定",
  logic: "逻辑",
  map: "图",
  model: "模型",
  order: "订单",
  parse: "解析",
  plan: "计划",
  process: "处理",
  publish: "发布",
  publishing: "发布",
  quality: "高质量",
  production: "生产",
  prompt: "提示词",
  prompts: "提示词",
  protected: "受保护",
  provider: "供应商",
  record: "记录",
  refund: "退款",
  request: "请求",
  result: "结果",
  revise: "修改",
  review: "审核",
  run: "运行",
  save: "保存",
  scene: "场景",
  score: "评分",
  script: "脚本",
  service: "服务",
  specs: "规格",
  story: "故事",
  submission: "提交",
  submit: "提交",
  sync: "同步",
  tool: "工具",
  version: "版本",
  video: "视频",
  workflow: "工作流",
};

export function detectViewerLocale(): UiLocale {
  if (typeof window !== "undefined") {
    const requested = new URLSearchParams(window.location.search).get("locale");
    const fromQuery = normalizeLocale(requested);
    if (fromQuery) return fromQuery;
    const saved = normalizeLocale(window.localStorage.getItem(STORAGE_KEY));
    if (saved) return saved;
  }
  const languages = typeof navigator === "undefined" ? [] : navigator.languages;
  return languages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh-CN" : "en";
}

export function rememberViewerLocale(locale: UiLocale): void {
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, locale);
}

export function messages(locale: UiLocale): typeof EN {
  return (locale === "zh-CN" ? ZH : EN) as typeof EN;
}

export function nodeTypeLabel(type: LogicNodeType, locale: UiLocale): string {
  return TYPE_LABELS[locale][type];
}

export function sourceCountText(count: number, locale: UiLocale): string {
  if (locale === "zh-CN") return `${count} 处源码证据`;
  return `${count} source${count === 1 ? "" : "s"}`;
}

export function localizeGraphTitle(graph: LogicGraph, locale: UiLocale): string {
  if (locale === "en") return graph.title;
  return `${graph.project.name} ${graph.graphType === "runtime_logic" ? "运行逻辑" : "产品逻辑"}`;
}

export function localizeGraphDescription(graph: LogicGraph, locale: UiLocale): string {
  if (locale === "en") return graph.description;
  if (graph.description === "A static, evidence-backed view of how work flows through the codebase.") {
    return "基于静态代码证据，展示任务如何在项目中流转。";
  }
  if (graph.description === "A code-informed view of how user actions become product value.") {
    return "基于代码结构，展示用户操作如何形成最终产品价值。";
  }
  return graph.description;
}

export function localizeNode(node: LogicNode, locale: UiLocale): { label: string; description: string } {
  if (locale === "en") return { label: node.label, description: node.description };
  const rawName = typeof node.metadata?.rawName === "string" ? node.metadata.rawName : node.label;
  const rawKind = node.metadata?.rawKind;
  const label = rawKind === "route" || rawKind === "external_api" ? node.label : translateSemanticName(rawName) ?? node.label;
  const generated = node.metadata?.generatedDescription === true;
  if (!generated) return { label, description: node.description };
  const descriptions: Record<LogicNodeType, string> = {
    user_action: `用户发起“${label}”。`,
    entrypoint: `系统通过 ${label} 接收任务。`,
    process: `系统执行“${label}”。`,
    workflow: `工作流编排“${label}”。`,
    ai_process: `AI 工作流执行“${label}”。`,
    tool: `智能体调用工具“${label}”。`,
    model: `智能体使用模型 ${label}。`,
    human_gate: `人工审核或批准“${label}”。`,
    decision: `系统判断“${label}”。`,
    data: `系统读取或更新“${label}”。`,
    external_system: `系统与 ${label} 通信。`,
    result: `流程产出“${label}”。`,
  };
  return { label, description: descriptions[node.type] };
}

/**
 * Boundary titles for the shared visual package, which is locale-neutral by design
 * so an embedder can label the frames in its own product language.
 */
export function groupLabels(locale: UiLocale): BlueprintGroupLabels {
  if (locale === "en") return DEFAULT_BLUEPRINT_GROUP_LABELS;
  return {
    runtime: "智能体运行时",
    workflows: "AGENT 工作流",
    systems: "数据与外部服务",
    nodeCount: (count) => `${count} 个节点`,
  };
}

export function inferenceMethodLabel(method: LogicNode["inference"]["method"], locale: UiLocale): string {
  if (locale === "en") return method;
  return { deterministic: "确定性分析", heuristic: "启发式分析", llm: "LLM 语义分析", mixed: "混合分析" }[method];
}

/**
 * What linked this step to the documented capability. The documented terms stay
 * verbatim, because they are the evidence; only the sentence around them is
 * translated.
 */
export function productMatchText(product: ProductEvidence, locale: UiLocale): string {
  const terms = product.matchedTerms.map((term) => `“${term}”`).join("、");
  const quoted = product.matchedTerms.map((term) => `"${term}"`).join(", ");
  if (locale === "en") {
    return {
      documented_name: `the documented name ${quoted}`,
      documented_terms: `the documented terms ${quoted}`,
      entry_terms: `terms shared with this feature's entry point${quoted ? `: ${quoted}` : ""}`,
      step_terms: `terms shared with steps in this feature${quoted ? `: ${quoted}` : ""}`,
    }[product.matchedOn];
  }
  return {
    documented_name: `文档中的名称 ${terms}`,
    documented_terms: `文档中的术语 ${terms}`,
    entry_terms: `与该功能入口共有的术语${terms ? `：${terms}` : ""}`,
    step_terms: `与该功能步骤共有的术语${terms ? `：${terms}` : ""}`,
  }[product.matchedOn];
}

/**
 * Where a product claim came from, in words rather than a code. A reader weighing a
 * borrowed name needs to know whether the project's own specification said it or
 * whether they said it themselves a minute ago on the command line.
 */
export function productOriginLabel(origin: ProductEvidenceOrigin, locale: UiLocale): string {
  const english: Record<ProductEvidenceOrigin, string> = {
    readme: "From the README",
    prd: "From the product spec",
    docs: "From project documentation",
    prompt: "From an Agent prompt",
    config: "From the project config",
    user: "Provided by you",
  };
  if (locale === "en") return english[origin];
  return {
    readme: "来自 README",
    prd: "来自产品文档",
    docs: "来自项目文档",
    prompt: "来自 Agent 提示词",
    config: "来自项目配置",
    user: "由你提供",
  }[origin];
}

export function chainHealthLabel(health: ChainHealth, locale: UiLocale): string {
  const text = messages(locale);
  return health === "healthy" ? text.healthy : health === "warning" ? text.warning : text.chainError;
}

export function localizeFeatureLabel(feature: FeatureScenario, graph: LogicGraph, locale: UiLocale): string {
  if (locale === "en") return feature.label;
  const routeMatch = feature.label.match(/^(?:GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i);
  if (routeMatch) {
    const lastSegment = routeMatch[1].split("/").filter(Boolean).at(-1);
    const translated = lastSegment && translateSemanticName(lastSegment);
    if (translated) return translated;
  }
  const matchingNode = graph.nodes.find((node) => node.label === feature.label);
  if (matchingNode) return localizeNode(matchingNode, locale).label;
  return translateSemanticName(feature.label) ?? feature.label;
}

export function localizeVariantLabel(variant: FeaturePathVariant, graph: LogicGraph, locale: UiLocale): string {
  if (locale === "en") return variant.label;
  if (variant.label === "All paths") return "全部路径";
  if (variant.label === "Default path") return "默认路径";
  const pathMatch = variant.label.match(/^Path (\d+)(?: · (.+))?$/);
  if (!pathMatch) return variant.label;
  const resultNode = graph.nodes.find((node) => node.label === pathMatch[2]);
  const resultLabel = resultNode ? localizeNode(resultNode, locale).label : pathMatch[2];
  return `路径 ${pathMatch[1]}${resultLabel ? ` · ${resultLabel}` : ""}`;
}

export function localizeDiagnostic(
  diagnostic: ChainDiagnostic,
  graph: LogicGraph,
  locale: UiLocale,
): { message: string; suggestion: string } {
  if (locale === "en") return { message: diagnostic.message, suggestion: diagnostic.suggestion };
  const node = diagnostic.nodeId ? graph.nodes.find((candidate) => candidate.id === diagnostic.nodeId) : undefined;
  const nodeLabel = node ? localizeNode(node, locale).label : "当前步骤";
  const localized: Record<ChainDiagnostic["code"], { message: string; suggestion: string }> = {
    CHAIN_BROKEN_REFERENCE: {
      message: `${nodeLabel} 引用了逻辑图中不存在的节点。`,
      suggestion: "检查此处无法解析的调用、导入关系或生成的连线。",
    },
    CHAIN_CYCLE: {
      message: `${nodeLabel} 所在链路形成循环，无法确认是否能正常退出。`,
      suggestion: "检查循环退出条件，或增加一个明确的结束路径。",
    },
    CHAIN_LOW_CONFIDENCE: {
      message: `${nodeLabel} 的识别置信度为 ${Math.round(diagnostic.confidence * 100)}%。`,
      suggestion: "确认调用关系，或使用更清晰的 workflow、agent、tool、service 命名。",
    },
    CHAIN_NO_DOWNSTREAM: {
      message: `${nodeLabel} 没有可解析的下游执行步骤。`,
      suggestion: "检查入口是否调用了工作流、Agent、服务或工具。",
    },
    CHAIN_NO_RESULT: {
      message: "分析器没有找到这个功能的结束结果。",
      suggestion: "补充或暴露 return、持久化、响应或交接节点。",
    },
    CHAIN_PATH_LIMIT: {
      message: "功能链路超过当前可模拟的节点、分支或深度上限。",
      suggestion: "增强逻辑压缩，或把功能拆分成明确的工作流。",
    },
    CHAIN_EXTERNAL_NO_FALLBACK: {
      message: `${nodeLabel} 调用了外部系统，但没有识别到 fallback。`,
      suggestion: "为外部调用增加异常处理、重试上限或降级路径。",
    },
    CHAIN_RETRY_WITHOUT_LIMIT: {
      message: `${nodeLabel} 包含重试链路，但没有识别到明确上限。`,
      suggestion: "配置最大重试次数、退避策略和失败出口。",
    },
    CHAIN_AGENT_NO_OUTPUT: {
      message: `${nodeLabel} 没有可识别的结构化输出或下游交接。`,
      suggestion: "声明返回类型、输出 Schema、持久化或下一个工作流步骤。",
    },
  };
  return localized[diagnostic.code];
}

function normalizeLocale(value: string | null): UiLocale | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  return undefined;
}

function translateSemanticName(value: string): string | undefined {
  const tokens = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token && !["agent", "controller", "handler", "service"].includes(token));
  if (!tokens.length || tokens.some((token) => !ZH_WORDS[token])) return undefined;
  return tokens.map((token) => ZH_WORDS[token]).join("");
}
