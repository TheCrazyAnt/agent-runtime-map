# Contributing

Thanks for helping make unfamiliar codebases easier to understand.

## Local setup

Use Node.js 20 or newer:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

To exercise the complete flow:

```bash
node packages/cli/dist/cli.js examples/simple-agent --no-open
```

## Design rules

Agent Runtime Map separates code facts from human interpretation:

1. The analyzer records deterministic facts in `RawCodeGraph`.
2. The Logic Compiler selects, connects, and labels human-scale logic nodes.
3. The Viewer consumes `LogicGraph` only; it must not parse source code.

Any new inference rule must:

- attach one or more source locations;
- state the inference method;
- assign a calibrated confidence;
- avoid creating a fact when the evidence is absent;
- include a focused fixture and regression test.

Do not send an entire repository to an LLM as a substitute for static analysis. Model-assisted features must be optional, disclose what data leaves the machine, and preserve evidence for every conclusion.

## Pull requests

- Keep changes scoped and explain the user-visible behavior.
- Add or update tests for analyzer, compiler, schema, CLI, and security changes.
- Run `npm run release:check` before requesting review.
- Update the changelog for user-facing changes.
- Avoid generated `dist/`, `.logic-map/`, and coverage files.

## Adding framework support

Prefer a small adapter or detector with explicit conventions over adding framework-specific behavior to the Viewer. Include both positive and negative examples so ordinary functions are not over-classified.

## Reporting bugs

Include the Agent Runtime Map version, Node.js version, framework, minimal reproduction, expected flow, actual flow, and relevant diagnostics. Remove secrets and proprietary source before attaching generated graph files.
