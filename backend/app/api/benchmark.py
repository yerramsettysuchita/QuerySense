from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.db.session import AppSessionLocal, get_app_db
from app.services.shadow import run_benchmark
from app.core.logging import logger
from app.core.deps import get_current_user

router = APIRouter()


class BenchmarkRequest(BaseModel):
    query: str
    recommendation_id: str
    recommendation_sql: str
    rec_type: str  # index | rewrite | materialized_view
    tables_involved: list[str]


@router.post("/run")
async def run_benchmark_endpoint(req: BenchmarkRequest, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    """Triggers benchmark in background. Poll /result/{recommendation_id} for results."""
    if not req.query.strip().upper().startswith(("SELECT", "WITH")):
        raise HTTPException(400, "Only SELECT queries can be benchmarked")

    with AppSessionLocal() as db:
        db.execute(text("""
            UPDATE query_recommendations
            SET ai_explanation = 'benchmark_pending'
            WHERE id = :id
        """), {"id": req.recommendation_id})
        db.commit()

    background_tasks.add_task(
        _run_and_store,
        req.query,
        req.recommendation_sql,
        req.rec_type,
        req.recommendation_id,
        req.tables_involved,
    )

    return {"status": "running", "recommendation_id": req.recommendation_id}


def _run_and_store(query, rec_sql, rec_type, rec_id, tables):
    result = run_benchmark(query, rec_sql, rec_type, rec_id, tables)
    if result and "error" not in result:
        logger.info("Benchmark stored", rec_id=rec_id, **result)
    else:
        logger.error("Benchmark failed", rec_id=rec_id, result=result)


@router.get("/result/{recommendation_id}")
def get_benchmark_result(recommendation_id: str, current_user: dict = Depends(get_current_user)):
    with AppSessionLocal() as db:
        row = db.execute(text("""
            SELECT br.*, qr.title, qr.rec_type, qr.risk_level, qr.confidence
            FROM benchmark_results br
            JOIN query_recommendations qr ON br.recommendation_id = qr.id
            WHERE br.recommendation_id = :id
            ORDER BY br.tested_at DESC
            LIMIT 1
        """), {"id": recommendation_id}).fetchone()

        if not row:
            pending = db.execute(text("""
                SELECT ai_explanation FROM query_recommendations WHERE id = :id
            """), {"id": recommendation_id}).scalar()

            if pending == "benchmark_pending":
                return {"status": "pending"}
            return {"status": "not_found"}

        return {"status": "complete", **dict(row._mapping)}


@router.post("/apply/{recommendation_id}")
def mark_applied(recommendation_id: str, current_user: dict = Depends(get_current_user)):
    """Mark a recommendation as applied — triggers migration SQL display."""
    with AppSessionLocal() as db:
        rec = db.execute(text("""
            SELECT id, sql_fix, rec_type FROM query_recommendations WHERE id = :id
        """), {"id": recommendation_id}).fetchone()

        if not rec:
            raise HTTPException(404, "Recommendation not found")

        db.execute(text("""
            UPDATE query_recommendations
            SET is_applied = true, applied_at = NOW()
            WHERE id = :id
        """), {"id": recommendation_id})

        db.execute(text("""
            UPDATE slow_queries SET is_resolved = true
            WHERE id = (
                SELECT slow_query_id FROM query_recommendations WHERE id = :id
            )
        """), {"id": recommendation_id})

        db.commit()

    return {
        "status": "applied",
        "migration_sql": rec.sql_fix,
        "note": "Run this in your database. For indexes, CONCURRENTLY means zero downtime.",
    }


@router.get("/history")
def benchmark_history(
    limit: int = 20,
    db: Session = Depends(get_app_db),
    current_user: dict = Depends(get_current_user),
):
    rows = db.execute(text("""
        SELECT
            br.id,
            br.before_ms,
            br.after_ms,
            br.improvement_pct,
            br.iterations,
            br.tested_at,
            qr.title,
            qr.rec_type,
            sq.query_text
        FROM benchmark_results br
        JOIN query_recommendations qr ON br.recommendation_id = qr.id
        JOIN slow_queries sq ON qr.slow_query_id = sq.id
        ORDER BY br.tested_at DESC
        LIMIT :limit
    """), {"limit": limit}).fetchall()
    return [dict(r._mapping) for r in rows]
