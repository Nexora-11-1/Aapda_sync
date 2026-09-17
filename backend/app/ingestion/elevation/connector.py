"""
Terrain and population enrichment (§6).

These are *build-time* connectors, not pollers: they run once per grid build and
write static attributes onto `spatial_cells`. Elevation and population do not
change on a 15-minute cadence, and treating them as if they did would burn
someone else's free API for nothing.

  · OpenTopographyConnector — DEM sample per cell centroid, then slope/aspect/
    ruggedness from the 6 H3 neighbours. Needs a free API key.
  · WorldPopConnector — population per cell from the WorldPop constrained
    100 m raster. Bulk download, no key.

Both degrade honestly: a cell whose elevation could not be resolved keeps
`elevation_m = NULL`, and the landslide model treats a null slope as a missing
feature rather than as zero — a flat-by-default hillside is exactly the failure
mode that gets people killed.
"""
from __future__ import annotations

import math
from collections.abc import Sequence

from sqlalchemy import text

from app.db.session import session_scope
from app.ingestion.base import DataConnector, SourceUnavailable, ValidationIssue, register


@register
class OpenTopographyConnector(DataConnector[dict, dict]):
    source_key = "opentopo"
    produces = "cell_terrain"

    def __init__(self, *a, cells: Sequence[dict] = (), dem_type: str = "COP30", **kw):
        super().__init__(*a, **kw)
        self.cells = list(cells)      # [{cell_id, lat, lon, neighbours:[(lat,lon)…]}]
        self.dem_type = dem_type

    async def fetch(self) -> Sequence[dict]:
        if not self.config.api_key:
            raise SourceUnavailable(
                self.source_key,
                "OpenTopography needs a free API key (portal.opentopography.org). "
                "Set AAPDA_SOURCE_OPENTOPO_API_KEY.", "not_configured")
        if not self.cells:
            raise SourceUnavailable(self.source_key, "no cells supplied; build the H3 grid first",
                                    "not_configured")

        lats = [c["lat"] for c in self.cells]
        lons = [c["lon"] for c in self.cells]
        pad = 0.02

        async def _call():
            r = await self.client.get(self.url("/globaldem"), params={
                "demtype": self.dem_type,
                "south": min(lats) - pad, "north": max(lats) + pad,
                "west": min(lons) - pad, "east": max(lons) + pad,
                "outputFormat": "AAIGrid", "API_Key": self.config.api_key,
            }, timeout=180.0)
            r.raise_for_status()
            return r.text

        grid = await self.with_retry(_call, what="global DEM")
        return [{"grid": grid, "cells": self.cells}]

    def validate(self, raw: dict) -> list[ValidationIssue]:
        if "ncols" not in (raw.get("grid") or "")[:400]:
            return [ValidationIssue("grid", "not_an_aaigrid_response")]
        return []

    def normalize(self, raw: dict) -> list[dict]:
        dem = _AsciiGrid(raw["grid"])
        out = []
        for c in raw["cells"]:
            z = dem.sample(c["lat"], c["lon"])
            if z is None:
                out.append({"cell_id": c["cell_id"], "elevation_m": None, "slope_deg": None,
                            "aspect_deg": None, "terrain_ruggedness": None, "curvature": None,
                            "elevation_min_m": None, "elevation_max_m": None})
                continue
            neigh = [dem.sample(la, lo) for la, lo in c.get("neighbours", [])]
            neigh = [n for n in neigh if n is not None]
            slope, aspect = _slope_aspect(z, neigh, c.get("spacing_m", 1500.0))
            out.append({
                "cell_id": c["cell_id"],
                "elevation_m": round(z, 1),
                "elevation_min_m": round(min(neigh + [z]), 1) if neigh else round(z, 1),
                "elevation_max_m": round(max(neigh + [z]), 1) if neigh else round(z, 1),
                "slope_deg": slope, "aspect_deg": aspect,
                "terrain_ruggedness": (round(sum(abs(n - z) for n in neigh) / len(neigh), 3)
                                       if neigh else None),
                "curvature": (round((sum(neigh) / len(neigh) - z) / max(len(neigh), 1), 4)
                              if neigh else None),
            })
        return out

    async def store(self, records: Sequence[list[dict]]) -> int:
        rows = [r for group in records for r in group]
        if not rows:
            return 0
        async with session_scope() as s:
            await s.execute(text("""
                UPDATE spatial_cells SET
                  elevation_m = :elevation_m, elevation_min_m = :elevation_min_m,
                  elevation_max_m = :elevation_max_m, slope_deg = :slope_deg,
                  aspect_deg = :aspect_deg, terrain_ruggedness = :terrain_ruggedness,
                  curvature = :curvature, enriched_at = now()
                WHERE cell_id = :cell_id
            """), rows)
        return len(rows)


