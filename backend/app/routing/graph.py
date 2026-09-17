"""
Evacuation routing over the live road network (§18).

The graph is the Indian road network from OSM, with **live edge state** applied
on every query: a road reported blocked by a field operator (§20) is removed,
a flooded road is removed, a slow road is penalised, and a road passing through
a high-risk cell carries a hazard cost even when it is physically open.

Cost function
─────────────
    cost(e) = travel_time(e) · (1 + α·hazard(e)) + β·congestion(e)

Minimising travel time alone routes convoys along the valley floor, which is
precisely where the flood is. `α` (default 3.0) makes a route through a
critical cell roughly four times as expensive per second as a safe one, so the
optimiser will happily take a longer road around. `β` charges for edges already
carrying assigned evacuees this tick, which spreads load instead of funnelling
every zone down the same highway.

Algorithms
──────────
  · **Dijkstra** — Θ((V + E) log V) with a binary heap. Used for one-to-many:
    one origin, all shelters, single pass. This is the common case and it is
    strictly cheaper than running A* once per shelter.
  · **A\\*** — same bound, better constant, for point-to-point. The heuristic is
    great-circle distance ÷ the network's maximum free-flow speed, which is
    **admissible** (it can never overestimate: no route is shorter than the
    straight line, and none is faster than the fastest road) and **consistent**,
    so the first time A* settles a node it has the optimal cost and no node is
    reopened.

Both operate on an immutable topology with a mutable state overlay, so applying
a new road closure is Θ(1) and does not rebuild the graph.
"""
from __future__ import annotations

import heapq
import math
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field

R_EARTH_M = 6_371_008.8

# Multiplier on travel time by reported road state. `None` means impassable.
STATE_PENALTY: dict[str, float | None] = {
    "open": 1.0,
    "slow": 2.2,
    "partially_blocked": 3.5,
    "blocked": None,
    "flooded": None,
    "landslide": None,
    "unknown": 1.4,          # unverified is not free
}


@dataclass(slots=True)
class Edge:
    road_id: int
    to_node: int
    length_m: float
    free_flow_kph: float
    capacity_pph: int
    cell_ids: tuple[str, ...] = ()

    @property
    def base_time_s(self) -> float:
        return self.length_m / max(self.free_flow_kph, 1.0) * 3.6


@dataclass(slots=True)
class RouteResult:
    origin: int
    destination: int
    node_path: list[int]
    road_ids: list[int]
    distance_m: float
    travel_time_s: float
    hazard_exposure: float
    algorithm: str
    settled_nodes: int = 0
    feasible: bool = True
    infeasible_reason: str | None = None

    def as_dict(self) -> dict:
        return {
            "origin_node": self.origin, "destination_node": self.destination,
            "road_ids": self.road_ids,
            "distance_m": round(self.distance_m, 1),
            "travel_time_s": round(self.travel_time_s, 1),
            "travel_time_min": round(self.travel_time_s / 60.0, 1),
            "hazard_exposure": round(self.hazard_exposure, 4),
            "algorithm": self.algorithm, "settled_nodes": self.settled_nodes,
            "feasible": self.feasible, "infeasible_reason": self.infeasible_reason,
        }


