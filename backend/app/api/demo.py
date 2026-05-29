import uuid
import hashlib
import re
import json
import random
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text, bindparam
from app.db.session import get_app_db
from app.core.deps import get_current_user

router = APIRouter()

_DEMO_QUERIES = [
    {
        "query_text": "SELECT u.*, o.*, p.* FROM users u JOIN orders o ON u.id = o.user_id JOIN products p ON o.product_id = p.id WHERE u.is_active = true ORDER BY o.created_at DESC LIMIT 100",
        "avg_exec_time_ms": 3450.0, "max_exec_time_ms": 9200.0, "calls": 12400, "db_type": "postgresql", "is_anomaly": True,
    },
    {
        "query_text": "SELECT e.*, u.name, u.email FROM events e JOIN users u ON e.user_id = u.id WHERE e.created_at >= NOW() - INTERVAL '7 days' AND e.event_type IN ('purchase','refund','chargeback')",
        "avg_exec_time_ms": 2870.0, "max_exec_time_ms": 6100.0, "calls": 8750, "db_type": "postgresql", "is_anomaly": True,
    },
    {
        "query_text": "SELECT COUNT(*), SUM(amount), AVG(amount), DATE_TRUNC('day', created_at) AS day FROM transactions WHERE status = 'completed' GROUP BY DATE_TRUNC('day', created_at) ORDER BY day DESC",
        "avg_exec_time_ms": 1920.0, "max_exec_time_ms": 4300.0, "calls": 5600, "db_type": "postgresql", "is_anomaly": False,
    },
    {
        "query_text": "SELECT p.*, c.name AS category, AVG(r.rating) AS avg_rating, COUNT(r.id) AS review_count FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN reviews r ON p.id = r.product_id WHERE p.is_published = true GROUP BY p.id, c.name ORDER BY avg_rating DESC NULLS LAST LIMIT 50",
        "avg_exec_time_ms": 1680.0, "max_exec_time_ms": 3900.0, "calls": 3200, "db_type": "postgresql", "is_anomaly": False,
    },
    {
        "query_text": "SELECT * FROM audit_logs WHERE actor_id = $1 AND action ILIKE '%delete%' ORDER BY occurred_at DESC",
        "avg_exec_time_ms": 1340.0, "max_exec_time_ms": 2800.0, "calls": 9800, "db_type": "postgresql", "is_anomaly": False,
    },
    {
        "query_text": "SELECT s.*, w.name AS workspace FROM slow_queries s JOIN workspaces w ON s.workspace_id = w.id WHERE s.is_resolved = false ORDER BY s.avg_exec_time_ms DESC LIMIT 20",
        "avg_exec_time_ms": 1150.0, "max_exec_time_ms": 2100.0, "calls": 4400, "db_type": "postgresql", "is_anomaly": False,
    },
    {
        "query_text": "SELECT id, email, created_at FROM users WHERE last_login < NOW() - INTERVAL '90 days' AND subscription_status = 'active'",
        "avg_exec_time_ms": 980.0, "max_exec_time_ms": 1900.0, "calls": 1800, "db_type": "postgresql", "is_anomaly": False,
    },
    {
        "query_text": "SELECT * FROM inventory i JOIN warehouses w ON i.warehouse_id = w.id WHERE i.quantity < i.reorder_point AND w.is_active = true",
        "avg_exec_time_ms": 860.0, "max_exec_time_ms": 1700.0, "calls": 6300, "db_type": "postgresql", "is_anomaly": False,
    },
    {
        "query_text": "SELECT customer_id, SUM(total) AS lifetime_value, COUNT(*) AS order_count FROM orders WHERE created_at >= '2024-01-01' GROUP BY customer_id HAVING SUM(total) > 500 ORDER BY lifetime_value DESC",
        "avg_exec_time_ms": 4100.0, "max_exec_time_ms": 11000.0, "calls": 720, "db_type": "postgresql", "is_anomaly": True,
    },
    {
        "query_text": "SELECT * FROM sessions WHERE user_id = ? AND expires_at > NOW() AND is_revoked = 0 ORDER BY created_at DESC LIMIT 1",
        "avg_exec_time_ms": 760.0, "max_exec_time_ms": 1400.0, "calls": 58000, "db_type": "mysql", "is_anomaly": False,
    },
    {
        "query_text": "SELECT p.name, p.sku, SUM(oi.quantity) AS units_sold FROM products p JOIN order_items oi ON p.id = oi.product_id JOIN orders o ON oi.order_id = o.id WHERE o.status = 'delivered' AND o.created_at BETWEEN ? AND ? GROUP BY p.id ORDER BY units_sold DESC LIMIT 100",
        "avg_exec_time_ms": 2250.0, "max_exec_time_ms": 5800.0, "calls": 1400, "db_type": "mysql", "is_anomaly": True,
    },
    {
        "query_text": "WITH ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score DESC) AS rn FROM leaderboard_entries WHERE contest_id = $1) SELECT * FROM ranked WHERE rn <= 10",
        "avg_exec_time_ms": 890.0, "max_exec_time_ms": 1650.0, "calls": 2900, "db_type": "postgresql", "is_anomaly": False,
    },
]

