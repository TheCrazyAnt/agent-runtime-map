# Agent Runtime Map launch kit

This kit keeps the launch factual: the map is statically inferred, not a live
trace; the supported scope is public alpha; and no download count is presented
as a user count.

## Positioning

**English**

> Turn an AI Agent codebase into an evidence-backed, step-through execution map.

**简体中文**

> 把 AI Agent 代码库变成可逐步播放、每个节点都能追溯到 `file:line` 的执行地图。

Primary proof:

1. A deterministic analyzer, not an LLM, decides the topology.
2. Every visible node and edge keeps source evidence and confidence.
3. A read-only GitHub Action keeps the map current without committing generated files.

Primary call to action: **[Open the live demo](https://thecrazyant.github.io/agent-runtime-map/)**.
Repository call to action: **[Install Agent Runtime Map](https://github.com/TheCrazyAnt/agent-runtime-map#set-it-up-once-github-keeps-the-map-current)**.

## Show HN

**Title**

> Show HN: Agent Runtime Map – code-backed execution maps for AI Agent repositories

**Maker comment**

> I built Agent Runtime Map because architecture diagrams authored after reading
> a repository can be persuasive without matching the code. This project takes a
> stricter route: a deterministic analyzer builds the topology, the same commit
> produces the same graph, and every node and edge keeps the file, line, inference
> method, and confidence that produced it.
>
> You can select an Agent capability, step through its statically inferred route,
> open the source evidence behind a node, and see uncertainty rather than an
> invented answer. TypeScript, JavaScript, and Python are supported within the
> documented public-alpha scope. The default analysis is local and executes none
> of the inspected project.
>
> Live demo: https://thecrazyant.github.io/agent-runtime-map/
> Source/install: https://github.com/TheCrazyAnt/agent-runtime-map
>
> I would especially value examples where a route is missing, over-compressed, or
> incorrectly connected. Those are more useful than general feature requests at
> this stage.

Do not ask for upvotes or coordinate comments. Stay available to answer technical
questions for the launch window.

## X / LinkedIn

**Post 1 — problem**

> An AI Agent diagram can look right while containing calls the code never makes.
> Agent Runtime Map takes the opposite contract: code decides the topology, and
> every visible node/edge keeps file:line evidence. Open source, public alpha.
> https://github.com/TheCrazyAnt/agent-runtime-map

**Post 2 — experience**

> Select one Agent capability. Play its statically inferred route. Open a node to
> see the exact source evidence. Verified steps turn green; uncertainty is marked;
> deterministic breaks stop the circuit. Live demo:
> https://thecrazyant.github.io/agent-runtime-map/

**Post 3 — continuous map**

> Install once, then a read-only GitHub Action rebuilds the Agent Map on every push
> and PR. It reports affected features and diagnostics, preserves the last good
> map on failure, and keeps the artifact private by default.

Use one launch image per post instead of attaching all four at once.

## V2EX / 掘金

**标题**

> 我做了一个把 Agent 代码库变成可逐步播放执行地图的开源工具

**正文**

> 很多架构图是让模型读完仓库后重新“写”出来的：图可以很漂亮，但验证的是图
> 是否自洽，不是连线是否真的存在。Agent Runtime Map 选择了更严格的做法：拓扑
> 由确定性分析器生成，同一个 commit 得到同一张图，每个节点和边都保留文件、
> 行号、识别方法与置信度。
>
> 可以从左侧选择一个产品功能，逐步播放静态推断出的执行链路，展开节点查看真实
> Agent、函数与工具，并直接打开源码证据。中文、英文业务视图和技术名共用同一份
> 图数据；不确定的名字会明确标成“待确认”，不会硬翻。
>
> 在线 Demo：https://thecrazyant.github.io/agent-runtime-map/?locale=zh-CN
> GitHub：https://github.com/TheCrazyAnt/agent-runtime-map
>
> 现在是公开 Alpha。我最需要的反馈不是“再加一个功能”，而是哪类真实 Agent
> 仓库出现了漏连、错连或压缩过度；这些都可以直接变成确定性的测试样本。

## Product Hunt

**Name:** Agent Runtime Map

**Tagline:** Evidence-backed execution maps for AI Agent codebases

**Description:**

> Turn TypeScript, JavaScript, or Python Agent repositories into interactive,
> step-through execution maps. Code decides the topology; every node and edge keeps
> source evidence, inference method, and confidence.

**First comment:** use the Show HN maker comment, shortened to the first three
paragraphs. Upload the four `product-hunt-*.png` images in numeric order. Mark the
product as free and open source.

## Thirty-day scorecard

The north-star metric is an **activated external repository**, not a package
download. Record only evidence that can be checked without hidden telemetry.

- 10 external repositories generate a map successfully.
- 5 repositories keep the generated GitHub Action enabled for two weeks.
- 5 users provide concrete route-accuracy or onboarding feedback.
- 3 public repositories become permission-safe case studies.
- Secondary signals: 50 GitHub stars and 500 npm downloads.

For every launch channel, record the date, link, referral traffic, useful
questions, successful activations, and the next correction. Never describe npm
downloads as unique people.
