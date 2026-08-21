# Architecture

Agent Runtime Map is a compiler pipeline, not a diagram parser.

```text
Codebase
  │
  ├─ discovery and framework detection
  ├─ TypeScript AST and symbol resolution
  └─ deterministic conventions
          ↓
     RawCodeGraph
          ↓
     Logic Compiler
  ├─ candidate selection
  ├─ importance ranking
  ├─ hidden-node path projection
  ├─ redundant-flow reduction
  └─ semantic labels and confidence
          ↓
      LogicGraph
          ↓
     ELK → React Flow
```

## Boundaries

The analyzer owns source-language and framework facts. It may emit many nodes and edges. It must never optimize its output for a particular visual layout.

The Logic Compiler owns abstraction. It removes infrastructure noise, keeps business-relevant nodes, projects paths across hidden functions, and explains every heuristic conclusion.

The Viewer owns presentation only. It fetches `graph.json`, computes positions with ELK, and renders the shared schema. This makes future Python, runtime trace, and model-assisted adapters compatible with the same UI.

## Stable IDs

Raw IDs are derived from node kind and stable source identity using SHA-1 prefixes. They are deterministic for unchanged file paths, symbols, and declaration lines. A future schema revision may add content-aware identities for better stability across line movement.

## Trust model

Agent Runtime Map parses repository text but does not execute the inspected project. Evidence paths are relative to the project root. The absolute root exists only in project metadata and should be treated as sensitive if graph files are shared.
