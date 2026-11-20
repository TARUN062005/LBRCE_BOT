import asyncio
import json
import os
import secrets
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .graph import run_agent
from .tools import AgentTools

ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "apps" / "api" / ".env")

app = FastAPI(title="LBRCE agent", docs_url=None, redoc_url=None, openapi_url=None)


class HistoryTurn(BaseModel):
    role: str
    content: str = ""


class ChatRequest(BaseModel):
    conversationId: str | None = None
    message: str = Field(min_length=1, max_length=4000)
    session: dict = Field(default_factory=dict)
    history: list[HistoryTurn] = Field(default_factory=list)


def expected_token() -> str:
    token = os.environ.get("AGENT_INTERNAL_TOKEN", "").strip()
    if token:
        return token
    if os.environ.get("NODE_ENV") == "production" or os.environ.get("AGENT_ENV") == "production":
        raise HTTPException(status_code=503, detail="Agent token is not configured")
    return "local-dev"


def authorize(request: Request, x_agent_token: str = Header(default="")) -> None:
    expected = expected_token()
    if not secrets.compare_digest(x_agent_token, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")
    client = request.client.host if request.client else ""
    if expected == "local-dev" and client not in {"127.0.0.1", "::1", "localhost"}:
        raise HTTPException(status_code=403, detail="Local agent only")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/agent/chat", dependencies=[Depends(authorize)])
def chat(body: ChatRequest) -> dict:
    return run_agent(body.message, AgentTools(), [turn.model_dump() for turn in body.history])


@app.post("/api/agent/chat/stream", dependencies=[Depends(authorize)])
async def chat_stream(body: ChatRequest) -> StreamingResponse:
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def on_status(text: str) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, ("status", {"status": text}))

    async def work() -> None:
        try:
            result = await asyncio.to_thread(run_agent, body.message, AgentTools(on_status), [turn.model_dump() for turn in body.history])
            for chunk in _chunks(result.get("answer") or ""):
                await queue.put(("token", {"token": chunk}))
            await queue.put(("result", result))
        except Exception:
            await queue.put(("error", {"message": "The college agent could not finish this retrieval."}))
        finally:
            await queue.put(None)

    async def events():
        task = asyncio.create_task(work())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                kind, data = item
                yield f"event: {kind}\ndata: {json.dumps(data)}\n\n"
        finally:
            await task

    return StreamingResponse(events(), media_type="text/event-stream")


def _chunks(text: str) -> list[str]:
    words = text.split(" ")
    parts: list[str] = []
    current = ""
    for word in words:
        piece = word if not current else f" {word}"
        if len(current) + len(piece) > 48:
            parts.append(current)
            current = word
        else:
            current += piece
    if current:
        parts.append(current)
    return parts


def main() -> None:
    host = os.environ.get("AGENT_HOST", "127.0.0.1")
    token = os.environ.get("AGENT_INTERNAL_TOKEN", "").strip()
    if host not in {"127.0.0.1", "localhost"} and token in {"", "local-dev"}:
        raise SystemExit("Set AGENT_INTERNAL_TOKEN before exposing the agent beyond localhost")
    port = int(os.environ.get("AGENT_PORT", "4100"))
    uvicorn.run("app.main:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
