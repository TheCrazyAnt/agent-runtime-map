# Embedding the continuous map in a Next.js admin panel

This example shows the three pieces an App Router project needs to show its own,
always-current runtime map on an internal page. Copy the files into your project;
they are reference code, not a runnable app.

## 1. Keep the map current

```bash
npm install --save-dev agent-runtime-map
npx agent-runtime-map init
npx agent-runtime-map watch .
```

`watch` maintains `.agent-runtime-map/current/` — analysis lives entirely in that
process. Nothing in this example runs the analyzer inside Next.js.

Add `.agent-runtime-map/` to `.gitignore` (or commit `current/` if you want the map
reviewed with the code — both work; history/ is noisy to commit).

## 2. Serve the artifacts — `app/api/runtime-map/[file]/route.ts`

A five-name allow-list over `.agent-runtime-map/current/`. It cannot read anything
else, so it is safe to mount in an authenticated admin area. Put it behind the same
auth as the rest of your admin routes; the graph knows your source layout.

## 3. Render and follow — `app/runtime-map/RuntimeMapPanel.tsx`

```bash
npm install @agent-runtime-map/react
```

The panel fetches `graph.json`, renders `<LogicMap />`, and polls `manifest.json`
every two seconds. When `agent-runtime-map watch` publishes a new build, the open
page swaps the graph in place. A failed analysis keeps the last good map on screen
with a notice from `status.json` — the map degrades to *stale*, never to *blank*.

If you already lay out nodes yourself, pass `positions` to `<LogicMap />` and the
layout engine is never imported.

## Not a React shop?

Serve `.agent-runtime-map/current/` as static files and point an `<iframe>` at
`report.html` — see [examples/report-embed](../report-embed/README.md).
