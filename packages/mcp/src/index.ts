import { startMcpServer } from "./server.js";

startMcpServer().catch((error: unknown) => {
  // stdout carries the protocol, so a failure must not be written there.
  process.stderr.write(`agent-runtime-map-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
