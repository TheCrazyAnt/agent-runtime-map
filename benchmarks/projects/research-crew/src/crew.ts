interface AgentConfig {
  name: string;
  instructions: string;
}

/** Agents come out of a factory; the call sites hold the returned instances. */
export function makeAgent(config: AgentConfig) {
  return {
    ...config,
    async run(input: string): Promise<string> {
      return callModel(config.instructions, input);
    },
  };
}

export const plannerAgent = makeAgent({
  name: "Planner",
  instructions: "Break the research question into sections with sources to check.",
});

export const writerAgent = makeAgent({
  name: "Writer",
  instructions: "Write one section from the plan and the search results.",
});

export const criticAgent = makeAgent({
  name: "Critic",
  instructions: "Score the draft against the plan and flag weak sections.",
});

/** Instances also live on a plain object, keyed by role. */
export const agents = {
  planner: plannerAgent,
  writer: writerAgent,
  critic: criticAgent,
};

declare function callModel(instructions: string, input: string): Promise<string>;
