"""
GDACS — Global Disaster Alert and Coordination System (JRC / UN OCHA).

One public, keyless feed covering five of our nine hazards: tropical cyclone,
flood, earthquake, drought and wildfire. Documented endpoint:

    GET /Events/geteventlist/SEARCH
        ?eventlist=TC;FL;EQ;DR;WF
        &fromdate=YYYY-MM-DD&todate=YYYY-MM-DD
        &alertlevel=Green;Orange;Red

GeoJSON out, 100 records per page, no authentication.

**Standing.** GDACS is an international *coordination* feed. It is not an Indian
statutory warning, and it must never be rendered on a citizen surface as one.
Its value here is coverage: it keeps cyclone, drought and wildfire live on the
map with no credentials at all, and it corroborates flood and earthquake that we
already get elsewhere. Every record it produces is stored under `source='gdacs'`
and surfaces as *supplementary*.

The alert level is a colour, not a probability. Mapping Red/Orange/Green onto a
0–1 confidence is a judgement, so it is made once, here, and documented — rather
than being invented differently in three places downstream.
"""
from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import text

from app.db.session import session_scope
from app.ingestion.base import (
    DataConnector,
    SourceUnavailable,
    ValidationIssue,
    register,
)

# GDACS event type → our hazard taxonomy. Volcano has no module here, so it is
# ingested as 'other' rather than being forced into a hazard we cannot model.
EVENT_TYPE = {
    "TC": "cyclone", "FL": "flood", "EQ": "earthquake",
    "DR": "drought", "WF": "wildfire", "VO": "other",
}

# GDACS alert colour → the confidence we attach. Red is a high-impact event the
# system is confident about; Green is detected but assessed as low impact.
ALERT_CONFIDENCE = {"Red": 0.95, "Orange": 0.85, "Green": 0.70}
ALERT_SEVERITY = {"Red": "Extreme", "Orange": "Severe", "Green": "Moderate"}

# India plus the Bay of Bengal and Arabian Sea, so a cyclone is picked up while
# it is still over water and heading for the coast.
INDIA_BOUNDS = (5.0, 60.0, 40.0, 100.0)      # south, west, north, east


