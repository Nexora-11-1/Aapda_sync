"""
Tests for the divide-and-conquer work (§14, §15, §16, §18).

These are not smoke tests. Each one asserts the property the algorithm is
claimed to have — stability, optimality, admissibility, the complexity bound —
because those claims are what the design document rests on.
"""
from __future__ import annotations

import math
import random

import pytest

from app.priority.mergesort import merge_sort, priority_key, sort_with_trace
from app.routing.graph import RoadGraph
from app.spatial.nearest import KDTree, ShelterCandidate, haversine_m, rank_shelters
from app.spatial.quadtree import BBox, SpatialAnalyser, analyse_region


# ══════════════════════════════════════════════════════════════════════
# Merge sort (§15)
# ══════════════════════════════════════════════════════════════════════
class TestMergeSort:
    def test_sorts_ascending(self):
        data = [random.randint(-1000, 1000) for _ in range(500)]
        assert merge_sort(data, key=lambda x: x) == sorted(data)

    def test_is_stable(self):
        """Equal keys must keep their input order. This is the property the
        priority queue depends on — without it the ranking reshuffles between
        ticks whenever two zones tie."""
        data = [(k, i) for i, k in enumerate([3, 1, 3, 1, 2, 3, 1, 2] * 40)]
        out = merge_sort(data, key=lambda t: t[0])
        for k in {t[0] for t in data}:
            originals = [i for kk, i in data if kk == k]
            sorted_ = [i for kk, i in out if kk == k]
            assert originals == sorted_, f"stability broken for key {k}"

    def test_empty_and_single(self):
        assert merge_sort([], key=lambda x: x) == []
        assert merge_sort([7], key=lambda x: x) == [7]

    def test_does_not_mutate_input(self):
        data = [5, 3, 1]
        merge_sort(data, key=lambda x: x)
        assert data == [5, 3, 1]

    @pytest.mark.parametrize("n", [1, 2, 8, 64, 512, 2048])
    def test_comparison_count_within_n_log_n(self, n):
        """The claimed bound is n log2 n. Assert the real count respects it."""
        data = [random.random() for _ in range(n)]
        _, report = sort_with_trace(data, key=lambda x: x)
        assert report.comparisons <= max(report.theoretical_max_comparisons, 1)

    @pytest.mark.parametrize("n", [16, 128, 1024])
    def test_recursion_depth_is_logarithmic(self, n):
        data = list(range(n))
        random.shuffle(data)
        _, report = sort_with_trace(data, key=lambda x: x)
        assert report.depth <= math.ceil(math.log2(n)) + 1

    def test_growth_is_input_independent(self):
        """Merge sort's recursion tree does not depend on input order, so every
        ordering must sit inside the same n log n envelope. The constant does
        differ — an already-sorted run exhausts one side early and saves
        comparisons — but the order of growth cannot. This is why merge sort is
        used here rather than introsort, whose worst case is a different shape."""
        n = 1024
        bound = n * math.log2(n)
        for label, data in (("sorted", list(range(n))),
                            ("reversed", list(range(n, 0, -1))),
                            ("random", random.sample(range(n * 4), n))):
            _, report = sort_with_trace(data, key=lambda x: x)
            # n log2 n − n + 1 is the information-theoretic floor for a
            # comparison sort; n log2 n is merge sort's ceiling
            assert (bound - n + 1) * 0.5 <= report.comparisons <= bound, label

    def test_growth_rate_doubles_correctly(self):
        """Doubling n must multiply comparisons by about 2·(1 + 1/log2 n),
        which is the signature of n log n rather than n or n²."""
        counts = {}
        for n in (512, 1024, 2048):
            _, report = sort_with_trace(random.sample(range(n * 4), n), key=lambda x: x)
            counts[n] = report.comparisons
        ratio = counts[2048] / counts[1024]
        assert 2.0 <= ratio <= 2.4

    def test_priority_key_orders_by_urgency(self):
        class Z:
            def __init__(self, cid, score, exposed, tti):
                self.cell_id, self.priority_score = cid, score
                self.expected_exposed, self.time_to_impact_h = exposed, tti

        zones = [
            Z("c", 0.50, 100, 5.0),
            Z("a", 0.90, 200, 1.0),
            Z("b", 0.90, 900, 1.0),      # same score, more exposed → ranks above "a"
            Z("d", 0.70, 50, None),
        ]
        out = merge_sort(zones, key=priority_key)
        assert [z.cell_id for z in out] == ["b", "a", "d", "c"]

    def test_tie_break_is_deterministic(self):
        """Identical on every documented tie-break level → cell id decides,
        and the result is the same on every run."""
        class Z:
            def __init__(self, cid):
                self.cell_id, self.priority_score = cid, 0.5
                self.expected_exposed, self.time_to_impact_h = 100, 2.0

        ids = ["z", "m", "a", "q", "b"]
        runs = [[z.cell_id for z in merge_sort([Z(i) for i in random.sample(ids, len(ids))],
                                               key=priority_key)] for _ in range(20)]
        assert all(r == sorted(ids) for r in runs)


