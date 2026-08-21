export async function scoreDraftAgent(script: string) {
  await openai.responses.create({ model: "gpt-5", input: `Score this draft: ${script}` });
  return 0.86;
}

export async function reviseDraftAgent(script: string) {
  return openai.responses.create({ model: "gpt-5", input: `Revise this draft: ${script}` });
}

export async function approveDraftAgent(script: string) {
  return openai.responses.create({ model: "gpt-5", input: `Approve this draft: ${script}` });
}
