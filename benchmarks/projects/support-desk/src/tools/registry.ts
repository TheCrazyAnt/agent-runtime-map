import { kbSearchTool, ticketLookupTool } from "./kb";

interface Tool {
  name: string;
  execute(input: string): Promise<unknown>;
}

/** Tools register under a stable string key and are fetched back by that key. */
export const toolRegistry = new Map<string, Tool>();
toolRegistry.set("kb-search", kbSearchTool);
toolRegistry.set("ticket-lookup", ticketLookupTool);

/** A tool chosen at runtime cannot be resolved statically. */
export function anyTool(name: string): Tool | undefined {
  return toolRegistry.get(name);
}
