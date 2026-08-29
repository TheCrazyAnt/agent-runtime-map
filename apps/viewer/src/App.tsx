import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import {
  BlueprintCodeNode,
  BlueprintGroupNode,
  BlueprintLogicNode,
  BlueprintPlaybackEdge,
  blueprintDetailLevelForZoom,
  blueprintEdgeAppearance,
  BLUEPRINT_NODE_HEIGHT,
  BLUEPRINT_NODE_WIDTH,
  blueprintControlAppearance,
  blueprintSemanticZoomProgress,
  BlueprintOverviewNode,
  buildBlueprintGroupNodes,
  buildOverviewModel,
  shouldShowEdgeLabel,
  type BlueprintOverviewNodeData,
  type OverviewModel,
  measureBlueprintBounds,
  buildSimulationFrame,
  layoutGraph,
  nextSimulationStep,
  type BlueprintDetailLevel,
  type BlueprintEdgeState,
  type BlueprintLogicNodeData,
  type SimulationFrame,
} from "@agent-runtime-map/react";
import {
  Activity, AlertTriangle, Braces, CheckCircle2, ChevronLeft, ChevronRight, CircleDotDashed, Crosshair,
  GitFork, ListTree, PanelRightClose, Pause, Pin, Play, RotateCcw, Search, SkipForward, Undo2, X,
} from "lucide-react";
import type {
  ChainHealth, FeaturePathVariant, FeatureScenario, LogicGraph, LogicNode as LogicGraphNode,
  ProductEvidence, RawCodeGraph, RawCodeNode, SourceLocation,
} from "@agent-runtime-map/schema";
import { applyLayoutPositions, buildCodeDetailExpansion, canFocusNode, captureLayout, collectFocusIds, compareVariants, matchingNodeIds, parseDetailNodeId, parseLayoutPositions, type LayoutPositions } from "./interactionModel";
import {
  chainHealthLabel, detectViewerLocale, groupLabels, overviewLabels, overviewCountsLabel,
  labelSourceLabel, resolveEdgeText, resolveFeatureText, resolveNodeText, inferenceMethodLabel, localizeDiagnostic, localizeFeatureLabel,
  productMatchText, productOriginLabel,
  localizeGraphDescription, localizeGraphTitle, localizeNode, localizeVariantLabel, messages, nodeTypeLabel,
  rememberViewerLocale, sourceCountText, type UiLocale,
} from "./i18n";

const nodeTypes = { logic: BlueprintLogicNode, blueprintGroup: BlueprintGroupNode, codeDetail: BlueprintCodeNode, overview: BlueprintOverviewNode };
/** Overview aggregates are wider than a step node: they carry counts as well as a name. */
const OVERVIEW_NODE_WIDTH = 250;
const OVERVIEW_NODE_HEIGHT = 108;
const edgeTypes = { playback: BlueprintPlaybackEdge };
const LAYOUT_PREFIX = "agent-runtime-map.layout.v1";
const VIEW_STORAGE_KEY = "agent-runtime-map.view.v1";

/** What the canvas says about each node. Never what it draws or where. */
export type ViewMode = "business" | "technical";

export function App() {
  return <ReactFlowProvider><LogicMapViewer /></ReactFlowProvider>;
}

