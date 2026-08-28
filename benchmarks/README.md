# Map Accuracy Benchmark

Hand-confirmed samples that hold the analyzer to account. Each project under
`projects/` is a small but structurally real codebase, and its `expected.json`
is the **human-verified correct answer**: which nodes and edges the code proves,
what the map must not invent, and which relations are honestly unresolvable.

Verdicts are exact topology: every business node and edge must match the
allowlist (anything extra is a false positive that fails the suite), every
non-optional entry must appear (a miss is a false negative), feature routes are
checked in order per variant with their control kinds, and every visible logic
node and edge must trace to a raw edge with file-and-line evidence. The report
prints TP / FP / FN per sample.

The gating version runs in CI (`tests/benchmark.test.ts`); the readable version
is:

```bash
npm run build
node scripts/benchmark-report.mjs
```

## What "accurate" means here

- **A required node** exists in the code with evidence in a named file. Missing
  it is a false negative.
- **A forbidden label or type** must not appear on the map. `checkout-flow`
  exists for this: it has no agents or models, and a map that shows any invented
  one fails. Node-type variety is *never* a quality signal — a project without a
  data store should produce a map without one.
- **A required edge** is provable from the AST (calls, registry keys, literal
  member access, framework conventions). A **forbidden edge** is one no code
  evidence supports — the dynamic dispatches in `research-crew` must produce an
  `CALL_UNRESOLVED_DYNAMIC` diagnostic, not a guessed edge.
- **Feature routes** must include the steps a person tracing the code would
  name, at business-level abstraction — not one node per function, and not a
  flattened summary that hides gates, retries, and stores.
- **Determinism**: the same commit analyzes to the same buildId, twice.

## The samples

| Project | Exercises |
|---|---|
| `support-desk` | Express routes, agent + prompt configs, a string-keyed tool registry (cross-file set/get), class instances held on an object property, a human-approval gate inside a `workflows/` directory, a bounded retry loop, plumbing helpers that must stay off the map, one genuinely dynamic tool lookup |
| `research-crew` | Factory-produced agent instances, literal vs. computed object-member dispatch, an orchestrating entry function with no route, a vector store, a template-literal external URL, a fallback path |
| `checkout-flow` | Negative control: Next.js route + page, service object, payment/external calls, database write — and **zero** AI constructs to invent |
| `rag-chat` | Minimal reproduction of a real repository's structure ([REAL_WORLD.md](REAL_WORLD.md)): AWS SDK client call, in-handler system prompt, runtime-selected model, UI fetch to an internal route, retrieval fallback |

## Adding a sample

1. Write the smallest project that exhibits the structure — real imports, real
   calls, no dead scaffolding.
2. Read the code yourself and write `expected.json` from that reading, not from
   the analyzer's output. If the analyzer disagrees, one of you is wrong; find
   out which before committing either.
3. Record genuinely undecidable relations as required diagnostics, not as edges.
