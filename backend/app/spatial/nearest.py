"""
Spatial nearest-neighbour search for shelter selection (§16).

Two layers, on purpose:

  · `KDTree` — an in-process k-d tree over shelter positions. Build Θ(n log n),
    query Θ(log n) expected. This is the *candidate generator*: it answers
    "which shelters are physically near this cell" in microseconds, with no
    database round trip, which matters because the evacuation optimiser calls
    it once per priority zone per tick.

  · PostGIS `<->` KNN — used when the query needs attributes the in-memory tree
    does not hold (district filters, live occupancy joins). The SQL is in
    `shelter_candidates_sql` and relies on the GiST index for index-assisted
    ordering rather than sorting the whole table.

The tree is built on an equirectangular projection about the region's mean
latitude, so Euclidean distance in the tree is metres, not degrees. Comparing
degrees to metres is the classic way to get a shelter ranking that is subtly
wrong in the north-south direction, and it is easy to not notice.

**Geographic nearest is only the first filter.** `rank_shelters` applies the
§16 pipeline — remove unsafe, remove full, cost by travel time, then rank —
because the nearest shelter to a flooding village is frequently the one on the
same floodplain.
"""
from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

R_EARTH_M = 6_371_008.8


# ══════════════════════════════════════════════════════════════════════
# k-d tree
# ══════════════════════════════════════════════════════════════════════
@dataclass(slots=True)
class _Node:
    point: tuple[float, float]
    payload: Any
    axis: int
    left: "_Node | None" = None
    right: "_Node | None" = None


class KDTree:
    """2-d tree over projected metres.

    Build:  T(n) = 2T(n/2) + Θ(n)  [median partition]  ⇒ Θ(n log n)
    Query:  Θ(log n) expected, Θ(n) worst case on adversarial input.
    Space:  Θ(n).
    """

    def __init__(self, items: Sequence[tuple[float, float, Any]]):
        """items: (lat, lon, payload)."""
        self.lat0 = (sum(i[0] for i in items) / len(items)) if items else 0.0
        self._cos_lat0 = math.cos(math.radians(self.lat0))
        projected = [(self._project(lat, lon), payload) for lat, lon, payload in items]
        self.size = len(projected)
        self.root = self._build(projected, depth=0)

    def _project(self, lat: float, lon: float) -> tuple[float, float]:
        """Equirectangular about lat0 → metres. Distances are then Euclidean."""
        x = math.radians(lon) * R_EARTH_M * self._cos_lat0
        y = math.radians(lat) * R_EARTH_M
        return (x, y)

    def _build(self, items: list, depth: int) -> _Node | None:
        if not items:
            return None
        axis = depth % 2
        items.sort(key=lambda it: it[0][axis])
        mid = len(items) // 2
        point, payload = items[mid]
        return _Node(
            point=point, payload=payload, axis=axis,
            left=self._build(items[:mid], depth + 1),
            right=self._build(items[mid + 1:], depth + 1),
        )

    def nearest(self, lat: float, lon: float, k: int = 1,
                max_distance_m: float | None = None) -> list[tuple[float, Any]]:
        """k nearest payloads as (distance_m, payload), nearest first."""
        target = self._project(lat, lon)
        heap: list[tuple[float, Any]] = []       # bounded, k is small — list is fine

        def consider(dist: float, payload: Any) -> None:
            if max_distance_m is not None and dist > max_distance_m:
                return
            heap.append((dist, payload))
            heap.sort(key=lambda t: t[0])
            del heap[k:]

        def search(node: _Node | None) -> None:
            if node is None:
                return
            d = math.dist(target, node.point)
            consider(d, node.payload)
            axis = node.axis
            delta = target[axis] - node.point[axis]
            near, far = (node.left, node.right) if delta < 0 else (node.right, node.left)
            search(near)
            # only cross the splitting plane if the other side could still hold
            # something closer than the current kth-best — this is the pruning
            # that makes the query logarithmic rather than linear
            worst = heap[-1][0] if len(heap) >= k else float("inf")
            if abs(delta) < worst:
                search(far)

        search(self.root)
        return heap


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """True great-circle distance, for the final ranking where accuracy matters."""
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * R_EARTH_M * math.asin(math.sqrt(h))


# ══════════════════════════════════════════════════════════════════════
# Shelter ranking — §16's pipeline, in order
# ══════════════════════════════════════════════════════════════════════
@dataclass(slots=True)
class ShelterCandidate:
    shelter_id: str
    name: str
    lat: float
    lon: float
    straight_line_m: float
    effective_capacity: int
    hazard_risk: float                 # risk score of the shelter's own cell
    operational: bool
    medical_capacity: int = 0
    water_days: float | None = None
    food_days: float | None = None
    travel_time_s: float | None = None
    route_hazard: float | None = None
    score: float = 0.0
    rejected_because: str | None = None

    @property
    def feasible(self) -> bool:
        return self.rejected_because is None


