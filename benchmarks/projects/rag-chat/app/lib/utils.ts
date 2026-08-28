import { BedrockAgentRuntimeClient, RetrieveCommand } from "@aws-sdk/client-bedrock-agent-runtime";

const bedrockClient = new BedrockAgentRuntimeClient({ region: "us-east-1" });

export async function retrieveContext(query: string, knowledgeBaseId: string) {
  const command = new RetrieveCommand({
    knowledgeBaseId,
    retrievalQuery: { text: query },
  });
  const response = await bedrockClient.send(command);
  return { context: JSON.stringify(response), isRagWorking: true };
}
