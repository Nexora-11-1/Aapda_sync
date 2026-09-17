"""
Seismic connectors.

`USGSConnector` is fully live — the FDSN event web service is public, documented
and needs no key. It is a *supplementary* source and labelled as such.

`NCSConnector` is the primary Indian source (National Center for Seismology,
MoES). Its catalogue sits behind a data-portal registration, so it ships as an
interface with a configured base URL and no invented path.
"""
from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from app.db.repositories import upsert_seismic
from app.db.session import session_scope
from app.ingestion.base import (
    DataConnector,
    SourceState,
    SourceUnavailable,
    ValidationIssue,
    register,
)

# Generous India + neighbourhood window: events outside it cannot shake India
# hard enough to matter for this platform, and pulling the global catalogue
# every five minutes is rude to a free service.
INDIA_BBOX = dict(minlatitude=5.0, maxlatitude=40.0,
                  minlongitude=65.0, maxlongitude=100.0)


@register
class USGSConnector(DataConnector[dict, dict]):
    source_key = "usgs"
    produces = "seismic_events"

    def __init__(self, *a, lookback_hours: int = 24, min_magnitude: float = 2.5, **kw):
        super().__init__(*a, **kw)
        self.lookback_hours = lookback_hours
        self.min_magnitude = min_magnitude

    async def fetch(self) -> Sequence[dict]:
        since = datetime.now(UTC) - timedelta(hours=self.lookback_hours)

        async def _call():
            r = await self.client.get(self.url("/query"), params={
                "format": "geojson",
                "starttime": since.strftime("%Y-%m-%dT%H:%M:%S"),
                "minmagnitude": self.min_magnitude,
                "orderby": "time",
                **INDIA_BBOX,
            })
            r.raise_for_status()
            return r.json()

        payload = await self.with_retry(_call, what="FDSN event query")
        return payload.get("features", [])

    def validate(self, raw: dict) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        geom = raw.get("geometry") or {}
        coords = geom.get("coordinates") or []
        if len(coords) < 2:
            issues.append(ValidationIssue("geometry", "missing_coordinates"))
        props = raw.get("properties") or {}
        if props.get("time") is None:
            issues.append(ValidationIssue("time", "missing_origin_time"))
        mag = props.get("mag")
        if mag is not None and not (-2.0 <= float(mag) <= 10.0):
            issues.append(ValidationIssue("mag", "implausible_magnitude", mag))
        if len(coords) >= 3 and coords[2] is not None:
            depth = float(coords[2])
            if not (-10.0 <= depth <= 800.0):
                issues.append(ValidationIssue("depth", "implausible_depth", depth))
        return issues

    def normalize(self, raw: dict) -> dict:
        props, coords = raw["properties"], raw["geometry"]["coordinates"]
        observed = datetime.fromtimestamp(props["time"] / 1000, tz=UTC)
        # USGS reviewed solutions are firmer than automatic ones
        conf = 0.95 if props.get("status") == "reviewed" else 0.80
        p = self.provenance(source_id=raw.get("id"), observed_at=observed, confidence=conf)
        return {
            **p.as_dict(),
            "lon": coords[0], "lat": coords[1],
            "cell_id": None,                       # assigned by the spatial mapper
            "magnitude": props.get("mag"),
            "magnitude_type": props.get("magType"),
            "depth_km": coords[2] if len(coords) > 2 else None,
            "place": props.get("place"),
            "felt_reports": props.get("felt"),
            "raw": json.dumps({"net": props.get("net"), "status": props.get("status"),
                               "tsunami": props.get("tsunami"), "url": props.get("url")}),
        }

    async def store(self, records: Sequence[dict]) -> int:
        if not records:
            return 0
        async with session_scope() as s:
            return await upsert_seismic(s, records)


@register
class NCSConnector(DataConnector[dict, dict]):
    """National Center for Seismology — primary Indian seismic authority.

    The NCS data portal requires registration for catalogue access. Configure
    `AAPDA_SOURCE_NCS_API_KEY` and `AAPDA_SOURCE_NCS_CATALOGUE_PATH`, then
    implement `normalize` against the real payload. Until then this reports
    NOT_CONFIGURED and USGS carries the hazard, labelled as supplementary.
    """
    source_key = "ncs"
    produces = "seismic_events"

    async def fetch(self) -> Sequence[dict]:
        raise SourceUnavailable(
            self.source_key,
            "NCS catalogue access requires registration at seismo.gov.in/data-portal. "
            "No public endpoint is documented, and this connector will not invent one.",
            SourceState.NOT_CONFIGURED,
        )

    def validate(self, raw: dict) -> list[ValidationIssue]:
        return []

    def normalize(self, raw: dict) -> dict:
        raise NotImplementedError("Implement against the NCS payload once access is granted.")

    async def store(self, records: Sequence[dict]) -> int:
        if not records:
            return 0
        async with session_scope() as s:
            return await upsert_seismic(s, records)
