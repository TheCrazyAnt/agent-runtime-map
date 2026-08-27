# Using report.html as a standalone map page

Every build writes `.agent-runtime-map/current/report.html`: the full interactive
Viewer with the graph embedded, plus the `assets/` folder next to it. It needs no
analyzer, no Node process, and no network beyond static file serving.

## Look at it locally

```bash
npx agent-runtime-map build .
npx serve .agent-runtime-map/current
```

Open the printed URL and you get the complete Viewer — feature circuits, playback,
focus mode, evidence drawer. Because `manifest.json` sits in the same folder, a page
you leave open refreshes itself whenever something rebuilds the map (for example
`agent-runtime-map watch .` running in another terminal).

Opening `report.html` by double-click (`file://`) shows a static summary instead —
features, health, confidence, and diagnostics — because browsers refuse module
scripts from `file://`. The page tells you how to get the interactive version; it
never renders blank.

## Publish it

`current/` is an ordinary static folder. Some places it fits:

- **CI artifact:** run `agent-runtime-map build .` in CI and upload
  `.agent-runtime-map/current/` — every PR gets a browsable map of what it changed
  (`changes.json` sits right next to it).
- **Internal static hosting:** sync `current/` to any static host behind your VPN.
  The graph contains source paths and structure, so treat it like source code.
- **Admin backend:** serve the folder under an authenticated route and embed it:

```html
<iframe
  src="/runtime-map/report.html"
  title="Agent Runtime Map"
  style="width: 100%; height: 80vh; border: 0"
></iframe>
```

The source-preview drawer needs the analyzer's own server (`agent-runtime-map
watch`), so inside `report.html` evidence shows file and line references without
inline source text. Everything else is self-contained.
