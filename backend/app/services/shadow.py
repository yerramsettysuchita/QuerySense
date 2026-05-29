import time
import statistics
from sqlalchemy import text, inspect, MetaData, Table
from sqlalchemy.schema import CreateTable
from app.db.session import MainSessionLocal, ShadowSessionLocal, AppSessionLocal, main_engine, shadow_engine
from app.core.config import settings
from app.core.logging import logger
from app.core.metrics import benchmark_duration, benchmark_improvement
from typing import Optional
import uuid


def _ensure_shadow_schema(tables: list[str]) -> None:
    """Mirror any missing tables from main DB into shadow DB (schema only, no data)."""
    main_meta = MetaData()
    shadow_inspector = inspect(shadow_engine)
    existing = set(shadow_inspector.get_table_names(schema="public"))

    for table_name in tables:
        if table_name in existing:
            continue
        try:
            reflected = Table(table_name, main_meta, autoload_with=main_engine)
            with shadow_engine.connect() as conn:
                conn = conn.execution_options(isolation_level="AUTOCOMMIT")
                ddl = str(CreateTable(reflected).compile(shadow_engine))
                conn.execute(text(ddl))
            logger.info("Created shadow table", table=table_name)
        except Exception as e:
            logger.warning("Could not mirror table to shadow", table=table_name, error=str(e))


def _load_sample_rows(table: str, limit: int = None):
    """Copy N rows from main DB into shadow DB for realistic benchmarking."""
    limit = limit or settings.SHADOW_SAMPLE_ROWS
    with MainSessionLocal() as main_conn:
        rows = main_conn.execute(
            text(f"SELECT * FROM {table} ORDER BY RANDOM() LIMIT :limit"),
            {"limit": limit}
        ).fetchall()

        if not rows:
            return 0

        cols = rows[0]._fields
        col_list = ", ".join(cols)
        placeholders = ", ".join(f":{c}" for c in cols)

        with ShadowSessionLocal() as shadow_conn:
            shadow_conn.execute(text(f"TRUNCATE {table} RESTART IDENTITY CASCADE"))
            shadow_conn.execute(
                text(f"INSERT INTO {table} ({col_list}) VALUES ({placeholders})"),
                [dict(r._mapping) for r in rows],
            )
            shadow_conn.commit()

    return len(rows)


def _benchmark_query(query: str, iterations: int) -> list[float]:
    """Run query N times on shadow DB, return execution times in ms."""
    times = []
    with ShadowSessionLocal() as conn:
        for _ in range(iterations):
            start = time.perf_counter()
            try:
                conn.execute(text(query))
            except Exception as e:
                logger.warning("Shadow query failed", error=str(e))
                break
            elapsed = (time.perf_counter() - start) * 1000
            times.append(elapsed)
    return times


def _apply_index_to_shadow(index_sql: str) -> bool:
    """Apply a CREATE INDEX statement to shadow DB."""
    # Strip CONCURRENTLY — not supported outside transactions
    shadow_sql = index_sql.replace("CONCURRENTLY ", "")
    with ShadowSessionLocal() as conn:
        try:
            conn.execute(text(shadow_sql))
            conn.commit()
            return True
        except Exception as e:
            logger.error("Failed to apply index to shadow", error=str(e))
            conn.rollback()
            return False


def _drop_test_indexes(index_names: list[str]):
    with ShadowSessionLocal() as conn:
        for name in index_names:
            try:
                conn.execute(text(f"DROP INDEX IF EXISTS {name}"))
            except Exception as drop_err:
                logger.warning("Could not drop test index", index=name, error=str(drop_err))
        conn.commit()


_SHADOW_LOCK_ID = 12345


