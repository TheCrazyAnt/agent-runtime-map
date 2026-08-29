# CC continuation guide

This document is the working handoff for continuing Agent Runtime Map after the
interactive-map release. It describes the product contract, the code paths that
matter, and the safest next increments.

## 1. Product contract

**One sentence:** Agent Runtime Map turns an Agent repository into an
evidence-backed map of what each product capability does, then lets a person
inspect a simulated execution route without pretending a live run is happening.

The product is not a generic architecture poster and is not an observability or
APM product. Its present promise is:

```text
repository facts + project context
        ↓
human-scale Agent logic map
        ↓
feature route simulation + evidence inspection
```

Non-negotiable principles:

- Code is the source of truth. README/docs/prompts only add product context.
- Deterministic analysis must happen before semantic inference.
- Every visible conclusion must retain evidence, inference method, and
  confidence.
- LLM enrichment is opt-in and may change labels/descriptions only; it cannot
  invent topology, nodes, edges, or source evidence.
- The current playback is a static simulation. Never label it as a real-time
  Agent run.
- The graph should keep its spatial memory. Feature switching, expansion, and
  search must not repeatedly rebuild the global layout.

## 2. Current user experience

Run a project:

```bash
npx agent-runtime-map .
```

The CLI writes `.logic-map/graph.json` and `.logic-map/raw-graph.json`, starts a
local Viewer, and opens it by default.

In the Viewer, a user can:

1. Pick a feature circuit in the left rail.
2. Pick a statically inferred branch variant, if the feature has one.
3. Play, pause, step, replay, or change speed for the static route simulation.
4. See reached steps become green, warnings amber, and deterministic failures
   red. Playback stops when an error diagnostic is reached.
5. Use the wheel to move smoothly between overview, logic, and source-evidence
   detail levels.
6. Double-click a logic node to expand its bounded raw-code internals below the
   node; double-click again to collapse it.
7. Click a logic node or a search result to open its source-evidence drawer,
   which separates what the code says from what the project says about itself.
8. Search by localized label, original label, description, or source path. A
   result gets a temporary spotlight and the camera flies to it.
9. Drag a logic node. That position is stored locally for the project, marked
   as pinned, and can be undone or reset to the ELK layout.
10. Let playback follow the current step, or pan/zoom the canvas to immediately
    turn following off; the left rail offers “Resume follow”.
11. Narrow the map to one step and everything below it with the focus control on a
    node, then return through the breadcrumb to whatever was framed before.

The visual intent is an engineering circuit/map: blue primary flows, gray
dashed data flows, nested boundaries, a quiet grid, and only one small moving
token on the current edge. Motion is intentionally restrained and has a
reduced-motion fallback.

## 3. Repository map

```text
apps/viewer/
  src/App.tsx                 Viewer state, interactions, source drawer
  src/interactionModel.ts     Pure helpers: raw-detail expansion, transitions,
                              layout snapshots (unit-tested)
  src/i18n.ts                 English/Chinese Viewer strings + localization
  src/styles.css              Viewer layout and interaction styling

packages/react/
  src/LogicMap.tsx            Embeddable canvas for a compiled LogicGraph
  src/logicMapModel.ts        Pure node/edge derivation for that canvas (unit-tested)
  src/element.tsx             <logic-map> custom element (separate entry point)
  src/simulation.ts           Pure static playback-frame reducer
  src/layout.ts               ELK global layout, called once per graph
  src/blueprintGroups.ts      Group boundary derivation (host supplies labels)
  src/BlueprintLogicNode.tsx  Human-scale semantic node
  src/BlueprintCodeNode.tsx   Compact raw-code evidence node
  src/BlueprintPlaybackEdge.tsx
                              React Flow edge with optional execution token
  src/BlueprintGroupNode.tsx  Boundary frame
  src/semanticZoom.ts         Stable zoom thresholds + continuous progress
  src/edgeAppearance.ts       Edge state → deterministic visual treatment
  src/styles.css              Reusable visual-package styles

packages/schema/src/index.ts  RawCodeGraph + LogicGraph protocol
packages/project-reader/      Safe README/docs/PRD/prompt gathering
adapters/typescript/          TS/JS AST analysis and framework conventions
adapters/python/              Python AST analysis via a bundled extractor script
  scripts/extract.py          Parses with Python's `ast`; emits facts, not judgements
packages/analysis-kit/        Classification and evidence rules shared by adapters
packages/logic-compiler/      Raw graph compression, features, Chain Doctor
packages/semantic/            Optional evidence-constrained label enrichment
packages/core/                Orchestrates reader → analyzer → compiler
packages/mcp/
  src/server.ts               MCP tools over stdio; caches one analysis per project
  src/summaries.ts            Pure answer formatting (unit-tested)
  scripts/extract.py copy     Bundled beside the server, as the CLI does
packages/cli/
  src/cli.ts                  Public command, writes outputs, starts viewer
  src/server.ts               Local static server, graph/raw/source endpoints
examples/simple-agent/        End-to-end fixture used for manual QA
tests/                        Vitest suite
```

