import { digestWorkflow } from "../workflows/digest";

/** Runs from cron, not from HTTP. Nothing in this project routes to it. */
export async function runNightlyDigest(week: string) {
  return digestWorkflow(week);
}
