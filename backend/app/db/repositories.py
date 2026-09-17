"""
Write paths for ingested data.

Every upsert here keys on the provenance triple (source, source_id, observed_at)
so re-ingesting the same window is a no-op rather than a duplicate. That is what
makes historical replay (§31) and late sync (§4) safe: a record buffered by an
offline field device and delivered an hour later lands at its *observed_at*, not
at receipt time, and does not create a second row.
"""
from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def _bulk_upsert(session: AsyncSession, sql: str, rows: Sequence[dict[str, Any]]) -> int:
    if not rows:
        return 0
    await session.execute(text(sql), list(rows))
    return len(rows)


WEATHER_UPSERT = """
INSERT INTO weather_observations
  (source, source_id, observed_at, ingested_at, confidence, quality,
   cell_id, location, station_name,
   temp_c, temp_min_c, temp_max_c, humidity_pct, pressure_hpa,
   wind_speed_ms, wind_gust_ms, wind_dir_deg, rainfall_mm, interval_minutes,
   cloud_cover_pct, soil_moisture_frac, raw)
VALUES
  (:source, :source_id, :observed_at, :ingested_at, :confidence, CAST(:quality AS quality_status),
   :cell_id, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :station_name,
   :temp_c, :temp_min_c, :temp_max_c, :humidity_pct, :pressure_hpa,
   :wind_speed_ms, :wind_gust_ms, :wind_dir_deg, :rainfall_mm, :interval_minutes,
   :cloud_cover_pct, :soil_moisture_frac, CAST(:raw AS jsonb))
ON CONFLICT (source, source_id, observed_at) DO UPDATE SET
   ingested_at = EXCLUDED.ingested_at,
   confidence  = EXCLUDED.confidence,
   quality     = EXCLUDED.quality,
   rainfall_mm = EXCLUDED.rainfall_mm,
   temp_c      = EXCLUDED.temp_c,
   raw         = EXCLUDED.raw
"""

RIVER_UPSERT = """
INSERT INTO river_observations
  (source, source_id, observed_at, ingested_at, confidence, quality,
   cell_id, location, station_name, river_name,
   level_m, warning_level_m, danger_level_m, hfl_m, discharge_cumecs,
   level_change_1h_m, level_change_6h_m, trend, raw)
VALUES
  (:source, :source_id, :observed_at, :ingested_at, :confidence, CAST(:quality AS quality_status),
   :cell_id, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :station_name, :river_name,
   :level_m, :warning_level_m, :danger_level_m, :hfl_m, :discharge_cumecs,
   :level_change_1h_m, :level_change_6h_m, :trend, CAST(:raw AS jsonb))
ON CONFLICT (source, source_id, observed_at) DO UPDATE SET
   ingested_at = EXCLUDED.ingested_at,
   level_m     = EXCLUDED.level_m,
   discharge_cumecs = EXCLUDED.discharge_cumecs,
   quality     = EXCLUDED.quality,
   raw         = EXCLUDED.raw
"""

SEISMIC_UPSERT = """
INSERT INTO seismic_events
  (source, source_id, observed_at, ingested_at, confidence, quality,
   epicentre, cell_id, magnitude, magnitude_type, depth_km, place, felt_reports, raw)
VALUES
  (:source, :source_id, :observed_at, :ingested_at, :confidence, CAST(:quality AS quality_status),
   ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :cell_id, :magnitude, :magnitude_type,
   :depth_km, :place, :felt_reports, CAST(:raw AS jsonb))
ON CONFLICT (source, source_id) DO UPDATE SET
   ingested_at = EXCLUDED.ingested_at,
   magnitude   = EXCLUDED.magnitude,
   depth_km    = EXCLUDED.depth_km,
   felt_reports = EXCLUDED.felt_reports,
   raw         = EXCLUDED.raw
"""

ALERT_UPSERT = """
INSERT INTO government_alerts
  (source, source_id, issuing_authority, observed_at, ingested_at, effective_at, expires_at,
   hazard, cap_event, severity, urgency, certainty, headline, description, instruction,
   area_desc, geom, language, web_url, raw)
VALUES
  (:source, :source_id, :issuing_authority, :observed_at, :ingested_at, :effective_at, :expires_at,
   CAST(:hazard AS hazard_type), :cap_event, :severity, :urgency, :certainty,
   :headline, :description, :instruction, :area_desc,
   CASE WHEN :geojson IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326) END,
   :language, :web_url, CAST(:raw AS jsonb))
ON CONFLICT (source, source_id) DO UPDATE SET
   ingested_at = EXCLUDED.ingested_at,
   expires_at  = EXCLUDED.expires_at,
   severity    = EXCLUDED.severity,
   headline    = EXCLUDED.headline,
   description = EXCLUDED.description,
   raw         = EXCLUDED.raw
"""

SATELLITE_INSERT = """
INSERT INTO satellite_observations
  (source, source_id, observed_at, ingested_at, confidence, quality,
   cell_id, geom, product, value, unit, instrument, raw)
VALUES
  (:source, :source_id, :observed_at, :ingested_at, :confidence, CAST(:quality AS quality_status),
   :cell_id,
   CASE WHEN :geojson IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326) END,
   :product, :value, :unit, :instrument, CAST(:raw AS jsonb))
"""


async def upsert_weather(s: AsyncSession, rows) -> int:
    return await _bulk_upsert(s, WEATHER_UPSERT, rows)


async def upsert_river(s: AsyncSession, rows) -> int:
    return await _bulk_upsert(s, RIVER_UPSERT, rows)


async def upsert_seismic(s: AsyncSession, rows) -> int:
    return await _bulk_upsert(s, SEISMIC_UPSERT, rows)


async def upsert_alerts(s: AsyncSession, rows) -> int:
    return await _bulk_upsert(s, ALERT_UPSERT, rows)


async def insert_satellite(s: AsyncSession, rows) -> int:
    return await _bulk_upsert(s, SATELLITE_INSERT, rows)


async def record_run(s: AsyncSession, result) -> None:
    """Write an ingestion_runs row and fold the outcome into data_sources."""
    await s.execute(text("""
        INSERT INTO ingestion_runs
          (source_key, started_at, finished_at, ok, http_status, records_fetched,
           records_stored, records_rejected, reject_reasons, quality_score, error, duration_ms)
        VALUES
          (:source_key, :started_at, :finished_at, :ok, :http_status, :fetched,
           :stored, :rejected, CAST(:reasons AS jsonb), :quality_score, :error, :duration_ms)
    """), {
        "source_key": result.source_key, "started_at": result.started_at,
        "finished_at": result.finished_at, "ok": result.ok,
        "http_status": result.http_status, "fetched": result.fetched,
        "stored": result.stored, "rejected": result.rejected,
        "reasons": __import__("json").dumps(result.reject_reasons),
        "quality_score": result.quality_score, "error": result.error,
        "duration_ms": result.duration_ms,
    })
    await s.execute(text("""
        UPDATE data_sources SET
          status = CAST(:state AS source_status),
          last_attempt_at = :attempt,
          last_success_at = CASE WHEN :ok THEN :attempt ELSE last_success_at END,
          last_error = CASE WHEN :ok THEN NULL ELSE :error END,
          consecutive_failures = CASE WHEN :ok THEN 0 ELSE consecutive_failures + 1 END,
          quality_score = COALESCE(:quality_score, quality_score),
          updated_at = now()
        WHERE key = :key
    """), {
        "key": result.source_key, "state": result.state, "attempt": result.finished_at,
        "ok": result.ok, "error": result.error, "quality_score": result.quality_score,
    })
