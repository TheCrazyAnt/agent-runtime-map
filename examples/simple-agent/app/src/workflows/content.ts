import { generateIdeasAgent } from "../agents/idea.js";
import { createStoryAgent } from "../agents/story.js";
import { buildScriptAgent } from "../agents/script.js";
import { saveGeneration } from "../services/generations.js";

export async function executeContentWorkflow(requirement: string) {
  const ideas = await generateIdeasAgent(requirement);
  const story = await createStoryAgent(ideas);
  const script = await buildScriptAgent(story);
  await saveGeneration(script);
  return { script };
}
