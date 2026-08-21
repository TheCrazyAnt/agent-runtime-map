import { executeReviewWorkflow } from "../../src/workflows/review.js";

export async function POST(request: Request) {
  const input = await request.json();
  const result = await executeReviewWorkflow(input.script);
  return Response.json(result);
}
