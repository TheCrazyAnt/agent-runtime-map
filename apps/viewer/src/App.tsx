import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
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
  blueprintSemanticZoomProgress,
  type BlueprintDetailLevel,
  type BlueprintEdgeState,
  type BlueprintLogicNodeData,
} from "@agent-runtime-map/react";
import {
  Activity, AlertTriangle, Braces, CheckCircle2, ChevronRight, CircleDotDashed, Crosshair,
  GitFork, ListTree, PanelRightClose, Pause, Pin, Play, RotateCcw, Search, SkipForward, Undo2, X,
} from "lucide-react";
import type {
  ChainHealth, FeaturePathVariant, FeatureScenario, LogicGraph, LogicNode as LogicGraphNode, RawCodeGraph,
} from "@agent-runtime-map/schema";
import { buildBlueprintGroupNodes } from "./blueprintGroups";
import { applyLayoutPositions, buildCodeDetailExpansion, captureLayout, compareVariants, parseLayoutPositions, type LayoutPositions } from "./interactionModel";
import {
  chainHealthLabel, detectViewerLocale, inferenceMethodLabel, localizeDiagnostic, localizeFeatureLabel,
  localizeGraphDescription, localizeGraphTitle, localizeNode, localizeVariantLabel, messages, nodeTypeLabel,
  rememberViewerLocale, sourceCountText, type UiLocale,
} from "./i18n";
import { layoutGraph } from "./layout";
import { buildSimulationFrame, nextSimulationStep, type SimulationFrame } from "./simulation";

