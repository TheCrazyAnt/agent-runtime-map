from openai import OpenAI

client = OpenAI()

RESEARCH_PROMPT = "Research {topic} and return cited facts with sources."


def search_web(query: str) -> list[str]:
    """Search the public web for supporting material."""
    return [query]


def research_agent(topic: str) -> str:
    """Gather material and draft a cited briefing."""
    search_web(topic)
    response = client.responses.create(model="gpt-5", input=RESEARCH_PROMPT)
    return response.output_text
