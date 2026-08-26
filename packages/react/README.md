# @agent-runtime-map/react

Reusable React Flow components for the Agent Runtime Map blueprint visual language,
plus an embeddable `<LogicMap />` that renders a whole compiled graph.

## Embedding a map

`LogicMap` takes an **already compiled** `LogicGraph`. It never reads a repository,
runs an analyzer, or calls a service of its own — producing the graph is the host's
job, which is what lets the same component sit in a docs site, an internal dashboard,
or the bundled Viewer.

```tsx
import { LogicMap } from "@agent-runtime-map/react";
import "@xyflow/react/dist/style.css";
import "@agent-runtime-map/react/styles.css";

const graph = await (await fetch("/graph.json")).json();

<div style={{ height: "70vh" }}>
  <LogicMap
    graph={graph}
    featureId={graph.features[0]?.id}
    stepIndex={2}
    onSelectNode={(id, node) => console.log(node.label, node.sources)}
  />
</div>;
```

The canvas fills the box you give it, so the parent needs a height.

### Bringing your own coordinates

Pass `positions` and the layout engine is never imported — nothing is downloaded and
nothing runs. This is for a host that already computes its layout, or renders the same
map in a context where a force pass is not wanted.

```tsx
<LogicMap graph={graph} positions={{ logic_route_a1b2: { x: 0, y: 0 }, /* … */ }} />
```

A node with no entry keeps the position it would otherwise be laid out at, so a
partial map still renders.

| Prop | Meaning |
| --- | --- |
| `graph` | The compiled `LogicGraph`. Required. |
| `featureId` | Frames one feature's route. Omit for the whole system. |
| `variantId` | Which inferred branch to frame. Defaults to the first. |
| `stepIndex` | How far along the route to highlight. `-1` shows it unplayed. |
| `selectedNodeId` | Node to render as selected. |
| `positions` | Coordinates by node id. Supplying them skips the layout engine entirely. |
| `labels` | Boundary titles, so frames can be labelled in your product's language. |
| `interactive` | `false` renders a static, non-pannable map. |
| `onSelectNode` | Called with the node id and the compiled node behind it. |

`stepIndex` drives a **static simulation** of a statically inferred route. It is not a
live run of the Agent, and a host must not present it as one.

## Layering a real run over the map

A run can light up the steps it touched. This is a bridge, **not** a tracing system:
it adds no nodes, no edges, and no confidence — it reports which existing,
evidence-backed elements ran, and hands back everything it could not place.

```ts
import { applyTraceEvents } from "@agent-runtime-map/react";

const overlay = applyTraceEvents(graph, [
  { target: "logic_route_a1b2", kind: "completed", durationMs: 120 },
  { target: "agent_504378b8626b", kind: "failed", detail: "timeout" },
]);

overlay.unmatched;  // events naming ids this graph does not have
overlay.coverage;   // fraction of the map the run actually touched
```

`target` is any stable id already in the graph — a logic node, a logic edge, or a raw
node, which is lifted to the step that contains it, because a runtime reports the
symbol it executed rather than the compressed step the map shows.

An event that matches nothing is returned in `unmatched` rather than drawn. A failure
is never erased by a later event: a retry somewhere else does not mean this step
stopped failing here.

Pass either the overlay or the raw events to `<LogicMap trace={...} />`. Observed
elements are styled distinctly from the inferred route on purpose — a reader must
never mistake "this is the statically inferred path" for "this actually ran".

## Embedding without React

```html
<logic-map id="map" style="display:block;height:70vh"></logic-map>
<script type="module">
  import { defineLogicMapElement } from "@agent-runtime-map/react/element";
  defineLogicMapElement();
  const map = document.getElementById("map");
  map.graph = await (await fetch("/graph.json")).json();
  map.addEventListener("select-node", (event) => console.log(event.detail.node.label));
</script>
```

The graph is set as a property rather than an attribute, because a Logic Graph is far
larger than an attribute should carry. `feature-id`, `variant-id`, `step-index`, and
`interactive` are attributes. The element needs `react-dom`, which is why it lives on
its own entry point: a React host never pays for a dependency it does not use.


```tsx
import {
  BlueprintGroupNode,
  BlueprintLogicNode,
  blueprintDetailLevelForZoom,
  blueprintSemanticZoomProgress,
  blueprintEdgeAppearance,
} from "@agent-runtime-map/react";
import "@agent-runtime-map/react/styles.css";

const nodeTypes = {
  logic: BlueprintLogicNode,
  blueprintGroup: BlueprintGroupNode,
};
```

The package exports:

- `BlueprintLogicNode` — icon-first semantic nodes with evidence and confidence metadata.
- `BlueprintGroupNode` — solid or dashed labeled system boundaries.
- `blueprintEdgeAppearance()` — consistent main, auxiliary, active, verified, warning, and error link tokens.
- `measureBlueprintBounds()` — computes a frame around positioned React Flow nodes.
- `blueprintDetailLevelForZoom()` — maps wheel zoom to overview, logic, and source-evidence fidelity without dropping graph data.
- `blueprintSemanticZoomProgress()` — returns eased continuous progress values for crossfading details between levels.

All components are presentation-only. They consume the shared graph protocol and do not analyze or execute user code.