const nodeTypes = { logic: BlueprintLogicNode, blueprintGroup: BlueprintGroupNode, codeDetail: BlueprintCodeNode };
const edgeTypes = { playback: BlueprintPlaybackEdge };
const LAYOUT_PREFIX = "agent-runtime-map.layout.v1";

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
  const [layoutHistory, setLayoutHistory] = useState<LayoutPositions[]>([]);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const canvasRef = useRef<HTMLElement>(null);
  const detailLevelRef = useRef<BlueprintDetailLevel>("logic");
  const nodesRef = useRef(nodes);
  const baseLayoutRef = useRef<LayoutPositions>();
  const dragStartLayoutRef = useRef<LayoutPositions>();
  const transitionTimerRef = useRef<number>();
  const spotlightTimerRef = useRef<number>();
  const reduceMotion = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const { fitView, getNode, setCenter } = useReactFlow();
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
  useEffect(() => {
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
    if (!graph) return;
    const flowNodes = graph.nodes.map((node) => toFlowNode(node, locale));
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
  }, [fitView, graph, layoutStorageKey, locale, reduceMotion]);
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
  }, [fitView, layoutRevision, reduceMotion, selectedFeature?.id, selectedVariant?.id]);

  const focusNode = useCallback((id: string, zoom = 1.12) => {
    const node = getNode(id);
    if (!node) return;
    const width = node.measured.width ?? node.width ?? 190;
    const height = node.measured.height ?? node.height ?? 154;
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

  const matchingIds = useMemo(() => {
    if (!query.trim() || !graph) return new Set(graph?.nodes.map((node) => node.id) ?? []);
    const normalized = query.trim().toLowerCase();
    return new Set(graph.nodes.filter((node) => {
      const localized = localizeNode(node, locale);
      return `${localized.label} ${localized.description} ${node.label} ${node.sources.map((source) => source.file).join(" ")}`.toLowerCase().includes(normalized);
    }).map((node) => node.id));
  }, [graph, locale, query]);
  const searchResults = useMemo(() => graph?.nodes.filter((node) => matchingIds.has(node.id)).slice(0, 7) ?? [], [graph, matchingIds]);
  const detailExpansion = useMemo(() => {
    if (!rawGraph || !graph || !expandedLogicIds.size) return { nodes: [] as Node[], edges: [] as Edge[] };
    return graph.nodes.flatMap((logicNode) => {
      if (!expandedLogicIds.has(logicNode.id)) return [];
      const parent = nodes.find((node) => node.id === logicNode.id);
      return parent ? [buildCodeDetailExpansion(logicNode, parent, rawGraph)] : [];
    }).reduce((all, current) => ({ nodes: [...all.nodes, ...current.nodes], edges: [...all.edges, ...current.edges] }), { nodes: [] as Node[], edges: [] as Edge[] });
  }, [expandedLogicIds, graph, nodes, rawGraph]);
  const visibleLogicNodes = useMemo(() => nodes.map((node) => ({ ...node, className: nodeClassName(node.id, matchingIds, selectedFeature, selectedVariant, frame, transition, spotlightId, pinnedIds, expandedLogicIds) })), [expandedLogicIds, frame, matchingIds, nodes, pinnedIds, selectedFeature, selectedVariant, spotlightId, transition]);
  const visibleNodes = useMemo(() => {
    if (!graph) return [...visibleLogicNodes, ...detailExpansion.nodes];
    const activeNodeIds = selectedVariant ? new Set(selectedVariant.nodeIds) : undefined;
    const groups = buildBlueprintGroupNodes(nodes, graph, activeNodeIds, locale);
    return [...groups, ...visibleLogicNodes, ...detailExpansion.nodes];
  }, [detailExpansion.nodes, graph, locale, nodes, selectedVariant, visibleLogicNodes]);
  const visibleEdges = useMemo(() => {
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
      return toFlowEdge(edge, state, graph!, locale, branchClass, !reduceMotion && state === "current", speed);
    }) ?? [];
    return [...graphEdges, ...detailExpansion.edges];
  }, [detailExpansion.edges, frame, graph, locale, reduceMotion, selectedVariant, speed, transition]);

  const persistLayout = useCallback((positions: LayoutPositions) => {
    if (typeof window !== "undefined" && layoutStorageKey) window.localStorage.setItem(layoutStorageKey, JSON.stringify(positions));
  }, [layoutStorageKey]);
  const updatePins = useCallback((positionedNodes: Node[]) => {
    const baseLayout = baseLayoutRef.current;
    if (baseLayout) setPinnedIds(new Set(positionedNodes.filter((node) => movedFromBase(node, baseLayout)).map((node) => node.id)));
  }, []);
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => applyNodeChanges(changes.filter((change) => current.some((node) => node.id === change.id)), current) as Node<BlueprintLogicNodeData>[]);
  }, []);
  const onNodeDragStart = useCallback((_event: React.MouseEvent, node: Node) => {
    if (nodesRef.current.some((item) => item.id === node.id)) dragStartLayoutRef.current = captureLayout(nodesRef.current);
  }, []);
  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
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
  const selectNode = useCallback((_event: React.MouseEvent, node: Node) => setSelectedId(node.type === "codeDetail" ? node.id.split(":")[1] : node.id), []);
  const toggleDetails = useCallback((_event: React.MouseEvent, node: Node) => {
    if (node.type !== "logic" || !rawGraph) return;
    setExpandedLogicIds((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; });
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
      <section className="feature-circuits" aria-label={text.featureCircuits}><div className="section-heading"><span className="eyebrow">{text.featureCircuits}</span><ListTree size={14} /></div><p className="section-hint">{text.featureHint}</p><button className={`feature-card feature-card--global ${selectedFeatureId === null ? "is-active" : ""}`} onClick={() => selectFeature(null)}><span className="feature-card__icon"><Activity size={14} /></span><span><strong>{text.wholeSystem}</strong><small>{text.globalView}</small></span></button><div className="feature-list">{features.map((feature) => <button className={`feature-card feature-card--${feature.health} ${feature.id === selectedFeatureId ? "is-active" : ""}`} data-feature-id={feature.id} data-health={feature.health} key={feature.id} onClick={() => selectFeature(feature.id)}><span className="feature-card__icon"><HealthIcon health={feature.health} /></span><span><strong>{localizeFeatureLabel(feature, graph, locale)}</strong><small>{chainHealthLabel(feature.health, locale)} · {Math.round(feature.confidence * 100)}%</small></span><ChevronRight size={13} /></button>)}</div></section>
      {selectedFeature && selectedVariant ? <FeatureInspector feature={selectedFeature} variant={selectedVariant} graph={graph} locale={locale} playing={playing} speed={speed} frame={frame} cameraFollow={cameraFollow} onVariant={selectVariant} onPlay={play} onPause={() => setPlaying(false)} onNext={next} onReset={reset} onSpeed={setSpeed} onSelectNode={setSelectedId} onResumeFollow={() => setCameraFollow(true)} /> : <div className="feature-empty"><CircleDotDashed size={16} /><span>{text.selectFeature}</span></div>}
      <div className="search-wrap"><label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && searchResults[0]) selectSearchResult(searchResults[0].id); }} placeholder={text.search} />{query && <button onClick={() => setQuery("")} aria-label={text.clearSearch}><X size={14} /></button>}</label>{query && <div className="search-results"><span className="eyebrow">{text.searchResults} · {searchResults.length}</span>{searchResults.length ? searchResults.map((node) => <button key={node.id} onClick={() => selectSearchResult(node.id)}><strong>{localizeNode(node, locale).label}</strong><small>{node.sources[0]?.file ?? nodeTypeLabel(node.type, locale)}</small></button>) : <p>{text.noSearchResults}</p>}</div>}</div>
      <div className="sidebar__footer"><Braces size={14} /> {text.staticAnalysis}</div>
    </aside>
    <section className="canvas" aria-label={text.logicGraph} data-detail-level={detailLevel} data-navigating={navigating ? "true" : "false"} ref={canvasRef}>
      <div className="canvas-caption"><span className="canvas-caption__mark" /><strong>{selectedFeature ? localizeFeatureLabel(selectedFeature, graph, locale) : text.wholeSystem}</strong><small>{selectedVariant ? localizeVariantLabel(selectedVariant, graph, locale) : text.globalView}</small></div>
      <div className="semantic-zoom" aria-live="polite"><span>{text.zoomLevel}</span><strong>{semanticZoomLabel(detailLevel, locale)}</strong><div className="semantic-zoom__levels" aria-hidden="true">{(["overview", "logic", "evidence"] as const).map((level) => <i className={level === detailLevel ? "is-active" : ""} key={level} />)}</div><small>{text.semanticZoomHint}</small></div>
      <div className="canvas-help"><Crosshair size={13} /><span>{text.detailHint}</span></div>
      <div className="layout-toolbar" aria-label={text.layout}><span><Pin size={12} /> {pinnedIds.size} {text.pinnedNodes}</span><button onClick={undoLayout} disabled={!layoutHistory.length} title={text.undoLayout}><Undo2 size={13} /></button><button onClick={resetLayout} title={text.resetLayout}><RotateCcw size={13} /></button></div>
      <ReactFlow nodes={visibleNodes} edges={visibleEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onNodeDragStart={onNodeDragStart} onNodeDragStop={onNodeDragStop} onNodeClick={selectNode} onNodeDoubleClick={toggleDetails} onPaneClick={() => setSelectedId(undefined)} onMoveStart={(event) => { setNavigating(true); if (event) setCameraFollow(false); }} onMove={(_event, viewport) => updateSemanticZoom(viewport.zoom)} onMoveEnd={() => setNavigating(false)} nodesDraggable nodesConnectable={false} elementsSelectable minZoom={0.2} maxZoom={2.2} fitView proOptions={{ hideAttribution: true }}><Controls showInteractive={false} position="bottom-left" /><MiniMap position="bottom-right" pannable zoomable nodeStrokeWidth={2} maskColor="rgba(240, 244, 248, 0.7)" /></ReactFlow>
    </section>
    {selected && <EvidencePanel node={selected} locale={locale} onClose={() => setSelectedId(undefined)} />}
  </main>;
}

