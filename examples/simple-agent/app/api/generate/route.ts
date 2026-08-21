import { executeContentWorkflow } from "../../src/workflows/content.js";

export async function POST(request: Request) {
  const input = await request.json();
  const result = await executeContentWorkflow(input.requirement);
  return Response.json(result);
}
