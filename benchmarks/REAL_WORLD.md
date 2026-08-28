# Real-World Verification

External check of the accuracy benchmark against a real, public TypeScript
repository at a pinned commit. CI never touches the network for this: the
structure is reproduced (as original code, structure credit noted) in
[`projects/rag-chat`](projects/rag-chat), which the gated benchmark runs
offline. This document records the verification against the actual repository.

## Subject

- **Repository:** [anthropics/anthropic-quickstarts](https://github.com/anthropics/anthropic-quickstarts) (MIT)
- **Project:** `customer-support-agent` — a production-style Next.js support
  chat: Claude via the Anthropic SDK, RAG retrieval through AWS Bedrock
  Knowledge Bases, mood/category classification, human-agent redirection.
- **Commit:** `3313e9716fb5b977248bcd06cb0cc86a8c547b9b`
- **Analysis:** read-only, default settings, no network, no LLM.

## Hand-confirmed ground truth (from reading the code)

Two real capabilities:

1. **Chat** (`app/api/chat/route.ts` → `POST`): parse request → `retrieveContext`
   (`app/lib/utils.ts`, `bedrockClient.send` → **AWS Bedrock Agent Runtime**),
   with a catch that continues without context → build `systemPrompt` (an
   in-handler template constant) → `anthropic.messages.create` with a
   **runtime-selected model** (the model id arrives in the request body) →
   validate → respond, possibly flagging redirect-to-human.
2. **UI entry** (`components/ChatArea.tsx`): the chat component `fetch`es
   `/api/chat`.

Honestly unresolvable statically: the concrete model id (request data), and the
redirect-to-human outcome (a value inside the LLM's JSON response, not a code
path — correctly absent from the map rather than guessed as a `human_gate`).

## Results

| | v0.8.0 | This PR |
|---|---|---|
| Business nodes | 2 (route, Anthropic API) | **5** (route, systemPrompt, Anthropic API, AWS Bedrock, runtime-selected model) |
| Logic graph | 2 nodes / 1 edge | **7 nodes / 6 edges** |
| Feature route | `POST /api/chat → Anthropic API` | `POST /api/chat → Retrieve Context → AWS Bedrock ∥ Anthropic API + model`, with `Chat Area` upstream |
| False negatives vs. ground truth | 5 (RAG step, Bedrock, prompt, model call site, UI edge in the visible map) | **0** |
| False positives | 0 | **0** |
| Unresolved diagnostics | 0 | 0 (nothing here is a dynamic dispatch; the runtime model id is represented as a runtime-selected model node, not a diagnostic) |

Root causes fixed, each generalized and regression-tested:

1. `client.send(command)` on an `@aws-sdk/client-*` client now names the AWS
   service from the import specifier (and works when the package is not
   installed — the alias symbol resolves to zero declarations, which the old
   fallback chain never caught).
2. A prompt constant inside a handler body is now found (the walk covered only
   top-level declarations); nested declarations participate **only** in prompt
   detection, so handler locals cannot become constructs.
3. An SDK model call whose model id is request data still marks the call site
   as a model node (`anthropic model (runtime-selected)`) instead of vanishing.
4. Functions whose flow reaches an external system, data store, or route are
   integration steps and survive logic compression — this is what restored
   `Retrieve Context` and `Chat Area` to the visible map.

## Caveats

- One repository is one repository: this validates the mechanisms on real code,
  not universal coverage. More subjects belong here over time.
- The `Key Features` feature label comes from the repository's README heading —
  truthful sourcing, unhelpful wording; documented-capability labeling quality
  is future work.
- `components/ChatArea.tsx` appears as an upstream `process` step, not a
  `user_action`; nested UI handlers (`handleSubmit`) remain a known limitation.
