import re
import uuid
import hashlib
from sqlalchemy import text
from app.db.session import AppSessionLocal
from app.core.logging import logger


def _query_shape(query: str) -> str:
    q = query.upper().strip()
    ops = []
    if "COUNT(" in q: ops.append("COUNT")
    if "SUM(" in q: ops.append("SUM")
    if "AVG(" in q: ops.append("AVG")
    if " JOIN " in q: ops.append("JOIN")
    if "LEFT JOIN" in q: ops.append("LEFT_JOIN")
    if "GROUP BY" in q: ops.append("GROUP_BY")
    if "ORDER BY" in q: ops.append("ORDER_BY")
    if "WHERE" in q: ops.append("WHERE")
    inner = q[7:] if len(q) > 7 else ""
    if "SELECT" in inner: ops.append("SUBQUERY")
    tables = re.findall(r"FROM\s+(\w+)|JOIN\s+(\w+)", q)
    table_names = sorted({t for pair in tables for t in pair if t})
    return "|".join(sorted(ops)) + ":" + ",".join(table_names)


def _shape_hash(shape: str) -> str:
    return hashlib.sha256(shape.encode()).hexdigest()[:16]


def store_optimization_memory(
    query_fingerprint: str,
    query_text: str,
    issue_type: str,
    fix_applied: str,
    before_ms: float,
    after_ms: float,
    outcome: str,
) -> None:
    shape = _query_shape(query_text)
    sh = _shape_hash(shape)
    improvement_pct = ((before_ms - after_ms) / before_ms * 100) if before_ms > 0 else 0.0

    with AppSessionLocal() as db:
        db.execute(text("""
            INSERT INTO agent_memory
                (id, query_fingerprint, shape_hash, query_text, issue_type,
                 fix_applied, before_ms, after_ms, improvement_pct, outcome)
            VALUES
                (:id, :fp, :sh, :query, :issue, :fix, :before, :after, :pct, :outcome)
            ON CONFLICT (query_fingerprint) DO UPDATE
            SET fix_applied      = EXCLUDED.fix_applied,
                before_ms        = EXCLUDED.before_ms,
                after_ms         = EXCLUDED.after_ms,
                improvement_pct  = EXCLUDED.improvement_pct,
                outcome          = EXCLUDED.outcome
        """), {
            "id": str(uuid.uuid4()), "fp": query_fingerprint, "sh": sh,
            "query": query_text, "issue": issue_type, "fix": fix_applied,
            "before": before_ms, "after": after_ms,
            "pct": round(improvement_pct, 2), "outcome": outcome,
        })
        db.commit()

    logger.info("Memory stored", fp=query_fingerprint, outcome=outcome, improvement_pct=round(improvement_pct, 1))


def recall_similar_fixes(query_text: str, limit: int = 3) -> list[dict]:
    shape = _query_shape(query_text)
    sh = _shape_hash(shape)

    with AppSessionLocal() as db:
        rows = db.execute(text("""
            SELECT query_fingerprint, issue_type, fix_applied,
                   before_ms, after_ms, improvement_pct, outcome
            FROM agent_memory
            WHERE shape_hash = :sh AND outcome = 'apply'
            ORDER BY improvement_pct DESC
            LIMIT :limit
        """), {"sh": sh, "limit": limit}).fetchall()

        if rows:
            fps = [r.query_fingerprint for r in rows]
            for fp in fps:
                db.execute(text("""
                    UPDATE agent_memory SET times_recalled = times_recalled + 1
                    WHERE query_fingerprint = :fp
                """), {"fp": fp})
            db.commit()

    return [
        {
            "fingerprint": r.query_fingerprint,
            "issue_type": r.issue_type,
            "fix_applied": r.fix_applied,
            "before_ms": r.before_ms,
            "after_ms": r.after_ms,
            "improvement_pct": r.improvement_pct,
            "outcome": r.outcome,
        }
        for r in rows
    ]


def get_memory_summary() -> dict:
    with AppSessionLocal() as db:
        row = db.execute(text("""
            SELECT
                COUNT(*)                                                                         AS total,
                COUNT(CASE WHEN outcome = 'apply' THEN 1 END)                                    AS applied,
                AVG(CASE WHEN outcome = 'apply' THEN improvement_pct END)                        AS avg_improvement,
                SUM(CASE WHEN outcome = 'apply' THEN before_ms - after_ms ELSE 0 END)            AS total_ms_saved,
                SUM(times_recalled)                                                               AS total_recalls
            FROM agent_memory
        """)).fetchone()

        top_issues = db.execute(text("""
            SELECT issue_type, COUNT(*) AS cnt
            FROM agent_memory
            WHERE issue_type IS NOT NULL
            GROUP BY issue_type
            ORDER BY cnt DESC
            LIMIT 5
        """)).fetchall()

    return {
        "total_memories": row.total or 0,
        "applied": row.applied or 0,
        "avg_improvement_pct": round(float(row.avg_improvement or 0), 1),
        "total_ms_saved": round(float(row.total_ms_saved or 0), 1),
        "total_recalls": row.total_recalls or 0,
        "top_issues": [{"issue_type": r.issue_type, "count": r.cnt} for r in top_issues],
    }
