export const kbSearchTool = {
  name: "kb_search",
  description: "Search the knowledge base for relevant articles.",
  async execute(query: string) {
    const response = await fetch(`https://kb.internal.example.com/search?q=${encodeURIComponent(query)}`);
    return response.json();
  },
};

export const ticketLookupTool = {
  name: "ticket_lookup",
  description: "Load a ticket and its history.",
  async execute(ticketId: string) {
    return db.ticket.findUnique({ where: { id: ticketId } });
  },
};

declare const db: { ticket: { findUnique(args: object): Promise<object> } };