function LogicMapViewer() {
  const [graph, setGraph] = useState<LogicGraph>();
  const [rawGraph, setRawGraph] = useState<RawCodeGraph>();
  const [nodes, setNodes] = useState<Node<BlueprintLogicNodeData>[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>();
  const [selectedVariantId, setSelectedVariantId] = useState<string>();
  const [previousVariantId, setPreviousVariantId] = useState<string>();
  const [branchTransitioning, setBranchTransitioning] = useState(false);
  const [expandedLogicIds, setExpandedLogicIds] = useState<Set<string>>(new Set());
  const [expandedRawIds, setExpandedRawIds] = useState<Set<string>>(new Set());
  const [selectedRaw, setSelectedRaw] = useState<{ logicId: string; rawId: string }>();
  const [focusedId, setFocusedId] = useState<string>();
  const featureBeforeFocusRef = useRef<string | null>(null);
  const toggleRawDetail = useCallback((rawId: string) => {
    setExpandedRawIds((current) => { const next = new Set(current); if (next.has(rawId)) next.delete(rawId); else next.add(rawId); return next; });
  }, []);
  const [stepIndex, setStepIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [cameraFollow, setCameraFollow] = useState(true);
  const [query, setQuery] = useState("");
  const [spotlightId, setSpotlightId] = useState<string>();
  const [error, setError] = useState<string>();
  const [locale, setLocale] = useState<UiLocale>(detectViewerLocale);
  const [detailLevel, setDetailLevel] = useState<BlueprintDetailLevel>("logic");
  const [navigating, setNavigating] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [overviewNodes, setOverviewNodes] = useState<Node<BlueprintOverviewNodeData>[]>([]);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string>();
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "business";
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "technical" ? "technical" : "business";
  });
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [layoutHistory, setLayoutHistory] = useState<LayoutPositions[]>([]);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const canvasRef = useRef<HTMLElement>(null);
  const detailLevelRef = useRef<BlueprintDetailLevel>("logic");
  const nodesRef = useRef(nodes);
  const baseLayoutRef = useRef<LayoutPositions | undefined>(undefined);
  const dragStartLayoutRef = useRef<LayoutPositions | undefined>(undefined);
  const transitionTimerRef = useRef<number | undefined>(undefined);
  const spotlightTimerRef = useRef<number | undefined>(undefined);
  const reduceMotion = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const { fitView, getNode, setCenter } = useReactFlow();
  // React Flow measures asynchronously; framing before it finishes computes bounds
  // over unmeasured nodes and parks the camera off the map.
  const nodesInitialized = useNodesInitialized();
  const text = messages(locale);
  const features = graph?.features ?? [];
  const selectedFeature = features.find((feature) => feature.id === selectedFeatureId);
  const selectedVariant = selectedFeature?.variants.find((variant) => variant.id === selectedVariantId) ?? selectedFeature?.variants[0];
  const previousVariant = selectedFeature?.variants.find((variant) => variant.id === previousVariantId);
  const frame = useMemo(() => buildSimulationFrame(selectedFeature, selectedVariant, stepIndex), [selectedFeature, selectedVariant, stepIndex]);
  const transition = useMemo(() => branchTransitioning ? compareVariants(previousVariant, selectedVariant) : undefined, [branchTransitioning, previousVariant, selectedVariant]);
  const layoutStorageKey = graph ? `${LAYOUT_PREFIX}:${graph.project.root}:${graph.graphType}` : undefined;

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => () => {
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
    if (spotlightTimerRef.current) window.clearTimeout(spotlightTimerRef.current);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = locale === "zh-CN" ? "Agent Runtime Map · 智能体运行逻辑图" : "Agent Runtime Map";
  }, [locale]);
  const loadGraphs = useCallback(() => {
    fetch("./graph.json", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`graph.json (${response.status})`);
        return (await response.json()) as LogicGraph;
      })
      .then((nextGraph) => {
        setGraph(nextGraph);
        void fetch("./raw-graph.json", { cache: "no-store" })
          .then((response) => response.ok ? response.json() as Promise<RawCodeGraph> : undefined)
          .then((nextRawGraph) => nextRawGraph && setRawGraph(nextRawGraph))
          .catch(() => undefined);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);
  useEffect(() => {
    // report.html embeds the graph so the same app renders with no server behind it.
    const embedded = window as { __ARM_GRAPH__?: LogicGraph; __ARM_RAW_GRAPH__?: RawCodeGraph };
    if (embedded.__ARM_GRAPH__) {
      setGraph(embedded.__ARM_GRAPH__);
      if (embedded.__ARM_RAW_GRAPH__) setRawGraph(embedded.__ARM_RAW_GRAPH__);
      return;
    }
    loadGraphs();
  }, [loadGraphs]);
  useEffect(() => {
    // A continuous map publishes manifest.json next to the graph; polling its buildId
    // is what makes the open Viewer follow `agent-runtime-map watch`. Where there is
    // no manifest (a one-shot serve, a file:// report), polling stops on first miss.
    let stopped = false;
    let knownBuildId: string | undefined;
    const interval = window.setInterval(() => {
      fetch("./manifest.json", { cache: "no-store" })
        .then(async (response) => {
          if (stopped) return;
          if (!response.ok) throw new Error("no manifest");
          const manifest = (await response.json()) as { buildId?: string };
          if (!manifest.buildId) return;
          if (knownBuildId === undefined) { knownBuildId = manifest.buildId; return; }
          if (manifest.buildId !== knownBuildId) {
            knownBuildId = manifest.buildId;
            loadGraphs();
          }
        })
        .catch(() => { window.clearInterval(interval); });
    }, 2000);
    return () => { stopped = true; window.clearInterval(interval); };
  }, [loadGraphs]);
  useEffect(() => {
    if (!graph) return;
    const byId = new Map(graph.nodes.map((item) => [item.id, item]));
    const flowNodes = graph.nodes.map((node) => toFlowNode(node, locale, byId, viewMode));
    const flowEdges = graph.edges.map((edge) => toFlowEdge(edge, "global", graph, locale));
    void layoutGraph(flowNodes, flowEdges).then((layouted) => {
      const baseLayout = captureLayout(layouted);
      const savedLayout = typeof window === "undefined" || !layoutStorageKey ? undefined : parseLayoutPositions(window.localStorage.getItem(layoutStorageKey));
      const restored = applyLayoutPositions(layouted, savedLayout) as Node<BlueprintLogicNodeData>[];
      baseLayoutRef.current = baseLayout;
      setNodes(restored);
      setPinnedIds(new Set(restored.filter((node) => movedFromBase(node, baseLayout)).map((node) => node.id)));
      setLayoutRevision((revision) => revision + 1);
      window.setTimeout(() => fitView({ padding: 0.14, duration: reduceMotion ? 0 : 500 }), 20);
    });
    // Neither `locale` nor `viewMode` belongs here: they change what a node says,
    // never where it sits. Listing them would re-run ELK and throw away the
    // reader's viewport every time they switched language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitView, graph, layoutStorageKey, reduceMotion]);
  useEffect(() => {
    if (!graph || selectedFeatureId !== undefined) return;
    setSelectedFeatureId(graph.features.find((feature) => feature.health === "healthy")?.id ?? graph.features[0]?.id ?? null);
  }, [graph, selectedFeatureId]);
  useEffect(() => {
    setSelectedVariantId(selectedFeature?.variants[0]?.id);
    setPreviousVariantId(undefined);
    setBranchTransitioning(false);
    setStepIndex(-1);
    setPlaying(false);
  }, [selectedFeature?.id]);
  useEffect(() => {
    if (!nodes.length || !selectedVariant) return;
    const focusNodes = selectedVariant.steps.slice(0, 5).flatMap((step) => {
      const node = nodes.find((candidate) => candidate.id === step.nodeIds[0]);
      return node ? [node] : [];
    });
    if (!focusNodes.length) return;
    const timer = window.setTimeout(() => fitView({ nodes: focusNodes, padding: 0.22, duration: reduceMotion ? 0 : 620, minZoom: 0.63, maxZoom: 1.08 }), 30);
    return () => window.clearTimeout(timer);
  }, [fitView, focusedId, layoutRevision, reduceMotion, selectedFeature?.id, selectedVariant?.id]);

  const focusNode = useCallback((id: string, zoom = 1.12) => {
    const node = getNode(id);
    if (!node) return;
    const width = node.measured?.width ?? node.width ?? BLUEPRINT_NODE_WIDTH;
    const height = node.measured?.height ?? node.height ?? BLUEPRINT_NODE_HEIGHT;
    setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom, duration: reduceMotion ? 0 : 420 });
  }, [getNode, reduceMotion, setCenter]);
  useEffect(() => {
    if (!cameraFollow || stepIndex < 0) return;
    const currentId = [...frame.currentNodeIds][0];
    if (!currentId) return;
    const timer = window.setTimeout(() => focusNode(currentId, 1.06), 40);
    return () => window.clearTimeout(timer);
  }, [cameraFollow, focusNode, frame.currentNodeIds, stepIndex]);
  useEffect(() => {
    if (!playing || !selectedFeature || !selectedVariant) return;
    const timer = window.setTimeout(() => {
      const next = stepIndex + 1;
      if (next >= selectedVariant.steps.length) { setPlaying(false); return; }
      setStepIndex(next);
      const nextFrame = buildSimulationFrame(selectedFeature, selectedVariant, next);
      if (nextFrame.halted || next === selectedVariant.steps.length - 1) setPlaying(false);
    }, 850 / speed);
    return () => window.clearTimeout(timer);
  }, [playing, selectedFeature, selectedVariant, speed, stepIndex]);

  // Declared before every memo that reads it: a `const` used above its own
  // declaration throws at runtime only on the render that touches it, which is
  // how a search box once blanked the whole Viewer on its first keystroke.
  const nodesById = useMemo(() => new Map((graph?.nodes ?? []).map((node) => [node.id, node])), [graph]);

  // "Everything" must not mean "every edge". The Overview level aggregates the
  // same graph — every aggregate names the real nodes it stands for, every bus
  // names the real edges it merges — so nothing is hidden, only folded.
  const overviewModel: OverviewModel | undefined = useMemo(
    () => (graph
      ? buildOverviewModel(graph, overviewLabels(locale), {
        // An aggregate standing for exactly one step follows the chosen view, so
        // the technical view is technical everywhere rather than only at the
        // levels that happen to render logic nodes.
        nodeLabel: (node) => {
          const text = resolveNodeText(node, locale, nodesById);
          return viewMode === "technical" ? text.technicalName : text.label;
        },
        featureLabel: (featureId, fallback) => {
          const feature = graph.features.find((item) => item.id === featureId);
          return feature ? resolveFeatureText(feature, graph, locale).label : fallback;
        },
      })
      : undefined),
    [graph, locale, nodesById, viewMode],
  );
  const overviewActive = Boolean(overviewModel && selectedFeatureId === null && !focusedId);
  const matchingIds = useMemo(
    () => matchingNodeIds(graph?.nodes ?? [], query, (node) => {
      const text = resolveNodeText(node, locale, nodesById);
      // The technical name is searchable in both views: a developer who knows the
      // function name should find the step without switching language first.
      return { label: `${text.label} ${text.technicalName}`, description: text.description };
    }),
    [graph, locale, nodesById, query],
  );
  const searchResults = useMemo(() => graph?.nodes.filter((node) => matchingIds.has(node.id)).slice(0, 7) ?? [], [graph, matchingIds]);
  const detailExpansion = useMemo(() => {
    if (!rawGraph || !graph || !expandedLogicIds.size) return { nodes: [] as Node[], edges: [] as Edge[] };
    return graph.nodes.flatMap((logicNode) => {
      if (!expandedLogicIds.has(logicNode.id)) return [];
      const parent = nodes.find((node) => node.id === logicNode.id);
      if (!parent) return [];
      const expansion = buildCodeDetailExpansion(logicNode, parent, rawGraph, { expandedRawIds });
      // The model stays pure; behaviour is attached here, where the state lives.
      return [{
        ...expansion,
        nodes: expansion.nodes.map((node) => {
          const detail = parseDetailNodeId(node.id);
          return detail
            ? {
              ...node,
              data: {
                ...node.data,
                onToggle: () => toggleRawDetail(detail.rawId),
                toggleLabel: `${node.data.expanded ? text.collapseDetail : text.expandDetail} ${node.data.label}`,
              },
            }
            : node;
        }),
      }];
    }).reduce((all, current) => ({ nodes: [...all.nodes, ...current.nodes], edges: [...all.edges, ...current.edges] }), { nodes: [] as Node[], edges: [] as Edge[] });
  }, [expandedLogicIds, expandedRawIds, graph, nodes, rawGraph, text, toggleRawDetail]);
  useEffect(() => {
    if (!overviewModel || !overviewActive) return;
    const flowNodes: Node<BlueprintOverviewNodeData>[] = overviewModel.nodes.map((item) => ({
      id: item.id,
      type: "overview",
      position: { x: 0, y: 0 },
      width: OVERVIEW_NODE_WIDTH,
      height: OVERVIEW_NODE_HEIGHT,
      data: {
        label: item.label,
        role: item.role,
        memberCount: item.memberIds.length,
        routeCount: item.routeCount,
        types: item.types,
        featureLabel: item.featureLabel,
        singleNodeId: item.singleNodeId,
        countsLabel: overviewCountsLabel(locale, item.memberIds.length, item.routeCount),
        openLabel: text.openAggregate,
      },
    }));
    const flowEdges = overviewModel.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }));
    let active = true;
    void layoutGraph(flowNodes, flowEdges).then((laid) => {
      if (active) setOverviewNodes(laid as Node<BlueprintOverviewNodeData>[]);
    });
    return () => { active = false; };
  }, [locale, overviewActive, overviewModel, text.openAggregate]);

  useEffect(() => {
    if (!overviewActive || !overviewNodes.length || !nodesInitialized) return;
    // React Flow adopts a new node array over several frames. Framing on the first
    // one computes bounds the store has not finished updating, which parks the
    // camera off the map; a second pass after the layout settles is what makes the
    // switch reliable rather than usually-right.
    // The layout's own coordinates are the ground truth here — this component
    // computed them. Framing from them instead of from React Flow's asynchronous
    // measurements makes the switch deterministic: fitView run before every node
    // is measured frames a subset, which reads as "half the map is missing".
    const bounds = measureBlueprintBounds(overviewNodes.map((node) => ({
      position: node.position,
      width: node.width ?? OVERVIEW_NODE_WIDTH,
      height: node.height ?? OVERVIEW_NODE_HEIGHT,
    })), 60);
    if (!bounds) return;
    const viewport = canvasRef.current?.getBoundingClientRect();
    const zoom = viewport && bounds.width > 0 && bounds.height > 0
      ? Math.max(0.2, Math.min(1.1, Math.min(viewport.width / bounds.width, viewport.height / bounds.height)))
      : 0.7;
    const timer = window.setTimeout(() => setCenter(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
      { zoom, duration: reduceMotion || document.hidden ? 0 : 360 },
    ), 40);
    return () => window.clearTimeout(timer);
  }, [nodesInitialized, overviewActive, overviewNodes, reduceMotion, setCenter]);

  const selectView = useCallback((next: ViewMode) => {
    setViewMode(next);
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, next); } catch { /* private browsing */ }
  }, []);

  const enterFocus = useCallback((nodeId: string) => {
    // Remember where the reader was, so leaving focus returns them to it rather
    // than to a blank global view they did not ask for.
    featureBeforeFocusRef.current = selectedFeatureId ?? null;
    setSelectedFeatureId(null);
    setExpandedLogicIds(new Set());
    setExpandedRawIds(new Set());
    setSelectedRaw(undefined);
    setFocusedId(nodeId);
  }, [selectedFeatureId]);
  const exitFocus = useCallback(() => {
    const restoring = featureBeforeFocusRef.current;
    setFocusedId(undefined);
    setSelectedFeatureId(restoring);
    featureBeforeFocusRef.current = null;
    // Restoring a feature reframes through the effect above; returning to the whole
    // system has nothing to trigger it, so the camera is pulled back here.
    if (!restoring) window.setTimeout(() => fitView({ padding: 0.2, duration: reduceMotion ? 0 : 620 }), 60);
  }, [fitView, reduceMotion]);
  const focusedIds = useMemo(
    () => (focusedId && graph ? collectFocusIds(graph.edges, focusedId) : undefined),
    [focusedId, graph],
  );
  const visibleLogicNodes = useMemo(() => nodes.map((node) => {
    const logicNode = nodesById.get(node.id);
    return ({
    ...node,
    className: nodeClassName(node.id, matchingIds, selectedFeature, selectedVariant, frame, transition, spotlightId, pinnedIds, expandedLogicIds),
    data: {
      ...node.data,
      // Recomputed here rather than in the layout effect, so language and view
      // change the words without moving a single node.
      ...(logicNode ? nodePresentation(logicNode, locale, nodesById, viewMode) : {}),
      // Offered only where narrowing would actually show something.
      onFocus: !focusedId && graph && canFocusNode(graph.edges, node.id) ? () => enterFocus(node.id) : undefined,
      focusLabel: text.focusStep,
    },
  });
  }), [enterFocus, expandedLogicIds, focusedId, frame, graph, locale, matchingIds, nodes, nodesById, pinnedIds, selectedFeature, selectedVariant, spotlightId, text.focusStep, transition, viewMode]);
  const openAggregate = useCallback((item: OverviewModel["nodes"][number]) => {
    // Opening a bundle is navigation, not a new view of its own: a feature
    // aggregate selects that feature, and a shared bundle focuses the step it
    // holds, so the reader always lands on real, evidence-backed nodes.
    if (item.featureId) { setSelectedFeatureId(item.featureId); return; }
    const first = item.singleNodeId ?? item.memberIds[0];
    if (first) enterFocus(first);
  }, [enterFocus]);

  const visibleNodes = useMemo(() => {
    if (overviewActive && overviewModel) {
      const byId = new Map(overviewModel.nodes.map((item) => [item.id, item]));
      return overviewNodes.map((node) => {
        const item = byId.get(node.id);
        return {
          ...node,
          selected: node.id === selectedId,
          data: { ...node.data, onOpen: item ? () => openAggregate(item) : undefined },
        };
      });
    }
    if (!graph) return [...visibleLogicNodes, ...detailExpansion.nodes];
    const activeNodeIds = focusedIds ?? (selectedVariant ? new Set(selectedVariant.nodeIds) : undefined);
    // Hidden rather than removed. Taking a node out of the flow drops React Flow's
    // measurement of it, and a fitView over unmeasured nodes computes no bounds at
    // all — the camera snapped to the origin and the map looked empty.
    const framed = focusedIds ? nodes.filter((node) => focusedIds.has(node.id)) : nodes;
    const groups = buildBlueprintGroupNodes(framed, graph, activeNodeIds, groupLabels(locale));
    const logic = visibleLogicNodes.map((node) => (focusedIds && !focusedIds.has(node.id) ? { ...node, hidden: true } : node));
    return [...groups, ...logic, ...detailExpansion.nodes];
  }, [detailExpansion.nodes, focusedIds, graph, locale, nodes, openAggregate, overviewActive, overviewModel, overviewNodes, selectedId, selectedVariant, visibleLogicNodes]);
  const visibleEdges = useMemo(() => {
    if (overviewActive && overviewModel) {
      return overviewModel.edges.map((edge) => {
        const control = blueprintControlAppearance(edge.control);
        const appearance = blueprintEdgeAppearance("global", edge.dataFlow);
        const color = control.color ?? appearance.color;
        const merged = edge.edgeIds.length;
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: "playback",
          className: `chain-edge chain-edge--bus${edge.control ? ` chain-edge--${edge.control}` : ""}`,
          label: merged > 1 ? `×${merged}` : undefined,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
          style: {
            stroke: color,
            // A bus carrying more real edges is drawn heavier, so weight on the
            // Overview means what it looks like it means.
            strokeWidth: Math.min(4.2, 1.8 + Math.log2(merged + 1) * 0.8) * control.widthScale,
            opacity: 0.9,
            strokeDasharray: control.dash ?? appearance.dash,
          },
          data: { labelVisible: hoveredEdgeId === edge.id || selectedEdgeId === edge.id, loopback: control.loopback },
        } satisfies Edge;
      });
    }
    const graphEdges = graph?.edges.map((edge) => {
      let state: EdgeVisualState = "global";
      if (selectedVariant) {
        state = selectedVariant.edgeIds.includes(edge.id) ? "path" : "outside";
        if (frame.reachedEdgeIds.has(edge.id)) state = "reached";
        if (frame.currentEdgeIds.has(edge.id)) state = "current";
        if (frame.warningEdgeIds.has(edge.id)) state = "warning";
        if (frame.errorEdgeIds.has(edge.id) || (frame.errorNodeIds.has(edge.target) && frame.reachedEdgeIds.has(edge.id))) state = "error";
      }
      const branchClass = !transition ? undefined : transition.enteringEdgeIds.has(edge.id) ? "is-branch-entering" : transition.exitingEdgeIds.has(edge.id) ? "is-branch-exiting" : transition.sharedEdgeIds.has(edge.id) ? "is-branch-shared" : undefined;
      const labelVisible = shouldShowEdgeLabel({
        hovered: hoveredEdgeId === edge.id,
        selected: selectedEdgeId === edge.id,
        playing: stepIndex >= 0,
        state,
      });
      return toFlowEdge(edge, state, graph!, locale, branchClass, !reduceMotion && state === "current", speed, labelVisible);
    }) ?? [];
    const focused = focusedIds
      ? graphEdges.map((edge) => (focusedIds.has(edge.source) && focusedIds.has(edge.target) ? edge : { ...edge, hidden: true }))
      : graphEdges;
    return [...focused, ...detailExpansion.edges];
  }, [detailExpansion.edges, focusedIds, frame, graph, hoveredEdgeId, locale, overviewActive, overviewModel, reduceMotion, selectedEdgeId, selectedVariant, speed, stepIndex, transition]);

  useEffect(() => {
    // The feature fit above bails without a variant, and focus deliberately has no
    // feature selected, so narrowing needs its own reframe or the map stays parked
    // wherever the global view left it.
    if (!focusedIds || !nodes.length) return;
    const target = nodes.filter((node) => focusedIds.has(node.id));
    if (!target.length) return;
    // `fitView({ nodes })` computes no bounds here and snaps the camera to the
    // origin, so the frame is derived from the positions this app already knows.
    const bounds = measureBlueprintBounds(target, 90);
    const viewport = canvasRef.current?.getBoundingClientRect();
    // A canvas with no measured size cannot produce a meaningful frame. Leaving the
    // camera where it is beats sending it somewhere derived from zeros.
    if (!bounds || !viewport?.width || !viewport.height) return;
    const zoom = Math.min(1.05, Math.max(0.32, Math.min(viewport.width / bounds.width, viewport.height / bounds.height)));
    const timer = window.setTimeout(
      () => setCenter(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { zoom, duration: reduceMotion ? 0 : 620 }),
      80,
    );
    return () => window.clearTimeout(timer);
  }, [focusedIds, nodes, reduceMotion, setCenter]);

  const persistLayout = useCallback((positions: LayoutPositions) => {
    if (typeof window !== "undefined" && layoutStorageKey) window.localStorage.setItem(layoutStorageKey, JSON.stringify(positions));
  }, [layoutStorageKey]);
  const updatePins = useCallback((positionedNodes: Node[]) => {
    const baseLayout = baseLayoutRef.current;
    if (baseLayout) setPinnedIds(new Set(positionedNodes.filter((node) => movedFromBase(node, baseLayout)).map((node) => node.id)));
  }, []);
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const forSet = <T extends Node>(current: T[]) =>
      changes.filter((change) => "id" in change && current.some((node) => node.id === change.id));
    setNodes((current) => applyNodeChanges(forSet(current), current) as Node<BlueprintLogicNodeData>[]);
    // Overview aggregates live in their own array. Without this they never receive
    // their measurements, and React Flow refuses to draw an edge between two nodes
    // whose bounds it does not know — the aggregates appeared with no buses at all.
    setOverviewNodes((current) => (current.length
      ? applyNodeChanges(forSet(current), current) as Node<BlueprintOverviewNodeData>[]
      : current));
  }, []);
  const onNodeDragStart = useCallback((_event: MouseEvent | TouchEvent, node: Node) => {
    if (nodesRef.current.some((item) => item.id === node.id)) dragStartLayoutRef.current = captureLayout(nodesRef.current);
  }, []);
  const onNodeDragStop = useCallback((_event: MouseEvent | TouchEvent, node: Node) => {
    if (!nodesRef.current.some((item) => item.id === node.id)) return;
    const before = dragStartLayoutRef.current;
    setNodes((current) => {
      const updated = current.map((item) => item.id === node.id ? { ...item, position: node.position } : item);
      const after = captureLayout(updated);
      if (before && JSON.stringify(before) !== JSON.stringify(after)) setLayoutHistory((history) => [...history.slice(-19), before]);
      persistLayout(after);
      updatePins(updated);
      return updated;
    });
  }, [persistLayout, updatePins]);

  const selected = graph?.nodes.find((node) => node.id === selectedId);
  const selectedRawNode = useMemo(
    () => (selectedRaw ? rawGraph?.nodes.find((node) => node.id === selectedRaw.rawId) : undefined),
    [rawGraph, selectedRaw],
  );
  const selectNode = useCallback((_event: React.MouseEvent, node: Node) => {
    // A raw child used to select its parent, which put the parent's source range in
    // the drawer and left the child's own evidence unreachable.
    const detail = node.type === "codeDetail" ? parseDetailNodeId(node.id) : undefined;
    if (detail) { setSelectedRaw(detail); setSelectedId(detail.logicId); return; }
    setSelectedRaw(undefined);
    setSelectedId(node.id);
  }, []);
  const toggleDetails = useCallback((_event: React.MouseEvent, node: Node) => {
    if (!rawGraph) return;
    const detail = node.type === "codeDetail" ? parseDetailNodeId(node.id) : undefined;
    if (detail) {
      // Depth is capped in the model, so a second-level child simply has nothing to open.
      const data = node.data as { expandable?: boolean };
      if (!data.expandable) return;
      setExpandedRawIds((current) => { const next = new Set(current); if (next.has(detail.rawId)) next.delete(detail.rawId); else next.add(detail.rawId); return next; });
      return;
    }
    if (node.type !== "logic") return;
    setExpandedLogicIds((current) => {
      const next = new Set(current);
      if (next.has(node.id)) { next.delete(node.id); setExpandedRawIds(new Set()); setSelectedRaw(undefined); }
      else next.add(node.id);
      return next;
    });
  }, [rawGraph]);
  const selectFeature = (featureId: string | null) => { setSelectedFeatureId(featureId); setCameraFollow(true); };
  const selectVariant = (variantId: string) => {
    if (selectedVariantId === variantId) return;
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
    setPreviousVariantId(selectedVariantId); setBranchTransitioning(true); setSelectedVariantId(variantId); setStepIndex(-1); setPlaying(false);
    transitionTimerRef.current = window.setTimeout(() => { setBranchTransitioning(false); setPreviousVariantId(undefined); }, reduceMotion ? 0 : 420);
  };
  const selectSearchResult = (id: string) => {
    setSelectedId(id); setCameraFollow(false); setSpotlightId(id); focusNode(id, 1.18);
    if (spotlightTimerRef.current) window.clearTimeout(spotlightTimerRef.current);
    spotlightTimerRef.current = window.setTimeout(() => setSpotlightId(undefined), reduceMotion ? 0 : 1500);
  };
  const play = () => { if (!selectedVariant?.steps.length) return; if (frame.outcome === "complete" || frame.outcome === "error") setStepIndex(-1); setCameraFollow(true); setPlaying(true); };
  const next = () => { setPlaying(false); setCameraFollow(true); if (selectedVariant) setStepIndex(nextSimulationStep(selectedVariant, stepIndex)); };
  const reset = () => { setPlaying(false); setStepIndex(-1); };
  const undoLayout = () => {
    const previous = layoutHistory.at(-1); if (!previous) return;
    const restored = applyLayoutPositions(nodesRef.current, previous) as Node<BlueprintLogicNodeData>[];
    setNodes(restored); setLayoutHistory((history) => history.slice(0, -1)); persistLayout(previous); updatePins(restored);
  };
  const resetLayout = () => {
    const base = baseLayoutRef.current; if (!base) return;
    const current = captureLayout(nodesRef.current); const restored = applyLayoutPositions(nodesRef.current, base) as Node<BlueprintLogicNodeData>[];
    setLayoutHistory((history) => [...history.slice(-19), current]); setNodes(restored); setPinnedIds(new Set());
    if (typeof window !== "undefined" && layoutStorageKey) window.localStorage.removeItem(layoutStorageKey);
  };
  const switchLocale = () => { const nextLocale = locale === "zh-CN" ? "en" : "zh-CN"; rememberViewerLocale(nextLocale); setLocale(nextLocale); };
  const updateSemanticZoom = useCallback((zoom: number) => {
    const progress = blueprintSemanticZoomProgress(zoom); const canvas = canvasRef.current;
    canvas?.style.setProperty("--semantic-logic-progress", progress.logic.toFixed(4)); canvas?.style.setProperty("--semantic-evidence-progress", progress.evidence.toFixed(4));
    const nextLevel = blueprintDetailLevelForZoom(zoom, detailLevelRef.current);
    if (nextLevel !== detailLevelRef.current) { detailLevelRef.current = nextLevel; setDetailLevel(nextLevel); }
  }, []);

  if (error) return <ErrorState message={`${text.loadError}: ${error}`} locale={locale} />;
  if (!graph) return <LoadingState locale={locale} />;
  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand__mark"><GitFork size={18} /></span><span>Agent Runtime Map</span></div><div className="breadcrumb"><span>{graph.project.name}</span><ChevronRight size={14} /><strong>{graph.graphType === "runtime_logic" ? text.runtimeLogic : text.productLogic}</strong></div><div className="topbar__actions"><span className="topbar__meta">{text.generated} {new Date(graph.generatedAt).toLocaleString(locale)}</span><button className="locale-switch" onClick={switchLocale} title={text.switchLanguage}>{locale === "zh-CN" ? "EN" : "中文"}</button></div></header>
    <aside className="sidebar">
      <div className="sidebar__intro"><span className="eyebrow">{text.projectMap}</span><h1>{localizeGraphTitle(graph, locale)}</h1><p>{localizeGraphDescription(graph, locale)}</p></div>
      <div className="stats"><Stat value={features.length} label={text.features} /><Stat value={graph.nodes.length} label={text.logicNodes} /><Stat value={graph.project.filesScanned} label={text.files} /></div>
      <section className="feature-circuits" aria-label={text.featureCircuits}><div className="section-heading"><span className="eyebrow">{text.featureCircuits}</span><ListTree size={14} /></div><p className="section-hint">{text.featureHint}</p><button className={`feature-card feature-card--global ${selectedFeatureId === null ? "is-active" : ""}`} onClick={() => selectFeature(null)}><span className="feature-card__icon"><Activity size={14} /></span><span><strong>{text.wholeSystem}</strong><small>{text.globalView}</small></span></button><div className="feature-list">{features.map((feature) => <button className={`feature-card feature-card--${feature.health} ${feature.id === selectedFeatureId ? "is-active" : ""}`} data-feature-id={feature.id} data-health={feature.health} key={feature.id} onClick={() => selectFeature(feature.id)}><span className="feature-card__icon"><HealthIcon health={feature.health} /></span><span><strong>{resolveFeatureText(feature, graph, locale).label}</strong><small>{chainHealthLabel(feature.health, locale)} · {Math.round(feature.confidence * 100)}%</small></span><ChevronRight size={13} /></button>)}</div></section>
      {selectedFeature && selectedVariant ? <FeatureInspector feature={selectedFeature} variant={selectedVariant} graph={graph} locale={locale} playing={playing} speed={speed} frame={frame} cameraFollow={cameraFollow} onVariant={selectVariant} onPlay={play} onPause={() => setPlaying(false)} onNext={next} onReset={reset} onSpeed={setSpeed} onSelectNode={setSelectedId} onResumeFollow={() => setCameraFollow(true)} /> : <div className="feature-empty"><CircleDotDashed size={16} /><span>{text.selectFeature}</span></div>}
      <div className="search-wrap"><label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && searchResults[0]) selectSearchResult(searchResults[0].id); }} placeholder={text.search} />{query && <button onClick={() => setQuery("")} aria-label={text.clearSearch}><X size={14} /></button>}</label>{query && <div className="search-results"><span className="eyebrow">{text.searchResults} · {searchResults.length}</span>{searchResults.length ? searchResults.map((node) => <button key={node.id} onClick={() => selectSearchResult(node.id)}><strong>{resolveNodeText(node, locale, nodesById).label}</strong><small>{node.sources[0]?.file ?? nodeTypeLabel(node.type, locale)}</small></button>) : <p>{text.noSearchResults}</p>}</div>}</div>
      <div className="sidebar__footer"><Braces size={14} /> {text.staticAnalysis}</div>
    </aside>
    <section className="canvas" aria-label={text.logicGraph} data-lod={overviewActive ? "overview" : focusedId ? "detail" : selectedFeature ? "feature" : "overview"} data-detail-level={detailLevel} data-navigating={navigating ? "true" : "false"} ref={canvasRef}>
      {focusedId
        ? <div className="canvas-caption canvas-caption--focus"><button onClick={exitFocus} title={text.exitFocus}><ChevronLeft size={12} />{text.wholeSystem}</button><strong>{localizeNode(graph.nodes.find((node) => node.id === focusedId)!, locale, nodesById).label}</strong><small>{text.focusHint}</small></div>
        : <div className="canvas-caption"><span className="canvas-caption__mark" /><strong>{selectedFeature ? resolveFeatureText(selectedFeature, graph, locale).label : text.wholeSystem}</strong><small>{selectedVariant ? localizeVariantLabel(selectedVariant, graph, locale) : overviewActive ? text.overviewHint : text.globalView}</small></div>}
      <div className="semantic-zoom" aria-live="polite"><span>{text.zoomLevel}</span><strong>{semanticZoomLabel(detailLevel, locale)}</strong><div className="semantic-zoom__levels" aria-hidden="true">{(["overview", "logic", "evidence"] as const).map((level) => <i className={level === detailLevel ? "is-active" : ""} key={level} />)}</div><small>{text.semanticZoomHint}</small></div>
      <div className="canvas-help"><Crosshair size={13} /><span>{text.detailHint}</span></div>
      <div className="view-toolbar" aria-label={text.viewMode}>
        <button className={viewMode === "business" ? "is-active" : ""} onClick={() => selectView("business")}>{text.businessView}</button>
        <button className={viewMode === "technical" ? "is-active" : ""} onClick={() => selectView("technical")}>{text.technicalView}</button>
      </div>
      <div className="layout-toolbar" aria-label={text.layout}><span><Pin size={12} /> {pinnedIds.size} {text.pinnedNodes}</span><button onClick={undoLayout} disabled={!layoutHistory.length} title={text.undoLayout}><Undo2 size={13} /></button><button onClick={resetLayout} title={text.resetLayout}><RotateCcw size={13} /></button></div>
      <ReactFlow nodes={visibleNodes} edges={visibleEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onNodeDragStart={onNodeDragStart} onNodeDragStop={onNodeDragStop} onNodeClick={selectNode} onNodeDoubleClick={toggleDetails} onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)} onEdgeMouseLeave={() => setHoveredEdgeId(undefined)} onEdgeClick={(_event, edge) => setSelectedEdgeId(edge.id)} onPaneClick={() => { setSelectedId(undefined); setSelectedRaw(undefined); setSelectedEdgeId(undefined); }} onMoveStart={(event) => { setNavigating(true); if (event) setCameraFollow(false); }} onMove={(_event, viewport) => updateSemanticZoom(viewport.zoom)} onMoveEnd={() => setNavigating(false)} nodesDraggable nodesConnectable={false} elementsSelectable minZoom={0.2} maxZoom={2.2} fitView proOptions={{ hideAttribution: true }}><Controls showInteractive={false} position="bottom-left" /><MiniMap position="bottom-right" pannable zoomable nodeStrokeWidth={2} maskColor="rgba(240, 244, 248, 0.7)" /></ReactFlow>
    </section>
    {selectedRawNode
      ? <RawEvidencePanel rawNode={selectedRawNode} parent={selected} locale={locale} onParent={() => setSelectedRaw(undefined)} onClose={() => { setSelectedRaw(undefined); setSelectedId(undefined); }} />
      : selected && <EvidencePanel node={selected} locale={locale} nodesById={nodesById} onClose={() => setSelectedId(undefined)} />}
  </main>;
}

