import httpx
from sqlalchemy import text
from app.core.config import settings
from app.core.logging import logger
from app.db.session import AppSessionLocal


OPENROUTER_BASE = "https://openrouter.ai/api/v1"


async def post_agent_finding(
    slow_query_id: str,
    query_preview: str,
    avg_ms: float,
    issues: list[dict],
    recommendations: list[dict],
    benchmark: dict | None = None,
) -> str | None:
    """
    Post a rich Slack message when the agent finds something actionable.
    Returns the message timestamp (ts) for threading replies.
    """
    if not settings.SLACK_WEBHOOK_URL:
        return None

    top_issue = issues[0]["message"] if issues else "Performance bottleneck detected"
    top_rec = recommendations[0] if recommendations else None

    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "QuerySense found a slow query"},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Avg execution*\n`{avg_ms:.0f}ms`"},
                {"type": "mrkdwn", "text": f"*Query ID*\n`{slow_query_id[:8]}`"},
            ],
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Root cause*\n{top_issue}"},
        },
    ]

    if top_rec:
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"*Top recommendation*\n"
                    f"`{top_rec.get('title', 'Optimization available')}`\n"
                    f"Estimated improvement: *{top_rec.get('estimated_improvement_pct', 0):.0f}%*"
                ),
            },
        })

    if benchmark and "before_ms" in benchmark:
        blocks.append({
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Before (shadow DB)*\n`{benchmark['before_ms']:.0f}ms`"},
                {"type": "mrkdwn", "text": f"*After (shadow DB)*\n`{benchmark['after_ms']:.0f}ms` ({benchmark['improvement_pct']:.0f}% faster)"},
            ],
        })

    blocks.append({
        "type": "section",
        "text": {"type": "mrkdwn", "text": f"*Query preview*\n```{query_preview[:200]}```"},
    })

    blocks.append({
        "type": "actions",
        "elements": [
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "Apply fix"},
                "style": "primary",
                "value": f"apply:{slow_query_id}",
                "action_id": "apply_fix",
            },
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "View details"},
                "url": f"{settings.APP_BASE_URL}/dashboard/query/{slow_query_id}",
                "action_id": "view_details",
            },
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "Dismiss"},
                "value": f"dismiss:{slow_query_id}",
                "action_id": "dismiss",
            },
        ],
    })

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(settings.SLACK_WEBHOOK_URL, json={"blocks": blocks})
            r.raise_for_status()
            logger.info("Slack agent finding posted", slow_query_id=slow_query_id)
            return "posted"
    except Exception as e:
        logger.error("Slack post failed", error=str(e))
        return None


async def post_agent_resolution(
    slow_query_id: str,
    decision: str,
    reasoning: str,
    before_ms: float | None = None,
    after_ms: float | None = None,
):
    """Post resolution message — what the agent decided and why."""
    if not settings.SLACK_WEBHOOK_URL:
        return

    emoji = {"apply": "✅", "escalate": "⚠️", "monitor": "👀", "skip": "⏭️"}.get(decision, "ℹ️")

    text_lines = [
        f"{emoji} *Agent decision: {decision.upper()}*",
        f"Query ID: `{slow_query_id[:8]}`",
        "",
        f"*Reasoning:* {reasoning}",
    ]

    if before_ms and after_ms:
        improvement = round(((before_ms - after_ms) / before_ms) * 100, 1)
        text_lines += [
            "",
            f"*Impact:* `{before_ms:.0f}ms` → `{after_ms:.0f}ms` ({improvement}% improvement)",
        ]

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                settings.SLACK_WEBHOOK_URL,
                json={"blocks": [{"type": "section", "text": {"type": "mrkdwn", "text": "\n".join(text_lines)}}]},
            )
            r.raise_for_status()
    except Exception as e:
        logger.error("Slack resolution post failed", error=str(e))


async def handle_slack_interaction(payload: dict) -> dict:
    """Handle Slack interactive button clicks."""
    actions = payload.get("actions", [])
    if not actions:
        return {"ok": True}

    action = actions[0]
    action_id = action.get("action_id")
    value = action.get("value", "")
    user = payload.get("user", {}).get("name", "unknown")

    logger.info("Slack interaction", action_id=action_id, value=value, user=user)

    if action_id == "apply_fix" and value.startswith("apply:"):
        return await _handle_apply(value.replace("apply:", ""), user)

    if action_id == "dismiss" and value.startswith("dismiss:"):
        return await _handle_dismiss(value.replace("dismiss:", ""), user)

    return {"ok": True}


async def _handle_apply(slow_query_id: str, user: str) -> dict:
    """Triggered when engineer clicks 'Apply fix' in Slack."""
    from app.agent.orchestrator import run_agent
    import asyncio

    with AppSessionLocal() as db:
        sq = db.execute(
            text("SELECT query_text FROM slow_queries WHERE id = :id"),
            {"id": slow_query_id}
        ).fetchone()

    if not sq:
        return {"ok": False, "error": "Query not found"}

    asyncio.create_task(run_agent(sq.query_text, slow_query_id, auto_apply=True))

    await post_agent_resolution(
        slow_query_id=slow_query_id,
        decision="apply",
        reasoning=f"Approved by @{user} via Slack. Agent running with auto-apply enabled.",
    )

    return {"ok": True, "message": f"Agent triggered with auto-apply. @{user} approved."}


async def _handle_dismiss(slow_query_id: str, user: str) -> dict:
    with AppSessionLocal() as db:
        db.execute(text("UPDATE slow_queries SET is_resolved = true WHERE id = :id"), {"id": slow_query_id})
        db.commit()

    await post_agent_resolution(
        slow_query_id=slow_query_id,
        decision="skip",
        reasoning=f"Dismissed by @{user} via Slack.",
    )

    return {"ok": True}


async def ask_claude_about_query(query: str, context: str) -> str:
    """Natural language Q&A about a query via Slack."""
    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://querysense.dev",
        "X-Title": "QuerySense Slack Bot",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "anthropic/claude-3.5-sonnet",
        "max_tokens": 500,
        "temperature": 0.2,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are QuerySense, a database optimization assistant in Slack. "
                    "Answer questions about slow SQL queries concisely. "
                    "Use plain text — no markdown headers, no bullet walls. "
                    "Max 3 sentences unless more detail is truly needed."
                ),
            },
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {query}"},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(f"{OPENROUTER_BASE}/chat/completions", headers=headers, json=payload)
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]
    except Exception as e:
        logger.error("Claude Slack Q&A failed", error=str(e))
        return "Sorry, I couldn't process that question right now."
