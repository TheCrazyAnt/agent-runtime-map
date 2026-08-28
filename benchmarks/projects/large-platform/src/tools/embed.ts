declare const db: { chunk: { create(a: object): Promise<object> } };

export const embedTool = {
  name: "embedTool",
  description: "Embeds a document chunk and writes it to the vector store.",
  async run(chunk: string) {
    const response = await fetch("https://api.openai.com/v1/embeddings", { method: "POST", body: chunk });
    const vector = await response.json();
    return db.chunk.create({ data: { chunk, vector } });
  },
};
