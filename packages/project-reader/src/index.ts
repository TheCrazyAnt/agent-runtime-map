import { createHash } from "node:crypto";
import { access, open, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type {
  Diagnostic,
  ProjectCapabilityHint,
  ProjectContext,
  ProjectDependency,
  ProjectDocument,
  ProjectDocumentKind,
  ProjectPrompt,
  SourceLocation,
} from "@agent-runtime-map/schema";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".logic-map",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const DOCUMENT_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst"]);
const PROMPT_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".yaml", ".yml", ".json"]);
const CONFIG_NAMES = new Set([
  "agent-runtime-map.config.json",
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "vite.config.js",
  "vite.config.ts",
  "wrangler.json",
  "wrangler.toml",
]);
const SENSITIVE_FILE_PATTERN = /(^|\/)(?:\.env(?:\.[^\/]*)?|[^\/]*\.(?:pem|key|p12|pfx)|(?:credentials?|secrets?)(?:[._-][^\/]*)?)(?:\/|$)/i;
const GENERIC_HEADING_PATTERN = /^(about|api|architecture|configuration|contents?|contributing|development|docs?|features?|getting started|installation|license|overview|quick ?start|roadmap|setup|tests?|usage|关于|功能|功能列表|安装|开始|开发|架构|概览|目录|配置|使用|路线图)$/i;

export interface ProjectReaderOptions {
  maxDocuments?: number;
  maxDocumentBytes?: number;
  maxTotalBytes?: number;
}

interface ReaderConfig {
  description?: string;
  features?: Record<string, { label?: string; description?: string; keywords?: string[] }>;
}

interface CandidateFile {
  absolute: string;
  relative: string;
  kind: ProjectDocumentKind;
}

export async function readProjectContext(
  inputRoot: string,
  options: ProjectReaderOptions = {},
): Promise<ProjectContext> {
  const root = path.resolve(inputRoot);
  const diagnostics: Diagnostic[] = [];
  const maxDocuments = options.maxDocuments ?? 80;
  const maxDocumentBytes = options.maxDocumentBytes ?? 96_000;
  const maxTotalBytes = options.maxTotalBytes ?? 750_000;
  const manifest = await readManifest(root, diagnostics);
  const config = await readReaderConfig(root, diagnostics);
  const candidates = (await discoverContextFiles(root)).slice(0, maxDocuments);
  const documents: ProjectDocument[] = [];
  const prompts: ProjectPrompt[] = [];
  let totalBytes = 0;

  for (const candidate of candidates) {
    if (totalBytes >= maxTotalBytes) break;
    const remaining = Math.min(maxDocumentBytes, maxTotalBytes - totalBytes);
    const loaded = await readText(candidate.absolute, remaining);
    if (!loaded) continue;
    totalBytes += loaded.bytesRead;
    const title = documentTitle(candidate.relative, loaded.text);
    const headings = markdownHeadings(loaded.text);
    documents.push({
      path: candidate.relative,
      kind: candidate.kind,
      title,
      summary: documentSummary(loaded.text, title),
      headings: headings.map((heading) => heading.label).slice(0, 32),
      excerpt: normalizedExcerpt(loaded.text, 6_000),
      truncated: loaded.truncated,
    });
    if (candidate.kind === "prompt") {
      prompts.push({
        path: candidate.relative,
        name: title,
        excerpt: normalizedExcerpt(loaded.text, 6_000),
        variables: promptVariables(loaded.text),
        source: "file",
      });
    }
  }

  if (candidates.length >= maxDocuments) {
    diagnostics.push({
      level: "warning",
      code: "PROJECT_CONTEXT_FILE_LIMIT",
      message: `Project context reading was limited to ${maxDocuments} documentation and prompt files.`,
    });
  }
  if (totalBytes >= maxTotalBytes) {
    diagnostics.push({
      level: "warning",
      code: "PROJECT_CONTEXT_BYTE_LIMIT",
      message: `Project context reading reached the ${maxTotalBytes}-byte safety limit.`,
    });
  }

  const capabilityHints = mergeCapabilities([
    ...documents.flatMap(capabilitiesFromDocument),
    ...capabilitiesFromConfig(config),
  ]).slice(0, 48);

  return {
    description: config.description ?? stringValue(manifest.description, 600),
    packageManager: await detectPackageManager(root),
    scripts: Object.keys(objectValue(manifest.scripts)).sort(),
    dependencies: dependencyList(manifest),
    documents,
    prompts,
    configurationFiles: await discoverConfigurationFiles(root),
    capabilityHints,
    diagnostics,
  };
}

async function discoverContextFiles(root: string): Promise<CandidateFile[]> {
  const found: CandidateFile[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 5) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = relativePath(root, absolute);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) await visit(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile() || SENSITIVE_FILE_PATTERN.test(relative)) continue;
      const kind = contextKind(relative);
      if (kind) found.push({ absolute, relative, kind });
    }
  }
  await visit(root, 0);
  return found.sort((a, b) => contextPriority(a) - contextPriority(b) || a.relative.localeCompare(b.relative));
}

