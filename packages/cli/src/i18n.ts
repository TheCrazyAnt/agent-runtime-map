export type CliLocale = "zh-CN" | "en";

export interface CliText {
  analyzing(project: string): string;
  scanned(files: number): string;
  contextSummary(documents: number, prompts: number, capabilities: number): string;
  found(nodes: number, edges: number): string;
  compiled(nodes: number, edges: number): string;
  featureSummary(features: number, errors: number, warnings: number): string;
  logicGraph(file: string): string;
  rawGraph(file: string): string;
  viewer(url: string): string;
  unexpected(value: string): string;
  exposed(host: string): string;
  openFailed(url: string): string;
  graphTypeInvalid: string;
  localeInvalid: string;
  semanticProviderInvalid: string;
  semanticModelRequired: string;
  semanticApiKeyMissing: string;
  stop: string;
  portInvalid: string;
  positiveInteger(option: string): string;
  initCreated(file: string): string;
  initCompleted(file: string, keys: string): string;
  initUnchanged(file: string): string;
  initScripts(scripts: string): string;
  initIgnored(rule: string, file: string): string;
  configWarning(warning: string): string;
  buildUpdated(dir: string, buildId: string, ms: number): string;
  buildUnchanged(buildId: string): string;
  buildFailed(reason: string): string;
  changesSummary(added: number, removed: number, modified: number, features: number): string;
  watchStarted(dir: string): string;
  watchChanges(count: number): string;
  reportHint(file: string): string;
  githubWorkflowCreated(file: string): string;
  githubWorkflowUpdated(file: string): string;
  githubWorkflowOverwritten(file: string): string;
  githubWorkflowUnchanged(file: string): string;
  githubWorkflowModified(file: string): string;
  githubNextSteps: string;
  forceRequiresGithub: string;
}

