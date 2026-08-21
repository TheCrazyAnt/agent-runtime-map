# Logic Map

Turn your codebase into an evidence-backed logic map.

Logic Map reads a TypeScript or JavaScript repository, extracts routes, calls, agents, tools, database operations, and external services, then compresses those code facts into a smaller interactive graph that explains how the system runs.

> Status: **0.1 alpha**. The supported scope is intentionally narrow and documented below. Logic Map does not claim to understand every codebase.

## What it produces

```text
Existing codebase
      ↓
TypeScript AST + framework conventions
      ↓
Raw Code Graph (code facts)
      ↓
Logic Compiler (selection + compression)
      ↓
Logic Graph (human-scale flow)
      ↓
ELK layout + React Flow viewer
```

Every visible node includes source files, line numbers, an inference explanation, and a confidence score. Code remains the source of truth; uncertain conclusions are marked instead of silently presented as facts.

## Try it

From this repository:

```bash
npm ci
npm run build
node packages/cli/dist/cli.js examples/simple-agent --no-open
```

Open the URL printed by the command. Press `Ctrl+C` to stop the local server.

After the first npm release, another project will be able to run:

```bash
npx logic-map@latest .
```

Or install it as a development dependency:

```bash
npm install --save-dev logic-map
npx logic-map .
```

## CLI

```text
logic-map [project] [options]          Analyze and open the interactive viewer
logic-map serve [project] [options]    Analyze and open the interactive viewer
logic-map analyze [project] [options]  Generate JSON and exit
```

Common options:

```text
--max-files <number>     Source-file analysis limit (default: 2000)
--max-nodes <number>     Compiled logic-node limit (default: 20)
--graph-type <type>      runtime_logic or product_logic
--description <text>     Optional product context
--port <number>          Local viewer port (default: 4173)
--host <host>            Local viewer host (default: 127.0.0.1)
--no-open                Do not open a browser automatically
--no-raw                 Do not write the detailed Raw Code Graph
```

Generated artifacts are stored under `.logic-map/`:

- `graph.json` is the viewer-facing Logic Graph.
- `raw-graph.json` contains detailed code facts and relationships.

## Current support

- TypeScript, TSX, JavaScript, and JSX
- `tsconfig.json` and `jsconfig.json` path aliases
- Next.js App Router route handlers
- Express/Hono-style route registration
- Functions, methods, imports, statically resolvable calls, and result data flow
- Agent, workflow, tool, action, and service conventions
- Common Prisma-like database operations
- Literal Fetch/Axios external URLs and selected SDK calls
- Local interactive viewer with ELK layout, search, minimap, confidence, and source evidence

Known limits:

- Dynamic dispatch and runtime-only dependency injection may be omitted.
- Product logic mode is experimental and currently uses code structure plus optional user context. README/docs/PRD semantic ingestion is not implemented yet.
- The semantic labels are deterministic heuristics in 0.1. An optional LLM compiler pass is planned, but no source code currently leaves the machine.
- Python and runtime tracing are not part of 0.1.

## Privacy and network behavior

Analysis runs locally. Logic Map does not upload source code, invoke an LLM, or add telemetry. The viewer binds to `127.0.0.1` by default. If you deliberately use `--host 0.0.0.0`, graph data and source paths become reachable from your network.

## Repository layout

```text
apps/viewer                 React Flow + ELK interactive viewer
packages/schema             Raw Code Graph and Logic Graph protocol
adapters/typescript         TypeScript/JavaScript static analyzer
packages/logic-compiler     Human-scale graph compiler
packages/core               Analysis and output orchestration
packages/cli                Public, bundled logic-map npm package
examples/simple-agent       End-to-end example project
tests                       Analyzer and viewer-server tests
```

More detail is available in [Architecture](docs/ARCHITECTURE.md), [Graph Schema](docs/GRAPH_SCHEMA.md), the [Roadmap](docs/ROADMAP.md), and [Third-Party Notices](THIRD_PARTY_NOTICES.md).

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

MIT © Logic Map contributors.
