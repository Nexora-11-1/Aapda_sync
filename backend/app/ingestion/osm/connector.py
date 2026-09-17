"""
OpenStreetMap connector — the road graph, shelters and hospitals (§16, §18).

Overpass is public and documented. It is also a free service running on donated
hardware, so this connector is deliberately slow and cached: `poll_seconds` is a
day, the rate limit is 2/min, and the bounding box is the MVP district set, not
India.

Three extractions, one connector, because they share a query budget:
  · highways        → road_nodes + roads (the routing graph)
  · shelter candidates → schools, community centres, cyclone shelters
  · hospitals       → hospitals and clinics

Capacity is *not* invented. OSM rarely carries occupancy, so `max_capacity` is
derived from building footprint area where available and otherwise left NULL —
a shelter with unknown capacity is shown as unknown, never as a guess, and the
capacity engine excludes it from allocation until an operator sets it (§19).
"""
from __future__ import annotations

import json
import math
from collections.abc import Sequence

from sqlalchemy import text

from app.db.session import session_scope
from app.ingestion.base import DataConnector, SourceUnavailable, ValidationIssue, register

# Overpass QL. Bounding box is substituted, never the query shape.
QUERY = """
[out:json][timeout:180];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track)$"]({bbox});
  node["amenity"~"^(hospital|clinic)$"]({bbox});
  way["amenity"~"^(hospital|clinic)$"]({bbox});
  node["amenity"~"^(school|college|community_centre|shelter)$"]({bbox});
  way["amenity"~"^(school|college|community_centre|shelter)$"]({bbox});
  way["building"="civic"]({bbox});
);
out body geom;
"""

# Free-flow speed by class, km/h. Hill-state values: these are Uttarakhand
# roads, not plains highways, and the routing engine's ETAs are only as
# honest as these numbers.
SPEED_KPH = {
    "motorway": 70, "trunk": 55, "primary": 45, "secondary": 38,
    "tertiary": 30, "unclassified": 24, "residential": 20,
    "service": 15, "track": 10,
}
# Persons per hour a road class can carry on foot + vehicle mix during evacuation
CAPACITY_PPH = {
    "motorway": 4000, "trunk": 3000, "primary": 2200, "secondary": 1500,
    "tertiary": 1000, "unclassified": 600, "residential": 400,
    "service": 250, "track": 120,
}


