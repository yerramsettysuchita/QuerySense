import uuid
import re
import json
from sqlalchemy import text
from app.db.session import MainSessionLocal, AppSessionLocal, main_engine
from app.services.parser import run_explain, fingerprint_query
from app.core.logging import logger


# ── Tool registry ─────────────────────────────────────────────────────────────

TOOLS: dict[str, dict] = {}


def tool(name: str, description: str, parameters: dict):
    """Decorator that registers a function as an agent tool."""
    def decorator(fn):
        TOOLS[name] = {
            "name": name,
            "description": description,
            "parameters": parameters,
            "fn": fn,
        }
        return fn
    return decorator


def get_tool_definitions() -> list[dict]:
    """Return tool definitions in OpenAI/OpenRouter chat-completions format."""
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": {
                    "type": "object",
                    "properties": t["parameters"],
                    "required": list(t["parameters"].keys()),
                },
            },
        }
        for t in TOOLS.values()
    ]


def call_tool(name: str, inputs: dict) -> dict:
    if name not in TOOLS:
        return {"error": f"Unknown tool: {name}"}
    try:
        return TOOLS[name]["fn"](**inputs)
    except Exception as e:
        logger.error("Tool call failed", tool=name, error=str(e))
        return {"error": str(e)}


# ── Tools ─────────────────────────────────────────────────────────────────────

@tool(
    name="run_explain_analysis",
    description="Run EXPLAIN ANALYZE on a SQL query and return the execution plan with detected issues.",
    parameters={
        "query": {"type": "string", "description": "The SQL SELECT query to analyze"},
    }
)
def tool_run_explain(query: str) -> dict:
    with MainSessionLocal() as conn:
        result = run_explain(conn, query)
    if not result:
        return {"error": "EXPLAIN failed — check query syntax"}
    return {
        "exec_time_ms": round(result.total_exec_ms, 2),
        "fingerprint": result.fingerprint,
        "issues": result.issues,
        "plan_nodes": [
            {
                "type": n.node_type,
                "table": n.relation,
                "rows_estimated": n.rows_estimated,
                "rows_actual": n.rows_actual,
                "cost": round(n.cost_total, 2),
            }
            for n in result.nodes
        ],
        "has_seq_scan": any(i["type"] == "seq_scan" for i in result.issues),
        "has_missing_index": any(i["type"] in ("missing_index", "missing_join_index") for i in result.issues),
    }


@tool(
    name="check_column_selectivity",
    description="Check how selective a column is for indexing. Returns selectivity score 0-1. Above 0.05 is worth indexing.",
    parameters={
        "table": {"type": "string", "description": "Table name"},
        "column": {"type": "string", "description": "Column name to check"},
    }
)
def tool_check_selectivity(table: str, column: str) -> dict:
    with MainSessionLocal() as conn:
        try:
            total = conn.execute(
                text("SELECT reltuples::bigint FROM pg_class WHERE relname = :t"),
                {"t": table}
            ).scalar() or 0

            distinct = conn.execute(
                text("SELECT n_distinct FROM pg_stats WHERE tablename = :t AND attname = :c"),
                {"t": table, "c": column}
            ).scalar()

            existing_indexes = conn.execute(text("""
                SELECT a.attname
                FROM pg_index i
                JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                WHERE i.indrelid = :table::regclass
            """), {"table": table}).fetchall()

            indexed_cols = [r[0] for r in existing_indexes]

            if distinct is None:
                return {"error": f"No stats for {table}.{column} — run ANALYZE first"}

            selectivity = abs(distinct) / total if total > 0 else 0
            if distinct < 0:
                selectivity = abs(distinct)

            return {
                "table": table,
                "column": column,
                "total_rows": total,
                "distinct_values": int(abs(distinct)),
                "selectivity": round(selectivity, 4),
                "worth_indexing": selectivity > 0.05,
                "already_indexed": column in indexed_cols,
                "recommendation": (
                    "already indexed" if column in indexed_cols
                    else "good candidate" if selectivity > 0.05
                    else "low selectivity — index won't help much"
                ),
            }
        except Exception as e:
            return {"error": str(e)}


