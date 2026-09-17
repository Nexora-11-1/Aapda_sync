"""Credential throttling and step-up re-authentication.

Rate limiting the login *endpoint* is not the same as rate limiting an
*account*. A per-IP limit does nothing against a spread attempt from a
botnet, and a per-account limit alone lets one attacker lock every
operator out of the console during an emergency — a denial of service
against the disaster response itself, which is worse than the guessing
it prevents.

So both are tracked, and they fail differently:

  * Per account: five attempts, then a lockout that doubles from one
    minute to a fifteen-minute ceiling. The ceiling matters. An operator
    who fat-fingers a password during a flood must not be shut out for
    the rest of the shift.
  * Per source address: a wider window across all accounts, which is what
    actually catches enumeration — trying one password against two
    hundred usernames never trips a per-account counter.
  * A successful authentication clears that account's counter, but not
    the address counter. Guessing your way to one valid credential should
    not reset the evidence that you were guessing.

Step-up is separate. A session proves who signed in; it does not prove
who is at the keyboard forty minutes later. Any write that other people
will see requires a fresh password, valid for a short window afterwards
so a burst of updates does not become a burst of prompts.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

# Per-account
MAX_ACCOUNT_ATTEMPTS = 5
BASE_LOCK_SECONDS = 60
MAX_LOCK_SECONDS = 15 * 60

# Per source address, across all accounts
ADDRESS_WINDOW_SECONDS = 300
MAX_ADDRESS_ATTEMPTS = 30

# How long a step-up confirmation stays good
STEP_UP_TTL_SECONDS = 10 * 60


@dataclass
class _Account:
    failures: int = 0
    locked_until: float = 0.0


@dataclass
class _Address:
    stamps: list[float] = field(default_factory=list)


# ── Scope, stated plainly ────────────────────────────────────────────────
# This state is per-process. There is no shared backing store, so two workers
# means two independent lockout counters and an attacker gets both budgets.
# The deployment compensates by running ONE uvicorn worker per container (see
# the Dockerfile, where that is enforced as a security boundary and not a
# tuning knob) and scaling by replicas behind a load balancer that applies its
# own limits. Moving this behind Redis is the correct fix and is not done here;
# until it is, the constraint above is load-bearing and must not be relaxed.

class LoginGuard:
    """In-process throttle. See the scope note above: this is per-process
    state, and the deployment runs one worker per container because of it."""

    def __init__(self) -> None:
        self._accounts: dict[str, _Account] = {}
        self._addresses: dict[str, _Address] = {}

    # ── queries ──────────────────────────────────────────────────────
    def account_locked_for(self, operator_id: str, *, now: float | None = None) -> int:
        now = time.monotonic() if now is None else now
        acct = self._accounts.get(operator_id)
        if acct is None or acct.locked_until <= now:
            return 0
        return int(acct.locked_until - now) + 1

    def address_blocked(self, address: str, *, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        rec = self._addresses.get(address)
        if rec is None:
            return False
        self._prune(rec, now)
        return len(rec.stamps) >= MAX_ADDRESS_ATTEMPTS

    def attempts_remaining(self, operator_id: str) -> int:
        acct = self._accounts.get(operator_id)
        used = acct.failures if acct else 0
        return max(MAX_ACCOUNT_ATTEMPTS - used, 0)

    # ── mutations ────────────────────────────────────────────────────
    def record_failure(self, operator_id: str, address: str | None = None,
                       *, now: float | None = None) -> int:
        """Returns the lockout in seconds, or 0 if the account is still open."""
        now = time.monotonic() if now is None else now
        acct = self._accounts.setdefault(operator_id, _Account())
        acct.failures += 1
        if acct.failures >= MAX_ACCOUNT_ATTEMPTS:
            over = acct.failures - MAX_ACCOUNT_ATTEMPTS
            lock = min(BASE_LOCK_SECONDS * (2 ** over), MAX_LOCK_SECONDS)
            acct.locked_until = now + lock
        if address:
            rec = self._addresses.setdefault(address, _Address())
            self._prune(rec, now)
            rec.stamps.append(now)
        return self.account_locked_for(operator_id, now=now)

    def record_success(self, operator_id: str) -> None:
        """Clears the account counter. Deliberately does NOT clear the
        address counter: reaching a valid credential by guessing is not a
        reason to forget the guessing."""
        self._accounts.pop(operator_id, None)

    def reset(self) -> None:
        self._accounts.clear()
        self._addresses.clear()

    @staticmethod
    def _prune(rec: _Address, now: float) -> None:
        cutoff = now - ADDRESS_WINDOW_SECONDS
        rec.stamps[:] = [s for s in rec.stamps if s > cutoff]


class StepUp:
    """Recent-password-confirmation registry, keyed by operator."""

    def __init__(self) -> None:
        self._confirmed: dict[str, float] = {}

    def confirm(self, operator_id: str, *, now: float | None = None) -> None:
        self._confirmed[operator_id] = time.monotonic() if now is None else now

    def is_fresh(self, operator_id: str, *, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        at = self._confirmed.get(operator_id)
        return at is not None and (now - at) < STEP_UP_TTL_SECONDS

    def revoke(self, operator_id: str) -> None:
        self._confirmed.pop(operator_id, None)

    def reset(self) -> None:
        self._confirmed.clear()


LOGIN_GUARD = LoginGuard()
STEP_UP = StepUp()
