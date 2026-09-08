"""
FastAPI application entry point.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.database import engine, Base
from app.middleware import CatchUnhandledErrors
from app.routes import documents, progress, chat, auth

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("docprocessor")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle: create tables on startup."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Create upload directory
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    yield
    await engine.dispose()


app = FastAPI(
    title="DocProcessor API",
    description="Async Document Processing Workflow System",
    version="1.0.0",
    lifespan=lifespan,
)

# --- Middleware ---
# NOTE: middleware added last runs outermost, so CORS must be added *after*
# CatchUnhandledErrors for error responses to carry CORS headers.
app.add_middleware(CatchUnhandledErrors)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Routers ---
app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(progress.router)
app.include_router(chat.router)


@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "docprocessor"}


def _describe(exc: Exception) -> str:
    return f"error: {type(exc).__name__}: {str(exc)[:200]}"


def _check_redis() -> str:
    try:
        import redis

        client = redis.Redis.from_url(
            settings.REDIS_URL, socket_connect_timeout=5, socket_timeout=5
        )
        try:
            client.ping()
        finally:
            client.close()
        return "ok"
    except Exception as exc:
        return _describe(exc)


def _check_broker() -> str:
    try:
        from app.worker.celery_app import celery_app

        with celery_app.connection() as conn:
            conn.ensure_connection(max_retries=1, timeout=5)
        return "ok"
    except Exception as exc:
        return _describe(exc)


@app.get("/api/health/deep")
async def deep_health_check():
    """Check each external dependency so a broken deploy can be pinpointed."""
    checks: dict[str, str] = {}

    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = _describe(exc)

    # These clients are blocking, so keep them off the event loop.
    checks["redis"] = await run_in_threadpool(_check_redis)
    checks["celery_broker"] = await run_in_threadpool(_check_broker)

    healthy = all(v == "ok" for v in checks.values())
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={"status": "healthy" if healthy else "degraded", "checks": checks},
    )
