import { digestAgent } from "../agents/review";

declare const db: { article: { findMany(a: object): Promise<object[]> } };

/**
 * Reachable only from the scheduler, never from a route. A map that cannot name
 * this feature's entry must say so rather than call the chain healthy.
 */
export async function digestWorkflow(week: string) {
  const articles = await db.article.findMany({ where: { week } });
  const body = `${digestAgent.name}: ${articles.length} articles`;
  await fetch("https://api.sendgrid.com/v3/mail/send", { method: "POST", body });
  return body;
}
