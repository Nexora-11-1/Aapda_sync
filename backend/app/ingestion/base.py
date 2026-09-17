"""
The connector contract (§4).

    fetch() → validate() → normalize() → transform() → store()

Five rules this module enforces so that no individual connector has to
remember them:

  1. One failed external API never takes down the platform (§28). Every stage
     is wrapped; failure produces a `RunResult` with `ok=False`, not an
     exception that escapes into the scheduler.
  2. Every record that reaches the database carries full provenance:
     source, source_id, observed_at, ingested_at, confidence, quality.
  3. Stale is never presented as live. A source that has not produced a fresh
     record within its staleness window is marked STALE and every consumer of
     it is told (§28).
  4. Credentialed sources with no credential resolve to NOT_CONFIGURED. They
     do not attempt a call, and they do not invent a response.
  5. Retries are bounded, jittered, and give up. A circuit opens after
     repeated failure so a dead source stops costing latency.
"""
from __future__ import annotations

import abc
import asyncio
import dataclasses
import logging
import random
import time
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any, Generic, TypeVar

import httpx

from app.config import AccessMode, SourceConfig, settings

log = logging.getLogger(__name__)

RawT = TypeVar("RawT")
NormT = TypeVar("NormT")


# ══════════════════════════════════════════════════════════════════════
# Result types
# ══════════════════════════════════════════════════════════════════════
class SourceState(str):
    LIVE = "live"
    DEGRADED = "degraded"
    STALE = "stale"
    FAILED = "failed"
    NOT_CONFIGURED = "not_configured"


@dataclasses.dataclass(slots=True)
class Provenance:
    """Attached to every normalised record before it is stored (§4)."""
    source: str
    source_id: str | None
    observed_at: datetime
    ingested_at: datetime
    confidence: float
    quality: str = "good"

    def as_dict(self) -> dict[str, Any]:
        return dataclasses.asdict(self)


@dataclasses.dataclass(slots=True)
class ValidationIssue:
    field: str
    reason: str
    value: Any = None


@dataclasses.dataclass(slots=True)
class RunResult:
    source_key: str
    ok: bool
    state: str
    started_at: datetime
    finished_at: datetime
    fetched: int = 0
    stored: int = 0
    rejected: int = 0
    reject_reasons: dict[str, int] = dataclasses.field(default_factory=dict)
    quality_score: float | None = None
    http_status: int | None = None
    error: str | None = None

    @property
    def duration_ms(self) -> int:
        return int((self.finished_at - self.started_at).total_seconds() * 1000)


class SourceUnavailable(Exception):
    """Raised by fetch() when the source cannot be reached or is not configured.

    This is an expected condition, not a bug. The runner converts it into a
    RunResult and the platform carries on with its last valid observation.
    """
    def __init__(self, source_key: str, reason: str, state: str = SourceState.FAILED):
        self.source_key, self.reason, self.state = source_key, reason, state
        super().__init__(f"{source_key}: {reason}")


# ══════════════════════════════════════════════════════════════════════
# Circuit breaker — stops a dead source costing latency on every tick
# ══════════════════════════════════════════════════════════════════════
class CircuitBreaker:
    def __init__(self, threshold: int = 5, cooldown_s: int = 300):
        self.threshold, self.cooldown_s = threshold, cooldown_s
        self.failures = 0
        self.opened_at: float | None = None

    @property
    def open(self) -> bool:
        if self.opened_at is None:
            return False
        if time.monotonic() - self.opened_at >= self.cooldown_s:
            self.opened_at = None      # half-open: allow one probe through
            self.failures = self.threshold - 1
            return False
        return True

    def record_success(self) -> None:
        self.failures = 0
        self.opened_at = None

    def record_failure(self) -> None:
        self.failures += 1
        if self.failures >= self.threshold and self.opened_at is None:
            self.opened_at = time.monotonic()