function FeatureInspector({ feature, variant, graph, locale, playing, speed, frame, cameraFollow, onVariant, onPlay, onPause, onNext, onReset, onSpeed, onSelectNode, onResumeFollow }: { feature: FeatureScenario; variant: FeaturePathVariant; graph: LogicGraph; locale: UiLocale; playing: boolean; speed: number; frame: SimulationFrame; cameraFollow: boolean; onVariant: (id: string) => void; onPlay: () => void; onPause: () => void; onNext: () => void; onReset: () => void; onSpeed: (speed: number) => void; onSelectNode: (id: string) => void; onResumeFollow: () => void; }) {
  const text = messages(locale); const currentNames = [...frame.currentNodeIds].flatMap((id) => { const node = graph.nodes.find((candidate) => candidate.id === id); return node ? [localizeNode(node, locale).label] : []; }); const status = frame.outcome === "idle" ? text.ready : frame.outcome === "error" ? text.stopped : frame.outcome === "complete" ? text.completed : text.running;
  return <section className="chain-inspector" data-outcome={frame.outcome}><div className="section-heading"><span className="eyebrow">{text.choosePath}</span><span>{feature.variants.length}</span></div><select value={variant.id} onChange={(event) => onVariant(event.target.value)} aria-label={text.choosePath}>{feature.variants.map((item) => <option value={item.id} key={item.id}>{localizeVariantLabel(item, graph, locale)}</option>)}</select><div className={`player-status player-status--${frame.outcome}`}><span className="player-status__pulse" /><span><strong>{status}</strong><small>{currentNames.join(" · ") || `${text.step} 0 / ${variant.steps.length}`}</small></span><b>{Math.max(0, frame.stepIndex + 1)}/{variant.steps.length}</b></div><div className="player-controls" aria-label={text.chainCheck}><button onClick={playing ? onPause : onPlay} title={playing ? text.pause : text.play} aria-label={playing ? text.pause : text.play}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><button onClick={onNext} title={text.nextStep} aria-label={text.nextStep}><SkipForward size={14} /></button><button onClick={onReset} title={text.replay} aria-label={text.replay}><RotateCcw size={14} /></button><div className="speed-control"><span>{text.speed}</span>{[0.5, 1, 2].map((value) => <button className={speed === value ? "is-active" : ""} onClick={() => onSpeed(value)} key={value}>{value}×</button>)}</div></div><button className={`camera-follow ${cameraFollow ? "is-active" : ""}`} onClick={onResumeFollow}><Crosshair size={12} /><span>{cameraFollow ? text.cameraFollowing : text.resumeFollow}</span></button><div className="diagnostics"><div className="section-heading"><span className="eyebrow">{text.diagnostics}</span><span>{feature.diagnostics.length}</span></div>{!feature.diagnostics.length && <div className="diagnostics__clear"><CheckCircle2 size={13} />{text.noDiagnostics}</div>}{feature.diagnostics.map((diagnostic) => { const localized = localizeDiagnostic(diagnostic, graph, locale); return <button className={`diagnostic diagnostic--${diagnostic.severity}`} data-diagnostic-code={diagnostic.code} key={diagnostic.id} onClick={() => diagnostic.nodeId && graph.nodes.some((node) => node.id === diagnostic.nodeId) && onSelectNode(diagnostic.nodeId)}><AlertTriangle size={13} /><span><strong>{localized.message}</strong><small>{text.recommendation}：{localized.suggestion}</small></span></button>; })}</div></section>;
}

