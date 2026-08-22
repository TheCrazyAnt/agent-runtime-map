# Visual Components

Agent Runtime Map's visual layer is a separate presentation package. It can be
used by the bundled Viewer or embedded in another React application without
pulling in the scanner or Logic Compiler.

## Visual language

The default theme is an engineering blueprint rather than a generic dashboard:

- a light multi-scale grid keeps large maps spatially legible;
- icon-first square nodes represent semantic roles instead of source functions;
- solid frames mark system boundaries and dashed frames mark nested workflows;
- blue orthogonal links are the primary execution path;
- gray dashed links are auxiliary data movement;
- green, amber, and red are reserved for verified, uncertain, and failed checks.

Technology logos are deliberately not required. The default Lucide icons encode
the node role, which keeps generated maps consistent and avoids making a
business-logic map look like a stack inventory.

## Package

The workspace package is `@agent-runtime-map/react`. Import its stylesheet once,
register its node types with React Flow, and translate Logic Graph nodes into the
small presentation contract.

```tsx
import { ReactFlow } from "@xyflow/react";
import {
  BlueprintGroupNode,
  BlueprintLogicNode,
  blueprintEdgeAppearance,
} from "@agent-runtime-map/react";
import "@xyflow/react/dist/style.css";
import "@agent-runtime-map/react/styles.css";

const nodeTypes = {
  logic: BlueprintLogicNode,
  blueprintGroup: BlueprintGroupNode,
};

const activeEdge = blueprintEdgeAppearance("current");

export function EmbeddedAgentMap({ nodes, edges }) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      nodesConnectable={false}
    />
  );
}
```

`BlueprintLogicNode` accepts a label, description, semantic node type, localized
type label, confidence, and evidence-count text. `BlueprintGroupNode` accepts a
label, optional detail text, one of four tones, and an optional dashed style.
`measureBlueprintBounds()` creates a padded boundary around laid-out nodes.

`blueprintEdgeAppearance()` returns deterministic color, width, opacity, dash,
and animation values for these states:

| State | Meaning | Default treatment |
| --- | --- | --- |
| `global` | Unfiltered system flow | solid blue, or dashed gray for data |
| `outside` | Not used by the selected feature | low-opacity gray |
| `path` | Selected feature route, not started | blue |
| `current` | Step currently being simulated | animated bright blue |
| `reached` | Verified previous step | green |
| `warning` | Reached but uncertain inference | amber |
| `error` | Deterministic chain failure | red |

## Responsibilities

The package is intentionally presentation-only. It does not read repositories,
infer business meaning, execute Agent code, or mutate the Logic Graph. Consumers
remain responsible for layout, localized labels, feature selection, and playback
state. This boundary keeps the same components usable with static analysis today
and real trace events later.
