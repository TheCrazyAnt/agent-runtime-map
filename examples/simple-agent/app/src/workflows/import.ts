import { indexKnowledgeAgent } from "../agents/knowledge.js";
import { parseDocumentTool } from "../tools/document.js";
import { saveDocument } from "../services/documents.js";

export async function executeImportWorkflow(document: string) {
  const parsed = await parseDocumentTool(document);
  const indexed = await indexKnowledgeAgent(parsed);
  await saveDocument(indexed);
  return { indexed: true };
}