@register
class WorldPopConnector(DataConnector[dict, dict]):
    """Population per cell. Bulk raster; expects a pre-downloaded local GeoTIFF.

    WorldPop's rasters are hundreds of megabytes, so this connector does not pull
    one per run. `AAPDA_WORLDPOP_RASTER` points at a file staged during
    provisioning; without it the connector reports NOT_CONFIGURED and cell
    population stays NULL, which the exposure engine surfaces as "population
    unknown" rather than as zero people at risk.
    """
    source_key = "worldpop"
    produces = "cell_population"

    def __init__(self, *a, cells: Sequence[dict] = (), raster_path: str | None = None, **kw):
        super().__init__(*a, **kw)
        self.cells = list(cells)
        import os
        self.raster_path = raster_path or os.environ.get("AAPDA_WORLDPOP_RASTER", "")

    async def fetch(self) -> Sequence[dict]:
        import os
        if not self.raster_path or not os.path.exists(self.raster_path):
            raise SourceUnavailable(
                self.source_key,
                f"WorldPop raster not staged at {self.raster_path or '<unset>'}. Download the "
                "constrained 100 m India raster from data.worldpop.org during provisioning and "
                "set AAPDA_WORLDPOP_RASTER.", "not_configured")
        if not self.cells:
            raise SourceUnavailable(self.source_key, "no cells supplied", "not_configured")
        return [{"raster": self.raster_path, "cells": self.cells}]

    def validate(self, raw: dict) -> list[ValidationIssue]:
        return []

    def normalize(self, raw: dict) -> list[dict]:
        try:
            import rasterio
            from rasterio.mask import mask
        except ImportError as exc:
            raise RuntimeError("rasterio is required for population enrichment") from exc

        out = []
        with rasterio.open(raw["raster"]) as src:
            for c in raw["cells"]:
                try:
                    arr, _ = mask(src, [c["geometry"]], crop=True, filled=True, nodata=0)
                    total = float(arr[arr > 0].sum())
                except Exception:            # cell outside raster coverage
                    total = None
                out.append({"cell_id": c["cell_id"],
                            "population": int(total) if total is not None else None,
                            "area_km2": c.get("area_km2")})
        return out

    async def store(self, records: Sequence[list[dict]]) -> int:
        rows = [r for group in records for r in group if r["population"] is not None]
        if not rows:
            return 0
        async with session_scope() as s:
            await s.execute(text("""
                UPDATE spatial_cells SET
                  population = :population,
                  population_density = CASE WHEN area_km2 > 0
                                            THEN :population / area_km2 ELSE NULL END,
                  enriched_at = now()
                WHERE cell_id = :cell_id
            """), [{"cell_id": r["cell_id"], "population": r["population"]} for r in rows])
        return len(rows)


# ── ESRI ASCII grid reader (no GDAL dependency for the DEM path) ───────
class _AsciiGrid:
    def __init__(self, text_body: str):
        lines = text_body.splitlines()
        hdr: dict[str, float] = {}
        i = 0
        while i < len(lines):
            parts = lines[i].split()
            if len(parts) == 2 and not parts[0][0].isdigit() and parts[0][0] != "-":
                hdr[parts[0].lower()] = float(parts[1])
                i += 1
            else:
                break
        self.ncols, self.nrows = int(hdr["ncols"]), int(hdr["nrows"])
        self.cellsize = hdr["cellsize"]
        self.nodata = hdr.get("nodata_value", -9999.0)
        self.xll = hdr.get("xllcorner", hdr.get("xllcenter", 0.0))
        self.yll = hdr.get("yllcorner", hdr.get("yllcenter", 0.0))
        self.rows = [[float(v) for v in line.split()] for line in lines[i:] if line.strip()]

    def sample(self, lat: float, lon: float) -> float | None:
        col = int((lon - self.xll) / self.cellsize)
        row = int((self.yll + self.nrows * self.cellsize - lat) / self.cellsize)
        if not (0 <= row < len(self.rows) and 0 <= col < len(self.rows[row])):
            return None
        v = self.rows[row][col]
        return None if v == self.nodata else v


def _slope_aspect(z: float, neighbours: list[float], spacing_m: float):
    """Slope in degrees and aspect in degrees from a centre and its ring."""
    if len(neighbours) < 3:
        return None, None
    n = len(neighbours)
    dz_dx = dz_dy = 0.0
    for k, zn in enumerate(neighbours):
        theta = 2 * math.pi * k / n
        dz_dx += (zn - z) * math.cos(theta)
        dz_dy += (zn - z) * math.sin(theta)
    dz_dx = 2 * dz_dx / (n * spacing_m)
    dz_dy = 2 * dz_dy / (n * spacing_m)
    slope = math.degrees(math.atan(math.hypot(dz_dx, dz_dy)))
    aspect = (math.degrees(math.atan2(dz_dy, -dz_dx)) + 360.0) % 360.0
    return round(slope, 2), round(aspect, 1)