## 4. Data model and evidence rules

The Viewer must only consume `LogicGraph`, never parse source code by itself.

### Raw Code Graph

`RawCodeGraph` contains factual fine-grained entities:

- `RawCodeNode`: entrypoint, file, function, class, route, service, agent,
  workflow, tool, model, prompt, human gate, database, external API.
- `RawCodeEdge`: contains/imports/calls/data flow/handles/reads/writes/requests.
- Every node and edge has `evidence[]`, which includes a relative source path,
  lines, method, detail, and confidence.

### Logic Graph

`LogicGraph` is the compressed Viewer protocol:

- `LogicNode.rawNodeIds` is the bridge back to raw details.
- `LogicNode.sources`, `confidence`, and `inference` are mandatory trust UI.
- `LogicEdge.rawEdgeIds` preserves factual provenance.
- `FeatureScenario` describes one product/API capability.
- `FeaturePathVariant` contains `nodeIds`, `edgeIds`, and ordered `steps`.
- `ChainDiagnostic` is an inspectable static problem, not a runtime exception.

Do not put code parsing or LLM decisions in React. Add an adapter/compiler rule
first, write graph-level tests, then decide how the Viewer should display it.

## 5. Viewer interaction architecture

`apps/viewer/src/App.tsx` is deliberately the orchestration layer. Keep pure
logic outside it where possible.

### Global layout and local expansion

The global logic nodes are laid out with ELK in `layout.ts`. Their IDs are stable
enough for the Viewer to save positions in localStorage under:

```text
agent-runtime-map.layout.v1:<project-root>:<graph-type>
```

Never call ELK merely because a node expanded, a branch changed, playback
advanced, or a step was focused. Focus hides what falls outside it and reframes the
camera; it never moves a node, because a narrowing that rearranged the map would
cost the spatial memory it exists to serve. Hide rather than remove: taking nodes
out of the flow drops React Flow's measurement of them, and the camera then has no
bounds to frame. `buildCodeDetailExpansion()` builds a small raw-node subgraph near the
selected parent using namespaced IDs:

```text
detail:<logic-node-id>:<raw-node-id>
```

It includes direct raw IDs first, then one-hop raw neighbors, capped at nine
nodes. This protects map readability and React Flow performance.

Only **outgoing** raw edges count as internals, and files and entrypoints never do.
Following edges in both directions answers "what is this made of" with the file that
contains the step and the route that calls it, listed beside its real internals as
though they were peers.

A reader can open one further level from a child they chose, capped by
`MAX_DETAIL_DEPTH`. Never lift that cap: an unbounded drill-down redraws the whole
call graph under a single node, which is the readability the Logic Compiler exists
to protect. Reaching further is the breadcrumb's job, not a larger expansion's.

Detail nodes are deliberately outside the Viewer's `nodes` state, so `onNodesChange`
discards React Flow's measurement changes for them. They must therefore carry
explicit `width`/`height` from the visual package; without those React Flow keeps
them at `visibility: hidden` and the whole drill-down silently disappears.

### Playback and camera

`simulation.ts` turns `(feature, variant, stepIndex)` into a `SimulationFrame`.
All visual state derives from that frame. `BlueprintPlaybackEdge` receives only
`data.showToken` for the current edge. It does not own timers or path selection.

Camera following uses `setCenter()` only while `cameraFollow` is true. Any real
canvas move event disables following. Do not force the camera back after user
input; the user explicitly owns the map until they choose Resume follow or start
playback/step again.

### Branch transitions

`compareVariants()` categorizes the old and new path into shared, entering, and
exiting nodes/edges. Shared elements hold their position and visual weight;
only branch-specific pieces crossfade for 420 ms. If you add a new transition,
preserve this rule—do not flash or re-layout the common trunk.

### Source drawer and local-server security