def _run_benchmark_inner(
    query: str,
    recommendation_sql: str,
    rec_type: str,
    recommendation_id: str,
    tables_involved: list[str],
) -> Optional[dict]:
    iterations = min(settings.BENCHMARK_ITERATIONS, 50)

    _ensure_shadow_schema(tables_involved)

    # ── 1. Load sample data ────────────────────────────────────────────────────
    for table in tables_involved:
        n = _load_sample_rows(table, limit=settings.SHADOW_SAMPLE_ROWS)
        logger.info("Loaded sample rows", table=table, rows=n)

    # ── 2. Baseline benchmark ─────────────────────────────────────────────────
    before_times = _benchmark_query(query, iterations)
    if not before_times:
        return {"error": "Query failed on shadow DB — check syntax"}

    before_ms = statistics.median(before_times)

    # ── 3. Apply optimization ──────────────────────────────────────────────────
    applied_index_names = []
    if rec_type == "index":
        import re
        idx_match = re.search(r"CREATE INDEX\s+(?:CONCURRENTLY\s+)?(\w+)", recommendation_sql, re.IGNORECASE)
        idx_name = idx_match.group(1) if idx_match else None

        ok = _apply_index_to_shadow(recommendation_sql)
        if not ok:
            return {"error": "Could not apply index to shadow DB"}
        if idx_name:
            applied_index_names.append(idx_name)

    elif rec_type == "rewrite":
        # For rewrite suggestions, the "sql" IS the new query — benchmark it directly
        after_times = _benchmark_query(recommendation_sql, iterations)
        after_ms = statistics.median(after_times) if after_times else before_ms
        improvement = round(((before_ms - after_ms) / before_ms) * 100, 1) if before_ms > 0 else 0.0
        _persist_benchmark(recommendation_id, before_ms, after_ms, iterations)
        return {
            "before_ms": round(before_ms, 2),
            "after_ms": round(after_ms, 2),
            "improvement_pct": improvement,
            "iterations": iterations,
        }

    # ── 4. Post-optimization benchmark ────────────────────────────────────────
    after_times = _benchmark_query(query, iterations)
    after_ms = statistics.median(after_times) if after_times else before_ms

    # ── 5. Cleanup test indexes ────────────────────────────────────────────────
    _drop_test_indexes(applied_index_names)

    improvement = round(((before_ms - after_ms) / before_ms) * 100, 1) if before_ms > 0 else 0.0

    logger.info(
        "Benchmark complete",
        before_ms=round(before_ms, 2),
        after_ms=round(after_ms, 2),
        improvement_pct=improvement,
    )

    _persist_benchmark(recommendation_id, before_ms, after_ms, iterations)
    benchmark_duration.observe(before_ms)
    benchmark_improvement.observe(improvement)

    return {
        "before_ms": round(before_ms, 2),
        "after_ms": round(after_ms, 2),
        "improvement_pct": improvement,
        "iterations": iterations,
    }


def run_benchmark(
    query: str,
    recommendation_sql: str,
    rec_type: str,
    recommendation_id: str,
    tables_involved: list[str],
) -> Optional[dict]:
    """Acquire advisory lock on shadow DB, then run benchmark to prevent concurrent corruption."""
    with ShadowSessionLocal() as lock_conn:
        acquired = lock_conn.execute(
            text("SELECT pg_try_advisory_lock(:lock_id)"),
            {"lock_id": _SHADOW_LOCK_ID},
        ).scalar()

        if not acquired:
            logger.warning("Shadow DB busy — another benchmark running")
            return {"error": "Shadow DB is busy. Try again in a moment."}

        try:
            return _run_benchmark_inner(
                query, recommendation_sql, rec_type, recommendation_id, tables_involved
            )
        finally:
            lock_conn.execute(
                text("SELECT pg_advisory_unlock(:lock_id)"),
                {"lock_id": _SHADOW_LOCK_ID},
            )
            lock_conn.commit()


def _persist_benchmark(rec_id: str, before_ms: float, after_ms: float, iterations: int):
    with AppSessionLocal() as app_db:
        app_db.execute(text("""
            INSERT INTO benchmark_results (id, recommendation_id, before_ms, after_ms, improvement_pct, iterations)
            VALUES (:id, :rec_id, :before, :after, :improvement, :iterations)
            ON CONFLICT DO NOTHING
        """), {
            "id": str(uuid.uuid4()),
            "rec_id": rec_id,
            "before": before_ms,
            "after": after_ms,
            "improvement": round(((before_ms - after_ms) / before_ms) * 100, 1),
            "iterations": iterations,
        })
        app_db.commit()
