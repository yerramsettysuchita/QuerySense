from fastapi import APIRouter, BackgroundTasks, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy import text
from typing import Optional
from app.agent.orchestrator import run_agent
from app.db.session import AppSessionLocal
from app.core.logging import logger
from app.core.deps import get_current_user
import asyncio

router = APIRouter()


class AgentRequest(BaseModel):
    query: str
    slow_query_id: Optional[str] = None
    auto_apply: bool = False


@router.post("/run")
async def run_agent_endpoint(req: AgentRequest, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    """
    Trigger the autonomous agent on a query.
    Agent runs in background. Watch progress via WebSocket room 'global'.
    Poll /agent/result/{slow_query_id} for final result.
    """
    if not req.query.strip().upper().startswith(("SELECT", "WITH")):
        raise HTTPException(400, "Only SELECT queries are supported")

    slow_query_id = req.slow_query_id or "manual"

    background_tasks.add_task(
        _run_agent_task,
        req.query,
        slow_query_id,
        req.auto_apply,
    )

    return {
        "run_id": slow_query_id,
        "status": "running",
        "message": "Agent started. Watch progress via WebSocket /ws/global or poll /api/v1/agent/result/{id}",
    }


def _run_agent_task(query: str, slow_query_id: str, auto_apply: bool):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        result = loop.run_until_complete(
            asyncio.wait_for(run_agent(query, slow_query_id, auto_apply), timeout=120.0)
        )
        applied = any(
            t.get("tool") == "apply_index" and t.get("result", {}).get("applied")
            for t in result.get("trace", [])
            if t.get("type") == "tool_call"
        )
        if applied:
            with AppSessionLocal() as db:
                db.execute(text("""
                    UPDATE slow_queries SET is_resolved = true WHERE id = :id
                """), {"id": slow_query_id})
                db.commit()
    except asyncio.TimeoutError:
        logger.error("Agent task timed out after 120s", slow_query_id=slow_query_id)
    except Exception as e:
        logger.error("Agent task failed", error=str(e))
    finally:
        loop.close()


@router.get("/result/{slow_query_id}")
def get_agent_result(slow_query_id: str, current_user: dict = Depends(get_current_user)):
    with AppSessionLocal() as db:
        decision = db.execute(text("""
            SELECT * FROM agent_decisions
            WHERE slow_query_id = :id
            ORDER BY created_at DESC
            LIMIT 1
        """), {"id": slow_query_id}).fetchone()

    if not decision:
        return {"status": "pending_or_not_found"}

    return {"status": "complete", **dict(decision._mapping)}


@router.get("/history")
def agent_history(limit: int = 20, current_user: dict = Depends(get_current_user)):
    with AppSessionLocal() as db:
        rows = db.execute(text("""
            SELECT
                ad.*,
                sq.query_text,
                sq.avg_exec_time_ms
            FROM agent_decisions ad
            JOIN slow_queries sq ON ad.slow_query_id = sq.id
            ORDER BY ad.created_at DESC
            LIMIT :limit
        """), {"limit": limit}).fetchall()
    return [dict(r._mapping) for r in rows]
