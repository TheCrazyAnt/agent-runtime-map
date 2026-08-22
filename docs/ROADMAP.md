# Roadmap

## 0.1 — Local static logic map

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
- [ ] larger evaluation corpus for label quality and hallucination rate

## 0.3 — Framework depth and embedding

- deeper Next.js, Hono, and Express adapters
- [x] React blueprint primitive package
- [ ] high-level embeddable `<AgentRuntimeMap />` component
- [ ] Web Component
- [ ] saved layouts and annotations
- [ ] Python AST adapter

## Later — Static Logic to Live Logic

- optional runtime traces
- actual execution-path overlays
- run replay, timing, token, and error metadata

Observability, APM, and actual live Agent playback are deliberately outside the current MVP. The 0.1 player walks the statically compiled route and is labeled as a simulation.
