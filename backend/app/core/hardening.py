"""
Security hardening.

Threat model, briefly. This platform is public-facing (the citizen portal),
carries an authenticated operator surface that changes evacuation decisions, and
ingests data from third parties. The realistic attacks are:

  · a scraper or a botnet exhausting the API during an event, when it matters
  · a compromised or malicious field-operator token altering road state to
    divert an evacuation
  · an operator reading or writing outside their district or shelter
  · injection through free-text report fields into the operator dashboard
  · a spoofed push-ingress event fabricating an alert

Each has a control below. What this module does **not** try to do is authorise
business rules — that lives in `core/security.py`, next to the roles.
"""
from __future__ import annotations

import hmac
import logging
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass

from fastapi import HTTPException, Request, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from app.config import settings

log = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════
# Boot-time configuration checks — refuse to start unsafe
# ══════════════════════════════════════════════════════════════════════
INSECURE_SECRETS = {
    "change-me-in-production", "change-me", "secret", "changeme",
    "development", "test", "aapda", "",
}


def verify_configuration() -> list[str]:
    """Fatal in prod, warnings elsewhere.

    A platform that boots happily with a default JWT secret is a platform where
    anyone can mint a district-operator token.
    """
    problems: list[str] = []

    if settings.jwt_secret.strip().lower() in INSECURE_SECRETS:
        problems.append(
            "AAPDA_JWT_SECRET is a default or empty value. Generate one with "
            "`openssl rand -base64 48`.")
    elif len(settings.jwt_secret) < 32:
        problems.append("AAPDA_JWT_SECRET is shorter than 32 characters.")

    if settings.environment == "prod":
        if settings.debug:
            problems.append("debug is enabled in a production environment.")
        if any(o in ("*", "http://localhost:3000") for o in settings.cors_origins):
            problems.append(
                f"cors_origins is {settings.cors_origins!r} in production. "
                "Set AAPDA_CORS_ORIGINS to the real origin.")
        if "://localhost" in settings.database_url or "@localhost" in settings.database_url:
            problems.append("database_url points at localhost in production.")

    if settings.environment == "prod" and problems:
        raise RuntimeError(
            "Refusing to start with an unsafe configuration:\n  - "
            + "\n  - ".join(problems))
    for p in problems:
        log.warning("configuration: %s", p)
    return problems


# ══════════════════════════════════════════════════════════════════════
# Rate limiting — token bucket per client, per route class
# ══════════════════════════════════════════════════════════════════════
@dataclass(slots=True)
class Limit:
    requests: int
    window_s: int


# Public reads are generous — during an event a district's whole population may
# be refreshing the citizen portal, and rate-limiting them off the shelter list
# would be the actual harm. Writes are tight, because a write changes an
# evacuation decision.
LIMITS: dict[str, Limit] = {
    "public_read":   Limit(300, 60),
    "auth":          Limit(10, 300),      # brute-force resistance
    "operator_write": Limit(60, 60),
    "citizen_report": Limit(5, 300),      # per client, spam control
    "push_ingress":  Limit(600, 60),
    "default":       Limit(120, 60),
}


def _classify(request: Request) -> str:
    path, method = request.url.path, request.method
    if path.endswith("/auth/login"):
        return "auth"
    if path.endswith("/ingest/event"):
        return "push_ingress"
    if path.endswith("/reports") and method == "POST":
        return "citizen_report"
    if method in ("POST", "PATCH", "PUT", "DELETE"):
        return "operator_write"
    if method == "GET":
        return "public_read"
    return "default"


class SlidingWindowLimiter:
    """In-process sliding window.

    Deliberately in-process and not Redis-backed: a limiter that fails closed
    when Redis blips would take the platform down during exactly the incident it
    exists to survive. With N replicas the effective limit is N × the configured
    value, which is documented and acceptable — this is abuse control, not
    quota enforcement.
    """

    def __init__(self):
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._last_sweep = time.monotonic()

    def check(self, client: str, bucket: str) -> tuple[bool, int, int]:
        limit = LIMITS.get(bucket, LIMITS["default"])
        now = time.monotonic()
        key = (client, bucket)
        hits = self._hits[key]

        cutoff = now - limit.window_s
        while hits and hits[0] < cutoff:
            hits.popleft()

        if now - self._last_sweep > 300:
            self._sweep(now)

        if len(hits) >= limit.requests:
            retry_after = int(hits[0] + limit.window_s - now) + 1
            return False, 0, max(retry_after, 1)

        hits.append(now)
        return True, limit.requests - len(hits), limit.window_s

    def _sweep(self, now: float) -> None:
        """Drop buckets whose entries have all expired.

        Sweeping only *empty* deques is not enough: a client that made one
        request an hour ago still holds a live entry until it is touched again,
        so the map grows one entry per address seen, forever. During a national
        event that is millions of addresses. This prunes by age instead.
        """
        self._last_sweep = now
        for key in list(self._hits):
            window = LIMITS.get(key[1], LIMITS["default"]).window_s
            hits = self._hits[key]
            cutoff = now - window
            while hits and hits[0] < cutoff:
                hits.popleft()
            if not hits:
                self._hits.pop(key, None)


