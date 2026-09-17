"""
IMD connector — India Meteorological Department.

**Access reality.** IMD operates an official API portal at the base URL given in
configuration. Getting on it requires registration *and* whitelisting of the
server's outbound IP; the endpoint catalogue is behind that login. Attribution to
IMD is mandatory and IMD asks integrators to cache during peak weather events.

Because we cannot see the catalogue from outside, this connector ships as a
complete interface with the endpoint *paths* supplied by configuration
(`AAPDA_SOURCE_IMD_ENDPOINTS`), not guessed in code. Until an operator supplies
credentials and paths it reports NOT_CONFIGURED, and `OpenMeteoConnector` (in
this package) covers the weather slot as an explicitly-labelled supplementary
source.

To bring it live:
  1. Register at the IMD API portal and whitelist this server's egress IP.
  2. Set AAPDA_SOURCE_IMD_API_KEY.
  3. Set AAPDA_SOURCE_IMD_ENDPOINTS to the JSON map of the paths IMD documents,
     e.g. {"station_observations": "/…", "district_warnings": "/…"}.
  4. Fill in `_parse_station` / `_parse_warning` against the real payload shape.
     Both raise NotImplementedError today rather than inventing a schema.
"""
from __future__ import annotations

import json
import os
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from app.db.repositories import upsert_weather
from app.db.session import session_scope
from app.ingestion.base import (
    DataConnector,
    SourceState,
    SourceUnavailable,
    ValidationIssue,
    register,
)


@register
class IMDConnector(DataConnector[dict, dict]):
    source_key = "imd"
    produces = "weather_observations"

    def _endpoints(self) -> dict[str, str]:
        raw = os.environ.get("AAPDA_SOURCE_IMD_ENDPOINTS", "")
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SourceUnavailable(
                self.source_key, f"AAPDA_SOURCE_IMD_ENDPOINTS is not valid JSON: {exc}",
                SourceState.NOT_CONFIGURED,
            ) from exc

    async def fetch(self) -> Sequence[dict]:
        endpoints = self._endpoints()
        if not endpoints:
            raise SourceUnavailable(
                self.source_key,
                "IMD endpoint paths are not configured. This connector will not guess a "
                "path against the IMD API. See docs/10-data-sources.md.",
                SourceState.NOT_CONFIGURED,
            )
        if not self.config.api_key:
            raise SourceUnavailable(
                self.source_key,
                "IMD requires registration and IP whitelisting; no API key configured.",
                SourceState.NOT_CONFIGURED,
            )

        path = endpoints.get("station_observations")
        if not path:
            raise SourceUnavailable(
                self.source_key, "no 'station_observations' path in AAPDA_SOURCE_IMD_ENDPOINTS",
                SourceState.NOT_CONFIGURED,
            )

        async def _call():
            r = await self.client.get(
                self.url(path),
                headers={"Authorization": f"Bearer {self.config.api_key}"},
            )
            r.raise_for_status()
            return r.json()

        payload = await self.with_retry(_call, what="station observations")
        return payload if isinstance(payload, list) else payload.get("data", [])

    def validate(self, raw: dict) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        if raw.get("lat") is None or raw.get("lon") is None:
            issues.append(ValidationIssue("location", "missing_coordinates"))
        else:
            lat, lon = float(raw["lat"]), float(raw["lon"])
            # India's bounding box, generously padded. A station outside it is a
            # coding error upstream, not a station.
            if not (6.0 <= lat <= 38.0 and 67.0 <= lon <= 98.0):
                issues.append(ValidationIssue("location", "outside_india_bbox", (lat, lon)))
        if not raw.get("observed_at"):
            issues.append(ValidationIssue("observed_at", "missing_timestamp"))
        rain = raw.get("rainfall_mm")
        if rain is not None and not (0 <= float(rain) <= 1200):
            # 1200 mm in one interval would beat the Indian record several times over
            issues.append(ValidationIssue("rainfall_mm", "implausible_range", rain))
        return issues

    def normalize(self, raw: dict) -> dict:
        raise NotImplementedError(
            "IMD payload shape is documented behind the API portal login. Implement "
            "_parse_station against the real response before enabling this connector; "
            "do not assume a schema."
        )

    async def store(self, records: Sequence[dict]) -> int:
        if not records:
            return 0
        async with session_scope() as s:
            return await upsert_weather(s, records)


