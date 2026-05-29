import asyncio
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import text, bindparam
from pydantic import BaseModel
from typing import Optional
from app.db.session import get_app_db
from app.services.analyzer import analyze_query, get_stale_indexes
from app.utils.openrouter import ask_claude
from app.core.logging import logger
from app.middleware.rate_limit import limiter
from app.core.deps import get_current_user

router = APIRouter()


class AnalyzeRequest(BaseModel):
    query: str
    slow_query_id: Optional[str] = None
    db_type: str = "postgresql"


class CIAnalyzeRequest(BaseModel):
    query: str
    fail_on_seq_scan: bool = True
    fail_threshold_ms: float = 1000.0


@router.post("/analyze")
@limiter.limit("30/minute")
async def analyze(req: AnalyzeRequest, request: Request, current_user: dict = Depends(get_current_user)):
    if not req.query.strip().upper().startswith(("SELECT", "WITH")):
        raise HTTPException(400, "Only SELECT queries are supported for safety")

    # Run sync analyze_query in thread pool — keeps async event loop unblocked
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, analyze_query, req.query, req.slow_query_id)

    if "error" in result:
        raise HTTPException(422, result["error"])

    # Enrich with AI explanation if issues exist
    if result.get("issues"):
        issues_text = "\n".join(f"- {i['message']}" for i in result["issues"][:3])
        recs_text   = "\n".join(f"- {r['title']}"   for r in result["recommendations"][:3])

        ai_explanation = await ask_claude(
            system=(
                "You are a database performance expert. "
                "In 2-3 sentences explain what is wrong with this query and what the fix does. "
                "Be direct. No preamble."
            ),
            user=(
                f"Query: {req.query[:300]}\n"
                f"Issues: {issues_text}\n"
                f"Fix: {recs_text}"
            ),
            max_tokens=150,
        )
        result["ai_explanation"] = ai_explanation

    return result


