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
- source locations, confidence, inference explanation, and links back to raw IDs.

## Confidence

Confidence is a number from 0 to 1. It describes support for a classification or relationship, not whether the code itself is correct.

- `1.0`: direct AST fact.
- approximately `0.9–0.99`: deterministic relationship plus framework convention.
- approximately `0.8–0.89`: naming or path heuristic with direct source evidence.
- lower values: weak or incomplete evidence that should be visually distinguishable.

Model-assisted inference must use `llm` or `mixed` as its method and retain the deterministic evidence that was provided to the model.

## Compatibility

Consumers should reject unsupported major schema changes and tolerate additional metadata fields. Node and edge IDs are opaque strings.
