"""
Security and edge-case tests.

Each test names the attack or the failure it prevents. A test whose failure
message does not tell you what an attacker could do is not carrying its weight.
"""
from __future__ import annotations

import asyncio
import hmac
import time
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

from app.core.hardening import (
    INSECURE_SECRETS,
    LIMITS,
    SlidingWindowLimiter,
    clean_text,
    new_shared_secret,
    verify_push_signature,
)
from app.core.security import PERMISSIONS, Operator, Role
from app.realtime import RecomputeBus, Trigger


# ══════════════════════════════════════════════════════════════════════
# Push ingress signatures
# ══════════════════════════════════════════════════════════════════════
class TestPushSignature:
    SECRET = "a-real-shared-secret-with-enough-entropy"

    def _sign(self, body: bytes, ts: str | None = None) -> tuple[str, str]:
        ts = ts or str(int(time.time()))
        sig = hmac.new(self.SECRET.encode(), f"{ts}.".encode() + body, "sha256").hexdigest()
        return sig, ts

    def test_valid_signature_passes(self):
        body = b'{"kind":"road_status"}'
        sig, ts = self._sign(body)
        verify_push_signature(body, sig, ts, self.SECRET)      # must not raise

    def test_tampered_body_is_rejected(self):
        """The whole point: an attacker who intercepts a road-closure event
        must not be able to change which road it closes."""
        body = b'{"road_id":1,"state":"open"}'
        sig, ts = self._sign(body)
        with pytest.raises(HTTPException) as exc:
            verify_push_signature(b'{"road_id":1,"state":"blocked"}', sig, ts, self.SECRET)
        assert exc.value.status_code == 401

    def test_wrong_secret_is_rejected(self):
        body = b'{"kind":"observation"}'
        sig, ts = self._sign(body)
        with pytest.raises(HTTPException):
            verify_push_signature(body, sig, ts, "a-different-secret")

    def test_replay_outside_the_window_is_rejected(self):
        """Without timestamp binding a captured valid request works forever."""
        body = b'{"kind":"observation"}'
        old = str(int(time.time()) - 3600)
        sig, ts = self._sign(body, old)
        with pytest.raises(HTTPException, match="out of tolerance"):
            verify_push_signature(body, sig, ts, self.SECRET)

    def test_future_timestamp_is_rejected(self):
        body = b'{"kind":"observation"}'
        future = str(int(time.time()) + 3600)
        sig, ts = self._sign(body, future)
        with pytest.raises(HTTPException, match="out of tolerance"):
            verify_push_signature(body, sig, ts, self.SECRET)

    def test_timestamp_is_covered_by_the_signature(self):
        """Moving the timestamp forward must invalidate the signature, or the
        replay window is trivially extendable."""
        body = b'{"kind":"observation"}'
        sig, ts = self._sign(body)
        with pytest.raises(HTTPException):
            verify_push_signature(body, sig, str(int(ts) + 1), self.SECRET)

    def test_missing_headers_are_rejected(self):
        with pytest.raises(HTTPException, match="Missing"):
            verify_push_signature(b"{}", "", "", self.SECRET)

    def test_unconfigured_secret_refuses_rather_than_accepting(self):
        """Fail closed. An empty shared secret must not mean 'accept anything'."""
        with pytest.raises(HTTPException) as exc:
            verify_push_signature(b"{}", "abc", str(int(time.time())), "")
        assert exc.value.status_code == 503

    def test_malformed_timestamp_is_rejected(self):
        with pytest.raises(HTTPException, match="Malformed"):
            verify_push_signature(b"{}", "abc", "not-a-number", self.SECRET)

    def test_generated_secrets_are_unique_and_long(self):
        secrets_ = {new_shared_secret() for _ in range(50)}
        assert len(secrets_) == 50
        assert all(len(s) >= 40 for s in secrets_)
        assert not (secrets_ & INSECURE_SECRETS)


