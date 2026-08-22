import type { ControlFlowKind, Evidence, RawCodeEdge, RawNodeKind, SourceLanguage } from "@agent-runtime-map/schema";
/**
 * Classification is a product judgement, not a language feature: an `agents/`
 * directory means the same thing in Python as in TypeScript. Keeping these rules in
 * one place is what stops two adapters from slowly disagreeing about what an Agent
 * is, which would show up as the same repository reading differently depending on
 * which files it happens to contain.
 */
/** Tests and type declarations describe the system, they are not the system running. */
export declare const EXCLUDED_DIRECTORIES: Set<string>;
/**
 * Scripts are real code but they are not the running system: smoke tests, one-off
 * migrations, and release helpers live here. They stay in the Raw Code Graph as
 * evidence, but path conventions such as `agents/` must not promote them.
 */
export declare const SUPPORTING_PATH_PATTERN: RegExp;
export declare const HTTP_METHODS: Set<string>;
/** Node kinds that represent something able to receive control. */
export declare const CALLABLE_NODE_KINDS: Set<RawNodeKind>;
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
export declare function hasQualifiedSuffix(name: string, pattern: RegExp): boolean;
export declare function classifyDeclaration(facts: DeclarationFacts): Classification;
export declare function evidence(file: string, startLine: number, method: Evidence["method"], detail: string, confidence: number, symbol?: string, endLine?: number): Evidence;
export declare function makeEdge(source: string, target: string, kind: RawCodeEdge["kind"], itemEvidence: Evidence[], options?: {
    label?: string;
    control?: ControlFlowKind;
    metadata?: Record<string, unknown>;
}): RawCodeEdge;
export declare function stableId(prefix: string, value: string): string;
export declare function relativePath(root: string, filePath: string): string;
export declare function languageForFile(file: string): SourceLanguage;
export declare function humanize(value: string): string;
export declare function firstSentence(value: string): string;
export declare function templateVariables(value: string): string[];
export declare function dedupeById<T extends {
    id: string;
}>(items: T[]): T[];
/** Walks a project for source files, skipping the directories no adapter should read. */
export declare function discoverSourceFiles(root: string, extensions: ReadonlySet<string>, excludedFilePattern: RegExp): Promise<string[]>;
