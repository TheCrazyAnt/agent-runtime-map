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
import { Braces, ChevronRight, GitFork, PanelRightClose, Search, X } from "lucide-react";
import type { LogicGraph, LogicNode as LogicGraphNode } from "@agent-runtime-map/schema";
import { layoutGraph } from "./layout";
import { LogicNodeCard, type LogicNodeData } from "./LogicNodeCard";
import {
  detectViewerLocale,
  inferenceMethodLabel,
  localizeGraphDescription,
  localizeGraphTitle,
  localizeNode,
  messages,
  nodeTypeLabel,
  rememberViewerLocale,
  sourceCountText,
  type UiLocale,
} from "./i18n";

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
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string>();
  const [locale, setLocale] = useState<UiLocale>(detectViewerLocale);
  const { fitView } = useReactFlow();
  const text = messages(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = locale === "zh-CN" ? "Agent Runtime Map · 智能体运行逻辑图" : "Agent Runtime Map";
  }, [locale]);

  useEffect(() => {
    fetch("./graph.json", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${text.loadError} (${response.status})`);
        return (await response.json()) as LogicGraph;
      })
      .then(async (loadedGraph) => {
        const flowNodes = loadedGraph.nodes.map((node) => toFlowNode(node, locale));
        const flowEdges = loadedGraph.edges.map(toFlowEdge);
        setGraph(loadedGraph);
        setEdges(flowEdges);
        setNodes((await layoutGraph(flowNodes, flowEdges)) as Node<LogicNodeData>[]);
        window.setTimeout(() => fitView({ padding: 0.14, duration: 500 }), 20);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [fitView, locale, text.loadError]);

  const matchingIds = useMemo(() => {
    if (!query.trim() || !graph) return new Set(graph?.nodes.map((node) => node.id) ?? []);
    const normalized = query.trim().toLowerCase();
    return new Set(
      graph.nodes
        .filter((node) => {
          const localized = localizeNode(node, locale);
          return `${localized.label} ${localized.description} ${node.label} ${node.sources.map((source) => source.file).join(" ")}`.toLowerCase().includes(normalized);
        })
        .map((node) => node.id),
    );
  }, [graph, locale, query]);

  const visibleNodes = useMemo(
    () => nodes.map((node) => ({ ...node, className: matchingIds.has(node.id) ? "" : "is-dimmed" })),
    [nodes, matchingIds],
  );
  const selected = graph?.nodes.find((node) => node.id === selectedId);

  const selectNode = useCallback((_event: React.MouseEvent, node: Node) => setSelectedId(node.id), []);

  const switchLocale = () => {
    const next = locale === "zh-CN" ? "en" : "zh-CN";
    rememberViewerLocale(next);
    setLocale(next);
  };

  if (error) return <ErrorState message={error} locale={locale} />;
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
          <Stat value={graph.nodes.length} label={text.logicNodes} />
          <Stat value={graph.edges.length} label={text.flows} />
          <Stat value={graph.project.filesScanned} label={text.files} />
        </div>
        <label className="search-box">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.search} />
          {query && <button onClick={() => setQuery("")} aria-label={text.clearSearch}><X size={14} /></button>}
        </label>
        <div className="legend">
          <span className="eyebrow">{text.nodeTypes}</span>
          {(["user_action", "entrypoint", "ai_process", "process", "data", "external_system", "result"] as const)
            .map((type) => <div className="legend__item" key={type}><i className={`legend__dot legend__dot--${type}`} />{nodeTypeLabel(type, locale)}</div>)}
        </div>
        <div className="sidebar__footer"><Braces size={14} /> {text.staticAnalysis}</div>
      </aside>

      <section className="canvas" aria-label={text.logicGraph}>
        <ReactFlow
          nodes={visibleNodes}
          edges={edges}
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

function toFlowEdge(edge: LogicGraph["edges"][number]): Edge {
  const dataFlow = edge.type === "data_flow";
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    animated: dataFlow,
    label: edge.label,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: dataFlow ? "#a78bfa" : "#637086" },
    style: { stroke: dataFlow ? "#a78bfa" : "#637086", strokeWidth: dataFlow ? 1.8 : 1.35 },
  };
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