@tool(
    name="get_table_stats",
    description="Get row count, size, and index info for a table to inform optimization decisions.",
    parameters={
        "table": {"type": "string", "description": "Table name"},
    }
)
def tool_get_table_stats(table: str) -> dict:
    with MainSessionLocal() as conn:
        try:
            row = conn.execute(text("""
                SELECT
                    reltuples::bigint                            AS row_estimate,
                    pg_size_pretty(pg_total_relation_size(oid)) AS total_size,
                    pg_size_pretty(pg_relation_size(oid))       AS table_size,
                    pg_size_pretty(pg_indexes_size(oid))        AS indexes_size
                FROM pg_class
                WHERE relname = :table
            """), {"table": table}).fetchone()

            indexes = conn.execute(text("""
                SELECT indexname, indexdef
                FROM pg_indexes
                WHERE tablename = :table AND schemaname = 'public'
            """), {"table": table}).fetchall()

            if not row:
                return {"error": f"Table '{table}' not found"}

            return {
                "table": table,
                "row_estimate": row.row_estimate,
                "total_size": row.total_size,
                "table_size": row.table_size,
                "indexes_size": row.indexes_size,
                "existing_indexes": [
                    {"name": r.indexname, "definition": r.indexdef}
                    for r in indexes
                ],
                "index_count": len(indexes),
            }
        except Exception as e:
            return {"error": str(e)}


@tool(
    name="benchmark_on_shadow",
    description="Test a SQL fix (index creation or query rewrite) on the shadow database and return actual before/after timing.",
    parameters={
        "original_query": {"type": "string", "description": "The original slow query"},
        "fix_sql": {"type": "string", "description": "The SQL to apply as a fix (CREATE INDEX or rewritten query)"},
        "fix_type": {"type": "string", "description": "Either 'index' or 'rewrite'"},
        "tables": {"type": "array", "items": {"type": "string"}, "description": "List of tables involved"},
    }
)
def tool_benchmark_shadow(
    original_query: str,
    fix_sql: str,
    fix_type: str,
    tables: list[str],
) -> dict:
    from app.services.shadow import run_benchmark
    rec_id = str(uuid.uuid4())

    result = run_benchmark(
        query=original_query,
        recommendation_sql=fix_sql,
        rec_type=fix_type,
        recommendation_id=rec_id,
        tables_involved=tables,
    )

    if not result or "error" in result:
        return {"error": result.get("error", "Benchmark failed") if result else "Benchmark failed"}

    return {
        "before_ms": result["before_ms"],
        "after_ms": result["after_ms"],
        "improvement_pct": result["improvement_pct"],
        "iterations": result["iterations"],
        "worth_applying": result["improvement_pct"] > 20,
        "verdict": (
            "significant improvement — recommend applying"
            if result["improvement_pct"] > 50
            else "moderate improvement — apply with monitoring"
            if result["improvement_pct"] > 20
            else "minimal improvement — not worth the overhead"
        ),
    }


