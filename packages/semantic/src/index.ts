import type { LogicGraph, RawCodeGraph } from "@agent-runtime-map/schema";

export interface OpenAISemanticOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxDocumentCharacters?: number;
}

export interface SemanticPatch {
  summary: string;
  confidence: number;
  nodes: Array<{ id: string; label: string; description: string; confidence: number; reason: string }>;
  features: Array<{ id: string; label: string; description: string; confidence: number; reason: string }>;
}

const PATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "confidence", "nodes", "features"],
  properties: {
    summary: { type: "string", maxLength: 600 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    nodes: {
      type: "array",
      maxItems: 80,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "description", "confidence", "reason"],
        properties: {
          id: { type: "string" },
          label: { type: "string", maxLength: 80 },
          description: { type: "string", maxLength: 400 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reason: { type: "string", maxLength: 400 },
        },
      },
    },
    features: {
      type: "array",
      maxItems: 48,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "description", "confidence", "reason"],
        properties: {
          id: { type: "string" },
          label: { type: "string", maxLength: 80 },
          description: { type: "string", maxLength: 400 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reason: { type: "string", maxLength: 400 },
        },
      },
    },
  },
} as const;

export async function enrichLogicGraphWithOpenAI(
  raw: RawCodeGraph,
  graph: LogicGraph,
  options: OpenAISemanticOptions,
): Promise<LogicGraph> {
  if (!options.apiKey.trim()) throw new Error("Semantic enrichment requires an API key.");
  if (!options.model.trim()) throw new Error("Semantic enrichment requires an explicit model name.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const snapshot = semanticSnapshot(raw, graph, options.maxDocumentCharacters ?? 16_000);
  const response = await fetchImpl(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      store: false,
      instructions: [
        "You are the semantic compiler for an evidence-backed Agent code map.",
        "Translate technical names into concise product and runtime concepts.",
        "Use only the supplied node and feature IDs. Never add nodes, edges, files, or capabilities.",
        "Do not hide uncertainty: lower confidence when documentation and code evidence disagree.",
        "Labels must describe observable business or Agent behavior, not implementation syntax.",
      ].join(" "),
      input: JSON.stringify(snapshot),
      text: {
        format: {
          type: "json_schema",
          name: "agent_runtime_map_semantics",
          strict: true,
          schema: PATCH_SCHEMA,
        },
      },
    }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(openAIError(payload, response.status));
  const text = responseOutputText(payload);
  if (!text) throw new Error("Semantic enrichment returned no structured output.");
  return applySemanticPatch(graph, JSON.parse(text) as SemanticPatch, options.model);
}

export function semanticSnapshot(raw: RawCodeGraph, graph: LogicGraph, maxDocumentCharacters = 16_000): Record<string, unknown> {
  let remaining = Math.max(0, maxDocumentCharacters);
  const documents = (raw.context?.documents ?? []).flatMap((document) => {
    if (remaining <= 0) return [];
    const excerpt = document.excerpt.slice(0, Math.min(remaining, 2_000));
    remaining -= excerpt.length;
    return [{ path: document.path, kind: document.kind, title: document.title, summary: document.summary, excerpt }];
  });
  const prompts = (raw.context?.prompts ?? []).flatMap((prompt) => {
    if (remaining <= 0) return [];
    const excerpt = prompt.excerpt.slice(0, Math.min(remaining, 1_200));
    remaining -= excerpt.length;
    return [{ path: prompt.path, name: prompt.name, excerpt, variables: prompt.variables }];
  });
  return {
    project: {
      name: raw.project.name,
      frameworks: raw.project.frameworks,
      description: raw.context?.description,
      dependencies: raw.context?.dependencies.map((dependency) => dependency.name).slice(0, 120) ?? [],
    },
    documentedCapabilities: raw.context?.capabilityHints ?? [],
    documents,
    prompts,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      description: node.description,
      confidence: node.confidence,
      sources: node.sources,
      metadata: safeNodeMetadata(node.metadata),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      control: edge.control,
      label: edge.label,
      confidence: edge.confidence,
    })),
    features: graph.features.map((feature) => ({
      id: feature.id,
      label: feature.label,
      description: feature.description,
      nodeIds: feature.nodeIds,
      health: feature.health,
      confidence: feature.confidence,
    })),
  };
}

