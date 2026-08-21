export async function createStoryAgent(ideas: unknown) {
  return openai.responses.create({
    model: "gpt-5",
    input: `Create a story from ${JSON.stringify(ideas)}`,
  });
}
