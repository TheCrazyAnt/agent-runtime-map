import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type {
  ControlFlowKind,
  Evidence,
  RawCodeEdge,
  RawNodeKind,
  SourceLanguage,
} from "@agent-runtime-map/schema";

/**
 * Classification is a product judgement, not a language feature: an `agents/`
 * directory means the same thing in Python as in TypeScript. Keeping these rules in
 * one place is what stops two adapters from slowly disagreeing about what an Agent
 * is, which would show up as the same repository reading differently depending on
 * which files it happens to contain.
 */

/** Tests and type declarations describe the system, they are not the system running. */
export const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".logic-map",
  ".turbo",
  ".venv",
  "__mocks__",
  "__pycache__",
  "__tests__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "site-packages",
  "venv",
]);

/**
 * Scripts are real code but they are not the running system: smoke tests, one-off
 * migrations, and release helpers live here. They stay in the Raw Code Graph as
 * evidence, but path conventions such as `agents/` must not promote them.
 */
export const SUPPORTING_PATH_PATTERN = /(^|\/)(scripts?|tools?\/dev|examples?|fixtures?|benchmarks?)(\/|$)/i;

export const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

/** Node kinds that represent something able to receive control. */
export const CALLABLE_NODE_KINDS = new Set<RawNodeKind>([
  "agent",
  "function",
  "human_gate",
  "route",
  "service",
  "tool",
  "workflow",
]);

/**
 * A classification plus how much the signal that produced it is worth.
 *
 * Confidence is calibrated by **which signal fired**, not by the resulting kind.
 * A directory convention (`agents/`) is stronger evidence than a name suffix,
 * which is stronger than a verb appearing somewhere inside a name. Reporting one
 * flat number for every classification makes the score carry no information.
 */
export interface Classification {
  readonly kind: RawNodeKind;
  readonly confidence: number;
  readonly detail: string;
  readonly method: Evidence["method"];
}

/**
 * What a classifier needs to know about a declaration, stated in terms every
 * language can supply. An adapter answers these; it does not reimplement the rules.
 */
export interface DeclarationFacts {
  relativeFile: string;
  name: string;
  /** A private or protected member is an implementation detail of its class. */
  internal?: boolean;
  /** The class this member belongs to, if any. */
  enclosingClass?: string;
  /** True when the adapter already recognised a framework route convention. */
  routeConvention?: boolean;
}

/**
 * A naming convention needs a qualifier in front of the suffix. A function called
 * exactly `service` or `agent` names its category, not what it does, so treating it
 * as a high-confidence classification puts a node labelled "Service" on the map.
 */
export function hasQualifiedSuffix(name: string, pattern: RegExp): boolean {
  const match = pattern.exec(name);
  return match !== null && match.index > 0;
}

