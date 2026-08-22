# Architecture

Agent Runtime Map is a compiler pipeline, not a diagram parser.

```text
Codebase
  │
  ├─ Project Reader
  │  ├─ package metadata and dependencies
  │  ├─ README / docs / PRD
  │  └─ prompt and safe configuration context
  └─ Static Analyzer
     ├─ TypeScript AST and symbol resolution
     ├─ Agent framework conventions
     └─ control-flow evidence
          ↓
     RawCodeGraph + ProjectContext
          ↓
     Logic Compiler
  ├─ candidate selection
  ├─ importance ranking
  ├─ hidden-node path projection
  ├─ redundant-flow reduction
  ├─ semantic labels and confidence
  ├─ documented capability matching
  ├─ feature-root and branch extraction
  └─ deterministic Chain Doctor diagnostics
          ↓
      LogicGraph + FeatureScenario[]
          ↓ optional explicit opt-in
     evidence-constrained semantic labels
     (topology and evidence are immutable)
          ↓
     ELK → blueprint component layer → React Flow
                       ↓
              static chain simulation
```

## Boundaries

The Project Reader owns bounded, non-executable context collection. It reads product documents, prompts, package metadata, and JSON overrides while excluding credentials, environment files, private keys, dependencies, build output, and VCS data.

The analyzer owns source-language and framework facts. It may emit many nodes and edges. It must never optimize its output for a particular visual layout. Control-flow classifications are attached to the exact call-site evidence that produced them.

A callable is not always a `function` keyword, so the analyzer also registers object-literal members, default-exported arrows, and factory results, and it follows import aliases, destructured bindings, and reference-valued properties to the declaration a name really points at. Handing a function to another function is recorded as a call whose control kind says when it runs, because the reference is factual even though the invocation is deferred. Being callable by type inference never reaches the confidence of a declared function, and the type checker is consulted only for a name that is invoked or handed over somewhere in the project.

Framework conventions follow the same rule. A route is recognized on a receiver a known framework constructed, which is stronger evidence than a receiver merely named like a router, and the reported path includes any prefix the router was mounted under. An inline handler is not given a node of its own: it *is* the route, or the declarative graph node, it implements, so its body attributes there and each endpoint stays one node. The model, instructions, and tools of a request are read from the single options object that the Vercel AI SDK, the OpenAI SDK, and the Anthropic SDK all share, which avoids guessing at a provider. A tool is a conditional call, because the model chooses whether to use it.

Product context is carried as its own channel. A logic node or feature records which documented capability it was matched to, where that claim came from — README, product spec, documentation, an Agent prompt, project config, or the person running the tool — the strength of the link, and the documented terms that produced it. A strong specification matched on one shared word is still a weak match, and a single incidental word is not a match at all. None of this changes a node's confidence or how its classification was reached: code remains the source of truth, and the separation is what lets a reader see which conclusions the repository wrote down versus which were read out of the code. The match kind is stored as a kind plus verbatim terms rather than a finished sentence, so the Viewer can say it in either language while the documented words stay unchanged as evidence.

The Logic Compiler decides what any of that means for the map. Models join prompts, tables, and external systems as side dependencies: a step reaches them, every variant that touches the step carries them, and none of them opens a branch. Requesting a model is not a decision, and treating it as one would turn a single endpoint into as many variants as it has leaves.

The Logic Compiler owns abstraction. It removes infrastructure noise, keeps business-relevant nodes, projects paths across hidden functions, matches code paths to documented capabilities, discovers each user action or API entry as a feature circuit, enumerates bounded branch variants, and explains every heuristic conclusion.

The optional semantic package may replace labels, descriptions, and the project summary for existing IDs. It cannot introduce topology or evidence. The default pipeline never invokes it. OpenAI mode uses a bounded snapshot, Structured Outputs, and `store: false`; callers must opt in and supply both a model and API key.

The Viewer owns presentation and deterministic playback state only. It fetches `graph.json` and, when available, `raw-graph.json`; computes one global layout with ELK; and highlights the selected `FeatureScenario` step by step. A double-click expands a logic node into a bounded local Raw Code Graph subgraph without re-laying out the global map. A reader can select one of those children to inspect its own source range, with a breadcrumb back to the step, and can open exactly one further level through a control on the node; the depth cap is what keeps a single node from redrawing the whole call graph. The local server exposes a source-preview endpoint only for files already referenced by the Logic Graph, with path containment, allow-list validation, line limits, and size limits. Blueprint nodes, group frames, code-detail nodes, playback edges, edge appearances, and measurement helpers are isolated in `packages/react`, so an embedded viewer can consume the same visual contract without importing analyzer code. The Viewer does not execute the inspected project or claim that a live request is running. This keeps future Python, actual runtime trace, and model-assisted adapters compatible with the same UI.

## Chain Doctor

The static compiler currently reports broken graph references, entries with no resolvable downstream work, cycles without a result, low-confidence steps, bounded-path limits, unbounded retry evidence, external calls without a visible fallback, and Agents without an output contract. Each diagnostic is attached to a node or edge and retains source evidence. During simulation, an error halts playback when its affected step is reached; warnings remain inspectable without pretending they are confirmed failures.

## Stable IDs

Raw IDs are derived from node kind and stable source identity using SHA-1 prefixes. They are deterministic for unchanged file paths, symbols, and declaration lines. A future schema revision may add content-aware identities for better stability across line movement.

## Trust model

Agent Runtime Map parses repository text but does not execute the inspected project. Evidence paths are relative to the project root. The absolute root exists only in local project metadata and is removed from optional semantic snapshots. Generated graph files still contain code structure and should be treated as sensitive if shared.
