"""
Feature engineering (§7, §8).

The one rule that matters here is **no leakage**. Every feature for a cell at
time *t* is computed from observations with `observed_at <= t`, using the
`ingested_at` column to additionally exclude anything that had not physically
arrived by *t* when building a training set. Those are different constraints and
both are needed:

  · `observed_at <= t` stops the model seeing the future.
  · `ingested_at <= t` stops it seeing data that existed but had not reached
    the platform yet — which is the situation at inference time. A model
    trained on river levels that in production arrive 40 minutes late will
    look excellent in backtest and fail in the field.

`AS_OF_SQL` enforces both. There is no code path that builds a training row
without going through it.

Rolling windows are computed in SQL rather than pandas because the observation
tables are the largest in the system and the (cell_id, observed_at DESC) index
turns a window query into an index range scan.
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# ══════════════════════════════════════════════════════════════════════
# Feature definitions
# ══════════════════════════════════════════════════════════════════════
FLOOD_FEATURES: list[str] = [
    # rainfall accumulation across the windows §8 asks for
    "rainfall_15m", "rainfall_1h", "rainfall_3h", "rainfall_6h",
    "rainfall_12h", "rainfall_24h", "rainfall_48h", "rainfall_72h",
    "rainfall_intensity_max_1h",
    # hydrology
    "river_level", "river_level_ratio_danger", "river_discharge",
    "river_level_rate_1h", "river_level_rate_6h",
    # antecedent conditions
    "soil_moisture", "api_7d",
    # static terrain
    "elevation_m", "slope_deg", "dist_to_river_m", "height_above_river_m",
    "upstream_area_km2", "drainage_density", "flood_susceptibility",
    "built_up_fraction",
    # context
    "month_sin", "month_cos", "is_monsoon",
]

LANDSLIDE_FEATURES: list[str] = [
    "rainfall_1h", "rainfall_3h", "rainfall_6h", "rainfall_24h",
    "rainfall_72h", "rainfall_intensity_max_1h", "api_15d",
    "rainfall_intensity_duration_ratio",
    "slope_deg", "aspect_deg", "curvature", "terrain_ruggedness",
    "elevation_m", "soil_moisture", "soil_depth_cm",
    "ndvi_baseline", "land_cover_code", "lithology_code",
    "dist_to_river_m", "landslide_susceptibility",
    "month_sin", "month_cos", "is_monsoon",
]

FEATURE_SETS: dict[str, list[str]] = {
    "flood": FLOOD_FEATURES,
    "landslide": LANDSLIDE_FEATURES,
}


@dataclass(slots=True)
class FeatureRow:
    cell_id: str
    as_of: datetime
    hazard: str
    values: dict[str, float | None] = field(default_factory=dict)
    ages_s: dict[str, float] = field(default_factory=dict)
    sources_present: set[str] = field(default_factory=set)

    @property
    def completeness(self) -> float:
        if not self.values:
            return 0.0
        present = sum(1 for v in self.values.values() if v is not None)
        return present / len(self.values)

    def vector(self, feature_list: Sequence[str]) -> list[float | None]:
        return [self.values.get(f) for f in feature_list]


# ══════════════════════════════════════════════════════════════════════
# The leakage-safe query
# ══════════════════════════════════════════════════════════════════════
AS_OF_SQL = """
WITH bounds AS (SELECT CAST(:as_of AS timestamptz) AS t),
wx AS (
  SELECT w.cell_id, w.observed_at, w.rainfall_mm, w.interval_minutes,
         w.soil_moisture_frac, w.temp_c, w.humidity_pct, w.source
  FROM weather_observations w, bounds b
  WHERE w.cell_id = ANY(:cells)
    AND w.observed_at <= b.t
    -- the second guard: exclude rows that had not arrived yet at time t.
    -- :respect_ingest is TRUE for training, FALSE for live inference.
    AND (NOT :respect_ingest OR w.ingested_at <= b.t)
    AND w.observed_at >= b.t - INTERVAL '15 days'
    AND w.quality <> 'missing'
),
riv AS (
  SELECT r.cell_id, r.observed_at, r.level_m, r.danger_level_m, r.warning_level_m,
         r.discharge_cumecs, r.source
  FROM river_observations r, bounds b
  WHERE r.cell_id = ANY(:cells)
    AND r.observed_at <= b.t
    AND (NOT :respect_ingest OR r.ingested_at <= b.t)
    AND r.observed_at >= b.t - INTERVAL '7 days'
    AND r.quality <> 'missing'
),
rain AS (
  SELECT cell_id,
    SUM(rainfall_mm) FILTER (WHERE observed_at > (SELECT t FROM bounds) - INTERVAL '15 minutes') AS rainfall_15m,
    SUM(rainfall_mm) FILTER (WHERE observed_at > (SELECT t FROM bounds) - INTERVAL '1 hour')  AS rainfall_1h,
    SUM(rainfall_mm) FILTER (WHERE observed_at > (SELECT t FROM bounds) - INTERVAL '3 hours') AS rainfall_3h,
    SUM(rainfall_mm) FILTER (WHERE observed_at > (SELECT t FROM bounds) - INTERVAL '6 hours') AS rainfall_6h,
    SUM(rainfall_mm) FILTER (WHERE observed_at > (SELECT t FROM bounds) - INTERVAL '12 hours') AS rainfall_12h,
    SUM(rainfall_mm) FILTER (WHERE observed_at > (SELECT t FROM bounds) - INTERVAL '24 hours') AS rainfall_24h,
    SUM(rainfall_mm) FILTER (WHERE observed_at > (SELECT t FROM bounds) - INTERVAL '48 hours') AS rainfall_48h,
    SUM(rainfall_mm) FILTER (WHERE observed_at > (SELECT t FROM bounds) - INTERVAL '72 hours') AS rainfall_72h,
    MAX(rainfall_mm / GREATEST(interval_minutes,1) * 60)
        FILTER (WHERE observed_at > (SELECT t FROM bounds) - INTERVAL '24 hours') AS rainfall_intensity_max_1h,
    -- Antecedent Precipitation Index: exponentially decayed prior rainfall.
    -- This is what makes the difference between 80 mm on dry ground and 80 mm
    -- on a slope that has been soaking for a fortnight.
    SUM(rainfall_mm * POWER(0.92, EXTRACT(EPOCH FROM ((SELECT t FROM bounds) - observed_at))/86400.0))
        FILTER (WHERE observed_at > (SELECT t FROM bounds) - INTERVAL '7 days')  AS api_7d,
    SUM(rainfall_mm * POWER(0.90, EXTRACT(EPOCH FROM ((SELECT t FROM bounds) - observed_at))/86400.0))
        FILTER (WHERE observed_at > (SELECT t FROM bounds) - INTERVAL '15 days') AS api_15d,
    MAX(observed_at) AS latest_wx,
    ARRAY_AGG(DISTINCT source) AS wx_sources
  FROM wx GROUP BY cell_id
),
moisture AS (
  SELECT DISTINCT ON (cell_id) cell_id, soil_moisture_frac, observed_at
  FROM wx WHERE soil_moisture_frac IS NOT NULL
  ORDER BY cell_id, observed_at DESC
),
river_now AS (
  SELECT DISTINCT ON (cell_id) cell_id, level_m, danger_level_m, warning_level_m,
         discharge_cumecs, observed_at, source
  FROM riv ORDER BY cell_id, observed_at DESC
),
river_lag AS (
  SELECT r.cell_id,
    MAX(r.level_m) FILTER (WHERE r.observed_at <= (SELECT t FROM bounds) - INTERVAL '1 hour') AS level_1h_ago,
    MAX(r.level_m) FILTER (WHERE r.observed_at <= (SELECT t FROM bounds) - INTERVAL '6 hours') AS level_6h_ago
  FROM riv r GROUP BY r.cell_id
)
SELECT c.cell_id,
       c.elevation_m, c.slope_deg, c.aspect_deg, c.curvature, c.terrain_ruggedness,
       c.dist_to_river_m, c.height_above_river_m, c.upstream_area_km2, c.drainage_density,
       c.soil_depth_cm, c.ndvi_baseline, c.land_cover_class, c.lithology,
       c.built_up_fraction, c.flood_susceptibility, c.landslide_susceptibility,
       c.population, c.population_density, c.building_count, c.road_length_m,
       rain.rainfall_15m, rain.rainfall_1h, rain.rainfall_3h, rain.rainfall_6h,
       rain.rainfall_12h, rain.rainfall_24h, rain.rainfall_48h, rain.rainfall_72h,
       rain.rainfall_intensity_max_1h, rain.api_7d, rain.api_15d,
       rain.latest_wx, rain.wx_sources,
       m.soil_moisture_frac AS soil_moisture, m.observed_at AS moisture_at,
       rn.level_m AS river_level, rn.danger_level_m, rn.warning_level_m,
       rn.discharge_cumecs AS river_discharge, rn.observed_at AS river_at, rn.source AS river_source,
       rl.level_1h_ago, rl.level_6h_ago
