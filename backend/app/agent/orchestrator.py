import json
import uuid
import asyncio
import httpx
from sqlalchemy import text
from app.core.config import settings
from app.core.logging import logger
from app.agent.tools import get_tool_definitions, call_tool
from app.utils.websocket import ws_manager
from app.agent.slack_bot import post_agent_resolution
from app.agent.memory import recall_similar_fixes, store_optimization_memory
from app.db.session import AppSessionLocal


OPENROUTER_BASE = "https://openrouter.ai/api/v1"
MODELS = [
    "anthropic/claude-3.5-sonnet",
    "anthropic/claude-3-haiku",
    "openai/gpt-4o-mini",
]

SYSTEM_PROMPT = """You are QuerySense Agent — an autonomous database optimization engineer.

Your job: analyze slow SQL queries, find the root cause, test a fix, and apply it safely.

You have access to tools. Follow this workflow EXACTLY, calling each tool only ONCE:
1. run_explain_analysis — understand WHY the query is slow (call once, move on)
2. get_table_stats — understand the data volume and existing indexes (call once)
3. check_column_selectivity — validate that an index would help (call once)
4. benchmark_on_shadow — test the fix before applying (call once)
5. apply_index — only if benchmark shows >20% improvement AND risk is low
6. save_agent_decision — ALWAYS call this as your final step with your full reasoning

Critical rules:
- NEVER call the same tool twice. If you already have data from a tool, use it.
- After calling save_agent_decision, stop immediately and give your final summary.
- Never apply anything other than CREATE INDEX statements autonomously.
- If improvement is <20%, set decision="escalate" in save_agent_decision.

You are an agent. Be decisive. One pass through the tools, then conclude."""


async def _call_openrouter(messages: list[dict], tools: list[dict], max_retries: int = 2) -> dict:
    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://querysense.dev",
        "X-Title": "QuerySense Agent",
        "Content-Type": "application/json",
    }

    last_exc: Exception = RuntimeError("No attempts made")
    for model in MODELS:
        for attempt in range(max_retries):
            payload = {
                "model": model,
                "max_tokens": 4096,
                "temperature": 0.1,
                "tools": tools,
                "tool_choice": "auto",
                "messages": messages,
            }
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    r = await client.post(
                        f"{OPENROUTER_BASE}/chat/completions",
                        headers=headers,
                        json=payload,
                    )
                    if r.status_code == 429:
                        await asyncio.sleep(2 ** attempt)
                        continue
                    if r.status_code in (400, 404, 503):
                        logger.warning("Model unavailable, trying next", model=model, status=r.status_code)
                        break
                    r.raise_for_status()
                    return r.json()
            except httpx.TimeoutException as e:
                last_exc = e
                if attempt == max_retries - 1:
                    logger.warning("Model timed out, trying next", model=model)
                    break
                await asyncio.sleep(2 ** attempt)
            except Exception as e:
                last_exc = e
                logger.error("OpenRouter call failed", model=model, error=str(e))
                break

    raise last_exc


