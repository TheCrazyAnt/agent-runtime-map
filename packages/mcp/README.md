# @agent-runtime-map/mcp

A Model Context Protocol server that lets any agent read a repository as an
evidence-backed map instead of file by file.

## Register it

```json
{
  "mcpServers": {
    "agent-runtime-map": {
      "command": "npx",
      "args": ["-y", "@agent-runtime-map/mcp"]
    }
  }
}
```

Until the package is on npm, point at a local build instead:

```json
{
  "mcpServers": {
    "agent-runtime-map": {
      "command": "node",
      "args": ["/absolute/path/to/agent-runtime-map/packages/mcp/dist/index.js"]
    }
  }
}
```

## Tools

| Tool | Answers |
| --- | --- |
| `analyze_project` | What is this repository, and what capabilities does it have? |
| `list_features` | Which feature circuits exist, and which are broken? |
| `describe_feature` | What are the steps of one feature, and how confident is each? |
| `get_evidence` | What was this step read from, and what does the project claim about it? |

Each answers one question and names the tool that answers the next, because an agent
pays for every token it reads. A compiled map of a real repository is hundreds of
kilobytes, and no tool returns it whole.

## What the answers keep

Every step carries its source location and a confidence, and a step matched to a
documented capability reports that **separately** from its code confidence. A map
without those is an architecture poster, and an agent repeating it would be stating
as fact something nobody can check.

A route is a statically inferred path, and every answer that shows one says so. It
is not a recording of anything that ran.

## What it will not do

- **It does not execute the project.** Analysis reads source. The Python adapter
  shells out to `ast.parse`, which builds a tree and imports nothing.
- **It writes nothing** unless `analyze_project` is called with `write: true`.
- **It is not a file reader.** `get_evidence` can return source lines, but only for
  a path the graph already points at, only inside the analyzed project, and only a
  bounded number of lines.
- **It does not call a model.** Optional LLM enrichment exists in the CLI and is off
  here.
