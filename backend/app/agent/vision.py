import base64
import httpx
from app.core.config import settings
from app.core.logging import logger

OPENAI_BASE = "https://api.openai.com/v1"
VISION_MODEL = "gpt-4o"


async def _call_openai_vision(image_b64: str, prompt: str) -> str:
    headers = {
        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": VISION_MODEL,
        "max_tokens": 500,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{image_b64}",
                            "detail": "high",
                        },
                    },
                ],
            }
        ],
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(f"{OPENAI_BASE}/chat/completions", headers=headers, json=payload)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]


async def analyze_performance_screenshot(image_bytes: bytes) -> dict:
    if not settings.OPENAI_API_KEY:
        return {"error": "OpenAI API key not configured", "configured": False}

    image_b64 = base64.b64encode(image_bytes).decode()
    prompt = (
        "You are a database performance expert analyzing a screenshot from a monitoring tool "
        "(e.g. pgAdmin, Grafana, EXPLAIN output, or query plan). "
        "Identify: (1) the slowest operation or bottleneck, (2) any obvious index gaps or sequential scans, "
        "(3) estimated query execution time if visible, (4) top recommendation to fix it. "
        "Be concise — 3-4 sentences max."
    )

    try:
        analysis = await _call_openai_vision(image_b64, prompt)
        return {"analysis": analysis, "model": VISION_MODEL, "configured": True}
    except Exception as e:
        logger.error("Vision analysis failed", error=str(e))
        return {"error": str(e), "configured": True}


async def generate_query_from_screenshot(image_bytes: bytes) -> dict:
    if not settings.OPENAI_API_KEY:
        return {"error": "OpenAI API key not configured", "configured": False}

    image_b64 = base64.b64encode(image_bytes).decode()
    prompt = (
        "Extract any SQL query visible in this screenshot. "
        "Return ONLY the raw SQL query text, nothing else. "
        "If no SQL query is visible, return exactly: NO_QUERY_FOUND"
    )

    try:
        extracted = await _call_openai_vision(image_b64, prompt)
        query = extracted.strip()
        found = query != "NO_QUERY_FOUND" and query.upper().startswith(("SELECT", "WITH"))
        return {"query": query if found else None, "found": found, "model": VISION_MODEL}
    except Exception as e:
        logger.error("Query extraction failed", error=str(e))
        return {"error": str(e), "found": False}
