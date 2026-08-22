# Agent Runtime Map

[简体中文](README.zh-CN.md) · English

Turn your Agent codebase into an evidence-backed circuit map you can inspect step by step.

Agent Runtime Map reads a TypeScript or JavaScript repository together with its README, selected docs/PRD files, prompts, package metadata, and safe configuration. It extracts routes, calls, workflows, agents, tools, models, database operations, external services, and control flow, then compiles them into one global execution graph. A feature list on the left lets you play, pause, step through, replay, and switch between the inferred routes for each Agent capability.

> Status: **0.1 alpha**. The supported scope is intentionally narrow and documented below. Agent Runtime Map does not claim to understand every codebase.

## What it produces

```text
Existing codebase
      ↓
Project Reader + TypeScript AST + framework conventions
      ↓
Docs / prompts / dependencies + code facts
      ↓
Raw Code Graph (code facts)
      ↓
Logic Compiler (feature understanding + compression)
      ↓ optional, explicit opt-in
Evidence-constrained semantic enrichment
      ↓
Logic Graph (human-scale flow)
      ↓
ELK layout + React Flow viewer
```

Every visible node includes source files, line numbers, an inference explanation, and a confidence score. Code remains the source of truth; uncertain conclusions are marked instead of silently presented as facts.

## Project understanding

The Project Reader safely gathers high-signal context before compilation:

- `package.json`, framework dependencies, scripts, and package manager;
- README, selected files under `docs/`, PRD documents, and prompt directories;
- inline prompt/instructions constants and Agent SDK configuration;
- optional `agent-runtime-map.config.json` product descriptions and feature hints.

Sensitive files such as `.env`, credentials, private keys, build output,
`node_modules`, and VCS metadata are never read as semantic context. The analyzer
does not execute the inspected project or its configuration.

The TypeScript adapter distinguishes Agents, workflows, tools, models, prompts,
human approval gates, data, and external systems. It records sequential,
conditional, parallel, loop, retry, fallback, and human-approval relationships.
OpenAI Agents SDK-style definitions and LangGraph-style declarative topology have
dedicated detection in addition to general TypeScript call analysis.

## Feature circuit inspector

- **One global Agent graph:** shared workflows, agents, tools, databases, and external APIs remain visible in a single circuit diagram.
- **One route per feature:** select a capability such as Generate, Review, or Import to isolate the nodes and edges that implement it.
- **Static simulation:** play, pause, advance one step, replay, choose a branch, and change playback speed. This simulates the code-backed execution model; it does not pretend that a live request is running.
- **Chain Doctor:** verified steps turn green, uncertain inference turns yellow, and deterministic problems turn red and stop the inspection at the failing step.
- **Evidence-first diagnostics:** errors retain source files, lines, confidence, cause, and a suggested repair.
- **Chinese and English:** the CLI and Viewer follow the operating-system/browser locale automatically and include explicit overrides.

## Blueprint viewer and reusable components

The Viewer uses an open engineering-blueprint visual system: a fine grid canvas,
icon-first nodes, labeled solid/dashed system boundaries, blue orthogonal main
flows, and dashed auxiliary data links. Playback is part of the same visual
language: the current step scans blue, verified steps turn green, uncertain
steps turn amber, and a deterministic failure turns the affected circuit red.

The visual primitives live in the separate open-source
[`@agent-runtime-map/react`](packages/react/README.md) workspace package instead
of being locked inside the Viewer. It exports React Flow node components, group
frames, edge-state tokens, and boundary measurement helpers for embedding the
same map in another product. See [Visual Components](docs/VISUAL_COMPONENTS.md)
for the component contract and integration example.

## Try it

From this repository:

```bash
npm ci
npm run build
node packages/cli/dist/cli.js examples/simple-agent --no-open
```

Open the URL printed by the command. Press `Ctrl+C` to stop the local server.

The bundled example contains four feature circuits: content generation, draft review with multiple branches, knowledge import, and one intentionally incomplete publish route that demonstrates a red Chain Doctor failure.

After the first npm release, another project will be able to run:

```bash
npx agent-runtime-map@latest .
```

The same CLI can be installed directly from the CI-validated GitHub Release
artifact without cloning the monorepo:

```bash
npm install --save-dev https://github.com/tangyishun9846/agent-runtime-map/releases/download/v0.1.0/agent-runtime-map-0.1.0.tgz
npx agent-runtime-map .
```

Or install it as a development dependency:

```bash
npm install --save-dev agent-runtime-map
npx agent-runtime-map .
```

## CLI

```text
agent-runtime-map [project] [options]          Analyze and open the interactive viewer
agent-runtime-map serve [project] [options]    Analyze and open the interactive viewer
agent-runtime-map analyze [project] [options]  Generate JSON and exit
```

