import httpx
import time
from app.core.config import settings
from app.core.logging import logger


def send_slack_alert_sync(title: str, message: str, severity: str = "warning") -> bool:
    """Sync version — safe to call from Celery tasks."""
    if not settings.SLACK_ALERTS_ENABLED or not settings.SLACK_WEBHOOK_URL:
        return False

    color = {
        "info": "#36a64f",
        "warning": "#ff9800",
        "critical": "#e53935",
    }.get(severity, "#ff9800")

    payload = {
        "attachments": [{
            "color": color,
            "title": f"QuerySense: {title}",
            "text": message,
            "footer": "QuerySense AI Query Optimizer",
            "ts": int(time.time()),
        }]
    }

    try:
        r = httpx.post(settings.SLACK_WEBHOOK_URL, json=payload, timeout=5.0)
        r.raise_for_status()
        return True
    except Exception as e:
        logger.error("Slack alert failed", error=str(e))
        return False


async def send_slack_alert(title: str, message: str, severity: str = "warning") -> bool:
    """Async version — for use in FastAPI route handlers."""
    if not settings.SLACK_ALERTS_ENABLED or not settings.SLACK_WEBHOOK_URL:
        return False

    color = {
        "info": "#36a64f",
        "warning": "#ff9800",
        "critical": "#e53935",
    }.get(severity, "#ff9800")

    payload = {
        "attachments": [{
            "color": color,
            "title": f"QuerySense: {title}",
            "text": message,
            "footer": "QuerySense AI Query Optimizer",
            "ts": int(time.time()),
        }]
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(settings.SLACK_WEBHOOK_URL, json=payload)
            r.raise_for_status()
            return True
    except Exception as e:
        logger.error("Slack alert failed", error=str(e))
        return False
