# Security policy

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private reporting instead:

> Repository → **Security** → **Advisories** → **Report a vulnerability**

Include what you did, what happened, what you expected, and the smallest input
that reproduces it. If the finding touches authentication, the audit ledger, the
push-ingress signature or role scoping, say so in the first line — those are the
controls the rest of the platform's guarantees rest on.

Expect an acknowledgement within a few days. A fix ships before the advisory is
made public.

---

## Scope

In scope: everything in this repository — the API, the WebSocket hub, the
ingestion connectors, the worker, the container images, and the standalone
dashboard.

Out of scope: the upstream authorities the platform reads (IMD, CWC, NDMA/SACHET,
INCOIS, NCS, NRSC and the rest). Report those to the authority that runs them.

---

## What is already enforced, and where

`backend/tests/test_security.py` covers each of these, including replay,
tampering, privilege escalation and cross-tenant access. If you are looking for a
gap, start by reading the test and asking what it does *not* assert.

| Control | Where |
|---|---|
| Boot refuses default secrets, debug or wide CORS in production | `core/hardening.py: verify_configuration` |
| Command is unreachable without a credential — no toggle, no URL, no console call | `frontend/standalone/src/auth.js`, `views.js: go/render` |
| Per-account lockout with capped backoff, plus a per-address limit that catches enumeration | `core/lockout.py: LoginGuard` |
| Step-up re-authentication before any write other people will see | `core/lockout.py: StepUp`, `api/routes.py: require_step_up` |
| Five roles, scope-checked per shelter and per district | `core/security.py` |
| Sliding-window rate limits, tightest on login | `core/hardening.py: RateLimitMiddleware` |
| CSP, HSTS, frame-deny, `no-store` on API responses | `SecurityHeadersMiddleware` |
| HMAC-signed push ingress with replay protection | `verify_push_signature` |
| WebSocket topics scoped by role and district | `main.py: _scope_topics` |
| Argon2 password hashing, constant-time verification | `core/security.py` |
| Append-only audit log carrying real operator identity | `audit_log` table |
| Parameterised SQL throughout; no string-built queries | all of `backend/app/` |
| Control-character and bidi-override stripping on free text | `clean_text` |
| Non-root container, multi-stage build, no build toolchain at runtime | `backend/Dockerfile` |

CI fails if a default JWT secret reaches `main`, and fails if either container
image runs as root.

---

## Operating this safely

The platform is decision support for a civil-protection function. Two failure
modes matter more here than they would elsewhere, and both are about trust rather
than compromise:

- **A model output presented as an official warning.** Official alerts come from
  IMD, NDMA/SACHET, CWC and the State Disaster Management Authorities, and are
  carried verbatim with their issuing authority attached. Model output is labelled
  as model output. A change that blurs the two is a security issue, not a UX
  decision.
- **Stale figures presented as current.** `/readyz` fails once the pipeline is
  more than six risk intervals behind, so a load balancer pulls the instance
  rather than serving figures that have quietly stopped moving. Do not paper over
  this in a deployment.

Before any real deployment, the gaps named in `docs/12-audit-and-limitations.md`
apply — in particular: operator identities must come from the state's own
directory rather than a local table, and the in-memory ledger must be backed by
an immutable store.

---

## Credentials

Every credential enters through `backend/app/config.py` and is documented in
`.env.example`. `.env` is git-ignored; keep it that way. The stack runs with none
of them set — credentials buy fidelity, not existence — so there is never a reason
to commit one to get something working.