function FeatureInspector({ feature, variant, graph, locale, playing, speed, frame, cameraFollow, onVariant, onPlay, onPause, onNext, onReset, onSpeed, onSelectNode, onResumeFollow }: { feature: FeatureScenario; variant: FeaturePathVariant; graph: LogicGraph; locale: UiLocale; playing: boolean; speed: number; frame: SimulationFrame; cameraFollow: boolean; onVariant: (id: string) => void; onPlay: () => void; onPause: () => void; onNext: () => void; onReset: () => void; onSpeed: (speed: number) => void; onSelectNode: (id: string) => void; onResumeFollow: () => void; }) {
  const text = messages(locale); const currentNames = [...frame.currentNodeIds].flatMap((id) => { const node = graph.nodes.find((candidate) => candidate.id === id); return node ? [localizeNode(node, locale).label] : []; }); const status = frame.outcome === "idle" ? text.ready : frame.outcome === "error" ? text.stopped : frame.outcome === "complete" ? text.completed : text.running;
  return <section className="chain-inspector" data-outcome={frame.outcome}><div className="section-heading"><span className="eyebrow">{text.choosePath}</span><span>{feature.variants.length}</span></div><select value={variant.id} onChange={(event) => onVariant(event.target.value)} aria-label={text.choosePath}>{feature.variants.map((item) => <option value={item.id} key={item.id}>{localizeVariantLabel(item, graph, locale)}</option>)}</select><div className={`player-status player-status--${frame.outcome}`}><span className="player-status__pulse" /><span><strong>{status}</strong><small>{currentNames.join(" · ") || `${text.step} 0 / ${variant.steps.length}`}</small></span><b>{Math.max(0, frame.stepIndex + 1)}/{variant.steps.length}</b></div><div className="player-controls" aria-label={text.chainCheck}><button onClick={playing ? onPause : onPlay} title={playing ? text.pause : text.play} aria-label={playing ? text.pause : text.play}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><button onClick={onNext} title={text.nextStep} aria-label={text.nextStep}><SkipForward size={14} /></button><button onClick={onReset} title={text.replay} aria-label={text.replay}><RotateCcw size={14} /></button><div className="speed-control"><span>{text.speed}</span>{[0.5, 1, 2].map((value) => <button className={speed === value ? "is-active" : ""} onClick={() => onSpeed(value)} key={value}>{value}×</button>)}</div></div><button className={`camera-follow ${cameraFollow ? "is-active" : ""}`} onClick={onResumeFollow}><Crosshair size={12} /><span>{cameraFollow ? text.cameraFollowing : text.resumeFollow}</span></button><div className="diagnostics"><div className="section-heading"><span className="eyebrow">{text.diagnostics}</span><span>{feature.diagnostics.length}</span></div>{!feature.diagnostics.length && <div className="diagnostics__clear"><CheckCircle2 size={13} />{text.noDiagnostics}</div>}{feature.diagnostics.map((diagnostic) => { const localized = localizeDiagnostic(diagnostic, graph, locale); return <button className={`diagnostic diagnostic--${diagnostic.severity}`} data-diagnostic-code={diagnostic.code} key={diagnostic.id} onClick={() => diagnostic.nodeId && graph.nodes.some((node) => node.id === diagnostic.nodeId) && onSelectNode(diagnostic.nodeId)}><AlertTriangle size={13} /><span><strong>{localized.message}</strong><small>{text.recommendation}：{localized.suggestion}</small></span></button>; })}</div></section>;
}