FROM spatial_cells c
LEFT JOIN rain       ON rain.cell_id = c.cell_id
LEFT JOIN moisture m ON m.cell_id    = c.cell_id
LEFT JOIN river_now rn ON rn.cell_id = c.cell_id
LEFT JOIN river_lag rl ON rl.cell_id = c.cell_id
WHERE c.cell_id = ANY(:cells)
"""

LAND_COVER_CODES = {"forest": 1, "cropland": 2, "built_up": 3, "grassland": 4,
                    "barren": 5, "water": 6, "snow_ice": 7, "shrubland": 8}
LITHOLOGY_CODES = {"granite": 1, "gneiss": 2, "schist": 3, "quartzite": 4,
                   "limestone": 5, "sandstone": 6, "shale": 7, "alluvium": 8,
                   "colluvium": 9, "phyllite": 10}


class FeatureBuilder:
    def __init__(self, hazard: str):
        if hazard not in FEATURE_SETS:
            raise ValueError(f"No feature set defined for hazard {hazard!r}")
        self.hazard = hazard
        self.feature_list = FEATURE_SETS[hazard]

    async def build(self, session: AsyncSession, cells: Sequence[str], as_of: datetime,
                    *, respect_ingest_time: bool = False) -> list[FeatureRow]:
        """One feature row per cell, as of `as_of`.

        `respect_ingest_time=True` for training-set construction — it simulates
        what the platform actually knew at that moment. False for live
        inference, where everything in the table has by definition arrived.
        """
        if as_of.tzinfo is None:
            as_of = as_of.replace(tzinfo=UTC)
        rows = (await session.execute(text(AS_OF_SQL), {
            "cells": list(cells), "as_of": as_of,
            "respect_ingest": respect_ingest_time,
        })).mappings().all()
        return [self._row(r, as_of) for r in rows]

    def _row(self, r, as_of: datetime) -> FeatureRow:
        f: dict[str, float | None] = {}
        ages: dict[str, float] = {}

        for k in ("rainfall_15m", "rainfall_1h", "rainfall_3h", "rainfall_6h",
                  "rainfall_12h", "rainfall_24h", "rainfall_48h", "rainfall_72h",
                  "rainfall_intensity_max_1h", "api_7d", "api_15d"):
            f[k] = _f(r.get(k))

        f["soil_moisture"] = _f(r.get("soil_moisture"))
        f["river_level"] = _f(r.get("river_level"))
        f["river_discharge"] = _f(r.get("river_discharge"))

        danger = _f(r.get("danger_level_m"))
        level = f["river_level"]
        f["river_level_ratio_danger"] = (level / danger) if (level and danger) else None
        f["river_level_rate_1h"] = _rate(level, _f(r.get("level_1h_ago")), 1.0)
        f["river_level_rate_6h"] = _rate(level, _f(r.get("level_6h_ago")), 6.0)

        for k in ("elevation_m", "slope_deg", "aspect_deg", "curvature",
                  "terrain_ruggedness", "dist_to_river_m", "height_above_river_m",
                  "upstream_area_km2", "drainage_density", "soil_depth_cm",
                  "ndvi_baseline", "built_up_fraction", "flood_susceptibility",
                  "landslide_susceptibility"):
            f[k] = _f(r.get(k))

        f["land_cover_code"] = LAND_COVER_CODES.get(r.get("land_cover_class"))
        f["lithology_code"] = LITHOLOGY_CODES.get(r.get("lithology"))

        # Rainfall intensity ÷ duration — the ratio that separates a short
        # cloudburst from a long soaking, which fail slopes differently.
        peak, r72 = f["rainfall_intensity_max_1h"], f["rainfall_72h"]
        f["rainfall_intensity_duration_ratio"] = (peak / r72) if (peak and r72) else None

        month = as_of.month
        import math
        f["month_sin"] = math.sin(2 * math.pi * month / 12)
        f["month_cos"] = math.cos(2 * math.pi * month / 12)
        f["is_monsoon"] = 1.0 if month in (6, 7, 8, 9) else 0.0

        for name, ts in (("weather", r.get("latest_wx")),
                         ("river", r.get("river_at")),
                         ("moisture", r.get("moisture_at"))):
            if ts is not None:
                t = ts if ts.tzinfo else ts.replace(tzinfo=UTC)
                ages[name] = max((as_of - t).total_seconds(), 0.0)
            else:
                ages[name] = float("inf")

        sources = set(r.get("wx_sources") or [])
        if r.get("river_source"):
            sources.add(r["river_source"])

        return FeatureRow(
            cell_id=r["cell_id"], as_of=as_of, hazard=self.hazard,
            values={k: f.get(k) for k in self.feature_list},
            ages_s=ages, sources_present=sources,
        )


# ══════════════════════════════════════════════════════════════════════
# Labels — the other half of the leakage problem
# ══════════════════════════════════════════════════════════════════════
LABEL_SQL = """
SELECT c.cell_id,
       EXISTS (
         SELECT 1 FROM disaster_events e
         WHERE e.hazard = CAST(:hazard AS hazard_type)
           AND e.geom IS NOT NULL
           AND ST_Intersects(e.geom, c.geom)
           AND e.start_time < CAST(:as_of AS timestamptz) + (:horizon_h * INTERVAL '1 hour')
           AND COALESCE(e.end_time, e.start_time + INTERVAL '24 hours')
               >= CAST(:as_of AS timestamptz)
       ) AS label
FROM spatial_cells c
WHERE c.cell_id = ANY(:cells)
"""


async def build_labels(session: AsyncSession, cells: Sequence[str], as_of: datetime,
                       hazard: str, horizon_hours: int) -> dict[str, int]:
    """Did the hazard occur in this cell within `horizon_hours` of `as_of`?

    The label window opens at `as_of` and closes at `as_of + horizon`. It is the
    only place in the pipeline that is permitted to look forward, and it looks
    forward exactly as far as the model is asked to predict — no further.
    """
    rows = (await session.execute(text(LABEL_SQL), {
        "cells": list(cells), "as_of": as_of, "hazard": hazard,
        "horizon_h": horizon_hours,
    })).mappings().all()
    return {r["cell_id"]: int(r["label"]) for r in rows}


def _f(v) -> float | None:
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def _rate(now: float | None, then: float | None, hours: float) -> float | None:
    if now is None or then is None:
        return None
    return (now - then) / hours


def time_grid(start: datetime, end: datetime, step: timedelta) -> list[datetime]:
    out, t = [], start
    while t <= end:
        out.append(t)
        t += step
    return out
