import asyncio
import time
from sqlalchemy import text, create_engine
from app.core.config import settings
import redis as redis_lib


def _check_postgres(url: str, name: str) -> dict:
    start = time.perf_counter()
    try:
        engine = create_engine(
            url,
            connect_args={"connect_timeout": 3},
            pool_size=1,
            max_overflow=0,
            pool_pre_ping=False,
        )
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        engine.dispose()
        return {
            "name": name,
            "status": "ok",
            "latency_ms": round((time.perf_counter() - start) * 1000, 2),
        }
    except Exception as e:
        try:
            engine.dispose()
        except Exception:
            pass
        return {"name": name, "status": "error", "error": str(e)[:100]}


def _check_redis() -> dict:
    start = time.perf_counter()
    try:
        r = redis_lib.from_url(settings.REDIS_URL, socket_connect_timeout=3, socket_timeout=3)
        r.ping()
        return {
            "name": "redis",
            "status": "ok",
            "latency_ms": round((time.perf_counter() - start) * 1000, 2),
        }
    except Exception as e:
        return {"name": "redis", "status": "error", "error": str(e)[:100]}


def _check_celery() -> dict:
    start = time.perf_counter()
    try:
        from app.core.celery_app import celery_app
        inspect = celery_app.control.inspect(timeout=1.5)
        active = inspect.active()
        if active is None:
            return {"name": "celery", "status": "error", "error": "No workers responding"}
        return {
            "name": "celery",
            "status": "ok",
            "workers": len(active),
            "latency_ms": round((time.perf_counter() - start) * 1000, 2),
        }
    except Exception as e:
        return {"name": "celery", "status": "error", "error": str(e)[:100]}


async def _run_check(fn, *args, check_name: str = "unknown") -> dict:
    loop = asyncio.get_running_loop()
    try:
        return await asyncio.wait_for(
            loop.run_in_executor(None, fn, *args),
            timeout=4.0,
        )
    except asyncio.TimeoutError:
        return {"name": check_name, "status": "error", "error": "timeout"}


async def deep_health_check() -> dict:
    checks = await asyncio.gather(
        _run_check(_check_postgres, settings.APP_DB_URL, "app_db", check_name="app_db"),
        _run_check(_check_postgres, settings.MAIN_DB_URL, "main_db", check_name="main_db"),
        _run_check(_check_postgres, settings.SHADOW_DB_URL, "shadow_db", check_name="shadow_db"),
        _run_check(_check_redis, check_name="redis"),
        _run_check(_check_celery, check_name="celery"),
    )
    all_ok = all(c["status"] == "ok" for c in checks)
    degraded = any(c["status"] == "error" for c in checks)
    return {
        "status": "ok" if all_ok else "degraded" if degraded else "partial",
        "version": "1.0.0",
        "environment": settings.ENVIRONMENT,
        "checks": list(checks),
        "ai_configured": bool(settings.OPENROUTER_API_KEY),
        "slack_enabled": settings.SLACK_ALERTS_ENABLED,
    }
