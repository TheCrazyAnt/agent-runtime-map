import Anthropic from "@anthropic-ai/sdk";
import { retrieveContext } from "../../lib/utils";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: Request) {
  const { messages, model, knowledgeBaseId } = await req.json();
  const latest = messages[messages.length - 1].content;

  let context = "";
  try {
    const result = await retrieveContext(latest, knowledgeBaseId);
    context = result.context;
  } catch {
    // The chat still answers without retrieval; the model is told so.
    context = "";
  }

  const systemPrompt = `You are a customer support assistant. Retrieved context:
${context || "No information found for this query."}
If you cannot help, redirect the user to a human agent.`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 1000,
    system: systemPrompt,
    messages,
  });
  return Response.json(response);
}