function nodeClassName(nodeId: string, matchingIds: Set<string>, feature: FeatureScenario | undefined, variant: FeaturePathVariant | undefined, frame: SimulationFrame, transition: ReturnType<typeof compareVariants> | undefined, spotlightId: string | undefined, pinnedIds: Set<string>, expandedLogicIds: Set<string>): string {
  const classes: string[] = []; if (!matchingIds.has(nodeId)) classes.push("is-dimmed"); if (spotlightId === nodeId) classes.push("is-search-spotlight"); if (pinnedIds.has(nodeId)) classes.push("is-pinned"); if (expandedLogicIds.has(nodeId)) classes.push("is-expanded"); if (transition?.enteringNodeIds.has(nodeId)) classes.push("is-branch-entering"); if (transition?.exitingNodeIds.has(nodeId)) classes.push("is-branch-exiting"); if (transition?.sharedNodeIds.has(nodeId)) classes.push("is-branch-shared"); if (!feature || !variant) return classes.join(" "); if (!variant.nodeIds.includes(nodeId)) classes.push("is-outside-path"); else if (frame.errorNodeIds.has(nodeId)) classes.push("is-chain-error"); else if (frame.warningNodeIds.has(nodeId)) classes.push("is-chain-warning"); else if (frame.currentNodeIds.has(nodeId)) classes.push("is-current"); else if (frame.completedNodeIds.has(nodeId)) classes.push("is-chain-complete"); else classes.push("is-path-pending"); return classes.join(" ");
}

