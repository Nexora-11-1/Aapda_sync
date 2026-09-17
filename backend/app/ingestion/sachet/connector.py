"""
SACHET connector — NDMA's National Disaster Alert Portal.

This is the only source in the platform whose output may be shown to a citizen
as an **official warning**. Everything the model produces is labelled
"AI-based risk prediction and decision support" instead (§1, §32.7).

SACHET publishes CAP (Common Alerting Protocol) 1.2. The feed path is supplied
by configuration; the parser below is against the CAP standard, which is
published and stable, so it is real code rather than a stub. What it will not do
is assume a feed path — `AAPDA_SOURCE_SACHET_FEED_PATH` must name it.

The issuing authority (`<senderName>`) is carried through verbatim into
`government_alerts.issuing_authority` and rendered on every surface that shows
the alert. We never re-attribute an alert to AapdaSync.
"""
from __future__ import annotations

import json
import os
import re
from collections.abc import Sequence
from datetime import UTC, datetime
from xml.etree import ElementTree as ET

from app.db.repositories import upsert_alerts
from app.db.session import session_scope
from app.ingestion.base import (
    DataConnector,
    SourceState,
    SourceUnavailable,
    ValidationIssue,
    register,
)

CAP_NS = {"cap": "urn:oasis:names:tc:emergency:cap:1.2"}

# CAP <event> text → our hazard taxonomy. Anything unmatched becomes 'other'
# rather than being force-fitted into a hazard we then model wrongly.
HAZARD_MAP: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(flood|inundat|deluge|waterlog)", re.I), "flood"),
    (re.compile(r"\b(landslide|landslip|mudslide|rockfall|debris flow)", re.I), "landslide"),
    (re.compile(r"\b(earthquake|seismic|tremor)", re.I), "earthquake"),
    (re.compile(r"\b(cyclone|depression|storm surge|hurricane)", re.I), "cyclone"),
    (re.compile(r"\b(wildfire|forest fire|bushfire)", re.I), "wildfire"),
    (re.compile(r"\b(heat ?wave|heat)", re.I), "heatwave"),
    (re.compile(r"\b(drought)", re.I), "drought"),
    (re.compile(r"\b(lightning|thunderstorm)", re.I), "lightning"),
    (re.compile(r"\b(tsunami)", re.I), "tsunami"),
]


