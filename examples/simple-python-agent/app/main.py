from fastapi import FastAPI

from app.agents.research import research_agent
from app.review import approve_briefing

app = FastAPI()


@app.post("/api/briefings")
async def create_briefing(topic: str):
    draft = research_agent(topic)
    return approve_briefing(draft)