# ══════════════════════════════════════════════════════════════════════
# Quadtree divide and conquer (§14)
# ══════════════════════════════════════════════════════════════════════
class TestQuadtree:
    @staticmethod
    def _uniform(value):
        return lambda lon, lat: value

    def test_uniform_region_is_pruned(self):
        """A calm, uniform region collapses at min_depth — the sweep descends
        to the mandatory 1 + 4 + 16 = 21 nodes, prunes all 16 leaves, and stops.
        Compare with the exhaustive sweep below."""
        result, stats = analyse_region(BBox(78, 29, 80, 31), self._uniform(10.0),
                                       min_depth=2, max_depth=8)
        assert stats.visited == 21
        assert stats.pruned == 16
        # 16 pruned of 21 internal decisions; the 5 subdivisions are the
        # mandatory min_depth descent, not homogeneity failures
        assert stats.prune_rate == pytest.approx(16 / 21)
        assert result.max_risk == 10.0

        _, exhaustive = analyse_region(BBox(78, 29, 80, 31), self._uniform(10.0),
                                       min_depth=8, max_depth=8, leaf_size_deg=1e-9)
        assert stats.visited < exhaustive.visited / 100

    def test_hotspot_is_never_pruned_away(self):
        """The safety property: a single critical cell inside an otherwise calm
        region must survive to the root. Missing it is the failure mode that
        matters."""
        hot_lon, hot_lat = 79.41, 30.33
        leaf = 0.05                       # the sweep's leaf size

        def sampler(lon, lat):
            # a hotspot one leaf wide — the smallest feature the sweep claims
            # to be able to find
            return 95.0 if (abs(lon - hot_lon) < leaf and
                            abs(lat - hot_lat) < leaf) else 8.0

        result, stats = analyse_region(BBox(78, 29, 80, 31), sampler,
                                       max_depth=9, min_depth=3, leaf_size_deg=leaf)
        assert result.max_risk == 95.0, "critical cell was pruned away"
        assert result.hotspot is not None
        assert abs(result.hotspot[0] - hot_lon) < 0.3
        assert abs(result.hotspot[1] - hot_lat) < 0.3

    def test_high_variance_region_subdivides(self):
        """A quadrant straddling a ridge — same mean, high spread — must be
        subdivided. Averaging a hillside against a valley is how a system
        misses a landslide."""
        def gradient(lon, lat):
            return (lon - 78.0) / 2.0 * 100.0

        _, stats = analyse_region(BBox(78, 29, 80, 31), gradient,
                                  max_depth=5, homogeneity_tol=3.0)
        assert stats.subdivided > 0

    def test_max_depth_bounds_recursion(self):
        """Termination must not depend on the homogeneity test — a pathological
        sampler cannot run away."""
        noisy = lambda lon, lat: random.uniform(0, 100)
        for depth in (2, 4, 6):
            _, stats = analyse_region(BBox(78, 29, 80, 31), noisy,
                                      max_depth=depth, leaf_size_deg=1e-9,
                                      escalate_above=1e9)
            assert stats.max_depth_reached <= depth

    def test_worst_case_node_count_is_linear(self):
        """T(n) = 4T(n/4) + O(1) ⇒ Θ(n). With nothing pruning, the visited count
        must track the leaf count, not exceed it by an order."""
        noisy = lambda lon, lat: random.uniform(0, 100)
        _, stats = analyse_region(BBox(78, 29, 80, 31), noisy, max_depth=5,
                                  min_depth=5, leaf_size_deg=1e-9,
                                  homogeneity_tol=-1, escalate_above=1e9)
        leaves = 4 ** 5
        assert stats.visited <= (4 ** 6 - 1) / 3
        assert stats.leaves <= leaves

    def test_min_depth_blocks_premature_pruning(self):
        """Corner sampling cannot see a feature narrower than its own stride,
        so the top levels must always subdivide. Without this the sweep can
        declare a quadrant calm on five lucky probes."""
        analyser = SpatialAnalyser(lambda lon, lat: 10.0, min_depth=3)
        analyser.analyse(BBox(78, 29, 80, 31))
        assert analyser.stats.max_depth_reached >= 3
        assert analyser.stats.subdivided >= 1 + 4 + 16

    def test_pruning_beats_full_sweep(self):
        """The measurable payoff: on realistically autocorrelated risk the
        adaptive sweep touches far fewer samples than the exhaustive one."""
        def clustered(lon, lat):
            d = math.hypot(lon - 79.4, lat - 30.3)
            return max(0.0, 95.0 * math.exp(-(d ** 2) / 0.004))

        _, adaptive = analyse_region(BBox(78, 29, 80, 31), clustered,
                                     max_depth=7, leaf_size_deg=0.01)
        _, exhaustive = analyse_region(BBox(78, 29, 80, 31), clustered,
                                       max_depth=7, leaf_size_deg=0.01,
                                       min_depth=7, homogeneity_tol=-1,
                                       escalate_above=1e9)
        assert adaptive.samples_taken < exhaustive.samples_taken * 0.5
        assert adaptive.prune_rate > 0.4

    def test_no_data_region_returns_no_data(self):
        result, _ = analyse_region(BBox(78, 29, 80, 31), lambda lon, lat: None)
        assert result.cell_count == 0
        assert result.max_risk == -1.0

    def test_combine_propagates_max_and_weights_mean(self):
        def two_halves(lon, lat):
            return 90.0 if lon > 79.0 else 10.0

        result, _ = analyse_region(BBox(78, 29, 80, 31), two_halves,
                                   max_depth=4, leaf_size_deg=0.05)
        assert result.max_risk == 90.0
        assert 10.0 <= result.mean_risk <= 90.0

    def test_leaves_partition_the_region(self):
        """Every leaf must sit inside the root box — no gaps, no overhang."""
        result, _ = analyse_region(BBox(78, 29, 80, 31),
                                   lambda lon, lat: random.uniform(0, 100),
                                   max_depth=4)
        root = result.bbox
        for leaf in result.leaves():
            assert leaf.bbox.min_lon >= root.min_lon - 1e-9
            assert leaf.bbox.max_lon <= root.max_lon + 1e-9
            assert leaf.bbox.min_lat >= root.min_lat - 1e-9
            assert leaf.bbox.max_lat <= root.max_lat + 1e-9

    def test_quadrants_tile_without_overlap(self):
        box = BBox(0, 0, 4, 4)
        nw, ne, sw, se = box.quadrants()
        total = sum(q.width * q.height for q in (nw, ne, sw, se))
        assert total == pytest.approx(box.width * box.height)


