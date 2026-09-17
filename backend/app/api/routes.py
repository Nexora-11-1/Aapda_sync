"""
HTTP surface (§24).

Every response that carries model output also carries `attribution` and
`confidence`. Every response built from data that might be stale carries
`data_freshness`. Those are not decoration — they are what stops a dashboard
from presenting a four-hour-old reading as the current state of a river.
"""
from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text

from app.config import settings
from app.core.hardening import clean_text, verify_push_signature
from app.core.security import (
    CurrentOperator,
    Operator,
    Session,
    audit,
    authenticate,
    issue_token,
    require,
)
from app.core.lockout import LOGIN_GUARD, STEP_UP, STEP_UP_TTL_SECONDS
from app.assistant.corpus import build_index
from app.assistant.retrieval import REFUSAL_NO_RECORD, REFUSAL_PERSONAL, caveat_for
from app.realtime import Trigger, trigger
from app.ws.hub import hub

log = logging.getLogger(__name__)
router = APIRouter()

ATTRIBUTION = ("AI-based risk prediction and decision support. Not an official warning. "
               "Official warnings are issued by the authorities named on each alert.")


# ══════════════════════════════════════════════════════════════════════
# Models
# ══════════════════════════════════════════════════════════════════════
class LoginRequest(BaseModel):
    operator_id: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    operator: dict


class ShelterStatusUpdate(BaseModel):
    current_occupancy: int = Field(ge=0)
    state: Literal["open", "full", "closed", "standby", "compromised"] = "open"
    water_days_remaining: float | None = Field(default=None, ge=0, le=365)
    food_days_remaining: float | None = Field(default=None, ge=0, le=365)
    medical_staff_present: int | None = Field(default=None, ge=0)
    beds_available: int | None = Field(default=None, ge=0)
    special_resources: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = Field(default=None, max_length=1000)


class RoadStatusReport(BaseModel):
    state: Literal["open", "slow", "partially_blocked", "blocked",
                   "flooded", "landslide", "unknown"]
    reason: str | None = Field(default=None, max_length=500)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    expires_in_hours: float | None = Field(default=None, gt=0, le=720)
    confidence: float = Field(default=0.85, ge=0, le=1)


class CitizenReport(BaseModel):
    category: str = Field(max_length=120)
    description: str = Field(max_length=2000)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    hazard: str | None = None
    contact: str | None = Field(default=None, max_length=120)

    @field_validator("hazard")
    @classmethod
    def _known_hazard(cls, v):
        allowed = {"flood", "landslide", "earthquake", "cyclone", "wildfire",
                   "heatwave", "drought", "lightning", "tsunami", "other", None}
        if v not in allowed:
            raise ValueError(f"hazard must be one of {sorted(x for x in allowed if x)}")
        return v


# ══════════════════════════════════════════════════════════════════════
# Auth
# ══════════════════════════════════════════════════════════════════════
@router.post("/auth/login", response_model=TokenResponse, tags=["auth"])
async def login(body: LoginRequest, session: Session, request: Request):
    """Authenticate an operator.

    Throttled on two axes (see core/lockout). The failure response is
    deliberately identical for a wrong password and a username that does
    not exist — anything else turns this endpoint into a directory of who
    holds an account.
    """
    addr = request.client.host if request.client else "unknown"

    if LOGIN_GUARD.address_blocked(addr):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many sign-in attempts from this address. Try again shortly.")

    locked = LOGIN_GUARD.account_locked_for(body.operator_id)
    if locked:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"This account is temporarily locked. Try again in {locked} seconds.",
            headers={"Retry-After": str(locked)})

    op = await authenticate(session, body.operator_id, body.password)
    if op is None:
        LOGIN_GUARD.record_failure(body.operator_id, addr)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid operator ID or password")

    LOGIN_GUARD.record_success(body.operator_id)
    STEP_UP.confirm(op.operator_id)          # signing in is itself a confirmation
    token, expires = issue_token(op)
    await audit(session, op, "login", request=request)
    return TokenResponse(access_token=token, expires_at=expires,
                         operator=op.model_dump(mode="json"))


@router.post("/auth/step-up", tags=["auth"])
async def step_up(body: LoginRequest, session: Session, request: Request,
                  op: CurrentOperator):
    """Re-confirm the operator at the keyboard before a privileged write.

    The password must belong to the *session's* operator. Confirming with
    someone else's credential would let two people combine a session and a
    password into an authority neither of them holds.
    """
    if op.operator_id != body.operator_id:
        await audit(session, op, "step_up_identity_mismatch", request=request)
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Step-up must use the signed-in operator's own password.")
    locked = LOGIN_GUARD.account_locked_for(op.operator_id)
    if locked:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            f"Locked. Try again in {locked} seconds.",
                            headers={"Retry-After": str(locked)})

    confirmed = await authenticate(session, body.operator_id, body.password)
    if confirmed is None:
        LOGIN_GUARD.record_failure(op.operator_id,
                                   request.client.host if request.client else None)
        await audit(session, op, "step_up_failed", request=request)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That password is not correct.")

    STEP_UP.confirm(op.operator_id)
    await audit(session, op, "step_up", request=request)
    return {"confirmed_for_seconds": STEP_UP_TTL_SECONDS}