def rank_shelters(
    origin: tuple[float, float],
    tree: KDTree,
    *,
    people: int,
    k_candidates: int = 12,
    max_straight_line_m: float = 40_000,
    unsafe_risk_threshold: float = 60.0,
    travel_time_fn=None,
) -> list[ShelterCandidate]:
    """Affected zone → candidates → filter → cost → rank (§16).

    `travel_time_fn(shelter) -> (seconds, hazard_exposure) | None` plugs the
    routing engine in. Without it, ranking falls back to straight-line distance
    and says so by leaving `travel_time_s` None — an honest degradation rather
    than a fabricated ETA.
    """
    lat, lon = origin
    raw = tree.nearest(lat, lon, k=k_candidates, max_distance_m=max_straight_line_m)

    candidates: list[ShelterCandidate] = []
    for dist, payload in raw:
        c = ShelterCandidate(
            shelter_id=payload["shelter_id"], name=payload["name"],
            lat=payload["lat"], lon=payload["lon"],
            straight_line_m=haversine_m(origin, (payload["lat"], payload["lon"])),
            effective_capacity=payload.get("effective_capacity", 0),
            hazard_risk=payload.get("hazard_risk", 0.0),
            operational=payload.get("operational", True),
            medical_capacity=payload.get("medical_capacity", 0),
            water_days=payload.get("water_days"), food_days=payload.get("food_days"),
        )

        # 1 — remove unsafe: a shelter inside the hazard footprint is not a shelter
        if c.hazard_risk >= unsafe_risk_threshold:
            c.rejected_because = f"inside hazard footprint (risk {c.hazard_risk:.0f})"
        # 2 — remove non-operational
        elif not c.operational:
            c.rejected_because = "not operational"
        # 3 — remove full
        elif c.effective_capacity <= 0:
            c.rejected_because = "no effective capacity"

        candidates.append(c)

    feasible = [c for c in candidates if c.feasible]

    # 4 — travel time over the live road graph
    if travel_time_fn is not None:
        for c in feasible:
            result = travel_time_fn(c)
            if result is None:
                c.rejected_because = "no route on the current road network"
                continue
            c.travel_time_s, c.route_hazard = result

    feasible = [c for c in candidates if c.feasible]

    # 5 — rank. Time dominates; hazard along the route and capacity headroom
    #     break ties. A shelter you reach 10 minutes sooner but through a
    #     flooded stretch is not the better shelter.
    for c in feasible:
        minutes = (c.travel_time_s / 60.0) if c.travel_time_s is not None \
            else (c.straight_line_m / 1000.0) * 3.0        # 20 km/h fallback
        hazard_penalty = (c.route_hazard or 0.0) * 25.0
        headroom = min(c.effective_capacity / max(people, 1), 2.0)
        capacity_bonus = headroom * 6.0
        medical_bonus = 4.0 if c.medical_capacity > 0 else 0.0
        supply_bonus = 3.0 if (c.water_days or 0) >= 2 and (c.food_days or 0) >= 2 else 0.0
        c.score = minutes + hazard_penalty - capacity_bonus - medical_bonus - supply_bonus

    feasible.sort(key=lambda c: c.score)
    rejected = [c for c in candidates if not c.feasible]
    return feasible + rejected          # rejects retained so the UI can explain them


# ══════════════════════════════════════════════════════════════════════
# PostGIS KNN — the attribute-aware path
# ══════════════════════════════════════════════════════════════════════
SHELTER_CANDIDATES_SQL = """
SELECT s.shelter_id, s.name,
       ST_Y(s.geom) AS lat, ST_X(s.geom) AS lon,
       ST_Distance(s.geom::geography,
                   ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography) AS straight_line_m,
       s.max_capacity, s.medical_capacity, s.district_code, s.nearest_node,
       v.current_occupancy, v.state, v.water_days_remaining, v.food_days_remaining,
       v.medical_staff_present, v.beds_available, v.reported_at,
       COALESCE(r.score, 0) AS hazard_risk
FROM shelters s
JOIN v_shelter_live v USING (shelter_id)
LEFT JOIN v_cell_current_risk r
       ON r.cell_id = s.cell_id AND r.hazard = CAST(:hazard AS hazard_type)
WHERE (:district IS NULL OR s.district_code = :district)
ORDER BY s.geom <-> ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)   -- index-assisted KNN
LIMIT :limit
"""
