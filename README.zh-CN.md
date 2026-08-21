# Agent Runtime Map

简体中文 · [English](README.md)

让 Agent 代码自己画出它的功能电路，并逐步检查每一条执行链路。

Agent Runtime Map 会读取 TypeScript / JavaScript 项目，通过 AST 和框架规则提取页面操作、API、工作流、Agent、工具、数据库与外部服务，然后编译成一张全局 Agent 执行图。

左侧是项目的全部功能。点击某个功能，就能在右侧全局图上播放、暂停、单步前进、重新检查、调整速度，并切换该功能的不同执行分支。

> 当前为 **0.1 alpha**。支持范围是刻意收窄的，不会声称能理解所有代码项目。

## 它解决什么问题

- **一张全局电路图：** 共享的工作流、Agent、工具、数据库和外部 API 保留在同一张图中。
- **每个功能一条路线：** 选择“生成、审核、导入”等功能，只高亮实现它的节点与连线。
- **静态链路模拟：** 播放器模拟代码推断出的执行路线，不会假装真的有一个线上请求正在运行。
- **链路检查：** 已确认步骤变绿；不确定推断变黄；确定性断链变红，并在出错步骤停止。
- **源码证据：** 每个节点和诊断都保留文件、行号、置信度、识别方法与修复建议。
- **自动中英文：** 中文系统和浏览器默认显示中文，海外环境默认显示英文，也可以手动切换。

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

## 常用命令

```text
agent-runtime-map [项目] [选项]          分析并打开交互式 Viewer
agent-runtime-map serve [项目] [选项]    分析并打开交互式 Viewer
agent-runtime-map analyze [项目] [选项]  只生成 JSON
```

常用选项：

```text
--max-files <数量>      最大分析文件数（默认：2000）
--max-nodes <数量>      最大逻辑节点数（默认：40）
--graph-type <类型>     runtime_logic 或 product_logic
--locale <语言>         auto、zh-CN 或 en
--port <端口>           Viewer 端口（默认：4173）
--no-open               不自动打开浏览器
--no-raw                不生成详细 Raw Code Graph
```

输出位于 `.logic-map/`：

- `graph.json`：Viewer 使用的 Logic Graph，包含功能、路径、步骤与诊断。
- `raw-graph.json`：详细代码事实和关系。

## 当前支持

- TypeScript、TSX、JavaScript、JSX
- `tsconfig.json` / `jsconfig.json` 路径别名
- Next.js App Router、Express / Hono 风格路由
- 函数、方法、导入、静态调用与结果数据流
- Agent、workflow、tool、action、service 命名与目录规则
- 常见 Prisma 数据操作、Fetch / Axios 外部 URL、部分 SDK 调用
- 全局 Agent 图、功能路线、分支、静态播放器与链路诊断
- ELK 自动布局、React Flow、搜索、缩略图、置信度和源码证据

当前不会执行被分析的项目，也不会上传源码、调用 LLM 或发送遥测。Python、实际运行追踪、Token、性能与 APM 不属于 0.1。

## 开发

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run release:check
```

架构和协议详见 [Architecture](docs/ARCHITECTURE.md)、[Graph Schema](docs/GRAPH_SCHEMA.md) 与 [Roadmap](docs/ROADMAP.md)。

MIT License。