def require_step_up(op: Operator) -> None:
    """Guard for privileged writes. Raises 401 with a machine-readable
    marker so the client knows to prompt rather than to give up."""
    if not STEP_UP.is_fresh(op.operator_id):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Confirm your password before making this change.",
            headers={"WWW-Authenticate": 'Bearer error="step_up_required"'})


@router.get("/auth/me", tags=["auth"])
async def me(op: CurrentOperator):
    return op.model_dump(mode="json")


# ══════════════════════════════════════════════════════════════════════
# Risk and predictions
# ══════════════════════════════════════════════════════════════════════
@router.get("/risk", tags=["risk"])
async def get_risk(
    session: Session,
    district: str | None = Query(None),
    hazard: str = Query("flood"),
    min_score: float = Query(0, ge=-1, le=100),
    limit: int = Query(2000, ge=1, le=20000),
):
    rows = (await session.execute(text("""
        SELECT r.cell_id, r.hazard, r.score, r.level, r.probability, r.confidence,
               r.time_to_impact_h, r.computed_at, r.components,
               c.district_code, c.state_code, c.population,
               ST_Y(c.centroid) AS lat, ST_X(c.centroid) AS lon,
               ST_AsGeoJSON(c.geom) AS geometry
        FROM v_cell_current_risk r
        JOIN spatial_cells c USING (cell_id)
        WHERE r.hazard = CAST(:hazard AS hazard_type)
          AND (:district IS NULL OR c.district_code = :district)
          AND r.score >= :min_score
        ORDER BY r.score DESC
        LIMIT :limit
    """), {"hazard": hazard, "district": district,
           "min_score": min_score, "limit": limit})).mappings().all()

    newest = max((r["computed_at"] for r in rows), default=None)
    return {
        "hazard": hazard, "district": district, "count": len(rows),
        "cells": [{
            "cell_id": r["cell_id"], "score": float(r["score"]), "level": r["level"],
            "probability": _f(r["probability"]), "confidence": _f(r["confidence"]),
            "time_to_impact_h": _f(r["time_to_impact_h"]),
            "population": r["population"], "lat": r["lat"], "lon": r["lon"],
            "geometry": json.loads(r["geometry"]) if r["geometry"] else None,
            "components": r["components"],
        } for r in rows],
        "attribution": ATTRIBUTION,
        "data_freshness": _freshness(newest),
    }


@router.get("/predictions", tags=["risk"])
async def get_predictions(
    session: Session, cell_id: str | None = Query(None),
    hazard: str = Query("flood"), hours: int = Query(24, ge=1, le=168),
):
    rows = (await session.execute(text("""
        SELECT cell_id, hazard, model_version, predicted_at, valid_from, valid_to,
               horizon_hours, probability, level, confidence, degraded_inputs,
               top_contributors, actual_outcome
        FROM hazard_predictions
        WHERE hazard = CAST(:hazard AS hazard_type)
          AND (:cell IS NULL OR cell_id = :cell)
          AND predicted_at >= now() - (:hours * INTERVAL '1 hour')
        ORDER BY predicted_at DESC LIMIT 5000
    """), {"hazard": hazard, "cell": cell_id, "hours": hours})).mappings().all()
    return {"count": len(rows), "predictions": [dict(r) for r in rows],
            "attribution": ATTRIBUTION}


@router.get("/priorities", tags=["priority"])
async def get_priorities(session: Session, district: str | None = Query(None),
                         hazard: str = Query("flood"), limit: int = Query(50, ge=1, le=500)):
    rows = (await session.execute(text("""
        WITH latest AS (SELECT MAX(computed_at) AS t FROM relocation_priorities
                        WHERE hazard = CAST(:hazard AS hazard_type))
        SELECT p.cell_id, p.rank, p.priority_score, p.band, p.terms, p.reasons,
               p.people_to_move, p.weights_version, p.computed_at,
               c.district_code, c.population, ST_Y(c.centroid) AS lat, ST_X(c.centroid) AS lon,
               e.expected_exposed, e.population_in_footprint,
               r.score AS risk_score, r.confidence, r.time_to_impact_h
        FROM relocation_priorities p, latest
        JOIN spatial_cells c USING (cell_id)
        LEFT JOIN LATERAL (SELECT * FROM exposure_scores x WHERE x.cell_id = p.cell_id
                           AND x.hazard = p.hazard ORDER BY computed_at DESC LIMIT 1) e ON TRUE
        LEFT JOIN v_cell_current_risk r ON r.cell_id = p.cell_id AND r.hazard = p.hazard
        WHERE p.computed_at = latest.t
          AND p.hazard = CAST(:hazard AS hazard_type)
          AND (:district IS NULL OR c.district_code = :district)
        ORDER BY p.rank LIMIT :limit
    """), {"hazard": hazard, "district": district, "limit": limit})).mappings().all()

    return {
        "count": len(rows), "hazard": hazard,
        "zones": [dict(r) for r in rows],
        "ordering": "merge sort, O(n log n), stable; ties broken by exposed population "
                    "then time to impact then cell id",
        "attribution": ATTRIBUTION,
        "data_freshness": _freshness(rows[0]["computed_at"] if rows else None),
    }


