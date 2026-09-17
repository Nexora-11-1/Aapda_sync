"""
The live pipeline (§5, §10).

    ingest → features → inference → risk → exposure → vulnerability
           → priority (merge sort) → capacity → routing → evacuation → WebSocket

Run as a supervised set of independent loops rather than one big tick, because
the stages have genuinely different natural cadences: SACHET alerts every five
minutes, weather every fifteen, the OSM road graph once a day. Coupling them
would either hammer the slow sources or starve the fast ones.

Failure containment is the design centre. Every loop catches everything,
records the failure, and continues on the next tick. A stage that fails leaves
the previous result in place and marks it stale — it never blanks the map,
because an operator staring at an empty district cannot tell "no risk" from
"the pipeline died".
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from sqlalchemy import text

from app.capacity.engine import CapacityEngine, ShelterState
from app.config import settings
from app.core.metrics import (
    CELLS_SCORED,
    CRITICAL_CELLS,
    DEGRADED_PREDICTIONS,
    INGEST_DURATION,
    INGEST_RECORDS,
    INGEST_RUNS,
    MODEL_CONFIDENCE,
    PIPELINE_ERRORS,
    PIPELINE_LAG,
    PIPELINE_TICK,
    PREDICTIONS,
    QUADTREE_PRUNE_RATE,
    QUADTREE_SAMPLES,
    SOURCE_QUALITY,
    SOURCE_STALENESS,
)
from app.db.repositories import record_run
from app.db.session import session_scope
from app.evacuation.optimizer import EvacuationOptimizer, EvacZone
from app.features.builder import FeatureBuilder
from app.hazards import catalogue as hz_cat
from app.impact.exposure import ExposureEngine, ExposureInputs
from app.ingestion import base as ingest_base
from app.ml.pipeline import ModelRegistry
from app.priority.engine import PriorityEngine, PriorityInputs
from app.realtime import RecomputeBus, RecomputeRequest, Trigger, set_bus
from app.risk.engine import RiskEngine, RiskInputs
from app.spatial.grid import link_roads_to_cells
from app.routing.graph import RoadGraph
from app.vulnerability.engine import VulnerabilityEngine, VulnerabilityInputs
from app.ws.hub import hub

log = logging.getLogger(__name__)


class Orchestrator:
    def __init__(self):
        self.registry = ModelRegistry()
        self.risk = RiskEngine()
        self.exposure = ExposureEngine()
        self.vulnerability = VulnerabilityEngine()
        self.priority = PriorityEngine(version=settings.active_priority_weights)
        self.capacity = CapacityEngine()
        self.graph = RoadGraph()
        self._graph_loaded_at: datetime | None = None
        self._stop = asyncio.Event()
        # Event-driven recomputation. Polling is the floor, not the mechanism:
        # an operator write or a pushed event recomputes immediately.
        self.bus = RecomputeBus(self._on_recompute)
        set_bus(self.bus)
        # Which hazards this deployment actually scores: live in the catalogue
        # AND physically possible in this geography. Chamoli is landlocked, so
        # cyclone and tsunami are excluded rather than scored as confident zeros.
        self._last_health: str | None = None
        self.coastal = False
        # A hazard is only schedulable if THREE things hold: the catalogue has a
        # live source for it, the geography can physically produce it, and this
        # build has a feature set to score it with. Dropping the third test is
        # how five of seven hazards came to raise ValueError inside every tick,
        # forever, logged as a generic "recompute failed" and never surfaced.
        from app.features.builder import FEATURE_SETS
        possible = [h for h in hz_cat.live_hazards()
                    if hz_cat.applicable(h, coastal=self.coastal)]
        self.hazards = [h for h in possible if h in FEATURE_SETS]
        unscorable = [h for h in possible if h not in FEATURE_SETS]
        log.info("hazards active: %s", ", ".join(self.hazards) or "none")
        if unscorable:
            # Named, not silently dropped — the API reports these as
            # "source available, no model" rather than pretending they are quiet.
            log.warning("hazards with a live source but no feature set, not scored: %s",
                        ", ".join(unscorable))
        self.unscorable_hazards = unscorable

    # ══════════════════════════════════════════════════════════════════
    # Supervision
    # ══════════════════════════════════════════════════════════════════
    async def _on_recompute(self, req: RecomputeRequest) -> None:
        await self.analyse(req.district, req.hazard, trigger=req.trigger.value)

    async def run_forever(self) -> None:
        await self._load_active_models()
        await self.bus.start()
        loops = [
            self._supervise("ingest_fast", self.tick_ingest_fast, 300),
            self._supervise("ingest_weather", self.tick_ingest_weather,
                            settings.inference_interval_seconds),
            self._supervise("analysis", self.tick_analysis, settings.risk_interval_seconds),
            self._supervise("quality", self.tick_quality, settings.quality_interval_seconds),
            self._supervise("graph", self.tick_graph, 3600),
            self._supervise("watchdog", self.tick_watchdog, 60),
        ]
        try:
            await asyncio.gather(*loops)
        except asyncio.CancelledError:
            self._stop.set()
            await self.bus.stop()
            raise

    async def _supervise(self, name: str, fn: Callable[[], Awaitable[None]],
                         interval: int) -> None:
        """Run `fn` every `interval` seconds. Never let it escape."""
        # stagger starts so five loops do not all hit the database at t=0
        await asyncio.sleep(hash(name) % 7)
        while not self._stop.is_set():
            started = time.perf_counter()
            try:
                await fn()
            except asyncio.CancelledError:
                raise
            except Exception:                          # noqa: BLE001
                PIPELINE_ERRORS.labels(name).inc()
                log.exception("pipeline stage %s failed; continuing", name)
            finally:
                elapsed = time.perf_counter() - started
                PIPELINE_TICK.labels(name).observe(elapsed)
                if elapsed > interval:
                    log.warning("stage %s took %.1fs, longer than its %ds interval",
                                name, elapsed, interval)
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._stop.wait(),
                                       timeout=max(interval - elapsed, 1))

    # ══════════════════════════════════════════════════════════════════
    # Ingestion
    # ══════════════════════════════════════════════════════════════════
    async def tick_ingest_fast(self) -> None:
        """Sources whose latency budget is measured in seconds.

        A new official alert does not wait for the analysis tick: it requests a
        recompute of every hazard that source feeds, the moment it lands.
        """
        before = await self._alert_count()
        await self._run_connectors(["sachet", "usgs", "ncs", "gdacs"])
        after = await self._alert_count()
        if after > before:
            log.info("%d new alert record(s) — recomputing now", after - before)
            self.bus.request_all(settings.mvp_district_codes, self.hazards,
                                 Trigger.OFFICIAL_ALERT,
                                 f"{after - before} new alert(s)")

    async def _alert_count(self) -> int:
        try:
            async with session_scope() as s:
                return (await s.execute(text(
                    "SELECT COUNT(*) FROM government_alerts "
                    "WHERE expires_at IS NULL OR expires_at > now()"))).scalar_one()
        except Exception:                              # noqa: BLE001
            return 0

    async def tick_ingest_weather(self) -> None:
        """Everything that needs the H3 grid's sample points.

        Which connectors run is derived from the hazard catalogue, not a list
        maintained by hand: enabling a hazard's source automatically starts
        polling it, and the cadence is the tightest any dependent hazard asks
        for.
        """
        await self._run_connectors(["imd", "cwc", "incois", "firms", "nrsc"])

        points = await self._cell_points()
        if not points:
            return

        # Open-Meteo covers the weather slot when IMD is silent, and always
        # supplies the derived heatwave / drought / lightning signals.
        if await self._source_unhealthy("imd"):
            await self._run_one("openmeteo", points=points)

        elevations = await self._cell_elevations()
        await self._run_one_class(
            "app.ingestion.imd.derived", "DerivedHazardConnector",
            points=points, elevations=elevations)

        # GloFAS discharge stands in for CWC river level when CWC is absent.
        if await self._source_unhealthy("cwc"):
            await self._run_one("glofas", points=points)

    async def _cell_elevations(self) -> dict[str, float]:
        async with session_scope() as s:
            rows = (await s.execute(text("""
                SELECT cell_id, COALESCE(elevation_m, 0) AS e FROM spatial_cells
                WHERE district_code = ANY(:d)
            """), {"d": settings.mvp_district_codes})).all()
        return {c: float(e) for c, e in rows}

    async def _run_one_class(self, module: str, cls_name: str, **kw) -> None:
        """Run a connector that shares a source key with another connector."""
        import importlib
        try:
            cls = getattr(importlib.import_module(module), cls_name)
        except Exception:                              # noqa: BLE001
            log.exception("could not load %s.%s", module, cls_name)
            return
        connector = cls(**kw)
        started = time.perf_counter()
        try:
            result = await connector.run()
        finally:
            await connector.aclose()
        INGEST_DURATION.labels(result.source_key).observe(time.perf_counter() - started)
        INGEST_RUNS.labels(result.source_key, "ok" if result.ok else result.state).inc()
        if result.stored:
            INGEST_RECORDS.labels(result.source_key).inc(result.stored)
        if not result.ok and result.state != "not_configured":
            log.warning("ingest %s (%s): %s", result.source_key, cls_name, result.error)

    async def tick_graph(self) -> None:
        """Rebuild the routing graph and apply live road state."""
        async with session_scope() as s:
            nodes = (await s.execute(text(
                "SELECT node_id, ST_Y(geom) AS lat, ST_X(geom) AS lon FROM road_nodes"
            ))).mappings().all()
            roads = (await s.execute(text("""
                SELECT road_id, from_node, to_node, length_m, free_flow_kph,
                       COALESCE(capacity_pph, 400) AS capacity_pph,
                       COALESCE(cell_ids, '{}') AS cell_ids, oneway, current_state
                FROM v_road_live
            """))).mappings().all()

        graph = RoadGraph()
        for n in nodes:
            graph.add_node(n["node_id"], n["lat"], n["lon"])
        for r in roads:
            graph.add_road(r["road_id"], r["from_node"], r["to_node"],
                           float(r["length_m"]), float(r["free_flow_kph"]),
                           int(r["capacity_pph"]), r["cell_ids"] or (), bool(r["oneway"]))
            if r["current_state"] and r["current_state"] != "open":
                graph.set_road_state(r["road_id"], r["current_state"])
        self.graph = graph
        self._graph_loaded_at = datetime.now(UTC)
        # Roads are priced by the risk of the cells they cross, and that join
        # lives in roads.cell_ids. Refresh it here rather than hoping an
        # operator remembers to run a script — an empty array silently turns
        # hazard-aware routing back into a plain shortest path.
        try:
            async with session_scope() as s2:
                await link_roads_to_cells(s2)
        except Exception:                                  # noqa: BLE001
            log.warning("could not refresh road/cell links; hazard-weighted routing "
                        "will be degraded until it succeeds", exc_info=True)
        log.info("road graph loaded: %d nodes, %d directed edges",
                 graph.node_count, graph.edge_count)

    async def _run_connectors(self, keys: list[str]) -> None:
        registry = ingest_base.registry()
        for key in keys:
            if key not in registry:
                continue
            await self._run_one(key)

    async def _run_one(self, key: str, **kw) -> None:
        registry = ingest_base.registry()
        cls = registry.get(key)
        if cls is None:
            return
        connector = cls(**kw)
        started = time.perf_counter()
        try:
            result = await connector.run()
        finally:
            await connector.aclose()

        INGEST_DURATION.labels(key).observe(time.perf_counter() - started)
        INGEST_RUNS.labels(key, "ok" if result.ok else result.state).inc()
        if result.stored:
            INGEST_RECORDS.labels(key).inc(result.stored)
        if result.quality_score is not None:
            SOURCE_QUALITY.labels(key).set(result.quality_score)

        try:
            async with session_scope() as s:
                await record_run(s, result)
        except Exception:                              # noqa: BLE001
            log.exception("could not record ingestion run for %s", key)

        if not result.ok and result.state != "not_configured":
            log.warning("ingest %s: %s", key, result.error)

    async def _source_unhealthy(self, key: str) -> bool:
        async with session_scope() as s:
            row = (await s.execute(text("""
                SELECT status, last_success_at, staleness_threshold_s
                FROM data_sources WHERE key = :k
            """), {"k": key})).mappings().first()
        if row is None or row["status"] in ("failed", "not_configured"):
            return True
        if row["last_success_at"] is None:
            return True
        age = (datetime.now(UTC) - row["last_success_at"]).total_seconds()
        return age > row["staleness_threshold_s"]

    async def _cell_points(self) -> list[tuple[str, float, float]]:
        async with session_scope() as s:
            rows = (await s.execute(text("""
                SELECT cell_id, ST_Y(centroid) AS lat, ST_X(centroid) AS lon
                FROM spatial_cells
                WHERE district_code = ANY(:districts)
            """), {"districts": settings.mvp_district_codes})).mappings().all()
        return [(r["cell_id"], r["lat"], r["lon"]) for r in rows]

    # ══════════════════════════════════════════════════════════════════
    # Analysis — the chain that produces what the dashboard shows
    # ══════════════════════════════════════════════════════════════════
    async def tick_analysis(self) -> None:
        """The scheduled floor.

        Requests go through the same bus as pushed events, so a scheduled tick
        arriving while a push-triggered recompute is in flight coalesces into it
        instead of running the same district twice.
        """
        self.bus.request_all(settings.mvp_district_codes, self.hazards,
                             Trigger.SCHEDULED)

    async def analyse(self, district: str, hazard: str,
                      trigger: str = "scheduled") -> None:
        now = datetime.now(UTC)
        model = self.registry.active(hazard)

        async with session_scope() as s:
            cells = (await s.execute(text("""
                SELECT cell_id, population, population_density, area_km2, building_count,
                       road_length_m, elevation_m, slope_deg, height_above_river_m,
                       ST_Y(centroid) AS lat, ST_X(centroid) AS lon
                FROM spatial_cells WHERE district_code = :d
            """), {"d": district})).mappings().all()
            if not cells:
                return
            cell_ids = [c["cell_id"] for c in cells]
            cell_by_id = {c["cell_id"]: c for c in cells}

            # ── features ──────────────────────────────────────────────
            rows = await FeatureBuilder(hazard).build(s, cell_ids, now)
            feature_by_id = {r.cell_id: r for r in rows}

            # ── inference ─────────────────────────────────────────────
            predictions = model.predict(rows) if model else []
            pred_by_id = {p["cell_id"]: p for p in predictions}

            # ── corroboration ─────────────────────────────────────────
            alerts = (await s.execute(text("""
                SELECT c.cell_id, a.id, a.severity, a.issuing_authority, a.headline
                FROM government_alerts a
                JOIN spatial_cells c ON a.geom IS NOT NULL AND ST_Intersects(a.geom, c.geom)
                WHERE c.district_code = :d
                  AND a.hazard = CAST(:h AS hazard_type)
                  AND (a.expires_at IS NULL OR a.expires_at > now())
            """), {"d": district, "h": hazard})).mappings().all()
            alert_by_cell = {a["cell_id"]: dict(a) for a in alerts}

            reports = (await s.execute(text("""
                SELECT cell_id, COUNT(*) AS n FROM citizen_reports
                WHERE status = 'verified' AND submitted_at > now() - INTERVAL '12 hours'
                  AND cell_id = ANY(:cells) GROUP BY cell_id
            """), {"cells": cell_ids})).mappings().all()
            reports_by_cell = {r["cell_id"]: r["n"] for r in reports}

            spec = hz_cat.CATALOGUE.get(hazard)
            expected_sources = set(spec.authoritative) if spec else {"imd"}
            catalogue_degraded = spec.degraded_inputs() if spec else []
            calib = float((model.metrics.get("validation", {}).get("ece", 0.0))
                          if model else 0.3)

            # ── risk ──────────────────────────────────────────────────
            risk_rows, risk_by_id = [], {}
            for cell in cells:
                cid = cell["cell_id"]
                fr = feature_by_id.get(cid)
                pred = pred_by_id.get(cid)
                out = self.risk.compute(RiskInputs(
                    cell_id=cid, hazard=hazard,
                    probability=pred["probability"] if pred else None,
                    model_version=pred["model_version"] if pred else None,
                    features=fr.values if fr else {},
                    feature_ages_s=fr.ages_s if fr else {},
                    sources_present=fr.sources_present if fr else set(),
                    sources_expected=expected_sources,
                    official_alert=alert_by_cell.get(cid),
                    verified_reports=reports_by_cell.get(cid, 0),
                    model_calibration_error=calib,
                ))
                # An authoritative source that is not configured at all is a
                # standing degradation, separate from one that is merely stale.
                for k in catalogue_degraded:
                    if k not in out.degraded_inputs:
                        out.degraded_inputs.append(k)
                risk_by_id[cid] = out
                risk_rows.append(out)
                PREDICTIONS.labels(hazard, out.level).inc()
                MODEL_CONFIDENCE.labels(hazard).observe(out.confidence)
                if out.degraded_inputs:
                    DEGRADED_PREDICTIONS.labels(hazard).inc()

            await self._persist_predictions(s, predictions, risk_by_id, hazard)
            await self._persist_risk(s, risk_rows)

            # ── divide and conquer sweep, for the hotspot summary ─────
            self._quadtree_sweep(cells, risk_by_id)

            # ── exposure and vulnerability ────────────────────────────
            # Route redundancy costs a Dijkstra per path per cell, so it is
            # computed only where the risk already earns a place in the
            # ranking. Everywhere else the term stays unmeasured rather than
            # assumed — same threshold the priority stage uses below.
            access_by_id = await self._accessibility(
                s, district, {cid for cid, r in risk_by_id.items() if r.score >= 20})

            exposure_by_id, vuln_by_id = {}, {}
            for cell in cells:
                cid = cell["cell_id"]
                r = risk_by_id[cid]
                if r.probability is None:
                    continue
                fr = feature_by_id.get(cid)
                ex = self.exposure.compute(ExposureInputs(
                    cell_id=cid, hazard=hazard, probability=r.probability,
                    population=cell["population"],
                    population_density=_f(cell["population_density"]),
                    area_km2=_f(cell["area_km2"]),
                    building_count=cell["building_count"],
                    road_length_m=_f(cell["road_length_m"]),
                    height_above_river_m=_f(cell["height_above_river_m"]),
                    elevation_m=_f(cell["elevation_m"]),
                    slope_deg=_f(cell["slope_deg"]),
                    time_of_day_hour=now.hour,
                ))
                exposure_by_id[cid] = ex
                acc = access_by_id.get(cid, {})
                area = _f(cell["area_km2"]) or 0.0
                road_len = _f(cell["road_length_m"])
                vuln_by_id[cid] = self.vulnerability.compute(VulnerabilityInputs(
                    cell_id=cid, slope_deg=_f(cell["slope_deg"]),
                    population_density=_f(cell["population_density"]),
                    # These five were never supplied, so every one of the
                    # engine's six terms evaluated to "input unavailable" and
                    # the score came back 0.0 for every cell in the country —
                    # a missing input reading as "easy to protect".
                    dist_to_shelter_m=acc.get("dist_shelter_m"),
                    travel_time_to_shelter_s=acc.get("travel_time_s"),
                    dist_to_hospital_m=acc.get("dist_hospital_m"),
                    independent_routes_out=acc.get("routes_out"),
                    blocked_routes=acc.get("blocked_routes", 0),
                    road_density_m_per_km2=(road_len / area) if road_len and area else None,
                    monsoon_season=now.month in (6, 7, 8, 9),
                    is_night=now.hour >= 20 or now.hour < 6,
                ))
            await self._persist_exposure(s, exposure_by_id.values())
            await self._persist_vulnerability(s, vuln_by_id.values())

            # ── priority (merge sort) ─────────────────────────────────
            inputs = [
                PriorityInputs(
                    cell_id=cid, hazard=hazard,
                    risk_score=risk_by_id[cid].score,
                    expected_exposed=ex.expected_exposed,
                    population_in_footprint=ex.population_in_footprint,
                    # None means "not measured here", and the priority engine
                    # renormalises around it rather than scoring it 0.
                    vulnerability=vuln_by_id[cid].score,
                    time_to_impact_h=risk_by_id[cid].time_to_impact_h,
                    confidence=risk_by_id[cid].confidence,
                )
                for cid, ex in exposure_by_id.items()
                if risk_by_id[cid].score >= 20
            ]
            zones, report = self.priority.rank(inputs)
            for z in zones[:50]:
                self.priority.verify(z)
            await self._persist_priorities(s, zones, hazard)

            # ── capacity and evacuation ───────────────────────────────
            plan = await self._plan_evacuation(s, district, hazard, zones[:25], cell_by_id,
                                               risk_by_id)

        # ── push to the dashboard ─────────────────────────────────────
        top = sorted(risk_rows, key=lambda r: r.score, reverse=True)[:400]
        await hub.publish(f"risk:{district}", {
            "type": "risk_update", "district": district, "hazard": hazard,
            "trigger": trigger, "cells": [r.as_row() for r in top],
            "computed_at": now.isoformat(),
            "latency_ms": int((datetime.now(UTC) - now).total_seconds() * 1000),
        })
        await hub.priorities_updated(
            district, [z.as_row(self.priority.version) for z in zones[:25]], report)

        CELLS_SCORED.labels(hazard).set(len(risk_rows))
        CRITICAL_CELLS.labels(hazard, district).set(
            sum(1 for r in risk_rows if r.level == "critical"))
        PIPELINE_LAG.set(0)
        log.info("analysed %s/%s (%s): %d cells, %d critical, %d priority zones, "
                 "%d evacuation assignments",
                 district, hazard, trigger, len(risk_rows),
                 sum(1 for r in risk_rows if r.level == "critical"),
                 len(zones), len(plan.assignments) if plan else 0)

    # ── quadtree sweep ────────────────────────────────────────────────
    def _quadtree_sweep(self, cells, risk_by_id) -> None:
        from app.spatial.quadtree import BBox, analyse_region, sampler_from_cells

        lats = [c["lat"] for c in cells]
        lons = [c["lon"] for c in cells]
        if not lats:
            return
        sampler = sampler_from_cells(
            [{"cell_id": c["cell_id"], "score": risk_by_id[c["cell_id"]].score}
             for c in cells if c["cell_id"] in risk_by_id])
        _, stats = analyse_region(
            BBox(min(lons), min(lats), max(lons), max(lats)), sampler)
        QUADTREE_PRUNE_RATE.set(stats.prune_rate)
        QUADTREE_SAMPLES.observe(stats.samples_taken)

    # ── evacuation ────────────────────────────────────────────────────
    async def _plan_evacuation(self, s, district, hazard, zones, cell_by_id, risk_by_id):
        if not zones or self.graph.node_count == 0:
            return None

        shelters = (await s.execute(text("""
            SELECT v.*, ST_Y(v.geom) AS lat, ST_X(v.geom) AS lon,
                   COALESCE(r.score, 0) AS hazard_risk
            FROM v_shelter_live v
            LEFT JOIN v_cell_current_risk r
                   ON r.cell_id = v.cell_id AND r.hazard = CAST(:h AS hazard_type)
            WHERE v.district_code = :d
        """), {"d": district, "h": hazard})).mappings().all()
        if not shelters:
            return None

        results, meta = [], {}
        for sh in shelters:
            results.append(self.capacity.compute(ShelterState(
                shelter_id=sh["shelter_id"], name=sh["name"],
                max_capacity=sh["max_capacity"] or 0,
                current_occupancy=sh["current_occupancy"] or 0,
                state=sh["state"] or "open",
                water_days_remaining=_f(sh["water_days_remaining"]),
                food_days_remaining=_f(sh["food_days_remaining"]),
                medical_staff_present=sh["medical_staff_present"],
                has_power_backup=bool(sh["has_power_backup"]),
                hazard_risk=float(sh["hazard_risk"] or 0),
                reported_at=sh["reported_at"],
            )))
            meta[sh["shelter_id"]] = {"lat": sh["lat"], "lon": sh["lon"],
                                      "nearest_node": sh["nearest_node"],
                                      "hazard_risk": float(sh["hazard_risk"] or 0)}

        self.graph.set_cell_risk({cid: r.score for cid, r in risk_by_id.items()})

        node_for_cell = dict((await s.execute(text("""
            SELECT c.cell_id, (SELECT n.node_id FROM road_nodes n
                               ORDER BY n.geom <-> c.centroid LIMIT 1) AS node_id
            FROM spatial_cells c WHERE c.cell_id = ANY(:cells)
        """), {"cells": [z.cell_id for z in zones]})).all())

        evac_zones = [
            EvacZone(cell_id=z.cell_id, name=z.name,
                     lat=cell_by_id[z.cell_id]["lat"], lon=cell_by_id[z.cell_id]["lon"],
                     nearest_node=node_for_cell.get(z.cell_id),
                     people=z.people_to_move, priority_rank=z.rank,
                     priority_score=z.priority_score, hazard=hazard,
                     time_to_impact_h=z.time_to_impact_h)
            for z in zones if z.cell_id in cell_by_id
        ]
        plan = EvacuationOptimizer(self.graph).plan(evac_zones, results, meta)
        await self._persist_routes(s, plan, hazard)
        return plan

    # ══════════════════════════════════════════════════════════════════
    # Persistence
    # ══════════════════════════════════════════════════════════════════
    async def _persist_predictions(self, s, predictions, risk_by_id, hazard):
        if not predictions:
            return
        await s.execute(text("""
            INSERT INTO hazard_predictions
              (cell_id, hazard, model_version, valid_from, valid_to, horizon_hours,
               probability, level, confidence, feature_snapshot, top_contributors,
               degraded_inputs)
            VALUES (:cell_id, CAST(:hazard AS hazard_type), :model_version,
                    now(), now() + (:horizon * INTERVAL '1 hour'), :horizon,
                    :probability, CAST(:level AS risk_level), :confidence,
                    CAST(:snapshot AS jsonb), CAST(:contrib AS jsonb), :degraded)
        """), [{
            "cell_id": p["cell_id"], "hazard": hazard,
            "model_version": p["model_version"], "horizon": p["horizon_hours"],
            "probability": p["probability"],
            "level": risk_by_id[p["cell_id"]].level,
            "confidence": risk_by_id[p["cell_id"]].confidence,
            "snapshot": json.dumps(p.get("feature_snapshot") or {}, default=str),
            "contrib": json.dumps(p.get("top_contributors") or [], default=str),
            "degraded": risk_by_id[p["cell_id"]].degraded_inputs,
        } for p in predictions])

    async def _persist_risk(self, s, rows):
        usable = [r for r in rows if r.score >= 0]
        if not usable:
            return
        await s.execute(text("""
            INSERT INTO risk_scores (cell_id, hazard, score, level, probability,
                                     intensity, confidence, time_to_impact_h, components)
            VALUES (:cell_id, CAST(:hazard AS hazard_type), :score,
                    CAST(:level AS risk_level), :probability, :intensity, :confidence,
                    :time_to_impact_h, CAST(:components AS jsonb))
        """), [{**r.as_row(), "components": json.dumps(r.components, default=str)}
               for r in usable])

    async def _persist_exposure(self, s, outputs):
        rows = [o for o in outputs if not o.unknown_population]
        if not rows:
            return
        await s.execute(text("""
            INSERT INTO exposure_scores
              (cell_id, hazard, population_total, population_in_footprint, expected_exposed,
               buildings_exposed, road_length_exposed_m, hospitals_exposed, method, components)
            VALUES (:cell_id, CAST(:hazard AS hazard_type), :population_total,
                    :population_in_footprint, :expected_exposed, :buildings_exposed,
                    :road_length_exposed_m, :hospitals_exposed, :method,
                    CAST(:components AS jsonb))
        """), [{**o.as_row(), "components": json.dumps(o.components, default=str)}
               for o in rows])

    async def _accessibility(self, s, district: str,
                             graph_cells: set[str] | None = None) -> dict[str, dict]:
        """How hard is each cell to reach, and to leave?

        The vulnerability engine asks four physical questions — how far to a
        shelter, how far to a hospital, how many independent ways out, and how
        many of those are cut — and every one of them was going unanswered, so
        four of the engine's six terms returned "input unavailable" for every
        cell in the country and the score came back 0.0 everywhere.

        Distances come from PostGIS KNN (`<->`), which rides the GiST indexes in
        002_indexes.sql instead of cross-joining every cell against every
        shelter. Route redundancy is the expensive one — a greedy edge-disjoint
        search is a Dijkstra per path per cell — so it is computed only for
        `graph_cells`, the cells whose risk already earns them a place in the
        ranking. Every other cell keeps `routes_out=None`, which the engine
        reads as "not measured here" and renormalises around. It is never
        filled in with a guess.
        """
        rows = (await s.execute(text("""
            SELECT c.cell_id,
                   sh.dist_m AS dist_shelter_m,
                   ho.dist_m AS dist_hospital_m
            FROM spatial_cells c
            LEFT JOIN LATERAL (
                SELECT ST_Distance(c.centroid::geography, s2.geom::geography) AS dist_m
                FROM shelters s2 ORDER BY c.centroid <-> s2.geom LIMIT 1
            ) sh ON TRUE
            LEFT JOIN LATERAL (
                SELECT ST_Distance(c.centroid::geography, h2.geom::geography) AS dist_m
                FROM hospitals h2 ORDER BY c.centroid <-> h2.geom LIMIT 1
            ) ho ON TRUE
            WHERE c.district_code = :d
        """), {"d": district})).mappings().all()

        # Roads touching this cell that are impassable right now. Needs
        # roads.cell_ids, which link_roads_to_cells() populates.
        blocked = {r["cell_id"]: r["n"] for r in (await s.execute(text("""
            SELECT UNNEST(cell_ids) AS cell_id, COUNT(*) AS n
            FROM v_road_live
            WHERE current_state IN ('blocked', 'flooded', 'landslide')
              AND cell_ids IS NOT NULL AND cardinality(cell_ids) > 0
            GROUP BY 1
        """))).mappings().all()}

        out: dict[str, dict] = {}
        for r in rows:
            d_sh = _f(r["dist_shelter_m"])
            out[r["cell_id"]] = {
                "dist_shelter_m": d_sh,
                "dist_hospital_m": _f(r["dist_hospital_m"]),
                "blocked_routes": int(blocked.get(r["cell_id"], 0)),
                "routes_out": None,
                # A straight-line distance over a walking pace is a LOWER BOUND
                # on travel time, not an estimate of it. Terrain and the road
                # network can only make it worse, so a vulnerability score built
                # on it errs toward "easier than reality" — which is the wrong
                # direction, and is why the graph answer replaces it below
                # wherever the graph can supply one.
                "travel_time_s": (d_sh / 1.34) if d_sh is not None else None,
            }

        if not graph_cells or self.graph is None or self.graph.node_count == 0:
            return out

        # Shelters are the destinations that count as "out".
        safe = {n for (n,) in (await s.execute(text("""
            SELECT DISTINCT nearest_node FROM v_shelter_live
            WHERE district_code = :d AND nearest_node IS NOT NULL
              AND state = 'open'
        """), {"d": district})).all() if n is not None}
        if not safe:
            return out

        nodes = dict((await s.execute(text("""
            SELECT c.cell_id, (SELECT n.node_id FROM road_nodes n
                               ORDER BY n.geom <-> c.centroid LIMIT 1) AS node_id
            FROM spatial_cells c WHERE c.cell_id = ANY(:cells)
        """), {"cells": sorted(graph_cells)})).all())

        for cid, node in nodes.items():
            if node is None or cid not in out:
                continue
            try:
                src = int(node)
                out[cid]["routes_out"] = self.graph.independent_routes(src, safe)
                # One Dijkstra already gives the best reachable shelter, so the
                # travel time is the real network time rather than the
                # straight-line lower bound seeded above.
                dist, prev, settled = self.graph.dijkstra(src, targets=safe)
                reached = [n for n in safe if n in dist]
                if reached:
                    best = min(reached, key=lambda n: dist[n])
                    route = self.graph.path_from_dijkstra(src, best, prev, settled)
                    if route.feasible and route.travel_time_s > 0:
                        out[cid]["travel_time_s"] = float(route.travel_time_s)
            except Exception:                              # noqa: BLE001
                # A graph failure leaves the field unmeasured. It does not
                # invent a number, and it does not abort the whole tick.
                log.debug("route redundancy unavailable for %s", cid, exc_info=True)
        return out

    async def _persist_vulnerability(self, s, outputs):
        rows = list(outputs)
        if not rows:
            return
        # score is NULL when no term had an input. Storing 0.0 there would make
        # "we could not measure this" indistinguishable from "this is the
        # easiest place in the district to evacuate".
        await s.execute(text("""
            INSERT INTO vulnerability_scores (cell_id, score, components, explanation)
            VALUES (:cell_id, :score, CAST(:components AS jsonb), :explanation)
        """), [{"cell_id": o.cell_id, "score": o.score,
                "components": json.dumps(o.terms, default=str),
                "explanation": o.explanation} for o in rows])

    async def _persist_priorities(self, s, zones, hazard):
        if not zones:
            return
        await s.execute(text("""
            INSERT INTO relocation_priorities
              (cell_id, hazard, rank, priority_score, band, weights_version, terms,
               reasons, people_to_move)
            VALUES (:cell_id, CAST(:hazard AS hazard_type), :rank, :priority_score,
                    CAST(:band AS risk_level), :weights_version, CAST(:terms AS jsonb),
                    :reasons, :people_to_move)
        """), [{**z.as_row(self.priority.version),
                "terms": json.dumps(z.terms, default=str)} for z in zones])

    async def _persist_routes(self, s, plan, hazard):
        if plan is None or not plan.assignments:
            return
        await s.execute(text("""
            INSERT INTO evacuation_routes
              (origin_cell, shelter_id, hazard, people_assigned, distance_m, travel_time_s,
               hazard_exposure, algorithm, road_ids, feasible)
            VALUES (:cell_id, :shelter_id, CAST(:hazard AS hazard_type), :people,
                    :distance_m, :travel_time_s, :hazard_exposure, :algorithm,
                    :road_ids, TRUE)
        """), [{"cell_id": a.cell_id, "shelter_id": a.shelter_id, "hazard": hazard,
                "people": a.people, "distance_m": a.distance_m,
                "travel_time_s": a.travel_time_s, "hazard_exposure": a.hazard_exposure,
                "algorithm": a.route.algorithm if a.route else "straight_line_fallback",
                "road_ids": a.route.road_ids if a.route else []}
               for a in plan.assignments])

    # ══════════════════════════════════════════════════════════════════
    # Watchdog — notice when the platform stops updating
    # ══════════════════════════════════════════════════════════════════
    async def tick_watchdog(self) -> None:
        """Detect a stalled pipeline and say so, loudly.

        Everything else in this file makes the platform update. This makes it
        notice when it has *stopped*. A dashboard showing four-hour-old figures
        with a green badge is more dangerous than one showing nothing, because
        an operator will act on it — so the age of the newest computation is a
        first-class metric, it drives readiness, and it reaches every open
        dashboard.
        """
        async with session_scope() as s:
            row = (await s.execute(text("""
                SELECT MAX(computed_at) AS newest,
                       COUNT(*) FILTER (WHERE computed_at > now() - INTERVAL '15 minutes')
                           AS recent
                FROM risk_scores
            """))).mappings().first()

        newest = row["newest"] if row else None
        if newest is None:
            # Never produced. Distinct from "stopped producing", and the
            # message has to say which, or an operator debugging at 3 a.m.
            # cannot tell a cold start from a failure.
            PIPELINE_LAG.set(-1)
            await hub.publish("system", {
                "type": "pipeline_health", "state": "never_ran",
                "detail": "No risk score has ever been computed. Check that the grid "
                          "is built and at least one hazard has a configured source.",
            })
            return

        if newest.tzinfo is None:
            newest = newest.replace(tzinfo=UTC)
        age = (datetime.now(UTC) - newest).total_seconds()
        PIPELINE_LAG.set(age)

        budget = settings.risk_interval_seconds
        if age > budget * 4:
            state, level = "stalled", "crit"
        elif age > budget * 2:
            state, level = "lagging", "warn"
        else:
            state, level = "healthy", "ok"

        if state != self._last_health:
            self._last_health = state
            if state == "stalled":
                log.error("pipeline has not produced a result in %.0f minutes "
                          "(budget %.0f min) — dashboards are showing stale figures",
                          age / 60, budget / 60)
            elif state == "lagging":
                log.warning("pipeline is %.0f minutes behind its %.0f-minute budget",
                            age / 60, budget / 60)
            else:
                log.info("pipeline healthy again — last result %.0fs ago", age)

        await hub.publish("system", {
            "type": "pipeline_health", "state": state, "level": level,
            "age_seconds": round(age), "budget_seconds": budget,
            "recent_scores": row["recent"],
            "computed_at": newest.isoformat(),
            "detail": ("Producing normally." if state == "healthy"
                       else f"No new result for {age / 60:.0f} minutes. Figures on "
                            f"screen are that old — do not treat them as current."),
        })

    # ══════════════════════════════════════════════════════════════════
    # Quality (§26)
    # ══════════════════════════════════════════════════════════════════
    async def tick_quality(self) -> None:
        async with session_scope() as s:
            rows = (await s.execute(text("""
                SELECT key, is_primary, status, last_success_at, staleness_threshold_s,
                       quality_score, authority
                FROM data_sources
            """))).mappings().all()
            now = datetime.now(UTC)
            payload, changed = [], []
            for r in rows:
                age = ((now - r["last_success_at"]).total_seconds()
                       if r["last_success_at"] else None)
                SOURCE_STALENESS.labels(r["key"], str(r["is_primary"])).set(
                    age if age is not None else 10 ** 6)
                stale = age is not None and age > r["staleness_threshold_s"]
                if stale and r["status"] == "live":
                    changed.append(r["key"])
                payload.append({"key": r["key"], "authority": r["authority"],
                                "status": "stale" if stale else r["status"],
                                "age_seconds": age, "is_primary": r["is_primary"],
                                "quality_score": _f(r["quality_score"])})
            if changed:
                await s.execute(text("""
                    UPDATE data_sources SET status = 'stale', updated_at = now()
                    WHERE key = ANY(:keys)
                """), {"keys": changed})
                log.warning("sources marked stale: %s", ", ".join(changed))
        await hub.source_health(payload)

    async def _load_active_models(self) -> None:
        try:
            async with session_scope() as s:
                rows = (await s.execute(text("""
                    SELECT hazard, model_version FROM model_versions WHERE is_active
                """))).all()
            if rows:
                self.registry.load_active({h: v for h, v in rows})
                log.info("loaded %d active models", len(rows))
            else:
                log.warning("no active models registered — the platform will serve "
                            "official alerts and observations, and report 'no model "
                            "output' for risk rather than inventing a score")
        except Exception:                              # noqa: BLE001
            log.exception("could not load active models")


def _f(v):
    return None if v is None else float(v)