function contextKind(relative: string): ProjectDocumentKind | undefined {
  const normalized = relative.toLowerCase();
  const base = path.posix.basename(normalized);
  const extension = path.posix.extname(base);
  if (/^readme(?:\.|$)/.test(base) && DOCUMENT_EXTENSIONS.has(extension)) return "readme";
  if (/(^|\/)(prd|product[-_ ]?requirements?)(\.|\/)/.test(normalized) && DOCUMENT_EXTENSIONS.has(extension)) return "prd";
  if (/(^|\/)(prompts?|instructions?|system-prompts?)(\/|\.|$)/.test(normalized) && PROMPT_EXTENSIONS.has(extension)) return "prompt";
  if ((normalized.startsWith("docs/") || normalized.includes("/docs/")) && DOCUMENT_EXTENSIONS.has(extension)) return "documentation";
  return undefined;
}

function contextPriority(candidate: CandidateFile): number {
  return candidate.kind === "readme" ? 0 : candidate.kind === "prd" ? 1 : candidate.kind === "prompt" ? 2 : 3;
}

async function readText(file: string, maxBytes: number): Promise<{ text: string; bytesRead: number; truncated: boolean } | undefined> {
  let handle;
  try {
    handle = await open(file, "r");
    const details = await handle.stat();
    const bytesToRead = Math.min(details.size, Math.max(0, maxBytes));
    const buffer = Buffer.alloc(bytesToRead);
    const result = await handle.read(buffer, 0, bytesToRead, 0);
    const contents = buffer.subarray(0, result.bytesRead);
    if (contents.includes(0)) return undefined;
    return {
      text: contents.toString("utf8"),
      bytesRead: result.bytesRead,
      truncated: details.size > result.bytesRead,
    };
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function capabilitiesFromDocument(document: ProjectDocument): ProjectCapabilityHint[] {
  const lines = document.excerpt.split(/\r?\n/);
  const hints: ProjectCapabilityHint[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const heading = /^(#{2,4})\s+(.+?)\s*$/.exec(line);
    const boldBullet = /^\s*[-*+]\s+\*\*(.+?)\*\*\s*[:：-]?\s*(.*)$/.exec(line);
    const label = cleanMarkdown(heading?.[2] ?? boldBullet?.[1] ?? "");
    if (!isCapabilityLabel(label)) continue;
    const following = cleanMarkdown(boldBullet?.[2] || nextMeaningfulLine(lines, index + 1));
    hints.push({
      id: `capability_${hash(`${document.path}:${index + 1}:${label}`)}`,
      label,
      description: following || `Project documentation describes ${label}.`,
      keywords: keywords(`${label} ${following}`),
      sources: [{ file: document.path, startLine: index + 1 }],
      confidence: document.kind === "prd" ? 0.9 : document.kind === "readme" ? 0.8 : 0.74,
    });
  }
  return hints;
}

function capabilitiesFromConfig(config: ReaderConfig): ProjectCapabilityHint[] {
  return Object.entries(config.features ?? {}).map(([id, feature]) => {
    const label = feature.label?.trim() || humanize(id);
    return {
      id: `capability_${hash(`config:${id}`)}`,
      label,
      description: feature.description?.trim() || `Configured project capability ${label}.`,
      keywords: unique([...(feature.keywords ?? []), ...keywords(`${id} ${label} ${feature.description ?? ""}`)]),
      sources: [{ file: "agent-runtime-map.config.json", startLine: 1, symbol: id }],
      confidence: 1,
    };
  });
}

function mergeCapabilities(items: ProjectCapabilityHint[]): ProjectCapabilityHint[] {
  const merged = new Map<string, ProjectCapabilityHint>();
  for (const item of items) {
    const key = normalizeMatch(item.label);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, item);
      continue;
    }
    merged.set(key, {
      ...existing,
      description: existing.description.length >= item.description.length ? existing.description : item.description,
      keywords: unique([...existing.keywords, ...item.keywords]),
      sources: uniqueSources([...existing.sources, ...item.sources]),
      confidence: Math.max(existing.confidence, item.confidence),
    });
  }
  return [...merged.values()];
}

function isCapabilityLabel(value: string): boolean {
  if (!value || value.length < 3 || value.length > 80 || GENERIC_HEADING_PATTERN.test(value)) return false;
  return !/^(v?\d+(\.\d+)+|https?:|npm |pnpm |yarn )/i.test(value);
}

function markdownHeadings(text: string): Array<{ label: string; line: number }> {
  return text.split(/\r?\n/).flatMap((line, index) => {
    const match = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    return match ? [{ label: cleanMarkdown(match[2] ?? ""), line: index + 1 }] : [];
  });
}

function nextMeaningfulLine(lines: string[], start: number): string {
  for (let index = start; index < Math.min(lines.length, start + 5); index += 1) {
    const candidate = lines[index]?.trim() ?? "";
    if (candidate && !candidate.startsWith("#") && !candidate.startsWith("```") && !/^[-*_]{3,}$/.test(candidate)) return candidate;
  }
  return "";
}

function documentTitle(relative: string, text: string): string {
  return markdownHeadings(text)[0]?.label || humanize(path.posix.basename(relative, path.posix.extname(relative)));
}

function documentSummary(text: string, title: string): string {
  const lines = text.split(/\r?\n/);
  const paragraph = lines
    .map((line) => cleanMarkdown(line))
    .find((line) => line && line !== title && !GENERIC_HEADING_PATTERN.test(line) && !line.startsWith("```"));
  return (paragraph || title).slice(0, 320);
}

function promptVariables(text: string): string[] {
  const values = [
    ...text.matchAll(/\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g),
    ...text.matchAll(/\$\{\s*([A-Za-z_][\w.-]*)\s*\}/g),
  ].map((match) => match[1]).filter((value): value is string => Boolean(value));
  return unique(values).slice(0, 40);
}

function normalizedExcerpt(text: string, maxLength: number): string {
  return text.replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim().slice(0, maxLength);
}

async function readManifest(root: string, diagnostics: Diagnostic[]): Promise<Record<string, unknown>> {
  try {
    return objectValue(JSON.parse(await readFile(path.join(root, "package.json"), "utf8")));
  } catch (error) {
    if (await exists(path.join(root, "package.json"))) diagnostics.push({
      level: "warning",
      code: "PROJECT_MANIFEST_INVALID",
      message: `Could not parse package.json: ${error instanceof Error ? error.message : String(error)}`,
      source: { file: "package.json", startLine: 1 },
    });
    return {};
  }
}

async function readReaderConfig(root: string, diagnostics: Diagnostic[]): Promise<ReaderConfig> {
  const file = path.join(root, "agent-runtime-map.config.json");
  try {
    return sanitizeReaderConfig(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (await exists(file)) diagnostics.push({
      level: "warning",
      code: "PROJECT_READER_CONFIG_INVALID",
      message: `Could not parse agent-runtime-map.config.json: ${error instanceof Error ? error.message : String(error)}`,
      source: { file: "agent-runtime-map.config.json", startLine: 1 },
    });
    return {};
  }
}

function dependencyList(manifest: Record<string, unknown>): ProjectDependency[] {
  const groups: Array<[ProjectDependency["category"], unknown]> = [
    ["runtime", manifest.dependencies],
    ["development", manifest.devDependencies],
    ["peer", manifest.peerDependencies],
  ];
  return groups.flatMap(([category, value]) => Object.entries(objectValue(value)).map(([name, version]) => ({
    name,
    version: String(version),
    category,
  }))).sort((a, b) => a.name.localeCompare(b.name));
}

async function discoverConfigurationFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.isFile() && CONFIG_NAMES.has(entry.name)) found.push(entry.name);
  }
  return found.sort();
}

