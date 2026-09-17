"""
Pipeline worker.

Runs the ingestion and analysis loops in a process of its own, separate from
the API. One worker, not one per API replica: every replica running its own
scheduler would multiply each external call by the replica count, which is
how a platform gets rate-limited by IMD on the day it matters most.

Shuts down cleanly on SIGTERM so an orchestrated rolling restart does not
abandon a half-written tick.
"""
from __future__ import annotations

import asyncio
import logging
import signal

from app.config import settings
from app.core.logging import configure_logging
from app.db.session import dispose
from app.orchestrator import Orchestrator
from app.ws.hub import hub

log = logging.getLogger(__name__)


async def main() -> None:
    configure_logging()
    log.info("pipeline worker starting (%s, district set %s)",
             settings.environment, settings.mvp_district_codes)

    await hub.start()
    orchestrator = Orchestrator()
    task = asyncio.create_task(orchestrator.run_forever())

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    await stop.wait()
    log.info("shutdown signal received; finishing the current tick")

    task.cancel()
    try:
        await asyncio.wait_for(task, timeout=30)
    except (asyncio.CancelledError, TimeoutError):
        pass

    await hub.stop()
    await dispose()
    log.info("pipeline worker stopped")


if __name__ == "__main__":
    asyncio.run(main())