# ══════════════════════════════════════════════════════════════════════
# KD-tree nearest neighbour (§16)
# ══════════════════════════════════════════════════════════════════════
class TestKDTree:
    @staticmethod
    def _points(n, seed=7):
        rng = random.Random(seed)
        return [(rng.uniform(29.8, 31.0), rng.uniform(78.6, 80.0), {"i": i})
                for i in range(n)]

    def test_nearest_matches_brute_force(self):
        pts = self._points(400)
        tree = KDTree(pts)
        rng = random.Random(11)
        for _ in range(40):
            q = (rng.uniform(29.8, 31.0), rng.uniform(78.6, 80.0))
            got = tree.nearest(*q, k=1)[0][1]["i"]
            expected = min(pts, key=lambda p: haversine_m(q, (p[0], p[1])))[2]["i"]
            assert got == expected

    def test_k_nearest_are_the_true_k(self):
        pts = self._points(200)
        tree = KDTree(pts)
        q = (30.4, 79.3)
        got = {p["i"] for _, p in tree.nearest(*q, k=5)}
        expected = {p[2]["i"] for p in
                    sorted(pts, key=lambda p: haversine_m(q, (p[0], p[1])))[:5]}
        assert got == expected

    def test_results_are_sorted_by_distance(self):
        tree = KDTree(self._points(150))
        out = tree.nearest(30.4, 79.3, k=8)
        assert [d for d, _ in out] == sorted(d for d, _ in out)

    def test_max_distance_filter(self):
        tree = KDTree(self._points(300))
        out = tree.nearest(30.4, 79.3, k=20, max_distance_m=5000)
        assert all(d <= 5000 for d, _ in out)

    def test_distances_are_metres_not_degrees(self):
        """One degree of latitude is ~111 km. If the tree compared degrees the
        answer would be off by five orders of magnitude — and, worse, wrong in
        the north-south direction specifically."""
        tree = KDTree([(30.0, 79.0, {"i": 0}), (31.0, 79.0, {"i": 1})])
        d, _ = tree.nearest(30.0, 79.0, k=2)[1]
        assert 105_000 < d < 120_000


