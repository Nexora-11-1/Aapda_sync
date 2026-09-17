"""
NRSC / Bhuvan connector — ISRO's Earth-observation disaster products.

Bhuvan serves OGC WMS. OGC is a published standard, so the *protocol* here is
real code: a GetCapabilities call discovers the layers the account can actually
see, and GetMap/GetFeatureInfo pulls them. What is not hardcoded is any layer
name — layers are discovered, then filtered by the patterns in
`AAPDA_SOURCE_NRSC_LAYER_PATTERNS`.

Disaster-services products (flood inundation, landslide inventory) generally
require a Bhuvan account. Without one, GetCapabilities returns the open subset
and the connector works on that, reporting DEGRADED rather than failing.
"""
from __future__ import annotations

import json
import os
import re
from collections.abc import Sequence
from datetime import UTC, datetime
from xml.etree import ElementTree as ET

from app.db.repositories import insert_satellite
from app.db.session import session_scope
from app.ingestion.base import DataConnector, SourceUnavailable, ValidationIssue, register

DEFAULT_PATTERNS = r"flood|inundat|landslide|lulc|land_use|water_body"


@register
class NRSCConnector(DataConnector[dict, dict]):
    source_key = "nrsc"
    produces = "satellite_observations"

    def __init__(self, *a, bbox: tuple[float, float, float, float] | None = None,
                 wms_path: str | None = None, **kw):
        super().__init__(*a, **kw)
        self.bbox = bbox or (78.60, 29.85, 80.00, 31.10)   # minx, miny, maxx, maxy
        # WMS endpoint path is configuration, not a guess
        self.wms_path = wms_path or os.environ.get("AAPDA_SOURCE_NRSC_WMS_PATH", "")

    async def capabilities(self) -> list[dict]:
        if not self.wms_path:
            raise SourceUnavailable(
                self.source_key,
                "Bhuvan WMS endpoint path is not configured. Set AAPDA_SOURCE_NRSC_WMS_PATH "
                "to the service path from the Bhuvan WMS documentation.",
                "not_configured",
            )

        async def _call():
            r = await self.client.get(self.url(self.wms_path), params={
                "service": "WMS", "request": "GetCapabilities", "version": "1.3.0"})
            r.raise_for_status()
            return r.text

        xml = await self.with_retry(_call, what="WMS GetCapabilities")
        try:
            root = ET.fromstring(xml)
        except ET.ParseError as exc:
            raise SourceUnavailable(self.source_key, f"GetCapabilities is not XML: {exc}") from exc

        ns = {"wms": "http://www.opengis.net/wms"}
        out = []
        for layer in root.iter():
            if not layer.tag.endswith("Layer"):
                continue
            name = layer.find("wms:Name", ns) or layer.find("Name")
            title = layer.find("wms:Title", ns) or layer.find("Title")
            if name is not None and name.text:
                out.append({"name": name.text, "title": (title.text if title is not None else "")})
        return out

    async def fetch(self) -> Sequence[dict]:
        patterns = re.compile(
            os.environ.get("AAPDA_SOURCE_NRSC_LAYER_PATTERNS", DEFAULT_PATTERNS), re.I)
        layers = [layer for layer in await self.capabilities()
                  if patterns.search(layer["name"]) or patterns.search(layer["title"])]
        if not layers:
            raise SourceUnavailable(
                self.source_key,
                "no disaster-relevant WMS layers visible to this account; a Bhuvan account "
                "is required for the disaster-services products",
                "not_configured",
            )

        bbox = ",".join(f"{v}" for v in self.bbox)
        out: list[dict] = []
        for layer in layers[:10]:
            async def _call(layer=layer):
                r = await self.client.get(self.url(self.wms_path), params={
                    "service": "WMS", "request": "GetFeatureInfo", "version": "1.3.0",
                    "layers": layer["name"], "query_layers": layer["name"],
                    "crs": "EPSG:4326", "bbox": bbox,
                    "width": 256, "height": 256, "i": 128, "j": 128,
                    "info_format": "application/json",
                })
                r.raise_for_status()
                return r.json()

            try:
                payload = await self.with_retry(_call, what=f"GetFeatureInfo {layer['name']}")
            except SourceUnavailable:
                continue
            for feature in payload.get("features", []):
                out.append({"layer": layer["name"], "title": layer["title"], "feature": feature})
        return out

    def validate(self, raw: dict) -> list[ValidationIssue]:
        if not raw.get("feature"):
            return [ValidationIssue("feature", "empty_feature")]
        return []

    def normalize(self, raw: dict) -> dict:
        f = raw["feature"]
        props = f.get("properties") or {}
        value = next((v for v in props.values() if isinstance(v, int | float)), None)
        p = self.provenance(source_id=f"{raw['layer']}:{f.get('id')}",
                            observed_at=datetime.now(UTC), confidence=0.90)
        return {
            **p.as_dict(),
            "cell_id": None,
            "geojson": json.dumps(f["geometry"]) if f.get("geometry") else None,
            "product": f"nrsc:{raw['layer']}",
            "value": value, "unit": None,
            "instrument": f"Bhuvan WMS · {raw['title'] or raw['layer']}",
            "raw": json.dumps({"properties": props}),
        }

    async def store(self, records: Sequence[dict]) -> int:
        if not records:
            return 0
        async with session_scope() as s:
            return await insert_satellite(s, records)
