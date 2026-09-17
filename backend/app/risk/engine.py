"""
Hazard risk engine (§9 output → §11 input).

The engine's job is to turn a model probability into the number an operator
reads off a map, and to be explicit about how much that number should be
trusted. Three things it deliberately does *not* do:

  · It does not present a model probability as a warning. Official warnings are
    joined in from `government_alerts` and rendered with their issuing
    authority; the model's contribution is labelled AI-based risk prediction.
  · It does not let a confident-looking probability hide thin inputs. Confidence
    is computed from input freshness, source coverage and model calibration,
    entirely separately from the probability itself.
  · It does not silently substitute stale data for live. A cell whose newest
    rainfall observation is four hours old is scored on that observation and
    stamped `stale`, and the UI shows the age.

Score construction
──────────────────
    score = 100 · P(hazard | features) · intensity_factor · corroboration

  · `probability` is the calibrated model output.
  · `intensity_factor` scales for how bad it would be if it happened, drawn
    from the hazard's own physics (rain accumulation vs. thresholds, river
    level vs. danger level, slope vs. failure angle). A 0.9 probability of a
    nuisance flood is not a 90.
  · `corroboration` lifts the score when an independent source agrees — an
    official SACHET alert covering the cell, a verified citizen report, a
    satellite inundation footprint. Capped so corroboration can reinforce but
    never manufacture a signal.
"""
from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from app.config import settings

log = logging.getLogger(__name__)

RISK_BANDS: list[tuple[float, str]] = [
    (85.0, "critical"), (60.0, "high"), (30.0, "medium"), (0.0, "low"),
]


def band(score: float) -> str:
    if score < 0:
        return "no_data"
    for threshold, name in RISK_BANDS:
        if score >= threshold:
            return name
    return "low"


@dataclass(slots=True)
class RiskInputs:
    cell_id: str
    hazard: str
    probability: float | None
    model_version: str | None
    features: dict[str, Any] = field(default_factory=dict)
    feature_ages_s: dict[str, float] = field(default_factory=dict)
    sources_present: set[str] = field(default_factory=set)
    sources_expected: set[str] = field(default_factory=set)
    official_alert: dict | None = None
    verified_reports: int = 0
    satellite_confirmation: bool = False
    model_calibration_error: float = 0.0        # Brier / ECE from model_versions


@dataclass(slots=True)
class RiskOutput:
    cell_id: str
    hazard: str
    score: float
    level: str
    probability: float | None
    intensity: float
    confidence: float
    time_to_impact_h: float | None
    degraded_inputs: list[str]
    components: dict[str, Any]
    computed_at: datetime

    def as_row(self) -> dict:
        return {
            "cell_id": self.cell_id, "hazard": self.hazard,
            "score": round(self.score, 2), "level": self.level,
            "probability": None if self.probability is None else round(self.probability, 4),
            "intensity": round(self.intensity, 3), "confidence": round(self.confidence, 3),
            "time_to_impact_h": self.time_to_impact_h,
            "components": self.components,
        }


