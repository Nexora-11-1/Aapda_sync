"""
Tests for the decision engines (§11, §12, §13, §17, §26, §28).

The theme running through these: the platform must degrade honestly. Most of
what follows checks that a missing input produces a stated absence rather than
a confident-looking zero.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.capacity.engine import CapacityEngine, ShelterState
from app.impact.exposure import ExposureEngine, ExposureInputs
from app.priority.engine import PriorityEngine, PriorityInputs
from app.risk.engine import RiskEngine, RiskInputs, band
from app.vulnerability.engine import VulnerabilityEngine, VulnerabilityInputs


# ══════════════════════════════════════════════════════════════════════
# Risk engine
# ══════════════════════════════════════════════════════════════════════
class TestRiskEngine:
    def setup_method(self):
        self.engine = RiskEngine()

    def test_no_model_output_is_no_data_not_zero(self):
        """The distinction the whole platform rests on: 'we don't know' must
        never render as 'no risk'."""
        out = self.engine.compute(RiskInputs(
            cell_id="c1", hazard="flood", probability=None, model_version=None))
        assert out.level == "no_data"
        assert out.score == -1.0
        assert "no_model_output" in out.degraded_inputs

    def test_bands_match_the_documented_thresholds(self):
        assert band(-1) == "no_data"
        assert band(0) == band(29.9) == "low"
        assert band(30) == band(59.9) == "medium"
        assert band(60) == band(84.9) == "high"
        assert band(85) == band(100) == "critical"

    def test_confidence_falls_when_a_primary_source_is_missing(self):
        common = dict(cell_id="c1", hazard="flood", probability=0.8,
                      model_version="m", features={"rainfall_24h": 120},
                      feature_ages_s={"weather": 300})
        full = self.engine.compute(RiskInputs(
            **common, sources_present={"imd", "cwc"}, sources_expected={"imd", "cwc"}))
        partial = self.engine.compute(RiskInputs(
            **common, sources_present={"imd"}, sources_expected={"imd", "cwc"}))
        assert partial.confidence < full.confidence
        assert "cwc" in partial.degraded_inputs

    def test_stale_inputs_are_penalised_and_named(self):
        fresh = self.engine.compute(RiskInputs(
            cell_id="c", hazard="flood", probability=0.8, model_version="m",
            features={"rainfall_24h": 120}, feature_ages_s={"weather": 300}))
        stale = self.engine.compute(RiskInputs(
            cell_id="c", hazard="flood", probability=0.8, model_version="m",
            features={"rainfall_24h": 120}, feature_ages_s={"weather": 30_000}))
        assert stale.confidence < fresh.confidence
        assert "stale_inputs" in stale.degraded_inputs
        # the probability itself is untouched — only trust in it falls
        assert stale.probability == fresh.probability

    def test_confidence_is_independent_of_probability(self):
        """A model can be 97% sure on thin data. Those are different numbers
        and the engine must keep them apart."""
        low_p = self.engine.compute(RiskInputs(
            cell_id="c", hazard="flood", probability=0.1, model_version="m",
            features={"rainfall_24h": 120}, feature_ages_s={"weather": 60},
            sources_present={"imd"}, sources_expected={"imd"}))
        high_p = self.engine.compute(RiskInputs(
            cell_id="c", hazard="flood", probability=0.97, model_version="m",
            features={"rainfall_24h": 120}, feature_ages_s={"weather": 60},
            sources_present={"imd"}, sources_expected={"imd"}))
        assert low_p.confidence == high_p.confidence

    def test_intensity_reflects_imd_rainfall_thresholds(self):
        light = self.engine.compute(RiskInputs(
            cell_id="c", hazard="flood", probability=0.5, model_version="m",
            features={"rainfall_24h": 20}))
        extreme = self.engine.compute(RiskInputs(
            cell_id="c", hazard="flood", probability=0.5, model_version="m",
            features={"rainfall_24h": 240}))
        assert extreme.intensity > light.intensity
        assert extreme.score > light.score
        assert any("extremely heavy" in w for w in extreme.components["why"])

    def test_landslide_failure_envelope(self):
        """25–45° is the classic failure envelope for Himalayan colluvium; a
        gentler or a much steeper slope should score lower intensity."""
        envelope = self.engine.compute(RiskInputs(
            cell_id="c", hazard="landslide", probability=0.5, model_version="m",
            features={"slope_deg": 33}))
        gentle = self.engine.compute(RiskInputs(
            cell_id="c", hazard="landslide", probability=0.5, model_version="m",
            features={"slope_deg": 8}))
        assert envelope.intensity > gentle.intensity

    def test_official_alert_corroborates_but_cannot_manufacture(self):
        alert = {"severity": "Extreme", "issuing_authority": "IMD Dehradun"}
        with_alert = self.engine.compute(RiskInputs(
            cell_id="c", hazard="flood", probability=0.6, model_version="m",
            features={}, official_alert=alert))
        without = self.engine.compute(RiskInputs(
            cell_id="c", hazard="flood", probability=0.6, model_version="m", features={}))
        assert with_alert.score > without.score
        # corroboration is capped: it cannot turn a near-zero signal into one
        near_zero = self.engine.compute(RiskInputs(
            cell_id="c", hazard="flood", probability=0.01, model_version="m",
            features={}, official_alert=alert))
        assert near_zero.score < 2.0

    def test_score_is_bounded(self):
        out = self.engine.compute(RiskInputs(
            cell_id="c", hazard="flood", probability=1.0, model_version="m",
            features={"rainfall_24h": 500, "river_level": 10, "danger_level": 5,
                      "height_above_river_m": 0},
            official_alert={"severity": "Extreme"}, satellite_confirmation=True,
            verified_reports=9))
        assert 0.0 <= out.score <= 100.0

    def test_output_always_carries_the_attribution(self):
        out = self.engine.compute(RiskInputs(
            cell_id="c", hazard="flood", probability=0.5, model_version="m", features={}))
        assert "not an official warning" in out.components["attribution"].lower()

    def test_time_to_impact_from_river_rise(self):
        out = self.engine.compute(RiskInputs(
            cell_id="c", hazard="flood", probability=0.7, model_version="m",
            features={"river_level": 8.0, "danger_level": 10.0,
                      "river_level_rate_1h": 0.5}))
        assert out.time_to_impact_h == pytest.approx(4.0)

    def test_already_at_danger_level_is_zero_hours(self):
        out = self.engine.compute(RiskInputs(
            cell_id="c", hazard="flood", probability=0.9, model_version="m",
            features={"river_level": 10.5, "danger_level": 10.0,
                      "river_level_rate_1h": 0.3}))
        assert out.time_to_impact_h == 0.0


# ══════════════════════════════════════════════════════════════════════
# Exposure (§11)
# ══════════════════════════════════════════════════════════════════════
class TestExposure:
    def setup_method(self):
        self.engine = ExposureEngine()

    def test_is_not_probability_times_population(self):
        """§11's explicit prohibition. With 8200 people 12 m above the drainage
        line, the naive product would report ~5 250; the footprint overlay
        reports an order less, because most of the cell is not in the flood."""
        out = self.engine.compute(ExposureInputs(
            cell_id="c", hazard="flood", probability=0.64,
            population=8200, height_above_river_m=12.0, time_of_day_hour=3))
        naive = 8200 * 0.64
        assert out.expected_exposed < naive / 3
        assert out.population_in_footprint < 8200

    def test_terrain_drives_the_footprint(self):
        low = self.engine.compute(ExposureInputs(
            cell_id="c", hazard="flood", probability=0.5,
            population=1000, height_above_river_m=1.0))
        high = self.engine.compute(ExposureInputs(
            cell_id="c", hazard="flood", probability=0.5,
            population=1000, height_above_river_m=40.0))
        assert low.footprint_fraction > high.footprint_fraction * 10

    def test_unknown_population_is_unknown_not_zero(self):
        out = self.engine.compute(ExposureInputs(
            cell_id="c", hazard="flood", probability=0.9, population=None))
        assert out.unknown_population is True
        assert "population_unknown" in out.method
        assert any("unknown" in w for w in out.components["why"])

    def test_whole_cell_hazards_have_no_partial_footprint(self):
        for hazard in ("earthquake", "heatwave", "drought"):
            out = self.engine.compute(ExposureInputs(
                cell_id="c", hazard=hazard, probability=0.5, population=1000))
            assert out.footprint_fraction == 1.0

    def test_night_and_day_differ(self):
        night = self.engine.compute(ExposureInputs(
            cell_id="c", hazard="flood", probability=0.5, population=10_000,
            height_above_river_m=1.0, time_of_day_hour=3))
        day = self.engine.compute(ExposureInputs(
            cell_id="c", hazard="flood", probability=0.5, population=10_000,
            height_above_river_m=1.0, time_of_day_hour=12))
        assert night.population_in_footprint > day.population_in_footprint

    def test_explicit_footprint_overrides_the_terrain_proxy(self):
        out = self.engine.compute(ExposureInputs(
            cell_id="c", hazard="flood", probability=0.5, population=1000,
            height_above_river_m=40.0,
            footprint_fraction=0.9, footprint_source="sentinel-1 inundation"))
        assert out.footprint_fraction == 0.9
        assert "sentinel-1" in out.method

    def test_output_carries_the_caution(self):
        out = self.engine.compute(ExposureInputs(
            cell_id="c", hazard="flood", probability=0.5, population=1000))
        assert "not a headcount" in out.components["caution"]


# ══════════════════════════════════════════════════════════════════════
# Vulnerability (§12)
# ══════════════════════════════════════════════════════════════════════
class TestVulnerability:
    def setup_method(self):
        self.engine = VulnerabilityEngine()

    def test_bounded_zero_to_one(self):
        worst = self.engine.compute(VulnerabilityInputs(
            cell_id="c", travel_time_to_shelter_s=99_999, dist_to_hospital_m=200_000,
            independent_routes_out=0, dist_to_shelter_m=100_000,
            pct_over_60=60, pct_under_5=30, pct_needing_assistance=40,
            slope_deg=50, is_night=True, monsoon_season=True))
        best = self.engine.compute(VulnerabilityInputs(
            cell_id="c", travel_time_to_shelter_s=60, dist_to_hospital_m=500,
            independent_routes_out=6, dist_to_shelter_m=200,
            pct_over_60=5, pct_under_5=5, pct_needing_assistance=0))
        assert 0.0 <= best.score < worst.score <= 1.0

    def test_isolation_dominates(self):
        isolated = self.engine.compute(VulnerabilityInputs(
            cell_id="c", independent_routes_out=1, blocked_routes=1,
            dist_to_shelter_m=5000, dist_to_hospital_m=10_000))
        connected = self.engine.compute(VulnerabilityInputs(
            cell_id="c", independent_routes_out=4, blocked_routes=0,
            dist_to_shelter_m=5000, dist_to_hospital_m=10_000))
        assert isolated.score > connected.score
        assert any("no usable route" in e for e in isolated.explanation)

    def test_missing_inputs_renormalise_rather_than_read_as_safe(self):
        """A cell we know nothing about must not score as low-vulnerability."""
        sparse = self.engine.compute(VulnerabilityInputs(
            cell_id="c", independent_routes_out=0))
        assert sparse.missing_inputs
        assert sparse.score > 0.5
        assert any("no data" in e for e in sparse.explanation)

    def test_every_term_is_itemised(self):
        out = self.engine.compute(VulnerabilityInputs(
            cell_id="c", dist_to_shelter_m=8000, dist_to_hospital_m=25_000,
            independent_routes_out=2, pct_over_60=18, pct_needing_assistance=6,
            travel_time_to_shelter_s=3600))
        for name in ("evacuation_difficulty", "medical_access", "route_redundancy",
                     "shelter_access", "age_structure", "assistance_need"):
            assert name in out.terms
            assert "weight" in out.terms[name]

    def test_demographic_terms_cannot_dominate(self):
        """Demography adjusts a ranking; it must not drive it. The two
        demographic terms carry 0.28 of the weight between them."""
        demo_weight = (VulnerabilityEngine().weights["age_structure"]
                       + VulnerabilityEngine().weights["assistance_need"])
        assert demo_weight < 0.30


# ══════════════════════════════════════════════════════════════════════
# Priority (§13)
# ══════════════════════════════════════════════════════════════════════
class TestPriority:
    def setup_method(self):
        self.engine = PriorityEngine()

    def test_weights_normalise_to_one(self):
        assert sum(self.engine.weights.values()) == pytest.approx(1.0)

    def test_contributions_reconstruct_the_score(self):
        """The guarantee that makes the explanation trustworthy."""
        zone = self.engine.score(PriorityInputs(
            cell_id="c", hazard="flood", risk_score=88, expected_exposed=3200,
            population_in_footprint=4100, vulnerability=0.62,
            travel_time_to_shelter_s=3000, time_to_impact_h=2.0,
            independent_routes_out=1))
        self.engine.verify(zone)          # raises if they diverge
        assert sum(t["contribution"] for t in zone.terms.values()) == \
            pytest.approx(zone.priority_score)

    def test_verify_catches_a_tampered_score(self):
        zone = self.engine.score(PriorityInputs(
            cell_id="c", hazard="flood", risk_score=50, expected_exposed=100,
            population_in_footprint=200, vulnerability=0.3))
        zone.priority_score += 0.25
        with pytest.raises(ValueError, match="does not match the arithmetic"):
            self.engine.verify(zone)

    def test_population_is_log_scaled(self):
        """A cell of 12 000 must not count twelve times a cell of 1 000, or one
        dense ward swamps the entire district ranking."""
        small = self.engine.score(PriorityInputs(
            cell_id="a", hazard="flood", risk_score=70, expected_exposed=1_000,
            population_in_footprint=1_000, vulnerability=0.5))
        large = self.engine.score(PriorityInputs(
            cell_id="b", hazard="flood", risk_score=70, expected_exposed=12_000,
            population_in_footprint=12_000, vulnerability=0.5))
        s = small.terms["population_exposure"]["normalised"]
        l = large.terms["population_exposure"]["normalised"]
        assert l > s
        assert l / max(s, 1e-9) < 3.0

    def test_sooner_impact_ranks_higher(self):
        soon = self.engine.score(PriorityInputs(
            cell_id="a", hazard="flood", risk_score=70, expected_exposed=1000,
            population_in_footprint=1000, vulnerability=0.5, time_to_impact_h=1))
        later = self.engine.score(PriorityInputs(
            cell_id="b", hazard="flood", risk_score=70, expected_exposed=1000,
            population_in_footprint=1000, vulnerability=0.5, time_to_impact_h=30))
        assert soon.priority_score > later.priority_score

    def test_reasons_are_derived_from_the_terms(self):
        zone = self.engine.score(PriorityInputs(
            cell_id="c", hazard="flood", risk_score=95, expected_exposed=6000,
            population_in_footprint=7000, vulnerability=0.8,
            time_to_impact_h=0, independent_routes_out=0))
        assert zone.reasons
        top = max(zone.terms.items(), key=lambda kv: kv[1]["contribution"])
        assert top[1]["note"] in zone.reasons

    def test_low_confidence_is_surfaced_in_the_reasons(self):
        zone = self.engine.score(PriorityInputs(
            cell_id="c", hazard="flood", risk_score=80, expected_exposed=2000,
            population_in_footprint=2500, vulnerability=0.5, confidence=0.4))
        assert any("verify on the ground" in r for r in zone.reasons)

    def test_ranking_is_reproducible(self):
        inputs = [
            PriorityInputs(cell_id=f"c{i}", hazard="flood", risk_score=50 + i,
                           expected_exposed=100 * i, population_in_footprint=120 * i,
                           vulnerability=0.4 + i / 100)
            for i in range(30)
        ]
        first, _ = self.engine.rank(inputs)
        second, _ = self.engine.rank(list(reversed(inputs)))
        assert [z.cell_id for z in first] == [z.cell_id for z in second]

    def test_rank_report_states_the_complexity(self):
        _, report = self.engine.rank([
            PriorityInputs(cell_id=f"c{i}", hazard="flood", risk_score=60,
                           expected_exposed=100, population_in_footprint=100,
                           vulnerability=0.5) for i in range(64)])
        assert "n log n" in report["complexity"]
        assert report["stable"] is True
        assert report["weights_version"]


# ══════════════════════════════════════════════════════════════════════
# Capacity (§17)
# ══════════════════════════════════════════════════════════════════════
class TestCapacity:
    def setup_method(self):
        self.engine = CapacityEngine()
        self.now = datetime.now(UTC)

    def _shelter(self, **kw):
        base = dict(shelter_id="SH-1", name="Test shelter", max_capacity=5000,
                    current_occupancy=4200, reported_at=self.now)
        base.update(kw)
        return ShelterState(**base)

    def test_physical_capacity_is_not_operational_capacity(self):
        """§17's worked example: 5000 rated, 4200 occupied, medical cover for
        400. There are not 800 usable places."""
        result = self.engine.compute(self._shelter(medical_staff_present=2), self.now)
        assert result.raw_available == 800
        assert result.effective_capacity < 800
        assert result.binding_constraint == "medical"

    def test_binding_constraint_is_named(self):
        water = self.engine.compute(self._shelter(
            current_occupancy=1000, water_days_remaining=0.5,
            medical_staff_present=20), self.now)
        assert water.binding_constraint == "water"
        assert any("water" in w for w in water.warnings)

    def test_shelter_inside_the_hazard_is_unusable(self):
        result = self.engine.compute(self._shelter(hazard_risk=88.0), self.now)
        assert result.effective_capacity == 0
        assert not result.operational
        assert "hazard footprint" in result.binding_constraint

    def test_closed_and_compromised_are_unusable(self):
        for state in ("closed", "compromised"):
            result = self.engine.compute(self._shelter(state=state), self.now)
            assert result.effective_capacity == 0
            assert not result.operational

    def test_standby_is_halved_not_zeroed(self):
        active = self.engine.compute(self._shelter(
            current_occupancy=1000, medical_staff_present=20), self.now)
        standby = self.engine.compute(self._shelter(
            current_occupancy=1000, medical_staff_present=20, state="standby"), self.now)
        assert 0 < standby.effective_capacity < active.effective_capacity

    def test_stale_report_reduces_capacity_and_warns(self):
        old = self.now - timedelta(hours=12)
        fresh = self.engine.compute(self._shelter(
            current_occupancy=1000, medical_staff_present=20), self.now)
        stale = self.engine.compute(self._shelter(
            current_occupancy=1000, medical_staff_present=20, reported_at=old), self.now)
        assert stale.effective_capacity < fresh.effective_capacity
        assert any("hours ago" in w for w in stale.warnings)

    def test_no_report_at_all_is_warned(self):
        result = self.engine.compute(self._shelter(reported_at=None), self.now)
        assert any("no operator status report" in w for w in result.warnings)

    def test_shelters_are_not_filled_past_the_safe_utilisation(self):
        result = self.engine.compute(self._shelter(
            current_occupancy=0, medical_staff_present=50,
            water_days_remaining=10, food_days_remaining=10), self.now)
        assert result.effective_capacity <= 5000 * 0.90

    def test_district_summary_reports_the_binding_mix(self):
        shelters = [
            self._shelter(shelter_id="A", current_occupancy=100, medical_staff_present=50,
                          water_days_remaining=10, food_days_remaining=10),
            self._shelter(shelter_id="B", current_occupancy=100, water_days_remaining=0.2,
                          medical_staff_present=50, food_days_remaining=10),
            self._shelter(shelter_id="C", hazard_risk=90),
        ]
        summary = CapacityEngine.district_summary(self.engine.compute_many(shelters, self.now))
        assert summary["shelters_total"] == 3
        assert summary["shelters_usable"] == 2
        assert "water" in summary["binding_constraints"]
        assert len(summary["shelters_unusable"]) == 1
