"""
Missing data must never read as good news.

This is the rule the audit found broken in two places at once, and it is worth
its own file because the failure mode is silent by construction: a cell nobody
could measure scored 0.0 for vulnerability, which on a 0–1 "harder to protect"
scale is the assertion that it is the *easiest* place in the district. It then
flowed into the priority ranking as a real term with real weight, quietly
pushing unmeasured places down the list — which is precisely the population an
evacuation is most likely to strand.

Every test here is a statement about the difference between

    "we measured this and it is low"      and      "we did not measure this"

and about that difference surviving all the way through the arithmetic.
"""
from __future__ import annotations

import pytest

from app.priority.engine import PriorityEngine, PriorityInputs
from app.vulnerability.engine import VulnerabilityEngine, VulnerabilityInputs


@pytest.fixture
def vuln() -> VulnerabilityEngine:
    return VulnerabilityEngine()


@pytest.fixture
def pri() -> PriorityEngine:
    return PriorityEngine()


# ══════════════════════════════════════════════════════════════════════
# Vulnerability
# ══════════════════════════════════════════════════════════════════════
def test_no_input_at_all_yields_no_score_not_zero(vuln):
    """The exact case the orchestrator was producing for every cell."""
    out = vuln.compute(VulnerabilityInputs(cell_id="871f1d4ffffffff"))
    assert out.score is None, (
        "a cell with no measurable input must have no vulnerability score; "
        f"got {out.score!r}, which asserts it is the easiest place to protect"
    )
    assert len(out.missing_inputs) == 6
    assert any("not a low score" in line for line in out.explanation)


def test_no_score_is_distinguishable_from_a_genuine_low_score(vuln):
    easy = vuln.compute(VulnerabilityInputs(
        cell_id="a", dist_to_shelter_m=120.0, travel_time_to_shelter_s=90.0,
        dist_to_hospital_m=400.0, independent_routes_out=3,
        road_density_m_per_km2=9000.0, slope_deg=2.0, population_density=300.0,
        pct_over_60=0.05, pct_under_5=0.04, pct_needing_assistance=0.01,
    ))
    unknown = vuln.compute(VulnerabilityInputs(cell_id="b"))
    assert easy.score is not None and easy.score >= 0.0
    assert unknown.score is None
    assert easy.score != unknown.score


def test_one_available_term_is_enough_to_publish_a_score(vuln):
    """Partial data is still data. It is normalised over what is there."""
    out = vuln.compute(VulnerabilityInputs(cell_id="c", independent_routes_out=0))
    assert out.score is not None
    assert out.score > 0.5, "no route out is the worst case for route redundancy"
    assert "route_redundancy" not in out.missing_inputs
    assert len(out.missing_inputs) == 5
    assert any("normalised over" in line for line in out.explanation)


def test_a_cut_off_cell_scores_high_even_with_most_inputs_missing(vuln):
    """The whole point of renormalising: one bad measured term still lands."""
    out = vuln.compute(VulnerabilityInputs(
        cell_id="d", independent_routes_out=1, blocked_routes=1))
    assert out.score is not None and out.score >= 0.7


def test_as_row_carries_none_through_rather_than_coercing(vuln):
    row = vuln.compute(VulnerabilityInputs(cell_id="e")).as_row()
    assert row["score"] is None, "the database row must carry NULL, not 0.0"


# ══════════════════════════════════════════════════════════════════════
# Priority
# ══════════════════════════════════════════════════════════════════════
def _inputs(**kw) -> PriorityInputs:
    base = dict(cell_id="z", hazard="flood", risk_score=80.0,
                expected_exposed=2000.0, population_in_footprint=3000,
                time_to_impact_h=4.0, confidence=0.9)
    base.update(kw)
    return PriorityInputs(**base)


def test_unmeasured_vulnerability_does_not_count_as_zero(pri):
    """Two identical cells, one measured at zero and one not measured.

    The unmeasured one must not be ranked below the measured-safe one, because
    nothing has established that it is safe.
    """
    measured_safe = pri.score(_inputs(vulnerability=0.0))
    unmeasured = pri.score(_inputs(vulnerability=None))
    assert unmeasured.priority_score > measured_safe.priority_score, (
        "an unmeasured cell was ranked no higher than one measured as easy to "
        "protect — missing data is being read as good news"
    )


def test_dropped_term_shows_as_dropped_not_as_zero_value(pri):
    z = pri.score(_inputs(vulnerability=None))
    term = z.terms["vulnerability"]
    assert term["normalised"] is None
    assert term["weight"] == 0.0
    assert "no input" in term["note"]


def test_weights_renormalise_so_the_audit_still_reconstructs(pri):
    """`verify()` is the guarantee that the explanation matches the number.

    Renormalisation must not break it — the displayed weights are the ones
    that were actually used.
    """
    for kw in ({"vulnerability": None},
               {"vulnerability": None, "independent_routes_out": None},
               {"vulnerability": 0.4},
               {}):
        z = pri.score(_inputs(**kw))
        pri.verify(z)                       # raises if the arithmetic diverges
        live = [t for t in z.terms.values() if t["normalised"] is not None]
        assert abs(sum(t["weight"] for t in live) - 1.0) < 1e-6, (
            "the weights actually used must sum to 1, or the score is on a "
            "different scale from every other cell and cannot be compared"
        )


def test_scores_stay_comparable_across_cells_with_different_coverage(pri):
    """A cell missing a term must not be scored on a smaller scale.

    If it were, a well-measured dangerous cell and a poorly-measured dangerous
    cell would sort by data coverage rather than by danger.
    """
    full = pri.score(_inputs(vulnerability=0.9, independent_routes_out=0))
    partial = pri.score(_inputs(vulnerability=None, independent_routes_out=0))
    assert 0.0 <= partial.priority_score <= 1.0
    assert abs(full.priority_score - partial.priority_score) < 0.25, (
        "dropping one term moved the score more than the term itself could "
        "justify — the scale is not being preserved"
    )


def test_the_ranking_says_out_loud_that_it_is_weaker_evidence(pri):
    z = pri.score(_inputs(vulnerability=None, independent_routes_out=None,
                          travel_time_to_shelter_s=None))
    assert any("no input" in r or "weaker evidence" in r for r in z.reasons), (
        "an operator reading this ranking is not told how much of it rests on "
        "nothing"
    )


def test_a_fully_measured_cell_reports_no_missing_factors(pri):
    z = pri.score(_inputs(vulnerability=0.6, travel_time_to_shelter_s=1800.0,
                          independent_routes_out=2))
    assert not any("no input" in r for r in z.reasons)
    pri.verify(z)