# Recommendations for queries 0-3 (index 0 = first query in _DEMO_QUERIES)
_DEMO_RECS = {
    0: [
        {
            "rec_type": "index",
            "title": "Add composite index on orders(user_id, created_at DESC)",
            "description": "The query joins users→orders→products without an index on user_id. A composite index eliminates the sequential scan and covers the ORDER BY clause.",
            "sql_fix": "CREATE INDEX CONCURRENTLY idx_orders_user_created\nON orders(user_id, created_at DESC);",
            "estimated_improvement_pct": 85.0, "risk_level": "low", "confidence": 0.97,
            "ai_explanation": "Sequential scan on orders detected. 12,400 calls/day means this scan runs constantly. A composite index on (user_id, created_at DESC) will reduce query time by ~85% by eliminating the sort and enabling index-only scans.",
        },
        {
            "rec_type": "index",
            "title": "Add index on orders.product_id for products JOIN",
            "description": "The products JOIN lacks an index on orders.product_id, causing a secondary sequential scan on each result row.",
            "sql_fix": "CREATE INDEX CONCURRENTLY idx_orders_product_id\nON orders(product_id);",
            "estimated_improvement_pct": 40.0, "risk_level": "low", "confidence": 0.88,
            "ai_explanation": None,
        },
        {
            "rec_type": "rewrite",
            "title": "Avoid SELECT * — project only needed columns",
            "description": "SELECT * fetches all columns from 3 tables including large text/json blobs. Projecting only needed columns reduces I/O by ~60% and enables index-only scans.",
            "sql_fix": "SELECT u.id, u.name, u.email,\n       o.id AS order_id, o.created_at, o.total,\n       p.id AS product_id, p.name AS product_name\nFROM users u\nJOIN orders o ON u.id = o.user_id\nJOIN products p ON o.product_id = p.id\nWHERE u.is_active = true\nORDER BY o.created_at DESC\nLIMIT 100;",
            "estimated_improvement_pct": 30.0, "risk_level": "low", "confidence": 0.72,
            "ai_explanation": None,
        },
    ],
    1: [
        {
            "rec_type": "index",
            "title": "Partial composite index on events(user_id, created_at)",
            "description": "The WHERE clause filters on a 7-day created_at window and event_type IN (...). A partial index covering only the three relevant event types shrinks index size by 70%.",
            "sql_fix": "CREATE INDEX CONCURRENTLY idx_events_user_created_type\nON events(user_id, created_at DESC)\nWHERE event_type IN ('purchase','refund','chargeback');",
            "estimated_improvement_pct": 72.0, "risk_level": "low", "confidence": 0.93,
            "ai_explanation": "Events table has no index covering the 7-day window filter. At 8,750 calls/day a missing index is very expensive. A partial index limited to relevant event_type values will be compact and fast.",
        },
        {
            "rec_type": "rewrite",
            "title": "Replace IN with = ANY(ARRAY[...]) for better index use",
            "description": "PostgreSQL can more reliably use indexes with = ANY(ARRAY[...]) than with IN (...) for some planner versions. Also avoids re-parsing the list on each execution.",
            "sql_fix": "SELECT e.id, e.user_id, e.event_type, e.created_at,\n       u.name, u.email\nFROM events e\nJOIN users u ON e.user_id = u.id\nWHERE e.created_at >= NOW() - INTERVAL '7 days'\n  AND e.event_type = ANY(ARRAY['purchase','refund','chargeback']);",
            "estimated_improvement_pct": 20.0, "risk_level": "low", "confidence": 0.65,
            "ai_explanation": None,
        },
    ],
    2: [
        {
            "rec_type": "materialized_view",
            "title": "Materialized view for daily transaction aggregates",
            "description": "Aggregating millions of transaction rows on every API request is extremely expensive. A nightly-refreshed materialized view pre-computes daily stats and serves them in <1ms.",
            "sql_fix": "CREATE MATERIALIZED VIEW daily_transaction_stats AS\nSELECT\n    DATE_TRUNC('day', created_at) AS day,\n    COUNT(*)       AS txn_count,\n    SUM(amount)    AS total_amount,\n    AVG(amount)    AS avg_amount\nFROM transactions\nWHERE status = 'completed'\nGROUP BY DATE_TRUNC('day', created_at);\n\nCREATE UNIQUE INDEX ON daily_transaction_stats(day);\n\n-- Schedule refresh (pg_cron or cron job):\n-- REFRESH MATERIALIZED VIEW CONCURRENTLY daily_transaction_stats;",
            "estimated_improvement_pct": 90.0, "risk_level": "medium", "confidence": 0.91,
            "ai_explanation": "Full table scan on transactions runs 5,600 times/day. A materialized view refreshed once per hour would serve pre-aggregated results in <1ms instead of 1,920ms. The CONCURRENTLY option allows refreshes without locking reads.",
        },
        {
            "rec_type": "index",
            "title": "Partial index on transactions(created_at) WHERE status = 'completed'",
            "description": "A partial index filters out non-completed rows at index build time, reducing index size by ~60% and narrowing every scan to only relevant rows.",
            "sql_fix": "CREATE INDEX CONCURRENTLY idx_transactions_completed_date\nON transactions(created_at DESC)\nWHERE status = 'completed';",
            "estimated_improvement_pct": 55.0, "risk_level": "low", "confidence": 0.84,
            "ai_explanation": None,
        },
    ],
    3: [
        {
            "rec_type": "index",
            "title": "Covering index on reviews(product_id) INCLUDE (rating, id)",
            "description": "The LEFT JOIN + GROUP BY on reviews requires a full heap fetch per product. A covering index eliminates the table round-trip entirely via index-only scans.",
            "sql_fix": "CREATE INDEX CONCURRENTLY idx_reviews_product_covering\nON reviews(product_id)\nINCLUDE (rating, id);",
            "estimated_improvement_pct": 68.0, "risk_level": "low", "confidence": 0.90,
            "ai_explanation": "Each product lookup triggers a heap fetch for rating data. A covering INCLUDE index stores rating and id inline, making this query read nothing but the index.",
        },
        {
            "rec_type": "rewrite",
            "title": "Pre-aggregate reviews in a subquery to reduce join rows",
            "description": "Joining reviews before grouping causes Cartesian inflation. Pre-aggregating in a subquery reduces the row count before the outer query processes results.",
            "sql_fix": "SELECT p.id, p.name, p.price, p.sku,\n       c.name AS category,\n       r.avg_rating, r.review_count\nFROM (SELECT * FROM products WHERE is_published = true) p\nLEFT JOIN categories c ON p.category_id = c.id\nLEFT JOIN (\n    SELECT product_id,\n           AVG(rating) AS avg_rating,\n           COUNT(id)   AS review_count\n    FROM reviews\n    GROUP BY product_id\n) r ON p.id = r.product_id\nORDER BY r.avg_rating DESC NULLS LAST\nLIMIT 50;",
            "estimated_improvement_pct": 35.0, "risk_level": "low", "confidence": 0.71,
            "ai_explanation": None,
        },
    ],
}