# ══════════════════════════════════════════════════════════════════════
# Shelter ranking (§16 filter chain)
# ══════════════════════════════════════════════════════════════════════
class TestShelterRanking:
    @staticmethod
    def _tree():
        return KDTree([
            (30.30, 79.30, {"shelter_id": "SAFE-NEAR", "name": "Safe near",
                            "lat": 30.30, "lon": 79.30, "effective_capacity": 500,
                            "hazard_risk": 5.0, "operational": True, "medical_capacity": 2,
                            "water_days": 4, "food_days": 4}),
            (30.31, 79.31, {"shelter_id": "UNSAFE-NEAREST", "name": "Unsafe nearest",
                            "lat": 30.31, "lon": 79.31, "effective_capacity": 900,
                            "hazard_risk": 88.0, "operational": True, "medical_capacity": 4,
                            "water_days": 6, "food_days": 6}),
            (30.45, 79.45, {"shelter_id": "FULL", "name": "Full",
                            "lat": 30.45, "lon": 79.45, "effective_capacity": 0,
                            "hazard_risk": 3.0, "operational": True, "medical_capacity": 1,
                            "water_days": 5, "food_days": 5}),
            (30.40, 79.40, {"shelter_id": "CLOSED", "name": "Closed",
                            "lat": 30.40, "lon": 79.40, "effective_capacity": 400,
                            "hazard_risk": 2.0, "operational": False, "medical_capacity": 1,
                            "water_days": 5, "food_days": 5}),
        ])

    def test_geographically_nearest_is_rejected_when_unsafe(self):
        """The core §16 rule: the nearest shelter to a flooding village is
        frequently the one on the same floodplain."""
        ranked = rank_shelters((30.315, 79.315), self._tree(), people=300)
        feasible = [c for c in ranked if c.feasible]
        assert feasible[0].shelter_id == "SAFE-NEAR"
        unsafe = next(c for c in ranked if c.shelter_id == "UNSAFE-NEAREST")
        assert not unsafe.feasible
        assert "hazard footprint" in unsafe.rejected_because

    def test_full_and_closed_are_rejected_with_reasons(self):
        ranked = rank_shelters((30.30, 79.30), self._tree(), people=100)
        by_id = {c.shelter_id: c for c in ranked}
        assert by_id["FULL"].rejected_because == "no effective capacity"
        assert by_id["CLOSED"].rejected_because == "not operational"

    def test_rejects_are_retained_for_explanation(self):
        """The UI must be able to say why a shelter was not used."""
        ranked = rank_shelters((30.30, 79.30), self._tree(), people=100)
        assert len(ranked) == 4
        assert all(c.rejected_because for c in ranked if not c.feasible)

    def test_route_hazard_outweighs_a_small_time_saving(self):
        def travel(cand: ShelterCandidate):
            # the closer shelter is 10 minutes quicker but through a flooded stretch
            return (900.0, 0.8) if cand.shelter_id == "SAFE-NEAR" else (1500.0, 0.0)

        tree = KDTree([
            (30.30, 79.30, {"shelter_id": "SAFE-NEAR", "name": "Quick but exposed",
                            "lat": 30.30, "lon": 79.30, "effective_capacity": 500,
                            "hazard_risk": 5.0, "operational": True}),
            (30.50, 79.50, {"shelter_id": "FAR-CLEAN", "name": "Slower but clear",
                            "lat": 30.50, "lon": 79.50, "effective_capacity": 500,
                            "hazard_risk": 5.0, "operational": True}),
        ])
        ranked = rank_shelters((30.30, 79.30), tree, people=100, travel_time_fn=travel)
        assert ranked[0].shelter_id == "FAR-CLEAN"


