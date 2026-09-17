"""
NASA FIRMS connector — active-fire thermal anomalies (wildfire hazard, §8).

FIRMS is public and documented, and needs a free MAP_KEY. The API returns CSV
from a documented path shape:

    /api/area/csv/{MAP_KEY}/{SOURCE}/{AREA}/{DAY_RANGE}

Everything but MAP_KEY is configuration, so a change on NASA's side is a config
change rather than a code change.

A thermal anomaly is a *detection*, not a fire. It is stored with the satellite
confidence value FIRMS itself supplies, and the wildfire risk engine treats a
low-confidence anomaly as weak evidence rather than an event.
"""
from __future__ import annotations

import csv
import io
import json
import os
from collections.abc import Sequence
from datetime import UTC, datetime

from app.db.repositories import insert_satellite
from app.db.session import session_scope
from app.ingestion.base import DataConnector, SourceUnavailable, ValidationIssue, register


@register
class FIRMSConnector(DataConnector[dict, dict]):
    source_key = "firms"
    produces = "satellite_observations"

    def __init__(self, *a, area: str | None = None, day_range: int = 1,
                 instrument: str | None = None, **kw):
        super().__init__(*a, **kw)
        # west,south,east,north — MVP district envelope by default
        self.area = area or os.environ.get("AAPDA_SOURCE_FIRMS_AREA", "78.6,29.85,80.0,31.1")
        self.day_range = day_range
        self.instrument = instrument or os.environ.get(
            "AAPDA_SOURCE_FIRMS_SOURCE", "VIIRS_SNPP_NRT")

    async def fetch(self) -> Sequence[dict]:
        if not self.config.api_key:
            raise SourceUnavailable(
                self.source_key,
                "FIRMS needs a free MAP_KEY. Set AAPDA_SOURCE_FIRMS_API_KEY "
                "(register at firms.modaps.eosdis.nasa.gov).",
                "not_configured",
            )

        async def _call():
            r = await self.client.get(self.url(
                f"/area/csv/{self.config.api_key}/{self.instrument}/{self.area}/{self.day_range}"))
            r.raise_for_status()
            return r.text

        body = await self.with_retry(_call, what="FIRMS area CSV")
        if body.lstrip().lower().startswith(("invalid", "error")):
            raise SourceUnavailable(self.source_key, f"FIRMS rejected the request: {body[:120]}")
        return list(csv.DictReader(io.StringIO(body)))

    def validate(self, raw: dict) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        for f in ("latitude", "longitude", "acq_date"):
            if not raw.get(f):
                issues.append(ValidationIssue(f, f"missing_{f}"))
        try:
            lat, lon = float(raw["latitude"]), float(raw["longitude"])
            if not (6.0 <= lat <= 38.0 and 67.0 <= lon <= 98.0):
                issues.append(ValidationIssue("location", "outside_india_bbox"))
        except (TypeError, ValueError, KeyError):
            issues.append(ValidationIssue("location", "unparseable_coordinates"))
        return issues

    def normalize(self, raw: dict) -> dict:
        time_s = (raw.get("acq_time") or "0000").zfill(4)
        observed = datetime.strptime(
            f"{raw['acq_date']} {time_s[:2]}:{time_s[2:]}", "%Y-%m-%d %H:%M").replace(tzinfo=UTC)
        # FIRMS confidence: VIIRS gives l/n/h, MODIS gives 0–100
        raw_conf = str(raw.get("confidence", "")).strip().lower()
        conf = {"l": 0.35, "n": 0.70, "h": 0.92}.get(raw_conf)
        if conf is None:
            try:
                conf = min(max(float(raw_conf) / 100.0, 0.0), 1.0)
            except ValueError:
                conf = 0.60
        p = self.provenance(
            source_id=f"{raw['latitude']},{raw['longitude']}@{raw['acq_date']}T{time_s}",
            observed_at=observed, confidence=conf,
        )
        return {
            **p.as_dict(),
            "cell_id": None,
            "geojson": json.dumps({"type": "Point",
                                   "coordinates": [float(raw["longitude"]), float(raw["latitude"])]}),
            "product": "thermal_anomaly",
            "value": _num(raw.get("bright_ti4") or raw.get("brightness")),
            "unit": "K",
            "instrument": raw.get("satellite") or self.instrument,
            "raw": json.dumps({"frp": raw.get("frp"), "daynight": raw.get("daynight"),
                               "scan": raw.get("scan"), "track": raw.get("track")}),
        }

    async def store(self, records: Sequence[dict]) -> int:
        if not records:
            return 0
        async with session_scope() as s:
            return await insert_satellite(s, records)


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