# Agent decisions for queries 0 and 1
_DEMO_AGENT = {
    0: {
        "decision": "apply",
        "reasoning": "Sequential scan on the orders table detected at 12,400 calls/day. Shadow DB benchmark confirmed 94.6% improvement after adding the composite index on orders(user_id, created_at). Index applied automatically — no table lock required (CONCURRENTLY). Query time reduced from 3,450ms to 185ms.",
        "actions_taken": json.dumps([
            "fetch_execution_plan",
            "check_table_stats",
            "generate_index_recommendation",
            "run_shadow_benchmark",
            "apply_index_concurrently",
        ]),
        "outcome": "Index idx_orders_user_created applied successfully. Query time reduced from 3,450ms → 185ms (94.6% improvement). Monitoring for 24h to confirm stability.",
    },
    1: {
        "decision": "escalate",
        "reasoning": "Multiple sequential scans detected across events and users tables. Three candidate indexes identified, but the events table receives 8,750 writes/day — adding multiple indexes would degrade INSERT performance by ~30%. Escalating for human review to choose the best write/read tradeoff.",
        "actions_taken": json.dumps([
            "fetch_execution_plan",
            "check_table_stats",
            "analyze_write_workload",
            "evaluate_index_tradeoffs",
        ]),
        "outcome": "Escalated to team. Write/read tradeoff analysis complete — recommend reviewing idx_events_user_created_type (partial index) as the lowest-write-overhead option.",
    },
}


