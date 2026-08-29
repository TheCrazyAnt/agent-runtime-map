import {
  STRUCTURAL_TOKENS,
  VOCABULARY,
  normalizeToken,
  tokenizeIdentifier,
  type Term,
} from "@agent-runtime-map/analysis-kit";
import type {
  ControlFlowKind,
  LabelSource,
  LocaleTag,
  LocalizedText,
  LogicEdge,
  LogicNode,
  LogicNodeType,
  ProjectCapabilityHint,
  SemanticLabel,
  SemanticToken,
  SourceLocation,
} from "@agent-runtime-map/schema";

/**
 * Reads a compiled graph as business language, in both languages, at compile time.
 *
 * This is derivation, not translation-at-render: every name it produces is a
 * conclusion drawn from evidence that only exists here — the project's own
 * documents, its configuration, the identifier as written, and the node's place in
 * the graph. The Viewer receives the answer and its provenance and renders it; it
 * has nothing left to guess with, which is the point.
 *
 * The rule that keeps it honest: **a name that cannot be read from evidence is
 * marked pending, never invented.** A reader who sees a name can trace it; a
 * reader who sees 待确认 knows the tool declined rather than guessed.
 */

export const LOCALES: LocaleTag[] = ["zh-CN", "en"];

/** Below this, a name is a guess rather than a reading, and the node goes pending. */
export const PENDING_THRESHOLD = 0.5;

/** At most this many tokens are reported, so a node stays small. */
const MAX_GLOSSARY = 8;

/** A name a person stated for one node, in either or both languages. */
export interface NodeOverride {
  label?: Partial<LocalizedText>;
  description?: Partial<LocalizedText>;
}

export interface LocalizationOverrides {
  /** Project domain terms: one lowercased identifier token to its reading. */
  terms?: Record<string, { "zh-CN"?: string; en?: string }>;
  /** Whole-name overrides, keyed by technical name or logic node id. */
  nodes?: Record<string, NodeOverride>;
}

export interface LocalizationInput {
  capabilities: readonly ProjectCapabilityHint[];
  overrides?: LocalizationOverrides;
}

const CONFIG_SOURCE: SourceLocation = { file: "agent-runtime-map.config.json", startLine: 1 };

/** Acronyms that are the same word in both languages; translating them loses meaning. */
const ACRONYMS = new Set(["api", "url", "id", "http", "https", "html", "json", "csv", "pdf", "sql", "ui", "ux", "ai", "llm", "rag", "sdk", "jwt", "cdn", "dns", "ip", "db", "io", "rpc", "crud", "otp", "sms", "pii"]);

/** Connectives that reorder a name rather than adding a word to it. */
const CONNECTIVES = new Set(["by", "for", "from", "to", "of", "with", "in", "on", "and", "or", "a", "an", "the"]);

// ---------------------------------------------------------------------------
// Node naming
// ---------------------------------------------------------------------------