The Viewer asks for:

```text
/source.json?file=<relative path>&start=<line>&end=<line>
```

`packages/cli/src/server.ts` permits it only when all conditions hold:

1. The CLI supplied the analyzed project root.
2. The requested relative path is in the allow-list derived from Logic Graph
   sources.
3. Resolution remains contained below the project root.
4. The target is a regular file under 1.5 MB.
5. Returned lines are bounded (highlight plus small context, maximum 160).

Maintain this allow-list. Never expose a generic local-file endpoint and never
send source content to a remote service by default.

## 6. Internationalization

Viewer language is automatic from `?locale=`, then localStorage, then browser
locale. Chinese is `zh-CN`; all other users get English. Keep new interaction
labels in both `EN` and `ZH` inside `apps/viewer/src/i18n.ts`. Code symbols,
paths, and raw IDs remain unchanged, since translating identifiers would weaken
evidence.

CLI strings live separately in `packages/cli/src/i18n.ts`.

## 7. How to develop safely

`npm run typecheck` covers the workspace **and** the Viewer, which are separate
projects: the Viewer needs DOM libraries and bundler resolution the Node-targeted
root config does not use. Keep both in that script — the Viewer sat unchecked for a
long time, and two crashes shipped out of that blind spot.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run release:check
```

Manual end-to-end fixture:

```bash
npm run agent-runtime-map -- examples/simple-agent --no-open --port 4180
```

Then inspect these acceptance cases:

- Choose **Content Generation**; it should frame the route at logic detail.
- Double-click **Execute Content**; compact factual raw nodes should appear.
- Open one of those children with its chevron control; a bounded second level
  should appear as dashed nodes that carry no control of their own.
- Click a raw child; the drawer should show that child's own source range and a
  breadcrumb back to **Execute Content**.
- Click it; the drawer should show a highlighted code range from
  `app/src/workflows/content.ts`.
- Search **Generate Ideas**, press Enter; camera should fly to and spotlight it.
- Drag a node; pinned count rises and Undo becomes available. Reload and confirm
  the position persists. Reset restores the ELK position.
- Play past the first step; the current edge gets exactly one moving token.
- Pan the map while following; the control changes to Resume follow.
- Choose **Publishing** and play the route; it eventually stops at the known
  red Chain Doctor diagnostic.
- Verify browser console has no errors and test with reduced motion enabled.

## 8. Test ownership

Existing tests cover analyzer/compiler/schema behavior plus Viewer pure helpers:

- `tests/interaction-model.test.ts`: raw-detail expansion, variant comparison,
  layout persistence parsing.
- `tests/blueprint.test.ts`: semantic zoom, group frames, edge state palette.
- `tests/server.test.ts`: Viewer server headers, graph serving, traversal block,
  source endpoint allow-list and containment.

When adding a feature, use pure helper tests where possible. Add a server test
for every new local endpoint or security condition. Browser QA should validate
the visual behavior that unit tests cannot see.

## 8b. Continuous map (the product's main line since 0.7.0)

Direction set by the user in August 2026: the product is **installed into a
project and keeps its map current**; Skill/MCP remain as optional agent
integrations, deliberately last in the README.

- `agent-runtime-map init` writes/completes `agent-runtime-map.config.json`
  (`outDir`, `watch.include/exclude/debounceMs`, `history.limit`); it suggests
  package.json scripts but never edits anything else.
- `build`/`watch` maintain `.agent-runtime-map/current/` (graph, raw-graph,
  manifest, status, changes, report.html + assets) and `history/<timestamp>/`.
  Everything lives in `packages/core/src/continuous.ts`; the CLI wrapper is
  `packages/cli/src/continuous.ts`.
- Invariants (tested in `tests/continuous.test.ts`, browser-verified live):
  staging → validate → atomic promote; a failed analysis only rewrites
  `status.json` (state `failed`, reason, `lastSuccessAt`) and never touches the
  last good map; the watcher ignores the output directory, dot-directories, and
  build machinery, debounces ~800ms, and full-re-analyzes (correctness over
  incrementality — v1 decision); identical builds refresh status without
  churning current/ or history/.
- The Viewer polls `manifest.json` (2s) and reloads on a buildId change;
  `report.html` embeds the graph (`window.__ARM_GRAPH__`), boots the full
  Viewer over HTTP, and degrades to an inline static summary on `file://`.
