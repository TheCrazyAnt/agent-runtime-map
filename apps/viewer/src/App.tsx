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
import type { LogicGraph, LogicNode as LogicGraphNode } from "@logic-map/schema";
import { layoutGraph } from "./layout";
import { LogicNodeCard, type LogicNodeData } from "./LogicNodeCard";

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
  const { fitView } = useReactFlow();

  useEffect(() => {
    fetch("./graph.json", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load graph.json (${response.status})`);
        return (await response.json()) as LogicGraph;
      })
      .then(async (loadedGraph) => {
        const flowNodes = loadedGraph.nodes.map(toFlowNode);
        const flowEdges = loadedGraph.edges.map(toFlowEdge);
        setGraph(loadedGraph);
        setEdges(flowEdges);
        setNodes((await layoutGraph(flowNodes, flowEdges)) as Node<LogicNodeData>[]);
        window.setTimeout(() => fitView({ padding: 0.14, duration: 500 }), 20);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [fitView]);

  const matchingIds = useMemo(() => {
    if (!query.trim() || !graph) return new Set(graph?.nodes.map((node) => node.id) ?? []);
    const normalized = query.trim().toLowerCase();
    return new Set(
      graph.nodes
        .filter((node) => `${node.label} ${node.description} ${node.sources.map((source) => source.file).join(" ")}`.toLowerCase().includes(normalized))
        .map((node) => node.id),
    );
  }, [graph, query]);

  const visibleNodes = useMemo(
    () => nodes.map((node) => ({ ...node, className: matchingIds.has(node.id) ? "" : "is-dimmed" })),
    [nodes, matchingIds],
  );
  const selected = graph?.nodes.find((node) => node.id === selectedId);

  const selectNode = useCallback((_event: React.MouseEvent, node: Node) => setSelectedId(node.id), []);

  if (error) return <ErrorState message={error} />;
  if (!graph) return <LoadingState />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand__mark"><GitFork size={18} /></span><span>Logic Map</span></div>
        <div className="breadcrumb"><span>{graph.project.name}</span><ChevronRight size={14} /><strong>{graph.graphType === "runtime_logic" ? "Runtime logic" : "Product logic"}</strong></div>
        <div className="topbar__meta">Generated {new Date(graph.generatedAt).toLocaleString()}</div>
      </header>

      <aside className="sidebar">
        <div className="sidebar__intro">
          <span className="eyebrow">PROJECT MAP</span>
          <h1>{graph.title}</h1>
          <p>{graph.description}</p>
        </div>
        <div className="stats">
          <Stat value={graph.nodes.length} label="logic nodes" />
          <Stat value={graph.edges.length} label="flows" />
          <Stat value={graph.project.filesScanned} label="files" />
        </div>
        <label className="search-box">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find logic or source…" />
          {query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}
        </label>
        <div className="legend">
          <span className="eyebrow">NODE TYPES</span>
          {[
            ["user_action", "User action"], ["entrypoint", "Entrypoint"], ["ai_process", "AI process"],
            ["process", "Process"], ["data", "Data"], ["external_system", "External system"], ["result", "Result"],
          ].map(([type, label]) => <div className="legend__item" key={type}><i className={`legend__dot legend__dot--${type}`} />{label}</div>)}
        </div>
        <div className="sidebar__footer"><Braces size={14} /> Evidence-backed static analysis</div>
      </aside>

      <section className="canvas" aria-label="Logic graph">
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

      {selected && <EvidencePanel node={selected} onClose={() => setSelectedId(undefined)} />}
    </main>
  );
}

function toFlowNode(node: LogicGraphNode): Node<LogicNodeData> {
  return {
    id: node.id,
    type: "logic",
    position: { x: 0, y: 0 },
    data: {
      label: node.label,
      description: node.description,
      nodeType: node.type,
      confidence: node.confidence,
      sourceCount: node.sources.length,
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

function EvidencePanel({ node, onClose }: { node: LogicGraphNode; onClose: () => void }) {
  return (
    <aside className="evidence-panel">
      <div className="evidence-panel__header">
        <div><span className="eyebrow">SELECTED LOGIC</span><h2>{node.label}</h2></div>
        <button onClick={onClose} aria-label="Close evidence"><PanelRightClose size={19} /></button>
      </div>
      <p className="evidence-panel__description">{node.description}</p>
      <div className="confidence-card">
        <div><span>Confidence</span><strong>{Math.round(node.confidence * 100)}%</strong></div>
        <div className="confidence-track"><i style={{ width: `${node.confidence * 100}%` }} /></div>
        <small>{node.inference.method} · {node.inference.explanation}</small>
      </div>
      <div className="evidence-list">
        <span className="eyebrow">SOURCE EVIDENCE</span>
        {node.sources.map((source) => (
          <article key={`${source.file}:${source.startLine}`}>
            <code>{source.file}</code>
            <span>Lines {source.startLine}{source.endLine && source.endLine !== source.startLine ? `–${source.endLine}` : ""}</span>
            {source.symbol && <small>{source.symbol}</small>}
          </article>
        ))}
      </div>
      <div className="raw-reference"><span>Raw references</span><code>{node.rawNodeIds.join("\n")}</code></div>
    </aside>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function LoadingState() {
  return <main className="state-screen"><span className="state-logo"><GitFork /></span><h1>Compiling the view</h1><p>Loading the evidence-backed logic graph…</p><i className="loader" /></main>;
}

function ErrorState({ message }: { message: string }) {
  return <main className="state-screen state-screen--error"><span className="state-logo"><X /></span><h1>Graph unavailable</h1><p>{message}</p><code>Run logic-map analyze . and restart the viewer.</code></main>;
}
