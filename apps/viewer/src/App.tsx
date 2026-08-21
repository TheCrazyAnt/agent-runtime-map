import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import {
  Activity,
  AlertTriangle,
  Braces,
  CheckCircle2,
  ChevronRight,
  CircleDotDashed,
  GitFork,
  ListTree,
  PanelRightClose,
  Pause,
  Play,
  RotateCcw,
  Search,
  SkipForward,
  X,
} from "lucide-react";
import type {
  ChainHealth,
  FeaturePathVariant,
  FeatureScenario,
  LogicGraph,
  LogicNode as LogicGraphNode,
} from "@agent-runtime-map/schema";
import { layoutGraph } from "./layout";
import { LogicNodeCard, type LogicNodeData } from "./LogicNodeCard";
import {
  chainHealthLabel,
  detectViewerLocale,
  inferenceMethodLabel,
  localizeDiagnostic,
  localizeFeatureLabel,
  localizeGraphDescription,
  localizeGraphTitle,
  localizeNode,
  localizeVariantLabel,
  messages,
  nodeTypeLabel,
  rememberViewerLocale,
  sourceCountText,
  type UiLocale,
} from "./i18n";
import { buildSimulationFrame, nextSimulationStep, type SimulationFrame } from "./simulation";

const nodeTypes = { logic: LogicNodeCard };

export function App() {
  return (
    <ReactFlowProvider>
      <LogicMapViewer />
    </ReactFlowProvider>
  );
}

