import asyncio
import uuid
import numpy as np
from sqlalchemy import text
from celery import shared_task
from app.db.session import MainSessionLocal, AppSessionLocal
from app.core.config import settings
from app.core.logging import logger
from app.utils.slack import send_slack_alert_sync
from app.utils.websocket import ws_manager
from app.agent.slack_bot import post_agent_finding
from app.core.metrics import slow_queries_detected, anomalies_detected, active_slow_queries


PG_SLOW_QUERIES_SQL = text("""
    SELECT
        queryid::text,
        query,
        mean_exec_time,
        max_exec_time,
        calls,
        total_exec_time,
        stddev_exec_time
    FROM pg_stat_statements
    WHERE mean_exec_time > :threshold_ms
      AND query NOT ILIKE '%pg_stat_statements%'
      AND query NOT ILIKE '%EXPLAIN%'
      AND query NOT ILIKE '%pg_stat%'
      AND calls >= 3
      AND query ILIKE 'SELECT%'
    ORDER BY mean_exec_time DESC
    LIMIT 50
""")


def _fingerprint(query: str) -> str:
    import re
    import hashlib
    n = re.sub(r"\s+", " ", query.strip().lower())
    n = re.sub(r"'[^']*'", "?", n)
    n = re.sub(r"\b\d+\b", "?", n)
    return hashlib.sha256(n.encode()).hexdigest()[:16]


def _is_anomaly(history_ms: list[float], current_ms: float) -> bool:
    if len(history_ms) < 5:
        return False
    arr = np.array(history_ms)
    mean, std = arr.mean(), arr.std()
    if std == 0:
        return False
    return current_ms > mean + settings.ANOMALY_STDDEV_MULTIPLIER * std


def _broadcast(event: str, payload: dict):
    """Fire-and-forget WS broadcast from sync Celery context."""
    try:
        loop = asyncio.new_event_loop()
        loop.run_until_complete(
            ws_manager.send_event(event, payload, room="global")
        )
        loop.close()
    except Exception as e:
        logger.warning("WS broadcast failed", event=event, error=str(e))


