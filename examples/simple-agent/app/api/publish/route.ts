// This intentionally incomplete feature demonstrates Chain Doctor: the route
// has no resolvable workflow, agent, service, or tool downstream.
export async function POST(request: Request) {
  const input = await request.json();
  return Response.json({ queued: false, draftId: input.draftId });
}