/**
 * Product context is kept visually apart from source evidence, because it is a
 * different kind of claim: the code was read, whereas this is what the project — or
 * the person running the tool — says it does. Saying "code only" out loud matters as
 * much as showing a match, so a reader is never left guessing which one they have.
 */
function ProductContext({ product, locale }: { product?: ProductEvidence; locale: UiLocale }) {
  const text = messages(locale);
  return <div className="product-card">
    <span className="eyebrow">{text.productContext}</span>
    {!product
      ? <p className="product-card__empty">{text.productCodeOnly}</p>
      : <>
        <div className="product-card__claim"><strong>{product.label}</strong><em>{productOriginLabel(product.origin, locale)}</em></div>
        <div className="product-card__match"><span>{text.productMatch}</span><div className="confidence-track"><i style={{ width: `${product.match * 100}%` }} /></div><strong>{Math.round(product.match * 100)}%</strong></div>
        <small>{text.productMatchedOn}: {productMatchText(product, locale)}</small>
        {product.sources.map((item) => <code className="product-card__source" key={`${item.file}:${item.startLine}`}>{item.file}:{item.startLine}</code>)}
      </>}
  </div>;
}

/**
 * A node's identity and place on the canvas. Deliberately free of language and of
 * the chosen view: the two are `nodePresentation`'s business, and keeping them out
 * of here is what makes "switching view never changes topology" structural rather
 * than a rule someone has to remember.
 */
