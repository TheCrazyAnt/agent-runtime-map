import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import type { LogicGraph, RawCodeGraph, TraceEvent, TraceOverlay } from "@agent-runtime-map/schema";
import { BlueprintLogicNode, type BlueprintLogicNodeData } from "./BlueprintLogicNode.js";
import { BlueprintGroupNode } from "./BlueprintGroupNode.js";
import { BlueprintCodeNode } from "./BlueprintCodeNode.js";
import { BlueprintPlaybackEdge } from "./BlueprintPlaybackEdge.js";
import { blueprintSemanticZoomProgress } from "./semanticZoom.js";
import { buildBlueprintGroupNodes, type BlueprintGroupLabels } from "./blueprintGroups.js";
import { layoutGraph } from "./layout.js";
import { buildSimulationFrame, type SimulationFrame } from "./simulation.js";
import { DEFAULT_LABELS, edgeState, nodeStateClass, toFlowEdge, toFlowNode } from "./logicMapModel.js";
import { applyTraceEvents, traceStateClass } from "./trace.js";

const NODE_TYPES = {
  logic: BlueprintLogicNode,
  blueprintGroup: BlueprintGroupNode,
  codeDetail: BlueprintCodeNode,
};
const EDGE_TYPES = { playback: BlueprintPlaybackEdge };

export interface LogicMapProps {
  /**
   * An already compiled Logic Graph. The component never reads a repository, runs an
   * analyzer, or calls a network service: whatever produced this graph is the host's
   * concern, which is what makes the same component usable in a docs site, an
   * internal dashboard, or the bundled Viewer.
   */
  graph: LogicGraph;
  /** Kept for parity with the Viewer protocol; reserved for host-driven drill-down. */
  rawGraph?: RawCodeGraph;
  /** Frames the route of one feature. Omit to show the whole system. */
  featureId?: string | null;
  /** Which inferred branch of that feature to frame. Defaults to the first. */
  variantId?: string;
  /**
   * How far along the route to highlight, as a **static** simulation: -1 shows the
   * route unplayed. This is never a live run, and a host must not present it as one.
   */
  stepIndex?: number;
  /** Node id to render as selected. */
  selectedNodeId?: string;
  /**
   * Observations from a real run, layered over the static map. Pass raw events and
   * they are mapped here, or pass an overlay you already built. Either way it only
   * ever lights up ids the graph already has: it adds no nodes, no edges, and no
   * confidence, and the styling stays distinct from the inferred route so the two
   * can never be read as the same claim.
   */
  trace?: TraceOverlay | readonly TraceEvent[];
  /**
   * Coordinates the host already has, by node id. Supplying them skips the layout
   * engine entirely — nothing is imported, nothing runs — which is what a host that
   * computes positions ahead of time is asking for. Any node without an entry keeps
   * the position it would otherwise be laid out at, so a partial map still renders.
   */
  positions?: Readonly<Record<string, { x: number; y: number }>>;
  labels?: Partial<BlueprintGroupLabels>;
  className?: string;
  fitView?: boolean;
  interactive?: boolean;
  onSelectNode?: (nodeId: string, node: LogicGraph["nodes"][number]) => void;
  onFrameChange?: (frame: SimulationFrame) => void;
}

/**
 * An embeddable Agent Runtime Map canvas.
 *
 * Layout runs once per graph, as it does in the Viewer: recomputing it on selection
 * or playback would throw away the reader's spatial memory of the map, which is the
 * thing that makes a map worth more than a list.
 */
export function LogicMap(props: LogicMapProps) {
  return (
    <ReactFlowProvider>
      <LogicMapCanvas {...props} />
    </ReactFlowProvider>
  );
}

