"""
Relocation priority engine (§13).

    Priority = w₁·hazard_risk + w₂·population_exposure + w₃·vulnerability
             + w₄·evacuation_difficulty + w₅·time_to_hazard + w₆·accessibility

Four commitments this module makes, all of them checkable in the output:

  1. **Every feature is normalised to [0, 1] before weighting.** Mixing a
     0–100 risk score with a raw headcount of 8 200 would let population
     silently dominate everything else.
  2. **Weights are configuration, versioned in the database.** They are not
     constants in this file. `weights_version` is written onto every priority
     row, so a ranking from last Tuesday can be re-derived exactly.
  3. **No hidden prioritisation.** `terms` carries raw value, normalised value,
     weight and contribution for every factor, and they sum to the score. If
     they do not sum, `verify()` raises rather than shipping a number nobody
     can reconstruct.
  4. **The reason is generated from the terms, not written by hand.** The
     sentences an operator reads are derived from whichever terms actually
     dominated, so the explanation cannot drift away from the arithmetic.

The final ordering goes through `app.priority.mergesort` (§15).
"""
from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from app.priority.mergesort import priority_key, sort_with_trace

# Default weight set, registered as version "v1". Changing these means
# registering a new version, not editing this dict in place.
WEIGHTS_V1: dict[str, float] = {
    "hazard_risk": 0.30,
    "population_exposure": 0.22,
    "vulnerability": 0.18,
    "evacuation_difficulty": 0.12,
    "time_to_hazard": 0.13,
    "accessibility": 0.05,
}

BANDS: list[tuple[float, str]] = [(0.75, "critical"), (0.55, "high"),
                                  (0.32, "medium"), (0.0, "low")]


@dataclass(slots=True)
class PriorityInputs:
    cell_id: str
    hazard: str
    name: str | None = None
    risk_score: float = 0.0                    # 0–100 from the risk engine
    expected_exposed: float = 0.0              # people, from the exposure engine
    population_in_footprint: int = 0
    # 0–1. None means the vulnerability engine had no input for this cell —
    # the term is dropped and the weights renormalise, rather than the cell
    # being ranked as though it were the easiest place in the district.
    vulnerability: float | None = None
    travel_time_to_shelter_s: float | None = None
    time_to_impact_h: float | None = None
    independent_routes_out: int | None = None
    blocked_routes: int = 0
    road_density_m_per_km2: float | None = None
    confidence: float = 1.0


@dataclass(slots=True)
class PriorityZone:
    cell_id: str
    hazard: str
    name: str | None
    priority_score: float
    band: str
    expected_exposed: float
    time_to_impact_h: float | None
    confidence: float
    terms: dict[str, dict[str, Any]] = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)
    rank: int = 0
    people_to_move: int = 0

    def as_row(self, weights_version: str) -> dict:
        return {
            "cell_id": self.cell_id, "hazard": self.hazard, "rank": self.rank,
            "priority_score": round(self.priority_score, 4), "band": self.band,
            "weights_version": weights_version, "terms": self.terms,
            "reasons": self.reasons, "people_to_move": self.people_to_move,
        }