function toFlowNode(node: LogicGraphNode, locale: UiLocale, nodesById: ReadonlyMap<string, LogicGraphNode> | undefined, view: ViewMode = "business"): Node<BlueprintLogicNodeData> {
  return { id: node.id, type: "logic", position: { x: 0, y: 0 }, data: nodePresentation(node, locale, nodesById, view) };
}

/** Everything a node *says*. It cannot reach an id, a position, or a parent. */
function nodePresentation(node: LogicGraphNode, locale: UiLocale, nodesById: ReadonlyMap<string, LogicGraphNode> | undefined, view: ViewMode): BlueprintLogicNodeData {
  const text = resolveNodeText(node, locale, nodesById);
  const primarySource = node.sources[0];
  const sourceDetail = primarySource
    ? `${primarySource.file}:${primarySource.startLine}${primarySource.symbol ? ` · ${primarySource.symbol}` : ""}`
    : undefined;
  // The technical view answers "which code is this?", so it leads with the name as
  // written and the file it lives in. The business view never shows either on the
  // canvas — that mixture of Chinese prose and English identifiers is the thing
  // this whole pass exists to end — and keeps them one click away in the drawer.
  const technical = view === "technical";
  return {
    label: technical ? text.technicalName : text.label,
    description: technical ? (sourceDetail ?? nodeTypeLabel(node.type, locale)) : text.description,
    nodeType: node.type,
    typeLabel: nodeTypeLabel(node.type, locale),
    confidence: node.confidence,
    pending: !technical && text.pending,
    sourceText: sourceCountText(node.sources.length, locale),
    sourceDetail,
    inferenceText: inferenceMethodLabel(node.inference.method, locale),
  };
}
function semanticZoomLabel(level: BlueprintDetailLevel, locale: UiLocale): string { return locale === "zh-CN" ? { overview: "全局层", logic: "逻辑层", evidence: "证据层" }[level] : { overview: "Overview", logic: "Logic", evidence: "Evidence" }[level]; }
type EdgeVisualState = BlueprintEdgeState;
function toFlowEdge(edge: LogicGraph["edges"][number], state: EdgeVisualState, graph: LogicGraph, locale: UiLocale, branchClass?: string, showToken = false, speed = 1, labelVisible = false): Edge {
  const dataFlow = edge.type === "data_flow";
  const appearance = blueprintEdgeAppearance(state, dataFlow);
  const control = blueprintControlAppearance(edge.control);
  // State colour wins while a simulation is running — the reader is watching the
  // route, not the control kinds — and the control colour speaks otherwise.
  const stateColoured = state === "current" || state === "reached" || state === "error" || state === "warning";
  const color = stateColoured ? appearance.color : control.color ?? appearance.color;
  return {
    id: edge.id, source: edge.source, target: edge.target, type: "playback", animated: false,
    // The compiler now says what kind of connection this is, in the reader's
    // language. `edge.label` is the older English string and only stands in for a
    // graph compiled before that existed.
    label: resolveEdgeText(edge, locale) ?? edge.label ?? edgeFlowLabel(edge, graph, locale),
    className: `chain-edge chain-edge--${state}${edge.control ? ` chain-edge--${edge.control}` : ""}${branchClass ? ` ${branchClass}` : ""}`,
    markerEnd: { type: MarkerType.ArrowClosed, width: 17, height: 17, color },
    style: {
      stroke: color,
      strokeWidth: appearance.width * control.widthScale,
      opacity: appearance.opacity,
      strokeDasharray: control.dash ?? appearance.dash,
    },
    data: { showToken, tokenColor: color, tokenDuration: 0.9 / speed, labelVisible, loopback: control.loopback },
  };
}
function edgeFlowLabel(edge: LogicGraph["edges"][number], graph: LogicGraph, locale: UiLocale): string { const source = graph.nodes.find((node) => node.id === edge.source); const target = graph.nodes.find((node) => node.id === edge.target); if (source?.type === "user_action" && target?.type === "entrypoint") return "HTTPS"; if (edge.type === "data_flow" && target?.type === "data") return locale === "zh-CN" ? "读 / 写" : "read / write"; if (target?.type === "external_system") return "API"; if (target?.type === "model") return locale === "zh-CN" ? "模型" : "model"; if (target?.type === "tool") return locale === "zh-CN" ? "工具" : "tool"; if (target?.type === "human_gate") return locale === "zh-CN" ? "人工确认" : "approve"; if (target?.type === "workflow" || target?.type === "ai_process") return locale === "zh-CN" ? "调用" : "invoke"; if (target?.type === "result") return locale === "zh-CN" ? "返回" : "return"; return locale === "zh-CN" ? "执行" : "flow"; }
function HealthIcon({ health }: { health: ChainHealth }) { return health === "healthy" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />; }

