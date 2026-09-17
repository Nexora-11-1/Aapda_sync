"""
Event-driven recomputation (§5, §10).

The honest position on "real time"
──────────────────────────────────
This platform cannot be faster than the authorities it reads. IMD publishes on
its own cadence; CWC's gauges report when they report. What the platform *can*
guarantee — and what this module enforces — is **zero added latency**: the
moment a fact arrives, it is processed and on every open dashboard, rather than
waiting for the next scheduled tick.

Two paths achieve that:

  1. **Push ingress.** An authority, a field device or an SDMA integration can
     POST an event to `/api/ingest/event`. It is validated, stored, and triggers
     an immediate recompute of the affected district. Latency from POST to
     dashboard is a few hundred milliseconds.

  2. **Write-through triggers.** Every operator write — a shelter status, a road
     closure, a verified citizen report — schedules an immediate recompute of
     its district instead of waiting up to 15 minutes. A road reported blocked
     at 16:18 changes the evacuation routes at 16:18.

Polling remains as the floor, not the mechanism: it is what catches the sources
that offer no push at all. Its cadence is per-source and as tight as each
source's own rate limit permits.

Coalescing
──────────
Ten road closures arriving in the same second must not run ten full district
recomputes. `RecomputeBus` coalesces by (district, hazard) inside a short
debounce window, so a burst produces one recompute carrying all of it. The
window is deliberately short (default 800 ms) — long enough to batch a burst,
short enough that no operator perceives it.

Backpressure
────────────
A recompute that is already running is not queued twice; the bus marks the key
dirty and re-runs once the in-flight pass finishes. Under sustained load the
system degrades to "recompute continuously", which is the correct behaviour,
rather than to an unbounded queue.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum

log = logging.getLogger(__name__)

DEBOUNCE_SECONDS = 0.8
MAX_CONCURRENT_RECOMPUTES = 3


class Trigger(str, Enum):
    """Why a recompute was requested. Carried through to the dashboard so an
    operator can see what moved the numbers."""
    SCHEDULED = "scheduled"
    OFFICIAL_ALERT = "official_alert"
    OBSERVATION = "observation"
    SHELTER_STATUS = "shelter_status"
    ROAD_STATUS = "road_status"
    FIELD_REPORT = "field_report"
    PUSH_INGRESS = "push_ingress"
    OPERATOR_REQUEST = "operator_request"


@dataclass(slots=True)
class RecomputeRequest:
    district: str
    hazard: str
    trigger: Trigger
    detail: str = ""
    requested_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    @property
    def key(self) -> tuple[str, str]:
        return (self.district, self.hazard)


@dataclass(slots=True)
class _Pending:
    request: RecomputeRequest
    triggers: set[Trigger] = field(default_factory=set)
    count: int = 0
    first_seen: float = field(default_factory=time.monotonic)


class RecomputeBus:
    """Coalescing, debounced, back-pressured recompute scheduler."""

    def __init__(self, runner: Callable[[RecomputeRequest], Awaitable[None]],
                 *, debounce_s: float = DEBOUNCE_SECONDS,
                 max_concurrent: int = MAX_CONCURRENT_RECOMPUTES):
        self.runner = runner
        self.debounce_s = debounce_s
        self._pending: dict[tuple[str, str], _Pending] = {}
        self._inflight: set[tuple[str, str]] = set()
        self._dirty: set[tuple[str, str]] = set()
        self._sem = asyncio.Semaphore(max_concurrent)
        self._wake = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._stopped = asyncio.Event()
        self.stats = {"requested": 0, "coalesced": 0, "ran": 0, "failed": 0}

    # ── lifecycle ─────────────────────────────────────────────────────
    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())
            log.info("recompute bus started (debounce %.0f ms)", self.debounce_s * 1000)

    async def stop(self) -> None:
        self._stopped.set()
        self._wake.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    # ── submit ────────────────────────────────────────────────────────
    def request(self, district: str, hazard: str, trigger: Trigger,
                detail: str = "") -> None:
        """Non-blocking. Safe to call from a request handler."""
        req = RecomputeRequest(district, hazard, trigger, detail)
        self.stats["requested"] += 1
        existing = self._pending.get(req.key)
        if existing is not None:
            existing.count += 1
            existing.triggers.add(trigger)
            self.stats["coalesced"] += 1
            # keep the most operationally significant trigger as the headline
            if _severity(trigger) > _severity(existing.request.trigger):
                existing.request = req
        else:
            self._pending[req.key] = _Pending(request=req, triggers={trigger}, count=1)
        self._wake.set()

    def request_all(self, districts, hazards, trigger: Trigger, detail: str = "") -> None:
        for d in districts:
            for h in hazards:
                self.request(d, h, trigger, detail)

    # ── drain loop ────────────────────────────────────────────────────
    async def _loop(self) -> None:
        while not self._stopped.is_set():
            # Sleep only until the earliest pending item's debounce expires,
            # not a fixed second. Waiting a full second on an item that becomes
            # ready in 50 ms is exactly the added latency this bus exists to
            # remove.
            timeout = 1.0
            if self._pending:
                now = time.monotonic()
                soonest = min(p.first_seen for p in self._pending.values())
                timeout = max(self.debounce_s - (now - soonest), 0.005)
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=timeout)
            except TimeoutError:
                pass
            self._wake.clear()

            now = time.monotonic()
            ready = [p for p in self._pending.values()
                     if now - p.first_seen >= self.debounce_s]
            for pending in ready:
                key = pending.request.key
                self._pending.pop(key, None)
                if key in self._inflight:
                    # already running — mark for a follow-up pass rather than
                    # queueing a second concurrent recompute of the same cells
                    self._dirty.add(key)
                    continue
                asyncio.create_task(self._run(pending))

            if not self._pending and not self._inflight and self._dirty:
                for key in list(self._dirty):
                    self._dirty.discard(key)
                    self.request(key[0], key[1], Trigger.SCHEDULED, "follow-up pass")

    async def _run(self, pending: _Pending) -> None:
        key = pending.request.key
        self._inflight.add(key)
        try:
            async with self._sem:
                started = time.perf_counter()
                await self.runner(pending.request)
                self.stats["ran"] += 1
                log.info("recompute %s/%s in %.0f ms — %s (%d event%s coalesced)",
                         key[0], key[1], (time.perf_counter() - started) * 1000,
                         pending.request.trigger.value, pending.count,
                         "" if pending.count == 1 else "s")
        except asyncio.CancelledError:
            raise
        except Exception:                              # noqa: BLE001
            self.stats["failed"] += 1
            log.exception("recompute failed for %s/%s — previous results retained", *key)
        finally:
            self._inflight.discard(key)
            if key in self._dirty:
                self._dirty.discard(key)
                self.request(key[0], key[1], Trigger.SCHEDULED, "follow-up pass")

    # ── introspection, exposed on /api/stats ──────────────────────────
    def snapshot(self) -> dict:
        return {
            **self.stats,
            "pending": len(self._pending),
            "inflight": len(self._inflight),
            "dirty": len(self._dirty),
            "debounce_ms": int(self.debounce_s * 1000),
            "coalescing_ratio": (round(self.stats["coalesced"] /
                                       max(self.stats["requested"], 1), 3)),
        }


def _severity(t: Trigger) -> int:
    return {
        Trigger.OFFICIAL_ALERT: 5,
        Trigger.PUSH_INGRESS: 4,
        Trigger.ROAD_STATUS: 3,
        Trigger.SHELTER_STATUS: 3,
        Trigger.FIELD_REPORT: 2,
        Trigger.OBSERVATION: 2,
        Trigger.OPERATOR_REQUEST: 2,
        Trigger.SCHEDULED: 1,
    }.get(t, 0)


# ── the process-wide bus, wired by the orchestrator at startup ────────
bus: RecomputeBus | None = None


def set_bus(b: RecomputeBus) -> None:
    global bus
    bus = b


def trigger(district: str | None, hazard: str | None, t: Trigger, detail: str = "") -> bool:
    """Fire a recompute from anywhere. Returns False if no bus is running
    (for example in the API process when the worker owns the pipeline) — the
    caller then relies on the worker's own Redis subscription instead."""
    if bus is None:
        return False
    from app.config import settings
    districts = [district] if district else settings.mvp_district_codes
    hazards = [hazard] if hazard else settings.mvp_hazards
    bus.request_all(districts, hazards, t, detail)
    return True