- Embedding reference: `examples/nextjs-embed` (allow-list API route + polling
  `<LogicMap />` panel), `examples/report-embed` (static hosting / iframe).
- Still open: incremental analysis (only if it can be proven equivalent),
  serving `report.html` from the CLI server (CSP forbids its inline script
  there — deliberate), surfacing stale/failed state inside the Viewer chrome,
  and a `changes.json` timeline view over `history/`.

## 8c. GitHub Continuous Map (0.8.0)

The main line extends to GitHub: set up once, and pushes/PRs keep the map
current with no local watcher.

- `init --github` additionally generates `.github/workflows/agent-runtime-map.yml`.
  The file carries an integrity hash line (`packages/core/src/github.ts`): an
  unmodified generated file — any template version — is updated freely; a
  user-edited one is never silently overwritten (`WorkflowModifiedError`,
  `--force` → outcome `overwritten` with honest wording).
- The root `action.yml` is a composite action over ONLY official `actions/*`
  steps: cache-restore the previous `current/` (the baseline), npm-install the
  release CLI tarball (`cli-version` input; `cli-tarball` override for CI/
  air-gapped), run `build`, verify the artifact (`action/verify-artifact.mjs`
  allow-list gate), write the Step Summary (`action/summary.mjs`), upload the
  artifact (even on failure — it then holds the last good map + failed status),
  cache-save on success, fail the job at the end if analysis failed.
- CI provenance flows through env vars (`AGENT_RUNTIME_MAP_COMMIT_SHA`/`REF`/
  `BASELINE_RESTORED`/`TRIGGER` → `continuousEnvOptions()` in the CLI); the
  baseline SHA is never an input — it is read from the restored manifest
  (`manifest.commit.baselineSha`). No baseline → changes.json says `initial`.
- Versioning contract: users reference `@v1`; v1 = compatible changes only,
  breaking → v2; exact tool version recorded in manifest + status. The `v1`
  tag is NOT yet published — the user wants to confirm before it moves.
- Privacy defaults: private artifact + Step Summary only; `publish: pages` is
  an explicit opt-in with a loud warning. `contents: read` only; never commits.
- Real-action proof lives in `.github/workflows/action-e2e.yml`: job 1 packs
  the CLI, job 2 runs the action with no baseline (asserts `initial`), job 3
  restores job 2's cache, edits the fixture, and asserts a non-initial diff
  with both SHAs recorded — plus asserts nothing was committed.

## 8d. npm Trusted Publishing (post-0.8.0)

0.8.0 was published to npm manually by the user (granular token, since
revoked). From then on, releases publish through OIDC Trusted Publishing:

- `.github/workflows/npm-publish.yml` — triggers ONLY on `vX.Y.Z` tags or
  manual dispatch; permissions `contents: read` + `id-token: write`; runs
  `release:check` before publishing; no token exists anywhere (test-enforced).
- `scripts/publish-plan.mjs` (pure, tested) + `scripts/publish-npm.mjs`
  (executor): three packages, one version, order react → mcp → cli;
  registry-existing versions are skipped so re-runs are idempotent; a tag that
  mismatches the package version is refused; after each publish the registry
  is read back before continuing.
- npm-side Trusted Publisher config (per package): org `TheCrazyAnt`, repo
  `agent-runtime-map`, workflow `npm-publish.yml`, environment empty.
- Version bumps must touch: root + three package.json, VERSION consts in
  cli.ts and mcp/server.ts, action.yml default cli-version. Full procedure
  and failure recovery: docs/RELEASING.md (bilingual).
- READMEs now lead with `npm install --save-dev agent-runtime-map`; GitHub
  Release tarballs remain the registry-less fallback.

## 8e. Map Accuracy Benchmark v1 (post-0.8.0)

`benchmarks/projects/*` + `expected.json` are hand-confirmed golden answers;
`tests/benchmark.test.ts` gates them, `scripts/benchmark-report.mjs` prints
them. Never judge quality by node-type variety — checkout-flow is a negative
control that fails if any AI construct is invented.

Resolver gains shipped with it (all deterministic, all regression-tested in
`tests/resolver-precision.test.ts`):
- Registry `set("k", v)` / `get("k")` resolves across files (import-alias hop
  in `variableDeclarationOf`); dynamic keys emit `CALL_UNRESOLVED_DYNAMIC`
  (schema: `Diagnostic.metadata` carries reason/method/confidence) and never
  an edge.
- Literal object-member dispatch (`agents["writer"].run()`) resolves; computed
  member access on a known container diagnoses instead of guessing.