# ══════════════════════════════════════════════════════════════════════
# Rate limiting
# ══════════════════════════════════════════════════════════════════════
class TestRateLimit:
    def test_blocks_after_the_limit(self):
        limiter = SlidingWindowLimiter()
        limit = LIMITS["auth"].requests
        for _ in range(limit):
            ok, _, _ = limiter.check("attacker", "auth")
            assert ok
        ok, remaining, retry = limiter.check("attacker", "auth")
        assert not ok and remaining == 0 and retry > 0

    def test_login_is_the_tightest_bucket(self):
        """Brute-forcing an operator password must be the hardest thing to do."""
        assert LIMITS["auth"].requests < LIMITS["operator_write"].requests
        assert LIMITS["auth"].requests < LIMITS["public_read"].requests

    def test_public_reads_are_generous(self):
        """During an event a district's whole population refreshes the citizen
        portal. Rate-limiting them off the shelter list would be the real harm."""
        assert LIMITS["public_read"].requests >= 300

    def test_clients_do_not_share_a_bucket(self):
        limiter = SlidingWindowLimiter()
        for _ in range(LIMITS["auth"].requests):
            limiter.check("attacker", "auth")
        ok, _, _ = limiter.check("innocent-bystander", "auth")
        assert ok, "one abusive client locked out everyone else"

    def test_buckets_are_independent(self):
        limiter = SlidingWindowLimiter()
        for _ in range(LIMITS["auth"].requests):
            limiter.check("c", "auth")
        assert limiter.check("c", "public_read")[0], "a failed login blocked reading alerts"

    def test_window_slides(self):
        limiter = SlidingWindowLimiter()
        LIMITS["_test"] = LIMITS["auth"].__class__(requests=2, window_s=1)
        assert limiter.check("c", "_test")[0]
        assert limiter.check("c", "_test")[0]
        assert not limiter.check("c", "_test")[0]
        time.sleep(1.05)
        assert limiter.check("c", "_test")[0], "the window never reopened"
        del LIMITS["_test"]

    def test_memory_does_not_grow_without_bound(self):
        limiter = SlidingWindowLimiter()
        for i in range(500):
            limiter.check(f"client-{i}", "public_read")
        limiter._sweep(time.monotonic() + 10_000)
        assert len(limiter._hits) == 0


# ══════════════════════════════════════════════════════════════════════
# Authorisation
# ══════════════════════════════════════════════════════════════════════
class TestAuthorisation:
    @staticmethod
    def _op(role: Role, **kw) -> Operator:
        return Operator(operator_id="op-1", full_name="Test", role=role, **kw)

    def test_public_cannot_write_anything(self):
        public = self._op(Role.PUBLIC)
        for permission in PERMISSIONS:
            if permission == "read_public":
                continue
            assert not public.can(permission), f"public was allowed to {permission}"

    def test_shelter_operator_cannot_report_roads(self):
        """Least privilege: a shelter operator's token, if stolen, must not be
        able to divert an evacuation by closing a road."""
        op = self._op(Role.SHELTER_OPERATOR)
        assert op.can("update_shelter_status")
        assert not op.can("report_road_status")
        assert not op.can("trigger_evacuation_plan")
        assert not op.can("configure_weights")

    def test_field_operator_cannot_change_shelter_occupancy(self):
        op = self._op(Role.FIELD_OPERATOR)
        assert op.can("report_road_status")
        assert not op.can("update_shelter_status")

    def test_only_admin_configures_weights_and_models(self):
        for role in (Role.PUBLIC, Role.FIELD_OPERATOR, Role.SHELTER_OPERATOR,
                     Role.DISTRICT_OPERATOR):
            op = self._op(role)
            assert not op.can("configure_weights")
            assert not op.can("manage_models")
            assert not op.can("manage_operators")
        assert self._op(Role.ADMIN).can("configure_weights")

    def test_shelter_scope_is_enforced(self):
        """IDOR: knowing another shelter's id must not be enough to update it."""
        op = self._op(Role.SHELTER_OPERATOR, assigned_shelters=["SH-201"])
        assert op.may_touch_shelter("SH-201")
        assert not op.may_touch_shelter("SH-205")

    def test_district_scope_is_enforced(self):
        op = self._op(Role.DISTRICT_OPERATOR, district_code="UT-CHAMOLI")
        assert op.may_touch_district("UT-CHAMOLI")
        assert not op.may_touch_district("UT-PAURI")

    def test_admin_transcends_scope(self):
        admin = self._op(Role.ADMIN)
        assert admin.may_touch_shelter("anything")
        assert admin.may_touch_district("any-district")

    def test_unknown_permission_denies(self):
        """Fail closed on a typo'd permission name rather than allowing it."""
        assert not self._op(Role.ADMIN).can("permission_that_does_not_exist")