# ══════════════════════════════════════════════════════════════════════
# Official alerts — kept structurally separate from model output
# ══════════════════════════════════════════════════════════════════════
@router.get("/alerts", tags=["alerts"])
async def get_alerts(session: Session, active_only: bool = Query(True),
                     hazard: str | None = Query(None), limit: int = Query(100, ge=1, le=1000)):
    rows = (await session.execute(text("""
        SELECT id, source, source_id, issuing_authority, observed_at, effective_at, expires_at,
               hazard, cap_event, severity, urgency, certainty, headline, description,
               instruction, area_desc, language, web_url,
               ST_AsGeoJSON(geom) AS geometry
        FROM government_alerts
        WHERE (NOT :active_only OR expires_at IS NULL OR expires_at > now())
          AND (:hazard IS NULL OR hazard = CAST(:hazard AS hazard_type))
        ORDER BY observed_at DESC LIMIT :limit
    """), {"active_only": active_only, "hazard": hazard, "limit": limit})).mappings().all()
    return {
        "count": len(rows),
        "alerts": [{**{k: v for k, v in r.items() if k != "geometry"},
                    "geometry": json.loads(r["geometry"]) if r["geometry"] else None}
                   for r in rows],
        "note": "These are official warnings from the named issuing authority. They are not "
                "produced by this platform's models and are never modified here.",
    }


# ══════════════════════════════════════════════════════════════════════
# Shelters and capacity (§17, §19)
# ══════════════════════════════════════════════════════════════════════
@router.get("/shelters", tags=["shelters"])
async def get_shelters(session: Session, district: str | None = Query(None),
                       usable_only: bool = Query(False)):
    from app.capacity.engine import CapacityEngine, ShelterState

    rows = (await session.execute(text("""
        SELECT v.*, ST_Y(v.geom) AS lat, ST_X(v.geom) AS lon,
               COALESCE(r.score, 0) AS hazard_risk
        FROM v_shelter_live v
        LEFT JOIN v_cell_current_risk r ON r.cell_id = v.cell_id AND r.hazard = 'flood'
        WHERE (:district IS NULL OR v.district_code = :district)
    """), {"district": district})).mappings().all()

    engine = CapacityEngine()
    out = []
    for r in rows:
        result = engine.compute(ShelterState(
            shelter_id=r["shelter_id"], name=r["name"],
            max_capacity=r["max_capacity"] or 0,
            current_occupancy=r["current_occupancy"] or 0,
            state=r["state"] or "open",
            water_capacity_lpd=_f(r["water_capacity_lpd"]),
            water_days_remaining=_f(r["water_days_remaining"]),
            food_days_remaining=_f(r["food_days_remaining"]),
            medical_staff_present=r["medical_staff_present"],
            has_power_backup=bool(r["has_power_backup"]),
            hazard_risk=float(r["hazard_risk"] or 0),
            reported_at=r["reported_at"],
        ))
        if usable_only and not result.operational:
            continue
        out.append({**result.as_dict(), "lat": r["lat"], "lon": r["lon"],
                    "district_code": r["district_code"],
                    "max_capacity": r["max_capacity"],
                    "current_occupancy": r["current_occupancy"]})

    return {"count": len(out), "shelters": out,
            "summary": CapacityEngine.district_summary(
                [type("R", (), {"operational": s["operational"],
                                "effective_capacity": s["effective_capacity"],
                                "raw_available": s["raw_available"],
                                "binding_constraint": s["binding_constraint"],
                                "shelter_id": s["shelter_id"], "name": s["name"]})()
                 for s in out])}


@router.post("/shelters/{shelter_id}/status", tags=["shelters"], status_code=201)
async def update_shelter_status(
    shelter_id: str, body: ShelterStatusUpdate, session: Session, request: Request,
    op: Annotated[Operator, Depends(require("update_shelter_status"))],
):
    require_step_up(op)
    if not op.may_touch_shelter(shelter_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "You are not assigned to this shelter.")

    shelter = (await session.execute(text(
        "SELECT shelter_id, name, max_capacity FROM shelters WHERE shelter_id = :id"),
        {"id": shelter_id})).mappings().first()
    if shelter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown shelter")
    if body.current_occupancy > (shelter["max_capacity"] or 0) * 1.5:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Occupancy exceeds 150% of rated capacity — check the figure.")

    # append-only: supersede the previous row rather than editing it
    await session.execute(text("""
        UPDATE shelter_status SET superseded = TRUE
        WHERE shelter_id = :id AND superseded = FALSE
    """), {"id": shelter_id})
    await session.execute(text("""
        INSERT INTO shelter_status
          (shelter_id, reported_by, state, current_occupancy, water_days_remaining,
           food_days_remaining, medical_staff_present, beds_available,
           special_resources, notes)
        VALUES (:id, :by, CAST(:state AS shelter_state), :occ, :water, :food,
                :medical, :beds, CAST(:special AS jsonb), :notes)
    """), {"id": shelter_id, "by": op.operator_id, "state": body.state,
           "occ": body.current_occupancy, "water": body.water_days_remaining,
           "food": body.food_days_remaining, "medical": body.medical_staff_present,
           "beds": body.beds_available, "special": json.dumps(body.special_resources),
           "notes": body.notes})

    await audit(session, op, "shelter_status_update", entity_type="shelter",
                entity_id=shelter_id, after=body.model_dump(mode="json"), request=request)
    await hub.shelter_updated({"shelter_id": shelter_id, "name": shelter["name"],
                               **body.model_dump(mode="json"),
                               "reported_by": op.operator_id,
                               "reported_at": datetime.now(UTC).isoformat()})
    # Recompute now, not on the next 15-minute tick. A shelter that just filled
    # changes the evacuation plan at the moment it fills.
    queued = trigger(shelter["district_code"], None, Trigger.SHELTER_STATUS,
                     f"{shelter_id} updated by {op.operator_id}")
    return {"ok": True, "shelter_id": shelter_id,
            "recompute": "queued" if queued else "next scheduled tick",
            "propagated_to": ["capacity engine", "evacuation optimiser", "dashboard"]}