const TEXT: Record<CliLocale, CliText> = {
  en: {
    analyzing: (project) => `Analyzing ${project}...`,
    scanned: (files) => `Scanned ${files} files.`,
    contextSummary: (documents, prompts, capabilities) => `Read ${documents} project documents, ${prompts} prompt files, and ${capabilities} documented capability hints.`,
    found: (nodes, edges) => `Found ${nodes} code nodes and ${edges} relationships.`,
    compiled: (nodes, edges) => `Compiled ${nodes} logic nodes and ${edges} flows.`,
    featureSummary: (features, errors, warnings) => `Detected ${features} feature circuits (${errors} errors, ${warnings} warnings).`,
    logicGraph: (file) => `Logic graph: ${file}`,
    rawGraph: (file) => `Raw graph: ${file}`,
    viewer: (url) => `Viewer: ${url}`,
    unexpected: (value) => `unexpected positional argument ${value}`,
    exposed: (host) => `Warning: the viewer is exposed on ${host}; its graph may contain source paths and code structure.`,
    openFailed: (url) => `Could not open a browser automatically. Open ${url} manually.`,
    graphTypeInvalid: "--graph-type must be runtime_logic or product_logic",
    localeInvalid: "--locale must be auto, zh-CN, or en",
    semanticProviderInvalid: "--semantic currently supports openai only",
    semanticModelRequired: "--semantic-model is required when --semantic openai is enabled",
    semanticApiKeyMissing: "OPENAI_API_KEY is required when --semantic openai is enabled",
    stop: "Press Ctrl+C to stop.",
    portInvalid: "--port must be an integer between 1 and 65535",
    positiveInteger: (option) => `${option} must be a positive integer`,
    initCreated: (file) => `Created ${file}.`,
    initCompleted: (file, keys) => `Completed ${file} (added: ${keys}).`,
    initUnchanged: (file) => `${file} already has every continuous-map setting; nothing changed.`,
    initIgnored: (rule: string, file: string) => `Added ${rule} to ${file}, so the generated map stays out of version control.`,
    initScripts: (scripts) => `Suggested package.json scripts (add them yourself if you want them):\n${scripts}`,
    configWarning: (warning) => `Warning: ${warning}`,
    buildUpdated: (dir, buildId, ms) => `Map updated in ${dir} (build ${buildId}, ${ms}ms).`,
    buildUnchanged: (buildId) => `Map is already current (build ${buildId}); nothing rewritten.`,
    buildFailed: (reason) => `Analysis failed; the last successful map was kept. Reason: ${reason}`,
    changesSummary: (added, removed, modified, features) => `Changes: +${added} / -${removed} / ~${modified} nodes, ${features} features affected.`,
    watchStarted: (dir) => `Watching for changes. Map: ${dir}`,
    watchChanges: (count) => `${count} file(s) changed; rebuilding...`,
    reportHint: (file) => `Standalone report: ${file}`,
    githubWorkflowCreated: (file) => `Created ${file}.`,
    githubWorkflowUpdated: (file) => `Updated ${file} (it was an unmodified generated file).`,
    githubWorkflowOverwritten: (file) => `Overwrote ${file} as requested by --force; your previous edits to it are gone.`,
    githubWorkflowUnchanged: (file) => `${file} is already current; nothing changed.`,
    githubWorkflowModified: (file) => `${file} exists and has local modifications, so it was NOT touched. Re-run with --force to overwrite it.`,
    githubNextSteps: `Next: commit agent-runtime-map.config.json and .github/workflows/agent-runtime-map.yml.\nEvery push, pull request, and a weekly schedule will then rebuild the map on GitHub:\nthe run's Summary shows what changed, and the full map (report.html) is attached as an artifact.`,
    forceRequiresGithub: "--force is only meaningful together with init --github",
  },
  "zh-CN": {
    analyzing: (project) => `正在分析 ${project}…`,
    scanned: (files) => `已扫描 ${files} 个代码文件。`,
    contextSummary: (documents, prompts, capabilities) => `已读取 ${documents} 个项目文档、${prompts} 个 Prompt 文件，并提取 ${capabilities} 条功能线索。`,
    found: (nodes, edges) => `发现 ${nodes} 个代码节点和 ${edges} 条关系。`,
    compiled: (nodes, edges) => `已编译为 ${nodes} 个逻辑节点和 ${edges} 条逻辑流。`,
    featureSummary: (features, errors, warnings) => `识别到 ${features} 个功能电路（${errors} 个错误，${warnings} 个警告）。`,
    logicGraph: (file) => `逻辑图：${file}`,
    rawGraph: (file) => `原始代码图：${file}`,
    viewer: (url) => `查看地址：${url}`,
    unexpected: (value) => `存在无法识别的位置参数：${value}`,
    exposed: (host) => `警告：Viewer 已暴露在 ${host}；逻辑图可能包含源码路径和代码结构。`,
    openFailed: (url) => `无法自动打开浏览器，请手动访问 ${url}。`,
    graphTypeInvalid: "--graph-type 必须是 runtime_logic 或 product_logic",
    localeInvalid: "--locale 必须是 auto、zh-CN 或 en",
    semanticProviderInvalid: "--semantic 当前只支持 openai",
    semanticModelRequired: "启用 --semantic openai 时必须提供 --semantic-model",
    semanticApiKeyMissing: "启用 --semantic openai 时必须设置 OPENAI_API_KEY",
    stop: "按 Ctrl+C 停止服务。",
    portInvalid: "--port 必须是 1 到 65535 之间的整数",
    positiveInteger: (option) => `${option} 必须是正整数`,
    initCreated: (file) => `已创建 ${file}。`,
    initCompleted: (file, keys) => `已补全 ${file}（新增：${keys}）。`,
    initUnchanged: (file) => `${file} 已包含全部持续地图配置，未做修改。`,
    initIgnored: (rule: string, file: string) => `已把 ${rule} 写入 ${file}，生成的地图不会进入版本库。`,
    initScripts: (scripts) => `建议添加到 package.json 的 scripts（需要请自行添加）：\n${scripts}`,
    configWarning: (warning) => `警告：${warning}`,
    buildUpdated: (dir, buildId, ms) => `地图已更新：${dir}（构建 ${buildId}，耗时 ${ms}ms）。`,
    buildUnchanged: (buildId) => `地图已是最新（构建 ${buildId}），未重写任何文件。`,
    buildFailed: (reason) => `分析失败，已保留最后一次成功的地图。原因：${reason}`,
    changesSummary: (added, removed, modified, features) => `变更：节点 +${added} / -${removed} / ~${modified}，${features} 个功能受影响。`,
    watchStarted: (dir) => `正在监听变化。地图目录：${dir}`,
    watchChanges: (count) => `检测到 ${count} 个文件变化，正在重新分析…`,
    reportHint: (file) => `独立报告页：${file}`,
    githubWorkflowCreated: (file) => `已创建 ${file}。`,
    githubWorkflowUpdated: (file) => `已更新 ${file}（原文件是未经修改的生成文件）。`,
    githubWorkflowOverwritten: (file) => `已按 --force 要求覆盖 ${file}；你之前对它的修改已被丢弃。`,
    githubWorkflowUnchanged: (file) => `${file} 已是最新，未做修改。`,
    githubWorkflowModified: (file) => `${file} 已存在且包含你的手动修改，因此没有改动它。如需覆盖，请使用 --force 重新执行。`,
    githubNextSteps: `下一步：提交 agent-runtime-map.config.json 和 .github/workflows/agent-runtime-map.yml。\n之后每次 push、Pull Request 以及每周一次的定时任务都会在 GitHub 上自动重建地图：\n运行的 Summary 会显示变更摘要，完整地图（report.html）会作为 artifact 附在运行结果里。`,
    forceRequiresGithub: "--force 只能与 init --github 一起使用",
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

将代码项目转换成一张有源码证据、可逐步检查的 Agent 功能电路图。

用法：
  agent-runtime-map [项目] [选项]          分析项目并打开交互式 Viewer
  agent-runtime-map serve [项目] [选项]    分析项目并打开交互式 Viewer
  agent-runtime-map analyze [项目] [选项]  只生成 JSON，不启动 Viewer
  agent-runtime-map init [项目]            创建 agent-runtime-map.config.json
  agent-runtime-map init --github [项目]   同时生成 GitHub Actions workflow，push 后自动更新地图
  agent-runtime-map build [项目]           构建持续地图到 .agent-runtime-map/current/
  agent-runtime-map watch [项目]           持续监听并自动更新地图，同时提供 Viewer

兼容命令：logic-map

选项：
  -o, --out <文件>            Logic Graph 输出位置（默认：.logic-map/graph.json）
      --raw-out <文件>        Raw Code Graph 输出位置（默认：.logic-map/raw-graph.json）
      --no-raw                不生成 Raw Code Graph
      --max-files <数量>      最大分析文件数（默认：2000）
      --max-context-files <数量> 最大项目文档数（默认：80）
      --max-context-bytes <数量> 项目文档读取字节上限（默认：750000）
      --no-context            不读取 README、docs、PRD 和 Prompt
      --max-nodes <数量>      最大逻辑节点数（默认：40）
      --graph-type <类型>     runtime_logic 或 product_logic
      --description <说明>    可选的产品背景说明
      --semantic openai      显式启用可选 LLM 语义压缩（默认关闭）
      --semantic-model <模型> OpenAI 模型名称（启用 semantic 时必填）
      --semantic-base-url <地址> 可选的 Responses API 基础地址
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

Turn your codebase into an evidence-backed, step-through Agent circuit map.

Usage:
  agent-runtime-map [project] [options]          Analyze and open the interactive viewer
  agent-runtime-map serve [project] [options]    Analyze and open the interactive viewer
  agent-runtime-map analyze [project] [options]  Generate JSON without starting a server
  agent-runtime-map init [project]               Create agent-runtime-map.config.json
  agent-runtime-map init --github [project]      Also generate the GitHub Actions workflow for automatic updates
  agent-runtime-map build [project]              Build the continuous map into .agent-runtime-map/current/
  agent-runtime-map watch [project]              Watch the project, keep the map updated, and serve the viewer

Alias: logic-map

Options:
  -o, --out <file>            Logic Graph output (default: .logic-map/graph.json)
      --raw-out <file>        Raw Code Graph output (default: .logic-map/raw-graph.json)
      --no-raw                Do not write the Raw Code Graph
      --max-files <number>    Maximum source files to analyze (default: 2000)
      --max-context-files <number> Maximum project documents to read (default: 80)
      --max-context-bytes <number> Project context byte limit (default: 750000)
      --no-context            Skip README, docs, PRD, and prompt reading
      --max-nodes <number>    Maximum compiled logic nodes (default: 40)
      --graph-type <type>     runtime_logic or product_logic
      --description <text>    Optional product context for the graph
      --semantic openai      Explicitly enable optional LLM semantic compression (off by default)
      --semantic-model <model> OpenAI model name (required with semantic mode)
      --semantic-base-url <url> Optional Responses API base URL
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