async def run_agent(
    query: str,
    slow_query_id: str,
    auto_apply: bool = False,
    broadcast_room: str = "global",
) -> dict:
    """
    Main agent loop. Runs until Claude stops calling tools or hits max iterations.
    Returns full trace of what the agent did and decided.
    """
    tools = get_tool_definitions()

    # Inject memory: look for past fixes on structurally similar queries
    similar_fixes = []
    try:
        similar_fixes = recall_similar_fixes(query, limit=3)
    except Exception as mem_err:
        logger.warning("Memory recall failed", error=str(mem_err))

    memory_context = ""
    if similar_fixes:
        memory_context = "\n\nPast fixes for structurally similar queries (use as hints):\n"
        for fix in similar_fixes:
            memory_context += (
                f"- Issue: {fix['issue_type']} | Fix: {fix['fix_applied']} | "
                f"Improvement: {fix['improvement_pct']:.1f}%\n"
            )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Analyze and fix this slow SQL query.\n\n"
                f"Query ID: {slow_query_id}\n"
                f"Auto-apply safe fixes: {auto_apply}\n\n"
                f"Query:\n```sql\n{query}\n```\n"
                f"{memory_context}\n"
                f"Investigate the root cause, test a fix, and make a decision."
            ),
        },
    ]

    trace = []
    iteration = 0
    max_iterations = 5
    tool_cache: dict[str, dict] = {}  # dedup: same tool name → return cached result

    await ws_manager.send_event("agent_started", {
        "slow_query_id": slow_query_id,
        "query_preview": query[:100],
    }, room=broadcast_room)

    while iteration < max_iterations:
        iteration += 1
        logger.info("Agent iteration", n=iteration, slow_query_id=slow_query_id)

        try:
            response = await _call_openrouter(messages, tools)
        except Exception as e:
            logger.error("OpenRouter call failed", error=str(e))
            break

        choice = response["choices"][0]
        message = choice["message"]
        finish_reason = choice.get("finish_reason", "")

        # Build assistant message dict for history
        assistant_msg: dict = {"role": "assistant", "content": message.get("content") or ""}
        if "tool_calls" in message:
            assistant_msg["tool_calls"] = message["tool_calls"]
        messages.append(assistant_msg)

        # Agent is done thinking
        if finish_reason in ("end_turn", "stop") and not message.get("tool_calls"):
            trace.append({
                "type": "conclusion",
                "content": message.get("content", ""),
            })
            await ws_manager.send_event("agent_conclusion", {
                "slow_query_id": slow_query_id,
                "content": message.get("content", ""),
            }, room=broadcast_room)
            break

        # Agent wants to call tools
        tool_calls = message.get("tool_calls", [])
        if not tool_calls:
            break

        tool_results = []
        for tc in tool_calls:
            tool_name = tc["function"]["name"]
            try:
                tool_input = json.loads(tc["function"]["arguments"])
            except Exception:
                tool_input = {}

            logger.info("Agent calling tool", tool=tool_name, inputs=tool_input)

            await ws_manager.send_event("agent_tool_call", {
                "slow_query_id": slow_query_id,
                "tool": tool_name,
                "inputs": tool_input,
            }, room=broadcast_room)

            if tool_name in tool_cache:
                result = {**tool_cache[tool_name], "_cached": True, "_note": f"{tool_name} already called — use previous result and proceed to next step"}
                logger.info("Tool dedup cache hit — skipping repeat call", tool=tool_name)
            else:
                result = call_tool(tool_name, tool_input)
                tool_cache[tool_name] = result

            trace.append({
                "type": "tool_call",
                "tool": tool_name,
                "inputs": tool_input,
                "result": result,
            })

            await ws_manager.send_event("agent_tool_result", {
                "slow_query_id": slow_query_id,
                "tool": tool_name,
                "result": result,
            }, room=broadcast_room)

            tool_results.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": json.dumps(result),
            })

        # Feed results back to agent (one message per tool result for OpenAI compat)
        messages.extend(tool_results)

    await ws_manager.send_event("agent_complete", {
        "slow_query_id": slow_query_id,
        "iterations": iteration,
        "trace_length": len(trace),
    }, room=broadcast_room)

    # Post resolution to Slack if agent saved a decision
    benchmark_result = next(
        (t["result"] for t in trace if t.get("type") == "tool_call" and t.get("tool") == "benchmark_on_shadow" and "before_ms" in t.get("result", {})),
        None,
    )
    decision_tool = next(
        (t for t in trace if t.get("type") == "tool_call" and t.get("tool") == "save_agent_decision"),
        None,
    )
    if decision_tool:
        try:
            await post_agent_resolution(
                slow_query_id=slow_query_id,
                decision=decision_tool["inputs"].get("decision", "unknown"),
                reasoning=decision_tool["inputs"].get("reasoning", ""),
                before_ms=benchmark_result.get("before_ms") if benchmark_result else None,
                after_ms=benchmark_result.get("after_ms") if benchmark_result else None,
            )
        except Exception as slack_err:
            logger.warning("Slack resolution post failed", error=str(slack_err))

        # Store in memory for future recall
        if benchmark_result and benchmark_result.get("before_ms"):
            try:
                explain_tool = next(
                    (t for t in trace if t.get("type") == "tool_call" and t.get("tool") == "run_explain_analysis"),
                    None,
                )
                issue_type = "unknown"
                if explain_tool and isinstance(explain_tool.get("result"), dict):
                    issues = explain_tool["result"].get("issues", [])
                    if issues:
                        issue_type = issues[0].get("type", "unknown")

                apply_tool = next(
                    (t for t in trace if t.get("type") == "tool_call" and t.get("tool") == "apply_index"),
                    None,
                )
                fix_applied = ""
                if apply_tool:
                    fix_applied = apply_tool["inputs"].get("index_sql", "")

                import hashlib, re
                n = re.sub(r"\s+", " ", query.strip().lower())
                n = re.sub(r"'[^']*'", "?", n)
                n = re.sub(r"\b\d+\b", "?", n)
                fp = hashlib.sha256(n.encode()).hexdigest()[:16]

                store_optimization_memory(
                    query_fingerprint=fp,
                    query_text=query,
                    issue_type=issue_type,
                    fix_applied=fix_applied,
                    before_ms=benchmark_result["before_ms"],
                    after_ms=benchmark_result.get("after_ms", benchmark_result["before_ms"]),
                    outcome=decision_tool["inputs"].get("decision", "unknown"),
                )
            except Exception as mem_err:
                logger.warning("Memory store failed", error=str(mem_err))

    # Auto-save to agent_decisions if the model never called save_agent_decision
    decision_was_saved = any(
        t.get("tool") == "save_agent_decision"
        for t in trace if t.get("type") == "tool_call"
    )
    if not decision_was_saved and trace:
        conclusion_text = next(
            (t["content"] for t in reversed(trace) if t["type"] == "conclusion" and t.get("content", "").strip()),
            ""
        )
        unique_tools = list(dict.fromkeys(
            t["tool"] for t in trace if t.get("type") == "tool_call"
        ))
        try:
            with AppSessionLocal() as db:
                db.execute(text("""
                    INSERT INTO agent_decisions
                        (id, slow_query_id, decision, reasoning, actions_taken, outcome, created_at)
                    VALUES
                        (:id, :sqid, 'analyzed', :reasoning, :actions, :outcome, NOW())
                """), {
                    "id": str(uuid.uuid4()),
                    "sqid": slow_query_id,
                    "reasoning": conclusion_text or "Agent completed analysis. Check the tool results for details.",
                    "actions": json.dumps(unique_tools),
                    "outcome": f"Completed {iteration} iteration(s), {len(unique_tools)} unique tool(s) called.",
                })
                db.commit()
        except Exception as save_err:
            logger.warning("Auto-save agent decision failed", error=str(save_err))

    return {
        "slow_query_id": slow_query_id,
        "iterations": iteration,
        "trace": trace,
        "conclusion": next(
            (t["content"] for t in reversed(trace) if t["type"] == "conclusion"), ""
        ),
    }
