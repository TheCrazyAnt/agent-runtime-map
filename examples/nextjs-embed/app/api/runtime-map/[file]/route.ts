import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

/**
 * Serves the continuous map's `current/` artifacts to the admin UI. The file name is
 * an allow-list, never a path: nothing outside these five artifacts is readable, so
 * this route cannot be turned into a generic file server.
 *
 * Run `agent-runtime-map watch .` (or `build`) in the project so the artifacts exist.
 */
const ALLOWED_FILES = new Set([
  "graph.json",
  "raw-graph.json",
  "manifest.json",
  "status.json",
  "changes.json",
]);

const CURRENT_DIR = path.join(process.cwd(), ".agent-runtime-map", "current");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<NextResponse> {
  const { file } = await params;
  if (!ALLOWED_FILES.has(file)) {
    return NextResponse.json({ error: "Unknown artifact" }, { status: 404 });
  }
  try {
    const body = await readFile(path.join(CURRENT_DIR, file), "utf8");
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // status and manifest change out of band; the map must never read a cache.
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Map not built yet. Run: agent-runtime-map build ." },
      { status: 404 },
    );
  }
}
