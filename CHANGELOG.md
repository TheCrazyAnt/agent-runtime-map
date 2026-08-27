# Changelog

All notable changes are documented here.

## 0.6.0 - 2026-08-27

### Added

- `@agent-runtime-map/mcp`, a Model Context Protocol server, so an agent can read a
  repository as an evidence-backed map instead of file by file. Four tools:
  `analyze_project`, `list_features`, `describe_feature`, `get_evidence`. Each
  answers one question and names the tool that answers the next — a compiled map of
  a real repository is hundreds of kilobytes, and no tool returns it whole.
- Every answer keeps the source location and confidence behind each step, and
  reports a documented-capability match separately from code confidence. A route is
  labelled a statically inferred path in the answer itself, not a recorded run.
- `generateLogicMap` accepts `outputFile: false`. An agent analyzing someone else's
  repository on their behalf should not leave files in it, and the MCP server writes
  nothing unless asked.

## 0.5.0 - 2026-08-24

### Fixed

- A directory convention no longer promotes the plumbing beside real Agents. Every
  function under `agents/` became an Agent at 72%, so `isRecord`, `optionalText`,
  and `parseJsonBlock` took four slots on a compressed map and pushed real steps
  off it — an Agent outranks almost everything. A predicate, a converter, or a
  function returning a bare primitive is plumbing wherever it sits. A name that
  says `…Tool` is still evidence about the function itself and still counts.

### Added

- Data access is recognized beyond five hardcoded client names: `pool.query`,
  `repository.save`, and `collection.insertOne` now reach the map. A named client
  stays a framework fact at `0.88`; a data-shaped receiver is a convention and
  reports `0.7`. Stores are named after their receiver rather than all reading
  "Data Data".
- An outbound call with a computed URL is reported. Only a literal `https://…` was
  recognized before, so a request built from a variable left no boundary on the
  map at all. The host cannot be named, and the confidence says so at `0.68`.
  `got`, `ky`, `undici`, and `superagent` join `fetch` and `axios`.
- `<LogicMap positions={…} />` takes coordinates the host already has and skips the
  layout engine entirely — elkjs is never imported, so a host that lays out its own
  map does not pay for it.

## 0.4.1 - 2026-08-24

### Fixed

- Searching blanked the whole Viewer. The search read a node map declared 142 lines
  further down the component, so the first keystroke hit the temporal dead zone and
  took React's tree with it. The matching is now a tested pure function that is
  handed what it needs instead of reaching for it.
- Flying to a node the map had not measured threw. Every node hidden by focus is
  unmeasured, so searching from inside a focus and clicking a result outside it hit
  this. The fallbacks were already written; the optional chain was not.
- A node change carrying no id is no longer read for one.

### Changed

- `npm run typecheck` now checks the Viewer, which nothing did before: the root
  project never included `apps/**`, and the Viewer's build is `vite build`, which
  does not run `tsc`. Both bugs above were type errors sitting in that blind spot.
  Verified by injecting an error and watching the check fail.

## 0.4.0 - 2026-08-23

### Added

- Focus: narrow the map to one step and everything below it, from a control on the
  node. The rest is hidden rather than dimmed — that is the difference between
  framing a feature and narrowing to a step — and a breadcrumb leads back to the
  whole system, restoring whatever feature was selected before. Positions are never
  recomputed, so the steps that remain sit exactly where they were.
- Focus is offered only where narrowing would show something. A step with nothing
  below it would narrow to itself alone, which is not worth an affordance.

## 0.3.2 - 2026-08-23

### Changed

- A step now says what it does instead of restating its own name. Every generated
  description was a tautology — "An AI workflow performs generate ideas" for a node
  labelled Generate Ideas — while the facts worth reading were already in the graph
  and unused. `LogicNode.behavior` carries them as node ids, and each language
  phrases them itself, so "Execute Review" now reads *calls Score Draft and Approve
  Draft, and branches to Revise Draft*. A description written by a person still
  wins: it says why, and this can only say what.
- Expanding a step shows what it is made of, not what it sits in. Following raw
  edges in both directions pulled in the file containing the step and the route
  calling it, and listed them beside its actual internals as peers — expanding
  "Execute Review" answered with six boxes, three of which were its own function's
  file, its caller, and itself.

## 0.3.1 - 2026-08-23

### Fixed

- `<LogicMap />` highlighted a framed feature route on its edges but left every
  node on that route unmarked. The highlight patch runs against an array a second
  effect populates, so the first pass hit an empty array and never ran again. Found
  by the browser verification that 0.3.0 shipped without.

## 0.3.0 - 2026-08-22

### Added

- The TypeScript analyzer resolves callables that are declared as values rather
  than as named functions: members of an exported handler object, default-exported
  arrows, and the callable a factory returned. Calls written inside those bodies
  used to have no enclosing declaration and were dropped from the graph entirely.
- A function handed to another function is recorded as a call, with the control
  kind describing when it receives control: `loop` for an iteration method,
  `fallback` for a catch handler, `parallel` for `Promise.all`, and
  `human_approval` for a gate. The reference is reported at lower confidence than
  a direct invocation, because execution is deferred.
- Symbol resolution follows destructured bindings (`const { search } = tools`) and
  object properties that hold a reference rather than a body, bounded to three hops.
- A named step array (`const pipeline = [classify, draft, send]`) links to the
  steps it lists.
