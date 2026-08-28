import { embedTool } from "../tools/embed";

export async function ingestWorkflow(documentId: string, chunks: string[]) {
  const stored = [];
  for (const chunk of chunks) {
    // Bounded retry: a chunk that fails twice is dropped, not retried forever.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        stored.push(await embedTool.run(chunk));
        break;
      } catch {
        if (attempt === 1) throw new Error(`INGEST_FAILED:${documentId}`);
      }
    }
  }
  return stored;
}
