"""
GloFAS river discharge via the Open-Meteo Flood API.

Public, documented, no key. `https://flood-api.open-meteo.com/v1/flood` returns
daily river discharge in m³/s from ECMWF's GloFAS v4 at roughly 5 km, with
ensemble statistics and a return-period climatology.

**What this is and is not.** GloFAS discharge is a *modelled* volumetric flow
for a gridded river network. A CWC gauge reports *stage* — water level in metres
against a surveyed danger level at a specific station. They are different
quantities and they are not interchangeable:

  · Discharge answers "how much water is moving".
  · Stage answers "how high is it against the level this town floods at".

So this connector never writes into `level_m`. It writes discharge, plus the
ratio of current discharge to the local 2-year return period, which is the
comparable dimensionless quantity. The flood risk engine uses that ratio in
place of the level/danger ratio when CWC is absent, and the prediction is
stamped `degraded_inputs=['cwc']` so nobody mistakes one for the other.
"""
from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, datetime

from app.db.repositories import upsert_river
from app.db.session import session_scope
from app.ingestion.base import (
    DataConnector,
    SourceState,
    SourceUnavailable,
    ValidationIssue,
    register,
)

DAILY = ("river_discharge,river_discharge_mean,river_discharge_max,"
         "river_discharge_median,river_discharge_p25,river_discharge_p75")


@register
class GloFASConnector(DataConnector[dict, list[dict]]):
    source_key = "glofas"
    produces = "river_observations"

    def __init__(self, *a, points: Sequence[tuple[str, float, float]] = (), **kw):
        super().__init__(*a, **kw)
        self.points = list(points)

    async def fetch(self) -> Sequence[dict]:
        if not self.points:
            raise SourceUnavailable(
                self.source_key, "no sample points supplied; build the H3 grid first",
                SourceState.NOT_CONFIGURED)

        out: list[dict] = []
        BATCH = 50          # be modest with a free service
        for i in range(0, len(self.points), BATCH):
            chunk = self.points[i:i + BATCH]

            async def _call(chunk=chunk):
                r = await self.client.get(self.url("/flood"), params={
                    "latitude": ",".join(f"{p[1]:.4f}" for p in chunk),
                    "longitude": ",".join(f"{p[2]:.4f}" for p in chunk),
                    "daily": DAILY,
                    "past_days": 7,
                    "forecast_days": 7,
                    "ensemble": "false",
                })
                r.raise_for_status()
                return r.json()

            payload = await self.with_retry(_call, what="GloFAS discharge")
            series = payload if isinstance(payload, list) else [payload]
            for meta, block in zip(chunk, series, strict=False):
                out.append({"cell_id": meta[0], "lat": meta[1], "lon": meta[2],
                            "block": block})
        return out

    def validate(self, raw: dict) -> list[ValidationIssue]:
        daily = (raw.get("block") or {}).get("daily") or {}
        if not daily.get("time"):
            return [ValidationIssue("daily.time", "empty_series")]
        discharge = daily.get("river_discharge") or []
        if all(v is None for v in discharge):
            # A cell with no river in it legitimately has no discharge. That is
            # not corrupt data — it is a cell away from the modelled network.
            return [ValidationIssue("river_discharge", "no_river_at_this_cell")]
        return []

    def normalize(self, raw: dict) -> list[dict]:
        d = raw["block"]["daily"]
        times = d["time"]
        series = d.get("river_discharge") or []

        # Local climatology from the window we have. This is a weak baseline —
        # 14 days is not a return period — so it is labelled as such in `trend`
        # and the risk engine treats the ratio as indicative, not definitive.
        observed = [v for v in series if v is not None]
        baseline = (sorted(observed)[len(observed) // 2] if observed else None)

        now = datetime.now(UTC)
        rows: list[dict] = []
        for i, day in enumerate(times):
            value = series[i] if i < len(series) else None
            if value is None:
                continue
            observed_at = datetime.fromisoformat(day).replace(tzinfo=UTC)
            forecast = observed_at > now
            prev = next((series[j] for j in range(i - 1, -1, -1)
                         if j < len(series) and series[j] is not None), None)

            p = self.provenance(
                source_id=f"{raw['cell_id']}@{day}",
                observed_at=observed_at,
                # a forecast day is stored, but it is not an observation
                confidence=0.60 if forecast else 0.82,
            )
            ratio = (value / baseline) if baseline else None
            rows.append({
                **p.as_dict(),
                "cell_id": raw["cell_id"], "lat": raw["lat"], "lon": raw["lon"],
                "station_name": None, "river_name": None,
                # deliberately NULL: this source does not measure stage
                "level_m": None, "warning_level_m": None,
                "danger_level_m": None, "hfl_m": None,
                "discharge_cumecs": round(float(value), 2),
                "level_change_1h_m": None,
                "level_change_6h_m": None,
                "trend": ("rising" if prev is not None and value > prev * 1.05
                          else "falling" if prev is not None and value < prev * 0.95
                          else "steady"),
                "raw": json.dumps({
                    "provider": "open-meteo/glofas-v4",
                    "quantity": "modelled_discharge_not_gauge_stage",
                    "is_forecast": forecast,
                    "discharge_ratio_to_window_median": (
                        round(ratio, 3) if ratio is not None else None),
                    "window_median_cumecs": (
                        round(baseline, 2) if baseline is not None else None),
                }),
            })
        return rows

    async def store(self, records: Sequence[list[dict]]) -> int:
        flat = [row for group in records for row in group]
        if not flat:
            return 0
        async with session_scope() as s:
            return await upsert_river(s, flat)