# ══════════════════════════════════════════════════════════════════════
# Input sanitation
# ══════════════════════════════════════════════════════════════════════
class TestSanitation:
    def test_strips_control_characters(self):
        assert clean_text("water\x00 in\x07 houses") == "water in houses"

    def test_keeps_newlines_and_tabs(self):
        assert clean_text("line one\nline two") == "line one\nline two"

    def test_strips_zero_width_and_bidi_overrides(self):
        """Bidi overrides can make a report render as something other than what
        it says — the classic Trojan Source trick, applied to a dashboard."""
        assert clean_text("road‮ blocked​") == "road blocked"

    def test_caps_length(self):
        assert len(clean_text("x" * 50_000, max_length=2000)) == 2000

    def test_empty_after_cleaning_is_none(self):
        assert clean_text("\x00\x01  ​") is None
        assert clean_text(None) is None

    def test_preserves_devanagari(self):
        """A report in Hindi must survive sanitation intact."""
        text = "नंदप्रयाग में पानी घरों में घुस गया है"
        assert clean_text(text) == text

    def test_does_not_attempt_html_escaping(self):
        """Escaping belongs at render time. Escaping here would double-escape
        and corrupt a legitimate report containing < or &."""
        assert clean_text("water level < 1m & rising") == "water level < 1m & rising"


# ══════════════════════════════════════════════════════════════════════
# Real-time recompute bus
# ══════════════════════════════════════════════════════════════════════
class TestRecomputeBus:
    @pytest.mark.asyncio
    async def test_coalesces_a_burst_into_one_run(self):
        """Ten road closures in one second must not run ten district
        recomputes."""
        runs = []
        bus = RecomputeBus(lambda req: _record(runs, req), debounce_s=0.05)
        await bus.start()
        for i in range(10):
            bus.request("UT-CHAMOLI", "flood", Trigger.ROAD_STATUS, f"road {i}")
        await asyncio.sleep(0.4)
        await bus.stop()
        assert len(runs) == 1
        assert bus.stats["coalesced"] == 9

    @pytest.mark.asyncio
    async def test_different_districts_run_separately(self):
        runs = []
        bus = RecomputeBus(lambda req: _record(runs, req), debounce_s=0.05)
        await bus.start()
        bus.request("UT-CHAMOLI", "flood", Trigger.SCHEDULED)
        bus.request("UT-PAURI", "flood", Trigger.SCHEDULED)
        await asyncio.sleep(0.4)
        await bus.stop()
        assert {r.district for r in runs} == {"UT-CHAMOLI", "UT-PAURI"}

    @pytest.mark.asyncio
    async def test_most_significant_trigger_wins_the_headline(self):
        runs = []
        bus = RecomputeBus(lambda req: _record(runs, req), debounce_s=0.05)
        await bus.start()
        bus.request("UT-CHAMOLI", "flood", Trigger.SCHEDULED)
        bus.request("UT-CHAMOLI", "flood", Trigger.OFFICIAL_ALERT)
        bus.request("UT-CHAMOLI", "flood", Trigger.SCHEDULED)
        await asyncio.sleep(0.4)
        await bus.stop()
        assert runs[0].trigger is Trigger.OFFICIAL_ALERT

    @pytest.mark.asyncio
    async def test_a_failing_recompute_does_not_kill_the_bus(self):
        """A stage that throws must leave the previous results in place and the
        bus alive for the next event."""
        calls = {"n": 0}

        async def flaky(req):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("database blipped")

        bus = RecomputeBus(flaky, debounce_s=0.05)
        await bus.start()
        bus.request("UT-CHAMOLI", "flood", Trigger.SCHEDULED)
        await asyncio.sleep(0.3)
        bus.request("UT-CHAMOLI", "flood", Trigger.SCHEDULED)
        await asyncio.sleep(0.3)
        await bus.stop()
        assert calls["n"] >= 2
        assert bus.stats["failed"] == 1

    @pytest.mark.asyncio
    async def test_debounce_is_short_enough_to_feel_immediate(self):
        """The whole promise is 'no added latency'. A debounce an operator can
        perceive would break it."""
        bus = RecomputeBus(lambda req: asyncio.sleep(0))
        assert bus.debounce_s <= 1.0

    @pytest.mark.asyncio
    async def test_snapshot_is_serialisable(self):
        import json
        bus = RecomputeBus(lambda req: asyncio.sleep(0))
        json.dumps(bus.snapshot())


async def _record(sink: list, req):
    sink.append(req)