# ══════════════════════════════════════════════════════════════════════
# Roads (§20)
# ══════════════════════════════════════════════════════════════════════
@router.get("/roads", tags=["roads"])
async def get_roads(session: Session, district: str | None = Query(None),
                    changed_only: bool = Query(True), limit: int = Query(5000, ge=1, le=50000)):
    rows = (await session.execute(text("""
        SELECT road_id, name, highway_class, current_state, reason, reported_at,
               state_confidence, length_m, ST_AsGeoJSON(geom) AS geometry
        FROM v_road_live
        WHERE (NOT :changed_only OR current_state <> 'open')
        LIMIT :limit
    """), {"changed_only": changed_only, "limit": limit})).mappings().all()
    return {"count": len(rows),
            "roads": [{**{k: v for k, v in r.items() if k != "geometry"},
                       "geometry": json.loads(r["geometry"]) if r["geometry"] else None}
                      for r in rows]}


@router.post("/roads/{road_id}/status", tags=["roads"], status_code=201)
async def report_road_status(
    road_id: int, body: RoadStatusReport, session: Session, request: Request,
    op: Annotated[Operator, Depends(require("report_road_status"))],
):
    require_step_up(op)
    exists = (await session.execute(text(
        "SELECT 1 FROM roads WHERE road_id = :id"), {"id": road_id})).first()
    if exists is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown road segment")

    await session.execute(text("""
        UPDATE road_status SET superseded = TRUE
        WHERE road_id = :id AND superseded = FALSE
    """), {"id": road_id})
    await session.execute(text("""
        INSERT INTO road_status (road_id, state, reason, location, expires_at,
                                 source, reported_by, confidence)
        VALUES (:id, CAST(:state AS road_state), :reason,
                CASE WHEN :lon IS NULL THEN NULL
                     ELSE ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) END,
                CASE WHEN :hours IS NULL THEN NULL
                     ELSE now() + (:hours * INTERVAL '1 hour') END,
                'field_operator', :by, :confidence)
    """), {"id": road_id, "state": body.state, "reason": body.reason,
           "lat": body.lat, "lon": body.lon, "hours": body.expires_in_hours,
           "by": op.operator_id, "confidence": body.confidence})

    await audit(session, op, "road_status_report", entity_type="road",
                entity_id=str(road_id), after=body.model_dump(mode="json"), request=request)
    await hub.road_updated({"road_id": road_id, **body.model_dump(mode="json"),
                            "reported_by": op.operator_id})
    queued = trigger(op.district_code, None, Trigger.ROAD_STATUS,
                     f"road {road_id} → {body.state}")
    return {"ok": True, "road_id": road_id,
            "recompute": "queued" if queued else "next scheduled tick",
            "effect": "The routing engine excludes or penalises this segment. "
                      "Evacuation routes are recalculated immediately."}


# ══════════════════════════════════════════════════════════════════════
# Evacuation (§16, §18)
# ══════════════════════════════════════════════════════════════════════
@router.get("/evacuation", tags=["evacuation"])
async def get_evacuation(session: Session, district: str | None = Query(None),
                         hazard: str = Query("flood")):
    rows = (await session.execute(text("""
        WITH latest AS (SELECT MAX(computed_at) AS t FROM evacuation_routes
                        WHERE hazard = CAST(:hazard AS hazard_type))
        SELECT e.*, s.name AS shelter_name, ST_AsGeoJSON(e.geom) AS geometry,
               c.district_code
        FROM evacuation_routes e, latest
        JOIN shelters s USING (shelter_id)
        JOIN spatial_cells c ON c.cell_id = e.origin_cell
        WHERE e.computed_at = latest.t AND e.hazard = CAST(:hazard AS hazard_type)
          AND (:district IS NULL OR c.district_code = :district)
        ORDER BY e.travel_time_s
    """), {"hazard": hazard, "district": district})).mappings().all()
    return {
        "count": len(rows),
        "routes": [{**{k: v for k, v in r.items() if k != "geometry"},
                    "geometry": json.loads(r["geometry"]) if r["geometry"] else None}
                   for r in rows],
        "note": "Recommended routes for a trained responder to act on. They assume the "
                "road state currently reported and are recalculated on every change.",
    }


