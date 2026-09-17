"""
INCOIS connector — ocean state and tsunami information via ERDDAP.

INCOIS runs a genuine ERDDAP server, which is a documented, public, RESTful
data protocol. This connector is fully live: it discovers datasets from the
server's own catalogue rather than assuming dataset IDs, then pulls the ones
configured for the active hazards.

ERDDAP's contract (from erddap.incois.gov.in/erddap/rest.html):
  /erddap/info/index.json                       → dataset catalogue
  /erddap/tabledap/{id}.json?{vars}&{constraints} → tabular data
Both are standard ERDDAP paths, not guesses.

Tsunami *warnings* are not taken from here — those come from SACHET with their
issuing authority intact. This connector supplies sea level and wave state as
model inputs only.
"""
from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from app.db.repositories import insert_satellite
from app.db.session import session_scope
from app.ingestion.base import DataConnector, SourceUnavailable, ValidationIssue, register


@register
class INCOISConnector(DataConnector[dict, dict]):
    source_key = "incois"
    produces = "satellite_observations"

    def __init__(self, *a, dataset_ids: Sequence[str] = (), lookback_hours: int = 24, **kw):
        super().__init__(*a, **kw)
        self.dataset_ids = list(dataset_ids)
        self.lookback_hours = lookback_hours

    async def discover(self) -> list[str]:
        """Read the server's own catalogue. Never hardcode a dataset id."""
        async def _call():
            r = await self.client.get(self.url("/info/index.json"),
                                      params={"itemsPerPage": 1000})
            r.raise_for_status()
            return r.json()

        payload = await self.with_retry(_call, what="ERDDAP catalogue")
        table = payload.get("table", {})
        cols, rows = table.get("columnNames", []), table.get("rows", [])
        if "Dataset ID" not in cols:
            return []
        idx = cols.index("Dataset ID")
        return [r[idx] for r in rows if r[idx] not in ("allDatasets",)]

    async def fetch(self) -> Sequence[dict]:
        ids = self.dataset_ids or await self.discover()
        if not ids:
            raise SourceUnavailable(self.source_key, "ERDDAP catalogue returned no datasets")

        since = (datetime.now(UTC) - timedelta(hours=self.lookback_hours)).strftime(
            "%Y-%m-%dT%H:%M:%SZ")
        out: list[dict] = []
        for ds in ids[:8]:                      # bounded: be a good citizen
            try:
                async def _call(ds=ds):
                    r = await self.client.get(self.url(f"/tabledap/{ds}.json"),
                                              params={"time>=": since})
                    r.raise_for_status()
                    return r.json()

                payload = await self.with_retry(_call, what=f"tabledap {ds}")
            except SourceUnavailable:
                continue                        # one dataset failing is not the source failing
            table = payload.get("table", {})
            for row in table.get("rows", []):
                out.append({"dataset": ds, "columns": table.get("columnNames", []),
                            "units": table.get("columnUnits", []), "row": row})
        return out

    def validate(self, raw: dict) -> list[ValidationIssue]:
        cols = raw.get("columns") or []
        if "time" not in cols:
            return [ValidationIssue("time", "no_time_column")]
        if len(raw.get("row") or []) != len(cols):
            return [ValidationIssue("row", "column_count_mismatch")]
        return []

    def normalize(self, raw: dict) -> dict:
        cols, row = raw["columns"], raw["row"]
        rec = dict(zip(cols, row, strict=True))
        observed = datetime.fromisoformat(str(rec["time"]).replace("Z", "+00:00")).astimezone(UTC)
        lat = _first(rec, ("latitude", "lat"))
        lon = _first(rec, ("longitude", "lon"))
        value_key = next((c for c in cols if c not in
                          ("time", "latitude", "longitude", "lat", "lon", "depth")), None)
        p = self.provenance(source_id=f"{raw['dataset']}@{rec['time']}", observed_at=observed)
        units = dict(zip(cols, raw.get("units") or [], strict=False))
        return {
            **p.as_dict(),
            "cell_id": None,
            "geojson": (json.dumps({"type": "Point", "coordinates": [float(lon), float(lat)]})
                        if lat is not None and lon is not None else None),
            "product": f"incois:{raw['dataset']}:{value_key}",
            "value": _num(rec.get(value_key)),
            "unit": units.get(value_key),
            "instrument": "INCOIS ERDDAP",
            "raw": json.dumps({"dataset": raw["dataset"]}),
        }

    async def store(self, records: Sequence[dict]) -> int:
        if not records:
            return 0
        async with session_scope() as s:
            return await insert_satellite(s, records)


def _first(d: dict, keys):
    for k in keys:
        if d.get(k) is not None:
            return d[k]
    return None


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
