import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  GITHUB_WORKFLOW_RELATIVE_PATH,
  githubWorkflowTemplate,
  initContinuousProject,
  initGithubWorkflow,
  isGeneratedWorkflow,
  WorkflowModifiedError,
} from "@agent-runtime-map/core";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arm-gh-"));
  cleanups.push(dir);
  return dir;
}

describe("the generated workflow", () => {
  it("is parseable YAML with the promised triggers, permissions, and concurrency", () => {
    const template = githubWorkflowTemplate();
    const parsed = parseYaml(template) as Record<string, unknown>;
    // "on" parses as YAML's boolean true key in some configurations; normalize.
    const on = (parsed.on ?? parsed[true as unknown as string]) as Record<string, unknown>;
    expect(on).toBeDefined();
    expect(on).toHaveProperty("push");
    expect(on).toHaveProperty("pull_request");
    expect(on).toHaveProperty("workflow_dispatch");
    expect(on).toHaveProperty("schedule");
    expect(parsed.permissions).toEqual({ contents: "read" });
    const concurrency = parsed.concurrency as { "cancel-in-progress": boolean };
    expect(concurrency["cancel-in-progress"]).toBe(true);
    const jobs = parsed.jobs as { map: { steps: Array<{ uses?: string; with?: Record<string, unknown> }> } };
    expect(jobs.map.steps.some((step) => step.uses === "tangyishun9846/agent-runtime-map@v1")).toBe(true);
    // Full history keeps the baseline commit reachable for real trigger paths.
    const checkout = jobs.map.steps.find((step) => step.uses?.startsWith("actions/checkout"));
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
    // Nothing in the workflow writes back to the repository.
    expect(template).not.toContain("git push");
    expect(template).not.toContain("git commit");
  });

  it("names the detected default branch instead of assuming main", () => {
    for (const branch of ["master", "trunk", "develop"]) {
      const parsed = parseYaml(githubWorkflowTemplate({ defaultBranch: branch })) as Record<string, unknown>;
      const on = (parsed.on ?? parsed[true as unknown as string]) as { push: { branches: string[] } };
      expect(on.push.branches).toEqual([branch]);
      expect(isGeneratedWorkflow(githubWorkflowTemplate({ defaultBranch: branch }))).toBe(true);
    }
    // Unknown default branch: build on every push rather than guessing a name.
    const parsed = parseYaml(githubWorkflowTemplate()) as Record<string, unknown>;
    const on = (parsed.on ?? parsed[true as unknown as string]) as { push: unknown };
    expect(on.push).toBeNull();
  });

  it("detects master/trunk default branches from a real repository", async () => {
    const { execFileSync } = await import("node:child_process");
    for (const branch of ["master", "trunk"]) {
      const root = await tempRoot();
      execFileSync("git", ["-C", root, "init", "-q", "-b", branch]);
      execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x"]);
      const { detectDefaultBranch } = await import("@agent-runtime-map/core");
      expect(await detectDefaultBranch(root)).toBe(branch);
      const result = await initGithubWorkflow(root);
      expect(result.defaultBranch).toBe(branch);
      expect(await readFile(result.workflowFile, "utf8")).toContain(`branches: [${branch}]`);
    }
  });

  it("recognizes its own unmodified output and rejects any edit", () => {
    const template = githubWorkflowTemplate();
    expect(isGeneratedWorkflow(template)).toBe(true);
    expect(isGeneratedWorkflow(template.replace("ubuntu-latest", "self-hosted"))).toBe(false);
    expect(isGeneratedWorkflow("name: mine\non: push\n")).toBe(false);
  });
});

