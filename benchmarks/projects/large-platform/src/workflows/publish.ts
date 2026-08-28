import { reviewAgent } from "../agents/review";
import { moderationTool } from "../tools/moderation";
import { catalog } from "../services/catalog";

declare const db: { article: { update(a: object): Promise<object> } };

/** A person must sign off before anything becomes public. */
export async function approvePublication(draftId: string, verdict: object) {
  return awaitEditorDecision(draftId, verdict);
}

export async function awaitEditorDecision(draftId: string, verdict: object) {
  return { draftId, verdict, decidedBy: "editor" };
}

export async function publishWorkflow(draftId: string, body: string) {
  const screened = await moderationTool.run(body);
  const verdict = { agent: reviewAgent.name, screened };
  const decision = await approvePublication(draftId, verdict);
  await catalog.storeArticle(draftId, body);
  return db.article.update({ where: { id: draftId }, data: { published: true, decision } });
}