export function applySemanticPatch(graph: LogicGraph, patch: SemanticPatch, model: string): LogicGraph {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const featureIds = new Set(graph.features.map((feature) => feature.id));
  const nodePatches = new Map(patch.nodes.filter((item) => nodeIds.has(item.id) && validText(item.label, 80) && validText(item.description, 400)).map((item) => [item.id, item]));
  const featurePatches = new Map(patch.features.filter((item) => featureIds.has(item.id) && validText(item.label, 80) && validText(item.description, 400)).map((item) => [item.id, item]));
  const nodes = graph.nodes.map((node) => {
    const semantic = nodePatches.get(node.id);
    if (!semantic) return node;
    // A model may only fill a slot the deterministic pass declined. Overwriting a
    // name that was read from evidence would replace a checkable conclusion with
    // an unverifiable one — and since the Viewer reads `semantic`, patching only
    // `label` would have made the model's output invisible while its confidence
    // still landed on the node.
    const canRename = node.semantic?.pending !== false;
    const patchedSemantic = node.semantic && canRename
      ? {
        ...node.semantic,
        label: { "zh-CN": semantic.label.trim(), en: semantic.label.trim() },
        description: { "zh-CN": semantic.description.trim(), en: semantic.description.trim() },
        labelSource: { "zh-CN": "llm" as const, en: "llm" as const },
        confidence: {
          "zh-CN": boundedConfidence(semantic.confidence),
          en: boundedConfidence(semantic.confidence),
        },
        pending: false,
      }
      : node.semantic;
    return {
      ...node,
      label: canRename ? semantic.label.trim() : node.label,
      description: canRename ? semantic.description.trim() : node.description,
      semantic: patchedSemantic,
      confidence: Math.min(node.confidence, boundedConfidence(semantic.confidence)),
      inference: {
        method: "mixed" as const,
        explanation: `${node.inference.explanation}; LLM semantic compression (${model}): ${semantic.reason.trim()}`,
      },
      metadata: { ...node.metadata, semanticModel: model, generatedDescription: false },
    };
  });
  const features = graph.features.map((feature) => {
    const semantic = featurePatches.get(feature.id);
    return semantic ? {
      ...feature,
      label: semantic.label.trim(),
      description: semantic.description.trim(),
      confidence: Math.min(feature.confidence, boundedConfidence(semantic.confidence)),
    } : feature;
  });
  return {
    ...graph,
    description: validText(patch.summary, 600) ? patch.summary.trim() : graph.description,
    understanding: graph.understanding ? {
      ...graph.understanding,
      summary: validText(patch.summary, 600) ? patch.summary.trim() : graph.understanding.summary,
      confidence: Math.min(graph.understanding.confidence, boundedConfidence(patch.confidence)),
    } : graph.understanding,
    nodes,
    features,
    diagnostics: [...graph.diagnostics, {
      level: "info",
      code: "SEMANTIC_ENRICHMENT_APPLIED",
      message: `Applied evidence-constrained semantic labels with ${model}; graph topology and source evidence were not changed.`,
    }],
  };
}

function safeNodeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const allowed = ["rawKind", "rawName", "role", "returnType", "parameters", "factory", "model", "toolNames", "documentedCapabilityLabel"];
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => allowed.includes(key)));
}

function responseOutputText(payload: Record<string, unknown>): string | undefined {
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : [];
    for (const part of content) {
      if (part && typeof part === "object" && (part as Record<string, unknown>).type === "output_text" && typeof (part as Record<string, unknown>).text === "string") {
        return (part as Record<string, unknown>).text as string;
      }
    }
  }
  return undefined;
}

function openAIError(payload: Record<string, unknown>, status: number): string {
  const error = payload.error;
  const message = error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string"
    ? (error as Record<string, unknown>).message
    : undefined;
  return `Semantic enrichment request failed (${status})${message ? `: ${message}` : "."}`;
}

function validText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function boundedConfidence(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
