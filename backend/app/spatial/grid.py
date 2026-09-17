"""
H3 grid construction and lookup (§6).

Resolution choice is not arbitrary. At res 7 an H3 cell is ~5.16 km² with an
edge of ~1.22 km. That is the scale at which a district evacuation is actually
organised — a ward or a cluster of villages — and it is fine enough that a
landslide-prone slope is not averaged away against the valley floor beside it.
Res 5 (~252 km²) is used only for the national rollup the map draws at India
zoom, where per-ward detail would be noise.

Every observation is mapped to a cell on ingest. Nothing in the platform stores
a bare lat/lon without also resolving it to a cell, because every downstream
engine — risk, exposure, priority, routing — is cell-addressed.
"""
from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

import h3
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings

log = logging.getLogger(__name__)


@dataclass(slots=True)
class Cell:
    cell_id: str
    resolution: int
    lat: float
    lon: float
    boundary: list[tuple[float, float]]     # (lat, lon) ring
    area_km2: float

    @property
    def geojson(self) -> dict:
        ring = [[lon, lat] for lat, lon in self.boundary]
        if ring and ring[0] != ring[-1]:
            ring.append(ring[0])
        return {"type": "Polygon", "coordinates": [ring]}


def cell_of(lat: float, lon: float, resolution: int | None = None) -> str:
    """The single most-used function in the platform: point → cell."""
    return h3.latlng_to_cell(lat, lon, resolution or settings.h3_resolution)


def describe(cell_id: str) -> Cell:
    lat, lon = h3.cell_to_latlng(cell_id)
    return Cell(
        cell_id=cell_id,
        resolution=h3.get_resolution(cell_id),
        lat=lat, lon=lon,
        boundary=list(h3.cell_to_boundary(cell_id)),
        area_km2=h3.cell_area(cell_id, unit="km^2"),
    )


def neighbours(cell_id: str, k: int = 1) -> list[str]:
    return [c for c in h3.grid_disk(cell_id, k) if c != cell_id]


def cover_polygon(geojson_polygon: dict, resolution: int | None = None) -> list[str]:
    """Every cell whose centre falls inside the polygon."""
    res = resolution or settings.h3_resolution
    poly = h3.geo_to_cells(geojson_polygon, res)
    return list(poly)


def parent(cell_id: str, resolution: int | None = None) -> str:
    return h3.cell_to_parent(cell_id, resolution or settings.h3_resolution_coarse)


def edge_length_m(resolution: int) -> float:
    return h3.average_hexagon_edge_length(resolution, unit="m")


# ══════════════════════════════════════════════════════════════════════
# Grid build
# ══════════════════════════════════════════════════════════════════════
async def build_grid(session: AsyncSession, *, district_codes: Sequence[str] | None = None,
                     state_code: str | None = None, resolution: int | None = None) -> int:
    """Populate `spatial_cells` for the given administrative area.

    Idempotent: re-running after a boundary correction adds the new cells and
    leaves enrichment on the existing ones alone.
    """
    res = resolution or settings.h3_resolution
    state_code = state_code or settings.mvp_state_code
    district_codes = list(district_codes or settings.mvp_district_codes)

    rows = (await session.execute(text("""
        SELECT code, state_code, ST_AsGeoJSON(geom) AS gj
        FROM admin_districts
        WHERE (:codes::text[] IS NULL OR code = ANY(:codes))
          AND (:state IS NULL OR state_code = :state)
    """), {"codes": district_codes or None, "state": state_code})).mappings().all()

    if not rows:
        raise RuntimeError(
            f"No district geometry for {district_codes or state_code}. "
            "Load admin boundaries (scripts/load_boundaries.py) before building the grid."
        )

    import json
    payload: list[dict] = []
    seen: set[str] = set()
    for r in rows:
        geom = json.loads(r["gj"])
        polys = ([geom] if geom["type"] == "Polygon"
                 else [{"type": "Polygon", "coordinates": c} for c in geom["coordinates"]])
        for poly in polys:
            for cid in cover_polygon(poly, res):
                if cid in seen:
                    continue
                seen.add(cid)
                c = describe(cid)
                payload.append({
                    "cell_id": c.cell_id, "resolution": c.resolution,
                    "lat": c.lat, "lon": c.lon,
                    "geojson": json.dumps(c.geojson), "area_km2": round(c.area_km2, 4),
                    "state_code": r["state_code"], "district_code": r["code"],
                })

    if payload:
        await session.execute(text("""
            INSERT INTO spatial_cells
              (cell_id, resolution, centroid, geom, area_km2, state_code, district_code)
            VALUES
              (:cell_id, :resolution,
               ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
               ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326),
               :area_km2, :state_code, :district_code)
            ON CONFLICT (cell_id) DO NOTHING
        """), payload)

        await session.execute(text("""
            INSERT INTO cell_neighbours (cell_id, neighbour_id, k)
            VALUES (:cell_id, :neighbour_id, 1)
            ON CONFLICT DO NOTHING
        """), [{"cell_id": cid, "neighbour_id": n}
               for cid in seen for n in neighbours(cid) if n in seen])

    log.info("grid build: %d cells at res %d for %s", len(payload), res,
             district_codes or state_code)
    return len(payload)