# ══════════════════════════════════════════════════════════════════════
# Edge cases across the engines
# ══════════════════════════════════════════════════════════════════════
class TestEdgeCases:
    def test_zero_population_does_not_divide_by_zero(self):
        from app.impact.exposure import ExposureEngine, ExposureInputs
        out = ExposureEngine().compute(ExposureInputs(
            cell_id="c", hazard="flood", probability=0.9, population=0,
            height_above_river_m=1.0))
        assert out.expected_exposed == 0
        assert not out.unknown_population        # zero people is known, not unknown

    def test_zero_capacity_shelter_does_not_divide_by_zero(self):
        from app.capacity.engine import CapacityEngine, ShelterState
        out = CapacityEngine().compute(ShelterState(
            shelter_id="S", name="Empty", max_capacity=0, current_occupancy=0))
        assert out.effective_capacity == 0
        assert out.utilisation == 1.0            # a zero-capacity shelter is full

    def test_empty_priority_list_ranks_cleanly(self):
        from app.priority.engine import PriorityEngine
        zones, report = PriorityEngine().rank([])
        assert zones == []
        assert report["n"] == 0

    def test_single_zone_ranks_cleanly(self):
        from app.priority.engine import PriorityEngine, PriorityInputs
        zones, report = PriorityEngine().rank([PriorityInputs(
            cell_id="c", hazard="flood", risk_score=50, expected_exposed=10,
            population_in_footprint=12, vulnerability=0.5)])
        assert len(zones) == 1 and zones[0].rank == 1
        assert report["comparisons"] == 0

    def test_naive_datetime_is_treated_as_utc(self):
        """A timestamp with no timezone must not be read as local time, or the
        as-of feature window silently shifts by 5.5 hours in India."""
        from app.risk.engine import age_seconds
        naive = datetime.utcnow() - timedelta(hours=1)
        assert 3500 < age_seconds(naive) < 3700

    def test_future_observation_has_zero_age_not_negative(self):
        from app.risk.engine import age_seconds
        assert age_seconds(datetime.now(UTC) + timedelta(hours=1)) == 0.0

    def test_missing_observation_is_infinitely_old(self):
        from app.risk.engine import age_seconds, is_stale
        assert age_seconds(None) == float("inf")
        assert is_stale(None, 3600)

    def test_probability_of_exactly_zero_is_not_no_data(self):
        """0.0 means the model ran and said no. None means it did not run. The
        two must not collapse."""
        from app.risk.engine import RiskEngine, RiskInputs
        zero = RiskEngine().compute(RiskInputs(
            cell_id="c", hazard="flood", probability=0.0, model_version="m", features={}))
        assert zero.level == "low"
        assert zero.score == 0.0
        none = RiskEngine().compute(RiskInputs(
            cell_id="c", hazard="flood", probability=None, model_version=None))
        assert none.level == "no_data"

    def test_kdtree_handles_a_single_point(self):
        from app.spatial.nearest import KDTree
        tree = KDTree([(30.0, 79.0, {"i": 0})])
        assert tree.nearest(30.5, 79.5, k=5)[0][1]["i"] == 0

    def test_kdtree_handles_duplicate_positions(self):
        from app.spatial.nearest import KDTree
        tree = KDTree([(30.0, 79.0, {"i": i}) for i in range(5)])
        assert len(tree.nearest(30.0, 79.0, k=3)) == 3

    def test_routing_on_an_empty_graph_is_infeasible_not_a_crash(self):
        from app.routing.graph import RoadGraph
        route = RoadGraph().astar(1, 2)
        assert not route.feasible

    def test_route_to_self_is_trivially_feasible(self):
        from app.routing.graph import RoadGraph
        g = RoadGraph()
        g.add_node(1, 30.0, 79.0)
        route = g.astar(1, 1)
        assert route.feasible and route.distance_m == 0

    def test_evacuation_with_no_shelters_reports_everyone_unassigned(self):
        from app.evacuation.optimizer import EvacuationOptimizer, EvacZone
        from app.routing.graph import RoadGraph
        plan = EvacuationOptimizer(RoadGraph()).plan(
            [EvacZone(cell_id="c", name="X", lat=30.0, lon=79.0, nearest_node=1,
                      people=500, priority_rank=1, priority_score=0.9, hazard="flood")],
            [], {})
        assert plan.people_placed == 0
        assert plan.people_unplaced == 500
        assert plan.unassigned[0].reason

    def test_quadtree_on_a_degenerate_bbox(self):
        from app.spatial.quadtree import BBox, analyse_region
        result, stats = analyse_region(BBox(79.0, 30.0, 79.0, 30.0),
                                       lambda lon, lat: 50.0)
        assert stats.visited >= 1
        assert result.max_risk == 50.0


# ══════════════════════════════════════════════════════════════════════
# The credential bridge — throttling, lockout and step-up
# ══════════════════════════════════════════════════════════════════════
from app.core.lockout import (  # noqa: E402
    LoginGuard,
    StepUp,
    MAX_ACCOUNT_ATTEMPTS,
    MAX_ADDRESS_ATTEMPTS,
    MAX_LOCK_SECONDS,
    BASE_LOCK_SECONDS,
    STEP_UP_TTL_SECONDS,
)


