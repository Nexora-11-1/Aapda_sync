# Contributing

This is a decision-support platform for hazard risk, exposure and evacuation.
The thing that makes it worth anything is that its figures are traceable to a
source and honest about their fidelity. Most of the rules below exist to protect
that property, not to tidy the code.

---

## Get it running

```bash
cp .env.example .env          # set POSTGRES_PASSWORD and AAPDA_JWT_SECRET
docker compose up -d --build
docker compose exec worker python scripts/build_grid.py
```

| Surface | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:8000/api |
| API docs (non-prod) | http://localhost:8000/docs |
| Liveness / readiness | `/healthz` · `/readyz` |
| Metrics | `/metrics` |

The stack starts with **no credentials**. Every credentialed source reports
`NOT_CONFIGURED`, which is a supported running state. Before blaming a
connector, find out what your host can actually reach:

```bash
cd backend && python scripts/check_sources.py
```

The dashboard on its own needs nothing at all:

```bash
cd frontend/standalone && node build.js    # → ../dist/aapdasync.html
```

Open that file directly. No server, no build step, no network beyond two web fonts.

---

## Run the tests before you open a pull request

```bash
cd backend && python -m pytest tests/ -q
cd backend && ruff check app tests

cd frontend/standalone
for f in src/*.js assets/*.js build.js; do node --check "$f"; done
node test/ui.spec.mjs            # screens, accessibility, rendering
node test/interaction.spec.mjs   # scroll, map gestures, the report form
node test/live-feed.spec.mjs     # the feed stays current
node test/seasonal.spec.mjs      # the clock is an input
node test/security.spec.mjs      # and security-inputs.spec.mjs
node test/photos.spec.mjs        # the credit rule
node test/navigation.spec.mjs    # every screen reachable by clicking
```

The browser suites drive the built single-file dashboard in real Chromium and
assert **behaviour**, not markup — see `frontend/standalone/test/README.md`. They
have found fifteen real bugs so far. They are the useful ones; please keep them
passing.

CI runs the backend suite, ruff, a syntax check on every script, the frontend
build, an assertion that no asset was left un-inlined, both container builds, and
a check that no container runs as root.

---

## The rules that are not style

These are enforced by tests and by review. A pull request that breaks one will be
asked to change, however good the rest of it is.

**1. A model prediction is never presented as a warning.** Official alerts carry
their issuing authority and live on a separate endpoint. Model output carries its
attribution. The two do not get merged into one list.

**2. Stale is never presented as live.** Every response carries `data_freshness`.
Every displayed age is derived at render time from the real clock in
`Asia/Kolkata`, never from a counter. A stopped pipeline fails `/readyz` rather
than continuing to serve its last figures as current.

**3. No data is not zero risk.** A cell with no model output renders hatched, as
*no data*. Never as a safe green cell.

**4. `data.js` contains no scores.** Raw inputs go in — ground motion, flood
depth, floor area, litres per day, toilet counts, road throughput. Every number
on every screen is derived from them at render time. If you find yourself adding
a precomputed score to a data file, the derivation belongs in an engine instead.

**5. No invented endpoints.** A credentialed source with no credential reports
`NOT_CONFIGURED` and calls nothing. A supplementary source is never relabelled as
the authority it stands in for — GloFAS discharge is not a CWC gauge stage, and
the UI must say which one it has.

**6. A source URL may only be asserted in `docs/10-data-sources.md`.** Connectors
read theirs from configuration.

**7. Priority is reconstructible.** Displayed contributions sum to the score
exactly. `PriorityEngine.verify` raises if they diverge. Do not loosen it.

**8. A photograph without a credit and a licence is not displayed** — not by the
build, not by the browser drop-in path. See `NOTICE.md`.

**9. A repaint never takes the reader's place.** Nothing rebuilds the screen on a
timer while somebody is scrolling, dragging or typing. Scroll position and
keyboard focus are restored afterwards. Six of the fifteen bugs found so far were
violations of this one; it is easier to break than it looks.

**10. An interaction costs what it is worth.** A small movement produces a small
response and nothing else. A two-pixel twitch does not pan; a pan that moved does
not also open what it ended on; one finger on a phone always scrolls.

**11. One failed source never takes down the platform.**

---

## Style

**Python.** `ruff check app tests` must pass. Type hints on anything crossing a
module boundary. Parameterised SQL throughout — no string-built queries, ever.
Free text goes through `clean_text`.

**JavaScript.** Plain ES2020 loaded as classic scripts sharing one global scope.
No framework, no bundler, no runtime dependencies, and deliberately no ES modules,
because the build has to run from `file://`. Every map and chart is hand-written
inline SVG; there is no chart library and no map library. Do not add one.

**CSS.** `src/styles.css` only, with `:root` custom properties. No preprocessor.
Check a new class name against the file before you use it — three silent
collisions (`.sl`, `.stage`, `.term`) have already cost a debugging session each.

**Accessibility is not a later pass.** Visible `:focus-visible` on every
interactive element. Map markers keyboard-focusable, activating on Enter or Space,
with descriptive `aria-label`s. `prefers-reduced-motion` respected. Priority
encoded by shape and number as well as colour — colour is never the only channel.

---

## Commits and pull requests

One concern per pull request. Write the commit message in the imperative — *"Fix
the quadtree pruning a hotspot narrower than its stride"*, not *"fixes"*.

In the description, say what changed and **what would have to be true for it to be
wrong**. The bug list in `README.md` is written that way on purpose: it is the
most useful documentation in the repository, and it stays useful only if new
entries keep the same standard.

If your change alters a displayed number, say which screen, and say whether the
old number was wrong or the definition moved.

---

## Reporting a vulnerability

Do not open a public issue. See `SECURITY.md`.

---

## Where to look first

| You want to | Start at |
|---|---|
| Understand the topology | `docs/01-architecture.md` |
| Add or fix a data source | `docs/10-data-sources.md`, then `backend/app/ingestion/` |
| Change how risk is scored | `backend/app/risk/engine.py` |
| Change capacity or the ledger | `backend/app/capacity/engine.py` |
| Work on the assistant | `docs/11-assistant-and-access.md`, `backend/app/assistant/` |
| Know what this cannot do yet | `docs/12-audit-and-limitations.md` |
| Work on the offline dashboard | `frontend/standalone/src/` |
