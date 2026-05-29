import uuid
import httpx
from datetime import datetime, timedelta
from sqlalchemy import text
from app.db.session import AppSessionLocal
from app.core.config import settings
from app.core.logging import logger
from app.utils.slack import send_slack_alert_sync

OPENROUTER_BASE = "https://openrouter.ai/api/v1"


def _get_week_bounds() -> tuple[str, str]:
    today = datetime.utcnow().date()
    start = today - timedelta(days=7)
    return str(start), str(today)


async def generate_ai_narrative(stats: dict) -> str:
    if not settings.OPENROUTER_API_KEY:
        return "AI narrative unavailable — configure OPENROUTER_API_KEY."

    prompt = (
        f"You are QuerySense, a database optimization system. Write a brief weekly health report "
        f"narrative (3-4 sentences) based on these stats:\n"
        f"- Slow queries detected: {stats['total_slow']}\n"
        f"- Fixes applied: {stats['fixes_applied']}\n"
        f"- Avg improvement: {stats['avg_improvement_pct']:.1f}%\n"
        f"- Total time saved: {stats['total_ms_saved']:.0f}ms\n"
        f"- Anomalies detected: {stats['anomalies']}\n"
        f"- Top issue type: {stats.get('top_issue', 'N/A')}\n\n"
        "Be direct, factual, and actionable. Mention what needs attention if anything."
    )

    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "anthropic/claude-3.5-sonnet",
        "max_tokens": 200,
        "temperature": 0.3,
        "messages": [{"role": "user", "content": prompt}],
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(f"{OPENROUTER_BASE}/chat/completions", headers=headers, json=payload)
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        logger.error("Narrative generation failed", error=str(e))
        return f"Narrative unavailable: {e}"


async def generate_weekly_report() -> dict:
    week_start, week_end = _get_week_bounds()

    with AppSessionLocal() as db:
        slow = db.execute(text("""
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN is_anomaly THEN 1 ELSE 0 END) AS anomalies
            FROM slow_queries
            WHERE created_at >= :start
        """), {"start": week_start}).fetchone()

        bench = db.execute(text("""
            SELECT COUNT(*) AS total,
                   AVG(improvement_pct) AS avg_imp,
                   SUM(CASE WHEN improvement_pct > 0
                       THEN exec_time_before_ms - exec_time_after_ms ELSE 0 END) AS ms_saved
            FROM benchmark_results
            WHERE created_at >= :start
        """), {"start": week_start}).fetchone()

        top_issue = db.execute(text("""
            SELECT issue_type, COUNT(*) AS cnt
            FROM agent_memory
            WHERE created_at >= :start AND issue_type IS NOT NULL
            GROUP BY issue_type
            ORDER BY cnt DESC
            LIMIT 1
        """), {"start": week_start}).fetchone()

        fixes = db.execute(text("""
            SELECT COUNT(*) AS cnt FROM agent_decisions
            WHERE decision = 'apply' AND created_at >= :start
        """), {"start": week_start}).fetchone()

    stats = {
        "total_slow": slow.total or 0,
        "anomalies": slow.anomalies or 0,
        "benchmarks_run": bench.total or 0,
        "avg_improvement_pct": float(bench.avg_imp or 0),
        "total_ms_saved": float(bench.ms_saved or 0),
        "fixes_applied": fixes.cnt or 0,
        "top_issue": top_issue.issue_type if top_issue else "N/A",
    }

    narrative = await generate_ai_narrative(stats)

    with AppSessionLocal() as db:
        db.execute(text("""
            INSERT INTO weekly_reports
                (id, week_start, week_end, total_queries_analyzed, total_fixes_applied,
                 total_ms_saved, top_issues, narrative, slack_posted)
            VALUES
                (:id, :ws, :we, :total, :fixes, :ms_saved, :top, :narrative, 0)
        """), {
            "id": str(uuid.uuid4()),
            "ws": week_start, "we": week_end,
            "total": stats["total_slow"],
            "fixes": stats["fixes_applied"],
            "ms_saved": stats["total_ms_saved"],
            "top": str([{"issue": stats["top_issue"]}]),
            "narrative": narrative,
        })
        db.commit()

    return {**stats, "narrative": narrative, "week_start": week_start, "week_end": week_end}


async def send_weekly_report_to_slack(report: dict) -> None:
    if not settings.SLACK_ALERTS_ENABLED:
        return
    send_slack_alert_sync(
        title=f"Weekly QuerySense Report ({report['week_start']} → {report['week_end']})",
        message=(
            f"*{report['total_slow']}* slow queries  ·  "
            f"*{report['fixes_applied']}* fixes applied  ·  "
            f"*{report['total_ms_saved']:.0f}ms* saved\n\n"
            f"{report['narrative']}"
        ),
        severity="info",
    )


async def run_weekly_report() -> dict:
    report = await generate_weekly_report()
    await send_weekly_report_to_slack(report)
    logger.info("Weekly report complete", week=report["week_start"])
    return report
