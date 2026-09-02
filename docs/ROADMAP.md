# Roadmap

Kept in step with [`CC_HANDOFF.md` §9](CC_HANDOFF.md#9-high-value-next-work), which
explains each open item in depth. A box is ticked only when the code ships and a
test or a browser pass covers it. The last alignment check was 2026-09-02.

## 0.1 — Local static logic map (shipped)

- TypeScript/JavaScript analyzer
- Raw Code Graph and Logic Graph
- heuristic Logic Compiler
- local interactive Viewer
- evidence and confidence
- global Agent circuit with per-feature routes and branch variants
- play, pause, single-step, replay, and playback speed for static route simulation
- Chain Doctor with green, yellow, and red evidence-backed states
- public CLI package

## 0.2 — Project understanding and semantic compiler

- [x] README, docs, PRD, prompt, package, and safe config ingestion
- [x] Agent, workflow, tool, model, prompt, and human-gate metadata extraction
- [x] conditional, parallel, loop, retry, fallback, and approval control evidence
- [x] OpenAI Agents SDK-style and LangGraph-style declarative detection
- [x] optional evidence-constrained OpenAI Responses semantic pass
- [x] bounded privacy snapshot and immutable graph topology during enrichment
- [ ] clustering multiple low-level code nodes into one multi-source logic stage
      (the compiler is strictly one raw node per logic node, and edge projection
      assumes `rawNodeIds[0]`; that assumption has to go first)
- [ ] larger evaluation corpus for label quality and hallucination rate (the
      benchmark in `benchmarks/` counts topology; label quality is not measured)

## 0.3 — Framework depth and embedding

- [x] Express and Hono routers, mount prefixes, chained and inline registration
- [x] Next.js App Router `route.ts` handlers
- [ ] Next.js server actions and `middleware.ts`
- [ ] NestJS decorators and Mastra registries (both are recognised by package
      name only today)
- [x] React blueprint primitive package
- [x] wheel-driven overview, logic, and source-evidence semantic zoom
- [x] high-level embeddable component, shipped as `<LogicMap />` from
      `@agent-runtime-map/react`
- [x] Web Component, shipped as `<logic-map>` (`packages/react/src/element.tsx`)
- [ ] the Viewer consuming `<LogicMap />` instead of composing React Flow itself
- [ ] a DOM render test for the embedded surfaces (the suite has no jsdom yet)
- [x] saved layouts, per project, with undo and reset
- [ ] annotations
- [x] Python AST adapter (`adapters/python`; needs Python 3.10 or newer)
- [ ] Python cross-module call resolution and class-method attribution
- [ ] LangGraph/CrewAI graph wiring and Django URL configs in Python (factory
      names are recognised; `add_node`/`add_edge`, crew/task wiring, and
      `urlpatterns` are not read)

## 0.7 – 0.8 — Continuous map (shipped)

- [x] `.agent-runtime-map/` history with diff, status, and `report.html`
- [x] GitHub Action with an artifact by default and an opt-in Pages publish
- [x] bilingual business semantics, Chinese and English, on nodes and features
- [x] npm Trusted Publishing with provenance
- [x] hand-confirmed accuracy benchmark in CI

## Later — Static Logic to Live Logic

- [x] trace bridge: `TraceEvent` and `applyTraceEvents()` in
      `@agent-runtime-map/react`, for embedders
- [ ] ingesting a trace from the CLI
- [ ] an OpenTelemetry span adapter onto the same ids
- [ ] actual execution-path overlays with run replay, timing, token, and error
      metadata

Observability, APM, and live Agent playback stay outside the current line. The
player walks the statically compiled route and is labeled as a simulation.
