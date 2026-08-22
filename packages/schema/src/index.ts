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
  | "workflow"
  | "tool"
  | "model"
  | "prompt"
  | "human_gate"
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
  control?: ControlFlowKind;
  metadata?: Record<string, unknown>;
  evidence: Evidence[];
}

export type ControlFlowKind =
  | "sequential"
  | "conditional"
  | "parallel"
  | "loop"
  | "retry"
  | "fallback"
  | "human_approval";

export type ProjectDocumentKind = "readme" | "documentation" | "prd" | "prompt" | "configuration";

export interface ProjectDocument {
  path: string;
  kind: ProjectDocumentKind;
  title: string;
  summary: string;
  headings: string[];
  excerpt: string;
  truncated: boolean;
}

export interface ProjectPrompt {
  path: string;
  name: string;
  excerpt: string;
  variables: string[];
  source: "file" | "code";
}

export interface ProjectDependency {
  name: string;
  version: string;
  category: "runtime" | "development" | "peer";
}

/**
 * Where a product claim came from. Code remains the source of truth; these only say
 * what the project *says about itself*, so a reader can weigh a conclusion knowing
 * whether it was read out of the code or out of a document someone wrote.
 */
export type ProductEvidenceOrigin = "readme" | "prd" | "docs" | "prompt" | "config" | "user";

export interface ProjectCapabilityHint {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  origin: ProductEvidenceOrigin;
  sources: SourceLocation[];
  confidence: number;
}

/**
 * A documented capability a code path was matched to. Kept apart from `sources` and
 * `confidence`, which describe the code: a strong document must never make weak code
 * look certain, and `match` is the strength of the link, not of either side.
 */
/**
 * What linked the code to the documented capability. Kept as a kind plus the terms
 * themselves, rather than a finished sentence, so the Viewer can say it in the
 * reader's language while the documented words stay verbatim as evidence.
 */
export type ProductMatchKind = "documented_name" | "documented_terms" | "entry_terms" | "step_terms";

export interface ProductEvidence {
  capabilityId: string;
  label: string;
  origin: ProductEvidenceOrigin;
  sources: SourceLocation[];
  match: number;
  matchedOn: ProductMatchKind;
  matchedTerms: string[];
}

export interface ProjectContext {
  description?: string;
  packageManager?: string;
  scripts: string[];
  dependencies: ProjectDependency[];
  documents: ProjectDocument[];
  prompts: ProjectPrompt[];
  configurationFiles: string[];
  capabilityHints: ProjectCapabilityHint[];
  diagnostics: Diagnostic[];
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
  context?: ProjectContext;
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
  | "workflow"
  | "ai_process"
  | "tool"
  | "model"
  | "human_gate"
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
  product?: ProductEvidence;
  metadata?: Record<string, unknown>;
}

export interface LogicEdge {
  id: string;
  source: string;
  target: string;
  type: "flow" | "branch" | "data_flow";
  label?: string;
  control?: ControlFlowKind;
  metadata?: Record<string, unknown>;
  confidence: number;
  rawEdgeIds: string[];
}

export type ChainHealth = "healthy" | "warning" | "error";

export type ChainDiagnosticSeverity = "info" | "warning" | "error";

export interface ChainDiagnostic {
  id: string;
  code:
    | "CHAIN_BROKEN_REFERENCE"
    | "CHAIN_CYCLE"
    | "CHAIN_LOW_CONFIDENCE"
    | "CHAIN_NO_DOWNSTREAM"
    | "CHAIN_NO_RESULT"
    | "CHAIN_PATH_LIMIT"
    | "CHAIN_EXTERNAL_NO_FALLBACK"
    | "CHAIN_RETRY_WITHOUT_LIMIT"
    | "CHAIN_AGENT_NO_OUTPUT";
  severity: ChainDiagnosticSeverity;
  message: string;
  suggestion: string;
  nodeId?: string;
  edgeId?: string;
  sources: SourceLocation[];
  confidence: number;
}

export interface FeatureSimulationStep {
  order: number;
  nodeIds: string[];
  incomingEdgeIds: string[];
}

export interface FeaturePathVariant {
  id: string;
  label: string;
  description: string;
  nodeIds: string[];
  edgeIds: string[];
  steps: FeatureSimulationStep[];
  resultNodeId?: string;
  confidence: number;
}

export interface FeatureScenario {
  id: string;
  label: string;
  description: string;
  entryNodeIds: string[];
  resultNodeIds: string[];
  nodeIds: string[];
  edgeIds: string[];
  variants: FeaturePathVariant[];
  diagnostics: ChainDiagnostic[];
  health: ChainHealth;
  confidence: number;
  product?: ProductEvidence;
}

export interface ProjectUnderstanding {
  summary: string;
  capabilities: ProjectCapabilityHint[];
  agentNodeIds: string[];
  workflowNodeIds: string[];
  toolNodeIds: string[];
  modelNodeIds: string[];
  documentsUsed: string[];
  confidence: number;
}

export interface LogicGraph {
  schemaVersion: typeof SCHEMA_VERSION;
  generatedAt: string;
  graphType: GraphType;
  title: string;
  description: string;
  project: ProjectSummary;
  understanding?: ProjectUnderstanding;
  nodes: LogicNode[];
  edges: LogicEdge[];
  features: FeatureScenario[];
  diagnostics: Diagnostic[];
}

export function assertConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
