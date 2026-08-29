import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { githubWorkflowTemplate } from "@agent-runtime-map/core";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A deprecated action runtime is a warning on every run and, eventually, a
 * failure — and the ones that reach a *user's* repository are the ones we cannot
 * fix for them after the fact. Three surfaces have to stay current: the workflows
 * this repository runs, the composite action published as `@v1`, and the template
 * `init --github` writes into someone else's project.
 *
 * Asserted **per action**, because these version independently: `download-artifact`
 * reached v8 while `upload-artifact` was still on v7, and a blanket "nothing may
 * be v4" rule would be wrong for whichever action has not moved yet.
 */
const REQUIRED_MAJOR: Record<string, number> = {
  "actions/checkout": 7,
  "actions/setup-node": 7,
  "actions/cache": 6,
  "actions/cache/restore": 6,
  "actions/cache/save": 6,
  "actions/upload-artifact": 7,
  "actions/download-artifact": 8,
  "actions/upload-pages-artifact": 5,
  "actions/deploy-pages": 5,
};

/**
 * Every `uses:` of an official action, with the ref it is pinned to.
 *
 * Quoting and SHA pinning both used to slip past this: `uses: 'actions/checkout@v4'`
 * matched nothing because the quote sat where the action name was expected, and a
 * commit SHA has no `@vN` to read — so GitHub's own hardening advice silently
 * disabled the gate. The ref is captured as written and judged afterwards.
 */
function actionUsages(source: string): Array<{ action: string; ref: string; raw: string }> {
  return [...source.matchAll(/uses:\s*["']?(actions\/[\w/-]+)@([^\s"'#]+)["']?/g)].map((match) => ({
    action: match[1]!,
    ref: match[2]!,
    raw: match[0].trim(),
  }));
}

function assertCurrent(label: string, source: string): string[] {
  return actionUsages(source).flatMap(({ action, ref, raw }) => {
    const required = REQUIRED_MAJOR[action];
    if (required === undefined) return [`${label}: ${action} is not covered by this gate — add it to REQUIRED_MAJOR`];
    const major = /^v(\d+)/.exec(ref)?.[1];
    if (major === undefined) {
      // A SHA or a branch ref carries no version to compare, so this gate cannot
      // judge it. Saying so beats passing silently: someone must state which
      // version that SHA is, in a comment the next reader can check.
      return [`${label}: ${raw} is not pinned to a version tag, so its runtime cannot be checked`];
    }
    return Number(major) < required ? [`${label}: ${raw} is behind the current major (v${required})`] : [];
  });
}

