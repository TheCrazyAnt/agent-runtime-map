# Agent Runtime Map

Turn every Agent feature into an evidence-backed execution circuit you can inspect step by step.

```bash
npx agent-runtime-map@latest .
```

GitHub Release fallback:

```bash
npm install --save-dev https://github.com/tangyishun9846/agent-runtime-map/releases/download/v0.1.1/agent-runtime-map-0.1.1.tgz
npx agent-runtime-map .
```

The command analyzes the selected project, writes `.logic-map/graph.json`, starts a local viewer, and opens it in the browser. Choose a feature from the left to play, pause, single-step, replay, or switch between its inferred branches on one global Agent graph. Chain Doctor marks verified steps green, uncertainty yellow, and deterministic failures red with source evidence and a suggested repair.

Playback is an explicit simulation of the statically compiled code route; it does not claim that a live request is executing.

Analysis is local by default. The Project Reader safely uses README/docs/PRD,
prompts, package metadata, and `agent-runtime-map.config.json` together with
TypeScript/JavaScript AST evidence. It excludes environment files, credentials,
private keys, dependencies, build output, and VCS metadata, and never executes
the inspected project.

Optional semantic enrichment is explicit:

```bash
OPENAI_API_KEY="..." npx agent-runtime-map . \
  --semantic openai \
  --semantic-model <model>
```

This mode sends a bounded evidence snapshot, not the absolute project root or
raw source files. It can improve names and descriptions for existing graph IDs,
but it cannot add topology or evidence.

Use `agent-runtime-map analyze .` to generate JSON without starting a server. The original `logic-map` command remains available as an alias. See the [project repository](https://github.com/tangyishun9846/agent-runtime-map) for supported frameworks, context limits, privacy behavior, and contribution guidelines.

The CLI and Viewer automatically use Chinese for Chinese locales and English for other locales. Pass `--locale zh-CN` or `--locale en` to override detection.