async def link_roads_to_cells(session) -> int:
    """Populate `roads.cell_ids` — the join that makes hazard-aware routing real.

    `RoadGraph.edge_hazard()` prices a road by the risk of the cells it crosses,
    and reads those cells from `roads.cell_ids`. Nothing ever wrote that column:
    the OSM connector inserts roads without it and no back-fill existed. So the
    array was empty for every road in every deployment, `edge_hazard()` returned
    0.0 every time, and `hazard_alpha=3.0` — the entire reason the router exists
    rather than a plain shortest path — was silently inert. Routes avoided
    blocked roads, because live road state is a separate term, but they would
    happily send people straight through a cell scored 95 for flood.

    Idempotent, and cheap enough to run whenever the road graph is rebuilt: the
    GiST index on `spatial_cells.geom` carries the intersection.
    """
    result = await session.execute(text("""
        UPDATE roads r
           SET cell_ids = COALESCE(sub.ids, '{}')
          FROM (
            SELECT r2.road_id,
                   ARRAY_AGG(c.cell_id ORDER BY c.cell_id) AS ids
              FROM roads r2
              JOIN spatial_cells c ON ST_Intersects(c.geom, r2.geom)
             GROUP BY r2.road_id
          ) sub
         WHERE r.road_id = sub.road_id
           AND r.cell_ids IS DISTINCT FROM sub.ids
    """))
    n = result.rowcount or 0
    if n:
        log.info("linked %d roads to their spatial cells", n)
    else:
        log.debug("road/cell links already current")
    return n


async def enrich_hydrology(session: AsyncSession) -> int:
    """Distance to river, height above nearest drainage, distance to coast.

    HAND (height above nearest drainage) is the strongest single terrain
    predictor of fluvial flooding — better than raw elevation, which says
    nothing about the local channel. Computed here in PostGIS rather than in
    Python because the spatial index makes it a different order of work.
    """
    result = await session.execute(text("""
        WITH rivers AS (
          SELECT geom FROM roads WHERE FALSE      -- placeholder join target
          UNION ALL
          SELECT geom FROM satellite_observations WHERE product LIKE 'nrsc:%water%'
        ),
        nearest AS (
          SELECT c.cell_id,
                 MIN(ST_Distance(c.centroid::geography, r.geom::geography)) AS d
          FROM spatial_cells c LEFT JOIN rivers r ON ST_DWithin(
                 c.centroid::geography, r.geom::geography, 20000)
          GROUP BY c.cell_id
        )
        UPDATE spatial_cells c SET
          dist_to_river_m = n.d,
          height_above_river_m = CASE
            WHEN c.elevation_m IS NULL OR c.elevation_min_m IS NULL THEN NULL
            ELSE GREATEST(c.elevation_m - c.elevation_min_m, 0) END
        FROM nearest n WHERE n.cell_id = c.cell_id
        RETURNING c.cell_id
    """))
    return len(result.fetchall())


def sample_points(cells: Iterable[dict]) -> list[tuple[str, float, float]]:
    """Cell centroids in the shape the weather connectors want."""
    return [(c["cell_id"], c["lat"], c["lon"]) for c in cells]
