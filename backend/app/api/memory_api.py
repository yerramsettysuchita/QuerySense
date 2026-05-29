from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from app.db.session import AppSessionLocal
from app.agent.memory import get_memory_summary, recall_similar_fixes
from app.core.deps import get_current_user

router = APIRouter()


class RecallRequest(BaseModel):
    query: str


@router.get("/summary")
def memory_summary(current_user: dict = Depends(get_current_user)):
    return get_memory_summary()


@router.post("/recall")
def recall(req: RecallRequest, current_user: dict = Depends(get_current_user)):
    fixes = recall_similar_fixes(req.query)
    return {"fixes": fixes, "count": len(fixes)}


@router.get("/all")
def all_memories(limit: int = 50, current_user: dict = Depends(get_current_user)):
    with AppSessionLocal() as db:
        rows = db.execute(text("""
            SELECT id, query_fingerprint, shape_hash, issue_type, fix_applied,
                   before_ms, after_ms, improvement_pct, outcome, times_recalled, created_at
            FROM agent_memory
            ORDER BY created_at DESC
            LIMIT :limit
        """), {"limit": min(limit, 200)}).fetchall()
    return [dict(r._mapping) for r in rows]


@router.get("/reports")
def weekly_reports(limit: int = 10, current_user: dict = Depends(get_current_user)):
    with AppSessionLocal() as db:
        rows = db.execute(text("""
            SELECT id, week_start, week_end, total_queries_analyzed,
                   total_fixes_applied, total_ms_saved, narrative, created_at
            FROM weekly_reports
            ORDER BY created_at DESC
            LIMIT :limit
        """), {"limit": limit}).fetchall()
    return [dict(r._mapping) for r in rows]


@router.post("/report/trigger")
async def trigger_report(current_user: dict = Depends(get_current_user)):
    from app.agent.report import run_weekly_report
    return await run_weekly_report()