@router.get("/shelters/nearest", tags=["evacuation"])
async def nearest_shelters(session: Session, lat: float = Query(ge=-90, le=90),
                           lon: float = Query(ge=-180, le=180), people: int = Query(100, ge=1),
                           hazard: str = Query("flood"), limit: int = Query(8, ge=1, le=30)):
    from app.spatial.nearest import SHELTER_CANDIDATES_SQL, KDTree, rank_shelters

    rows = (await session.execute(text(SHELTER_CANDIDATES_SQL), {
        "lat": lat, "lon": lon, "hazard": hazard, "district": None, "limit": limit * 3,
    })).mappings().all()
    if not rows:
        return {"count": 0, "shelters": [],
                "note": "No shelters are registered within range of this location."}

    from app.capacity.engine import CapacityEngine, ShelterState
    engine = CapacityEngine()
    items = []
    for r in rows:
        cap = engine.compute(ShelterState(
            shelter_id=r["shelter_id"], name=r["name"],
            max_capacity=r["max_capacity"] or 0,
            current_occupancy=r["current_occupancy"] or 0,
            state=r["state"] or "open",
            water_days_remaining=_f(r["water_days_remaining"]),
            food_days_remaining=_f(r["food_days_remaining"]),
            medical_staff_present=r["medical_staff_present"],
            hazard_risk=float(r["hazard_risk"] or 0), reported_at=r["reported_at"],
        ))
        items.append((r["lat"], r["lon"], {
            "shelter_id": r["shelter_id"], "name": r["name"],
            "lat": r["lat"], "lon": r["lon"],
            "effective_capacity": cap.effective_capacity,
            "hazard_risk": float(r["hazard_risk"] or 0),
            "operational": cap.operational,
            "medical_capacity": r["medical_staff_present"] or 0,
            "water_days": _f(r["water_days_remaining"]),
            "food_days": _f(r["food_days_remaining"]),
            "binding_constraint": cap.binding_constraint,
        }))

    ranked = rank_shelters((lat, lon), KDTree(items), people=people, k_candidates=limit)
    return {
        "count": len(ranked),
        "shelters": [{
            "shelter_id": c.shelter_id, "name": c.name, "lat": c.lat, "lon": c.lon,
            "straight_line_km": round(c.straight_line_m / 1000, 2),
            "effective_capacity": c.effective_capacity,
            "feasible": c.feasible, "rejected_because": c.rejected_because,
            "score": round(c.score, 2),
        } for c in ranked],
        "method": "KD-tree candidate generation, then §16 filter chain: remove unsafe, "
                  "remove non-operational, remove full, cost, rank.",
    }


# ══════════════════════════════════════════════════════════════════════
# Citizen reports
# ══════════════════════════════════════════════════════════════════════
@router.post("/reports", tags=["reports"], status_code=201)
async def submit_report(body: CitizenReport, session: Session, request: Request):
    from app.spatial.grid import cell_of
    import secrets as _secrets
    # Random suffix, not a timestamp counter: two reports submitted in the same
    # millisecond during an event must not collide on the primary key.
    report_id = f"CR-{datetime.now(UTC):%y%m%d}-{_secrets.token_hex(3).upper()}"

    description = clean_text(body.description, max_length=2000)
    category = clean_text(body.category, max_length=120)
    if not description or not category:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Please describe what you can see.")

    # A point outside the deployment's coverage has no cell, and inventing one
    # would silently attach the report to the wrong place.
    try:
        cell = cell_of(body.lat, body.lon)
    except Exception:                                  # noqa: BLE001
        cell = None
    known = (await session.execute(text(
        "SELECT 1 FROM spatial_cells WHERE cell_id = :c"), {"c": cell})).first()
    if known is None:
        cell = None
    await session.execute(text("""
        INSERT INTO citizen_reports (report_id, category, hazard, description, location,
                                     cell_id, contact, status, confidence)
        VALUES (:id, :cat, CAST(:hazard AS hazard_type), :desc,
                ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :cell, :contact, 'pending', 0.4)
    """), {"id": report_id, "cat": category, "hazard": body.hazard,
           "desc": description, "lat": body.lat, "lon": body.lon,
           "cell": cell, "contact": clean_text(body.contact, max_length=120)})
    return {"report_id": report_id, "status": "pending",
            "outside_coverage": cell is None,
            "note": ("Thank you. This report will be reviewed by an operator before it "
                     "affects any published risk figure.")
                    if cell else
                    ("Thank you. This location is outside the area this deployment "
                     "currently covers, so it has been recorded for the control room "
                     "but will not change any risk figure.")}


@router.get("/reports", tags=["reports"])
async def list_reports(session: Session,
                       op: Annotated[Operator, Depends(require("read_operational"))],
                       status_filter: str = Query("pending", alias="status")):
    rows = (await session.execute(text("""
        SELECT report_id, category, hazard, description, cell_id, status, submitted_at,
               confidence, ST_Y(location) AS lat, ST_X(location) AS lon
        FROM citizen_reports WHERE status = :st
        ORDER BY submitted_at DESC LIMIT 500
    """), {"st": status_filter})).mappings().all()
    return {"count": len(rows), "reports": [dict(r) for r in rows]}