class RiskEngine:
    def __init__(self, *, stale_penalty: float | None = None):
        self.stale_penalty = (stale_penalty if stale_penalty is not None
                              else settings.stale_confidence_penalty)

    # ── intensity, per hazard ─────────────────────────────────────────
    def intensity(self, hazard: str, f: dict[str, Any]) -> tuple[float, list[str]]:
        """0–1.4 multiplier plus the human-readable reasons behind it."""
        notes: list[str] = []
        v = 1.0
        if hazard == "flood":
            r24 = _f(f.get("rainfall_24h"))
            level_ratio = _ratio(f.get("river_level"), f.get("danger_level"))
            hand = _f(f.get("height_above_river_m"))
            if r24 is not None:
                # IMD's own heavy/very-heavy/extremely-heavy thresholds
                if r24 >= 204.5:
                    v *= 1.35; notes.append(f"extremely heavy rainfall {r24:.0f} mm/24h")
                elif r24 >= 115.6:
                    v *= 1.20; notes.append(f"very heavy rainfall {r24:.0f} mm/24h")
                elif r24 >= 64.5:
                    v *= 1.08; notes.append(f"heavy rainfall {r24:.0f} mm/24h")
            if level_ratio is not None and level_ratio >= 1.0:
                v *= 1.25; notes.append("river at or above danger level")
            elif level_ratio is not None and level_ratio >= 0.95:
                v *= 1.10; notes.append("river approaching danger level")
            if hand is not None and hand <= 5:
                v *= 1.15; notes.append(f"only {hand:.0f} m above nearest drainage")
        elif hazard == "landslide":
            slope = _f(f.get("slope_deg"))
            r72 = _f(f.get("rainfall_72h"))
            sm = _f(f.get("soil_moisture"))
            if slope is not None:
                # 25–45° is the classic failure envelope for Himalayan colluvium
                if 25 <= slope <= 45:
                    v *= 1.25; notes.append(f"slope {slope:.0f}° in the failure envelope")
                elif slope > 45:
                    v *= 1.12; notes.append(f"very steep slope {slope:.0f}°")
            if r72 is not None and r72 >= 150:
                v *= 1.20; notes.append(f"{r72:.0f} mm over 72 h — antecedent saturation")
            if sm is not None and sm >= 0.35:
                v *= 1.12; notes.append("soil near saturation")
        elif hazard == "earthquake":
            pga = _f(f.get("pga_g"))
            if pga is not None:
                if pga >= 0.24:
                    v *= 1.35; notes.append(f"estimated PGA {pga:.2f} g")
                elif pga >= 0.10:
                    v *= 1.15; notes.append(f"estimated PGA {pga:.2f} g")
        elif hazard == "cyclone":
            wind = _f(f.get("wind_speed_ms"))
            if wind is not None and wind >= 33:
                v *= 1.35; notes.append(f"sustained wind {wind:.0f} m/s")
            elif wind is not None and wind >= 24:
                v *= 1.15; notes.append(f"sustained wind {wind:.0f} m/s")
        elif hazard == "heatwave":
            hi = _f(f.get("heat_index_c"))
            if hi is not None and hi >= 45:
                v *= 1.30; notes.append(f"heat index {hi:.0f} °C")
        return min(v, 1.4), notes

    # ── confidence ────────────────────────────────────────────────────
    def confidence(self, inp: RiskInputs) -> tuple[float, list[str]]:
        """Confidence is about the *inputs*, never about the probability.

        A model that is 97 % sure on four-hour-old rainfall from one of three
        expected sources is not a confident prediction, and saying so is the
        whole point of separating these two numbers.
        """
        degraded: list[str] = []
        c = 1.0

        expected = inp.sources_expected or set()
        missing = expected - inp.sources_present
        if expected:
            coverage = len(inp.sources_present & expected) / len(expected)
            c *= 0.4 + 0.6 * coverage
            degraded.extend(sorted(missing))

        if inp.feature_ages_s:
            worst_age = max(inp.feature_ages_s.values())
            if worst_age > 21_600:            # > 6 h
                c *= self.stale_penalty
                degraded.append("stale_inputs")
            elif worst_age > 7_200:           # > 2 h
                c *= 0.80
            elif worst_age > 3_600:
                c *= 0.92

        missing_features = [k for k, v in inp.features.items() if v is None]
        if inp.features:
            c *= 1.0 - 0.5 * (len(missing_features) / len(inp.features))

        # a poorly calibrated model should not be allowed to sound sure
        c *= max(0.3, 1.0 - min(inp.model_calibration_error, 0.5))

        if inp.official_alert:
            c = min(1.0, c * 1.15)
        if inp.satellite_confirmation:
            c = min(1.0, c * 1.10)

        return round(max(0.05, min(1.0, c)), 3), degraded

    # ── corroboration ─────────────────────────────────────────────────
    @staticmethod
    def corroboration(inp: RiskInputs) -> tuple[float, list[str]]:
        m, notes = 1.0, []
        if inp.official_alert:
            sev = (inp.official_alert.get("severity") or "").lower()
            bump = {"extreme": 1.30, "severe": 1.20, "moderate": 1.10}.get(sev, 1.05)
            m *= bump
            notes.append(f"official {sev or 'alert'} in force from "
                         f"{inp.official_alert.get('issuing_authority', 'the issuing authority')}")
        if inp.satellite_confirmation:
            m *= 1.12; notes.append("satellite observation consistent with the hazard")
        if inp.verified_reports >= 3:
            m *= 1.12; notes.append(f"{inp.verified_reports} verified field reports")
        elif inp.verified_reports > 0:
            m *= 1.05; notes.append(f"{inp.verified_reports} verified field report(s)")
        return min(m, 1.4), notes

    # ── time to impact ────────────────────────────────────────────────
    @staticmethod
    def time_to_impact(hazard: str, f: dict) -> float | None:
        if hazard == "flood":
            rate = _f(f.get("river_level_rate_1h"))
            level, danger = _f(f.get("river_level")), _f(f.get("danger_level"))
            if rate and rate > 0.01 and level is not None and danger is not None:
                if level >= danger:
                    return 0.0
                return round((danger - level) / rate, 2)
            r6 = _f(f.get("rainfall_6h"))
            if r6 and r6 > 60:
                return 6.0
        if hazard == "landslide":
            r24 = _f(f.get("rainfall_24h"))
            if r24 and r24 > 100:
                return 12.0
        if hazard == "cyclone":
            return _f(f.get("hours_to_landfall"))
        return None

    # ── the computation ───────────────────────────────────────────────
    def compute(self, inp: RiskInputs) -> RiskOutput:
        now = datetime.now(UTC)

        if inp.probability is None:
            conf, degraded = self.confidence(inp)
            return RiskOutput(
                cell_id=inp.cell_id, hazard=inp.hazard, score=-1.0, level="no_data",
                probability=None, intensity=1.0, confidence=conf, time_to_impact_h=None,
                degraded_inputs=degraded + ["no_model_output"],
                components={"reason": "model produced no output for this cell"},
                computed_at=now,
            )

        intensity, intensity_notes = self.intensity(inp.hazard, inp.features)
        corrob, corrob_notes = self.corroboration(inp)
        conf, degraded = self.confidence(inp)

        raw = 100.0 * inp.probability * intensity * corrob
        score = max(0.0, min(100.0, raw))

        return RiskOutput(
            cell_id=inp.cell_id, hazard=inp.hazard,
            score=score, level=band(score),
            probability=inp.probability, intensity=intensity, confidence=conf,
            time_to_impact_h=self.time_to_impact(inp.hazard, inp.features),
            degraded_inputs=degraded,
            components={
                "probability": round(inp.probability, 4),
                "intensity_factor": round(intensity, 3),
                "corroboration_factor": round(corrob, 3),
                "model_version": inp.model_version,
                "why": intensity_notes + corrob_notes,
                "official_alert": bool(inp.official_alert),
                "attribution": (
                    "AI-based risk prediction and decision support. "
                    "Not an official warning."
                ),
            },
            computed_at=now,
        )

    def compute_many(self, inputs: Sequence[RiskInputs]) -> list[RiskOutput]:
        return [self.compute(i) for i in inputs]


# ── helpers ───────────────────────────────────────────────────────────
def _f(v) -> float | None:
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def _ratio(a, b) -> float | None:
    a, b = _f(a), _f(b)
    if a is None or b is None or b == 0:
        return None
    return a / b


def age_seconds(observed_at: datetime | None, now: datetime | None = None) -> float:
    if observed_at is None:
        return float("inf")
    now = now or datetime.now(UTC)
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=UTC)
    return max((now - observed_at).total_seconds(), 0.0)


def is_stale(observed_at: datetime | None, threshold_s: int) -> bool:
    return age_seconds(observed_at) > threshold_s


STALE_WINDOW = timedelta(hours=6)
