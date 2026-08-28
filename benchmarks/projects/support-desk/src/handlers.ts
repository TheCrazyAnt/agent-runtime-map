import { replyAgent, triageAgent } from "./agents/triage";
import { toolRegistry, anyTool } from "./tools/registry";
import { refundWorkflow } from "./workflows/refund";

declare const db: { ticket: { create(args: object): Promise<{ id: string }> } };
declare function run(agent: object, input: string): Promise<{ category: string; orderId: string; text: string }>;

export async function handleTicket(body: { message: string; amount: number }) {
  const ticket = await db.ticket.create({ data: { message: body.message } });
  const triage = await run(triageAgent, body.message);
  if (triage.category === "refund") {
    return refundWorkflow(ticket.id, triage.orderId, body.amount);
  }
  const articles = await toolRegistry.get("kb-search")!.execute(body.message);
  const reply = await run(replyAgent, `${body.message}\n${JSON.stringify(articles)}`);
  return { reply: reply.text };
}

export async function handleFaq(question: string) {
  const articles = await toolRegistry.get("kb-search")!.execute(question);
  return { articles };
}

/** The tool name arrives from the request, so the target is genuinely dynamic. */
export async function handleToolProbe(name: string, input: string) {
  const tool = anyTool(name);
  return tool ? tool.execute(input) : undefined;
}

/** Helpers below are plumbing and must not become map steps. */
export function isTicketBody(value: unknown): value is { message: string } {
  return typeof value === "object" && value !== null && "message" in value;
}

export function formatTicketId(id: string): string {
  return `TICKET-${id.toUpperCase()}`;
}
