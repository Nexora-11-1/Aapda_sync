"""
WebSocket hub for live dashboard updates (§5, §21).

Design constraints that shaped this:

  · **Backpressure kills dashboards.** A client on a bad rural link must not
    slow the risk engine down. Each connection has a bounded outbox; when it
    fills, the *oldest* messages are dropped and a `gap` notice is sent, so a
    slow client degrades to fewer updates rather than stalling the publisher.
  · **Topic subscriptions, not a firehose.** A district operator watching
    Chamoli should not receive Assam's traffic. Clients subscribe to topics
    (`risk:UT-CHAMOLI`, `shelters`, `alerts`, `roads`) and receive only those.
  · **Redis pub/sub underneath.** Multiple API replicas behind a load balancer
    must all deliver an event raised by whichever worker computed it. The
    in-process path is a fallback for single-node deployments.
  · **Every payload states its own freshness.** A message carries the
    `computed_at` of what it describes, so a dashboard that has been
    disconnected can tell stale from live on reconnect rather than assuming.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket

from app.config import settings

log = logging.getLogger(__name__)

OUTBOX_LIMIT = 256
CHANNEL = "aapdasync:events"


@dataclass(slots=True)
class Client:
    ws: WebSocket
    topics: set[str] = field(default_factory=set)
    outbox: deque[str] = field(default_factory=lambda: deque(maxlen=OUTBOX_LIMIT))
    dropped: int = 0
    operator_id: str = "anonymous"
    task: asyncio.Task | None = None

    def wants(self, topic: str) -> bool:
        if not self.topics:
            return True
        return topic in self.topics or any(
            topic.startswith(t.rstrip("*")) for t in self.topics if t.endswith("*"))


class Hub:
    def __init__(self, redis_url: str | None = None):
        self.clients: set[Client] = set()
        self.redis_url = redis_url
        self._redis = None
        self._listener: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    # ── lifecycle ─────────────────────────────────────────────────────
    async def start(self) -> None:
        if not self.redis_url:
            log.info("hub running in single-node mode (no Redis)")
            return
        try:
            import redis.asyncio as aioredis
            self._redis = aioredis.from_url(self.redis_url, decode_responses=True)
            await self._redis.ping()
            self._listener = asyncio.create_task(self._listen())
            log.info("hub connected to Redis pub/sub")
        except Exception as exc:                       # noqa: BLE001
            log.warning("Redis unavailable (%s); falling back to single-node mode", exc)
            self._redis = None

    async def stop(self) -> None:
        if self._listener:
            self._listener.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._listener
        if self._redis:
            await self._redis.aclose()
        for c in list(self.clients):
            await self.disconnect(c)

    async def _listen(self) -> None:
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(CHANNEL)
        async for message in pubsub.listen():
            if message.get("type") != "message":
                continue
            try:
                envelope = json.loads(message["data"])
            except (json.JSONDecodeError, TypeError):
                continue
            await self._fanout(envelope["topic"], message["data"])

    # ── connections ───────────────────────────────────────────────────
    async def connect(self, ws: WebSocket, topics: Iterable[str] = (),
                      operator_id: str = "anonymous") -> Client:
        await ws.accept()
        client = Client(ws=ws, topics=set(topics), operator_id=operator_id)
        async with self._lock:
            self.clients.add(client)
        client.task = asyncio.create_task(self._pump(client))
        await self._send_now(client, {
            "type": "connected",
            "topics": sorted(client.topics) or ["*"],
            "server_time": datetime.now(UTC).isoformat(),
            "note": "Risk values are AI-based decision support. Official warnings "
                    "arrive on the 'alerts' topic with their issuing authority.",
        })
        return client

    async def disconnect(self, client: Client) -> None:
        async with self._lock:
            self.clients.discard(client)
        if client.task:
            client.task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await client.task
        with contextlib.suppress(Exception):
            await client.ws.close()

    # ── publishing ────────────────────────────────────────────────────
    async def publish(self, topic: str, payload: dict[str, Any]) -> int:
        envelope = json.dumps({
            "topic": topic,
            "at": datetime.now(UTC).isoformat(),
            "payload": payload,
        }, default=str)
        if self._redis is not None:
            await self._redis.publish(CHANNEL, envelope)
            return len(self.clients)
        return await self._fanout(topic, envelope)

    async def _fanout(self, topic: str, envelope: str) -> int:
        sent = 0
        for client in list(self.clients):
            if not client.wants(topic):
                continue
            if len(client.outbox) == client.outbox.maxlen:
                client.dropped += 1                # deque discards the oldest
            client.outbox.append(envelope)
            sent += 1
        return sent

    async def _pump(self, client: Client) -> None:
        """One writer per client. A slow socket blocks only its own outbox."""
        try:
            while True:
                if not client.outbox:
                    await asyncio.sleep(0.05)
                    continue
                message = client.outbox.popleft()
                await client.ws.send_text(message)
                if client.dropped and not client.outbox:
                    await self._send_now(client, {
                        "type": "gap",
                        "dropped": client.dropped,
                        "detail": "This connection fell behind and older updates were "
                                  "discarded. Reload for the current picture.",
                    })
                    client.dropped = 0
        except asyncio.CancelledError:
            raise
        except Exception as exc:                       # noqa: BLE001
            log.debug("client pump ended: %s", exc)
            await self.disconnect(client)

    @staticmethod
    async def _send_now(client: Client, payload: dict) -> None:
        with contextlib.suppress(Exception):
            await client.ws.send_text(json.dumps(
                {"topic": "system", "at": datetime.now(UTC).isoformat(), "payload": payload},
                default=str))

    # ── typed events the engines raise ────────────────────────────────
    async def risk_updated(self, district: str, cells: list[dict], computed_at: datetime):
        return await self.publish(f"risk:{district}", {
            "type": "risk_update", "district": district, "cells": cells,
            "computed_at": computed_at.isoformat(),
        })

    async def priorities_updated(self, district: str, zones: list[dict], stats: dict):
        return await self.publish(f"priority:{district}", {
            "type": "priority_update", "district": district, "zones": zones, "stats": stats,
        })

    async def alert_received(self, alert: dict):
        return await self.publish("alerts", {"type": "government_alert", "alert": alert})

    async def shelter_updated(self, shelter: dict):
        return await self.publish("shelters", {"type": "shelter_status", "shelter": shelter})

    async def road_updated(self, road: dict):
        return await self.publish("roads", {"type": "road_status", "road": road})

    async def source_health(self, sources: list[dict]):
        return await self.publish("system", {"type": "source_health", "sources": sources})


# The URL is configured in docker-compose and .env; instantiating the singleton
# without it is why cross-process fanout never ran. An API replica and the
# worker are separate processes: without Redis, an event published by the
# worker reaches no connected client at all.
hub = Hub(settings.redis_url)