@register
class SachetConnector(DataConnector[ET.Element, dict]):
    source_key = "sachet"
    produces = "government_alerts"

    def _feed_path(self) -> str:
        path = os.environ.get("AAPDA_SOURCE_SACHET_FEED_PATH", "").strip()
        if not path:
            raise SourceUnavailable(
                self.source_key,
                "SACHET feed path is not configured. Set AAPDA_SOURCE_SACHET_FEED_PATH to the "
                "CAP/RSS path published at sachet.ndma.gov.in/CapFeed. This connector does not "
                "guess feed paths.",
                SourceState.NOT_CONFIGURED,
            )
        return path

    async def fetch(self) -> Sequence[ET.Element]:
        async def _call():
            r = await self.client.get(self.url(self._feed_path()),
                                      headers={"Accept": "application/xml, text/xml, */*"})
            r.raise_for_status()
            return r.text

        body = await self.with_retry(_call, what="CAP feed")
        try:
            root = ET.fromstring(body)
        except ET.ParseError as exc:
            raise SourceUnavailable(self.source_key, f"feed is not well-formed XML: {exc}") from exc

        # Either a bare <alert> or an RSS/Atom envelope containing them
        if root.tag.endswith("}alert") or root.tag == "alert":
            return [root]
        alerts = root.findall(".//cap:alert", CAP_NS) or root.findall(".//alert")
        return alerts

    # ── validation ────────────────────────────────────────────────────
    def validate(self, raw: ET.Element) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        if _text(raw, "identifier") is None:
            issues.append(ValidationIssue("identifier", "missing_cap_identifier"))
        if _text(raw, "sent") is None:
            issues.append(ValidationIssue("sent", "missing_sent_timestamp"))
        if raw.find("cap:info", CAP_NS) is None and raw.find("info") is None:
            issues.append(ValidationIssue("info", "no_info_block"))
        status = _text(raw, "status")
        # Exercise/Test/Draft alerts must never reach a citizen surface
        if status in ("Exercise", "Test", "Draft", "System"):
            issues.append(ValidationIssue("status", f"non_actual_status:{status}", status))
        return issues

    # ── normalisation ─────────────────────────────────────────────────
    def normalize(self, raw: ET.Element) -> dict:
        identifier = _text(raw, "identifier")
        sent = _dt(_text(raw, "sent"))
        info = raw.find("cap:info", CAP_NS) or raw.find("info")

        event = _text(info, "event") or ""
        hazard = "other"
        for pattern, name in HAZARD_MAP:
            if pattern.search(event) or pattern.search(_text(info, "headline") or ""):
                hazard = name
                break

        area = info.find("cap:area", CAP_NS) if info is not None else None
        if area is None and info is not None:
            area = info.find("area")

        p = self.provenance(
            source_id=identifier, observed_at=sent,
            # certainty is CAP's own statement about the alert; we mirror it
            confidence=_certainty_to_confidence(_text(info, "certainty")),
        )
        return {
            **p.as_dict(),
            "issuing_authority": (_text(info, "senderName")
                                  or _text(raw, "sender")
                                  or "NDMA / SACHET"),
            "effective_at": _dt(_text(info, "effective")) or sent,
            "expires_at": _dt(_text(info, "expires")),
            "hazard": hazard,
            "cap_event": event,
            "severity": _text(info, "severity"),
            "urgency": _text(info, "urgency"),
            "certainty": _text(info, "certainty"),
            "headline": _text(info, "headline"),
            "description": _text(info, "description"),
            "instruction": _text(info, "instruction"),
            "area_desc": _text(area, "areaDesc"),
            "geojson": _area_geojson(area),
            "language": _text(info, "language") or "en",
            "web_url": _text(info, "web"),
            "raw": json.dumps({"cap_identifier": identifier, "status": _text(raw, "status"),
                               "msgType": _text(raw, "msgType"), "scope": _text(raw, "scope")}),
        }

    async def store(self, records: Sequence[dict]) -> int:
        if not records:
            return 0
        async with session_scope() as s:
            return await upsert_alerts(s, records)


# ── CAP helpers ───────────────────────────────────────────────────────
def _text(el: ET.Element | None, tag: str) -> str | None:
    if el is None:
        return None
    node = el.find(f"cap:{tag}", CAP_NS)
    if node is None:
        node = el.find(tag)
    return node.text.strip() if node is not None and node.text else None


def _dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None


def _certainty_to_confidence(certainty: str | None) -> float:
    return {"Observed": 0.99, "Likely": 0.90, "Possible": 0.75,
            "Unlikely": 0.55, "Unknown": 0.70}.get(certainty or "", 0.85)


def _area_geojson(area: ET.Element | None) -> str | None:
    """CAP <polygon>/<circle> → GeoJSON. CAP is lat,lon; GeoJSON is lon,lat."""
    if area is None:
        return None
    poly = _text(area, "polygon")
    if poly:
        try:
            ring = [[float(lon), float(lat)]
                    for lat, lon in (pair.split(",") for pair in poly.split())]
            if ring and ring[0] != ring[-1]:
                ring.append(ring[0])
            return json.dumps({"type": "Polygon", "coordinates": [ring]})
        except ValueError:
            return None
    circle = _text(area, "circle")
    if circle:
        try:
            centre, radius_km = circle.split()
            lat, lon = (float(x) for x in centre.split(","))
            # A point plus a radius attribute; the DB buffers it at query time
            return json.dumps({"type": "Point", "coordinates": [lon, lat],
                               "properties": {"radius_km": float(radius_km)}})
        except ValueError:
            return None
    return None
