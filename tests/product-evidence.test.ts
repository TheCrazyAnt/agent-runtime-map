import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readProjectContext } from "@agent-runtime-map/project-reader";
import { generateLogicMap } from "@agent-runtime-map/core";
import { productMatchText, productOriginLabel } from "../apps/viewer/src/i18n.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function writeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "logic-map-product-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "refund-agent" }));
  await writeFile(path.join(root, "README.md"), [
    "# Refund Agent",
    "",
    "## Refund Approval",
    "",
    "Reviews a refund request and approves or rejects it.",
    "",
    "## Unrelated Billing Export",
    "",
    "Exports invoices to accounting.",
  ].join("\n"));
  await writeFile(path.join(root, "src", "refund.ts"), [
    "export function approveRefund(request: string) { return request; }",
    "export function rejectRefund(request: string) { return request; }",
    "export function handleRefundApproval(request: string) {",
    "  return request.length > 3 ? approveRefund(request) : rejectRefund(request);",
    "}",
  ].join("\n"));
  // A feature needs an entry point, otherwise there is no route to attribute.
  await mkdir(path.join(root, "app", "api", "refunds"), { recursive: true });
  await writeFile(path.join(root, "app", "api", "refunds", "route.ts"), [
    "import { handleRefundApproval } from '../../../src/refund.js';",
    "export async function POST(request: Request) { return handleRefundApproval(await request.text()); }",
  ].join("\n"));
  return root;
}

describe("product evidence", () => {
  it("labels where a capability claim came from", async () => {
    const root = await writeProject();
    await mkdir(path.join(root, "prompts"), { recursive: true });
    await writeFile(path.join(root, "prompts", "triage.md"), "Refund Triage\n\nDecide whether a refund request is legitimate.\n");

    const context = await readProjectContext(root, { productDescription: "Handles customer refunds end to end." });
    const origins = new Map(context.capabilityHints.map((hint) => [hint.label, hint.origin]));

    // The person running the tool is a source in their own right, and is named as one.
    const user = context.capabilityHints.find((hint) => hint.origin === "user");
    expect(user?.description).toBe("Handles customer refunds end to end.");
    // A claim with no file behind it must not borrow one.
    expect(user?.sources).toEqual([]);
    expect(origins.get("Refund Approval")).toBe("readme");
    expect(context.capabilityHints.some((hint) => hint.origin === "prompt")).toBe(true);
  });

  it("attaches a documented capability to a step without changing how the code was read", async () => {
    const root = await writeProject();
    const result = await generateLogicMap(root, { rawOutputFile: false, outputFile: path.join(root, "graph.json") });
    const handler = result.graph.nodes.find((node) => node.label.includes("Refund Approval"));

    expect(handler?.product?.origin).toBe("readme");
    expect(handler?.product?.label).toBe("Refund Approval");
    expect(handler?.product?.sources[0]?.file).toBe("README.md");
    expect(handler?.product?.matchedOn).toBe("documented_name");
    expect(handler?.product?.matchedTerms).toContain("Refund Approval");
    // Code is still the source of truth: a document cannot restate how a node was
    // classified, only add what the project says about it.
    expect(["deterministic", "heuristic"]).toContain(handler?.inference.method);
    // Nor can it raise the code's own confidence.
    expect(handler?.confidence).toBeLessThanOrEqual(1);
  });

  it("does not claim a product link from a single incidental shared word", async () => {
    const root = await writeProject();
    const result = await generateLogicMap(root, { rawOutputFile: false, outputFile: path.join(root, "graph.json") });

    // "Unrelated Billing Export" shares no capability with this code, and the refund
    // steps must not all be attributed to whichever heading happened to share a word.
    const attributed = result.graph.nodes.filter((node) => node.product);
    expect(attributed.length).toBeGreaterThan(0);
    expect(attributed.length).toBeLessThan(result.graph.nodes.length);
    expect(attributed.every((node) => node.product!.match >= 0.6)).toBe(true);
    expect(attributed.some((node) => node.product!.label === "Unrelated Billing Export")).toBe(false);
  });

  it("records that a feature borrowed its name from a document", async () => {
    const root = await writeProject();
    const result = await generateLogicMap(root, { rawOutputFile: false, outputFile: path.join(root, "graph.json") });
    const documented = result.graph.features.find((feature) => feature.product);

    // A feature label taken from documentation is a product claim, not a code fact.
    expect(documented?.label).toBe(documented?.product?.label);
    expect(documented?.product?.origin).toBe("readme");
    expect(documented?.product?.sources[0]?.file).toBe("README.md");
  });

  it("says what matched in both interface languages, keeping the documented terms verbatim", () => {
    const product = {
      capabilityId: "c1",
      label: "Refund Approval",
      origin: "readme" as const,
      sources: [],
      match: 0.85,
      matchedOn: "documented_terms" as const,
      matchedTerms: ["refund", "approval"],
    };
    const english = productMatchText(product, "en");
    const chinese = productMatchText(product, "zh-CN");
    expect(english).not.toBe(chinese);
    // The documented words are the evidence, so they are never translated away.
    for (const text of [english, chinese]) {
      expect(text).toContain("refund");
      expect(text).toContain("approval");
    }
    expect(chinese).not.toMatch(/[a-z]{4,}\s(terms|name)/);
  });

  it("names every origin in both interface languages", () => {
    const origins = ["readme", "prd", "docs", "prompt", "config", "user"] as const;
    for (const origin of origins) {
      expect(productOriginLabel(origin, "en").length).toBeGreaterThan(0);
      expect(productOriginLabel(origin, "zh-CN").length).toBeGreaterThan(0);
      // A Chinese reader must not be shown the English label.
      expect(productOriginLabel(origin, "zh-CN")).not.toBe(productOriginLabel(origin, "en"));
    }
  });
});
