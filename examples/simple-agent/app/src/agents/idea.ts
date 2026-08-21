export async function generateIdeasAgent(requirement: string) {
  return openai.responses.create({
    model: "gpt-5",
    input: `Generate ideas for ${requirement}`,
  });
}
