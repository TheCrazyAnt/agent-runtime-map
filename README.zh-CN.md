# Agent Runtime Map

简体中文 · [English](README.md)

让 Agent 代码自己画出它的功能电路，并逐步检查每一条执行链路。

Agent Runtime Map 会读取 TypeScript / JavaScript 项目，同时理解 README、docs/PRD、Prompt、依赖和安全配置；再通过 AST 与框架规则提取页面操作、API、工作流、Agent、工具、模型、数据库、外部服务与控制流，最后编译成一张全局 Agent 执行图。

左侧是项目的全部功能。点击某个功能，就能在右侧全局图上播放、暂停、单步前进、重新检查、调整速度，并切换该功能的不同执行分支。

> 当前为 **0.1 alpha**。支持范围是刻意收窄的，不会声称能理解所有代码项目。

## 它解决什么问题

- **一张全局电路图：** 共享的工作流、Agent、工具、数据库和外部 API 保留在同一张图中。
- **每个功能一条路线：** 选择“生成、审核、导入”等功能，只高亮实现它的节点与连线。
- **静态链路模拟：** 播放器模拟代码推断出的执行路线，不会假装真的有一个线上请求正在运行。
- **链路检查：** 已确认步骤变绿；不确定推断变黄；确定性断链变红，并在出错步骤停止。
- **源码证据：** 每个节点和诊断都保留文件、行号、置信度、识别方法与修复建议。
- **语义缩放：** 滚轮缩放会在全局、Agent 逻辑和源码证据三层间连续渐变，不删除图里的事实，也不会在层级边界来回闪烁。
- **可展开的代码细节：** 双击逻辑节点会在它附近展开真实的 Agent、函数、工具与调用关系，不重新打乱全局图。
- **源码联动：** 点击节点或搜索结果即可读取本地、带行号高亮的源码证据；Viewer 只允许读取已分析图中出现过的文件。
- **平滑导航：** 搜索会飞到命中节点；播放可跟随当前步骤，用户拖动画布后立即让出控制；拖动节点的位置会按项目记忆，并支持撤销和重置。
- **自动中英文：** 中文系统和浏览器默认显示中文，海外环境默认显示英文，也可以手动切换。

## 项目理解能力

- 读取 `package.json`、框架依赖、脚本与包管理器。
- 读取 README、`docs/`、PRD、Prompt 文件和代码内的 instructions。
- 识别 Agent、Workflow、Tool、Model、Prompt、人工审批、数据库和外部系统。
- 识别顺序、条件、并行、循环、重试、fallback 与人工确认链路。
- 支持 OpenAI Agents SDK 风格配置与 LangGraph 风格声明式拓扑。
- 支持 `agent-runtime-map.config.json` 补充产品说明、功能名称与关键词。

Project Reader 不会把 `.env`、凭据、私钥、`node_modules`、构建产物或 Git
元数据作为语义上下文，也不会执行被分析项目及其配置文件。

## 蓝图 Viewer 与可复用组件

Viewer 采用开源的工程蓝图视觉系统：细密网格画布、图标型节点、带标题的
实线/虚线分区、蓝色直角主链路，以及灰色虚线数据链路。播放状态直接作用于
这张图：当前步骤蓝色扫描，已验证步骤变绿，不确定步骤变黄，确定性故障则让
对应节点和链路爆红。

这些 UI 不只存在于 Viewer 内部，而是独立放在开源的
[`@agent-runtime-map/react`](packages/react/README.md) 工作区包中。其他 Agent
后台可以复用节点、分区边框、链路状态 token 和自动边界计算工具。组件接口和
嵌入示例见 [Visual Components](docs/VISUAL_COMPONENTS.md)。

## 本地体验

```bash
git clone https://github.com/tangyishun9846/agent-runtime-map.git
cd agent-runtime-map
npm ci
npm run build
node packages/cli/dist/cli.js examples/simple-agent --no-open
```

打开命令输出的地址。示例项目包含四个功能电路：内容生成、多分支内容审核、知识导入，以及一个故意没有下游工作流的发布功能。检查“发布”功能时，链路会在入口爆红并停止。

分析你自己的项目：

```bash
node packages/cli/dist/cli.js /你的项目绝对路径
```

npm 正式发布后可以直接运行：

```bash
npx agent-runtime-map@latest .
```

在 npm registry 发布前，也可以不克隆 Monorepo，直接从 GitHub Release 安装
同一个已经通过发布校验的 CLI 包：

```bash
npm install --save-dev https://github.com/tangyishun9846/agent-runtime-map/releases/download/v0.3.1/agent-runtime-map-0.3.1.tgz
npx agent-runtime-map .
```

## 常用命令

```text
agent-runtime-map [项目] [选项]          分析并打开交互式 Viewer
agent-runtime-map serve [项目] [选项]    分析并打开交互式 Viewer
agent-runtime-map analyze [项目] [选项]  只生成 JSON
```

常用选项：

```text
--max-files <数量>      最大分析文件数（默认：2000）
--max-context-files <数量> 最大项目文档数（默认：80）
--max-context-bytes <数量> 项目上下文字节上限（默认：750000）
--no-context            不读取 README、docs、PRD 和 Prompt
--max-nodes <数量>      最大逻辑节点数（默认：40）
--graph-type <类型>     runtime_logic 或 product_logic
--locale <语言>         auto、zh-CN 或 en
--port <端口>           Viewer 端口（默认：4173）
--no-open               不自动打开浏览器
--no-raw                不生成详细 Raw Code Graph
--semantic openai       显式开启可选 LLM 语义压缩
--semantic-model <名称> semantic 模式使用的模型（必填）
```

输出位于 `.logic-map/`：

- `graph.json`：Viewer 使用的 Logic Graph，包含功能、路径、步骤与诊断。
- `raw-graph.json`：详细代码事实和关系。

## 当前支持

- TypeScript、TSX、JavaScript、JSX
- `tsconfig.json` / `jsconfig.json` 路径别名
- Next.js App Router、Express / Hono 风格路由
- 函数、方法、导入、静态调用与结果数据流
- README/docs/PRD/Prompt 理解与文档功能匹配
- Agent、Workflow、Tool、Model、Prompt、人工审批、action、service 识别
- OpenAI Agents SDK 风格配置与 LangGraph 声明式拓扑
- 条件、并行、循环、重试、fallback 与人工确认控制流
- 常见 Prisma 数据操作、Fetch / Axios 外部 URL、部分 SDK 调用
- 全局 Agent 图、功能路线、分支、静态播放器与链路诊断
- ELK 自动布局、React Flow、搜索、缩略图、置信度和源码证据

默认模式不会执行被分析的项目、上传源码、调用 LLM 或发送遥测。只有显式使用
`--semantic openai --semantic-model <模型>` 并设置 `OPENAI_API_KEY` 时，才会发送
经过裁剪的证据摘要；请求不包含绝对项目根目录或原始源码文件，并且模型只能修改
已有节点和功能的名称、说明，不能新增节点、连线或证据。Python、实际运行追踪、
Token、性能与 APM 仍不属于当前静态版本。

启用联网语义能力前请阅读 [Project Context](docs/PROJECT_CONTEXT.md)。

## 开发

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run release:check
```

架构、协议和 UI 组件详见 [Architecture](docs/ARCHITECTURE.md)、[Graph Schema](docs/GRAPH_SCHEMA.md)、[Visual Components](docs/VISUAL_COMPONENTS.md) 与 [Roadmap](docs/ROADMAP.md)。给 CC 继续开发用的详细交接文档见 [CC Handoff](docs/CC_HANDOFF.md)。

MIT License。