async function detectPackageManager(root: string): Promise<string | undefined> {
  for (const [file, manager] of [["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lockb", "bun"], ["bun.lock", "bun"], ["package-lock.json", "npm"]] as const) {
    if (await exists(path.join(root, file))) return manager;
  }
  return undefined;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function cleanMarkdown(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .replace(/^[-+\d.()\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function keywords(value: string): string[] {
  const latin = value.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  const cjk = value.match(/[\u3400-\u9fff]{2,8}/g) ?? [];
  const stop = new Set([
    "agent", "agents", "and", "before", "can", "feature", "features", "for", "from", "into", "its", "later",
    "project", "returning", "runtime", "system", "that", "the", "this", "through", "using", "with",
    "功能", "系统", "项目",
  ]);
  return unique([...latin, ...cjk].filter((word) => !stop.has(word))).slice(0, 24);
}

function humanize(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_/.]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeMatch(value: string): string {
  return humanize(value).toLowerCase().replace(/\b(agent|service|workflow|feature)\b/g, "").replace(/\s+/g, "").trim();
}

function relativePath(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sanitizeReaderConfig(value: unknown): ReaderConfig {
  const input = objectValue(value);
  const features = Object.fromEntries(Object.entries(objectValue(input.features)).flatMap(([id, rawFeature]) => {
    const feature = objectValue(rawFeature);
    const label = stringValue(feature.label, 80);
    const description = stringValue(feature.description, 600);
    const keywords = Array.isArray(feature.keywords)
      ? feature.keywords.flatMap((keyword) => typeof keyword === "string" && keyword.trim()
        ? [keyword.trim().slice(0, 80)]
        : []).slice(0, 24)
      : undefined;
    if (!label && !description && !keywords?.length) return [];
    return [[id.slice(0, 120), { label, description, keywords }]];
  }));
  return {
    description: stringValue(input.description, 600),
    features,
  };
}

function stringValue(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function uniqueSources(values: SourceLocation[]): SourceLocation[] {
  const seen = new Set<string>();
  return values.filter((source) => {
    const key = `${source.file}:${source.startLine}:${source.symbol ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}