@router.post("/poll")
def manual_poll(
    db: Session = Depends(get_app_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Manually polls pg_stat_statements on every active connected database
    for the current workspace. Used when Celery is unavailable (e.g. free-tier hosting).
    """
    import uuid
    import re
    import hashlib
    from sqlalchemy import create_engine
    from app.services.connection_wizard import get_decrypted_url
    from app.core.config import settings

    def _fp(query: str) -> str:
        n = re.sub(r"\s+", " ", query.strip().lower())
        n = re.sub(r"'[^']*'", "?", n)
        n = re.sub(r"\b\d+\b", "?", n)
        return hashlib.sha256(n.encode()).hexdigest()[:16]

    conns = db.execute(text("""
        SELECT id FROM db_connections
        WHERE workspace_id = :ws_id AND is_active IS NOT FALSE
    """), {"ws_id": current_user["workspace_id"]}).fetchall()

    total_new = 0
    for conn_row in conns:
        url = get_decrypted_url(conn_row.id, current_user["workspace_id"], db)
        if not url:
            continue
        try:
            eng = create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 8})
            with eng.connect() as c:
                rows = c.execute(text("""
                    SELECT query, mean_exec_time, max_exec_time, calls
                    FROM pg_stat_statements
                    WHERE mean_exec_time > :thr
                      AND query NOT ILIKE '%pg_stat%'
                      AND query NOT ILIKE '%EXPLAIN%'
                      AND query ILIKE 'SELECT%'
                      AND calls >= 1
                    ORDER BY mean_exec_time DESC
                    LIMIT 50
                """), {"thr": settings.SLOW_QUERY_THRESHOLD_MS}).fetchall()
            eng.dispose()
        except Exception as e:
            logger.warning("Poll failed for connection", connection_id=conn_row.id, error=str(e))
            continue

        for row in rows:
            fp = _fp(row.query)
            existing = db.execute(
                text("SELECT id FROM slow_queries WHERE query_fingerprint = :fp"),
                {"fp": fp}
            ).fetchone()
            if existing:
                db.execute(text("""
                    UPDATE slow_queries
                    SET avg_exec_time_ms = :avg, max_exec_time_ms = :max, calls = :calls
                    WHERE id = :id
                """), {"avg": row.mean_exec_time, "max": row.max_exec_time,
                       "calls": row.calls, "id": existing.id})
            else:
                db.execute(text("""
                    INSERT INTO slow_queries
                        (id, connection_id, query_fingerprint, query_text,
                         avg_exec_time_ms, max_exec_time_ms, calls, db_type, is_anomaly)
                    VALUES
                        (:id, :conn_id, :fp, :query, :avg, :max, :calls, 'postgresql', false)
                """), {
                    "id": str(uuid.uuid4()), "conn_id": conn_row.id,
                    "fp": fp, "query": row.query[:2000],
                    "avg": row.mean_exec_time, "max": row.max_exec_time,
                    "calls": row.calls,
                })
                total_new += 1
        db.commit()

    return {"new": total_new, "connections_polled": len(conns)}


@router.get("/slow")
def list_slow_queries(
    limit: int = 20,
    only_anomalies: bool = False,
    db: Session = Depends(get_app_db),
    current_user: dict = Depends(get_current_user),
):
    ws_id = current_user["workspace_id"]
    base = """
        SELECT sq.* FROM slow_queries sq
        LEFT JOIN db_connections dc ON sq.connection_id = dc.id
        WHERE sq.is_resolved = false
          AND (dc.workspace_id = :ws_id OR sq.connection_id IS NULL)
    """
    params: dict = {"limit": min(limit, 200), "ws_id": ws_id}
    if only_anomalies:
        base += " AND sq.is_anomaly = true"
    base += " ORDER BY sq.avg_exec_time_ms DESC LIMIT :limit"

    rows = db.execute(text(base), params).fetchall()
    return [dict(r._mapping) for r in rows]


@router.get("/regressions")
def get_regressions(
    threshold_pct: float = 20.0,
    min_samples: int = 3,
    db: Session = Depends(get_app_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Returns queries that have regressed: recent avg (last 24h) is threshold_pct%
    worse than the 7-day baseline. Requires min_samples baseline points to avoid
    false positives on sparse data.
    """
    ws_id = current_user["workspace_id"]
    try:
        rows = db.execute(text("""
            WITH baseline AS (
                SELECT
                    qh.slow_query_id,
                    AVG(qh.exec_time_ms)  AS baseline_ms,
                    COUNT(*)              AS baseline_samples
                FROM query_history qh
                WHERE qh.recorded_at <  NOW() - INTERVAL '24 hours'
                  AND qh.recorded_at >= NOW() - INTERVAL '7 days'
                GROUP BY qh.slow_query_id
            ),
            recent AS (
                SELECT
                    qh.slow_query_id,
                    AVG(qh.exec_time_ms)  AS recent_ms,
                    COUNT(*)              AS recent_samples,
                    MAX(qh.recorded_at)   AS last_seen
                FROM query_history qh
                WHERE qh.recorded_at >= NOW() - INTERVAL '24 hours'
                GROUP BY qh.slow_query_id
            )
            SELECT
                sq.id,
                sq.query_fingerprint,
                sq.query_text,
                sq.avg_exec_time_ms,
                sq.calls,
                sq.db_type,
                sq.is_anomaly,
                sq.detected_at,
                b.baseline_ms,
                r.recent_ms,
                ROUND(((r.recent_ms - b.baseline_ms) / b.baseline_ms * 100)::numeric, 1) AS regression_pct,
                b.baseline_samples,
                r.recent_samples,
                r.last_seen
            FROM slow_queries sq
            JOIN baseline b ON sq.id = b.slow_query_id
            JOIN recent   r ON sq.id = r.slow_query_id
            LEFT JOIN db_connections dc ON sq.connection_id = dc.id
            WHERE sq.is_resolved = false
              AND (dc.workspace_id = :ws_id OR sq.connection_id IS NULL)
              AND b.baseline_samples >= :min_samples
              AND r.recent_ms > b.baseline_ms * (1 + :threshold / 100.0)
            ORDER BY regression_pct DESC
            LIMIT 50
        """), {"ws_id": ws_id, "min_samples": min_samples, "threshold": threshold_pct}).fetchall()
        return [dict(r._mapping) for r in rows]
    except Exception as e:
        logger.warning("Regression query failed (requires PostgreSQL)", error=str(e))
        return []


@router.get("/meta/stale-indexes")
def stale_indexes(current_user: dict = Depends(get_current_user)):
    return get_stale_indexes()


@router.post("/bulk/resolve")
def bulk_resolve(query_ids: list[str], db: Session = Depends(get_app_db), current_user: dict = Depends(get_current_user)):
    if not query_ids:
        raise HTTPException(400, "No query IDs provided")
    if len(query_ids) > 100:
        raise HTTPException(400, "Max 100 queries per bulk operation")

    ws_id = current_user["workspace_id"]
    db.execute(
        text("""
            UPDATE slow_queries
            SET is_resolved = true
            WHERE id IN :ids
              AND (
                connection_id IS NULL
                OR connection_id IN (SELECT id FROM db_connections WHERE workspace_id = :ws_id)
              )
        """).bindparams(bindparam("ids", expanding=True)),
        {"ids": query_ids, "ws_id": ws_id},
    )
    db.commit()
    return {"resolved": len(query_ids)}


@router.get("/{query_id}")
def get_query_detail(query_id: str, db: Session = Depends(get_app_db), current_user: dict = Depends(get_current_user)):
    ws_id = current_user["workspace_id"]
    row = db.execute(text("""
        SELECT sq.* FROM slow_queries sq
        LEFT JOIN db_connections dc ON sq.connection_id = dc.id
        WHERE sq.id = :id
          AND (dc.workspace_id = :ws_id OR sq.connection_id IS NULL)
    """), {"id": query_id, "ws_id": ws_id}).fetchone()
    if not row:
        raise HTTPException(404, "Query not found")

    recs = db.execute(
        text("SELECT * FROM query_recommendations WHERE slow_query_id = :id ORDER BY confidence DESC"),
        {"id": query_id}
    ).fetchall()

    history = db.execute(
        text("SELECT exec_time_ms, recorded_at FROM query_history WHERE slow_query_id = :id ORDER BY recorded_at ASC LIMIT 100"),
        {"id": query_id}
    ).fetchall()

    return {
        **dict(row._mapping),
        "recommendations": [dict(r._mapping) for r in recs],
        "history": [dict(r._mapping) for r in history],
    }


@router.post("/{query_id}/resolve")
def resolve_query(query_id: str, db: Session = Depends(get_app_db), current_user: dict = Depends(get_current_user)):
    ws_id = current_user["workspace_id"]
    db.execute(text("""
        UPDATE slow_queries SET is_resolved = true
        WHERE id = :id
          AND (
            connection_id IS NULL
            OR connection_id IN (SELECT id FROM db_connections WHERE workspace_id = :ws_id)
          )
    """), {"id": query_id, "ws_id": ws_id})
    db.commit()
    return {"status": "resolved"}


@router.post("/ci/analyze")
async def ci_analyze(req: CIAnalyzeRequest, current_user: dict = Depends(get_current_user)):
    """CI/CD hook — POST a query, get pass/fail with details."""
    result = analyze_query(req.query)
    if "error" in result:
        raise HTTPException(422, result["error"])

    has_seq_scan = any(i["type"] == "seq_scan" for i in result.get("issues", []))
    exceeds_threshold = result.get("exec_time_ms", 0) > req.fail_threshold_ms

    passed = not (req.fail_on_seq_scan and has_seq_scan) and not exceeds_threshold

    return {
        "passed": passed,
        "exec_time_ms": result.get("exec_time_ms"),
        "issues": result.get("issues", []),
        "recommendations": result.get("recommendations", []),
        "fail_reasons": [
            *(["seq_scan_detected"] if has_seq_scan and req.fail_on_seq_scan else []),
            *(["exceeds_threshold"] if exceeds_threshold else []),
        ],
    }


@router.get("/stats/summary")
def query_stats(db: Session = Depends(get_app_db), current_user: dict = Depends(get_current_user)):
    ws_id = current_user["workspace_id"]
    row = db.execute(text("""
        SELECT
            SUM(CASE WHEN sq.is_resolved = false THEN 1 ELSE 0 END)                    AS total_slow,
            SUM(CASE WHEN sq.is_anomaly = true THEN 1 ELSE 0 END)                     AS total_anomalies,
            SUM(CASE WHEN sq.is_resolved = true THEN 1 ELSE 0 END)                    AS total_resolved,
            COALESCE(AVG(sq.avg_exec_time_ms), 0)                                      AS avg_exec_ms,
            COALESCE(MAX(sq.avg_exec_time_ms), 0)                                      AS max_exec_ms,
            SUM(CASE WHEN sq.db_type = 'mysql' THEN 1 ELSE 0 END)                     AS mysql_count,
            SUM(CASE WHEN sq.db_type = 'postgresql' THEN 1 ELSE 0 END)                AS pg_count
        FROM slow_queries sq
        LEFT JOIN db_connections dc ON sq.connection_id = dc.id
        WHERE (dc.workspace_id = :ws_id OR sq.connection_id IS NULL)
    """), {"ws_id": ws_id}).fetchone()

    benchmark_row = db.execute(text("""
        SELECT
            COUNT(*)                               AS total_benchmarks,
            COALESCE(AVG(improvement_pct), 0)      AS avg_improvement,
            COALESCE(MAX(improvement_pct), 0)      AS best_improvement,
            COALESCE(SUM(before_ms - after_ms), 0) AS total_ms_saved
        FROM benchmark_results
    """)).fetchone()

    return {
        "queries": dict(row._mapping),
        "benchmarks": dict(benchmark_row._mapping),
    }


@router.delete("/{query_id}")
def delete_query(query_id: str, db: Session = Depends(get_app_db), current_user: dict = Depends(get_current_user)):
    ws_id = current_user["workspace_id"]
    db.execute(text("""
        DELETE FROM slow_queries
        WHERE id = :id
          AND (
            connection_id IS NULL
            OR connection_id IN (SELECT id FROM db_connections WHERE workspace_id = :ws_id)
          )
    """), {"id": query_id, "ws_id": ws_id})
    db.commit()
    return {"deleted": query_id}
