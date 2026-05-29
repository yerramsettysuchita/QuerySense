from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app.core.config import settings
from app.core.logging import logger
from app.services.parser import fingerprint_query
from app.utils.slack import send_slack_alert_sync
from app.db.session import AppSessionLocal
import uuid


def _get_mysql_engine():
    if not settings.MYSQL_URL:
        return None
    return create_engine(settings.MYSQL_URL, pool_pre_ping=True, pool_size=3, max_overflow=5)


MYSQL_SLOW_QUERIES_SQL = text("""
    SELECT
        sql_text,
        query_time,
        lock_time,
        rows_examined,
        rows_sent
    FROM mysql.slow_log
    WHERE start_time > NOW() - INTERVAL 1 HOUR
      AND query_time > SEC_TO_TIME(:threshold_sec)
      AND sql_text NOT LIKE '%slow_log%'
    ORDER BY query_time DESC
    LIMIT 30
""")


def parse_mysql_explain(plan_rows: list) -> list[dict]:
    issues = []
    for row in plan_rows:
        r = dict(row._mapping)
        # Full table scan
        if r.get("type") in ("ALL", "index") and (r.get("rows") or 0) > 10000:
            issues.append({
                "type": "seq_scan",
                "severity": "high",
                "table": r.get("table"),
                "message": f"Full scan on `{r.get('table')}` ({r.get('rows'):,} rows). type={r.get('type')}",
            })
        # No index used
        if r.get("possible_keys") is None and (r.get("rows") or 0) > 1000:
            issues.append({
                "type": "missing_index",
                "severity": "high",
                "table": r.get("table"),
                "message": f"No index available on `{r.get('table')}`. Add index on join/filter column.",
            })
        # Filesort
        extra = r.get("Extra") or ""
        if "filesort" in extra.lower():
            issues.append({
                "type": "expensive_sort",
                "severity": "medium",
                "table": r.get("table"),
                "message": f"Filesort on `{r.get('table')}` — index matching ORDER BY would eliminate this.",
            })
        # Temporary table
        if "temporary" in extra.lower():
            issues.append({
                "type": "temp_table",
                "severity": "medium",
                "table": r.get("table"),
                "message": f"Temporary table created for `{r.get('table')}` — GROUP BY or DISTINCT without index.",
            })
    return issues


def run_mysql_explain(query: str) -> dict:
    engine = _get_mysql_engine()
    if not engine:
        return {"error": "MySQL not configured"}

    Session = sessionmaker(bind=engine)
    with Session() as conn:
        try:
            rows = conn.execute(text(f"EXPLAIN {query}")).fetchall()
            issues = parse_mysql_explain(rows)
            plan_nodes = [dict(r._mapping) for r in rows]
            return {
                "issues": issues,
                "plan_nodes": plan_nodes,
                "fingerprint": fingerprint_query(query),
            }
        except Exception as e:
            logger.error("MySQL EXPLAIN failed", error=str(e))
            return {"error": str(e)}


def get_mysql_stale_indexes() -> list[dict]:
    engine = _get_mysql_engine()
    if not engine:
        return []

    Session = sessionmaker(bind=engine)
    with Session() as conn:
        try:
            rows = conn.execute(text("""
                SELECT
                    s.TABLE_SCHEMA,
                    s.TABLE_NAME,
                    s.INDEX_NAME,
                    s.COLUMN_NAME,
                    t.TABLE_ROWS
                FROM information_schema.STATISTICS s
                JOIN information_schema.TABLES t
                    ON s.TABLE_NAME = t.TABLE_NAME
                    AND s.TABLE_SCHEMA = t.TABLE_SCHEMA
                WHERE s.TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')
                  AND s.INDEX_NAME != 'PRIMARY'
                ORDER BY t.TABLE_ROWS DESC
                LIMIT 20
            """)).fetchall()
            return [dict(r._mapping) for r in rows]
        except Exception as e:
            logger.error("MySQL stale index check failed", error=str(e))
            return []


def poll_mysql_slow_queries():
    engine = _get_mysql_engine()
    if not engine:
        logger.info("MySQL not configured, skipping poll")
        return

    Session = sessionmaker(bind=engine)
    threshold_sec = settings.SLOW_QUERY_THRESHOLD_MS / 1000.0

    with Session() as conn:
        try:
            rows = conn.execute(
                MYSQL_SLOW_QUERIES_SQL,
                {"threshold_sec": threshold_sec}
            ).fetchall()
        except Exception as e:
            logger.warning("MySQL slow log unavailable", error=str(e))
            return

    with AppSessionLocal() as app_db:
        for row in rows:
            query = row.sql_text
            exec_ms = float(str(row.query_time).replace("0:", "").replace(":", "")) * 1000
            fp = fingerprint_query(query)

            existing = app_db.execute(
                text("SELECT id FROM slow_queries WHERE query_fingerprint = :fp"),
                {"fp": fp}
            ).fetchone()

            if existing:
                app_db.execute(text("""
                    UPDATE slow_queries
                    SET avg_exec_time_ms = :avg, calls = calls + 1
                    WHERE id = :id
                """), {"avg": exec_ms, "id": existing.id})
                slow_query_id = existing.id
            else:
                result = app_db.execute(text("""
                    INSERT INTO slow_queries
                        (id, query_fingerprint, query_text, avg_exec_time_ms,
                         max_exec_time_ms, calls, db_type, is_anomaly)
                    VALUES (:id, :fp, :query, :avg, :max, 1, 'mysql', false)
                    RETURNING id
                """), {
                    "id": str(uuid.uuid4()),
                    "fp": fp,
                    "query": query,
                    "avg": exec_ms,
                    "max": exec_ms,
                })
                slow_query_id = result.scalar()

            app_db.execute(text("""
                INSERT INTO query_history (id, slow_query_id, exec_time_ms)
                VALUES (:id, :sq_id, :ms)
            """), {"id": str(uuid.uuid4()), "sq_id": slow_query_id, "ms": exec_ms})

        app_db.commit()
        logger.info("MySQL poll complete", found=len(rows))


# Celery task wrapper — imported by celery_app via include list
from celery import shared_task

@shared_task(
    name="app.services.mysql_monitor.poll_mysql_slow_queries_task",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    retry_backoff=True,
)
def poll_mysql_slow_queries_task(self):
    poll_mysql_slow_queries()
