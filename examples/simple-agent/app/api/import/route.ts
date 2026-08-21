import { executeImportWorkflow } from "../../src/workflows/import.js";

export async function POST(request: Request) {
  const input = await request.json();
  const result = await executeImportWorkflow(input.document);
  return Response.json(result);
}
