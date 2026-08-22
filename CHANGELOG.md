# Changelog

All notable changes are documented here.

## 0.1.1 - 2026-08-22

### Added

- Three-level semantic zoom driven by the normal graph wheel gesture: overview,
  Agent logic, and exact source evidence.
- Evidence-level node details with source file, line, symbol, and inference
  method while preserving the same layout and graph identity across zoom levels.
- Reusable `blueprintDetailLevelForZoom()` thresholds and semantic-zoom node
  contract in `@agent-runtime-map/react`.
- Bilingual view-level indicator and scroll guidance in the bundled Viewer.

## 0.1.0 - 2026-08-21

### Added

- A bounded Project Reader for package metadata, README, docs, PRD, prompts, and
  non-executable `agent-runtime-map.config.json` product context.
- Semantic raw-graph roles for workflows, tools, models, prompts, and human
  approval gates in addition to Agents, services, data, APIs, and user actions.
- Control-flow evidence for conditional branches, parallel execution, loops,
  retries, fallbacks, and human approval.
- OpenAI Agents SDK-style Agent/tool/model/instructions detection and
  LangGraph-style declarative node/edge detection.
- Product-capability matching that connects documented feature names to
  reachable code-backed circuits without creating unsupported graph topology.
- A `ProjectUnderstanding` summary containing detected capabilities, key Agent
  roles, workflows, tools, models, documents used, and calibrated confidence.
- Optional evidence-constrained semantic enrichment through the OpenAI Responses
  API. It is off by default, uses a bounded snapshot and structured output, and
  cannot add graph topology or evidence.
- Chain Doctor warnings for unbounded retries, external calls without visible
  fallbacks, and Agent paths without a visible output.
- CLI controls for project-context limits and explicit semantic opt-in.
- TypeScript and JavaScript AST scanning with source evidence.
- Next.js and Express/Hono route detection.
- Function-call, internal API, database, external SDK, and variable-result data-flow extraction.
- Evidence-backed Raw Code Graph and Logic Graph schemas.
- Heuristic Logic Compiler with confidence and compression diagnostics.
- React Flow and ELK interactive viewer with search, minimap, and evidence panel.
- `serve` and `analyze` CLI modes.
- Local HTTP server with restrictive file serving and security headers.
- Monorepo build, tests, package validation, and CI.
- Automatic Chinese/English CLI and Viewer localization with a manual language
  switch and deterministic translation of generated semantic labels.
- A global Agent circuit with a left-side feature list and selectable execution
  branches for each detected user action or API entry.
- Static chain simulation with play, pause, single-step, replay, and speed controls.
- Chain Doctor diagnostics: verified steps highlight green, uncertain inference
  highlights yellow, and deterministic chain failures highlight red and halt at
  the affected step with source evidence and a suggested repair.
- A four-feature sample Agent project covering generation, review branches,
  knowledge import, and an intentionally incomplete publish circuit.
- A light engineering-blueprint Viewer with grid paper, icon-first semantic
  nodes, nested system boundaries, orthogonal labeled flows, and distinct main
  versus auxiliary data circuits.
- Reusable open-source React Flow primitives in `@agent-runtime-map/react`,
  including logic nodes, group frames, playback edge tokens, and boundary
  measurement helpers.
- Feature-focused viewport framing and blue/green/amber/red circuit states for
  idle, active, verified, uncertain, and failed inspection steps.

### Fixed

- Confidence is calibrated per signal instead of reporting a flat `0.86` for every
  classification, so the score in the evidence panel now distinguishes a naming
  convention from a directory convention from a verb appearing inside a name.
- Private and protected class members are no longer classified as services, which
  kept helpers such as `cap` and `audit` off the map.
- Directory conventions no longer promote code under `scripts/`, `examples/`, or
  `fixtures/`, so smoke scripts under an `agents/` tree stop appearing as agents.
- Test files (`*.test.*`, `*.spec.*`, `__tests__/`, `__mocks__/`) and TypeScript
  declaration files are excluded from analysis; `.mts` and `.cts` source is supported.
- A declaration named exactly `service`, `agent`, `tool`, or `action` names its
  category rather than its behaviour and is no longer classified as one.
- The Logic Compiler uses confidence and flow connectivity to suppress weak,
  isolated candidates and disconnected utilities without deleting connected or
  concise business steps.
