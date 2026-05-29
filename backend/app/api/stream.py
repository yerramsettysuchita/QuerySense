from fastapi import APIRouter, Query, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from app.db.session import AppSessionLocal
from app.core.config import settings
from app.core.security import decode_token
from app.core.deps import get_current_user
import asyncio
import json
import time

router = APIRouter()


async def _live_query_generator():
    """
    Server-Sent Events stream.
    Every POLL_INTERVAL seconds, push latest slow query stats to client.
    Client reconnects automatically via EventSource API.
    """
    sent_ids: set[str] = set()

    try:
        while True:
            try:
                with AppSessionLocal() as db:
                    rows = db.execute(text("""
                        SELECT
                            id,
                            query_fingerprint,
                            query_text,
                            avg_exec_time_ms,
                            max_exec_time_ms,
                            calls,
                            db_type,
                            is_anomaly,
                            detected_at
                        FROM slow_queries
                        WHERE is_resolved = false
                        ORDER BY detected_at DESC
                        LIMIT 20
                    """)).fetchall()

                    new_rows = [r for r in rows if r.id not in sent_ids]
                    for r in new_rows:
                        sent_ids.add(r.id)

                    stats = db.execute(text("""
                        SELECT
                            SUM(CASE WHEN is_resolved = false THEN 1 ELSE 0 END) AS active,
                            SUM(CASE WHEN is_anomaly = true  THEN 1 ELSE 0 END)  AS anomalies,
                            COALESCE(AVG(avg_exec_time_ms), 0)                   AS avg_ms,
                            COALESCE(MAX(avg_exec_time_ms), 0)                   AS max_ms
                        FROM slow_queries
                    """)).fetchone()

                payload = {
                    "type": "tick",
                    "timestamp": int(time.time() * 1000),
                    "stats": {
                        "active": stats.active,
                        "anomalies": stats.anomalies,
                        "avg_ms": round(float(stats.avg_ms), 2),
                        "max_ms": round(float(stats.max_ms), 2),
                    },
                    "new_queries": [
                        {
                            "id": r.id,
                            "fingerprint": r.query_fingerprint,
                            "preview": r.query_text[:100],
                            "avg_ms": round(r.avg_exec_time_ms, 2),
                            "calls": r.calls,
                            "db_type": r.db_type,
                            "is_anomaly": r.is_anomaly,
                        }
                        for r in new_rows
                    ],
                }

                yield f"data: {json.dumps(payload)}\n\n"

            except (asyncio.CancelledError, GeneratorExit):
                return
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

            await asyncio.sleep(settings.POLL_INTERVAL_SECONDS)
    except (asyncio.CancelledError, GeneratorExit):
        return


@router.get("/live")
async def live_stream(token: str = Query(...)):
    """SSE endpoint for real-time dashboard updates."""
    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Invalid token")
    return StreamingResponse(
        _live_query_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/pulse")
async def pulse(current_user: dict = Depends(get_current_user)):
    """Lightweight polling alternative to SSE."""
    ws_id = current_user["workspace_id"]
    with AppSessionLocal() as db:
        stats = db.execute(text("""
            SELECT
                SUM(CASE WHEN sq.is_resolved = false THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN sq.is_anomaly = true  THEN 1 ELSE 0 END)  AS anomalies,
                COALESCE(AVG(sq.avg_exec_time_ms), 0)                   AS avg_ms,
                COALESCE(MAX(sq.avg_exec_time_ms), 0)                   AS max_ms,
                COUNT(*)                                                  AS total
            FROM slow_queries sq
            LEFT JOIN db_connections dc ON sq.connection_id = dc.id
            WHERE (dc.workspace_id = :ws_id OR sq.connection_id IS NULL)
        """), {"ws_id": ws_id}).fetchone()

        recent = db.execute(text("""
            SELECT sq.id, sq.query_fingerprint, sq.query_text, sq.avg_exec_time_ms,
                   sq.calls, sq.db_type, sq.is_anomaly, sq.detected_at
            FROM slow_queries sq
            LEFT JOIN db_connections dc ON sq.connection_id = dc.id
            WHERE sq.is_resolved = false
              AND (dc.workspace_id = :ws_id OR sq.connection_id IS NULL)
            ORDER BY sq.detected_at DESC
            LIMIT 5
        """), {"ws_id": ws_id}).fetchall()

    return {
        "timestamp": int(time.time() * 1000),
        "stats": dict(stats._mapping),
        "recent": [dict(r._mapping) for r in recent],
    }
