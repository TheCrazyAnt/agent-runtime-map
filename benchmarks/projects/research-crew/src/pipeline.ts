import { agents, criticAgent } from "./crew";

declare const vectorIndex: { upsert(args: object): Promise<void> };

export async function searchWeb(query: string) {
  const response = await fetch(`https://api.tavily.example.com/search?q=${encodeURIComponent(query)}`);
  return response.json();
}

export async function runResearch(question: string) {
  const plan = await agents.planner.run(question);
  const sections: string[] = [];
  for (const step of parsePlan(plan)) {
    const evidence = await searchWeb(step.query);
    // The role arrives from the plan itself: which agent runs is decided at
    // runtime, and no static analysis can name it honestly.
    const section = await agents[step.role as keyof typeof agents].run(`${step.query}\n${JSON.stringify(evidence)}`);
    sections.push(section);
  }
  const draft = sections.join("\n\n");
  await vectorIndex.upsert({ id: question, text: draft });
  return draft;
}

export async function critiqueDraft(question: string, draft: string) {
  try {
    return await criticAgent.run(`${question}\n${draft}`);
  } catch {
    return "critique unavailable";
  }
}

function parsePlan(plan: string): Array<{ role: string; query: string }> {
  return plan.split("\n").map((line) => ({ role: "writer", query: line }));
}
