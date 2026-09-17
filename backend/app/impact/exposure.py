"""
Population exposure and impact assessment (§11).

§11 is explicit: *do not simply multiply probability by population and call that
reality.* That product is a nonsense quantity — it mixes a belief about whether
an event happens with a count of people, and produces a number that is neither
a population nor a probability, yet gets read as "people who will be affected".

What this module does instead is the standard risk framework:

    Risk = Hazard × Exposure × Vulnerability

with each term kept separate and separately reported:

  · **Hazard** — from the risk engine. Probability and intensity.
  · **Exposure** — how many people and assets are *physically inside the
    hazard footprint*. This is a spatial overlay, not a scalar multiply. A cell
    with 8 200 people of whom 1 400 live below the 100-year flood line has an
    exposure of 1 400, whatever the probability is.
  · **Vulnerability** — how badly those exposed would be harmed, computed in
    `app.vulnerability`.

The headline figure the dashboard shows is `expected_exposed`, and it is
reported *with* its two parents so nobody has to guess how it was made:

    expected_exposed = population_in_footprint × P(hazard)

That is a defensible expected value over a defined population, not a
probability-weighted headcount of the whole cell. The distinction is the
difference between "1 400 people are in the flood-prone area and there is a
64 % chance of flooding" and the meaningless "5 248 people are at risk".
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

# Fraction of a cell's population that sits inside the hazard footprint, when a
# real footprint polygon is unavailable. Derived from terrain, not invented:
# for flooding, the share of a cell below a height-above-drainage threshold.
FALLBACK_FOOTPRINT_METHOD = "terrain_proxy_v1"


@dataclass(slots=True)
class ExposureInputs:
    cell_id: str
    hazard: str
    probability: float
    population: int | None
    population_density: float | None = None
    area_km2: float | None = None
    building_count: int | None = None
    road_length_m: float | None = None
    hospitals: int = 0
    # terrain, used when there is no explicit footprint polygon
    height_above_river_m: float | None = None
    elevation_m: float | None = None
    slope_deg: float | None = None
    # explicit footprint, when a satellite or hydraulic model supplies one
    footprint_fraction: float | None = None
    footprint_source: str | None = None
    time_of_day_hour: int | None = None


@dataclass(slots=True)
class ExposureOutput:
    cell_id: str
    hazard: str
    population_total: int
    population_in_footprint: int
    expected_exposed: float
    footprint_fraction: float
    buildings_exposed: int | None
    road_length_exposed_m: float | None
    hospitals_exposed: int
    method: str
    components: dict[str, Any] = field(default_factory=dict)
    computed_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    unknown_population: bool = False

    def as_row(self) -> dict:
        return {
            "cell_id": self.cell_id, "hazard": self.hazard,
            "population_total": self.population_total,
            "population_in_footprint": self.population_in_footprint,
            "expected_exposed": round(self.expected_exposed, 2),
            "buildings_exposed": self.buildings_exposed,
            "road_length_exposed_m": self.road_length_exposed_m,
            "hospitals_exposed": self.hospitals_exposed,
            "method": self.method, "components": self.components,
        }


class ExposureEngine:
    """Hazard × Exposure, kept apart."""

    # ── footprint fraction ────────────────────────────────────────────
    def footprint(self, i: ExposureInputs) -> tuple[float, str, list[str]]:
        """What share of this cell is inside the hazard's physical footprint."""
        if i.footprint_fraction is not None:
            return (
                max(0.0, min(1.0, i.footprint_fraction)),
                i.footprint_source or "explicit_footprint",
                [f"footprint supplied by {i.footprint_source or 'upstream model'}"],
            )

        notes: list[str] = []
        if i.hazard == "flood":
            # People near the drainage line are exposed; people 40 m above it
            # are not, whatever the cell's average says.
            hand = i.height_above_river_m
            if hand is None:
                return 0.55, "terrain_proxy_v1:no_hand", ["no height-above-drainage data — "
                                                          "conservative 55 % assumed"]
            if hand <= 2:
                frac = 0.90; notes.append("cell sits essentially at drainage level")
            elif hand <= 5:
                frac = 0.65; notes.append(f"{hand:.0f} m above nearest drainage")
            elif hand <= 10:
                frac = 0.35; notes.append(f"{hand:.0f} m above nearest drainage")
            elif hand <= 20:
                frac = 0.12; notes.append(f"{hand:.0f} m above nearest drainage")
            else:
                frac = 0.03; notes.append("well above the drainage line")
            return frac, FALLBACK_FOOTPRINT_METHOD, notes

        if i.hazard == "landslide":
            # A landslide affects the run-out path, not the whole cell.
            slope = i.slope_deg
            if slope is None:
                return 0.25, "terrain_proxy_v1:no_slope", ["no slope data — 25 % assumed"]
            if slope >= 35:
                frac = 0.40; notes.append(f"steep terrain, {slope:.0f}°")
            elif slope >= 25:
                frac = 0.30; notes.append(f"failure-prone slope, {slope:.0f}°")
            elif slope >= 15:
                frac = 0.15; notes.append(f"moderate slope, {slope:.0f}°")
            else:
                frac = 0.05; notes.append("gentle terrain")
            return frac, FALLBACK_FOOTPRINT_METHOD, notes

        if i.hazard in ("earthquake", "heatwave", "drought"):
            # These act on the whole cell — there is no partial footprint.
            return 1.0, "whole_cell", [f"{i.hazard} affects the full cell area"]

        if i.hazard == "cyclone":
            return 0.85, "whole_cell_wind", ["wind field covers most of the cell"]

        return 0.5, "default", ["no footprint model for this hazard yet"]

    # ── night-time correction ─────────────────────────────────────────
    @staticmethod
    def occupancy_factor(hour: int | None) -> tuple[float, str | None]:
        """Residential population is a night-time count.

        A daytime flood in a cell full of schools and offices has a different
        exposed population from a 3 a.m. one. This is a coarse correction and
        is labelled as such, but leaving it out silently is worse.
        """
        if hour is None:
            return 1.0, None
        if 22 <= hour or hour < 6:
            return 1.0, "night — residential population at home"
        if 9 <= hour < 17:
            return 0.82, "daytime — part of the residential population is elsewhere"
        return 0.92, "transitional hours"

    # ── compute ───────────────────────────────────────────────────────
    def compute(self, i: ExposureInputs) -> ExposureOutput:
        frac, method, notes = self.footprint(i)
        occ, occ_note = self.occupancy_factor(i.time_of_day_hour)
        if occ_note:
            notes.append(occ_note)

        if i.population is None:
            return ExposureOutput(
                cell_id=i.cell_id, hazard=i.hazard,
                population_total=0, population_in_footprint=0, expected_exposed=0.0,
                footprint_fraction=frac, buildings_exposed=None,
                road_length_exposed_m=None, hospitals_exposed=0,
                method=method + ":population_unknown",
                components={"why": notes + ["population for this cell is unknown — "
                                            "exposure cannot be estimated"]},
                unknown_population=True,
            )

        in_footprint = int(round(i.population * frac * occ))
        expected = in_footprint * i.probability

        return ExposureOutput(
            cell_id=i.cell_id, hazard=i.hazard,
            population_total=i.population,
            population_in_footprint=in_footprint,
            expected_exposed=expected,
            footprint_fraction=frac,
            buildings_exposed=(int(round(i.building_count * frac))
                               if i.building_count is not None else None),
            road_length_exposed_m=(round(i.road_length_m * frac, 1)
                                   if i.road_length_m is not None else None),
            hospitals_exposed=i.hospitals if frac > 0.5 else 0,
            method=method,
            components={
                "footprint_fraction": round(frac, 3),
                "occupancy_factor": round(occ, 3),
                "probability": round(i.probability, 4),
                "why": notes,
                "formula": ("population_in_footprint = population × footprint_fraction × "
                            "occupancy_factor;  expected_exposed = population_in_footprint × P"),
                "caution": ("expected_exposed is an expected value over the people inside the "
                            "hazard footprint. It is not a headcount of people who will be "
                            "affected, and a predicted high-risk cell does not mean every "
                            "point inside it is affected."),
            },
        )