- Factory instances (`plannerAgent = makeAgent(...)`) become nodes when their
  name classifies confidently; their construction call is NOT a flow edge
  (suppressed only for calls evaluated during initialization — calls inside
  member function bodies still count).
- Named object-literal containers (`kbSearchTool = {...}`) register as one
  construct when classification confidence ≥ 0.65; the weak business-verb
  fallback keeps exposing members (`routeHandlers.createDraft`).
- classifyDeclaration: human-approval names now outrank workflow/agent
  *directory* conventions (still below name suffixes).
- Template-literal URL heads name their external host; `*Index/*Store/*Db`
  receivers with DB operations register as data stores.
- logic-compiler: functions with flow edges into agent/workflow/tool/gate/model
  are orchestration steps and survive compression (library projects get their
  task entries back); documented-capability labels are only borrowed when
  entry terms match or score ≥ 3.

The benchmark is an exact-topology allowlist since the second review round:
business nodes/edges not in the hand-confirmed answer are FPs that fail CI,
feature routes are checked in order per variant with control kinds, and every
logic node/edge must chain to raw evidence with file:line. A real-repository
verification (anthropics/anthropic-quickstarts customer-support-agent @
3313e9716fb5, MIT) is recorded in benchmarks/REAL_WORLD.md and reproduced
offline as the rag-chat sample; it drove four more deterministic fixes: AWS
SDK client.send service naming (works uninstalled — alias symbol yields an
EMPTY declarations array, not undefined), nested in-handler prompt constants
(nested declarations participate in prompt detection only), runtime-selected
model call sites kept as model nodes, and compression retention widened to
functions flowing into external_api/database/route. Unresolved-diagnostic
dedupe is per-analysis (concurrency-safe, tested), and DB_RECEIVER requires a
camelCase suffix boundary (restore/reindex negative-tested).

simple-agent's graph is byte-identical before/after — verified against the
released 0.8.0 CLI. Known still-unresolved (by design or deferred): runtime
member dispatch (diagnosed), wrapper functions returning registry lookups
(`anyTool`), nested UI handlers (`submitCheckout` inside a component), factory
functions named like agents (`makeAgent` classifies as agent).

## 8f. Bilingual business semantics (post-0.8.0)

Naming is a **compile-time pass**, not a render-time translation: only the
compiler has the evidence (project documents, config, the identifier, the node's
place in the graph), so only the compiler can produce a name that carries its own
provenance. The Viewer became a selector with no way left to guess.

- `packages/analysis-kit/src/vocabulary.ts` — generic software/business
  vocabulary, never one project's jargon. A token it does not know is kept
  verbatim and reported.