function nodeClassName(nodeId: string, matchingIds: Set<string>, feature: FeatureScenario | undefined, variant: FeaturePathVariant | undefined, frame: SimulationFrame, transition: ReturnType<typeof compareVariants> | undefined, spotlightId: string | undefined, pinnedIds: Set<string>, expandedLogicIds: Set<string>): string {
  const classes: string[] = []; if (!matchingIds.has(nodeId)) classes.push("is-dimmed"); if (spotlightId === nodeId) classes.push("is-search-spotlight"); if (pinnedIds.has(nodeId)) classes.push("is-pinned"); if (expandedLogicIds.has(nodeId)) classes.push("is-expanded"); if (transition?.enteringNodeIds.has(nodeId)) classes.push("is-branch-entering"); if (transition?.exitingNodeIds.has(nodeId)) classes.push("is-branch-exiting"); if (transition?.sharedNodeIds.has(nodeId)) classes.push("is-branch-shared"); if (!feature || !variant) return classes.join(" "); if (!variant.nodeIds.includes(nodeId)) classes.push("is-outside-path"); else if (frame.errorNodeIds.has(nodeId)) classes.push("is-chain-error"); else if (frame.warningNodeIds.has(nodeId)) classes.push("is-chain-warning"); else if (frame.currentNodeIds.has(nodeId)) classes.push("is-current"); else if (frame.completedNodeIds.has(nodeId)) classes.push("is-chain-complete"); else classes.push("is-path-pending"); return classes.join(" ");
}

