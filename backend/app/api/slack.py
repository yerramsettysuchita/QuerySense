import json
import urllib.parse
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import text
from app.agent.slack_bot import (
    handle_slack_interaction,
    ask_claude_about_query,
)
from app.db.session import AppSessionLocal
from app.core.config import settings
from app.core.logging import logger

router = APIRouter()


@router.post("/interact")
async def slack_interact(request: Request):
    """
    Receives Slack interactive component payloads (button clicks).
    Slack sends as application/x-www-form-urlencoded with a 'payload' field.
    """
    body = await request.body()
    try:
        form_data = urllib.parse.parse_qs(body.decode())
        payload_str = form_data.get("payload", ["{}"])[0]
        payload = json.loads(payload_str)
    except Exception as e:
        logger.error("Failed to parse Slack payload", error=str(e))
        raise HTTPException(400, "Invalid Slack payload")

    result = await handle_slack_interaction(payload)
    return JSONResponse(content=result)


@router.post("/command")
async def slack_command(request: Request):
    """
    Receives Slack slash commands: /querysense status | top | analyze | ask.
    Register this URL as a Slack slash command endpoint.
    """
    body = await request.body()
    params = urllib.parse.parse_qs(body.decode())

    text_param = params.get("text", [""])[0].strip()
    user_name = params.get("user_name", ["unknown"])[0]

    logger.info("Slack command", text=text_param, user=user_name)

    if not text_param or text_param == "help":
        return JSONResponse(content={
            "response_type": "ephemeral",
            "text": (
                "*QuerySense commands:*\n"
                "`/querysense status` — show current slow query count\n"
                "`/querysense top` — show top 5 slowest queries\n"
                "`/querysense analyze <sql>` — analyze a specific query\n"
                "`/querysense ask <question>` — ask the AI about your database"
            ),
        })

    if text_param == "status":
        return await _handle_status()

    if text_param == "top":
        return await _handle_top()

    if text_param.startswith("analyze "):
        return await _handle_analyze(text_param[8:].strip())

    if text_param.startswith("ask "):
        return await _handle_ask(text_param[4:].strip(), user_name)

    return JSONResponse(content={
        "response_type": "ephemeral",
        "text": f"Unknown command: `{text_param}`. Try `/querysense help`.",
    })


async def _handle_status() -> JSONResponse:
    with AppSessionLocal() as db:
        row = db.execute(text("""
            SELECT
                SUM(CASE WHEN is_resolved = false THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN is_anomaly = true  THEN 1 ELSE 0 END)  AS anomalies,
                COALESCE(MAX(avg_exec_time_ms), 0)                    AS max_ms
            FROM slow_queries
        """)).fetchone()

    status = "🟢 All clear" if row.active == 0 else f"🔴 {row.active} slow queries active"
    return JSONResponse(content={
        "response_type": "in_channel",
        "text": (
            f"{status}\n"
            f"Anomalies: {row.anomalies} | "
            f"Slowest: {row.max_ms:.0f}ms\n"
            f"Dashboard: {settings.APP_BASE_URL}/dashboard"
        ),
    })


async def _handle_top() -> JSONResponse:
    with AppSessionLocal() as db:
        rows = db.execute(text("""
            SELECT query_fingerprint, avg_exec_time_ms, calls, is_anomaly
            FROM slow_queries
            WHERE is_resolved = false
            ORDER BY avg_exec_time_ms DESC
            LIMIT 5
        """)).fetchall()

    if not rows:
        return JSONResponse(content={"response_type": "ephemeral", "text": "No slow queries detected."})

    lines = ["*Top 5 slowest queries:*"]
    for i, r in enumerate(rows, 1):
        flag = " 🚨" if r.is_anomaly else ""
        lines.append(f"{i}. `{r.query_fingerprint}` — {r.avg_exec_time_ms:.0f}ms · {r.calls} calls{flag}")

    return JSONResponse(content={"response_type": "in_channel", "text": "\n".join(lines)})


async def _handle_analyze(query: str) -> JSONResponse:
    if not query.strip().upper().startswith(("SELECT", "WITH")):
        return JSONResponse(content={
            "response_type": "ephemeral",
            "text": "Only SELECT queries are supported.",
        })

    from app.services.analyzer import analyze_query
    result = analyze_query(query)

    if "error" in result:
        return JSONResponse(content={"response_type": "ephemeral", "text": f"Error: {result['error']}"})

    issues = result.get("issues", [])
    recs = result.get("recommendations", [])
    exec_ms = result.get("exec_time_ms", 0)

    lines = [
        f"*Analysis complete* — {exec_ms:.0f}ms",
        f"Issues: {len(issues)} | Recommendations: {len(recs)}",
    ]
    for issue in issues[:3]:
        lines.append(f"• {issue['message']}")
    if recs:
        top = recs[0]
        lines.append(f"\n*Top fix:* {top['title']} (~{top['estimated_improvement_pct']:.0f}% improvement)")

    return JSONResponse(content={"response_type": "in_channel", "text": "\n".join(lines)})


async def _handle_ask(question: str, user: str) -> JSONResponse:
    with AppSessionLocal() as db:
        recent = db.execute(text("""
            SELECT query_text, avg_exec_time_ms, is_anomaly
            FROM slow_queries
            WHERE is_resolved = false
            ORDER BY avg_exec_time_ms DESC
            LIMIT 3
        """)).fetchall()

    context = "\n".join([
        f"- {r.query_text[:100]}... ({r.avg_exec_time_ms:.0f}ms)"
        for r in recent
    ]) or "No slow queries currently active."

    answer = await ask_claude_about_query(question, f"Current slow queries:\n{context}")

    return JSONResponse(content={
        "response_type": "in_channel",
        "text": f"<@{user}> asked: _{question}_\n\n{answer}",
    })