- `packages/logic-compiler/src/localization.ts` — per-locale derivation, in
  priority order: config override → documented capability (only when the
  document's words cover the WHOLE identifier) → route/vendor kept verbatim →
  identifier read through the vocabulary. Chinese requires every token to
  resolve; a partial reading is `pending`, never half-translated.
- `packages/logic-compiler/src/featureNames.ts` — feature names composed from
  entry + main step + result, deduplicated minimally, each locale picking the
  first step it can actually name. `FeatureScenario.label` is NOT touched: it is
  hashed into `feature.id`.
- Schema: `SemanticLabel` on node/edge/variant/feature, all OPTIONAL, so an old
  `graph.json` still renders through the Viewer's legacy path.
- `agent-runtime-map.config.json` gains `terms` (one token → its reading) and
  `nodes` (whole-name overrides). Both outrank every derivation.
- Viewer: `resolveNodeText`/`resolveFeatureText`/`resolveEdgeText`; a
  business/technical canvas toggle; the detail drawer shows both. `locale` and
  `viewMode` are deliberately NOT layout dependencies — text must never move a
  node. Verified in-browser: 28 nodes, 28 edges, byte-identical positions across
  both views.
- `--localize false` / `CompileOptions.localize: false` emits exactly the old
  graph.

Known and deliberate: a Chinese name is withheld when any token is unknown
(`kbSearchTool` without a `kb` term), a person's prose is never machine
translated between languages, and routes/vendor ids stay verbatim.

## 9. High-value next work

Work in this order unless product direction changes:

1. **More precise TS analysis.** Accuracy is more valuable than adding
   decorative Viewer features. Aliases, barrel re-exports, namespace imports,
   destructured bindings, callbacks, step arrays, object-literal handler members,
   default-exported arrows, and factory results now resolve; see
   `tests/analyzer.test.ts`. Still open: class instances stored on other objects,
   callables reached only through a generic registry, and per-framework call
   conventions.
2. **First-class framework adapters.** Express/Hono routers, mount prefixes,
   chained and inline registration, LangGraph inline graph nodes with `START`/
   `END` constants, and the shared model/prompt/tools options object of the
   Vercel AI SDK, OpenAI SDK, and Anthropic SDK are covered. Still open: NestJS
   decorators, Next.js server actions and `middleware.ts`, CrewAI task/crew
   wiring, and Mastra registries. Add each only with a clear factual evidence
   model.
3. **Product-logic confidence UX.** Done: `LogicNode.product` and
   `FeatureScenario.product` carry the matched capability, its origin
   (readme/prd/docs/prompt/config/user), the documented terms, and the strength
   of the link; the evidence drawer shows it apart from source evidence in both
   languages, and says so when a step is code-only. `--description` is a labelled
   user claim. Still open: editing a capability from inside the Viewer, and
   showing which *feature label* was borrowed rather than derived.
4. **Source drill-down refinement.** Done: selecting a raw child opens its own
   source range and evidence with a breadcrumb back to the step, and a child can
   be opened exactly one further level through an explicit control on the node.
   `MAX_DETAIL_DEPTH` is 2 and the deepest level carries no control. Still open:
   remembering a drill-down across feature switches.
5. **Embedded package API.** `<LogicMap />` and the `<logic-map>` custom element
   ship from `@agent-runtime-map/react`, both taking an already compiled
   `LogicGraph`. The simulation reducer, ELK layout, and group derivation moved
   into that package so the Viewer and an embedded map share one implementation.
   The rendering path is browser-verified: both surfaces draw 26 nodes and 28
   edges, and a framed route marks nodes and edges alike. That pass found a real
   bug — node highlighting never applied — which pure helper tests could not
   catch, because it was an effect-ordering fault rather than a logic fault.
   Still open: a DOM render test so that class of bug has a guard (needs a jsdom
   environment, which the suite does not have yet), host-driven raw drill-down,
   and the Viewer itself consuming `<LogicMap />` rather than composing React Flow
   directly.
6. **Trace bridge, not an APM platform.** `TraceEvent` and `applyTraceEvents()`
   ship: events name ids the graph already has, raw symbols lift to the step that
   contains them, unmatched events are reported rather than drawn, and a failure is
   sticky. Observed styling is deliberately unlike the static route palette. Keep
   it this way — the moment spans can introduce topology, the graph stops being
   traceable to source. Still open: ingesting a trace from the CLI, and an
   OpenTelemetry span adapter that maps onto these same ids.
7. **Python support.** Done: `adapters/python` shells out to a bundled extractor
   that parses with Python's own `ast` and returns structural facts only; the
   TypeScript side does all classification, using the rules in
   `packages/analysis-kit` that the TypeScript adapter also reads. Decorators,
   dunders, and `self` stop at the adapter boundary — a test asserts they never
   reach the protocol. Still open: cross-module call resolution (calls resolve by
   name within the analyzed set, not through import graphs), class-method
   attribution, LangGraph/CrewAI Python conventions, and Django URL configs.

## 10. Explicit non-goals for the current line

- No Datadog/Sentry replacement, full tracing, token accounting, or performance
  analytics.
- No claim to support every repository or dynamic runtime behavior.
- No automatic LLM code upload or hidden semantic requests.
- No direct execution of scanned projects.
- No source API that can read arbitrary local paths.
- No UX that visualizes every function by default; the Logic Compiler must
  continue to compress to a human-scale graph.

## 11. Release checklist

1. Keep a feature branch under `codex/`.
2. Run `npm run release:check`.
3. Build the Viewer before building the CLI: the CLI package copies Viewer
   assets into its distributable folder.
4. Run the example manually and browser-test the acceptance list above.
5. Bump the root, CLI, and React package versions together for a user-visible
   release; update direct GitHub Release install URLs in both READMEs.
6. Open a PR, wait for Node 20 and Node 22 checks, merge only after green.
7. Create a GitHub Release with packed CLI and React tarballs, then install the
   CLI tarball into a clean temporary project and run `npx agent-runtime-map .`.

The goal for every future PR is simple: increase a new user’s confidence that
the graph represents real code, while keeping the visual map calm enough to be
understood in one glance.
