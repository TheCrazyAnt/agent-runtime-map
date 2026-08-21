import { approveDraftAgent, reviseDraftAgent, scoreDraftAgent } from "../agents/review.js";

export async function executeReviewWorkflow(script: string) {
  const score = await scoreDraftAgent(script);
  if (score < 0.8) return reviseDraftAgent(script);
  return approveDraftAgent(script);
}