function LogicMapCanvas({
  graph,
  featureId,
  variantId,
  stepIndex = -1,
  selectedNodeId,
  trace,
  positions,
  labels,
  className,
  fitView = true,
  interactive = true,
  onSelectNode,
  onFrameChange,
}: LogicMapProps) {
  const [positioned, setPositioned] = useState<Node<BlueprintLogicNodeData>[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);

  const feature = useMemo(
    () => (featureId ? graph.features.find((item) => item.id === featureId) : undefined),
    [featureId, graph.features],
  );
  const variant = useMemo(
    () => (variantId ? feature?.variants.find((item) => item.id === variantId) : feature?.variants[0]),
    [feature, variantId],
  );
  const frame = useMemo(() => buildSimulationFrame(feature, variant, stepIndex), [feature, stepIndex, variant]);
  const overlay = useMemo(
    () => (Array.isArray(trace) ? applyTraceEvents(graph, trace) : (trace as TraceOverlay | undefined)),
    [graph, trace],
  );
  useEffect(() => { onFrameChange?.(frame); }, [frame, onFrameChange]);

  const baseNodes = useMemo(() => graph.nodes.map(toFlowNode), [graph.nodes]);
  const baseEdges = useMemo(() => graph.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })), [graph.edges]);

  useEffect(() => {
    // Given coordinates, the layout engine is not merely skipped — it is never
    // imported, so a host that lays out its own map does not pay for elkjs at all.
    if (positions) {
      setPositioned(baseNodes.map((node) => {
        const position = positions[node.id];
        return position ? { ...node, position } : node;
      }));
      return;
    }
    let active = true;
    layoutGraph(baseNodes, baseEdges).then((next) => {
      if (active) setPositioned(next as Node<BlueprintLogicNodeData>[]);
    }).catch(() => {
      // A layout failure must still leave a usable map rather than an empty frame.
      if (active) setPositioned(baseNodes);
    });
    return () => { active = false; };
  }, [baseEdges, baseNodes, positions]);

  const activeNodeIds = useMemo(
    () => (variant ? new Set(variant.nodeIds) : undefined),
    [variant],
  );

  // React Flow measures nodes and reports the result through `onNodesChange`. A
  // canvas that derives its node array on every render throws those measurements
  // away, and React Flow will not draw an edge between two nodes it has no measured
  // bounds for — the map renders, and every connection silently disappears. So the
  // array is held in state, rebuilt only when the layout changes, and *patched* for
  // highlighting so measurements survive.
  const [flowNodes, setFlowNodes] = useState<Node[]>([]);

  useEffect(() => {
    if (!positioned.length) return;
    const groups = buildBlueprintGroupNodes(positioned, graph, activeNodeIds, { ...DEFAULT_LABELS, ...labels });
    setFlowNodes([...groups, ...positioned]);
  }, [activeNodeIds, graph, labels, positioned]);

  useEffect(() => {
    setFlowNodes((current) => current.map((node) => (node.type === "logic"
      ? {
        ...node,
        selected: node.id === selectedNodeId,
        className: [nodeStateClass(node.id, frame, variant), traceStateClass(overlay?.nodes[node.id])]
          .filter(Boolean)
          .join(" "),
      }
      : node)));
    // `positioned` is a dependency because this effect patches an array another
    // effect populates. Without it the first patch runs against an empty array and
    // never runs again, so edges highlighted the framed route while every node on
    // it stayed unmarked. `positioned` is not set here, so this cannot loop.
  }, [frame, overlay, positioned, selectedNodeId, variant]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setFlowNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const edges = useMemo(
    () => graph.edges.map((edge) => toFlowEdge(edge, edgeState(edge, frame, variant))),
    [frame, graph.edges, variant],
  );

  const handleSelect = useCallback((_event: React.MouseEvent, node: Node) => {
    const logicNode = graph.nodes.find((item) => item.id === node.id);
    if (logicNode) onSelectNode?.(node.id, logicNode);
  }, [graph.nodes, onSelectNode]);

  const handleZoom = useCallback((zoom: number) => {
    const progress = blueprintSemanticZoomProgress(zoom);
    canvasRef.current?.style.setProperty("--semantic-logic-progress", progress.logic.toFixed(4));
    canvasRef.current?.style.setProperty("--semantic-evidence-progress", progress.evidence.toFixed(4));
  }, []);

  // React Flow observes the nodes it is first mounted with. Mounting it with an
  // empty array and swapping in the laid-out nodes afterwards leaves every node
  // unmeasured, which renders as an empty canvas with no edges at all.
  if (!flowNodes.length) {
    return <div className={`logic-map logic-map--pending${className ? ` ${className}` : ""}`} ref={canvasRef} />;
  }

  return (
    <div className={`logic-map${className ? ` ${className}` : ""}`} ref={canvasRef}>
      <ReactFlow
        nodes={flowNodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onNodeClick={handleSelect}
        onMove={(_event, viewport) => handleZoom(viewport.zoom)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={interactive}
        panOnDrag={interactive}
        zoomOnScroll={interactive}
        minZoom={0.2}
        maxZoom={2.2}
        fitView={fitView}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="rgba(118,132,148,.24)" />
      </ReactFlow>
    </div>
  );
}