limiter = SlidingWindowLimiter()


def client_key(request: Request) -> str:
    """Identify the caller.

    An authenticated operator is limited by operator id, so a whole district
    behind one NAT does not share a bucket. Anonymous callers fall back to the
    forwarded address; `X-Forwarded-For` is trusted only because uvicorn runs
    behind a reverse proxy with `--forwarded-allow-ips` set.
    """
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        # cheap, non-verifying discriminator — the token is verified later by
        # the auth dependency; here we only need a stable bucket key
        return "tok:" + hmac.new(settings.jwt_secret.encode(),
                                 auth[7:].encode(), "sha256").hexdigest()[:32]
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return "ip:" + fwd.split(",")[0].strip()
    return "ip:" + (request.client.host if request.client else "unknown")


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path in ("/healthz", "/readyz", "/metrics"):
            return await call_next(request)

        bucket = _classify(request)
        ok, remaining, retry_after = limiter.check(client_key(request), bucket)
        if not ok:
            log.warning("rate limit hit: %s %s bucket=%s", request.method,
                        request.url.path, bucket)
            return JSONResponse(
                {"detail": "Too many requests. Slow down and try again shortly.",
                 "retry_after_seconds": retry_after},
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                headers={"Retry-After": str(retry_after)})

        response = await call_next(request)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response


# ══════════════════════════════════════════════════════════════════════
# Response headers
# ══════════════════════════════════════════════════════════════════════
# The dashboard is self-hosted and loads only its own assets plus Google Fonts;
# 'unsafe-inline' is required for the styles the map generates at runtime and is
# scoped to style-src only, never script-src.
CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com data:; "
    "img-src 'self' data: blob:; "
    "connect-src 'self' ws: wss:; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "object-src 'none'"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = (
            "geolocation=(self), camera=(), microphone=(), payment=()")
        response.headers["Content-Security-Policy"] = CSP
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        if settings.environment == "prod":
            response.headers["Strict-Transport-Security"] = \
                "max-age=63072000; includeSubDomains; preload"
        # never let a browser or CDN cache an operational figure
        if request.url.path.startswith(settings.api_prefix):
            response.headers["Cache-Control"] = "no-store, private"
        return response


# ══════════════════════════════════════════════════════════════════════
# Request body size cap
# ══════════════════════════════════════════════════════════════════════
MAX_BODY_BYTES = 256 * 1024        # a CAP alert is a few KB; 256 KB is generous


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
            return JSONResponse(
                {"detail": f"Request body exceeds {MAX_BODY_BYTES // 1024} KB."},
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        return await call_next(request)


# ══════════════════════════════════════════════════════════════════════
# Push ingress authentication (§4, §20)
# ══════════════════════════════════════════════════════════════════════
def verify_push_signature(body: bytes, signature: str, timestamp: str,
                          shared_secret: str, *, tolerance_s: int = 300) -> None:
    """HMAC-SHA256 over `timestamp.body`, compared in constant time.

    Two properties matter and both are easy to get wrong:

      · **Constant-time comparison.** `==` on a signature leaks its prefix
        through timing and is a genuine forgery path.
      · **Timestamp binding.** Without it a captured valid request can be
        replayed forever. The signature covers the timestamp, and the timestamp
        must be recent, so a captured request expires in five minutes.
    """
    if not shared_secret:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Push ingress is not configured for this deployment.")
    if not signature or not timestamp:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Missing X-AapdaSync-Signature or X-AapdaSync-Timestamp.")
    try:
        sent_at = int(timestamp)
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Malformed timestamp header.") from exc

    drift = abs(time.time() - sent_at)
    if drift > tolerance_s:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            f"Timestamp is {int(drift)}s out of tolerance. Check the sender's clock.")

    expected = hmac.new(shared_secret.encode(),
                        f"{timestamp}.".encode() + body, "sha256").hexdigest()
    if not hmac.compare_digest(expected, signature.strip().lower()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Signature verification failed.")


def new_shared_secret() -> str:
    return secrets.token_urlsafe(48)


# ══════════════════════════════════════════════════════════════════════
# Input sanitation for free text
# ══════════════════════════════════════════════════════════════════════
CONTROL_CHARS = {c: None for c in range(32) if c not in (9, 10, 13)}


def clean_text(value: str | None, *, max_length: int = 2000) -> str | None:
    """Strip control characters and cap length.

    The dashboard escapes on render, which is the real XSS control; this is
    defence in depth and, more practically, stops a report containing a null
    byte or 40 000 zero-width spaces from breaking a table cell.
    """
    if value is None:
        return None
    cleaned = value.translate(CONTROL_CHARS).strip()
    # collapse the zero-width and bidi-override characters used to disguise text
    for ch in ("​", "‌", "‍", "⁠", "﻿",
               "‪", "‫", "‬", "‭", "‮"):
        cleaned = cleaned.replace(ch, "")
    return cleaned[:max_length] or None
