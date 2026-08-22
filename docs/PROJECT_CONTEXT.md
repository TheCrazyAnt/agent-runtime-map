# Project Context and Semantic Analysis

Agent Runtime Map treats code as the source of truth and project documents as
supporting product context. The Project Reader runs before static analysis and
never executes repository code or configuration.

## Local context

The default pipeline reads a bounded set of high-signal files:

- `package.json`, known framework dependencies, scripts, and lockfile presence;
- README files;
- Markdown/text documentation under `docs/`;
- PRD and product-requirements documents;
- prompt/instructions directories and prompt constants found by the AST adapter;
- `agent-runtime-map.config.json`.

It excludes `.env`, credentials, secrets, private keys, `node_modules`, generated
output, coverage, build directories, `.git`, and `.logic-map`. Individual files,
the document count, and total context bytes are bounded. Use
`--max-context-files`, `--max-context-bytes`, or `--no-context` to change this
behavior.

## Optional configuration

Configuration is JSON so the analyzer never needs to execute the inspected
project:

```json
{
  "description": "An Agent service that researches and writes reports.",
  "features": {
    "report": {
      "label": "Sourced Report Generation",
      "description": "Research a question and return a cited report.",
      "keywords": ["research", "report", "citations"]
    }
  }
}
```

Feature hints are matched against entrypoints, user actions, Agent/workflow
names, and reachable code evidence. A hint changes product wording; it does not
create a route or make an unreachable function part of a feature.

## Optional OpenAI semantic enrichment

The default command is fully local. Network-backed semantic compression is
explicitly opt-in:

```bash
export OPENAI_API_KEY="..."
agent-runtime-map . --semantic openai --semantic-model <model>
```

The implementation uses the Responses API with a strict JSON Schema output and
requests `store: false`. It sends a bounded semantic snapshot containing project
metadata, relative evidence paths, compiled nodes/edges/features, short document
excerpts, and short prompt excerpts. It does not include the absolute project
root or raw source files.

The response is treated as a patch. Unknown IDs are discarded. The model may
rewrite the project summary, node labels/descriptions, and feature
labels/descriptions, but it cannot add or remove nodes, edges, sources, or
diagnostics. The deterministic confidence remains an upper bound for semantic
confidence.

Review the files and prompt excerpts in `.logic-map/raw-graph.json` before opting
in for a sensitive repository. OpenAI API behavior is documented in the
[official Responses API reference](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create).