function LogicMapViewer() {
  const [graph, setGraph] = useState<LogicGraph>();
  const [nodes, setNodes] = useState<Node<LogicNodeData>[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>();
  const [selectedVariantId, setSelectedVariantId] = useState<string>();
  const [stepIndex, setStepIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string>();
  const [locale, setLocale] = useState<UiLocale>(detectViewerLocale);
  const { fitView } = useReactFlow();
  const text = messages(locale);

  const features = graph?.features ?? [];
  const selectedFeature = features.find((feature) => feature.id === selectedFeatureId);
  const selectedVariant = selectedFeature?.variants.find((variant) => variant.id === selectedVariantId)
    ?? selectedFeature?.variants[0];
  const frame = useMemo(
    () => buildSimulationFrame(selectedFeature, selectedVariant, stepIndex),
    [selectedFeature, selectedVariant, stepIndex],
  );

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
      .then(setGraph)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  useEffect(() => {
    if (!graph) return;
    const flowNodes = graph.nodes.map((node) => toFlowNode(node, locale));
    const flowEdges = graph.edges.map((edge) => toFlowEdge(edge, "global"));
    void layoutGraph(flowNodes, flowEdges).then((layouted) => {
      setNodes(layouted as Node<LogicNodeData>[]);
      window.setTimeout(() => fitView({ padding: 0.14, duration: 500 }), 20);
    });
  }, [fitView, graph, locale]);

  useEffect(() => {
    if (!graph || selectedFeatureId !== undefined) return;
    const available = graph.features ?? [];
    setSelectedFeatureId(available.find((feature) => feature.health === "healthy")?.id ?? available[0]?.id ?? null);
  }, [graph, selectedFeatureId]);

  useEffect(() => {
    setSelectedVariantId(selectedFeature?.variants[0]?.id);
    setStepIndex(-1);
    setPlaying(false);
  }, [selectedFeature?.id]);

  useEffect(() => {
    if (!nodes.length) return;
    const focusNodes = selectedVariant
      ? nodes.filter((node) => selectedVariant.nodeIds.includes(node.id))
      : nodes;
    if (!focusNodes.length) return;
    const timer = window.setTimeout(
      () => fitView({ nodes: focusNodes, padding: selectedVariant ? 0.32 : 0.14, duration: 620, maxZoom: 1.08 }),
      30,
    );
    return () => window.clearTimeout(timer);
  }, [fitView, nodes, selectedVariant]);

  useEffect(() => {
    if (!playing || !selectedFeature || !selectedVariant) return;
    const timer = window.setTimeout(() => {
      const next = stepIndex + 1;
      if (next >= selectedVariant.steps.length) {
        setPlaying(false);
        return;
      }
      setStepIndex(next);
      const nextFrame = buildSimulationFrame(selectedFeature, selectedVariant, next);
      if (nextFrame.halted || next === selectedVariant.steps.length - 1) setPlaying(false);
    }, 850 / speed);
    return () => window.clearTimeout(timer);
  }, [playing, selectedFeature, selectedVariant, speed, stepIndex]);

  const matchingIds = useMemo(() => {
    if (!query.trim() || !graph) return new Set(graph?.nodes.map((node) => node.id) ?? []);
    const normalized = query.trim().toLowerCase();
    return new Set(
      graph.nodes
        .filter((node) => {
          const localized = localizeNode(node, locale);
          return `${localized.label} ${localized.description} ${node.label} ${node.sources.map((source) => source.file).join(" ")}`
            .toLowerCase()
            .includes(normalized);
        })
        .map((node) => node.id),
    );
  }, [graph, locale, query]);

  const visibleNodes = useMemo(() => nodes.map((node) => ({
    ...node,
    className: nodeClassName(node.id, matchingIds, selectedFeature, selectedVariant, frame),
  })), [frame, matchingIds, nodes, selectedFeature, selectedVariant]);

  const visibleEdges = useMemo(() => graph?.edges.map((edge) => {
    let state: EdgeVisualState = "global";
    if (selectedVariant) {
      state = selectedVariant.edgeIds.includes(edge.id) ? "path" : "outside";
      if (frame.reachedEdgeIds.has(edge.id)) state = "reached";
      if (frame.currentEdgeIds.has(edge.id)) state = "current";
      if (frame.errorEdgeIds.has(edge.id) || (frame.errorNodeIds.has(edge.target) && frame.reachedEdgeIds.has(edge.id))) state = "error";
    }
    return toFlowEdge(edge, state);
  }) ?? [], [frame, graph, selectedVariant]);

  const selected = graph?.nodes.find((node) => node.id === selectedId);
  const selectNode = useCallback((_event: React.MouseEvent, node: Node) => setSelectedId(node.id), []);
  const selectFeature = (featureId: string | null) => setSelectedFeatureId(featureId);
  const selectVariant = (variantId: string) => {
    setSelectedVariantId(variantId);
    setStepIndex(-1);
    setPlaying(false);
  };
  const play = () => {
    if (!selectedVariant?.steps.length) return;
    if (frame.outcome === "complete" || frame.outcome === "error") setStepIndex(-1);
    setPlaying(true);
  };
  const next = () => {
    setPlaying(false);
    if (!selectedVariant) return;
    setStepIndex(nextSimulationStep(selectedVariant, stepIndex));
  };
  const reset = () => {
    setPlaying(false);
    setStepIndex(-1);
  };
  const switchLocale = () => {
    const nextLocale = locale === "zh-CN" ? "en" : "zh-CN";
    rememberViewerLocale(nextLocale);
    setLocale(nextLocale);
  };

  if (error) return <ErrorState message={`${text.loadError}: ${error}`} locale={locale} />;
  if (!graph) return <LoadingState locale={locale} />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand__mark"><GitFork size={18} /></span><span>Agent Runtime Map</span></div>
        <div className="breadcrumb"><span>{graph.project.name}</span><ChevronRight size={14} /><strong>{graph.graphType === "runtime_logic" ? text.runtimeLogic : text.productLogic}</strong></div>
        <div className="topbar__actions">
          <span className="topbar__meta">{text.generated} {new Date(graph.generatedAt).toLocaleString(locale)}</span>
          <button className="locale-switch" onClick={switchLocale} title={text.switchLanguage}>{locale === "zh-CN" ? "EN" : "中文"}</button>
        </div>
      </header>

      <aside className="sidebar">
        <div className="sidebar__intro">
          <span className="eyebrow">{text.projectMap}</span>
          <h1>{localizeGraphTitle(graph, locale)}</h1>
          <p>{localizeGraphDescription(graph, locale)}</p>
        </div>
        <div className="stats">
          <Stat value={features.length} label={text.features} />
          <Stat value={graph.nodes.length} label={text.logicNodes} />
          <Stat value={graph.project.filesScanned} label={text.files} />
        </div>

        <section className="feature-circuits" aria-label={text.featureCircuits}>
          <div className="section-heading"><span className="eyebrow">{text.featureCircuits}</span><ListTree size={14} /></div>
          <p className="section-hint">{text.featureHint}</p>
          <button
            className={`feature-card feature-card--global ${selectedFeatureId === null ? "is-active" : ""}`}
            onClick={() => selectFeature(null)}
          >
            <span className="feature-card__icon"><Activity size={14} /></span>
            <span><strong>{text.wholeSystem}</strong><small>{text.globalView}</small></span>
          </button>
          <div className="feature-list">
            {features.map((feature) => (
              <button
                className={`feature-card feature-card--${feature.health} ${feature.id === selectedFeatureId ? "is-active" : ""}`}
                data-feature-id={feature.id}
                data-health={feature.health}
                key={feature.id}
                onClick={() => selectFeature(feature.id)}
              >
                <span className="feature-card__icon"><HealthIcon health={feature.health} /></span>
                <span>
                  <strong>{localizeFeatureLabel(feature, graph, locale)}</strong>
                  <small>{chainHealthLabel(feature.health, locale)} · {Math.round(feature.confidence * 100)}%</small>
                </span>
                <ChevronRight size={13} />
              </button>
            ))}
          </div>
        </section>

        {selectedFeature && selectedVariant ? (
          <FeatureInspector
            feature={selectedFeature}
            variant={selectedVariant}
            graph={graph}
            locale={locale}
            playing={playing}
            speed={speed}
            frame={frame}
            onVariant={selectVariant}
            onPlay={play}
            onPause={() => setPlaying(false)}
            onNext={next}
            onReset={reset}
            onSpeed={setSpeed}
            onSelectNode={setSelectedId}
          />
        ) : <div className="feature-empty"><CircleDotDashed size={16} /><span>{text.selectFeature}</span></div>}

        <label className="search-box">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.search} />
          {query && <button onClick={() => setQuery("")} aria-label={text.clearSearch}><X size={14} /></button>}
        </label>
        <div className="sidebar__footer"><Braces size={14} /> {text.staticAnalysis}</div>
      </aside>

      <section className="canvas" aria-label={text.logicGraph}>
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          nodeTypes={nodeTypes}
          onNodeClick={selectNode}
          onPaneClick={() => setSelectedId(undefined)}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          minZoom={0.2}
          maxZoom={1.8}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#29303c" gap={28} size={1} variant={BackgroundVariant.Dots} />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap position="bottom-right" pannable zoomable nodeStrokeWidth={2} maskColor="rgba(8, 10, 15, 0.78)" />
        </ReactFlow>
      </section>

      {selected && <EvidencePanel node={selected} locale={locale} onClose={() => setSelectedId(undefined)} />}
    </main>
  );
}

