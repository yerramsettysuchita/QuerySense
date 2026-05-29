import asyncio
import httpx
from app.core.config import settings
from app.core.logging import logger
from app.core.metrics import openrouter_calls
from typing import Optional

OPENROUTER_BASE = "https://openrouter.ai/api/v1"

MODELS = [
    "anthropic/claude-3-haiku",       # fastest — sub-second for short prompts
    "openai/gpt-4o-mini",             # fast fallback
    "anthropic/claude-3.5-sonnet",    # slow fallback only if both above fail
]


async def ask_claude(
    system: str,
    user: str,
    max_tokens: int = 1500,
    temperature: float = 0.2,
    max_retries: int = 2,
) -> Optional[str]:
    """Call OpenRouter with automatic model fallback on failure."""
    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://querysense.dev",
        "X-Title": "QuerySense",
        "Content-Type": "application/json",
    }

    for model in MODELS:
        for attempt in range(max_retries):
            payload = {
                "model": model,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            }
            try:
                async with httpx.AsyncClient(timeout=12.0) as client:
                    response = await client.post(
                        f"{OPENROUTER_BASE}/chat/completions",
                        headers=headers,
                        json=payload,
                    )
                    if response.status_code == 429:
                        await asyncio.sleep(2 ** attempt)
                        continue
                    if response.status_code in (400, 404, 503):
                        logger.warning("Model unavailable, trying next", model=model, status=response.status_code)
                        break
                    response.raise_for_status()
                    openrouter_calls.labels(model=model, status="success").inc()
                    return response.json()["choices"][0]["message"]["content"]
            except httpx.TimeoutException:
                if attempt == max_retries - 1:
                    logger.warning("Model timed out, trying next", model=model)
                    break
                await asyncio.sleep(2 ** attempt)
            except Exception as e:
                openrouter_calls.labels(model=model, status="error").inc()
                logger.error("OpenRouter error", model=model, error=str(e))
                break

    logger.error("All models failed")
    return None
