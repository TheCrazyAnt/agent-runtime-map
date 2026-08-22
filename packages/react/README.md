# @agent-runtime-map/react

Reusable React Flow components for the Agent Runtime Map blueprint visual language.

```tsx
import {
  BlueprintGroupNode,
  BlueprintLogicNode,
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

All components are presentation-only. They consume the shared graph protocol and do not analyze or execute user code.
