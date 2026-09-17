"""
AapdaSync API service.

Production entry point. Boots the HTTP surface, the WebSocket hub and the
pipeline scheduler, and exposes the three probes an orchestrator needs:

  /healthz   liveness  — is the process alive
  /readyz    readiness — can it serve traffic (DB reachable, grid built)
  /metrics   Prometheus

Readiness deliberately does *not* require every data source to be healthy. A
platform that refuses traffic because IMD is down is worse than one that serves
the last valid observation and says it is stale (§28).
"""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.routes import router
from app.config import settings
from app.core.hardening import (
    BodySizeLimitMiddleware,
    RateLimitMiddleware,
    SecurityHeadersMiddleware,
    verify_configuration,
)
from app.core.logging import configure_logging
from app.core.metrics import (
    HTTP_LATENCY,
    HTTP_REQUESTS,
    WS_CLIENTS,
    render_metrics,
)
from app.db.session import dispose, session_scope
from app.ws.hub import hub

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    # Refuse to start with a default JWT secret or wide-open CORS in prod.
    # A platform that boots happily on defaults is one where anyone can mint a
    # district-operator token.
    verify_configuration()
    log.info("starting %s (%s)", settings.app_name, settings.environment)
    await hub.start()

    scheduler_task: asyncio.Task | None = None
    if not settings.run_scheduler:
        log.info("scheduler disabled for this process (AAPDA_RUN_SCHEDULER=false) — "
                 "serving stored data; the worker owns ingestion and analysis")
    else:
        try:
            from app.orchestrator import Orchestrator
            app.state.orchestrator = Orchestrator()
            scheduler_task = asyncio.create_task(app.state.orchestrator.run_forever())
            log.info("pipeline scheduler started")
        except Exception as exc:                   # noqa: BLE001
            # The API must still serve read traffic even if the scheduler cannot start.
            log.exception("scheduler failed to start; API will serve stored data only: %s", exc)

    yield

    if scheduler_task:
        scheduler_task.cancel()
        try:
            await scheduler_task
        except asyncio.CancelledError:
            pass
    await hub.stop()
    await dispose()
    log.info("shutdown complete")


app = FastAPI(
    title="AapdaSync",
    description=(
        "India-specific real-time multi-disaster risk, exposure and evacuation "
        "decision-support platform. Model output on this API is AI-based risk "
        "prediction and decision support; it is not an official warning. Official "
        "warnings are served on /api/alerts with their issuing authority intact."
    ),
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.environment != "prod" else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.environment != "prod" else None,
)

# Middleware runs outermost-last, so the order below means:
#   security headers → rate limit → body cap → CORS → gzip → route
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-AapdaSync-Signature",
                   "X-AapdaSync-Timestamp"],
    max_age=600,
)
app.add_middleware(BodySizeLimitMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)


@app.middleware("http")
async def observe(request: Request, call_next):
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        HTTP_REQUESTS.labels(request.method, request.url.path, "500").inc()
        raise
    elapsed = time.perf_counter() - start
    route = request.scope.get("route")
    path = getattr(route, "path", request.url.path)
    HTTP_REQUESTS.labels(request.method, path, str(response.status_code)).inc()
    HTTP_LATENCY.labels(request.method, path).observe(elapsed)
    response.headers["X-Response-Time-ms"] = f"{elapsed * 1000:.1f}"
    return response


app.include_router(router, prefix=settings.api_prefix)


# ══════════════════════════════════════════════════════════════════════
# Probes
# ══════════════════════════════════════════════════════════════════════
@app.get("/healthz", include_in_schema=False)
async def healthz():
    return {"status": "ok", "service": settings.app_name, "version": app.version}