def _fp(query: str) -> str:
    n = re.sub(r"\s+", " ", query.strip().lower())
    n = re.sub(r"'[^']*'|\$\d+|\?", "?", n)
    n = re.sub(r"\b\d+\b", "?", n)
    return hashlib.sha256(n.encode()).hexdigest()[:16]


def _jitter(base: float, pct: float = 0.12) -> float:
    """Return base ± pct% with Gaussian noise."""
    return max(1.0, base * (1 + random.gauss(0, pct)))


@router.post("/seed")
def seed_demo(db: Session = Depends(get_app_db), current_user: dict = Depends(get_current_user)):
    """Full end-to-end demo seed: queries, recommendations, history, agent decisions, benchmarks."""
    random.seed(42)  # reproducible
    ws_id = current_user["workspace_id"]
    now = datetime.now(timezone.utc)

    # ── 1. Demo connection ────────────────────────────────────────────────────
    demo_conn = db.execute(text("""
        SELECT id FROM db_connections
        WHERE workspace_id = :ws_id AND name = 'Demo Database'
        LIMIT 1
    """), {"ws_id": ws_id}).fetchone()

    if not demo_conn:
        conn_id = str(uuid.uuid4())
        db.execute(text("""
            INSERT INTO db_connections
                (id, workspace_id, name, db_type, connection_url_encrypted,
                 host, port, database, username, pg_stat_statements_enabled, status, is_active)
            VALUES
                (:id, :ws_id, 'Demo Database', 'postgresql', '(demo)',
                 'demo.example.com', 5432, 'demo_db', 'demo_user', false, 'demo', true)
        """), {"id": conn_id, "ws_id": ws_id})
    else:
        conn_id = demo_conn.id

    # ── 2. Slow queries ───────────────────────────────────────────────────────
    inserted = 0
    sq_ids: list[str] = []   # IDs in same order as _DEMO_QUERIES

    for i, q in enumerate(_DEMO_QUERIES):
        fp = _fp(q["query_text"]) + ws_id[:6]
        existing = db.execute(
            text("SELECT id FROM slow_queries WHERE query_fingerprint = :fp"),
            {"fp": fp}
        ).fetchone()

        if existing:
            sq_ids.append(existing.id)
            continue

        sq_id = str(uuid.uuid4())
        detected_at = now - timedelta(hours=i * 4 + 2)
        db.execute(text("""
            INSERT INTO slow_queries
                (id, connection_id, query_fingerprint, query_text,
                 avg_exec_time_ms, max_exec_time_ms, calls, db_type,
                 is_anomaly, is_resolved, detected_at)
            VALUES
                (:id, :conn_id, :fp, :query, :avg, :max, :calls, :db_type,
                 :anomaly, 0, :detected_at)
        """), {
            "id": sq_id, "conn_id": conn_id, "fp": fp,
            "query": q["query_text"], "avg": q["avg_exec_time_ms"],
            "max": q["max_exec_time_ms"], "calls": q["calls"],
            "db_type": q["db_type"], "anomaly": q["is_anomaly"],
            "detected_at": detected_at,
        })
        sq_ids.append(sq_id)
        inserted += 1

    db.flush()

    # ── 3. Query recommendations (queries 0-3) ────────────────────────────────
    rec_ids: dict[int, list[str]] = {}   # {query_index: [rec_id, ...]}

    for q_idx, recs in _DEMO_RECS.items():
        if q_idx >= len(sq_ids):
            continue
        sq_id = sq_ids[q_idx]
        rec_ids[q_idx] = []

        for rec in recs:
            # Skip if already seeded for this slow query + title combo
            existing_rec = db.execute(text("""
                SELECT id FROM query_recommendations
                WHERE slow_query_id = :sq_id AND title = :title
                LIMIT 1
            """), {"sq_id": sq_id, "title": rec["title"]}).fetchone()

            if existing_rec:
                rec_ids[q_idx].append(existing_rec.id)
                continue

            r_id = str(uuid.uuid4())
            db.execute(text("""
                INSERT INTO query_recommendations
                    (id, slow_query_id, rec_type, title, description, sql_fix,
                     estimated_improvement_pct, risk_level, confidence, ai_explanation)
                VALUES
                    (:id, :sq_id, :rec_type, :title, :desc, :sql,
                     :improvement, :risk, :conf, :ai)
            """), {
                "id": r_id, "sq_id": sq_id,
                "rec_type": rec["rec_type"], "title": rec["title"],
                "desc": rec["description"], "sql": rec["sql_fix"],
                "improvement": rec["estimated_improvement_pct"],
                "risk": rec["risk_level"], "conf": rec["confidence"],
                "ai": rec["ai_explanation"],
            })
            rec_ids[q_idx].append(r_id)

    db.flush()

    # ── 4. Query history (all 12 queries) ────────────────────────────────────
    # Queries 0 and 1 are regression queries: last-24h readings are 40% worse
    REGRESSION_QUERY_IDXS = {0, 1}

    for q_idx, sq_id in enumerate(sq_ids):
        avg_ms = _DEMO_QUERIES[q_idx]["avg_exec_time_ms"]

        # Skip if history already exists
        existing_hist = db.execute(
            text("SELECT COUNT(*) FROM query_history WHERE slow_query_id = :id"),
            {"id": sq_id}
        ).scalar()
        if existing_hist and existing_hist > 0:
            continue

        # 24 baseline points spread over days 2–8 (older than 24h)
        for j in range(24):
            hours_ago = 7 * 24 - j * 7   # 168h → 5h ago in 7h steps
            recorded_at = now - timedelta(hours=hours_ago)
            exec_time = _jitter(avg_ms, 0.10)
            db.execute(text("""
                INSERT INTO query_history (id, slow_query_id, exec_time_ms, recorded_at)
                VALUES (:id, :sq_id, :ms, :at)
            """), {
                "id": str(uuid.uuid4()), "sq_id": sq_id,
                "ms": round(exec_time, 2), "at": recorded_at,
            })

        # 5 recent points in last 24h (regression or stable)
        for j in range(5):
            hours_ago = 20 - j * 4    # 20h → 4h ago
            recorded_at = now - timedelta(hours=hours_ago)
            if q_idx in REGRESSION_QUERY_IDXS:
                exec_time = _jitter(avg_ms * 1.42, 0.05)   # 42% worse → triggers regression
            else:
                exec_time = _jitter(avg_ms, 0.08)
            db.execute(text("""
                INSERT INTO query_history (id, slow_query_id, exec_time_ms, recorded_at)
                VALUES (:id, :sq_id, :ms, :at)
            """), {
                "id": str(uuid.uuid4()), "sq_id": sq_id,
                "ms": round(exec_time, 2), "at": recorded_at,
            })

    db.flush()

    # ── 5. Agent decisions (queries 0 and 1) ─────────────────────────────────
    for q_idx, agent_data in _DEMO_AGENT.items():
        if q_idx >= len(sq_ids):
            continue
        sq_id = sq_ids[q_idx]

        existing_decision = db.execute(text("""
            SELECT id FROM agent_decisions WHERE slow_query_id = :id LIMIT 1
        """), {"id": sq_id}).fetchone()
        if existing_decision:
            continue

        db.execute(text("""
            INSERT INTO agent_decisions
                (id, slow_query_id, decision, reasoning, actions_taken, outcome)
            VALUES
                (:id, :sq_id, :decision, :reasoning, :actions, :outcome)
        """), {
            "id": str(uuid.uuid4()), "sq_id": sq_id,
            "decision": agent_data["decision"],
            "reasoning": agent_data["reasoning"],
            "actions": agent_data["actions_taken"],
            "outcome": agent_data["outcome"],
        })

    db.flush()

    # ── 6. Benchmark results (properly linked to real recommendation IDs) ─────
    _BENCHMARK_SPECS = [
        {"q_idx": 0, "r_idx": 0, "before_ms": 3450.0, "after_ms": 185.0, "improvement_pct": 94.6, "iterations": 100},
        {"q_idx": 2, "r_idx": 0, "before_ms": 1920.0, "after_ms": 290.0, "improvement_pct": 84.9, "iterations": 50},
    ]

    benchmarks_added = 0
    for spec in _BENCHMARK_SPECS:
        q_idx = spec["q_idx"]
        r_idx = spec["r_idx"]
        if q_idx not in rec_ids or r_idx >= len(rec_ids[q_idx]):
            continue
        rec_id = rec_ids[q_idx][r_idx]

        existing_bm = db.execute(text("""
            SELECT id FROM benchmark_results WHERE recommendation_id = :rec_id LIMIT 1
        """), {"rec_id": rec_id}).fetchone()
        if existing_bm:
            continue

        db.execute(text("""
            INSERT INTO benchmark_results
                (id, recommendation_id, before_ms, after_ms, improvement_pct, iterations, tested_at)
            VALUES
                (:id, :rec_id, :before, :after, :pct, :iters, :tested_at)
        """), {
            "id": str(uuid.uuid4()), "rec_id": rec_id,
            "before": spec["before_ms"], "after": spec["after_ms"],
            "pct": spec["improvement_pct"], "iters": spec["iterations"],
            "tested_at": now - timedelta(hours=2),
        })
        benchmarks_added += 1

    db.commit()
    return {
        "seeded": inserted,
        "recommendations": sum(len(v) for v in rec_ids.values()),
        "benchmarks": benchmarks_added,
        "history_points": inserted * 29,  # 24 baseline + 5 recent per new query
        "agent_decisions": len(_DEMO_AGENT),
    }