describe("init --github", () => {
  it("creates config and workflow on first run, and a second run changes nothing", async () => {
    const root = await tempRoot();
    await initContinuousProject(root);
    const first = await initGithubWorkflow(root);
    expect(first.outcome).toBe("created");
    expect(first.workflowFile.endsWith(GITHUB_WORKFLOW_RELATIVE_PATH.replaceAll("/", path.sep))
      || first.workflowFile.endsWith(GITHUB_WORKFLOW_RELATIVE_PATH)).toBe(true);
    const written = await readFile(first.workflowFile, "utf8");

    await initContinuousProject(root);
    const second = await initGithubWorkflow(root);
    expect(second.outcome).toBe("unchanged");
    expect(await readFile(first.workflowFile, "utf8")).toBe(written);
  });

  it("keeps the user's existing config keys", async () => {
    const root = await tempRoot();
    const configFile = path.join(root, "agent-runtime-map.config.json");
    await writeFile(configFile, JSON.stringify({
      description: "mine",
      features: { pay: { label: "Payments" } },
      watch: { include: ["src/**"], exclude: [], debounceMs: 300 },
    }), "utf8");
    await initContinuousProject(root);
    await initGithubWorkflow(root);
    const merged = JSON.parse(await readFile(configFile, "utf8"));
    expect(merged.description).toBe("mine");
    expect(merged.features.pay.label).toBe("Payments");
    expect(merged.watch.debounceMs).toBe(300);
    expect(merged.outDir).toBe(".agent-runtime-map");
  });

  it("never silently overwrites a user-modified workflow, and --force does so explicitly", async () => {
    const root = await tempRoot();
    const first = await initGithubWorkflow(root);
    const customized = (await readFile(first.workflowFile, "utf8")) + "      - run: echo mine\n";
    await writeFile(first.workflowFile, customized, "utf8");

    await expect(initGithubWorkflow(root)).rejects.toThrow(WorkflowModifiedError);
    expect(await readFile(first.workflowFile, "utf8")).toBe(customized);

    const forced = await initGithubWorkflow(root, { force: true });
    expect(forced.outcome).toBe("overwritten");
    expect(await readFile(first.workflowFile, "utf8")).toBe(githubWorkflowTemplate());
  });

  it("updates an unmodified workflow from an older template without --force", async () => {
    const root = await tempRoot();
    const first = await initGithubWorkflow(root);
    // Simulate an older generated file: different body, valid integrity line.
    const oldBody = "name: Agent Runtime Map\non: [push]\n";
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(oldBody).digest("hex").slice(0, 16);
    await writeFile(first.workflowFile, `# agent-runtime-map-integrity: ${hash}\n${oldBody}`, "utf8");

    const updated = await initGithubWorkflow(root);
    expect(updated.outcome).toBe("updated");
    expect(await readFile(first.workflowFile, "utf8")).toBe(githubWorkflowTemplate());
  });
});

describe("the action definition", () => {
  it("is parseable, defaults to contents-read-safe behavior, and gates every risky path", async () => {
    const actionFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../action.yml");
    const parsed = parseYaml(await readFile(actionFile, "utf8")) as {
      inputs: Record<string, { default?: string }>;
      runs: { using: string; steps: Array<{ uses?: string; if?: string; run?: string }> };
    };
    expect(parsed.runs.using).toBe("composite");
    expect(parsed.inputs.publish.default).toBe("artifact");
    // Only official actions are referenced.
    for (const step of parsed.runs.steps) {
      if (step.uses) expect(step.uses.startsWith("actions/")).toBe(true);
    }
    // Pages publishing exists only behind the explicit opt-in.
    const pagesSteps = parsed.runs.steps.filter((step) => step.uses?.includes("pages"));
    expect(pagesSteps.length).toBeGreaterThan(0);
    for (const step of pagesSteps) expect(step.if).toContain("publish == 'pages'");
    // The action never commits or pushes.
    const scripts = parsed.runs.steps.map((step) => step.run ?? "").join("\n");
    expect(scripts).not.toContain("git commit");
    expect(scripts).not.toContain("git push");
    // The baseline may come from the same ref or the repository's real default
    // branch — never from whatever unrelated branch last built.
    const restore = parsed.runs.steps.find((step) => step.uses?.startsWith("actions/cache/restore")) as
      { with: { "restore-keys": string } } | undefined;
    const restoreKeys = restore?.with["restore-keys"].trim().split("\n").map((line) => line.trim()) ?? [];
    expect(restoreKeys.length).toBeGreaterThan(0);
    for (const key of restoreKeys) {
      expect(/github\.ref|default_branch/.test(key)).toBe(true);
    }
    expect(restore?.with["restore-keys"]).toContain("github.event.repository.default_branch");
  });
});