The shorter `logic-map` command remains available as a compatibility alias.

Common options:

```text
--max-files <number>     Source-file analysis limit (default: 2000)
--max-context-files <number> Project-document limit (default: 80)
--max-context-bytes <number> Project-context byte limit (default: 750000)
--no-context             Skip README/docs/PRD/prompt reading
--max-nodes <number>     Compiled logic-node limit (default: 40)
--graph-type <type>      runtime_logic or product_logic
--description <text>     Optional product context
--locale <locale>        auto, zh-CN, or en (default: auto)
--port <number>          Local viewer port (default: 4173)
--host <host>            Local viewer host (default: 127.0.0.1)
--no-open                Do not open a browser automatically
--no-raw                 Do not write the detailed Raw Code Graph
--semantic openai        Explicitly enable optional LLM semantic compression
--semantic-model <name>  Required model name for semantic mode
```

Generated artifacts are stored under `.logic-map/`:

- `graph.json` is the viewer-facing Logic Graph.
- `raw-graph.json` contains detailed code facts and relationships.

## Language

Agent Runtime Map follows the user's environment automatically: Chinese systems
and browsers use Chinese, while other locales use English. Use `--locale zh-CN`
or `--locale en` to override detection. The Viewer also includes a language
switch. Source symbols and file evidence always retain their original spelling.

## Current support

- TypeScript, TSX, JavaScript, and JSX
- `tsconfig.json` and `jsconfig.json` path aliases
- Next.js App Router route handlers
- Express/Hono-style route registration
- Functions, methods, imports, statically resolvable calls, and result data flow
- README/docs/PRD/prompt ingestion and documented feature matching
- Agent, workflow, tool, model, prompt, human-gate, action, and service conventions
- OpenAI Agents SDK-style configuration and LangGraph-style declarative graphs
- Conditional, parallel, loop, bounded/unbounded retry, fallback, and human-approval edges
- Common Prisma-like database operations
- Literal Fetch/Axios external URLs and selected SDK calls
- Global Agent circuit with per-feature route selection and branch variants
- Static chain simulation with play, pause, step, replay, and speed controls
- Chain Doctor diagnostics with healthy, warning, and error states
- Local interactive viewer with ELK layout, search, minimap, confidence, and source evidence

Known limits:

- Dynamic dispatch and runtime-only dependency injection may be omitted.
- Product logic mode combines deterministic code analysis with available project documents, prompts, and explicit configuration, but dynamic runtime-only behavior may still be omitted.
- Optional LLM enrichment is label/description-only: it cannot create nodes, edges, files, or evidence. It requires explicit CLI opt-in, an explicit model, and `OPENAI_API_KEY`.
- Python and actual runtime tracing are not part of 0.1. The current playback is an explicit simulation of the statically inferred chain.

## Privacy and network behavior

Analysis runs locally by default. Agent Runtime Map does not upload source code, invoke an LLM, or add telemetry unless `--semantic openai` is explicitly enabled. Semantic mode sends a bounded evidence snapshot—not the absolute project root or raw source files—uses Structured Outputs, requests `store: false`, and only accepts patches for IDs already present in the deterministic graph. The viewer binds to `127.0.0.1` by default. If you deliberately use `--host 0.0.0.0`, graph data and source paths become reachable from your network.

See [Project Context and Semantic Analysis](docs/PROJECT_CONTEXT.md) before enabling any network-backed semantic provider.

## Repository layout

```text
apps/viewer                 React Flow + ELK interactive viewer
packages/react              Reusable blueprint React Flow components and styles
packages/schema             Raw Code Graph and Logic Graph protocol
packages/project-reader     Safe README/docs/PRD/prompt and manifest reader
adapters/typescript         TypeScript/JavaScript static analyzer
packages/logic-compiler     Human-scale graph compiler
packages/semantic           Optional evidence-constrained semantic enrichment
packages/core               Analysis and output orchestration
packages/cli                Public, bundled agent-runtime-map npm package
examples/simple-agent       End-to-end example project
tests                       Analyzer and viewer-server tests
```

More detail is available in [Architecture](docs/ARCHITECTURE.md), [Graph Schema](docs/GRAPH_SCHEMA.md), [Project Context](docs/PROJECT_CONTEXT.md), [Visual Components](docs/VISUAL_COMPONENTS.md), the [Roadmap](docs/ROADMAP.md), and [Third-Party Notices](THIRD_PARTY_NOTICES.md).

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run release:check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing analyzers or semantic rules. New inference rules must include evidence and confidence behavior.

## License

MIT © Agent Runtime Map contributors.
