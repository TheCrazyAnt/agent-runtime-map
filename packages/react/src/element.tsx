import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type { LogicGraph } from "@agent-runtime-map/schema";
import { LogicMap } from "./LogicMap.js";

/**
 * A Web Component wrapper so a host that is not a React application can embed the
 * map. It is a thin adapter over `<LogicMap />` and carries the same contract: the
 * graph is handed in already compiled, and the element never reads a repository or
 * calls a service of its own.
 *
 * The graph is set as a **property**, not an attribute, because a Logic Graph is far
 * larger than an attribute should carry and round-tripping it through a string would
 * lose nothing but cost everything:
 *
 * ```js
 * document.querySelector("logic-map").graph = await (await fetch("/graph.json")).json();
 * ```
 */
export class LogicMapElement extends HTMLElement {
  static observedAttributes = ["feature-id", "variant-id", "step-index", "interactive"];

  #root?: Root;
  #graph?: LogicGraph;

  set graph(value: LogicGraph | undefined) {
    this.#graph = value;
    this.#render();
  }

  get graph(): LogicGraph | undefined {
    return this.#graph;
  }

  connectedCallback(): void {
    if (!this.#root) this.#root = createRoot(this);
    this.#render();
  }

  disconnectedCallback(): void {
    // Unmounting is deferred: React throws when a root is unmounted while it is
    // rendering, which happens when a host moves the element in the DOM.
    const root = this.#root;
    this.#root = undefined;
    queueMicrotask(() => root?.unmount());
  }

  attributeChangedCallback(): void {
    this.#render();
  }

  #render(): void {
    if (!this.#root || !this.#graph) return;
    const stepAttribute = Number(this.getAttribute("step-index"));
    this.#root.render(createElement(LogicMap, {
      graph: this.#graph,
      featureId: this.getAttribute("feature-id"),
      variantId: this.getAttribute("variant-id") ?? undefined,
      stepIndex: Number.isFinite(stepAttribute) && this.getAttribute("step-index") !== null ? stepAttribute : -1,
      interactive: this.getAttribute("interactive") !== "false",
      onSelectNode: (nodeId, node) => {
        this.dispatchEvent(new CustomEvent("select-node", { detail: { nodeId, node }, bubbles: true }));
      },
    }));
  }
}

/** Registers `<logic-map>`. Safe to call more than once. */
export function defineLogicMapElement(tagName = "logic-map"): void {
  if (typeof customElements === "undefined" || customElements.get(tagName)) return;
  customElements.define(tagName, LogicMapElement);
}
