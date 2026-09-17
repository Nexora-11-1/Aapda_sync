"""
Carrying capacity engine (§17).

The premise: **physical capacity is not safe operational capacity.** A hall
rated for 5 000 with 4 200 already inside, water for 400 people and one nurse
does not have 800 usable places. It has whatever the binding constraint says it
has, and knowing which constraint binds is the operationally useful part.

    effective_capacity = min(
        space_available,
        water_constrained,
        food_constrained,
        sanitation_constrained,
        medical_constrained,
        staffing_constrained,
    ) × operational_factor

Planning standards used (Sphere / NDMA relief-camp guidance):
    floor space        3.5 m² per person
    water              15 litres per person per day
    sanitation         1 latrine per 20 people
    medical            1 trained responder per 250 people
Each is named in the output, so an operator can see *which* one is binding and
therefore what to send.

The engine recomputes on every shelter status update (§19) and on every risk
tick, because a shelter that has just come inside a hazard footprint has an
effective capacity of zero regardless of how much floor it has.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

SQ_M_PER_PERSON = 3.5
WATER_LPD_PER_PERSON = 15.0
PEOPLE_PER_LATRINE = 20
PEOPLE_PER_MEDIC = 250
# Below this we do not fill a shelter to its theoretical limit: crowding to
# 100 % makes a camp unmanageable and unsafe.
SAFE_UTILISATION = 0.90
STALE_REPORT_HOURS = 6


@dataclass(slots=True)
class ShelterState:
    shelter_id: str
    name: str
    max_capacity: int
    current_occupancy: int = 0
    state: str = "open"                      # open|full|closed|standby|compromised
    floor_area_m2: float | None = None
    water_capacity_lpd: float | None = None
    water_days_remaining: float | None = None
    food_capacity_meals: int | None = None
    food_days_remaining: float | None = None
    latrines: int | None = None
    medical_staff_present: int | None = None
    staff_present: int | None = None
    has_power_backup: bool = False
    hazard_risk: float = 0.0                 # risk score of the shelter's own cell
    reported_at: datetime | None = None
    incoming_assigned: int = 0               # already routed here this tick


@dataclass(slots=True)
class CapacityResult:
    shelter_id: str
    name: str
    effective_capacity: int
    raw_available: int
    binding_constraint: str
    operational: bool
    utilisation: float
    constraints: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    report_age_hours: float | None = None
    computed_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def as_dict(self) -> dict:
        return {
            "shelter_id": self.shelter_id, "name": self.name,
            "effective_capacity": self.effective_capacity,
            "raw_available": self.raw_available,
            "binding_constraint": self.binding_constraint,
            "operational": self.operational,
            "utilisation": round(self.utilisation, 3),
            "constraints": self.constraints,
            "warnings": self.warnings,
            "report_age_hours": (None if self.report_age_hours is None
                                 else round(self.report_age_hours, 1)),
        }


class CapacityEngine:
    def __init__(self, *, safe_utilisation: float = SAFE_UTILISATION,
                 unsafe_risk_threshold: float = 60.0):
        self.safe_utilisation = safe_utilisation
        self.unsafe_risk_threshold = unsafe_risk_threshold

    def compute(self, s: ShelterState, now: datetime | None = None) -> CapacityResult:
        now = now or datetime.now(UTC)
        warnings: list[str] = []
        constraints: dict[str, Any] = {}

        # ── report freshness ──────────────────────────────────────────
        age_h: float | None = None
        if s.reported_at is not None:
            reported = s.reported_at if s.reported_at.tzinfo else s.reported_at.replace(tzinfo=UTC)
            age_h = (now - reported).total_seconds() / 3600.0
            if age_h > STALE_REPORT_HOURS:
                warnings.append(
                    f"last operator update was {age_h:.0f} hours ago — occupancy may be wrong")
        else:
            warnings.append("no operator status report on record")

        # ── hard operational gates ────────────────────────────────────
        if s.state in ("closed", "compromised"):
            return CapacityResult(
                s.shelter_id, s.name, 0, 0, f"shelter is {s.state}", False,
                utilisation=1.0, constraints={}, warnings=warnings + [
                    f"shelter reported as {s.state}"], report_age_hours=age_h)

        if s.hazard_risk >= self.unsafe_risk_threshold:
            return CapacityResult(
                s.shelter_id, s.name, 0, 0, "inside hazard footprint", False,
                utilisation=1.0, constraints={"hazard_risk": s.hazard_risk},
                warnings=warnings + [
                    f"shelter sits in a cell scoring {s.hazard_risk:.0f}/100 — "
                    "not usable while that stands"], report_age_hours=age_h)

        committed = s.current_occupancy + s.incoming_assigned

        # ── each constraint, in people ────────────────────────────────
        # space
        floor_capacity = (int(s.floor_area_m2 / SQ_M_PER_PERSON)
                          if s.floor_area_m2 else s.max_capacity)
        space_total = min(s.max_capacity, floor_capacity)
        space_available = max(int(space_total * self.safe_utilisation) - committed, 0)
        constraints["space"] = {
            "available": space_available, "total": space_total,
            "standard": f"{SQ_M_PER_PERSON} m² per person, filled to "
                        f"{self.safe_utilisation:.0%}",
        }

        # water — the constraint that actually closes camps
        if s.water_capacity_lpd is not None:
            water_supports = int(s.water_capacity_lpd / WATER_LPD_PER_PERSON)
            water_available = max(water_supports - committed, 0)
        elif s.water_days_remaining is not None:
            # supply is expressed in days for the current headcount; below two
            # days we stop adding people rather than deepening the problem
            water_available = (space_available if s.water_days_remaining >= 2.0
                               else int(space_available * max(s.water_days_remaining / 2.0, 0.0)))
            water_supports = None
        else:
            water_available, water_supports = space_available, None
            warnings.append("water capacity not reported — assumed adequate")
        constraints["water"] = {
            "available": water_available, "supports_people": water_supports,
            "days_remaining": s.water_days_remaining,
            "standard": f"{WATER_LPD_PER_PERSON:g} litres per person per day",
        }

        # food
        if s.food_days_remaining is not None:
            food_available = (space_available if s.food_days_remaining >= 2.0
                              else int(space_available * max(s.food_days_remaining / 2.0, 0.0)))
        elif s.food_capacity_meals is not None:
            food_available = max(int(s.food_capacity_meals / 3) - committed, 0)  # 3 meals/day
        else:
            food_available = space_available
            warnings.append("food stock not reported — assumed adequate")
        constraints["food"] = {"available": food_available,
                               "days_remaining": s.food_days_remaining}

        # sanitation
        if s.latrines is not None:
            san_available = max(s.latrines * PEOPLE_PER_LATRINE - committed, 0)
        else:
            san_available = space_available
        constraints["sanitation"] = {
            "available": san_available, "latrines": s.latrines,
            "standard": f"1 latrine per {PEOPLE_PER_LATRINE} people",
        }

        # medical
        if s.medical_staff_present is not None:
            med_supports = s.medical_staff_present * PEOPLE_PER_MEDIC
            med_available = max(med_supports - committed, 0)
            if s.medical_staff_present == 0:
                warnings.append("no medical staff present")
        else:
            med_available = space_available
        constraints["medical"] = {
            "available": med_available, "staff_present": s.medical_staff_present,
            "standard": f"1 trained responder per {PEOPLE_PER_MEDIC} people",
        }

        # ── bind ──────────────────────────────────────────────────────
        candidates = {
            "space": space_available, "water": water_available, "food": food_available,
            "sanitation": san_available, "medical": med_available,
        }
        binding, effective = min(candidates.items(), key=lambda kv: kv[1])

        # operational factor — a degraded shelter is not a closed one, but it
        # should not be filled as if nothing were wrong
        factor = 1.0
        if s.state == "standby":
            factor *= 0.5
            warnings.append("shelter is on standby, not yet activated")
        if not s.has_power_backup:
            factor *= 0.95
        if age_h is not None and age_h > STALE_REPORT_HOURS:
            factor *= 0.8      # be conservative with numbers we cannot trust
        effective = int(effective * factor)

        raw_available = max(s.max_capacity - s.current_occupancy, 0)
        if effective < raw_available:
            warnings.append(
                f"{binding} limits this shelter to {effective} places, "
                f"though {raw_available} are physically free")

        utilisation = (committed / s.max_capacity) if s.max_capacity else 1.0
        if utilisation >= 0.95:
            warnings.append("shelter is effectively full")

        return CapacityResult(
            shelter_id=s.shelter_id, name=s.name,
            effective_capacity=max(effective, 0), raw_available=raw_available,
            binding_constraint=binding, operational=effective > 0,
            utilisation=utilisation, constraints=constraints, warnings=warnings,
            report_age_hours=age_h,
        )

    def compute_many(self, shelters, now: datetime | None = None) -> list[CapacityResult]:
        now = now or datetime.now(UTC)
        return [self.compute(s, now) for s in shelters]

    @staticmethod
    def district_summary(results: list[CapacityResult]) -> dict:
        usable = [r for r in results if r.operational]
        binding_counts: dict[str, int] = {}
        for r in usable:
            binding_counts[r.binding_constraint] = binding_counts.get(r.binding_constraint, 0) + 1
        return {
            "shelters_total": len(results),
            "shelters_usable": len(usable),
            "effective_places": sum(r.effective_capacity for r in usable),
            "physical_places": sum(r.raw_available for r in results),
            "binding_constraints": binding_counts,
            "shelters_unusable": [
                {"shelter_id": r.shelter_id, "name": r.name, "reason": r.binding_constraint}
                for r in results if not r.operational
            ],
        }


STALE_WINDOW = timedelta(hours=STALE_REPORT_HOURS)
