import { publishWorkflow } from "../workflows/publish";
import { ingestWorkflow } from "../workflows/ingest";
import { rankerModel } from "../tools/rank";
import { catalog } from "../services/catalog";

/** The three chains this sample holds the compressor to. */
export async function publishDraft(draftId: string, body: string) {
  return publishWorkflow(draftId, body);
}

export async function ingestDocument(documentId: string, chunks: string[]) {
  return ingestWorkflow(documentId, chunks);
}

export async function searchArticles(query: string, tag: string) {
  const candidates = await catalog.listArticles(tag);
  return rankerModel.run(query, candidates.map(String));
}