export function localizeNodeSemantics(
  node: LogicNode,
  input: LocalizationInput,
  nodesById: ReadonlyMap<string, LogicNode>,
): SemanticLabel {
  const technicalName = typeof node.metadata?.rawName === "string" ? node.metadata.rawName : node.label;
  const rawKind = node.metadata?.rawKind;
  const evidence: SourceLocation[] = [];

  const label: Record<LocaleTag, string> = { "zh-CN": "", en: "" };
  const labelSource: Record<LocaleTag, LabelSource> = { "zh-CN": "pending", en: "pending" };
  const confidence: Record<LocaleTag, number> = { "zh-CN": 0, en: 0 };
  let glossary: SemanticToken[] | undefined;

  const override = input.overrides?.nodes?.[technicalName] ?? input.overrides?.nodes?.[node.id];
  const capability = documentedCapability(node, input.capabilities);

  for (const locale of LOCALES) {
    // 1. A term the project's own configuration states. Nothing outranks a person.
    const stated = override?.label?.[locale];
    if (stated) {
      label[locale] = stated;
      labelSource[locale] = "config";
      confidence[locale] = 1;
      if (!evidence.some((item) => item.file === CONFIG_SOURCE.file)) evidence.push(CONFIG_SOURCE);
      continue;
    }
    // 2. A capability the project documented, when it is written in this language.
    if (capability && isInLocale(capability.label, locale)) {
      label[locale] = capability.label;
      labelSource[locale] = "documented";
      confidence[locale] = capability.confidence;
      for (const source of capability.sources.slice(0, 2)) {
        if (!evidence.some((item) => item.file === source.file && item.startLine === source.startLine)) evidence.push(source);
      }
      continue;
    }
    // 3. A route and a vendor name are already the clearest thing they can be:
    //    translating `POST /api/tickets` or `api.stripe.com` destroys the address.
    if (rawKind === "route" || node.type === "entrypoint") {
      label[locale] = node.label;
      labelSource[locale] = "route";
      confidence[locale] = 1;
      continue;
    }
    if (rawKind === "external_api" || rawKind === "model" || node.type === "external_system" || node.type === "model") {
      // A host or a model id is an address. `gpt-5` humanized into "Gpt 5" no
      // longer identifies anything, so the written form wins over the pretty one.
      label[locale] = technicalName;
      labelSource[locale] = "vendor";
      confidence[locale] = 1;
      continue;
    }
    // 4. Read the identifier through the shared vocabulary plus project terms.
    const read = readIdentifier(technicalName, locale, input.overrides?.terms, redundantSuffixFor(node));
    label[locale] = read.text;
    labelSource[locale] = read.source;
    confidence[locale] = read.confidence;
    if (locale === "en" && read.tokens.length) glossary = read.tokens.slice(0, MAX_GLOSSARY);
  }

  const pending = LOCALES.some((locale) => labelSource[locale] === "pending");
  if (pending) {
    for (const locale of LOCALES) {
      if (labelSource[locale] !== "pending") continue;
      // Named by what it demonstrably IS — its kind — rather than by a guess at
      // what it does. The technical name stays one click away in the details.
      label[locale] = locale === "zh-CN"
        ? `待确认 · ${TYPE_NAMES["zh-CN"][node.type]}`
        : `Unconfirmed · ${TYPE_NAMES.en[node.type]}`;
    }
  }

  const description = describeNode(node, label, labelSource, nodesById, override, capability, evidence);

  return {
    label: { "zh-CN": label["zh-CN"], en: label.en },
    description,
    technicalName,
    labelSource: { "zh-CN": labelSource["zh-CN"], en: labelSource.en },
    confidence: { "zh-CN": round(confidence["zh-CN"]), en: round(confidence.en) },
    pending,
    evidence,
    glossary,
  };
}

/**
 * Reads one identifier as business language.
 *
 * Every token is looked up; the ones that resolve are rendered, and the ones that
 * do not are **kept verbatim and counted against the confidence**. A name where
 * too little resolved is reported as pending rather than half-translated, because
 * "创建 DirectorLedger" is the mixed-script state this whole feature exists to end.
 */