# ══════════════════════════════════════════════════════════════════════
# Supplementary weather — labelled, never disguised as IMD (§3, §28)
# ══════════════════════════════════════════════════════════════════════
@register
class OpenMeteoConnector(DataConnector[dict, dict]):
    """Open-Meteo forecast API. Public, no key.

    This is a *supplementary* source. It fills the weather slot when IMD is not
    configured or is stale, and it stores under `source='openmeteo'` so nothing
    downstream can mistake it for an IMD observation. Risk output computed from
    it is stamped `degraded_inputs=['imd']`.
    """
    source_key = "openmeteo"
    produces = "weather_observations"

    #: cell centroids to sample, injected by the scheduler from the active grid
    def __init__(self, *a, points: Sequence[tuple[str, float, float]] = (), **kw):
        super().__init__(*a, **kw)
        self.points = list(points)

    HOURLY = (
        "temperature_2m,relative_humidity_2m,precipitation,rain,"
        "surface_pressure,wind_speed_10m,wind_gusts_10m,wind_direction_10m,"
        "cloud_cover,soil_moisture_0_to_1cm"
    )

    async def fetch(self) -> Sequence[dict]:
        if not self.points:
            raise SourceUnavailable(
                self.source_key, "no sample points supplied; build the H3 grid first",
                SourceState.NOT_CONFIGURED,
            )
        # Open-Meteo takes comma-separated coordinate lists — one call per batch
        out: list[dict] = []
        BATCH = 100
        for i in range(0, len(self.points), BATCH):
            chunk = self.points[i:i + BATCH]

            async def _call(chunk=chunk):
                r = await self.client.get(self.url("/forecast"), params={
                    "latitude": ",".join(f"{p[1]:.4f}" for p in chunk),
                    "longitude": ",".join(f"{p[2]:.4f}" for p in chunk),
                    "hourly": self.HOURLY,
                    "past_days": 2,
                    "forecast_days": 2,
                    "timezone": "UTC",
                })
                r.raise_for_status()
                return r.json()

            payload = await self.with_retry(_call, what="forecast batch")
            series = payload if isinstance(payload, list) else [payload]
            for cell_meta, block in zip(chunk, series, strict=False):
                out.append({"cell_id": cell_meta[0], "lat": cell_meta[1],
                            "lon": cell_meta[2], "block": block})
        return out

    def validate(self, raw: dict) -> list[ValidationIssue]:
        block = raw.get("block") or {}
        hourly = block.get("hourly") or {}
        if not hourly.get("time"):
            return [ValidationIssue("hourly.time", "empty_series")]
        return []

    def normalize(self, raw: dict) -> list[dict]:
        """One API response → many hourly observation rows."""
        h = raw["block"]["hourly"]
        rows: list[dict] = []
        for i, ts in enumerate(h["time"]):
            observed = datetime.fromisoformat(ts).replace(tzinfo=UTC)
            p = self.provenance(
                source_id=f"{raw['cell_id']}@{ts}", observed_at=observed,
                # a forecast hour beyond now is a forecast, not an observation:
                # it is stored, but at reduced confidence
                confidence=0.80 if observed <= datetime.now(UTC) else 0.60,
            )

            def g(field: str, idx: int = i) -> Any:
                seq = h.get(field)
                return seq[idx] if seq and idx < len(seq) else None

            rows.append({
                **p.as_dict(),
                "cell_id": raw["cell_id"], "lat": raw["lat"], "lon": raw["lon"],
                "station_name": None,
                "temp_c": g("temperature_2m"), "temp_min_c": None, "temp_max_c": None,
                "humidity_pct": g("relative_humidity_2m"),
                "pressure_hpa": g("surface_pressure"),
                "wind_speed_ms": _kph_to_ms(g("wind_speed_10m")),
                "wind_gust_ms": _kph_to_ms(g("wind_gusts_10m")),
                "wind_dir_deg": g("wind_direction_10m"),
                "rainfall_mm": g("precipitation"), "interval_minutes": 60,
                "cloud_cover_pct": g("cloud_cover"),
                "soil_moisture_frac": g("soil_moisture_0_to_1cm"),
                "raw": json.dumps({"provider": "open-meteo", "time": ts}),
            })
        return rows

    def transform(self, record):
        return record

    async def store(self, records: Sequence[list[dict]]) -> int:
        flat = [row for group in records for row in group]
        if not flat:
            return 0
        async with session_scope() as s:
            return await upsert_weather(s, flat)


def _kph_to_ms(v):
    return None if v is None else round(float(v) / 3.6, 2)