describe("action runtimes stay current", () => {
  it("keeps this repository's own workflows on current majors", async () => {
    const dir = path.join(REPO, ".github/workflows");
    const files = (await readdir(dir)).filter((name) => name.endsWith(".yml"));
    expect(files.length).toBeGreaterThanOrEqual(3);
    const problems: string[] = [];
    for (const file of files) {
      problems.push(...assertCurrent(file, await readFile(path.join(dir, file), "utf8")));
    }
    expect(problems).toEqual([]);
  });

  it("keeps the published composite action on current majors", async () => {
    // This one runs inside other people's repositories under `@v1`; a stale
    // runtime here warns every consumer and cannot be fixed for them remotely.
    const source = await readFile(path.join(REPO, "action.yml"), "utf8");
    expect(assertCurrent("action.yml", source)).toEqual([]);
    // The upgrade must not have quietly changed what the action does.
    const parsed = parseYaml(source) as { runs: { steps: Array<{ uses?: string; with?: Record<string, unknown> }> } };
    const restore = parsed.runs.steps.find((step) => step.uses?.startsWith("actions/cache/restore"));
    const save = parsed.runs.steps.find((step) => step.uses?.startsWith("actions/cache/save"));
    const upload = parsed.runs.steps.find((step) => step.uses?.startsWith("actions/upload-artifact"));
    const pages = parsed.runs.steps.find((step) => step.uses?.startsWith("actions/upload-pages-artifact"));
    // Same cache paths and key shape, so an existing baseline is still found.
    expect(restore?.with?.path).toBe("${{ inputs.project-path }}/.agent-runtime-map/current");
    expect(String(restore?.with?.["restore-keys"])).toContain("github.event.repository.default_branch");
    expect(save?.with?.path).toBe("${{ inputs.project-path }}/.agent-runtime-map/current");
    // Same artifact name and path, so a consumer's download step still works.
    expect(upload?.with?.name).toBe("${{ inputs.artifact-name }}");
    expect(upload?.with?.path).toBe("${{ inputs.project-path }}/.agent-runtime-map/current");
    expect(pages?.with?.path).toBe("${{ inputs.project-path }}/.agent-runtime-map/current");
  });

  it("writes a current runtime into the workflow it generates for a user", () => {
    // The template ships inside the CLI package, so a stale action here reaches
    // every project that runs `init --github` until a new version is published.
    const template = githubWorkflowTemplate({ defaultBranch: "main" });
    expect(assertCurrent("generated workflow", template)).toEqual([]);

    const parsed = parseYaml(template) as Record<string, unknown>;
    const jobs = parsed.jobs as { map: { steps: Array<{ uses?: string; with?: Record<string, unknown> }> } };
    const checkout = jobs.map.steps.find((step) => step.uses?.startsWith("actions/checkout"));
    // The runtime bump must not disturb what the template promises.
    expect(checkout?.uses).toBe("actions/checkout@v7");
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
    expect(parsed.permissions).toEqual({ contents: "read" });
    expect(jobs.map.steps.some((step) => step.uses === "TheCrazyAnt/agent-runtime-map@v1")).toBe(true);
  });

  it("covers every action any of the three surfaces actually uses", async () => {
    // A gate that silently skips an unknown action is not a gate. Every action
    // in use must have a stated required major.
    const sources = [
      await readFile(path.join(REPO, "action.yml"), "utf8"),
      githubWorkflowTemplate({ defaultBranch: "main" }),
      ...(await Promise.all((await readdir(path.join(REPO, ".github/workflows")))
        .filter((name) => name.endsWith(".yml"))
        .map((name) => readFile(path.join(REPO, ".github/workflows", name), "utf8")))),
    ];
    const used = new Set(sources.flatMap((source) => actionUsages(source).map((item) => item.action)));
    expect(used.size).toBeGreaterThan(0);
    for (const action of used) expect(REQUIRED_MAJOR[action]).toBeDefined();
  });
});

describe("the gate itself", () => {
  it("sees through quoting and refuses a ref it cannot judge", () => {
    // Both of these used to pass silently.
    expect(assertCurrent("t", `      - uses: 'actions/checkout@v4'`)).toHaveLength(1);
    expect(assertCurrent("t", `      - uses: "actions/checkout@v4"`)).toHaveLength(1);
    expect(assertCurrent("t", `      - uses: actions/checkout@a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2`)[0])
      .toContain("not pinned to a version tag");
    expect(assertCurrent("t", `      - uses: actions/checkout@main`)[0]).toContain("not pinned to a version tag");

    // A current pin passes, quoted or not.
    expect(assertCurrent("t", `      - uses: actions/checkout@v7`)).toEqual([]);
    expect(assertCurrent("t", `      - uses: "actions/checkout@v7"`)).toEqual([]);
    // A sub-path action still resolves to its own entry.
    expect(assertCurrent("t", `      - uses: actions/cache/restore@v6`)).toEqual([]);
    expect(assertCurrent("t", `      - uses: actions/cache/restore@v4`)).toHaveLength(1);
    // An action nobody listed is reported rather than skipped.
    expect(assertCurrent("t", `      - uses: actions/labeler@v5`)[0]).toContain("not covered by this gate");
  });
});
