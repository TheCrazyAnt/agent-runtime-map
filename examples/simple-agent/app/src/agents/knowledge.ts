export async function indexKnowledgeAgent(document: unknown) {
  return openai.embeddings.create({ model: "text-embedding-3-small", input: JSON.stringify(document) });
}