class RoadGraph:
    """Adjacency-list road network with a live state overlay."""

    def __init__(self, *, hazard_alpha: float = 3.0, congestion_beta: float = 0.6):
        self.adj: dict[int, list[Edge]] = {}
        self.coords: dict[int, tuple[float, float]] = {}          # node → (lat, lon)
        self.road_state: dict[int, str] = {}                      # road_id → state
        self.cell_risk: dict[str, float] = {}                     # cell → 0–100
        self.edge_load: dict[int, int] = {}                       # road_id → people assigned
        self.hazard_alpha = hazard_alpha
        self.congestion_beta = congestion_beta
        self._max_speed_kph = 1.0

    # ── construction ──────────────────────────────────────────────────
    def add_node(self, node_id: int, lat: float, lon: float) -> None:
        self.coords[node_id] = (lat, lon)
        self.adj.setdefault(node_id, [])

    def add_road(self, road_id: int, a: int, b: int, length_m: float,
                 free_flow_kph: float, capacity_pph: int = 400,
                 cell_ids: Iterable[str] = (), oneway: bool = False) -> None:
        cells = tuple(cell_ids)
        self.adj.setdefault(a, []).append(
            Edge(road_id, b, length_m, free_flow_kph, capacity_pph, cells))
        if not oneway:
            self.adj.setdefault(b, []).append(
                Edge(road_id, a, length_m, free_flow_kph, capacity_pph, cells))
        self.adj.setdefault(b, [])
        self._max_speed_kph = max(self._max_speed_kph, free_flow_kph)

    @property
    def node_count(self) -> int:
        return len(self.adj)

    @property
    def edge_count(self) -> int:
        return sum(len(v) for v in self.adj.values())

    # ── live state ────────────────────────────────────────────────────
    def set_road_state(self, road_id: int, state: str) -> None:
        self.road_state[road_id] = state

    def set_cell_risk(self, risk_by_cell: dict[str, float]) -> None:
        self.cell_risk = dict(risk_by_cell)

    def assign_load(self, road_ids: Sequence[int], people: int) -> None:
        for rid in road_ids:
            self.edge_load[rid] = self.edge_load.get(rid, 0) + people

    def reset_load(self) -> None:
        self.edge_load.clear()

    # ── cost ──────────────────────────────────────────────────────────
    def edge_hazard(self, e: Edge) -> float:
        """Mean risk of the cells this edge passes through, 0–1."""
        if not e.cell_ids or not self.cell_risk:
            return 0.0
        vals = [self.cell_risk.get(c, 0.0) for c in e.cell_ids]
        return max(0.0, min(1.0, (sum(vals) / len(vals)) / 100.0))

    def edge_cost(self, e: Edge) -> float | None:
        """Seconds, hazard- and congestion-adjusted. None = impassable."""
        penalty = STATE_PENALTY.get(self.road_state.get(e.road_id, "open"), 1.0)
        if penalty is None:
            return None
        t = e.base_time_s * penalty
        t *= 1.0 + self.hazard_alpha * self.edge_hazard(e)
        load = self.edge_load.get(e.road_id, 0)
        if load and e.capacity_pph:
            t += self.congestion_beta * e.base_time_s * (load / e.capacity_pph)
        return t

    # ── Dijkstra, one-to-many ─────────────────────────────────────────
    def dijkstra(self, source: int, targets: set[int] | None = None,
                 max_cost_s: float | None = None):
        """Θ((V + E) log V). Returns (cost, previous-edge) maps.

        Stops early once every target is settled — for an evacuation this
        typically explores a small neighbourhood rather than the whole district.
        """
        dist: dict[int, float] = {source: 0.0}
        prev: dict[int, tuple[int, Edge]] = {}
        settled: set[int] = set()
        remaining = set(targets) if targets else None
        heap: list[tuple[float, int]] = [(0.0, source)]

        while heap:
            d, u = heapq.heappop(heap)
            if u in settled:
                continue
            settled.add(u)
            if remaining is not None:
                remaining.discard(u)
                if not remaining:
                    break
            if max_cost_s is not None and d > max_cost_s:
                break
            for e in self.adj.get(u, ()):
                c = self.edge_cost(e)
                if c is None:
                    continue                     # blocked road: not an edge right now
                nd = d + c
                if nd < dist.get(e.to_node, math.inf):
                    dist[e.to_node] = nd
                    prev[e.to_node] = (u, e)
                    heapq.heappush(heap, (nd, e.to_node))
        return dist, prev, settled

    # ── A*, point-to-point ────────────────────────────────────────────
    def astar(self, source: int, target: int,
              heuristic: Callable[[int, int], float] | None = None) -> RouteResult:
        h = heuristic or self._default_heuristic
        open_heap: list[tuple[float, float, int]] = [(h(source, target), 0.0, source)]
        g: dict[int, float] = {source: 0.0}
        prev: dict[int, tuple[int, Edge]] = {}
        closed: set[int] = set()

        while open_heap:
            _, gu, u = heapq.heappop(open_heap)
            if u in closed:
                continue
            closed.add(u)
            if u == target:
                return self._reconstruct(source, target, prev, "astar_hazard_weighted_v1",
                                         len(closed))
            for e in self.adj.get(u, ()):
                c = self.edge_cost(e)
                if c is None:
                    continue
                ng = gu + c
                if ng < g.get(e.to_node, math.inf):
                    g[e.to_node] = ng
                    prev[e.to_node] = (u, e)
                    heapq.heappush(open_heap, (ng + h(e.to_node, target), ng, e.to_node))

        return RouteResult(source, target, [], [], 0.0, 0.0, 0.0,
                           "astar_hazard_weighted_v1", len(closed),
                           feasible=False,
                           infeasible_reason="no route on the current road network")

    def _default_heuristic(self, a: int, b: int) -> float:
        """Admissible: straight-line distance at the network's top speed.

        Never overestimates — no path is shorter than the great circle, and none
        is faster than the fastest road — so A* is guaranteed optimal here.
        """
        pa, pb = self.coords.get(a), self.coords.get(b)
        if pa is None or pb is None:
            return 0.0
        return haversine_m(pa, pb) / max(self._max_speed_kph, 1.0) * 3.6

    # ── path reconstruction ───────────────────────────────────────────
    def _reconstruct(self, source: int, target: int,
                     prev: dict[int, tuple[int, Edge]], algorithm: str,
                     settled: int) -> RouteResult:
        nodes, roads = [target], []
        distance = time_s = hazard_time = 0.0
        cur = target
        while cur != source:
            step = prev.get(cur)
            if step is None:
                return RouteResult(source, target, [], [], 0.0, 0.0, 0.0, algorithm,
                                   settled, feasible=False,
                                   infeasible_reason="path reconstruction failed")
            u, e = step
            roads.append(e.road_id)
            distance += e.length_m
            c = self.edge_cost(e) or 0.0
            time_s += c
            hazard_time += c * self.edge_hazard(e)
            nodes.append(u)
            cur = u
        nodes.reverse(); roads.reverse()
        return RouteResult(
            origin=source, destination=target, node_path=nodes, road_ids=roads,
            distance_m=distance, travel_time_s=time_s,
            hazard_exposure=(hazard_time / time_s) if time_s else 0.0,
            algorithm=algorithm, settled_nodes=settled,
        )

    def path_from_dijkstra(self, source: int, target: int,
                           prev: dict[int, tuple[int, Edge]], settled: int = 0) -> RouteResult:
        if target != source and target not in prev:
            return RouteResult(source, target, [], [], 0.0, 0.0, 0.0,
                               "dijkstra_hazard_weighted_v1", settled, feasible=False,
                               infeasible_reason="unreachable on the current road network")
        return self._reconstruct(source, target, prev, "dijkstra_hazard_weighted_v1", settled)

    # ── connectivity, for the vulnerability engine ────────────────────
    def independent_routes(self, source: int, safe_nodes: set[int],
                           max_paths: int = 3) -> int:
        """How many edge-disjoint routes to safety exist right now.

        Greedy edge-disjoint search: find a path, remove its roads, repeat.
        This is a lower bound on the true max-flow answer, which is the safe
        direction to be wrong in — it never claims more redundancy than exists.
        """
        removed: set[int] = set()
        original = dict(self.road_state)
        found = 0
        try:
            for _ in range(max_paths):
                dist, prev, settled = self.dijkstra(source, targets=set(safe_nodes))
                reached = [n for n in safe_nodes if n in dist]
                if not reached:
                    break
                best = min(reached, key=lambda n: dist[n])
                route = self.path_from_dijkstra(source, best, prev, len(settled))
                if not route.feasible or not route.road_ids:
                    break
                found += 1
                for rid in route.road_ids:
                    removed.add(rid)
                    self.road_state[rid] = "blocked"
        finally:
            self.road_state = original
        return found


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * R_EARTH_M * math.asin(math.sqrt(h))
