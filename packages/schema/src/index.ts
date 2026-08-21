export const SCHEMA_VERSION = "0.1.0" as const;

export type SourceLanguage = "typescript" | "javascript";

export type RawNodeKind =
  | "entrypoint"
  | "file"
  | "function"
  | "class"
  | "route"
  | "service"
  | "agent"
  | "tool"
  | "database"
  | "external_api";

export type RawEdgeKind =
  | "contains"
  | "imports"
  | "calls"
  | "data_flow"
  | "handles"
  | "reads"
  | "writes"
  | "requests";

export interface SourceLocation {
  file: string;
  startLine: number;
  endLine?: number;
  symbol?: string;
}

export interface Evidence {
  source: SourceLocation;
  method:
    | "ast"
    | "framework_convention"
    | "name_heuristic"
    | "path_heuristic"
    | "llm"
    | "user";
  detail: string;
  confidence: number;
}

export interface RawCodeNode {
  id: string;
  kind: RawNodeKind;
  name: string;
  qualifiedName?: string;
  description?: string;
  language: SourceLanguage;
  metadata?: Record<string, unknown>;
  evidence: Evidence[];
}

export interface RawCodeEdge {
  id: string;
  source: string;
  target: string;
  kind: RawEdgeKind;
  label?: string;
  evidence: Evidence[];
}

export interface ProjectSummary {
  name: string;
  root: string;
  languages: SourceLanguage[];
  frameworks: string[];
  filesScanned: number;
}

export interface RawCodeGraph {
  schemaVersion: typeof SCHEMA_VERSION;
  generatedAt: string;
  project: ProjectSummary;
  nodes: RawCodeNode[];
  edges: RawCodeEdge[];
  diagnostics: Diagnostic[];
}

export interface Diagnostic {
  level: "info" | "warning" | "error";
  code: string;
  message: string;
  source?: SourceLocation;
}

export type GraphType = "runtime_logic" | "product_logic";

export type LogicNodeType =
  | "user_action"
  | "entrypoint"
  | "process"
  | "ai_process"
  | "decision"
  | "data"
  | "external_system"
  | "result";

export interface LogicNode {
  id: string;
  type: LogicNodeType;
  label: string;
  description: string;
  sources: SourceLocation[];
  confidence: number;
  inference: {
    method: "deterministic" | "heuristic" | "llm" | "mixed";
    explanation: string;
  };
  rawNodeIds: string[];
  metadata?: Record<string, unknown>;
}

export interface LogicEdge {
  id: string;
  source: string;
  target: string;
  type: "flow" | "branch" | "data_flow";
  label?: string;
  confidence: number;
  rawEdgeIds: string[];
}

export interface LogicGraph {
  schemaVersion: typeof SCHEMA_VERSION;
  generatedAt: string;
  graphType: GraphType;
  title: string;
  description: string;
  project: ProjectSummary;
  nodes: LogicNode[];
  edges: LogicEdge[];
  diagnostics: Diagnostic[];
}

export function assertConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