# ══════════════════════════════════════════════════════════════════════
# Routing (§18)
# ══════════════════════════════════════════════════════════════════════
class TestRouting:
    @staticmethod
    def _grid(n=6, spacing=0.01):
        """n×n lattice; node id = row * 100 + col."""
        g = RoadGraph()
        for r in range(n):
            for c in range(n):
                g.add_node(r * 100 + c, 30.0 + r * spacing, 79.0 + c * spacing)
        rid = 1
        for r in range(n):
            for c in range(n):
                if c + 1 < n:
                    g.add_road(rid, r * 100 + c, r * 100 + c + 1, 1000, 40); rid += 1
                if r + 1 < n:
                    g.add_road(rid, r * 100 + c, (r + 1) * 100 + c, 1000, 40); rid += 1
        return g

    def test_astar_matches_dijkstra(self):
        """A* with an admissible heuristic must return the same optimal cost as
        Dijkstra. If it does not, the heuristic overestimates."""
        g = self._grid()
        for target in (505, 305, 5):
            dist, prev, settled = g.dijkstra(0, targets={target})
            dj = g.path_from_dijkstra(0, target, prev, len(settled))
            a = g.astar(0, target)
            assert a.feasible and dj.feasible
            assert a.travel_time_s == pytest.approx(dj.travel_time_s, rel=1e-9)

    def test_astar_settles_fewer_nodes_than_dijkstra(self):
        """The reason A* exists here: same answer, less work."""
        g = self._grid(n=12)
        _, _, settled = g.dijkstra(0, targets={1111})
        a = g.astar(0, 1111)
        assert a.settled_nodes <= len(settled)

    def test_blocked_road_is_removed_not_penalised(self):
        g = self._grid(n=3)
        base = g.astar(0, 2)
        assert base.feasible
        for rid in base.road_ids:
            g.set_road_state(rid, "blocked")
        rerouted = g.astar(0, 2)
        assert rerouted.feasible
        assert not set(rerouted.road_ids) & set(base.road_ids)

    def test_no_route_reports_infeasible_rather_than_guessing(self):
        g = self._grid(n=3)
        for rid in list(range(1, 40)):
            g.set_road_state(rid, "flooded")
        route = g.astar(0, 202)
        assert not route.feasible
        assert "no route" in route.infeasible_reason

    def test_hazard_weighting_diverts_around_risk(self):
        """Minimising time alone routes convoys down the valley floor, which is
        where the flood is. The hazard term must be able to overcome a shorter
        path."""
        g = RoadGraph(hazard_alpha=3.0)
        for i, (lat, lon) in enumerate([(30.0, 79.0), (30.0, 79.02), (30.01, 79.01)]):
            g.add_node(i, lat, lon)
        g.add_road(1, 0, 1, 2000, 40, cell_ids=("HOT",))       # short, dangerous
        g.add_road(2, 0, 2, 1600, 40, cell_ids=("SAFE",))      # detour, safe
        g.add_road(3, 2, 1, 1600, 40, cell_ids=("SAFE",))

        g.set_cell_risk({"HOT": 0.0, "SAFE": 0.0})
        assert g.astar(0, 1).road_ids == [1]

        g.set_cell_risk({"HOT": 100.0, "SAFE": 0.0})
        assert g.astar(0, 1).road_ids == [2, 3]

    def test_heuristic_is_admissible(self):
        """Never overestimates the true remaining cost — the condition that
        makes A* optimal."""
        g = self._grid(n=5)
        for target in (404, 204, 4):
            dist, prev, _ = g.dijkstra(0, targets={target})
            true_cost = dist.get(target)
            assert true_cost is not None
            assert g._default_heuristic(0, target) <= true_cost + 1e-6

    def test_congestion_spreads_load(self):
        """Load on the chosen path must push the next convoy onto a different
        one. On a symmetric lattice the alternative can cost the same — that is
        the point, the load is spread rather than funnelled — so the assertion
        is that the roads differ, not that the time rises."""
        g = self._grid(n=4)
        first = g.astar(0, 303)
        g.assign_load(first.road_ids, 100_000)
        second = g.astar(0, 303)
        assert set(second.road_ids) != set(first.road_ids)
        assert second.feasible

    def test_congestion_raises_cost_when_no_alternative(self):
        """With a single corridor there is nowhere to spread to, so the cost
        must rise instead."""
        g = RoadGraph(congestion_beta=0.6)
        g.add_node(0, 30.0, 79.0); g.add_node(1, 30.0, 79.02)
        g.add_road(1, 0, 1, 2000, 40, capacity_pph=100)
        before = g.astar(0, 1).travel_time_s
        g.assign_load([1], 5000)
        assert g.astar(0, 1).travel_time_s > before

    def test_independent_routes_counts_edge_disjoint_paths(self):
        g = self._grid(n=4)
        assert g.independent_routes(0, {303}, max_paths=3) >= 2

    def test_independent_routes_zero_when_isolated(self):
        g = self._grid(n=3)
        for rid in range(1, 40):
            g.set_road_state(rid, "blocked")
        assert g.independent_routes(0, {202}) == 0