function FeatureInspector({
  feature,
  variant,
  graph,
  locale,
  playing,
  speed,
  frame,
  onVariant,
  onPlay,
  onPause,
  onNext,
  onReset,
  onSpeed,
  onSelectNode,
}: {
  feature: FeatureScenario;
  variant: FeaturePathVariant;
  graph: LogicGraph;
  locale: UiLocale;
  playing: boolean;
  speed: number;
  frame: SimulationFrame;
  onVariant: (id: string) => void;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onReset: () => void;
  onSpeed: (speed: number) => void;
  onSelectNode: (id: string) => void;
}) {
  const text = messages(locale);
  const currentNames = [...frame.currentNodeIds].flatMap((id) => {
    const node = graph.nodes.find((candidate) => candidate.id === id);
    return node ? [localizeNode(node, locale).label] : [];
  });
  const status = frame.outcome === "idle" ? text.ready
    : frame.outcome === "error" ? text.stopped
      : frame.outcome === "complete" ? text.completed
        : text.running;

  return (
    <section className="chain-inspector" data-outcome={frame.outcome}>
      <div className="section-heading"><span className="eyebrow">{text.choosePath}</span><span>{feature.variants.length}</span></div>
      <select value={variant.id} onChange={(event) => onVariant(event.target.value)} aria-label={text.choosePath}>
        {feature.variants.map((item) => <option value={item.id} key={item.id}>{localizeVariantLabel(item, graph, locale)}</option>)}
      </select>
      <div className={`player-status player-status--${frame.outcome}`}>
        <span className="player-status__pulse" />
        <span><strong>{status}</strong><small>{currentNames.join(" · ") || `${text.step} 0 / ${variant.steps.length}`}</small></span>
        <b>{Math.max(0, frame.stepIndex + 1)}/{variant.steps.length}</b>
      </div>
      <div className="player-controls" aria-label={text.chainCheck}>
        <button onClick={playing ? onPause : onPlay} title={playing ? text.pause : text.play} aria-label={playing ? text.pause : text.play}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button onClick={onNext} title={text.nextStep} aria-label={text.nextStep}><SkipForward size={14} /></button>
        <button onClick={onReset} title={text.replay} aria-label={text.replay}><RotateCcw size={14} /></button>
        <div className="speed-control"><span>{text.speed}</span>{[0.5, 1, 2].map((value) => <button className={speed === value ? "is-active" : ""} onClick={() => onSpeed(value)} key={value}>{value}×</button>)}</div>
      </div>
      <div className="diagnostics">
        <div className="section-heading"><span className="eyebrow">{text.diagnostics}</span><span>{feature.diagnostics.length}</span></div>
        {!feature.diagnostics.length && <div className="diagnostics__clear"><CheckCircle2 size={13} />{text.noDiagnostics}</div>}
        {feature.diagnostics.map((diagnostic) => {
          const localized = localizeDiagnostic(diagnostic, graph, locale);
          return (
            <button
              className={`diagnostic diagnostic--${diagnostic.severity}`}
              data-diagnostic-code={diagnostic.code}
              key={diagnostic.id}
              onClick={() => diagnostic.nodeId && graph.nodes.some((node) => node.id === diagnostic.nodeId) && onSelectNode(diagnostic.nodeId)}
            >
              <AlertTriangle size={13} />
              <span><strong>{localized.message}</strong><small>{text.recommendation}：{localized.suggestion}</small></span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function nodeClassName(
  nodeId: string,
  matchingIds: Set<string>,
  feature: FeatureScenario | undefined,
  variant: FeaturePathVariant | undefined,
  frame: SimulationFrame,
): string {
  const classes: string[] = [];
  if (!matchingIds.has(nodeId)) classes.push("is-dimmed");
  if (!feature || !variant) return classes.join(" ");
  if (!variant.nodeIds.includes(nodeId)) classes.push("is-outside-path");
  else if (frame.errorNodeIds.has(nodeId)) classes.push("is-chain-error");
  else if (frame.currentNodeIds.has(nodeId)) classes.push("is-current");
  else if (frame.warningNodeIds.has(nodeId)) classes.push("is-chain-warning");
  else if (frame.completedNodeIds.has(nodeId)) classes.push("is-chain-complete");
  else classes.push("is-path-pending");
  return classes.join(" ");
}

function toFlowNode(node: LogicGraphNode, locale: UiLocale): Node<LogicNodeData> {
  const localized = localizeNode(node, locale);
  return {
    id: node.id,
    type: "logic",
    position: { x: 0, y: 0 },
    data: {
      label: localized.label,
      description: localized.description,
      nodeType: node.type,
      typeLabel: nodeTypeLabel(node.type, locale),
      confidence: node.confidence,
      sourceText: sourceCountText(node.sources.length, locale),
    },
  };
}

type EdgeVisualState = "global" | "outside" | "path" | "reached" | "current" | "error";

function toFlowEdge(edge: LogicGraph["edges"][number], state: EdgeVisualState): Edge {
  const dataFlow = edge.type === "data_flow";
  const colors: Record<EdgeVisualState, string> = {
    global: dataFlow ? "#a78bfa" : "#637086",
    outside: "#303642",
    path: "#6f6594",
    reached: "#34d399",
    current: "#b8a8ff",
    error: "#fb4d62",
  };
  const color = colors[state];
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    animated: state === "current" || (state === "global" && dataFlow),
    label: edge.label,
    className: `chain-edge chain-edge--${state}`,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
    style: { stroke: color, strokeWidth: ["current", "error"].includes(state) ? 2.8 : state === "reached" ? 2.1 : 1.35, opacity: state === "outside" ? 0.16 : 1 },
  };
}

function HealthIcon({ health }: { health: ChainHealth }) {
  return health === "healthy" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />;
}

function EvidencePanel({ node, locale, onClose }: { node: LogicGraphNode; locale: UiLocale; onClose: () => void }) {
  const text = messages(locale);
  const localized = localizeNode(node, locale);
  return (
    <aside className="evidence-panel">
      <div className="evidence-panel__header">
        <div><span className="eyebrow">{text.selectedLogic}</span><h2>{localized.label}</h2></div>
        <button onClick={onClose} aria-label={text.closeEvidence}><PanelRightClose size={19} /></button>
      </div>
      <p className="evidence-panel__description">{localized.description}</p>
      <div className="confidence-card">
        <div><span>{text.confidence}</span><strong>{Math.round(node.confidence * 100)}%</strong></div>
        <div className="confidence-track"><i style={{ width: `${node.confidence * 100}%` }} /></div>
        <small>{inferenceMethodLabel(node.inference.method, locale)} · {node.inference.explanation}</small>
      </div>
      <div className="evidence-list">
        <span className="eyebrow">{text.sourceEvidence}</span>
        {node.sources.map((source) => (
          <article key={`${source.file}:${source.startLine}`}>
            <code>{source.file}</code>
            <span>{text.lines} {source.startLine}{source.endLine && source.endLine !== source.startLine ? `–${source.endLine}` : ""}</span>
            {source.symbol && <small>{source.symbol}</small>}
          </article>
        ))}
      </div>
      <div className="raw-reference"><span>{text.rawReferences}</span><code>{node.rawNodeIds.join("\n")}</code></div>
    </aside>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function LoadingState({ locale }: { locale: UiLocale }) {
  const text = messages(locale);
  return <main className="state-screen"><span className="state-logo"><GitFork /></span><h1>{text.loadingTitle}</h1><p>{text.loadingDescription}</p><i className="loader" /></main>;
}

function ErrorState({ message, locale }: { message: string; locale: UiLocale }) {
  const text = messages(locale);
  return <main className="state-screen state-screen--error"><span className="state-logo"><X /></span><h1>{text.errorTitle}</h1><p>{message}</p><code>{text.errorHint}</code></main>;
}