@app.get("/readyz", include_in_schema=False)
async def readyz():
    checks: dict[str, str] = {}
    ready = True

    try:
        async with session_scope() as s:
            await s.execute(text("SELECT 1"))
            n = (await s.execute(text("SELECT COUNT(*) FROM spatial_cells"))).scalar_one()
        checks["database"] = "ok"
        checks["grid_cells"] = str(n)
        if n == 0:
            checks["grid"] = "empty — run scripts/build_grid.py"
            ready = False
    except Exception as exc:                       # noqa: BLE001
        checks["database"] = f"unavailable: {exc.__class__.__name__}"
        ready = False

    try:
        async with session_scope() as s:
            degraded = (await s.execute(text("""
                SELECT COUNT(*) FROM data_sources
                WHERE is_primary AND status IN ('failed','stale','not_configured')
            """))).scalar_one()
            newest = (await s.execute(text(
                "SELECT MAX(computed_at) FROM risk_scores"))).scalar_one()
        # Degraded sources are reported, never a reason to fail readiness.
        checks["degraded_primary_sources"] = str(degraded)

        # A stalled pipeline IS a readiness failure. Serving a green endpoint
        # while the numbers behind it are hours old is how a load balancer
        # keeps traffic on a node that has quietly stopped thinking.
        if newest is None:
            checks["pipeline"] = "no result computed yet"
        else:
            from datetime import UTC as _UTC, datetime as _dt
            if newest.tzinfo is None:
                newest = newest.replace(tzinfo=_UTC)
            age = (_dt.now(_UTC) - newest).total_seconds()
            checks["pipeline_age_seconds"] = str(round(age))
            if age > settings.risk_interval_seconds * 6:
                checks["pipeline"] = (
                    f"stalled — no result for {age / 60:.0f} minutes")
                ready = False
            else:
                checks["pipeline"] = "producing"
    except Exception:                              # noqa: BLE001
        checks["degraded_primary_sources"] = "unknown"

    return JSONResponse({"ready": ready, "checks": checks},
                        status_code=200 if ready else 503)


@app.get("/metrics", include_in_schema=False)
async def metrics():
    body, content_type = render_metrics()
    return Response(content=body, media_type=content_type)


# ══════════════════════════════════════════════════════════════════════
# WebSocket (§5, §21)
# ══════════════════════════════════════════════════════════════════════
PUBLIC_TOPICS = {"alerts", "shelters", "system"}


def _scope_topics(requested: list[str], operator) -> tuple[list[str], list[str]]:
    """Anonymous viewers get the public topics only.

    Risk, priority and routing streams are operational and district-scoped —
    an unauthenticated socket subscribing to `priority:UT-CHAMOLI` would leak
    the relocation ranking to anyone who guessed a district code.
    """
    from app.core.security import Role
    if operator.role is Role.ADMIN:
        return requested or ["*"], []
    allowed, denied = [], []
    for t in requested:
        base = t.split(":", 1)[0]
        district = t.split(":", 1)[1] if ":" in t else None
        if base in PUBLIC_TOPICS:
            allowed.append(t)
        elif operator.role is Role.PUBLIC:
            denied.append(t)
        elif district and not operator.may_touch_district(district):
            denied.append(t)
        else:
            allowed.append(t)
    return allowed or sorted(PUBLIC_TOPICS), denied


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, topics: str = Query(""),
                             token: str = Query("")):
    from app.core.security import PUBLIC, Operator, Role, decode_token

    operator = PUBLIC
    if token:
        try:
            claims = decode_token(token)
            operator = Operator(
                operator_id=claims["sub"], full_name=claims.get("name", claims["sub"]),
                role=Role(claims.get("role", "public")),
                district_code=claims.get("district"),
                assigned_shelters=claims.get("shelters") or [])
        except Exception:                              # noqa: BLE001
            await ws.close(code=4401, reason="Invalid or expired token")
            return

    requested = [t.strip() for t in topics.split(",") if t.strip()][:32]
    allowed, denied = _scope_topics(requested, operator)
    if denied:
        log.info("ws topics denied for %s: %s", operator.operator_id, denied)

    client = await hub.connect(ws, allowed, operator_id=operator.operator_id)
    WS_CLIENTS.inc()
    try:
        while True:
            message = await asyncio.wait_for(ws.receive_text(), timeout=120)
            if message == "ping":
                await ws.send_text('{"topic":"system","payload":{"type":"pong"}}')
            elif message.startswith("subscribe:"):
                more = [t.strip() for t in message.split(":", 1)[1].split(",") if t.strip()]
                ok, _ = _scope_topics(more[:32], operator)
                # cap the subscription set so one socket cannot fan itself out
                # across every district in the country
                client.topics.update(list(ok)[:64])
            elif message.startswith("unsubscribe:"):
                for t in message.split(":", 1)[1].split(","):
                    client.topics.discard(t.strip())
    except (WebSocketDisconnect, TimeoutError):
        pass
    except Exception as exc:                       # noqa: BLE001
        log.debug("websocket closed: %s", exc)
    finally:
        WS_CLIENTS.dec()
        await hub.disconnect(client)


@app.get("/", include_in_schema=False)
async def root():
    return {
        "service": settings.app_name,
        "version": app.version,
        "api": settings.api_prefix,
        "websocket": "/ws",
        "attribution": ("AI-based risk prediction and decision support. "
                        "Not an official warning system."),
    }