@router.post("/reports/{report_id}/verify", tags=["reports"])
async def verify_report(
    report_id: str, session: Session, request: Request,
    op: Annotated[Operator, Depends(require("verify_citizen_report"))],
    decision: Literal["verified", "rejected", "duplicate"] = Body(embed=True),
):
    require_step_up(op)
    result = await session.execute(text("""
        UPDATE citizen_reports
           SET status = :d, verified_by = :by, verified_at = now(),
               confidence = CASE WHEN :d = 'verified' THEN 0.9 ELSE 0.1 END
         WHERE report_id = :id
        RETURNING cell_id
    """), {"id": report_id, "d": decision, "by": op.operator_id})
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown report")
    await audit(session, op, f"report_{decision}", entity_type="citizen_report",
                entity_id=report_id, request=request)
    if decision == "verified":
        trigger(op.district_code, None, Trigger.FIELD_REPORT,
                f"{report_id} verified by {op.operator_id}")
    return {"ok": True, "report_id": report_id, "status": decision,
            "cell_id": row["cell_id"],
            "effect": ("Verified reports are corroborating evidence in the risk engine "
                       "and raise the affected cell's confidence."
                       if decision == "verified" else "No effect on published risk.")}


# ══════════════════════════════════════════════════════════════════════
# System health and data quality (§26, §28)
# ══════════════════════════════════════════════════════════════════════
@router.get("/sources", tags=["system"])
async def source_health(session: Session):
    rows = (await session.execute(text("""
        SELECT key, authority, access_mode, is_primary, status, last_success_at,
               last_attempt_at, last_error, consecutive_failures, quality_score,
               staleness_threshold_s, notes
        FROM data_sources ORDER BY is_primary DESC, key
    """))).mappings().all()
    now = datetime.now(UTC)
    out = []
    for r in rows:
        age = ((now - r["last_success_at"]).total_seconds()
               if r["last_success_at"] else None)
        stale = age is not None and age > r["staleness_threshold_s"]
        out.append({**dict(r), "age_seconds": age, "is_stale": stale,
                    "display_status": ("stale" if stale else r["status"])})
    degraded = [s["key"] for s in out
                if s["display_status"] in ("stale", "failed", "not_configured")
                and s["is_primary"]]
    return {"sources": out, "degraded_primary_sources": degraded,
            "system_note": ("Predictions computed while a primary source is degraded are "
                            "flagged and their confidence is reduced. Stale data is never "
                            "presented as live.") if degraded else "All primary sources reporting."}


@router.get("/stats", tags=["system"])
async def stats(session: Session, district: str | None = Query(None)):
    row = (await session.execute(text("""
        SELECT
          (SELECT COUNT(*) FROM spatial_cells
            WHERE :d IS NULL OR district_code = :d) AS cells,
          (SELECT COUNT(*) FROM v_cell_current_risk r JOIN spatial_cells c USING (cell_id)
            WHERE r.level = 'critical' AND (:d IS NULL OR c.district_code = :d)) AS critical,
          (SELECT COUNT(*) FROM v_cell_current_risk r JOIN spatial_cells c USING (cell_id)
            WHERE r.level = 'high' AND (:d IS NULL OR c.district_code = :d)) AS high,
          (SELECT COUNT(*) FROM government_alerts
            WHERE expires_at IS NULL OR expires_at > now()) AS active_alerts,
          (SELECT COUNT(*) FROM shelters WHERE :d IS NULL OR district_code = :d) AS shelters,
          (SELECT COUNT(*) FROM citizen_reports WHERE status = 'pending') AS pending_reports,
          (SELECT COUNT(*) FROM v_road_live WHERE current_state <> 'open') AS roads_affected,
          (SELECT COALESCE(SUM(expected_exposed),0) FROM exposure_scores e
             WHERE e.computed_at > now() - INTERVAL '1 hour') AS expected_exposed
    """), {"d": district})).mappings().first()
    return {**dict(row), "district": district, "attribution": ATTRIBUTION}


# ── helpers ───────────────────────────────────────────────────────────
def _f(v):
    return None if v is None else float(v)


def _freshness(ts: datetime | None) -> dict:
    if ts is None:
        return {"status": "no_data", "computed_at": None, "age_seconds": None,
                "message": "No computation has run for this query yet."}
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    age = (datetime.now(UTC) - ts).total_seconds()
    if age < settings.risk_interval_seconds * 2:
        state, msg = "live", "Current."
    elif age < 3600:
        state, msg = "delayed", f"Last computed {int(age // 60)} minutes ago."
    else:
        state, msg = "stale", (f"Last computed {age / 3600:.1f} hours ago. "
                               "Do not treat this as the current situation.")
    return {"status": state, "computed_at": ts.isoformat(),
            "age_seconds": round(age), "message": msg}


MAX_AGE = timedelta(hours=6)


