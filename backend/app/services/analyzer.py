from sqlalchemy import text
from app.db.session import MainSessionLocal, AppSessionLocal
from app.services.parser import run_explain, ExplainResult
from app.core.logging import logger
from typing import Optional
import uuid
import re


def _get_table_row_count(conn, table: str) -> int:
    try:
        row = conn.execute(text("SELECT reltuples::bigint FROM pg_class WHERE relname = :t"), {"t": table}).fetchone()
        return row[0] if row else 0
    except Exception:
        return 0


def _get_column_selectivity(conn, table: str, column: str) -> float:
    try:
        total = _get_table_row_count(conn, table)
        if total == 0:
            return 0.0
        distinct = conn.execute(
            text("SELECT n_distinct FROM pg_stats WHERE tablename = :t AND attname = :c"),
            {"t": table, "c": column}
        ).scalar()
        if distinct is None:
            return 0.0
        # pg_stats stores negative n_distinct as fraction of total rows
        if distinct < 0:
            return abs(distinct)
        return distinct / total
    except Exception:
        return 0.0


def _extract_join_columns(query: str) -> list[tuple[str, str]]:
    pattern = r"JOIN\s+(\w+)\s+\w*\s*ON\s+\w+\.(\w+)\s*=\s*\w+\.(\w+)"
    matches = re.findall(pattern, query, re.IGNORECASE)
    return [(table, col) for table, _, col in matches]


def _existing_indexes(conn, table: str) -> list[str]:
    try:
        rows = conn.execute(text("""
            SELECT a.attname
            FROM pg_index i
            JOIN pg_class c ON c.oid = i.indrelid
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE c.relname = :table
        """), {"table": table}).fetchall()
        return [r[0] for r in rows]
    except Exception:
        return []


def _stale_indexes(conn) -> list[dict]:
    rows = conn.execute(text("""
        SELECT
            schemaname,
            tablename,
            indexname,
            idx_scan,
            pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
        FROM pg_stat_user_indexes
        WHERE idx_scan = 0
          AND schemaname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY pg_relation_size(indexrelid) DESC
        LIMIT 20
    """)).fetchall()
    return [{"schema": r[0], "table": r[1], "index": r[2], "scans": r[3], "size": r[4]} for r in rows]


def build_recommendations(query: str, explain: ExplainResult, main_conn) -> list[dict]:
    recs = []

    seq_scan_issues = [i for i in explain.issues if i["type"] == "seq_scan"]
    for issue in seq_scan_issues:
        table = issue["table"]
        if not table:
            continue

        # Find likely filter column from WHERE clause
        where_cols = re.findall(
            rf"WHERE.*?{table}\.(\w+)|{table}\.(\w+)\s*=", query, re.IGNORECASE
        )
        filter_cols = [c for pair in where_cols for c in pair if c]

        # Check selectivity
        good_cols = [
            c for c in filter_cols
            if _get_column_selectivity(main_conn, table, c) > 0.05
        ]

        existing = _existing_indexes(main_conn, table)
        new_cols = [c for c in good_cols if c not in existing]

        if new_cols:
            col_list = ", ".join(new_cols)
            idx_name = f"idx_{table}_{'_'.join(new_cols)}"
            recs.append({
                "type": "index",
                "title": f"Add index on {table}({col_list})",
                "description": issue["message"],
                "sql": f"CREATE INDEX CONCURRENTLY {idx_name} ON {table} ({col_list});",
                "estimated_improvement_pct": 75.0,
                "risk": "low",
                "confidence": 0.88,
            })

    # Materialized view for GROUP BY + JOIN on large tables
    has_group_by = bool(re.search(r"GROUP\s+BY", query, re.IGNORECASE))
    has_join = bool(re.search(r"\bJOIN\b", query, re.IGNORECASE))
    large_tables = any(
        _get_table_row_count(main_conn, n.relation) > 100_000
        for n in explain.nodes if n.relation
    )

    if has_group_by and has_join and large_tables:
        recs.append({
            "type": "materialized_view",
            "title": "Pre-aggregate with a materialized view",
            "description": "This query joins and aggregates large tables on every run. A materialized view computes the result once and serves reads instantly.",
            "sql": (
                "CREATE MATERIALIZED VIEW mv_query_result AS\n"
                f"{query.strip()};\n\n"
                "CREATE UNIQUE INDEX ON mv_query_result (id);\n\n"
                "-- Refresh periodically:\n"
                "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_query_result;"
            ),
            "estimated_improvement_pct": 92.0,
            "risk": "medium",
            "confidence": 0.80,
        })

    # Join index recommendation
    join_cols = _extract_join_columns(query)
    for table, col in join_cols:
        existing = _existing_indexes(main_conn, table)
        if col not in existing:
            recs.append({
                "type": "index",
                "title": f"Add index on {table}({col}) for join",
                "description": f"JOIN on {table}.{col} has no index. Postgres is doing a full scan to match rows.",
                "sql": f"CREATE INDEX CONCURRENTLY idx_{table}_{col}_join ON {table} ({col});",
                "estimated_improvement_pct": 60.0,
                "risk": "low",
                "confidence": 0.85,
            })

    # Stale stats fix
    stale_issues = [i for i in explain.issues if i["type"] == "stale_stats"]
    if stale_issues:
        tables = list({i["table"] for i in stale_issues if i["table"]})
        analyze_sql = "\n".join(f"ANALYZE {t};" for t in tables)
        recs.append({
            "type": "rewrite",
            "title": "Update table statistics (ANALYZE)",
            "description": "Planner estimates are far off from actual row counts. This causes bad query plans.",
            "sql": analyze_sql,
            "estimated_improvement_pct": 30.0,
            "risk": "low",
            "confidence": 0.95,
        })

    return recs


def get_stale_indexes() -> list[dict]:
    try:
        with MainSessionLocal() as conn:
            return _stale_indexes(conn)
    except Exception as e:
        logger.warning("Stale index query failed — PostgreSQL required", error=str(e))
        return []


def analyze_query(query: str, slow_query_id: Optional[str] = None) -> dict:
    with MainSessionLocal() as main_conn:
        explain = run_explain(main_conn, query)
        if not explain:
            return {"error": "Could not run EXPLAIN on this query"}

        recs = build_recommendations(query, explain, main_conn)

    if slow_query_id and recs:
        with AppSessionLocal() as app_db:
            for rec in recs:
                app_db.execute(text("""
                    INSERT INTO query_recommendations
                        (id, slow_query_id, rec_type, title, description, sql_fix,
                         estimated_improvement_pct, risk_level, confidence)
                    VALUES
                        (:id, :sq_id, :type, :title, :desc, :sql,
                         :improvement, :risk, :confidence)
                    ON CONFLICT DO NOTHING
                """), {
                    "id": str(uuid.uuid4()),
                    "sq_id": slow_query_id,
                    "type": rec["type"],
                    "title": rec["title"],
                    "desc": rec["description"],
                    "sql": rec["sql"],
                    "improvement": rec["estimated_improvement_pct"],
                    "risk": rec["risk"],
                    "confidence": rec["confidence"],
                })
            app_db.commit()

    return {
        "fingerprint": explain.fingerprint,
        "exec_time_ms": explain.total_exec_ms,
        "issues": explain.issues,
        "recommendations": recs,
        "plan_nodes": [
            {
                "type": n.node_type,
                "table": n.relation,
                "rows_estimated": n.rows_estimated,
                "rows_actual": n.rows_actual,
                "cost": n.cost_total,
            }
            for n in explain.nodes
        ],
    }
