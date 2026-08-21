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
  ├─ semantic labels and confidence
  ├─ feature-root and branch extraction
  └─ deterministic Chain Doctor diagnostics
          ↓
      LogicGraph + FeatureScenario[]
          ↓
     ELK → React Flow → static chain simulation
```

## Boundaries

The analyzer owns source-language and framework facts. It may emit many nodes and edges. It must never optimize its output for a particular visual layout.

The Logic Compiler owns abstraction. It removes infrastructure noise, keeps business-relevant nodes, projects paths across hidden functions, discovers each user action or API entry as a feature circuit, enumerates bounded branch variants, and explains every heuristic conclusion.

The Viewer owns presentation and deterministic playback state only. It fetches `graph.json`, computes one global layout with ELK, and highlights the selected `FeatureScenario` step by step. It does not execute the inspected project or claim that a live request is running. This keeps future Python, actual runtime trace, and model-assisted adapters compatible with the same UI.

## Chain Doctor

The static compiler currently reports broken graph references, entries with no resolvable downstream work, cycles without a result, low-confidence steps, and bounded-path limits. Each diagnostic is attached to a node or edge and retains source evidence. During simulation, an error halts playback when its affected step is reached; warnings remain inspectable without pretending they are confirmed failures.

## Stable IDs

Raw IDs are derived from node kind and stable source identity using SHA-1 prefixes. They are deterministic for unchanged file paths, symbols, and declaration lines. A future schema revision may add content-aware identities for better stability across line movement.

## Trust model

Agent Runtime Map parses repository text but does not execute the inspected project. Evidence paths are relative to the project root. The absolute root exists only in project metadata and should be treated as sensitive if graph files are shared.