function toFlowNode(node: LogicGraphNode, locale: UiLocale): Node<BlueprintLogicNodeData> { const localized = localizeNode(node, locale); const primarySource = node.sources[0]; return { id: node.id, type: "logic", position: { x: 0, y: 0 }, data: { label: localized.label, description: localized.description, nodeType: node.type, typeLabel: nodeTypeLabel(node.type, locale), confidence: node.confidence, sourceText: sourceCountText(node.sources.length, locale), sourceDetail: primarySource ? `${primarySource.file}:${primarySource.startLine}${primarySource.symbol ? ` · ${primarySource.symbol}` : ""}` : undefined, inferenceText: inferenceMethodLabel(node.inference.method, locale) } }; }
function semanticZoomLabel(level: BlueprintDetailLevel, locale: UiLocale): string { return locale === "zh-CN" ? { overview: "全局层", logic: "逻辑层", evidence: "证据层" }[level] : { overview: "Overview", logic: "Logic", evidence: "Evidence" }[level]; }
type EdgeVisualState = BlueprintEdgeState;
function toFlowEdge(edge: LogicGraph["edges"][number], state: EdgeVisualState, graph: LogicGraph, locale: UiLocale, branchClass?: string, showToken = false, speed = 1): Edge { const dataFlow = edge.type === "data_flow"; const appearance = blueprintEdgeAppearance(state, dataFlow); return { id: edge.id, source: edge.source, target: edge.target, type: "playback", animated: false, label: edge.label ?? edgeFlowLabel(edge, graph, locale), className: `chain-edge chain-edge--${state}${branchClass ? ` ${branchClass}` : ""}`, markerEnd: { type: MarkerType.ArrowClosed, width: 17, height: 17, color: appearance.color }, style: { stroke: appearance.color, strokeWidth: appearance.width, opacity: appearance.opacity, strokeDasharray: appearance.dash }, data: { showToken, tokenColor: appearance.color, tokenDuration: 0.9 / speed } }; }
function edgeFlowLabel(edge: LogicGraph["edges"][number], graph: LogicGraph, locale: UiLocale): string { const source = graph.nodes.find((node) => node.id === edge.source); const target = graph.nodes.find((node) => node.id === edge.target); if (source?.type === "user_action" && target?.type === "entrypoint") return "HTTPS"; if (edge.type === "data_flow" && target?.type === "data") return locale === "zh-CN" ? "读 / 写" : "read / write"; if (target?.type === "external_system") return "API"; if (target?.type === "model") return locale === "zh-CN" ? "模型" : "model"; if (target?.type === "tool") return locale === "zh-CN" ? "工具" : "tool"; if (target?.type === "human_gate") return locale === "zh-CN" ? "人工确认" : "approve"; if (target?.type === "workflow" || target?.type === "ai_process") return locale === "zh-CN" ? "调用" : "invoke"; if (target?.type === "result") return locale === "zh-CN" ? "返回" : "return"; return locale === "zh-CN" ? "执行" : "flow"; }
function HealthIcon({ health }: { health: ChainHealth }) { return health === "healthy" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />; }

