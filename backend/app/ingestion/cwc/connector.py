"""
CWC connector — Central Water Commission river levels and flood forecasts.

**Access reality.** CWC's Flood Forecasting System is a web dashboard, and
India-WRIS is a portal. Neither publishes a documented open REST contract that
this project may rely on. The honest position is therefore: interface complete,
no fetch until a route is agreed with CWC / NWIC in writing and expressed in
configuration.

River level is the single most important flood feature after rainfall, so the
absence of this source is not silent. When CWC is NOT_CONFIGURED the flood
model runs on rainfall, soil moisture and terrain only, every affected
prediction carries `degraded_inputs=['cwc']`, and confidence is damped by
`settings.stale_confidence_penalty`.

Two things must be configured to bring this live:
  AAPDA_SOURCE_CWC_API_KEY          credential issued by CWC/NWIC
  AAPDA_SOURCE_CWC_STATIONS_PATH    the agreed path returning station levels
"""
from __future__ import annotations

import os
from collections.abc import Sequence

from app.db.repositories import upsert_river
from app.db.session import session_scope
from app.ingestion.base import (
    DataConnector,
    SourceState,
    SourceUnavailable,
    ValidationIssue,
    register,
)


@register
class CWCConnector(DataConnector[dict, dict]):
    source_key = "cwc"
    produces = "river_observations"

    async def fetch(self) -> Sequence[dict]:
        path = os.environ.get("AAPDA_SOURCE_CWC_STATIONS_PATH", "").strip()
        if not path or not self.config.api_key:
            raise SourceUnavailable(
                self.source_key,
                "CWC hydrological access is not configured. The FFS portal "
                "(india-water.gov.in/ffs) is a dashboard, not a documented public API; "
                "a machine-readable route must be agreed with CWC/NWIC. Flood predictions "
                "will run without river level and be flagged degraded.",
                SourceState.NOT_CONFIGURED,
            )

        async def _call():
            r = await self.client.get(self.url(path),
                                      headers={"Authorization": f"Bearer {self.config.api_key}"})
            r.raise_for_status()
            return r.json()

        payload = await self.with_retry(_call, what="station levels")
        return payload if isinstance(payload, list) else payload.get("data", [])

    def validate(self, raw: dict) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        if raw.get("observed_at") is None:
            issues.append(ValidationIssue("observed_at", "missing_timestamp"))
        level = raw.get("level_m")
        if level is None:
            issues.append(ValidationIssue("level_m", "missing_level"))
        elif not (-50.0 <= float(level) <= 5000.0):
            issues.append(ValidationIssue("level_m", "implausible_level", level))
        # A reading above HFL is not impossible, but it is extraordinary and
        # deserves a suspect flag rather than silent acceptance.
        hfl = raw.get("hfl_m")
        if level is not None and hfl and float(level) > float(hfl) * 1.15:
            issues.append(ValidationIssue("level_m", "exceeds_hfl_by_15pct", level))
        return issues

    def normalize(self, raw: dict) -> dict:
        raise NotImplementedError(
            "Implement against the CWC payload agreed with CWC/NWIC. The target shape is "
            "the river_observations columns; do not assume field names."
        )

    async def store(self, records: Sequence[dict]) -> int:
        if not records:
            return 0
        async with session_scope() as s:
            return await upsert_river(s, records)