@router.delete("/clear")
def clear_demo(db: Session = Depends(get_app_db), current_user: dict = Depends(get_current_user)):
    """Remove all demo data for this workspace (queries, recs, history, agent decisions, benchmarks)."""
    ws_id = current_user["workspace_id"]

    # Find demo connection
    demo_conn = db.execute(text("""
        SELECT id FROM db_connections
        WHERE workspace_id = :ws_id AND name = 'Demo Database'
        LIMIT 1
    """), {"ws_id": ws_id}).fetchone()

    if not demo_conn:
        return {"deleted": 0}

    conn_id = demo_conn.id

    # Get all demo slow query IDs
    sq_rows = db.execute(text("""
        SELECT id FROM slow_queries WHERE connection_id = :conn_id
    """), {"conn_id": conn_id}).fetchall()
    sq_ids = [r.id for r in sq_rows]

    deleted_counts = {}

    if sq_ids:
        _in_sq = text("DELETE FROM agent_decisions WHERE slow_query_id IN :ids").bindparams(
            bindparam("ids", expanding=True)
        )
        r = db.execute(_in_sq, {"ids": sq_ids})
        deleted_counts["agent_decisions"] = r.rowcount

        rec_rows = db.execute(
            text("SELECT id FROM query_recommendations WHERE slow_query_id IN :ids").bindparams(
                bindparam("ids", expanding=True)
            ),
            {"ids": sq_ids},
        ).fetchall()
        rec_ids = [row.id for row in rec_rows]

        if rec_ids:
            db.execute(
                text("DELETE FROM benchmark_results WHERE recommendation_id IN :ids").bindparams(
                    bindparam("ids", expanding=True)
                ),
                {"ids": rec_ids},
            )
            db.execute(
                text("DELETE FROM query_recommendations WHERE id IN :ids").bindparams(
                    bindparam("ids", expanding=True)
                ),
                {"ids": rec_ids},
            )

        r = db.execute(
            text("DELETE FROM query_history WHERE slow_query_id IN :ids").bindparams(
                bindparam("ids", expanding=True)
            ),
            {"ids": sq_ids},
        )
        deleted_counts["history"] = r.rowcount

        r = db.execute(text("DELETE FROM slow_queries WHERE connection_id = :conn_id"), {"conn_id": conn_id})
        deleted_counts["queries"] = r.rowcount

    # Demo connection
    db.execute(text("""
        DELETE FROM db_connections WHERE id = :id
    """), {"id": conn_id})

    db.commit()
    return {"deleted": deleted_counts.get("queries", 0), "details": deleted_counts}
