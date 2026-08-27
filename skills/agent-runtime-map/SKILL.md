---
name: agent-runtime-map
description: Read a TypeScript, JavaScript, or Python repository as an evidence-backed runtime map instead of file by file. Deterministic AST analysis extracts routes, agents, workflows, tools, models, data stores, and external services, compiles them into feature circuits, and keeps a source location and confidence score behind every node and edge — the analyzer builds the topology, so the map cannot contain a connection the code does not have. Use when the user asks how an agent codebase works, which features a repository implements, what a route or workflow actually calls, where a chain is broken or unverified, or for an interactive architecture map grounded in real code rather than authored from a description.
license: MIT
metadata:
  version: "0.8"
  author: tangyishun9846
---

# Agent Runtime Map

Analyze a repository with a deterministic CLI, then answer from the generated
graph. You never author the topology: the analyzer extracts it from the code,
and every claim you make must trace to a node or edge in its output.

## When this skill applies

- "How does this repository / this agent work?"
- "What features does this codebase implement, and through which steps?"
- "What does this route or workflow actually call?"
- "Is anything broken or unverified in this chain?"
- "Show me an architecture map of this project" — when it must reflect real code.

If the user wants a diagram authored from a plain-language description with no
codebase behind it, this skill does not apply: it only maps code that exists.

## 1. Analyze

Run the analyzer from the CI-validated release artifact. It parses source with
compiler-grade tooling (ts-morph for TypeScript/JavaScript, Python's own `ast`
for Python), never executes the analyzed project, and never uploads source.

```bash
npx --yes https://github.com/tangyishun9846/agent-runtime-map/releases/download/v0.8.0/agent-runtime-map-0.8.0.tgz analyze <project-path> -o /tmp/arm-graph.json --no-raw
```

Use an absolute `<project-path>`. Writing the graph to a temporary path keeps
the analyzed repository untouched; drop `-o` to store it in the project under
`.logic-map/graph.json` instead. If the command is already installed
(`agent-runtime-map --version` works), call it directly.

## 2. Read the graph

The output is one JSON document. The parts that answer questions:

- `features[]` — one entry per detected capability. Each has `label`,
  `description`, `health`, `diagnostics[]`, and `variants[]`; a variant's
  `steps[]` is the ordered route (`order`, `nodeIds`, `incomingEdgeIds`) and a
  `resultNodeId` names where the chain ends.
- `nodes[]` — each has `type` (`entrypoint`, `user_action`, `ai_process`,
  `workflow`, `tool`, `model`, `human_gate`, `data`, `external_system`,
  `process`, `result`), `label`, `description`, `sources[]`
  (`file`, `startLine`, `endLine`, `symbol`), `confidence` (0–1), and
  `inference` (`method` + `explanation` of how the classification was made).
- `edges[]` — `source`, `target`, `control` (sequential, conditional, parallel,
  loop, retry, fallback, human approval), `confidence`.
- `diagnostics[]` on a feature — deterministic problems, e.g. a route that
  never reaches a result. These are findings, not noise: surface them.

Answer with a bounded amount of JSON reading: list `features[].label` first,
then read only the feature the question is about.

## 3. Report with evidence

- Cite `file:startLine` from `sources` for every step you describe.
- State `confidence` when it is below 0.8, and quote the `inference.explanation`
  when the user asks why something was classified that way.
- Report `diagnostics` and `health` honestly — a red chain is a finding.
- Never describe a call, branch, or dependency that has no edge in the graph.
  If the user asserts one exists, say the analyzer did not detect it and name
  the file where they believe it lives, so detection can be checked.

## 4. Show the human the map (optional)

For an interactive viewer (feature list, step-through playback, evidence
drawer, focus mode, Chinese/English UI):

```bash
npx --yes https://github.com/tangyishun9846/agent-runtime-map/releases/download/v0.8.0/agent-runtime-map-0.8.0.tgz <project-path>
```

It serves on localhost and opens a browser. Playback is a static simulation of
the code-backed route — present it as such, never as a live run.

## MCP alternative

Hosts that support the Model Context Protocol can register the bundled server
and query `analyze_project`, `list_features`, `describe_feature`, and
`get_evidence` instead of reading JSON. See the repository's
`packages/mcp/README.md`.

## Limits — state them, do not paper over them

- TypeScript, JavaScript, and Python only; calls resolve within the analyzed
  set, so a connection made through an unanalyzed package boundary can be
  missing. Missing is reported as missing, never invented.
- Classification is convention-based where noted: the `inference` field says
  which signal fired, and `confidence` is calibrated to that signal.
- The map compresses to a human-scale graph (default 40 nodes); raw per-symbol
  facts live in the Raw Code Graph (`--raw-out`) when needed.
