export const SCHEMA_VERSION = "0.1.0" as const;

export type SourceLanguage = "typescript" | "javascript" | "python";

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
  /**
   * Names and terms the project states for itself in `agent-runtime-map.config.json`.
   * A person's word about their own domain outranks every derivation, so these are
   * carried through the pipeline rather than re-read downstream.
   */
  localization?: {
    terms?: Record<string, { "zh-CN"?: string; en?: string }>;
    nodes?: Record<string, { label?: Partial<LocalizedText>; description?: Partial<LocalizedText> }>;
  };
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
  /**
   * Structured facts behind the diagnostic — for an unresolved call, the reason,
   * the inference method, and the analyzer's confidence in the diagnosis itself.
   */
  metadata?: Record<string, unknown>;
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


/** The two locales the product ships in. */
export type LocaleTag = "zh-CN" | "en";

/** One value per locale. Both slots are always filled, so no reader needs a fallback. */
export interface LocalizedValue<T> {
  "zh-CN": T;
  en: T;
}

export type LocalizedText = LocalizedValue<string>;

/**
 * Where a displayed name came from, per locale.
 *
 * The two locales can legitimately differ: a Chinese README names a capability in
 * Chinese while the English name is still read off the identifier. Reporting one
 * source for the pair would make one of them a claim the evidence cannot back.
 */
export type LabelSource =
  | "config"
  | "documented"
  | "docstring"
  | "route"
  | "vendor"
  | "identifier"
  | "composed"
  /** An optional model filled a slot the deterministic pass declined. */
  | "llm"
  | "pending";

/** One identifier token and how it was rendered. */
export interface SemanticToken {
  token: string;
  en: string;
  "zh-CN"?: string;
  via: "vocabulary" | "glossary" | "config" | "acronym" | "literal" | "unresolved";
}

/**
 * A displayed name in both languages, with the evidence behind it.
 *
 * `confidence` here is confidence in the **name**, never in the code. A node whose
 * call graph is certain can still be impossible to name, and a confidently named
 * node can sit on weak code evidence. Merging the two would let a good name make
 * questionable code look settled — the same separation `ProductEvidence.match`
 * already keeps between a document and the code it describes.
 */
export interface SemanticLabel {
  label: LocalizedText;
  description: LocalizedText;
  /** The identifier, route, or vendor name exactly as written. Never translated. */
  technicalName: string;
  labelSource: LocalizedValue<LabelSource>;
  confidence: LocalizedValue<number>;
  /** True when either locale could not be named from evidence: the Viewer shows 待确认. */
  pending: boolean;
  /**
   * The sources behind the NAME in each language, distinct from the node's own
   * `sources`. Per locale because the two names can legitimately come from
   * different places — a Chinese README line for one, the identifier's own
   * declaration for the other — and one flat list would attach the document to a
   * name that was never read from it. Both slots are always present; a slot is an
   * empty array when the name needed no reading at all (a route or a vendor id is
   * shown verbatim, so there is no claim beyond the node's own sources).
   */
  evidence: LocalizedValue<SourceLocation[]>;
  /** How each token of the identifier was rendered. Capped so a node stays small. */
  glossary?: SemanticToken[];
}

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
  behavior?: LogicBehavior;
  /**
   * The business reading of this step, in both languages, derived at compile time
   * from project evidence. Optional: a graph compiled before this existed still
   * renders, through the Viewer's own fallback.
   */
  semantic?: SemanticLabel;
  metadata?: Record<string, unknown>;
}

/**
 * What a step does, read off the edges the compiler already produced.
 *
 * A description that restates its own label ("An AI workflow performs generate
 * ideas") costs a line and says nothing. These are the facts worth saying instead,
 * kept as data rather than a sentence so each language can phrase them itself, and
 * every one of them traces back through an edge that carries its `rawEdgeIds`.
 *
 * Every field holds **node ids**, not labels. A label is already a rendering choice —
 * a Chinese reader translates `executeContentWorkflow` to 执行内容工作流, and a
 * sentence built from the English label "Execute Content" would call the same node
 * 执行内容 two lines apart. Ids let each surface resolve the one name it uses.
 */
export interface LogicBehavior {
  /** Steps this one hands control to in order. */
  calls: string[];
  /** Steps it reaches only under a condition, or as a fallback. */
  branches: string[];
  /** Models and external systems it calls out to. */
  requests: string[];
  /** Data stores it reads or writes. */
  data: string[];
  /** Steps its result flows into. */
  feeds: string[];
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
  /** The flow kind said in each language: 条件分支 / Conditional branch. */
  semantic?: { label: LocalizedText };
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
  /** The same finding said in each language. */
  semantic?: { message: LocalizedText; suggestion: LocalizedText };
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
  semantic?: SemanticLabel;
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
  /**
   * The feature's business name and one-sentence summary, composed at compile time
   * from its entry, main step, and result — and deduplicated against the other
   * features, so two routes never present the same name. `label` above is left
   * alone: it is hashed into `id`, and renaming it would break every saved layout
   * and trace overlay that refers to this feature.
   */
  semantic?: SemanticLabel;
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

/**
 * An optional bridge from a real run back onto the map.
 *
 * A trace event does not describe topology and cannot introduce any: it names an id
 * the graph already has and says what happened there. That is the whole contract.
 * Runtime observation is layered *over* the evidence-backed graph, never in place of
 * it — an opaque span that matches nothing must surface as unmatched rather than
 * appear as a node nobody can trace back to source.
 */
export type TraceEventKind = "started" | "completed" | "failed" | "skipped";

export interface TraceEvent {
  /** A stable id already in the graph: a LogicNode, a LogicEdge, or a RawCodeNode. */
  target: string;
  kind: TraceEventKind;
  /** ISO 8601. Events without one keep the order they were given in. */
  at?: string;
  durationMs?: number;
  detail?: string;
  attributes?: Record<string, unknown>;
}

/** How an id was found, so a reader can tell a direct hit from a lifted one. */
export type TraceMatch = "logic_node" | "logic_edge" | "raw_node";

export interface TraceObservation {
  state: TraceEventKind;
  events: number;
  matchedVia: TraceMatch;
  totalDurationMs?: number;
  lastDetail?: string;
  lastAt?: string;
}

export interface TraceOverlay {
  nodes: Record<string, TraceObservation>;
  edges: Record<string, TraceObservation>;
  /** Events naming an id this graph does not have. Reported, never invented. */
  unmatched: TraceEvent[];
  /** Fraction of the graph's nodes that the run actually touched. */
  coverage: number;
}

export function assertConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