interface SourceSnippet { file: string; startLine: number; endLine: number; highlightStart: number; highlightEnd: number; lines: Array<{ number: number; text: string }>; }
/**
 * The source list and its preview are the same interaction whether the reader is
 * looking at a logic node or at one raw child of it, so both panels share it rather
 * than keeping two copies of the fetch, the bounds, and the highlight.
 */
function SourceEvidence({ sources, locale, heading }: { sources: SourceLocation[]; locale: UiLocale; heading: string }) {
  const text = messages(locale);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [snippet, setSnippet] = useState<SourceSnippet>();
  const [sourceError, setSourceError] = useState(false);
  const key = sources.map((item) => `${item.file}:${item.startLine}`).join("|");
  const source = sources[sourceIndex];
  useEffect(() => { setSourceIndex(0); }, [key]);
  useEffect(() => {
    if (!source) return;
    let active = true;
    setSnippet(undefined);
    setSourceError(false);
    const params = new URLSearchParams({ file: source.file, start: String(source.startLine), end: String(source.endLine ?? source.startLine) });
    fetch(`./source.json?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error(String(response.status)); return await response.json() as SourceSnippet; })
      .then((next) => active && setSnippet(next))
      .catch(() => active && setSourceError(true));
    return () => { active = false; };
  }, [source]);
  return <>
    <div className="evidence-list"><span className="eyebrow">{heading}</span>{sources.map((item, index) => <button className={sourceIndex === index ? "is-active" : ""} key={`${item.file}:${item.startLine}`} onClick={() => setSourceIndex(index)}><code>{item.file}</code><span>{text.lines} {item.startLine}{item.endLine && item.endLine !== item.startLine ? `–${item.endLine}` : ""}</span>{item.symbol && <small>{item.symbol}</small>}</button>)}</div>
    <section className="source-preview"><span className="eyebrow">{text.sourceCode}</span>{!source || sourceError ? <p>{text.sourceUnavailable}</p> : !snippet ? <p>{text.loadingSource}</p> : <pre>{snippet.lines.map((line) => <code className={line.number >= snippet.highlightStart && line.number <= snippet.highlightEnd ? "is-highlighted" : ""} key={line.number}><i>{line.number}</i><span>{line.text || " "}</span></code>)}</pre>}</section>
  </>;
}

/**
 * The third view: business meaning and technical basis at the same time. The
 * canvas shows one or the other so it stays readable; this panel exists so a
 * reader who wants to check a name never has to switch modes to do it.
 */
function EvidencePanel({ node, locale, nodesById, onClose }: { node: LogicGraphNode; locale: UiLocale; nodesById: ReadonlyMap<string, LogicGraphNode>; onClose: () => void }) {
  const text = messages(locale); const localized = resolveNodeText(node, locale, nodesById);
  return <aside className="evidence-panel"><div className="evidence-panel__header"><div><span className="eyebrow">{text.selectedLogic}</span><h2>{localized.label}{localized.pending && <em className="pending-flag">{text.pendingBadge}</em>}</h2></div><button onClick={onClose} aria-label={text.closeEvidence}><PanelRightClose size={19} /></button></div><p className="evidence-panel__description">{localized.description}</p><div className="name-source"><span>{text.nameSource}</span><strong>{labelSourceLabel(localized.source, locale)}</strong><code>{localized.technicalName}</code></div><div className="confidence-card"><div><span>{text.confidence}</span><strong>{Math.round(node.confidence * 100)}%</strong></div><div className="confidence-track"><i style={{ width: `${node.confidence * 100}%` }} /></div><small>{inferenceMethodLabel(node.inference.method, locale)} · {node.inference.explanation}</small></div><ProductContext product={node.product} locale={locale} /><SourceEvidence sources={node.sources} locale={locale} heading={text.sourceEvidence} /><div className="raw-reference"><span>{text.rawReferences}</span><code>{node.rawNodeIds.join("\n")}</code></div></aside>;
}

/**
 * A raw child keeps its own source range selected, and a breadcrumb back to the step
 * it belongs to. Without the breadcrumb a reader who drilled two levels down has no
 * way back except closing the drawer and losing the place they were inspecting.
 */
function RawEvidencePanel({ rawNode, parent, locale, onParent, onClose }: {
  rawNode: RawCodeNode;
  parent: LogicGraphNode | undefined;
  locale: UiLocale;
  onParent: () => void;
  onClose: () => void;
}) {
  const text = messages(locale);
  const sources = rawNode.evidence.map((item: typeof rawNode.evidence[number]) => item.source);
  const strongest = rawNode.evidence.reduce<typeof rawNode.evidence[number] | undefined>(
    (best, item) => (best && best.confidence >= item.confidence ? best : item),
    undefined,
  );
  return <aside className="evidence-panel">
    <div className="evidence-panel__header">
      <div>
        <span className="eyebrow">{text.selectedCode}</span>
        <nav className="evidence-breadcrumb">
          {parent && <button onClick={onParent}><ChevronLeft size={12} />{localizeNode(parent, locale).label}</button>}
          <span>{rawNode.name}</span>
        </nav>
      </div>
      <button onClick={onClose} aria-label={text.closeEvidence}><PanelRightClose size={19} /></button>
    </div>
    <p className="evidence-panel__description">{rawNode.description ?? rawNode.qualifiedName ?? rawNode.kind.replaceAll("_", " ")}</p>
    <div className="confidence-card">
      <div><span>{text.confidence}</span><strong>{Math.round((strongest?.confidence ?? 0) * 100)}%</strong></div>
      <div className="confidence-track"><i style={{ width: `${(strongest?.confidence ?? 0) * 100}%` }} /></div>
      <small>{strongest?.method} · {strongest?.detail}</small>
    </div>
    <SourceEvidence sources={sources} locale={locale} heading={text.sourceEvidence} />
    <div className="raw-reference"><span>{text.rawReferences}</span><code>{rawNode.id}</code></div>
  </aside>;
}
function movedFromBase(node: Node, base: LayoutPositions): boolean { const expected = base[node.id]; return Boolean(expected && (Math.abs(expected.x - node.position.x) > 1 || Math.abs(expected.y - node.position.y) > 1)); }
function Stat({ value, label }: { value: number; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
function LoadingState({ locale }: { locale: UiLocale }) { const text = messages(locale); return <main className="state-screen"><span className="state-logo"><GitFork /></span><h1>{text.loadingTitle}</h1><p>{text.loadingDescription}</p><i className="loader" /></main>; }
function ErrorState({ message, locale }: { message: string; locale: UiLocale }) { const text = messages(locale); return <main className="state-screen state-screen--error"><span className="state-logo"><X /></span><h1>{text.errorTitle}</h1><p>{message}</p><code>{text.errorHint}</code></main>; }
