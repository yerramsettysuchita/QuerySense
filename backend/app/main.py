from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from slowapi.errors import RateLimitExceeded

from app.core.config import settings
from app.core.logging import setup_logging, logger
from app.db.base import Base
from app.db.session import app_engine
import app.models  # noqa: F401 — registers all ORM models with Base before create_all
from app.utils.websocket import ws_manager
from app.middleware.request_id import RequestIDMiddleware
from app.middleware.rate_limit import limiter, rate_limit_handler
from app.middleware.error_handler import global_error_handler
from app.utils.health import deep_health_check
from app.core.metrics import setup_metrics
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

from app.api.queries import router as queries_router
from app.api.benchmark import router as benchmark_router
from app.api.indexes import router as indexes_router
from app.api.cicd import router as cicd_router
from app.api.stream import router as stream_router
from app.api.agent import router as agent_router
from app.api.slack import router as slack_router
from app.api.vision import router as vision_router
from app.api.memory_api import router as memory_router
from app.api.auth import router as auth_router
from app.api.connections import router as connections_router
from app.api.demo import router as demo_router


_DEFAULT_KEYS = ("dev-secret-key", "", "your-secret-key-change-in-production")


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    logger.info("QuerySense starting", environment=settings.ENVIRONMENT)

    if settings.SENTRY_DSN:
        sentry_sdk.init(
            dsn=settings.SENTRY_DSN,
            environment=settings.ENVIRONMENT,
            integrations=[
                FastApiIntegration(transaction_style="endpoint"),
                SqlalchemyIntegration(),
            ],
            traces_sample_rate=0.1,
            profiles_sample_rate=0.1,
        )
        logger.info("Sentry initialized", environment=settings.ENVIRONMENT)

    if settings.SECRET_KEY in _DEFAULT_KEYS:
        if settings.ENVIRONMENT == "production":
            raise RuntimeError(
                "SECRET_KEY is set to the default value. "
                "Set a secure random SECRET_KEY before running in production. "
                "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
            )
        elif settings.ENVIRONMENT not in ("test", "development"):
            logger.warning("SECRET_KEY is default — do not use in production")

    Base.metadata.create_all(bind=app_engine)
    logger.info("Schema ready")
    setup_metrics(app)
    logger.info("Metrics endpoint available at /metrics")
    yield
    logger.info("QuerySense shutting down")


app = FastAPI(
    title="QuerySense API",
    description="AI-Powered Database Query Optimizer",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── Middleware ────────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_handler)
app.add_exception_handler(Exception, global_error_handler)
app.add_middleware(RequestIDMiddleware)
_cors_origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
_wildcard = _cors_origins == ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=not _wildcard,  # credentials header incompatible with wildcard
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routes ────────────────────────────────────────────────────────────────────
app.include_router(queries_router,   prefix="/api/v1/queries",   tags=["queries"])
app.include_router(benchmark_router, prefix="/api/v1/benchmark", tags=["benchmark"])
app.include_router(indexes_router,   prefix="/api/v1/indexes",   tags=["indexes"])
app.include_router(cicd_router,      prefix="/api/v1/ci",        tags=["ci"])
app.include_router(stream_router,    prefix="/api/v1/stream",    tags=["stream"])
app.include_router(agent_router,     prefix="/api/v1/agent",     tags=["agent"])
app.include_router(slack_router,     prefix="/api/v1/slack",     tags=["slack"])
app.include_router(vision_router,      prefix="/api/v1/vision",      tags=["vision"])
app.include_router(memory_router,      prefix="/api/v1/memory",      tags=["memory"])
app.include_router(auth_router,        prefix="/api/v1/auth",         tags=["auth"])
app.include_router(connections_router, prefix="/api/v1/connections",  tags=["connections"])
app.include_router(demo_router,        prefix="/api/v1/demo",          tags=["demo"])


# ── WebSocket ─────────────────────────────────────────────────────────────────
@app.websocket("/ws/{room}")
async def websocket_endpoint(websocket: WebSocket, room: str = "global"):
    await ws_manager.connect(websocket, room)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, room)


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health", tags=["system"])
async def health():
    return {
        "status": "ok",
        "version": "1.0.0",
        "environment": settings.ENVIRONMENT,
        "ai_configured": bool(settings.OPENROUTER_API_KEY),
        "slack_enabled": settings.SLACK_ALERTS_ENABLED,
    }


@app.get("/health/deep", tags=["system"])
async def health_deep():
    return await deep_health_check()