@shared_task(
    name="app.services.monitor.poll_slow_queries",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    retry_backoff=True,
)
def poll_slow_queries(self):
    logger.info("Polling pg_stat_statements")
    found_new = 0
    found_anomalies = 0

    try:
        with MainSessionLocal() as main_db:
            try:
                rows = main_db.execute(
                    PG_SLOW_QUERIES_SQL,
                    {"threshold_ms": settings.SLOW_QUERY_THRESHOLD_MS}
                ).fetchall()
            except Exception as e:
                if "pg_stat_statements" in str(e).lower():
                    logger.warning(
                        "pg_stat_statements not available — enable with: "
                        "CREATE EXTENSION pg_stat_statements. "
                        "Manual analysis via /api/v1/queries/analyze still works."
                    )
                    return
                raise

        with AppSessionLocal() as app_db:
            active_conn = app_db.execute(text("""
                SELECT id FROM db_connections
                WHERE is_active = true
                ORDER BY created_at ASC
                LIMIT 1
            """)).fetchone()
            system_connection_id = active_conn.id if active_conn else None

        with AppSessionLocal() as app_db:
            for row in rows:
                fp = _fingerprint(row.query)

                history = app_db.execute(text("""
                    SELECT qh.exec_time_ms
                    FROM query_history qh
                    JOIN slow_queries sq ON qh.slow_query_id = sq.id
                    WHERE sq.query_fingerprint = :fp
                    ORDER BY qh.recorded_at DESC
                    LIMIT :window
                """), {"fp": fp, "window": settings.QUERY_HISTORY_WINDOW}).fetchall()

                history_ms = [r.exec_time_ms for r in history]
                is_anomaly = _is_anomaly(history_ms, row.mean_exec_time)

                existing = app_db.execute(
                    text("SELECT id, is_anomaly FROM slow_queries WHERE query_fingerprint = :fp"),
                    {"fp": fp}
                ).fetchone()

                if existing:
                    app_db.execute(text("""
                        UPDATE slow_queries
                        SET avg_exec_time_ms = :avg,
                            max_exec_time_ms = :max,
                            calls            = :calls,
                            is_anomaly       = :anomaly
                        WHERE id = :id
                    """), {
                        "avg": row.mean_exec_time,
                        "max": row.max_exec_time,
                        "calls": row.calls,
                        "anomaly": is_anomaly,
                        "id": existing.id,
                    })
                    slow_query_id = existing.id
                    was_new = False
                else:
                    result = app_db.execute(text("""
                        INSERT INTO slow_queries
                            (id, connection_id, query_fingerprint, query_text, avg_exec_time_ms,
                             max_exec_time_ms, calls, db_type, is_anomaly)
                        VALUES
                            (:id, :conn_id, :fp, :query, :avg, :max, :calls, 'postgresql', :anomaly)
                        RETURNING id
                    """), {
                        "id": str(uuid.uuid4()),
                        "conn_id": system_connection_id,
                        "fp": fp,
                        "query": row.query,
                        "avg": row.mean_exec_time,
                        "max": row.max_exec_time,
                        "calls": row.calls,
                        "anomaly": is_anomaly,
                    })
                    slow_query_id = result.scalar()
                    was_new = True
                    found_new += 1

                app_db.execute(text("""
                    INSERT INTO query_history (id, slow_query_id, exec_time_ms)
                    VALUES (:id, :sq_id, :ms)
                """), {
                    "id": str(uuid.uuid4()),
                    "sq_id": slow_query_id,
                    "ms": row.mean_exec_time,
                })

                app_db.commit()

                if was_new:
                    slow_queries_detected.labels(db_type="postgresql").inc()
                    _broadcast("slow_query_found", {
                        "id": slow_query_id,
                        "fingerprint": fp,
                        "avg_ms": round(row.mean_exec_time, 2),
                        "calls": row.calls,
                        "query_preview": row.query[:120],
                    })

                if is_anomaly:
                    found_anomalies += 1
                    anomalies_detected.inc()
                    logger.warning("Anomaly", fp=fp, ms=row.mean_exec_time)

                    # Quick explain to get issues for the Slack rich message
                    issues = []
                    try:
                        from app.services.parser import run_explain
                        with MainSessionLocal() as explain_conn:
                            explain_result = run_explain(explain_conn, row.query)
                            issues = explain_result.issues if explain_result else []
                    except Exception as explain_err:
                        logger.warning("EXPLAIN failed during anomaly alert", error=str(explain_err))

                    send_slack_alert_sync(
                        title="Query Regression Detected",
                        message=(
                            f"Fingerprint `{fp}`\n"
                            f"Execution: {row.mean_exec_time:.0f}ms\n"
                            f"Baseline was: {np.mean(history_ms):.0f}ms avg"
                        ),
                        severity="critical",
                    )

                    try:
                        loop = asyncio.new_event_loop()
                        loop.run_until_complete(post_agent_finding(
                            slow_query_id=slow_query_id,
                            query_preview=row.query[:200],
                            avg_ms=row.mean_exec_time,
                            issues=issues,
                            recommendations=[],
                        ))
                        loop.run_until_complete(ws_manager.send_event(
                            "anomaly_detected",
                            {"fingerprint": fp, "ms": round(row.mean_exec_time, 2), "slow_query_id": slow_query_id},
                            room="global",
                        ))
                        loop.close()
                    except Exception as ws_err:
                        logger.warning("Broadcast failed", error=str(ws_err))

        logger.info("Poll complete", total=len(rows), new=found_new, anomalies=found_anomalies)
        try:
            with AppSessionLocal() as gauge_db:
                count = gauge_db.execute(
                    text("SELECT COUNT(*) FROM slow_queries WHERE is_resolved = false")
                ).scalar()
                active_slow_queries.set(count or 0)
        except Exception as gauge_err:
            logger.warning("Failed to update active_slow_queries gauge", error=str(gauge_err))

    except Exception as e:
        logger.error("Poll failed", error=str(e))
        raise
