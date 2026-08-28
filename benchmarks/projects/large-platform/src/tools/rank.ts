export const rankerModel = {
  name: "rankerModel",
  model: "rerank-2",
  async run(query: string, candidates: string[]) {
    const response = await fetch("https://search.internal.example.com/v1/rank", {
      method: "POST",
      body: JSON.stringify({ query, candidates }),
    });
    return response.json();
  },
};
