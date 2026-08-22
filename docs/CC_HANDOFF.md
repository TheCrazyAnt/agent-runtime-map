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
7. Click a logic node or a search result to open its source-evidence drawer.
8. Search by localized label, original label, description, or source path. A
   result gets a temporary spotlight and the camera flies to it.
9. Drag a logic node. That position is stored locally for the project, marked
   as pinned, and can be undone or reset to the ELK layout.
10. Let playback follow the current step, or pan/zoom the canvas to immediately
    turn following off; the left rail offers “Resume follow”.

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
  src/layout.ts               ELK global layout, called once per graph
  src/simulation.ts           Pure static playback-frame reducer
  src/blueprintGroups.ts      Group boundary derivation
  src/i18n.ts                 English/Chinese Viewer strings + localization
  src/styles.css              Viewer layout and interaction styling

packages/react/
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
packages/logic-compiler/      Raw graph compression, features, Chain Doctor
packages/semantic/            Optional evidence-constrained label enrichment
packages/core/                Orchestrates reader → analyzer → compiler
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

Never call ELK merely because a node expanded, a branch changed, or playback
advanced. `buildCodeDetailExpansion()` builds a small raw-node subgraph near the
selected parent using namespaced IDs:

```text
detail:<logic-node-id>:<raw-node-id>
```

It includes direct raw IDs first, then one-hop raw neighbors, capped at nine
nodes. This protects map readability and React Flow performance.

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

## 9. High-value next work

Work in this order unless product direction changes:

1. **More precise TS analysis.** Improve symbol resolution across aliases,
   callbacks, factories, and common Agent frameworks. Accuracy is more valuable
   than adding decorative Viewer features.
2. **First-class framework adapters.** Deepen Next.js/Express/Hono conventions,
   then add LangGraph/OpenAI Agents SDK/CrewAI-compatible adapters only with
   clear factual evidence models.
3. **Product-logic confidence UX.** Show which product conclusions came from
   docs/prompts versus source. Add user-provided product description as an
   explicit, labeled evidence input.
4. **Source drill-down refinement.** Let a user choose a raw child and keep its
   source range selected in the drawer. Avoid unlimited recursive expansion;
   use a breadcrumb or bounded second level instead.
5. **Embedded package API.** Package a documented `<LogicMap />` React component
   and then a Web Component wrapper. The embedding API should accept already
   computed `LogicGraph`/`RawCodeGraph`, never need direct repository access.
6. **Trace bridge, not an APM platform.** Add an optional event protocol that can
   light up existing stable graph IDs. Do not replace static facts with opaque
   runtime spans; map trace events onto the same evidence-backed nodes.
7. **Python support.** Add a separate adapter producing the same Raw Code Graph
   schema. Do not leak Python-specific structures into the Viewer protocol.

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