@tool(
    name="apply_index",
    description="Apply a CREATE INDEX CONCURRENTLY statement to the production database. Only call this after benchmark confirms improvement.",
    parameters={
        "index_sql": {"type": "string", "description": "The CREATE INDEX CONCURRENTLY statement to execute"},
        "slow_query_id": {"type": "string", "description": "The slow query ID this index fixes"},
    }
)
def tool_apply_index(index_sql: str, slow_query_id: str) -> dict:
    if "DROP" in index_sql.upper() or "DELETE" in index_sql.upper() or "TRUNCATE" in index_sql.upper():
        return {"error": "Rejected — only CREATE INDEX statements are allowed"}

    if not index_sql.strip().upper().startswith("CREATE INDEX"):
        return {"error": "Rejected — statement must start with CREATE INDEX"}

    try:
        with main_engine.connect() as conn:
            conn = conn.execution_options(isolation_level="AUTOCOMMIT")
            conn.execute(text(index_sql))

        idx_match = re.search(r"CREATE INDEX\s+(?:CONCURRENTLY\s+)?(\w+)", index_sql, re.IGNORECASE)
        idx_name = idx_match.group(1) if idx_match else "unknown"

        with AppSessionLocal() as app_db:
            app_db.execute(text("""
                UPDATE slow_queries SET is_resolved = true WHERE id = :id
            """), {"id": slow_query_id})
            app_db.commit()

        return {
            "applied": True,
            "index_name": idx_name,
            "message": f"Index '{idx_name}' created successfully on production database",
        }
    except Exception as e:
        return {"error": f"Index creation failed: {str(e)}"}


@tool(
    name="monitor_query_performance",
    description="Check current performance of a query fingerprint from pg_stat_statements to verify improvement after a fix.",
    parameters={
        "fingerprint": {"type": "string", "description": "The query fingerprint to monitor"},
    }
)
def tool_monitor_performance(fingerprint: str) -> dict:
    import numpy as np

    with AppSessionLocal() as app_db:
        history = app_db.execute(text("""
            SELECT qh.exec_time_ms, qh.recorded_at
            FROM query_history qh
            JOIN slow_queries sq ON qh.slow_query_id = sq.id
            WHERE sq.query_fingerprint = :fp
            ORDER BY qh.recorded_at DESC
            LIMIT 20
        """), {"fp": fingerprint}).fetchall()

        slow_query = app_db.execute(text("""
            SELECT avg_exec_time_ms, is_resolved, is_anomaly, calls
            FROM slow_queries
            WHERE query_fingerprint = :fp
        """), {"fp": fingerprint}).fetchone()

    if not history:
        return {"error": "No history found for this fingerprint"}

    times = [r.exec_time_ms for r in history]
    return {
        "fingerprint": fingerprint,
        "current_avg_ms": round(float(slow_query.avg_exec_time_ms), 2) if slow_query else None,
        "history_avg_ms": round(float(np.mean(times)), 2),
        "history_min_ms": round(float(np.min(times)), 2),
        "history_max_ms": round(float(np.max(times)), 2),
        "sample_count": len(times),
        "is_resolved": slow_query.is_resolved if slow_query else False,
        "is_anomaly": slow_query.is_anomaly if slow_query else False,
        "trend": (
            "improving" if len(times) > 3 and times[0] < times[-1]
            else "stable" if len(times) > 3
            else "insufficient data"
        ),
    }


@tool(
    name="save_agent_decision",
    description="Save the agent's final decision and reasoning to the database for audit trail and learning.",
    parameters={
        "slow_query_id": {"type": "string", "description": "The slow query ID"},
        "decision": {"type": "string", "description": "The decision made: apply / escalate / monitor / skip"},
        "reasoning": {"type": "string", "description": "Why the agent made this decision"},
        "actions_taken": {"type": "array", "items": {"type": "string"}, "description": "List of actions the agent took"},
        "outcome": {"type": "string", "description": "What happened as a result"},
    }
)
def tool_save_decision(
    slow_query_id: str,
    decision: str,
    reasoning: str,
    actions_taken: list[str],
    outcome: str,
) -> dict:
    with AppSessionLocal() as app_db:
        app_db.execute(text("""
            INSERT INTO agent_decisions
                (id, slow_query_id, decision, reasoning, actions_taken, outcome)
            VALUES
                (:id, :sq_id, :decision, :reasoning, :actions, :outcome)
        """), {
            "id": str(uuid.uuid4()),
            "sq_id": slow_query_id,
            "decision": decision,
            "reasoning": reasoning,
            "actions": json.dumps(actions_taken),
            "outcome": outcome,
        })
        app_db.commit()
    return {"saved": True, "decision": decision}