@register
class GDACSConnector(DataConnector[dict, dict]):
    source_key = "gdacs"
    produces = "government_alerts"

    def __init__(self, *a, event_types: Sequence[str] = (), lookback_days: int = 7,
                 alert_levels: Sequence[str] = ("Red", "Orange", "Green"), **kw):
        super().__init__(*a, **kw)
        self.event_types = list(event_types) or ["TC", "FL", "EQ", "DR", "WF"]
        self.lookback_days = lookback_days
        self.alert_levels = list(alert_levels)

    async def fetch(self) -> Sequence[dict]:
        today = date.today()
        params = {
            "eventlist": ";".join(self.event_types),
            "fromdate": (today - timedelta(days=self.lookback_days)).isoformat(),
            "todate": (today + timedelta(days=1)).isoformat(),
            "alertlevel": ";".join(self.alert_levels),
            "pagesize": 100,
        }

        async def _call():
            r = await self.client.get(self.url("/Events/geteventlist/SEARCH"),
                                      params=params,
                                      headers={"Accept": "application/json"})
            r.raise_for_status()
            return r.json()

        payload = await self.with_retry(_call, what="GDACS event list")
        features = payload.get("features") if isinstance(payload, dict) else payload
        if features is None:
            raise SourceUnavailable(self.source_key,
                                    "unexpected response shape from GDACS event list")

        south, west, north, east = INDIA_BOUNDS
        inside = []
        for f in features:
            coords = ((f.get("geometry") or {}).get("coordinates") or [None, None])
            try:
                lon, lat = float(coords[0]), float(coords[1])
            except (TypeError, ValueError):
                continue
            if south <= lat <= north and west <= lon <= east:
                inside.append(f)
        return inside

    def validate(self, raw: dict) -> list[ValidationIssue]:
        props = raw.get("properties") or {}
        issues: list[ValidationIssue] = []
        if not props.get("eventid"):
            issues.append(ValidationIssue("eventid", "missing_event_id"))
        if not props.get("eventtype"):
            issues.append(ValidationIssue("eventtype", "missing_event_type"))
        if props.get("eventtype") not in EVENT_TYPE:
            issues.append(ValidationIssue(
                "eventtype", f"unmapped_event_type:{props.get('eventtype')}"))
        if not (props.get("fromdate") or props.get("datemodified")):
            issues.append(ValidationIssue("fromdate", "missing_timestamp"))
        return issues

    def normalize(self, raw: dict) -> dict:
        props = raw["properties"]
        geom = raw.get("geometry") or {}
        level = (props.get("alertlevel") or "Green").capitalize()
        hazard = EVENT_TYPE.get(props["eventtype"], "other")
        observed = _dt(props.get("fromdate") or props.get("datemodified"))

        p = self.provenance(
            source_id=f"GDACS-{props['eventtype']}-{props['eventid']}",
            observed_at=observed,
            confidence=ALERT_CONFIDENCE.get(level, 0.7),
        )

        name = props.get("eventname") or props.get("name") or ""
        country = props.get("country") or ""
        headline = (f"{props.get('htmldescription') or name or hazard.title()}"
                    f"{f' — {country}' if country else ''}").strip()

        return {
            **p.as_dict(),
            # The issuing authority is GDACS itself. It is stated plainly so no
            # surface can present this as an IMD or NDMA warning.
            "issuing_authority": "GDACS (JRC / UN OCHA) — international coordination feed",
            "effective_at": observed,
            "expires_at": _dt(props.get("todate")),
            "hazard": hazard,
            "cap_event": f"{props['eventtype']} · {name}" if name else props["eventtype"],
            "severity": ALERT_SEVERITY.get(level, "Unknown"),
            "urgency": "Immediate" if level == "Red" else "Expected",
            "certainty": "Observed",
            "headline": headline[:500] or f"{hazard.title()} event",
            "description": _clean(props.get("description")
                                  or props.get("htmldescription")),
            "instruction": None,      # GDACS does not issue public instructions
            "area_desc": country or None,
            "geojson": json.dumps(geom) if geom.get("coordinates") else None,
            "language": "en",
            "web_url": props.get("url", {}).get("report") if isinstance(
                props.get("url"), dict) else props.get("url"),
            "raw": json.dumps({
                "eventid": props.get("eventid"),
                "episodeid": props.get("episodeid"),
                "eventtype": props.get("eventtype"),
                "alertlevel": level,
                "alertscore": props.get("alertscore"),
                "severity": props.get("severitydata"),
                "iscurrent": props.get("iscurrent"),
                "standing": "supplementary — not an Indian statutory warning",
            }),
        }

    async def store(self, records: Sequence[dict]) -> int:
        if not records:
            return 0
        # GDACS events go into government_alerts because that is the table whose
        # shape they fit, but they carry their own issuing authority and are
        # filtered out of the citizen alert surface by source.
        from app.db.repositories import upsert_alerts
        async with session_scope() as s:
            n = await upsert_alerts(s, records)
            # Also register the significant ones as disaster events so the
            # national map has something to draw outside the MVP district.
            declared = [r for r in records
                        if r["severity"] in ("Extreme", "Severe") and r["geojson"]]
            if declared:
                await s.execute(text("""
                    INSERT INTO disaster_events
                      (event_id, hazard, declared_at, start_time, severity,
                       geom, source, confidence, headline, notes)
                    VALUES (:event_id, CAST(:hazard AS hazard_type), :declared_at,
                            :declared_at, CAST(:severity AS risk_level),
                            ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326),
                            'gdacs', :confidence, :headline,
                            'Ingested from the GDACS coordination feed. Not an Indian '
                            'statutory declaration.')
                    ON CONFLICT (event_id) DO UPDATE SET
                      severity = EXCLUDED.severity,
                      headline = EXCLUDED.headline
                """), [{
                    "event_id": r["source_id"], "hazard": r["hazard"],
                    "declared_at": r["observed_at"],
                    "severity": "critical" if r["severity"] == "Extreme" else "high",
                    "geojson": r["geojson"], "confidence": r["confidence"],
                    "headline": r["headline"],
                } for r in declared])
            return n


def _dt(value) -> datetime:
    if not value:
        return datetime.now(UTC)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return datetime.now(UTC)


def _clean(value) -> str | None:
    if not value:
        return None
    import re
    return re.sub(r"<[^>]+>", " ", str(value)).strip()[:4000] or None
