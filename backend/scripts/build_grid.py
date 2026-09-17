#!/usr/bin/env python
"""
Build the H3 grid and register the data sources.

    python scripts/build_grid.py [--state UT] [--districts UT-CHAMOLI,...] [--res 7]

Idempotent: safe to re-run after a boundary correction. Existing cells keep
their enrichment; new cells are added.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from sqlalchemy import text

from app.config import DEFAULT_SOURCES, settings
from app.core.logging import configure_logging
from app.db.session import dispose, session_scope
from app.spatial.grid import build_grid, enrich_hydrology

log = logging.getLogger("build_grid")


async def register_sources() -> int:
    """Mirror the configured source register into the database.

    `data_sources` is what the UI reads, so it must agree with configuration
    exactly — including which sources are not configured, and why.
    """
    async with session_scope() as s:
        rows = []
        for key, cfg in DEFAULT_SOURCES.items():
            src = settings.source(key)
            rows.append({
                "key": key,
                "authority": cfg["authority"],
                "access_mode": src.access.value,
                "is_primary": src.is_primary,
                "base_url": src.base_url,
                "docs_url": src.docs_url,
                "status": "not_configured" if not src.configured else "stale",
                "staleness": src.staleness_seconds,
                "notes": src.notes or None,
            })
        await s.execute(text("""
            INSERT INTO data_sources
              (key, authority, access_mode, is_primary, base_url, docs_url,
               status, staleness_threshold_s, notes)
            VALUES (:key, :authority, :access_mode, :is_primary, :base_url, :docs_url,
                    CAST(:status AS source_status), :staleness, :notes)
            ON CONFLICT (key) DO UPDATE SET
              authority = EXCLUDED.authority,
              access_mode = EXCLUDED.access_mode,
              base_url = EXCLUDED.base_url,
              docs_url = EXCLUDED.docs_url,
              staleness_threshold_s = EXCLUDED.staleness_threshold_s,
              notes = EXCLUDED.notes,
              -- never clobber a live status with the boot-time guess
              status = CASE WHEN data_sources.status = 'live'
                            THEN data_sources.status ELSE EXCLUDED.status END,
              updated_at = now()
        """), rows)
        return len(rows)


async def register_weights() -> None:
    """Seed the default priority weight set (§13.2 — weights are data)."""
    import json
    from app.priority.engine import WEIGHTS_V1
    async with session_scope() as s:
        await s.execute(text("""
            INSERT INTO priority_weights (version, weights, created_by, is_active, notes)
            VALUES ('v1', CAST(:w AS jsonb), 'system', TRUE,
                    'Default set. Registering a new version is the only way to change '
                    'weights — editing this row would make past rankings '
                    'unreproducible.')
            ON CONFLICT (version) DO NOTHING
        """), {"w": json.dumps(WEIGHTS_V1)})


async def main() -> int:
    parser = argparse.ArgumentParser(description="Build the AapdaSync H3 grid")
    parser.add_argument("--state", default=settings.mvp_state_code)
    parser.add_argument("--districts", default=",".join(settings.mvp_district_codes))
    parser.add_argument("--res", type=int, default=settings.h3_resolution)
    parser.add_argument("--skip-hydrology", action="store_true")
    args = parser.parse_args()

    configure_logging()
    districts = [d.strip() for d in args.districts.split(",") if d.strip()]

    n_sources = await register_sources()
    log.info("registered %d data sources", n_sources)
    await register_weights()

    try:
        async with session_scope() as s:
            cells = await build_grid(s, district_codes=districts,
                                     state_code=args.state, resolution=args.res)
        log.info("grid: %d cells at resolution %d", cells, args.res)
    except RuntimeError as exc:
        log.error("%s", exc)
        return 2

    if not args.skip_hydrology:
        async with session_scope() as s:
            enriched = await enrich_hydrology(s)
        log.info("hydrology enrichment touched %d cells", enriched)

    async with session_scope() as s:
        summary = (await s.execute(text("""
            SELECT district_code, COUNT(*) AS cells,
                   COUNT(population) AS with_population,
                   COUNT(elevation_m) AS with_elevation
            FROM spatial_cells GROUP BY district_code ORDER BY district_code
        """))).mappings().all()
    for row in summary:
        log.info("  %-16s %5d cells · %d with population · %d with elevation",
                 row["district_code"], row["cells"],
                 row["with_population"], row["with_elevation"])
        if row["with_population"] == 0:
            log.warning("    population is unknown for this district — exposure will "
                        "report 'population unknown' rather than a number. Stage the "
                        "WorldPop raster and re-run scripts/enrich_cells.py.")

    await dispose()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