# ══════════════════════════════════════════════════════════════════════
# The connector
# ══════════════════════════════════════════════════════════════════════
class DataConnector(abc.ABC, Generic[RawT, NormT]):
    """Base class for every ingestion connector.

    Subclasses implement `fetch`, `validate`, `normalize` and `store`.
    `transform` is optional and defaults to identity — it exists for sources
    that need unit conversion or reprojection between normalise and store.
    """

    #: must match a key in docs/10-data-sources.md
    source_key: str
    #: what this connector produces, for the scheduler's benefit
    produces: str = "observations"

    def __init__(self, config: SourceConfig | None = None, client: httpx.AsyncClient | None = None):
        self.config = config or settings.source(self.source_key)
        self._client = client
        self._owns_client = client is None
        self.breaker = CircuitBreaker()
        self._last_success: datetime | None = None

    # ── plumbing ──────────────────────────────────────────────────────
    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self.config.timeout_seconds),
                headers={"User-Agent": f"AapdaSync/0.1 (+disaster-decision-support; {self.source_key})"},
                follow_redirects=True,
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None and self._owns_client:
            await self._client.aclose()
            self._client = None

    def url(self, path: str) -> str:
        """Join a path onto the *configured* base URL.

        There is no default base URL. If configuration has not supplied one the
        connector is not configured, and this raises rather than guessing.
        """
        if not self.config.base_url:
            raise SourceUnavailable(
                self.source_key,
                f"no base_url configured — set AAPDA_SOURCE_{self.source_key.upper()}_BASE_URL",
                SourceState.NOT_CONFIGURED,
            )
        return f"{self.config.base_url.rstrip('/')}/{path.lstrip('/')}"

    # ── the five stages ───────────────────────────────────────────────
    @abc.abstractmethod
    async def fetch(self) -> Sequence[RawT]:
        """Retrieve raw payloads. Raise SourceUnavailable if it cannot."""

    @abc.abstractmethod
    def validate(self, raw: RawT) -> list[ValidationIssue]:
        """Return the reasons this record is unusable. Empty list = usable."""

    @abc.abstractmethod
    def normalize(self, raw: RawT) -> NormT:
        """Convert one raw payload into the platform's schema."""

    def transform(self, record: NormT) -> NormT:
        """Optional post-normalisation step (units, reprojection, derivations)."""
        return record

    @abc.abstractmethod
    async def store(self, records: Sequence[NormT]) -> int:
        """Persist. Must be idempotent — upsert on (source, source_id, observed_at)."""

    # ── confidence and quality ────────────────────────────────────────
    def base_confidence(self) -> float:
        """How much we trust this source before looking at the record.

        Primary authority > public supplementary > crowd-sourced. A connector
        may override to fold in per-record quality flags.
        """
        if self.config.access is AccessMode.MANUAL:
            return 0.70
        return 0.95 if self.config.is_primary else 0.80

    def provenance(self, source_id: str | None, observed_at: datetime,
                   confidence: float | None = None, quality: str = "good") -> Provenance:
        now = datetime.now(UTC)
        if observed_at.tzinfo is None:
            observed_at = observed_at.replace(tzinfo=UTC)
        age = (now - observed_at).total_seconds()
        if quality == "good" and age > self.config.staleness_seconds:
            quality = "stale"
        return Provenance(
            source=self.source_key,
            source_id=source_id,
            observed_at=observed_at,
            ingested_at=now,
            confidence=round(confidence if confidence is not None else self.base_confidence(), 3),
            quality=quality,
        )

    def score_run(self, fetched: int, stored: int, rejected: int) -> float:
        """data_quality_score for this run (§26). Completeness × acceptance."""
        if fetched == 0:
            return 0.0
        acceptance = stored / max(fetched, 1)
        rejection_penalty = min(rejected / max(fetched, 1), 1.0) * 0.5
        return round(max(0.0, min(1.0, acceptance - rejection_penalty)), 3)

    # ── retry with jitter ─────────────────────────────────────────────
    async def with_retry(self, coro_factory, *, what: str = "request"):
        last: Exception | None = None
        for attempt in range(1, self.config.max_retries + 1):
            try:
                return await coro_factory()
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last = exc
                if attempt == self.config.max_retries:
                    break
                backoff = min(2 ** attempt, 30) + random.uniform(0, 0.75)
                log.warning("%s %s attempt %d/%d failed (%s); retrying in %.1fs",
                            self.source_key, what, attempt, self.config.max_retries,
                            exc.__class__.__name__, backoff)
                await asyncio.sleep(backoff)
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                # 4xx other than 429 will not fix themselves — do not retry
                if status != 429 and 400 <= status < 500:
                    raise SourceUnavailable(
                        self.source_key, f"HTTP {status} on {what}", SourceState.FAILED
                    ) from exc
                last = exc
                if attempt == self.config.max_retries:
                    break
                retry_after = exc.response.headers.get("Retry-After")
                backoff = float(retry_after) if (retry_after or "").isdigit() else min(2 ** attempt, 60)
                await asyncio.sleep(backoff + random.uniform(0, 0.75))
        raise SourceUnavailable(
            self.source_key, f"{what} failed after {self.config.max_retries} attempts: {last}",
            SourceState.FAILED,
        )

    # ── the run loop ──────────────────────────────────────────────────
    async def run(self) -> RunResult:
        """Execute one full ingestion cycle. Never raises."""
        started = datetime.now(UTC)

        def result(**kw) -> RunResult:
            return RunResult(source_key=self.source_key, started_at=started,
                             finished_at=datetime.now(UTC), **kw)

        if not self.config.enabled:
            return result(ok=True, state=SourceState.NOT_CONFIGURED, error="disabled by configuration")

        if not self.config.configured:
            return result(
                ok=False, state=SourceState.NOT_CONFIGURED,
                error=f"{self.source_key} requires credentials that are not configured "
                      f"({self.config.notes or 'see docs/10-data-sources.md'})",
            )

        if self.breaker.open:
            return result(ok=False, state=SourceState.FAILED,
                          error="circuit open after repeated failures; cooling down")

        try:
            raws = await self.fetch()
        except SourceUnavailable as exc:
            self.breaker.record_failure()
            return result(ok=False, state=exc.state, error=exc.reason)
        except Exception as exc:                      # noqa: BLE001 — containment is the point
            self.breaker.record_failure()
            log.exception("%s fetch raised", self.source_key)
            return result(ok=False, state=SourceState.FAILED, error=f"unhandled: {exc!r}")

        records: list[NormT] = []
        rejected, reasons = 0, {}
        for raw in raws:
            issues = self.validate(raw)
            if issues:
                rejected += 1
                for i in issues:
                    reasons[i.reason] = reasons.get(i.reason, 0) + 1
                continue
            try:
                records.append(self.transform(self.normalize(raw)))
            except Exception as exc:                  # noqa: BLE001
                rejected += 1
                reasons[f"normalize_error:{exc.__class__.__name__}"] = \
                    reasons.get(f"normalize_error:{exc.__class__.__name__}", 0) + 1

        try:
            stored = await self.store(records)
        except Exception as exc:                      # noqa: BLE001
            self.breaker.record_failure()
            log.exception("%s store raised", self.source_key)
            return result(ok=False, state=SourceState.FAILED, fetched=len(raws),
                          rejected=rejected, reject_reasons=reasons,
                          error=f"store failed: {exc!r}")

        self.breaker.record_success()
        self._last_success = datetime.now(UTC)
        score = self.score_run(len(raws), stored, rejected)
        state = SourceState.LIVE if score >= 0.8 else SourceState.DEGRADED
        if stored == 0 and len(raws) > 0:
            state = SourceState.DEGRADED
        return result(ok=True, state=state, fetched=len(raws), stored=stored,
                      rejected=rejected, reject_reasons=reasons, quality_score=score)

    # ── staleness ─────────────────────────────────────────────────────
    def is_stale(self, now: datetime | None = None) -> bool:
        if self._last_success is None:
            return True
        now = now or datetime.now(UTC)
        return (now - self._last_success) > timedelta(seconds=self.config.staleness_seconds)


# ══════════════════════════════════════════════════════════════════════
# Registry — connectors announce themselves, the scheduler discovers them
# ══════════════════════════════════════════════════════════════════════
_REGISTRY: dict[str, type[DataConnector]] = {}


def register(cls: type[DataConnector]) -> type[DataConnector]:
    if not getattr(cls, "source_key", None):
        raise TypeError(f"{cls.__name__} must define source_key")
    _REGISTRY[cls.source_key] = cls
    return cls


def registry() -> dict[str, type[DataConnector]]:
    return dict(_REGISTRY)


def build(source_key: str, **kw) -> DataConnector:
    if source_key not in _REGISTRY:
        raise KeyError(f"No connector registered for {source_key!r}")
    return _REGISTRY[source_key](**kw)
