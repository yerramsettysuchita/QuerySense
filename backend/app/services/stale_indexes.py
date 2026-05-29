from sqlalchemy import text
from app.db.session import MainSessionLocal
from app.services.mysql_monitor import get_mysql_stale_indexes
from app.core.logging import logger
from app.utils.slack import send_slack_alert_sync
from app.core.config import settings


def get_postgres_stale_indexes() -> list[dict]:
    with MainSessionLocal() as conn:
        try:
            rows = conn.execute(text("""
                SELECT
                    schemaname                                          AS schema,
                    tablename                                           AS table,
                    indexname                                           AS index,
                    idx_scan                                            AS scans,
                    idx_tup_read                                        AS tuples_read,
                    pg_size_pretty(pg_relation_size(indexrelid))        AS index_size,
                    pg_relation_size(indexrelid)                        AS index_size_bytes
                FROM pg_stat_user_indexes
                WHERE idx_scan = 0
                  AND schemaname NOT IN ('pg_catalog', 'information_schema')
                ORDER BY pg_relation_size(indexrelid) DESC
                LIMIT 25
            """)).fetchall()
            return [dict(r._mapping) for r in rows]
        except Exception as e:
            logger.error("PG stale index query failed", error=str(e))
            return []


def get_bloated_indexes() -> list[dict]:
    """Indexes that exist but are large AND rarely used — waste of disk + write overhead."""
    with MainSessionLocal() as conn:
        try:
            rows = conn.execute(text("""
                SELECT
                    schemaname                                       AS schema,
                    tablename                                        AS table,
                    indexname                                        AS index,
                    idx_scan                                         AS scans,
                    pg_size_pretty(pg_relation_size(indexrelid))    AS index_size,
                    pg_relation_size(indexrelid)                     AS size_bytes
                FROM pg_stat_user_indexes
                WHERE idx_scan < 10
                  AND pg_relation_size(indexrelid) > 10 * 1024 * 1024
                  AND schemaname NOT IN ('pg_catalog', 'information_schema')
                ORDER BY pg_relation_size(indexrelid) DESC
                LIMIT 20
            """)).fetchall()
            return [dict(r._mapping) for r in rows]
        except Exception as e:
            logger.error("Bloated index query failed", error=str(e))
            return []


def get_duplicate_indexes() -> list[dict]:
    """Indexes that cover the same leading columns — one is redundant."""
    with MainSessionLocal() as conn:
        try:
            rows = conn.execute(text("""
                SELECT
                    a.tablename                     AS table,
                    a.indexname                     AS index_a,
                    b.indexname                     AS index_b,
                    a.indexdef                      AS def_a,
                    b.indexdef                      AS def_b
                FROM pg_indexes a
                JOIN pg_indexes b
                    ON a.tablename = b.tablename
                   AND a.indexname < b.indexname
                   AND (
                       a.indexdef LIKE b.indexdef || '%'
                    OR b.indexdef LIKE a.indexdef || '%'
                   )
                WHERE a.schemaname = 'public'
                LIMIT 15
            """)).fetchall()
            return [dict(r._mapping) for r in rows]
        except Exception as e:
            logger.error("Duplicate index query failed", error=str(e))
            return []


def generate_drop_sql(index_name: str, schema: str = "public") -> str:
    return f"DROP INDEX CONCURRENTLY {schema}.{index_name};"


def run_stale_index_report() -> dict:
    pg_stale = get_postgres_stale_indexes()
    pg_bloated = get_bloated_indexes()
    pg_duplicate = get_duplicate_indexes()
    mysql_stale = get_mysql_stale_indexes()

    total_wasted_bytes = sum(i.get("index_size_bytes", 0) or 0 for i in pg_stale + pg_bloated)
    total_wasted_mb = round(total_wasted_bytes / (1024 * 1024), 1)

    if total_wasted_mb > 100 and settings.SLACK_ALERTS_ENABLED:
        send_slack_alert_sync(
            title="Stale Index Report",
            message=(
                f"Found {len(pg_stale)} unused indexes wasting {total_wasted_mb} MB.\n"
                f"Bloated: {len(pg_bloated)} | Duplicates: {len(pg_duplicate)}\n"
                f"Review at QuerySense dashboard → Indexes tab."
            ),
            severity="warning",
        )

    return {
        "postgres": {
            "stale": pg_stale,
            "bloated": pg_bloated,
            "duplicate": pg_duplicate,
        },
        "mysql": {
            "stale": mysql_stale,
        },
        "summary": {
            "total_unused": len(pg_stale),
            "total_bloated": len(pg_bloated),
            "total_duplicate": len(pg_duplicate),
            "wasted_mb": total_wasted_mb,
        },
    }