# ══════════════════════════════════════════════════════════════════════
# Push ingress — the zero-latency path (§5, §20)
# ══════════════════════════════════════════════════════════════════════
class PushEvent(BaseModel):
    """An event pushed by an authority, an SDMA integration or a field device.

    This is how a real-world change reaches the dashboard without waiting for a
    poll. The sender signs the body; see `verify_push_signature`.
    """
    kind: Literal["observation", "official_alert", "road_status",
                  "shelter_status", "field_report"]
    source: str = Field(min_length=1, max_length=64)
    source_id: str | None = Field(default=None, max_length=200)
    observed_at: datetime
    hazard: str | None = None
    district: str | None = Field(default=None, max_length=64)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("observed_at")
    @classmethod
    def _not_absurd(cls, v: datetime) -> datetime:
        """Reject a timestamp far in the future or the distant past.

        A sender with a broken clock would otherwise poison the as-of feature
        queries — an observation stamped next Tuesday makes every training row
        built before then leak the future.
        """
        if v.tzinfo is None:
            v = v.replace(tzinfo=UTC)
        now = datetime.now(UTC)
        if v > now + timedelta(minutes=10):
            raise ValueError("observed_at is in the future; check the sender's clock")
        if v < now - timedelta(days=30):
            raise ValueError("observed_at is more than 30 days old; use the batch loader")
        return v


@router.post("/ingest/event", tags=["ingest"], status_code=202)
async def push_event(request: Request, session: Session):
    """Signed push ingress. Validated, stored, and recomputed immediately.

    Latency from POST to every open dashboard is a few hundred milliseconds:
    the recompute bus debounces for 800 ms to coalesce bursts, then the risk,
    exposure, priority and routing chain runs for the affected district and the
    result is pushed over WebSocket.
    """
    import os
    raw = await request.body()
    verify_push_signature(
        raw,
        request.headers.get("x-aapdasync-signature", ""),
        request.headers.get("x-aapdasync-timestamp", ""),
        os.environ.get("AAPDA_PUSH_SHARED_SECRET", ""),
    )

    try:
        event = PushEvent.model_validate_json(raw)
    except Exception as exc:                          # noqa: BLE001
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Malformed event: {exc}") from exc

    known = (await session.execute(text(
        "SELECT 1 FROM data_sources WHERE key = :k"), {"k": event.source})).first()
    if known is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unknown source {event.source!r}. Register it in docs/10-data-sources.md "
            "and the source table before pushing events from it.")

    # Deduplicate on the provenance triple, exactly as the pollers do, so a
    # sender retrying after a timeout does not create a second record.
    if event.source_id:
        dupe = (await session.execute(text("""
            SELECT 1 FROM ingestion_runs
            WHERE source_key = :k AND reject_reasons ->> 'push_id' = :sid
              AND started_at > now() - INTERVAL '1 hour'
        """), {"k": event.source, "sid": event.source_id})).first()
        if dupe:
            return {"accepted": False, "reason": "duplicate", "source_id": event.source_id}

    await session.execute(text("""
        INSERT INTO ingestion_runs (source_key, started_at, finished_at, ok,
                                    records_fetched, records_stored, reject_reasons)
        VALUES (:k, now(), now(), TRUE, 1, 1, CAST(:meta AS jsonb))
    """), {"k": event.source,
           "meta": json.dumps({"push_id": event.source_id, "kind": event.kind})})

    district = event.district
    if district is None and event.lat is not None and event.lon is not None:
        from app.spatial.grid import cell_of
        row = (await session.execute(text(
            "SELECT district_code FROM spatial_cells WHERE cell_id = :c"),
            {"c": cell_of(event.lat, event.lon)})).first()
        district = row[0] if row else None

    queued = trigger(district, event.hazard, Trigger.PUSH_INGRESS,
                     f"{event.kind} from {event.source}")
    await hub.publish("system", {"type": "push_event", "kind": event.kind,
                                 "source": event.source, "district": district,
                                 "observed_at": event.observed_at.isoformat()})
    return {"accepted": True, "kind": event.kind, "district": district,
            "recompute": "queued" if queued else "next scheduled tick",
            "note": "Recomputation runs immediately; expect the dashboard to reflect "
                    "this within about a second."}


@router.post("/recompute", tags=["system"])
async def force_recompute(
    request: Request,
    op: Annotated[Operator, Depends(require("trigger_evacuation_plan"))],
    district: str | None = Query(None), hazard: str | None = Query(None),
):
    """Operator-forced recomputation, for when someone knows something the
    sensors do not."""
    require_step_up(op)
    if district and not op.may_touch_district(district):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "You are not assigned to that district.")
    queued = trigger(district or op.district_code, hazard, Trigger.OPERATOR_REQUEST,
                     f"forced by {op.operator_id}")
    return {"queued": queued,
            "detail": "Recomputation queued." if queued else
                      "This process does not run the pipeline; the worker will pick "
                      "up the next scheduled tick."}