class PriorityEngine:
    def __init__(self, weights: dict[str, float] | None = None, version: str = "v1",
                 *, exposure_reference: int = 5000):
        self.weights = dict(weights or WEIGHTS_V1)
        self.version = version
        # Population normalisation reference. Log-scaled against this so a cell
        # of 12 000 does not count 12× a cell of 1 000 — the marginal urgency of
        # one more exposed person falls as the number grows, and a linear scale
        # would let one dense ward swamp an entire district's ranking.
        self.exposure_reference = exposure_reference

        total = sum(self.weights.values())
        if abs(total - 1.0) > 1e-9:
            self.weights = {k: v / total for k, v in self.weights.items()}

    # ── normalisation, each returning (normalised, raw, note) ─────────
    def _n_hazard(self, i: PriorityInputs):
        v = max(0.0, min(1.0, i.risk_score / 100.0))
        return v, i.risk_score, f"predicted hazard risk {i.risk_score:.0f}/100"

    def _n_exposure(self, i: PriorityInputs):
        people = max(i.expected_exposed, 0.0)
        v = math.log1p(people) / math.log1p(self.exposure_reference)
        return (min(v, 1.0), people,
                f"about {people:,.0f} people expected to be exposed")

    def _n_vulnerability(self, i: PriorityInputs):
        if i.vulnerability is None:
            return None, None, None
        v = max(0.0, min(1.0, i.vulnerability))
        return v, i.vulnerability, f"vulnerability index {v:.2f}"

    def _n_evac_difficulty(self, i: PriorityInputs):
        t = i.travel_time_to_shelter_s
        if t is None:
            return 0.5, None, "evacuation time unknown — neutral value used"
        minutes = t / 60.0
        v = min(minutes / 90.0, 1.0)
        return v, minutes, f"nearest shelter about {minutes:.0f} minutes away"

    def _n_time_to_hazard(self, i: PriorityInputs):
        """Sooner is more urgent, so this is inverted.

        24 h out scores near zero; already impacting scores 1. Uses a decay
        rather than a cliff so a zone does not jump the queue the moment it
        crosses an arbitrary hour boundary.
        """
        h = i.time_to_impact_h
        if h is None:
            return 0.4, None, "time to impact not estimated"
        if h <= 0:
            return 1.0, 0.0, "hazard conditions are already present"
        v = math.exp(-h / 8.0)
        return (min(v, 1.0), h,
                f"estimated {h:.1f} hours before conditions reach this area")

    def _n_accessibility(self, i: PriorityInputs):
        """Low accessibility raises priority — cut-off places need moving first."""
        routes = i.independent_routes_out
        if routes is None:
            return 0.5, None, "route redundancy unknown"
        effective = max(routes - i.blocked_routes, 0)
        v = {0: 1.0, 1: 0.8, 2: 0.45}.get(effective, 0.2)
        if effective == 0:
            note = "no usable route out on the current road state"
        elif effective == 1:
            note = "only one route out — a single blockage isolates this area"
        else:
            note = f"{effective} independent routes out"
        return v, effective, note

    # ── score ─────────────────────────────────────────────────────────
    def score(self, i: PriorityInputs) -> PriorityZone:
        computed = {
            "hazard_risk": self._n_hazard(i),
            "population_exposure": self._n_exposure(i),
            "vulnerability": self._n_vulnerability(i),
            "evacuation_difficulty": self._n_evac_difficulty(i),
            "time_to_hazard": self._n_time_to_hazard(i),
            "accessibility": self._n_accessibility(i),
        }

        # The displayed contribution *is* the audit trail, so the score is the
        # sum of exactly the numbers shown — round first, then total. Summing
        # full precision and displaying rounded parts produces a score the
        # explanation cannot reconstruct, which defeats the point of §13.4.
        # A term with no input is dropped and the remaining weights are
        # renormalised over what is actually there. The alternative — scoring a
        # missing input as zero — ranks an unmeasured cell as the safest place
        # in the district, which is exactly backwards.
        #
        # The renormalised weight is what gets displayed, so `verify()` below
        # still reconstructs the score from the numbers on the screen.
        available = sum(self.weights[n] for n, (norm, _, _) in computed.items() if norm is not None)
        scale = (1.0 / available) if available > 0 else 0.0

        # Rounding each renormalised weight independently leaves a residue, so
        # the weights ON SCREEN would sum to 1.000001 rather than 1. An operator
        # checking the arithmetic by hand should find it closes exactly, so the
        # residue is given to the largest live term rather than left scattered.
        live = [n for n, (norm, _, _) in computed.items() if norm is not None]
        w_by_name = {n: round(self.weights[n] * scale, 6) for n in live}
        if live:
            residue = round(1.0 - sum(w_by_name.values()), 6)
            heaviest = max(live, key=lambda n: w_by_name[n])
            w_by_name[heaviest] = round(w_by_name[heaviest] + residue, 6)

        terms: dict[str, dict[str, Any]] = {}
        total = 0.0
        unmeasured: list[str] = []
        for name, (norm, raw, note) in computed.items():
            if norm is None:
                unmeasured.append(name)
                terms[name] = {"raw": None, "normalised": None, "weight": 0.0,
                               "contribution": 0.0, "note": f"{name.replace('_', ' ')}: no input"}
                continue
            w = w_by_name[name]
            contribution = round(norm * w, 6)
            total += contribution
            terms[name] = {"raw": raw, "normalised": round(norm, 4), "weight": w,
                           "contribution": contribution, "note": note}

        band_name = next(n for t, n in BANDS if total >= t)

        # Reasons are the terms that actually carried the score: anything
        # contributing at least 15 % of the total, largest first.
        ranked = sorted(terms.items(), key=lambda kv: kv[1]["contribution"], reverse=True)
        reasons = [kv[1]["note"] for kv in ranked
                   if kv[1]["contribution"] >= 0.15 * max(total, 1e-9)][:4]
        if unmeasured:
            reasons.append(
                f"{len(unmeasured)} of {len(computed)} ranking factors had no input "
                f"({', '.join(u.replace('_', ' ') for u in unmeasured)}); the score is "
                "normalised over the rest and is weaker evidence than it looks")
        if i.confidence < 0.6:
            reasons.append(f"input confidence is only {i.confidence:.0%} — verify on the ground "
                           "before acting on this ranking")

        return PriorityZone(
            cell_id=i.cell_id, hazard=i.hazard, name=i.name,
            priority_score=round(total, 6), band=band_name,
            expected_exposed=i.expected_exposed, time_to_impact_h=i.time_to_impact_h,
            confidence=i.confidence, terms=terms, reasons=reasons,
            people_to_move=int(round(i.population_in_footprint)),
        )

    # ── rank (merge sort, §15) ────────────────────────────────────────
    def rank(self, inputs: Sequence[PriorityInputs]) -> tuple[list[PriorityZone], dict]:
        zones = [self.score(i) for i in inputs]
        ordered, report = sort_with_trace(zones, key=priority_key,
                                          label=lambda z: f"{z.cell_id}:{z.priority_score:.3f}")
        for n, z in enumerate(ordered, start=1):
            z.rank = n
        return ordered, {
            **report.summary(),
            "weights_version": self.version,
            "weights": self.weights,
            "computed_at": datetime.now(UTC).isoformat(),
        }

    # ── auditability ──────────────────────────────────────────────────
    @staticmethod
    def verify(zone: PriorityZone, tolerance: float = 1e-6) -> None:
        """The contributions must reconstruct the score exactly.

        This is not a paranoid assertion — it is the guarantee that makes the
        explanation trustworthy. If it ever fails, the number on the screen and
        the reasons under it have diverged, and the right response is to stop,
        not to display it.
        """
        summed = sum(t["contribution"] for t in zone.terms.values())
        if abs(summed - zone.priority_score) > tolerance:
            raise ValueError(
                f"{zone.cell_id}: contributions sum to {summed:.6f} but priority_score is "
                f"{zone.priority_score:.6f}. The explanation does not match the arithmetic."
            )
