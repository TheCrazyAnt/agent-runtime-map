export type CliLocale = "zh-CN" | "en";

export interface CliText {
  analyzing(project: string): string;
  scanned(files: number): string;
  found(nodes: number, edges: number): string;
  compiled(nodes: number, edges: number): string;
  logicGraph(file: string): string;
  rawGraph(file: string): string;
  viewer(url: string): string;
  unexpected(value: string): string;
  exposed(host: string): string;
  openFailed(url: string): string;
  graphTypeInvalid: string;
  localeInvalid: string;
  stop: string;
  portInvalid: string;
  positiveInteger(option: string): string;
}

const TEXT: Record<CliLocale, CliText> = {
  en: {
    analyzing: (project) => `Analyzing ${project}...`,
    scanned: (files) => `Scanned ${files} files.`,
    found: (nodes, edges) => `Found ${nodes} code nodes and ${edges} relationships.`,
    compiled: (nodes, edges) => `Compiled ${nodes} logic nodes and ${edges} flows.`,
    logicGraph: (file) => `Logic graph: ${file}`,
    rawGraph: (file) => `Raw graph: ${file}`,
    viewer: (url) => `Viewer: ${url}`,
    unexpected: (value) => `unexpected positional argument ${value}`,
    exposed: (host) => `Warning: the viewer is exposed on ${host}; its graph may contain source paths and code structure.`,
    openFailed: (url) => `Could not open a browser automatically. Open ${url} manually.`,
    graphTypeInvalid: "--graph-type must be runtime_logic or product_logic",
    localeInvalid: "--locale must be auto, zh-CN, or en",
    stop: "Press Ctrl+C to stop.",
    portInvalid: "--port must be an integer between 1 and 65535",
    positiveInteger: (option) => `${option} must be a positive integer`,
  },
  "zh-CN": {
    analyzing: (project) => `正在分析 ${project}…`,
    scanned: (files) => `已扫描 ${files} 个代码文件。`,
    found: (nodes, edges) => `发现 ${nodes} 个代码节点和 ${edges} 条关系。`,
    compiled: (nodes, edges) => `已编译为 ${nodes} 个逻辑节点和 ${edges} 条逻辑流。`,
    logicGraph: (file) => `逻辑图：${file}`,
    rawGraph: (file) => `原始代码图：${file}`,
    viewer: (url) => `查看地址：${url}`,
    unexpected: (value) => `存在无法识别的位置参数：${value}`,
    exposed: (host) => `警告：Viewer 已暴露在 ${host}；逻辑图可能包含源码路径和代码结构。`,
    openFailed: (url) => `无法自动打开浏览器，请手动访问 ${url}。`,
    graphTypeInvalid: "--graph-type 必须是 runtime_logic 或 product_logic",
    localeInvalid: "--locale 必须是 auto、zh-CN 或 en",
    stop: "按 Ctrl+C 停止服务。",
    portInvalid: "--port 必须是 1 到 65535 之间的整数",
    positiveInteger: (option) => `${option} 必须是正整数`,
  },
};

export function cliText(locale: CliLocale): CliText {
  return TEXT[locale];
}

export function localeArgument(argv: string[]): string | undefined {
  const inline = argv.find((item) => item.startsWith("--locale="));
  if (inline) return inline.slice("--locale=".length);
  const index = argv.indexOf("--locale");
  return index >= 0 ? argv[index + 1] : undefined;
}

export function isLocaleOption(value: string | undefined): boolean {
  if (value === undefined) return true;
  return ["auto", "zh", "zh-cn", "en", "en-us"].includes(value.toLowerCase());
}

export function resolveCliLocale(requested?: string, environment: NodeJS.ProcessEnv = process.env): CliLocale {
  const explicit = normalizeLocale(requested);
  if (explicit) return explicit;
  const systemLocale = [environment.LC_ALL, environment.LC_MESSAGES, environment.LANG, Intl.DateTimeFormat().resolvedOptions().locale]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return systemLocale.includes("zh") ? "zh-CN" : "en";
}

export function localizedViewerUrl(url: string, requested: string | undefined): string {
  if (!requested || requested.toLowerCase() === "auto") return url;
  const locale = resolveCliLocale(requested);
  const target = new URL(url);
  target.searchParams.set("locale", locale);
  return target.toString();
}

export function helpText(locale: CliLocale, version: string): string {
  if (locale === "zh-CN") {
    return `Agent Runtime Map ${version}

将代码项目转换成一张有源码证据的交互式运行逻辑图。

用法：
  agent-runtime-map [项目] [选项]          分析项目并打开交互式 Viewer
  agent-runtime-map serve [项目] [选项]    分析项目并打开交互式 Viewer
  agent-runtime-map analyze [项目] [选项]  只生成 JSON，不启动 Viewer

兼容命令：logic-map

选项：
  -o, --out <文件>            Logic Graph 输出位置（默认：.logic-map/graph.json）
      --raw-out <文件>        Raw Code Graph 输出位置（默认：.logic-map/raw-graph.json）
      --no-raw                不生成 Raw Code Graph
      --max-files <数量>      最大分析文件数（默认：2000）
      --max-nodes <数量>      最大逻辑节点数（默认：20）
      --graph-type <类型>     runtime_logic 或 product_logic
      --description <说明>    可选的产品背景说明
      --locale <语言>         auto、zh-CN 或 en（默认：自动识别）
  -p, --port <端口>           Viewer 端口（默认：4173；被占用时自动递增）
      --host <主机>           Viewer 主机（默认：127.0.0.1）
      --no-open               不自动打开浏览器
      --debug                 出错时打印调用栈
  -h, --help                  显示帮助
  -v, --version               显示版本
`;
  }
  return `Agent Runtime Map ${version}

Turn your codebase into an evidence-backed logic map.

Usage:
  agent-runtime-map [project] [options]          Analyze and open the interactive viewer
  agent-runtime-map serve [project] [options]    Analyze and open the interactive viewer
  agent-runtime-map analyze [project] [options]  Generate JSON without starting a server

Alias: logic-map

Options:
  -o, --out <file>            Logic Graph output (default: .logic-map/graph.json)
      --raw-out <file>        Raw Code Graph output (default: .logic-map/raw-graph.json)
      --no-raw                Do not write the Raw Code Graph
      --max-files <number>    Maximum source files to analyze (default: 2000)
      --max-nodes <number>    Maximum compiled logic nodes (default: 20)
      --graph-type <type>     runtime_logic or product_logic
      --description <text>    Optional product context for the graph
      --locale <locale>       auto, zh-CN, or en (default: auto)
  -p, --port <number>         Viewer port (default: 4173; increments if busy)
      --host <host>           Viewer host (default: 127.0.0.1)
      --no-open               Do not open the browser automatically
      --debug                 Print stack traces for failures
  -h, --help                  Show help
  -v, --version               Show version
`;
}

function normalizeLocale(value: string | undefined): CliLocale | undefined {
  if (!value || value.toLowerCase() === "auto") return undefined;
  return value.toLowerCase().startsWith("zh") ? "zh-CN" : value.toLowerCase().startsWith("en") ? "en" : undefined;
}