# ══════════════════════════════════════════════════════════════════════
# Hazard catalogue — which disaster is fed by which source (§3, §8)
# ══════════════════════════════════════════════════════════════════════
@router.get("/hazards", tags=["system"])
async def hazard_catalogue(session: Session, district: str | None = Query(None)):
    """Every hazard, its sources, and whether it is live right now.

    Computed from what is actually configured, not asserted. This is what the
    All Hazards screen renders, so the screen cannot drift from reality.
    """
    from app.hazards import catalogue as cat

    report = cat.status_report()

    # Fold in what each hazard is currently *doing*, not just whether it could.
    rows = (await session.execute(text("""
        SELECT hazard::text AS hazard,
               COUNT(*) AS cells_scored,
               COUNT(*) FILTER (WHERE level = 'critical') AS critical,
               COUNT(*) FILTER (WHERE level = 'high') AS high,
               MAX(score) AS peak,
               MAX(computed_at) AS computed_at
        FROM v_cell_current_risk r
        JOIN spatial_cells c USING (cell_id)
        WHERE (:d IS NULL OR c.district_code = :d)
        GROUP BY hazard
    """), {"d": district})).mappings().all()
    activity = {r["hazard"]: dict(r) for r in rows}

    alerts = (await session.execute(text("""
        SELECT hazard::text AS hazard, source, COUNT(*) AS n
        FROM government_alerts
        WHERE expires_at IS NULL OR expires_at > now()
        GROUP BY hazard, source
    """))).mappings().all()

    for spec in report["hazards"]:
        a = activity.get(spec["hazard"], {})
        spec["cells_scored"] = a.get("cells_scored", 0)
        spec["critical"] = a.get("critical", 0)
        spec["high"] = a.get("high", 0)
        spec["peak_score"] = _f(a.get("peak"))
        spec["computed_at"] = (a["computed_at"].isoformat()
                               if a.get("computed_at") else None)
        spec["data_freshness"] = _freshness(a.get("computed_at"))
        spec["active_alerts"] = sum(x["n"] for x in alerts
                                    if x["hazard"] == spec["hazard"])
        spec["official_alerts"] = sum(x["n"] for x in alerts
                                      if x["hazard"] == spec["hazard"]
                                      and x["source"] == "sachet")

    report["district"] = district
    report["attribution"] = ATTRIBUTION
    return report


@router.get("/sources/plan", tags=["system"])
async def polling_plan(op: Annotated[Operator, Depends(require("read_operational"))]):
    """The derived polling schedule.

    Cadence per source is the tightest any dependent hazard asks for, so
    enabling a fast hazard automatically tightens its sources rather than
    requiring someone to remember a second list.
    """
    from app.hazards import catalogue as cat
    plan = cat.polling_plan()
    return {
        "plan": [{
            "source": key,
            "poll_seconds": seconds,
            "authority": settings.source(key).authority,
            "access": settings.source(key).access.value,
            "feeds_hazards": cat.hazards_for_source(key),
        } for key, seconds in sorted(plan.items(), key=lambda kv: kv[1])],
        "note": "Derived from the hazard catalogue, not hand-maintained.",
    }


# ══════════════════════════════════════════════════════════════════════
# Assistant — retrieval-grounded answering
# ══════════════════════════════════════════════════════════════════════
class AssistantQuery(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    district: str | None = None
    k: int = Field(5, ge=1, le=10)


@router.post("/assistant/query", tags=["assistant"])
async def assistant_query(body: AssistantQuery, session: Session, op: CurrentOperator):
    """Answer a question from the platform's own records.

    Returns the retrieved passages and the constraints that must hold on
    any answer generated from them. The generation step — a language model
    or the grounded composer in the single-file build — receives exactly
    this and nothing more, so the rules below cannot be argued around by a
    cleverly worded question: they are decided here, before any generator
    sees the text.
    """
    question = clean_text(body.question)

    # Scope the corpus to what this caller may already read. The assistant
    # is not a quieter path to data the endpoints would refuse.
    district = body.district
    if district and not op.may_touch_district(district):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Outside your district scope.")
    if op.district_code and not district:
        district = op.district_code

    index = await build_index(session, district=district)
    result = index.retrieve(question, k=body.k)

    if result["intent"] == "personal":
        return {
            "answer": REFUSAL_PERSONAL, "refused": True, "reason": "personal_safety",
            "intent": result["intent"],
            "passages": [_passage_json(s) for s in result["passages"]
                         if s.passage.kind in {"cell", "alert", "shelter", "state"}][:3],
            "attribution": ATTRIBUTION,
        }

    if not index.answerable(result):
        return {
            "answer": REFUSAL_NO_RECORD, "refused": True, "reason": "no_matching_record",
            "intent": result["intent"], "passages": [], "attribution": ATTRIBUTION,
        }

    return {
        "refused": False,
        "intent": result["intent"],
        "passages": [_passage_json(s) for s in result["passages"]],
        "caveat": caveat_for(result["passages"]),
        "retrieval": {
            "matchable_terms": result["matchable"],
            "score_per_term": round(result["score_per_term"], 3),
            "corpus_size": len(index.passages),
        },
        "constraints": [
            "Answer only from the passages provided. Do not add outside knowledge.",
            "Never present a model estimate as an official warning.",
            "Quote an official alert with its issuing authority attached.",
            "If the passages do not answer the question, say so.",
        ],
        "attribution": ATTRIBUTION,
    }


def _passage_json(scored) -> dict:
    p = scored.passage
    return {"id": p.id, "kind": p.kind, "title": p.title, "text": p.text,
            "reference": p.ref, "observed_at": p.observed_at,
            "relevance": round(scored.score, 3)}