class TestLoginGuard:
    def test_an_account_is_open_until_the_attempt_limit(self):
        g = LoginGuard()
        for _ in range(MAX_ACCOUNT_ATTEMPTS - 1):
            assert g.record_failure("dm.chamoli", "10.0.0.1") == 0
        assert g.account_locked_for("dm.chamoli") == 0

    def test_the_limit_locks_the_account(self):
        g = LoginGuard()
        for _ in range(MAX_ACCOUNT_ATTEMPTS):
            g.record_failure("dm.chamoli", "10.0.0.1")
        assert g.account_locked_for("dm.chamoli") > 0

    def test_lockout_doubles_but_is_capped(self):
        """Uncapped exponential backoff locks an operator out for the rest
        of the shift after a dozen typos. During a flood that is a denial
        of service against the response itself."""
        g = LoginGuard(); now = 1000.0
        for _ in range(MAX_ACCOUNT_ATTEMPTS):
            g.record_failure("x", now=now)
        first = g.account_locked_for("x", now=now)
        g.record_failure("x", now=now)
        second = g.account_locked_for("x", now=now)
        assert second > first
        for _ in range(30):
            g.record_failure("x", now=now)
        assert g.account_locked_for("x", now=now) <= MAX_LOCK_SECONDS + 1

    def test_lockout_expires(self):
        g = LoginGuard(); now = 500.0
        for _ in range(MAX_ACCOUNT_ATTEMPTS):
            g.record_failure("x", now=now)
        assert g.account_locked_for("x", now=now) > 0
        assert g.account_locked_for("x", now=now + BASE_LOCK_SECONDS + 1) == 0

    def test_success_clears_the_account_counter(self):
        g = LoginGuard()
        for _ in range(MAX_ACCOUNT_ATTEMPTS - 1):
            g.record_failure("x", "10.0.0.1")
        g.record_success("x")
        assert g.attempts_remaining("x") == MAX_ACCOUNT_ATTEMPTS

    def test_enumeration_across_many_accounts_trips_the_address_limit(self):
        """One password against two hundred usernames never trips a
        per-account counter. This is the case the address limit exists for."""
        g = LoginGuard()
        for i in range(MAX_ADDRESS_ATTEMPTS):
            g.record_failure(f"operator{i}", "203.0.113.9")
        assert g.address_blocked("203.0.113.9")
        assert all(g.account_locked_for(f"operator{i}") == 0
                   for i in range(MAX_ADDRESS_ATTEMPTS))

    def test_one_success_does_not_forget_the_guessing(self):
        g = LoginGuard()
        for i in range(MAX_ADDRESS_ATTEMPTS):
            g.record_failure(f"operator{i}", "203.0.113.9")
        g.record_success("operator3")
        assert g.address_blocked("203.0.113.9")

    def test_addresses_are_isolated_from_each_other(self):
        g = LoginGuard()
        for i in range(MAX_ADDRESS_ATTEMPTS):
            g.record_failure(f"o{i}", "203.0.113.9")
        assert not g.address_blocked("198.51.100.4")

    def test_the_address_window_slides(self):
        g = LoginGuard(); now = 100.0
        for i in range(MAX_ADDRESS_ATTEMPTS):
            g.record_failure(f"o{i}", "203.0.113.9", now=now)
        assert g.address_blocked("203.0.113.9", now=now)
        assert not g.address_blocked("203.0.113.9", now=now + 301)


class TestStepUp:
    def test_a_fresh_confirmation_is_valid(self):
        s = StepUp(); s.confirm("dm.chamoli")
        assert s.is_fresh("dm.chamoli")

    def test_an_unconfirmed_operator_is_not_fresh(self):
        assert not StepUp().is_fresh("dm.chamoli")

    def test_confirmation_expires(self):
        s = StepUp(); s.confirm("dm.chamoli", now=0.0)
        assert s.is_fresh("dm.chamoli", now=STEP_UP_TTL_SECONDS - 1)
        assert not s.is_fresh("dm.chamoli", now=STEP_UP_TTL_SECONDS + 1)

    def test_confirmations_do_not_leak_between_operators(self):
        s = StepUp(); s.confirm("dm.chamoli")
        assert not s.is_fresh("so.usdma")

    def test_revocation_is_immediate(self):
        s = StepUp(); s.confirm("dm.chamoli")
        s.revoke("dm.chamoli")
        assert not s.is_fresh("dm.chamoli")