interface SourceSnippet { file: string; startLine: number; endLine: number; highlightStart: number; highlightEnd: number; lines: Array<{ number: number; text: string }>; }
function EvidencePanel({ node, locale, onClose }: { node: LogicGraphNode; locale: UiLocale; onClose: () => void }) {
  const text = messages(locale); const localized = localizeNode(node, locale); const [sourceIndex, setSourceIndex] = useState(0); const [snippet, setSnippet] = useState<SourceSnippet>(); const [sourceError, setSourceError] = useState(false); const source = node.sources[sourceIndex];
  useEffect(() => { setSourceIndex(0); }, [node.id]);
  useEffect(() => { if (!source) return; let active = true; setSnippet(undefined); setSourceError(false); const params = new URLSearchParams({ file: source.file, start: String(source.startLine), end: String(source.endLine ?? source.startLine) }); fetch(`./source.json?${params.toString()}`, { cache: "no-store" }).then(async (response) => { if (!response.ok) throw new Error(String(response.status)); return await response.json() as SourceSnippet; }).then((next) => active && setSnippet(next)).catch(() => active && setSourceError(true)); return () => { active = false; }; }, [source]);
  return <aside className="evidence-panel"><div className="evidence-panel__header"><div><span className="eyebrow">{text.selectedLogic}</span><h2>{localized.label}</h2></div><button onClick={onClose} aria-label={text.closeEvidence}><PanelRightClose size={19} /></button></div><p className="evidence-panel__description">{localized.description}</p><div className="confidence-card"><div><span>{text.confidence}</span><strong>{Math.round(node.confidence * 100)}%</strong></div><div className="confidence-track"><i style={{ width: `${node.confidence * 100}%` }} /></div><small>{inferenceMethodLabel(node.inference.method, locale)} · {node.inference.explanation}</small></div><div className="evidence-list"><span className="eyebrow">{text.sourceEvidence}</span>{node.sources.map((item, index) => <button className={sourceIndex === index ? "is-active" : ""} key={`${item.file}:${item.startLine}`} onClick={() => setSourceIndex(index)}><code>{item.file}</code><span>{text.lines} {item.startLine}{item.endLine && item.endLine !== item.startLine ? `–${item.endLine}` : ""}</span>{item.symbol && <small>{item.symbol}</small>}</button>)}</div><section className="source-preview"><span className="eyebrow">{text.sourceCode}</span>{!source ? <p>{text.sourceUnavailable}</p> : sourceError ? <p>{text.sourceUnavailable}</p> : !snippet ? <p>{text.loadingSource}</p> : <pre>{snippet.lines.map((line) => <code className={line.number >= snippet.highlightStart && line.number <= snippet.highlightEnd ? "is-highlighted" : ""} key={line.number}><i>{line.number}</i><span>{line.text || " "}</span></code>)}</pre>}</section><div className="raw-reference"><span>{text.rawReferences}</span><code>{node.rawNodeIds.join("\n")}</code></div></aside>;
}
function movedFromBase(node: Node, base: LayoutPositions): boolean { const expected = base[node.id]; return Boolean(expected && (Math.abs(expected.x - node.position.x) > 1 || Math.abs(expected.y - node.position.y) > 1)); }
function Stat({ value, label }: { value: number; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
function LoadingState({ locale }: { locale: UiLocale }) { const text = messages(locale); return <main className="state-screen"><span className="state-logo"><GitFork /></span><h1>{text.loadingTitle}</h1><p>{text.loadingDescription}</p><i className="loader" /></main>; }
function ErrorState({ message, locale }: { message: string; locale: UiLocale }) { const text = messages(locale); return <main className="state-screen state-screen--error"><span className="state-logo"><X /></span><h1>{text.errorTitle}</h1><p>{message}</p><code>{text.errorHint}</code></main>; }