export function classifyDeclaration(facts: DeclarationFacts): Classification {
  const normalizedPath = facts.relativeFile.toLowerCase();
  const normalizedName = facts.name.toLowerCase();
  // Path conventions describe a whole directory, so they must not promote helper
  // scripts that merely happen to live under it.
  const pathConventionsApply = !SUPPORTING_PATH_PATTERN.test(normalizedPath);

  if (facts.routeConvention) {
    return { kind: "route", confidence: 0.95, detail: "Framework route handler convention", method: "framework_convention" };
  }
  if (/(^|\/)(page|layout)\.[jt]sx?$/.test(normalizedPath) && /(page|layout)$/.test(normalizedName)) {
    return { kind: "function", confidence: 1, detail: "Declared in source", method: "ast" };
  }
  // A private helper of a Service class is not itself a service.
  if (facts.internal) {
    return { kind: "function", confidence: 1, detail: "Private class member, treated as an implementation detail", method: "ast" };
  }
  if (hasQualifiedSuffix(normalizedName, /(workflow|orchestrator|pipeline|graph|crew)$/)) {
    return { kind: "workflow", confidence: 0.84, detail: "Workflow or orchestrator naming convention", method: "name_heuristic" };
  }
  if (pathConventionsApply && /(^|\/)(workflows?|orchestrators?|pipelines?|graphs?|crews?)(\/|$)/.test(normalizedPath)) {
    return { kind: "workflow", confidence: 0.72, detail: "Declared under a workflow or orchestrator directory", method: "path_heuristic" };
  }
  if (hasQualifiedSuffix(normalizedName, /agent$/)) {
    return { kind: "agent", confidence: 0.84, detail: "Agent naming convention", method: "name_heuristic" };
  }
  if (pathConventionsApply && /(^|\/)(agents?)(\/|$)/.test(normalizedPath)) {
    return { kind: "agent", confidence: 0.72, detail: "Declared under an Agent directory", method: "path_heuristic" };
  }
  if (/(approve|approval|humanreview|human_review|confirm|moderate)/.test(normalizedName)) {
    return { kind: "human_gate", confidence: 0.68, detail: "Human approval or review naming convention", method: "name_heuristic" };
  }
  if (hasQualifiedSuffix(normalizedName, /(tool|action)$/)) {
    return { kind: "tool", confidence: 0.8, detail: "Tool or action naming convention", method: "name_heuristic" };
  }
  if (pathConventionsApply && /(^|\/)(tools?|actions?)(\/|$)/.test(normalizedPath)) {
    return { kind: "tool", confidence: 0.65, detail: "Declared under a tool or action directory", method: "path_heuristic" };
  }
  if (hasQualifiedSuffix(normalizedName, /(service|usecase)$/)) {
    return { kind: "service", confidence: 0.8, detail: "Service naming convention", method: "name_heuristic" };
  }
  if (pathConventionsApply && /(^|\/)(services?|use-cases?|commands?)(\/|$)/.test(normalizedPath)) {
    return { kind: "service", confidence: 0.7, detail: "Declared under a service or use-case directory", method: "path_heuristic" };
  }
  if (facts.enclosingClass && /(service|controller|repository)$/i.test(facts.enclosingClass)) {
    return { kind: "service", confidence: 0.6, detail: "Public member of a service, controller, or repository class", method: "name_heuristic" };
  }
  if (/(handler|execute|process|generate|create|build)/.test(normalizedName)) {
    // The loosest signal in the set: a verb anywhere in the name. Many ordinary
    // helpers match it, so it is reported as such rather than as a confident fact.
    return { kind: "service", confidence: 0.5, detail: "Business verb in the declaration name", method: "name_heuristic" };
  }
  return { kind: "function", confidence: 1, detail: "Declared in source", method: "ast" };
}

export function evidence(
  file: string,
  startLine: number,
  method: Evidence["method"],
  detail: string,
  confidence: number,
  symbol?: string,
  endLine?: number,
): Evidence {
  return { source: { file, startLine, endLine, symbol }, method, detail, confidence };
}

export function makeEdge(
  source: string,
  target: string,
  kind: RawCodeEdge["kind"],
  itemEvidence: Evidence[],
  options: { label?: string; control?: ControlFlowKind; metadata?: Record<string, unknown> } = {},
): RawCodeEdge {
  return {
    id: stableId("edge", `${source}:${kind}:${target}:${options.control ?? "sequential"}:${options.label ?? ""}`),
    source,
    target,
    kind,
    label: options.label,
    control: options.control,
    metadata: options.metadata,
    evidence: itemEvidence,
  };
}

export function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha1").update(value).digest("hex").slice(0, 12)}`;
}

export function relativePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

export function languageForFile(file: string): SourceLanguage {
  if (/\.pyi?$/i.test(file)) return "python";
  return /\.[cm]?jsx?$/.test(file) ? "javascript" : "typescript";
}

export function humanize(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").trim();
}

export function firstSentence(value: string): string {
  return value.split(/(?<=[.!?])\s/)[0]?.trim().slice(0, 240) ?? value.slice(0, 240);
}

export function templateVariables(value: string): string[] {
  return [...new Set([...value.matchAll(/\{\{?\s*([a-zA-Z0-9_.]+)\s*\}?\}/g)].map((match) => match[1]!))];
}

export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/** Walks a project for source files, skipping the directories no adapter should read. */
export async function discoverSourceFiles(
  root: string,
  extensions: ReadonlySet<string>,
  excludedFilePattern: RegExp,
): Promise<string[]> {
  const found: string[] = [];
  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) await visit(absolute);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name)) && !excludedFilePattern.test(entry.name)) {
        found.push(absolute);
      }
    }
  }
  await visit(root);
  return found;
}
