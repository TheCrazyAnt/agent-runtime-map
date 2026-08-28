import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
// @ts-expect-error plain-JS release tooling has no type declarations on purpose.
import { PUBLISH_ORDER, planPublish } from "../scripts/publish-plan.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MANIFESTS = {
  "@agent-runtime-map/react": { version: "0.9.0" },
  "@agent-runtime-map/mcp": { version: "0.9.0" },
  "agent-runtime-map": { version: "0.9.0" },
};
const NOTHING_PUBLISHED = {
  "@agent-runtime-map/react": [],
  "@agent-runtime-map/mcp": [],
  "agent-runtime-map": [],
};

describe("the publish plan", () => {
  it("publishes all three packages in dependency order for a fresh version", () => {
    const plan = planPublish({ manifests: MANIFESTS, tag: "v0.9.0", publishedVersions: NOTHING_PUBLISHED });
    expect(plan.ok).toBe(true);
    expect(plan.version).toBe("0.9.0");
    expect(plan.steps.map((step: { name: string; action: string }) => [step.name, step.action])).toEqual([
      ["@agent-runtime-map/react", "publish"],
      ["@agent-runtime-map/mcp", "publish"],
      ["agent-runtime-map", "publish"],
    ]);
  });

  it("skips versions the registry already has instead of republishing", () => {
    const plan = planPublish({
      manifests: MANIFESTS,
      tag: "v0.9.0",
      publishedVersions: {
        ...NOTHING_PUBLISHED,
        "@agent-runtime-map/react": ["0.8.0", "0.9.0"],
      },
    });
    expect(plan.ok).toBe(true);
    expect(plan.steps.find((step: { name: string }) => step.name === "@agent-runtime-map/react")?.action).toBe("skip");
    expect(plan.steps.filter((step: { action: string }) => step.action === "publish")).toHaveLength(2);
  });

  it("is a no-op when everything is already published — a re-run must not error", () => {
    const everything = Object.fromEntries(PUBLISH_ORDER.map(({ name }: { name: string }) => [name, ["0.9.0"]]));
    const plan = planPublish({ manifests: MANIFESTS, tag: "v0.9.0", publishedVersions: everything });
    expect(plan.ok).toBe(true);
    expect(plan.steps.every((step: { action: string }) => step.action === "skip")).toBe(true);
  });

  it("refuses a tag that does not match the package version", () => {
    const plan = planPublish({ manifests: MANIFESTS, tag: "v1.0.0", publishedVersions: NOTHING_PUBLISHED });
    expect(plan.ok).toBe(false);
    expect(plan.errors[0]).toContain("does not match");
    expect(plan.steps).toEqual([]);
  });

  it("refuses when the three packages disagree on the version", () => {
    const plan = planPublish({
      manifests: { ...MANIFESTS, "@agent-runtime-map/mcp": { version: "0.9.1" } },
      tag: undefined,
      publishedVersions: NOTHING_PUBLISHED,
    });
    expect(plan.ok).toBe(false);
    expect(plan.errors[0]).toContain("disagree");
  });

  it("refuses private packages and non-release versions", () => {
    expect(planPublish({
      manifests: { ...MANIFESTS, "agent-runtime-map": { version: "0.9.0", private: true } },
      tag: undefined,
      publishedVersions: NOTHING_PUBLISHED,
    }).ok).toBe(false);
    expect(planPublish({
      manifests: { ...MANIFESTS, "agent-runtime-map": { version: "0.9.0-rc.1" } },
      tag: undefined,
      publishedVersions: NOTHING_PUBLISHED,
    }).ok).toBe(false);
  });

  it("matches the repository's actual publishable packages", async () => {
    for (const { name, directory } of PUBLISH_ORDER as Array<{ name: string; directory: string }>) {
      const manifest = JSON.parse(await readFile(path.join(REPO, directory, "package.json"), "utf8"));
      expect(manifest.name).toBe(name);
      expect(manifest.private).not.toBe(true);
    }
  });

  it("dry-runs end to end against the real registry without publishing", () => {
    const output = execFileSync("node", [path.join(REPO, "scripts/publish-npm.mjs"), "--dry-run"], { encoding: "utf8" });
    // 0.8.0 is fully published, so a dry run of the current tree must plan zero publishes
    // — unless versions were bumped, in which case it must plan publishes, not errors.
    expect(output).toContain("publish-npm: done");
    expect(output).not.toContain("refusing");
  });
});

describe("the publish workflow", () => {
  it("uses OIDC with minimal permissions and no long-lived token", async () => {
    const raw = await readFile(path.join(REPO, ".github/workflows/npm-publish.yml"), "utf8");
    const parsed = parseYaml(raw) as Record<string, unknown>;

    expect(parsed.permissions).toEqual({ contents: "read", "id-token": "write" });
    // No token can leak because none exists — checked against the effective
    // YAML (comments stripped), since the comments explain exactly this.
    const effective = raw.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
    expect(effective).not.toContain("NPM_TOKEN");
    expect(effective).not.toContain("NODE_AUTH_TOKEN");
    expect(effective).not.toContain("secrets.");

    // Only release tags and explicit manual dispatch trigger it.
    const on = (parsed.on ?? parsed[true as unknown as string]) as Record<string, unknown>;
    expect(Object.keys(on).sort()).toEqual(["push", "workflow_dispatch"]);
    const push = on.push as { tags: string[]; branches?: unknown };
    expect(push.tags).toEqual(["v[0-9]+.[0-9]+.[0-9]+"]);
    expect(push.branches).toBeUndefined();
    expect(on).not.toHaveProperty("pull_request");

    // The npm CLI is pinned: release infrastructure must not float on latest.
    expect(effective).not.toContain("npm@latest");
    expect(effective).toMatch(/npm install -g npm@\d+\.\d+\.\d+/);

    // The full release gate runs before any publish.
    const job = (parsed.jobs as { publish: { steps: Array<{ run?: string }> } }).publish;
    const runs = job.steps.map((step) => step.run ?? "");
    const checkIndex = runs.findIndex((run) => run.includes("release:check"));
    const publishIndex = runs.findIndex((run) => run.includes("publish-npm.mjs"));
    expect(checkIndex).toBeGreaterThanOrEqual(0);
    expect(publishIndex).toBeGreaterThan(checkIndex);
  });
});