export function readIdentifier(
  identifier: string,
  locale: LocaleTag,
  terms?: LocalizationOverrides["terms"],
  redundantSuffix?: string,
): { text: string; source: LabelSource; confidence: number; tokens: SemanticToken[] } {
  const raw = tokenizeIdentifier(identifier);
  const meaningful = raw.filter((token) => !STRUCTURAL_TOKENS.has(token.toLowerCase()));
  let tokens = (meaningful.length ? meaningful : raw).filter((token) => !CONNECTIVES.has(token.toLowerCase()));
  // `generateIdeasAgent` on a node already drawn as an Agent says "agent" twice.
  // Dropped only as a trailing word, and only when the node's kind already says it.
  if (redundantSuffix && tokens.length > 1 && tokens.at(-1)!.toLowerCase() === redundantSuffix) {
    tokens = tokens.slice(0, -1);
  }
  if (!tokens.length) {
    return { text: identifier, source: "pending", confidence: 0, tokens: [] };
  }

  const rendered: SemanticToken[] = [];
  let resolved = 0;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const configured = terms?.[lower];
    if (configured?.[locale] || configured?.en) {
      rendered.push({ token: lower, en: configured.en ?? capitalize(token), "zh-CN": configured["zh-CN"], via: "config" });
      resolved += 1;
      continue;
    }
    if (ACRONYMS.has(lower)) {
      rendered.push({ token: lower, en: lower.toUpperCase(), "zh-CN": lower.toUpperCase(), via: "acronym" });
      resolved += 1;
      continue;
    }
    if (/^\d+$/.test(lower)) {
      rendered.push({ token: lower, en: lower, "zh-CN": lower, via: "literal" });
      resolved += 1;
      continue;
    }
    const term: Term | undefined = VOCABULARY[normalizeToken(lower)];
    if (term) {
      rendered.push({ token: lower, en: term.enUS ?? capitalize(token), "zh-CN": term.zhCN, via: "vocabulary" });
      resolved += 1;
      continue;
    }
    // Unknown: kept exactly as written, and counted against the reading.
    rendered.push({ token: lower, en: capitalize(token), via: "unresolved" });
  }

  const ratio = resolved / tokens.length;
  if (locale === "zh-CN") {
    // Chinese cannot absorb a stray English word without becoming the mixed state
    // this feature exists to end, so a partial reading is not offered as a name.
    if (ratio < 1) return { text: "", source: "pending", confidence: round(ratio), tokens: rendered };
    return { text: rendered.map((item) => item["zh-CN"] ?? item.en).join(""), source: "identifier", confidence: 1, tokens: rendered };
  }
  // English reads the identifier as words, which is a real improvement over the
  // raw camelCase even when a token is not in the vocabulary.
  if (ratio < PENDING_THRESHOLD) return { text: "", source: "pending", confidence: round(ratio), tokens: rendered };
  return {
    text: rendered.map((item, index) => (index === 0 ? capitalize(item.en) : item.en.toLowerCase() === item.en ? item.en : lowerUnlessAcronym(item.en))).join(" "),
    source: "identifier",
    confidence: round(ratio),
    tokens: rendered,
  };
}