@register
class OSMConnector(DataConnector[dict, dict]):
    source_key = "overpass"
    produces = "infrastructure"

    def __init__(self, *a, bbox: tuple[float, float, float, float] | None = None, **kw):
        super().__init__(*a, **kw)
        # (south, west, north, east) — Chamoli/Rudraprayag/Pauri envelope by default
        self.bbox = bbox or (29.85, 78.60, 31.10, 80.00)

    async def fetch(self) -> Sequence[dict]:
        bbox = ",".join(f"{v:.5f}" for v in self.bbox)

        async def _call():
            r = await self.client.post(self.url("/interpreter"),
                                       content=QUERY.format(bbox=bbox).encode(),
                                       timeout=200.0)
            r.raise_for_status()
            return r.json()

        payload = await self.with_retry(_call, what="Overpass query")
        elements = payload.get("elements", [])
        if not elements:
            raise SourceUnavailable(self.source_key, "Overpass returned no elements for the bbox")
        return elements

    def validate(self, raw: dict) -> list[ValidationIssue]:
        if raw.get("type") == "way":
            geom = raw.get("geometry") or []
            if len(geom) < 2:
                return [ValidationIssue("geometry", "way_with_fewer_than_two_nodes")]
        elif raw.get("type") == "node":
            if raw.get("lat") is None or raw.get("lon") is None:
                return [ValidationIssue("geometry", "node_without_coordinates")]
        else:
            return [ValidationIssue("type", f"unsupported_element:{raw.get('type')}")]
        return []

    def normalize(self, raw: dict) -> dict:
        tags = raw.get("tags") or {}
        if raw["type"] == "way" and "highway" in tags:
            return self._road(raw, tags)
        return self._point_feature(raw, tags)

    # ── roads ─────────────────────────────────────────────────────────
    def _road(self, raw: dict, tags: dict) -> dict:
        geom = raw["geometry"]
        coords = [(p["lon"], p["lat"]) for p in geom]
        length = sum(_haversine(coords[i], coords[i + 1]) for i in range(len(coords) - 1))
        hw = tags.get("highway", "unclassified")
        lanes = _int(tags.get("lanes"))
        maxspeed = _int((tags.get("maxspeed") or "").split()[0] if tags.get("maxspeed") else None)
        return {
            "kind": "road",
            "road_id": raw["id"],
            "name": tags.get("name"),
            "highway_class": hw,
            "from_node": raw.get("nodes", [None])[0],
            "to_node": raw.get("nodes", [None])[-1],
            "nodes": raw.get("nodes", []),
            "coords": coords,
            "length_m": round(length, 2),
            "free_flow_kph": float(maxspeed or SPEED_KPH.get(hw, 24)),
            "lanes": lanes,
            "capacity_pph": CAPACITY_PPH.get(hw, 400) * (lanes or 1) // max(lanes or 1, 1),
            "bridge": tags.get("bridge") in ("yes", "viaduct"),
            "oneway": tags.get("oneway") == "yes",
        }

    # ── shelters and hospitals ────────────────────────────────────────
    def _point_feature(self, raw: dict, tags: dict) -> dict:
        if raw["type"] == "node":
            lon, lat = raw["lon"], raw["lat"]
            area_m2 = None
        else:
            geom = raw["geometry"]
            lon = sum(p["lon"] for p in geom) / len(geom)
            lat = sum(p["lat"] for p in geom) / len(geom)
            area_m2 = _polygon_area_m2([(p["lon"], p["lat"]) for p in geom])

        amenity = tags.get("amenity")
        if amenity in ("hospital", "clinic"):
            return {
                "kind": "hospital",
                "hospital_id": f"osm:{raw['type']}:{raw['id']}",
                "name": tags.get("name") or f"Unnamed {amenity}",
                "lon": lon, "lat": lat,
                "beds_total": _int(tags.get("beds")),
                "icu_total": None,
                "has_trauma": amenity == "hospital" and tags.get("emergency") == "yes",
                "contact": tags.get("phone") or tags.get("contact:phone"),
            }
        return {
            "kind": "shelter",
            "shelter_id": f"osm:{raw['type']}:{raw['id']}",
            "name": tags.get("name") or f"Unnamed {amenity or 'civic building'}",
            "lon": lon, "lat": lat,
            "building_type": amenity or tags.get("building"),
            # 3.5 m² of usable floor per person is the common relief-camp planning
            # figure; applied only when a real footprint exists, and never a guess
            # when it does not.
            "max_capacity": int(area_m2 / 3.5) if area_m2 and area_m2 > 40 else None,
            "accessible": tags.get("wheelchair") in ("yes", "limited"),
            "contact": tags.get("phone") or tags.get("contact:phone"),
        }

    # ── store ─────────────────────────────────────────────────────────
    async def store(self, records: Sequence[dict]) -> int:
        roads = [r for r in records if r["kind"] == "road"]
        shelters = [r for r in records if r["kind"] == "shelter"]
        hospitals = [r for r in records if r["kind"] == "hospital"]
        n = 0
        async with session_scope() as s:
            # nodes first — roads reference them
            nodes: dict[int, tuple[float, float]] = {}
            for r in roads:
                if r["nodes"] and r["coords"] and len(r["nodes"]) == len(r["coords"]):
                    nodes[r["nodes"][0]] = r["coords"][0]
                    nodes[r["nodes"][-1]] = r["coords"][-1]
            if nodes:
                await s.execute(text("""
                    INSERT INTO road_nodes (node_id, geom)
                    VALUES (:node_id, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))
                    ON CONFLICT (node_id) DO NOTHING
                """), [{"node_id": nid, "lon": c[0], "lat": c[1]} for nid, c in nodes.items()])

            usable = [r for r in roads if r["from_node"] in nodes and r["to_node"] in nodes]
            if usable:
                await s.execute(text("""
                    INSERT INTO roads (road_id, name, highway_class, from_node, to_node, geom,
                                       length_m, free_flow_kph, lanes, capacity_pph, bridge, oneway)
                    VALUES (:road_id, :name, :highway_class, :from_node, :to_node,
                            ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326),
                            :length_m, :free_flow_kph, :lanes, :capacity_pph, :bridge, :oneway)
                    ON CONFLICT (road_id) DO UPDATE SET
                      name = EXCLUDED.name, length_m = EXCLUDED.length_m,
                      free_flow_kph = EXCLUDED.free_flow_kph, geom = EXCLUDED.geom
                """), [{**{k: r[k] for k in
                           ("road_id", "name", "highway_class", "from_node", "to_node",
                            "length_m", "free_flow_kph", "lanes", "capacity_pph",
                            "bridge", "oneway")},
                        "geojson": json.dumps({"type": "LineString",
                                               "coordinates": [list(c) for c in r["coords"]]})}
                       for r in usable])
                n += len(usable)

            if shelters:
                await s.execute(text("""
                    INSERT INTO shelters (shelter_id, name, geom, building_type, max_capacity,
                                          accessible, contact, source)
                    VALUES (:shelter_id, :name, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
                            :building_type, COALESCE(:max_capacity, 0), :accessible, :contact,
                            'overpass')
                    ON CONFLICT (shelter_id) DO UPDATE SET
                      name = EXCLUDED.name, geom = EXCLUDED.geom
                """), shelters)
                n += len(shelters)

            if hospitals:
                await s.execute(text("""
                    INSERT INTO hospitals (hospital_id, name, geom, beds_total, icu_total,
                                           has_trauma, contact, source)
                    VALUES (:hospital_id, :name, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
                            :beds_total, :icu_total, :has_trauma, :contact, 'overpass')
                    ON CONFLICT (hospital_id) DO UPDATE SET
                      name = EXCLUDED.name, geom = EXCLUDED.geom,
                      beds_total = COALESCE(EXCLUDED.beds_total, hospitals.beds_total)
                """), hospitals)
                n += len(hospitals)
        return n


# ── geometry helpers ──────────────────────────────────────────────────
R_EARTH_M = 6_371_008.8


def _haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * R_EARTH_M * math.asin(math.sqrt(h))


def _polygon_area_m2(ring: list[tuple[float, float]]) -> float:
    """Shoelace on a local equirectangular projection. Good enough for a building."""
    if len(ring) < 3:
        return 0.0
    lat0 = math.radians(sum(p[1] for p in ring) / len(ring))
    pts = [((p[0] * math.cos(lat0)) * math.pi / 180 * R_EARTH_M,
            p[1] * math.pi / 180 * R_EARTH_M) for p in ring]
    s = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
            for i in range(len(pts)))
    return abs(s) / 2.0


def _int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None