- Routes are recognized on any router a known framework built, not only on a
  receiver literally named `app` or `router`, and a route registered on a mounted
  router reports the path the system actually serves rather than the path written
  at the registration site. Chained registration (`app.get(...).post(...)`) is read
  as two registrations.
- An inline route handler and an inline declarative graph node are read as the
  route and the graph node they implement, so their bodies appear on the map
  instead of being discarded. This keeps one node per endpoint rather than adding
  a nameless handler beside it.
- The model, prompt, and tools a request configures are read from the options
  object shared by the Vercel AI SDK, the OpenAI SDK, and the Anthropic SDK. A
  tool is recorded as a conditional call, because the model decides whether to
  use it.
- `START` and `END` are recognized when a declarative graph imports them as
  constants rather than writing them as string literals.
- Shorthand properties (`tools: { searchWeb }`) resolve to the value they name.

- Every logic node and feature carries where its product claim came from: the
  README, a product spec, project documentation, an Agent prompt, the project
  config, or the person running the tool. The evidence drawer shows it as its own
  block, separate from source evidence, with the strength of the link and the
  documented terms that produced it. A step with no documented match says so
  rather than leaving the reader to guess.
- `--description` now becomes a labelled capability claim, not only the project
  summary. It is attributed to the person who supplied it and carries no file,
  because there is none.
- Prompts contribute capability hints, attributed as prompts.
- The Viewer server can preview a document a product claim came from, so the
  attribution is checkable. The allow-list stays an allow-list: a file that no
  node or feature references is still refused.

- A raw child opened under a step can be selected in its own right: the drawer
  shows that child's source range, its own evidence, and a breadcrumb back to the
  step it belongs to.
- A raw child can be opened one further level, with an explicit control on the
  node. Depth is capped at two, and the deepest level carries no control rather
  than offering an interaction that does nothing.

- An embeddable `<LogicMap />` React component, and a `<logic-map>` custom element
  on its own entry point for hosts that are not React applications. Both take an
  already compiled `LogicGraph` and never read a repository or call a service of
  their own. `stepIndex` drives the same static route simulation the Viewer shows,
  and is documented as a simulation rather than a run.
- The route simulation reducer, the ELK layout, and the boundary-frame derivation
  moved into `@agent-runtime-map/react`, so the Viewer and an embedded map share
  one implementation. Boundary titles are supplied by the host rather than looked
  up from a locale, which keeps the visual package language-neutral.

- An optional trace bridge: `TraceEvent` in the protocol and `applyTraceEvents()`
  in the visual package map a real run onto the ids the graph already has. It adds
  no nodes, no edges, and no confidence; an event that matches nothing is returned
  as unmatched rather than drawn, a raw symbol is lifted to the step containing it,
  and a failure is never erased by a later event. `<LogicMap trace={...} />` styles
  observed elements distinctly from the statically inferred route.

- A Python adapter producing the same Raw Code Graph as every other adapter.
  Parsing is delegated to Python's own `ast` module — a hand-rolled parser for an
  indentation-sensitive grammar would produce guesses dressed as facts — and
  `ast.parse` builds a tree without importing or executing the code it reads. A
  project that mixes languages produces one map, not one per language. If no
  interpreter is available, that is reported rather than passed off as a project
  with no Python logic.
- `@agent-runtime-map/analysis-kit` holds the classification and evidence rules
  both adapters use, so an `agents/` directory means the same thing in either
  language. The TypeScript adapter now reads its rules from there instead of
  keeping a second copy.

### Fixed

- Expanded raw-code children were created but never became visible. They are not
  part of the Viewer's node state, so React Flow's measurement change for them was
  filtered out by `onNodesChange` and never applied, leaving every child at
  `visibility: hidden`. Their size is fixed by the visual package, so it is now
  stated rather than measured.

### Changed

- Product evidence is a separate channel from code evidence. A documented match
  never changes a node's confidence or how its classification was reached, and a
  single incidental shared word no longer counts as a match at all.
- The Logic Compiler treats a model as a side dependency of the step that
  requests it, alongside prompts, tables, and external systems. Requesting a
  model is not a decision, so it no longer multiplies a feature's branch
  variants.

## 0.2.0 - 2026-08-22

### Added

- Bounded raw-code drill-down: double-click any logic node to inspect the real
  supporting Agents, workflows, functions, tools, and calls without re-laying
  out the global map.
- A source-evidence drawer with line-highlighted local code previews. The local
  Viewer server permits only source paths already referenced by the Logic Graph.
- Search result fly-to and spotlight behavior, playback camera following that
  yields immediately to manual navigation, and a Resume follow control.
- Path-switch crossfades that keep shared nodes/edges stable, plus one subtle
  moving token on the current simulated edge.
- Project-local drag/pin layout memory with undo and reset controls.
- Reusable `BlueprintCodeNode` and `BlueprintPlaybackEdge` primitives in
  `@agent-runtime-map/react`.
- A detailed continuation guide for maintainers and coding agents.

## 0.1.2 - 2026-08-22

### Added

- Continuous eased crossfades for node semantics, confidence, source counts,
  edge labels, group details, and source-evidence cards while zooming.
- Hysteresis around semantic-level thresholds so trackpad and wheel input do not
  flicker between adjacent view labels near a boundary.
- A three-segment animated level indicator and subtle navigation feedback.
- Reduced-motion handling for viewport focus, semantic transitions, playback
  scanning, error flashes, and the evidence drawer.
- Public `blueprintSemanticZoomProgress()` interpolation API in the reusable
  React component package.

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