function lowerUnlessAcronym(value: string): string {
  return value === value.toUpperCase() && value.length <= 5 ? value : value.toLowerCase();
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Whether a documented string is written in the locale it would be shown in. */
function isInLocale(value: string, locale: LocaleTag): boolean {
  const hasHan = /[㐀-鿿]/.test(value);
  return locale === "zh-CN" ? hasHan : !hasHan;
}

function documentedCapability(
  node: LogicNode,
  capabilities: readonly ProjectCapabilityHint[],
): ProjectCapabilityHint | undefined {
  const id = node.metadata?.documentedCapabilityId;
  if (typeof id !== "string") return undefined;
  const match = capabilities.find((item) => item.id === id);
  if (!match) return undefined;
  // A documented capability describes a *feature*, not every step inside it. The
  // matcher happily attaches "Refund" to a triage agent and a database table that
  // merely share a word; letting that rename them would put one feature's name on
  // three unrelated steps. Only a name the document states outright may rename a
  // step, and only when the step's own identifier says the same thing.
  if (node.product?.matchedOn !== "documented_name") return undefined;
  const technical = typeof node.metadata?.rawName === "string" ? node.metadata.rawName : node.label;
  const identifierTokens = tokenizeIdentifier(technical)
    .map((token) => normalizeToken(token.toLowerCase()))
    .filter((token) => !STRUCTURAL_TOKENS.has(token));
  const capabilityTokens = new Set(tokenizeIdentifier(match.label).map((token) => normalizeToken(token.toLowerCase())));
  // The document must account for the WHOLE identifier, not merely share a word
  // with it. "Refund" explains `refundWorkflow`; it does not explain
  // `approveRefund`, where dropping "approve" would rename a gate after the thing
  // it gates — and would leave the same node reading 批准退款 in one language and
  // "Refund" in the other.
  const covered = identifierTokens.length > 0 && identifierTokens.every((token) => capabilityTokens.has(token));
  return covered ? match : undefined;
}

/** The word a node's own kind already says, so its name need not repeat it. */
function redundantSuffixFor(node: LogicNode): string | undefined {
  const kind = node.metadata?.rawKind;
  if (kind === "agent" || node.type === "ai_process") return "agent";
  if (kind === "workflow") return "workflow";
  if (kind === "tool") return "tool";
  if (kind === "service") return "service";
  return undefined;
}

const TYPE_NAMES: Record<LocaleTag, Record<LogicNodeType, string>> = {
  "zh-CN": {
    user_action: "用户操作", entrypoint: "入口", process: "处理步骤", workflow: "工作流",
    ai_process: "AI 处理", tool: "工具", model: "模型", human_gate: "人工确认",
    decision: "判断", data: "数据", external_system: "外部服务", result: "结果",
  },
  en: {
    user_action: "user action", entrypoint: "entrypoint", process: "process", workflow: "workflow",
    ai_process: "AI process", tool: "tool", model: "model", human_gate: "human gate",
    decision: "decision", data: "data", external_system: "external system", result: "result",
  },
};

// ---------------------------------------------------------------------------
// Descriptions
// ---------------------------------------------------------------------------

function describeNode(
  node: LogicNode,
  label: Record<LocaleTag, string>,
  labelSource: Record<LocaleTag, LabelSource>,
  nodesById: ReadonlyMap<string, LogicNode>,
  override: NodeOverride | undefined,
  capability: ProjectCapabilityHint | undefined,
  evidence: SourceLocation[],
): LocalizedText {
  const out: Record<LocaleTag, string> = { "zh-CN": "", en: "" };
  const generated = node.metadata?.generatedDescription === true;

  for (const locale of LOCALES) {
    const stated = override?.description?.[locale];
    if (stated) { out[locale] = stated; continue; }
    if (capability?.description && isInLocale(capability.description, locale)) {
      out[locale] = capability.description;
      continue;
    }
    // A description a person wrote is used in its own language, never machine
    // translated into the other one — a mistranslated docstring is worse than none.
    if (!generated && node.description && isInLocale(node.description, locale)) {
      out[locale] = node.description;
      continue;
    }
    const behavior = describeBehaviorIn(locale, node, nodesById);
    if (behavior) { out[locale] = behavior; continue; }
    out[locale] = labelSource[locale] === "pending"
      ? (locale === "zh-CN"
        ? `这一步的业务含义还无法从证据中确定，技术名称为 ${node.metadata?.rawName ?? node.label}。`
        : `This step's business meaning could not be read from evidence; its technical name is ${node.metadata?.rawName ?? node.label}.`)
      : typeSentence(locale, node.type, label[locale]);
  }
  if (capability && !evidence.length) evidence.push(...capability.sources.slice(0, 1));
  return { "zh-CN": out["zh-CN"], en: out.en };
}

function typeSentence(locale: LocaleTag, type: LogicNodeType, name: string): string {
  if (locale === "zh-CN") {
    const zh: Record<LogicNodeType, string> = {
      user_action: `用户发起「${name}」。`,
      entrypoint: `系统通过 ${name} 接收请求。`,
      process: `系统执行「${name}」。`,
      workflow: `工作流编排「${name}」。`,
      ai_process: `AI 环节执行「${name}」。`,
      tool: `智能体调用工具「${name}」。`,
      model: `智能体使用模型 ${name}。`,
      human_gate: `等待人工确认「${name}」。`,
      decision: `系统判断「${name}」。`,
      data: `系统读写「${name}」。`,
      external_system: `系统调用外部服务 ${name}。`,
      result: `流程产出「${name}」。`,
    };
    return zh[type];
  }
  const en: Record<LogicNodeType, string> = {
    user_action: `A person starts ${name}.`,
    entrypoint: `The system receives a request through ${name}.`,
    process: `The system runs ${name}.`,
    workflow: `A workflow orchestrates ${name}.`,
    ai_process: `An AI step runs ${name}.`,
    tool: `An agent calls the ${name} tool.`,
    model: `An agent uses the ${name} model.`,
    human_gate: `A person must approve ${name}.`,
    decision: `The system decides ${name}.`,
    data: `The system reads or writes ${name}.`,
    external_system: `The system calls ${name}.`,
    result: `The chain produces ${name}.`,
  };
  return en[type];
}

/** Names other steps the way those steps name themselves, in the same language. */
function describeBehaviorIn(
  locale: LocaleTag,
  node: LogicNode,
  nodesById: ReadonlyMap<string, LogicNode>,
): string | undefined {
  const behavior = node.behavior;
  if (!behavior) return undefined;
  const name = (id: string): string => {
    const target = nodesById.get(id);
    return target?.semantic?.label[locale] ?? target?.label ?? id;
  };
  const quote = (id: string) => (locale === "zh-CN" ? `「${name(id)}」` : name(id));
  const parts: string[] = [];
  const list = (ids: string[]) => ids.slice(0, 3).map(quote).join(locale === "zh-CN" ? "、" : ", ");

  if (behavior.calls?.length) parts.push(locale === "zh-CN" ? `调用${list(behavior.calls)}` : `calls ${list(behavior.calls)}`);
  if (behavior.branches?.length) parts.push(locale === "zh-CN" ? `按条件走向${list(behavior.branches)}` : `branches to ${list(behavior.branches)}`);
  if (behavior.requests?.length) parts.push(locale === "zh-CN" ? `请求${list(behavior.requests)}` : `requests ${list(behavior.requests)}`);
  if (behavior.data?.length) parts.push(locale === "zh-CN" ? `读写${list(behavior.data)}` : `reads or writes ${list(behavior.data)}`);
  if (behavior.feeds?.length) parts.push(locale === "zh-CN" ? `结果流向${list(behavior.feeds)}` : `passes its result to ${list(behavior.feeds)}`);
  if (!parts.length) return undefined;
  return locale === "zh-CN" ? `${parts.join("，")}。` : `${capitalize(parts[0]!)}${parts.length > 1 ? `, then ${parts.slice(1).join(", ")}` : ""}.`;
}

// ---------------------------------------------------------------------------
// Edges, variants, diagnostics
// ---------------------------------------------------------------------------

const CONTROL_NAMES: Record<LocaleTag, Record<ControlFlowKind, string>> = {
  "zh-CN": {
    sequential: "顺序执行", conditional: "条件分支", parallel: "并行执行",
    loop: "循环执行", retry: "失败重试", fallback: "降级备选", human_approval: "等待人工确认",
  },
  en: {
    sequential: "Sequential", conditional: "Conditional branch", parallel: "Parallel",
    loop: "Loop", retry: "Retry on failure", fallback: "Fallback", human_approval: "Awaiting approval",
  },
};

export function localizeEdge(edge: LogicEdge, nodesById: ReadonlyMap<string, LogicNode>): LocalizedText {
  if (edge.type === "data_flow") {
    const target = nodesById.get(edge.target);
    const isStore = target?.type === "data";
    return {
      "zh-CN": isStore ? "读写数据" : "数据流转",
      en: isStore ? "Reads or writes" : "Data flow",
    };
  }
  const control = edge.control ?? "sequential";
  return { "zh-CN": CONTROL_NAMES["zh-CN"][control], en: CONTROL_NAMES.en[control] };
}

export function controlFlowName(control: ControlFlowKind, locale: LocaleTag): string {
  return CONTROL_NAMES[locale][control];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
