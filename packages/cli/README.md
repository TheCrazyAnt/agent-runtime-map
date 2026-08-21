# Agent Runtime Map

Turn every Agent feature into an evidence-backed execution circuit you can inspect step by step.

```bash
npx agent-runtime-map@latest .
```

The command analyzes the selected project, writes `.logic-map/graph.json`, starts a local viewer, and opens it in the browser. Choose a feature from the left to play, pause, single-step, replay, or switch between its inferred branches on one global Agent graph. Chain Doctor marks verified steps green, uncertainty yellow, and deterministic failures red with source evidence and a suggested repair.

Playback is an explicit simulation of the statically compiled code route; it does not claim that a live request is executing. Analysis is local and no source code is uploaded.

Use `agent-runtime-map analyze .` to generate JSON without starting a server. The original `logic-map` command remains available as an alias. See the [project repository](https://github.com/tangyishun9846/agent-runtime-map) for supported frameworks, limitations, privacy behavior, and contribution guidelines.

The CLI and Viewer automatically use Chinese for Chinese locales and English for other locales. Pass `--locale zh-CN` or `--locale en` to override detection.
