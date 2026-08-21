export async function buildScriptAgent(story: unknown) {
  return openai.responses.create({
    model: "gpt-5",
    input: `Build a video script from ${JSON.stringify(story)}`,
  });
}
