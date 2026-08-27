"use client";

import { useEffect, useState } from "react";
import { LogicMap } from "@agent-runtime-map/react";
import "@agent-runtime-map/react/styles.css";
import type { LogicGraph } from "@agent-runtime-map/schema";

interface ContinuousStatus {
  state: "updated" | "stale" | "failed";
  lastSuccessAt?: string;
  error?: { message: string; failedAt: string };
}

/**
 * An admin-panel embed of the continuous map. It reads the artifacts through the
 * API route, polls `manifest.json` for a new buildId, and swaps the graph in place
 * when the watcher rebuilds — the person keeps the page open and the map stays true.
 *
 * All analysis happens in `agent-runtime-map watch`; this component only renders
 * the JSON it is handed, exactly like the bundled Viewer.
 */
export function RuntimeMapPanel() {
  const [graph, setGraph] = useState<LogicGraph>();
  const [status, setStatus] = useState<ContinuousStatus>();
  const [buildId, setBuildId] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [graphResponse, statusResponse] = await Promise.all([
        fetch("/api/runtime-map/graph.json", { cache: "no-store" }),
        fetch("/api/runtime-map/status.json", { cache: "no-store" }),
      ]);
      if (cancelled || !graphResponse.ok) return;
      setGraph((await graphResponse.json()) as LogicGraph);
      if (statusResponse.ok) setStatus((await statusResponse.json()) as ContinuousStatus);
    };
    void load();

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch("/api/runtime-map/manifest.json", { cache: "no-store" });
        if (!response.ok) return;
        const manifest = (await response.json()) as { buildId?: string };
        setBuildId((known) => {
          if (manifest.buildId && known && manifest.buildId !== known) void load();
          return manifest.buildId ?? known;
        });
      } catch {
        // The watcher may be down; keep showing the last map we have.
      }
    }, 2000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  if (!graph) return <p>Map not built yet — run <code>agent-runtime-map build .</code></p>;

  return (
    <div style={{ height: "70vh", display: "flex", flexDirection: "column", gap: 8 }}>
      {status?.state === "failed" && (
        <p role="alert">
          Last analysis failed ({status.error?.message}); showing the map from {status.lastSuccessAt}.
        </p>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <LogicMap graph={graph} />
      </div>
    </div>
  );
}
