"""
Authentication and role-based authorisation (§27).

Five roles, least privilege, and one rule that shapes the rest: **a shelter
operator can update their own shelters and nothing else.** Authorisation is
therefore not just role-based but scope-based — the role says what kind of
action is allowed, the operator's `assigned_shelters` and `district_code` say
where.

Public read access needs no token. Everything that writes needs one, and every
write is recorded in `audit_log` with the operator's real identity, which is
why `require_role` returns the operator rather than a boolean.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from enum import Enum
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import get_session

log = logging.getLogger(__name__)
pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto")
bearer = HTTPBearer(auto_error=False)


class Role(str, Enum):
    PUBLIC = "public"
    FIELD_OPERATOR = "field_operator"
    SHELTER_OPERATOR = "shelter_operator"
    DISTRICT_OPERATOR = "district_operator"
    ADMIN = "admin"


# Who may do what. Higher roles do not automatically inherit lower ones —
# a district operator updating a shelter's occupancy is a real thing, so it
# is listed explicitly rather than implied.
PERMISSIONS: dict[str, set[Role]] = {
    "read_public": set(Role),
    "read_operational": {Role.FIELD_OPERATOR, Role.SHELTER_OPERATOR,
                         Role.DISTRICT_OPERATOR, Role.ADMIN},
    "update_shelter_status": {Role.SHELTER_OPERATOR, Role.DISTRICT_OPERATOR, Role.ADMIN},
    "report_road_status": {Role.FIELD_OPERATOR, Role.DISTRICT_OPERATOR, Role.ADMIN},
    "verify_citizen_report": {Role.FIELD_OPERATOR, Role.DISTRICT_OPERATOR, Role.ADMIN},
    "trigger_evacuation_plan": {Role.DISTRICT_OPERATOR, Role.ADMIN},
    "configure_weights": {Role.ADMIN},
    "manage_models": {Role.ADMIN},
    "manage_operators": {Role.ADMIN},
    "run_replay": {Role.DISTRICT_OPERATOR, Role.ADMIN},
}


class Operator(BaseModel):
    operator_id: str
    full_name: str
    role: Role
    organisation: str | None = None
    district_code: str | None = None
    assigned_shelters: list[str] = []

    def can(self, permission: str) -> bool:
        return self.role in PERMISSIONS.get(permission, set())

    def may_touch_shelter(self, shelter_id: str) -> bool:
        if self.role in (Role.ADMIN, Role.DISTRICT_OPERATOR):
            return True
        return shelter_id in self.assigned_shelters

    def may_touch_district(self, district_code: str | None) -> bool:
        if self.role is Role.ADMIN or district_code is None:
            return True
        return self.district_code == district_code


PUBLIC = Operator(operator_id="anonymous", full_name="Public", role=Role.PUBLIC)


# ── passwords ─────────────────────────────────────────────────────────
def hash_password(raw: str) -> str:
    return pwd_context.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    return pwd_context.verify(raw, hashed)


# ── tokens ────────────────────────────────────────────────────────────
def issue_token(op: Operator) -> tuple[str, datetime]:
    expires = datetime.now(UTC) + timedelta(minutes=settings.jwt_expiry_minutes)
    payload = {
        "sub": op.operator_id, "name": op.full_name, "role": op.role.value,
        "district": op.district_code, "shelters": op.assigned_shelters,
        "iat": int(datetime.now(UTC).timestamp()), "exp": int(expires.timestamp()),
        "iss": "aapdasync",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm), expires


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm],
                          issuer="aapdasync")
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials") from exc


# ── dependencies ──────────────────────────────────────────────────────
async def current_operator(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> Operator:
    """Anonymous is a valid identity — it just cannot do very much."""
    if creds is None:
        return PUBLIC
    claims = decode_token(creds.credentials)
    return Operator(
        operator_id=claims["sub"], full_name=claims.get("name", claims["sub"]),
        role=Role(claims.get("role", "public")),
        district_code=claims.get("district"),
        assigned_shelters=claims.get("shelters") or [],
    )


def require(permission: str):
    async def dependency(op: Annotated[Operator, Depends(current_operator)]) -> Operator:
        if not op.can(permission):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Role '{op.role.value}' is not permitted to {permission.replace('_', ' ')}.")
        return op
    return dependency


async def authenticate(session: AsyncSession, operator_id: str, password: str) -> Operator | None:
    row = (await session.execute(text("""
        SELECT operator_id, full_name, role, organisation, district_code,
               assigned_shelters, password_hash, is_active
        FROM operators WHERE operator_id = :id
    """), {"id": operator_id})).mappings().first()

    if row is None or not row["is_active"]:
        # constant-ish time: still hash so a missing user is not faster
        pwd_context.hash(password)
        return None
    if not verify_password(password, row["password_hash"]):
        return None

    await session.execute(text(
        "UPDATE operators SET last_login_at = now() WHERE operator_id = :id"),
        {"id": operator_id})
    return Operator(
        operator_id=row["operator_id"], full_name=row["full_name"], role=Role(row["role"]),
        organisation=row["organisation"], district_code=row["district_code"],
        assigned_shelters=list(row["assigned_shelters"] or []),
    )


# ── audit ─────────────────────────────────────────────────────────────
async def audit(session: AsyncSession, op: Operator, action: str, *,
                entity_type: str | None = None, entity_id: str | None = None,
                before: dict | None = None, after: dict | None = None,
                request: Request | None = None) -> None:
    import json
    await session.execute(text("""
        INSERT INTO audit_log (operator_id, role, action, entity_type, entity_id,
                               before, after, ip, user_agent)
        VALUES (:operator_id, CAST(:role AS operator_role), :action, :entity_type, :entity_id,
                CAST(:before AS jsonb), CAST(:after AS jsonb), CAST(:ip AS inet), :ua)
    """), {
        "operator_id": None if op.operator_id == "anonymous" else op.operator_id,
        "role": op.role.value, "action": action,
        "entity_type": entity_type, "entity_id": entity_id,
        "before": json.dumps(before) if before else None,
        "after": json.dumps(after) if after else None,
        "ip": request.client.host if request and request.client else None,
        "ua": request.headers.get("user-agent") if request else None,
    })


CurrentOperator = Annotated[Operator, Depends(current_operator)]
Session = Annotated[AsyncSession, Depends(get_session)]
