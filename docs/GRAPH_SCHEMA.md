# Graph Schema

The protocol is defined in `packages/schema/src/index.ts` and versioned independently through `schemaVersion`.

## Raw Code Graph

`RawCodeGraph` represents analyzer facts:

- project identity, languages, frameworks, and file count;
- files, functions, classes, routes, services, agents, tools, databases, and external APIs;
- containment, imports, calls, data flow, route handling, reads, writes, and requests;
- evidence and diagnostics.

Raw graphs may be large. They are intended for compilers, debugging, and advanced viewers.

## Logic Graph

`LogicGraph` represents the human-facing result:

- a `runtime_logic` or `product_logic` graph type;
- user actions, entrypoints, processes, AI processes, decisions, data, external systems, and results;
- flow, branch, and data-flow edges;
- feature circuits, branch variants, and ordered simulation steps;
- chain health and diagnostics attached to affected nodes or edges;
- source locations, confidence, inference explanation, and links back to raw IDs.

### FeatureScenario

Every detected capability is represented by a `FeatureScenario` containing:

- entry, result, node, and edge IDs that map back to the global Logic Graph;
- one or more `FeaturePathVariant` objects for the combined circuit and inferred branches;
- ordered `FeatureSimulationStep` groups used by the Viewer without executing source code;
- `healthy`, `warning`, or `error` chain health;
- evidence-backed diagnostics with a stable code, severity, source locations, confidence, and suggested repair.

Current diagnostic codes cover broken references, cycles, low-confidence inference, missing downstream execution, missing terminal results, and bounded path limits. Consumers must display uncertainty distinctly from deterministic errors.

## Confidence

Confidence is a number from 0 to 1. It describes support for a classification or relationship, not whether the code itself is correct.

- `1.0`: direct AST fact.
- approximately `0.9–0.99`: deterministic relationship plus framework convention.
- approximately `0.8–0.89`: naming or path heuristic with direct source evidence.
- lower values: weak or incomplete evidence that should be visually distinguishable.

Model-assisted inference must use `llm` or `mixed` as its method and retain the deterministic evidence that was provided to the model.

## Compatibility

Consumers should reject unsupported major schema changes and tolerate additional metadata fields. Node and edge IDs are opaque strings.
