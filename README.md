# AapdaSync

[![CI](https://github.com/Nexora-11-1/Aapda_sync/actions/workflows/ci.yml/badge.svg)](https://github.com/Nexora-11-1/Aapda_sync/actions/workflows/ci.yml)
[![Pages](https://github.com/Nexora-11-1/Aapda_sync/actions/workflows/pages.yml/badge.svg)](https://github.com/Nexora-11-1/Aapda_sync/actions/workflows/pages.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-1f6feb.svg)](LICENSE)

**[Open the live dashboard](https://nexora-11-1.github.io/Aapda_sync/app/)** ·
[Project page](https://nexora-11-1.github.io/Aapda_sync/) ·
[Documentation index](docs/00-index.md) ·
[What is honestly not built](docs/12-audit-and-limitations.md) ·
[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Third-party material](NOTICE.md)

**India-specific multi-disaster risk, exposure and evacuation decision-support platform.**

Ingests Indian authority data, scores hazard risk on an H3 grid, estimates who is
physically exposed, ranks areas for relocation with a transparent explanation,
models real shelter capacity, and routes evacuation over a road network whose
state changes in real time.

**All 36 states and union territories** are live and drillable. All nine hazard
modules are connected to real data sources and run with **no credentials at all**
— credentials buy fidelity, not existence.

Coverage and registers are separated deliberately, because they come from
different places. *Modelled risk is national*: IMD/Open-Meteo, GloFAS, USGS/GDACS,
INCOIS and FIRMS cover the whole country, so a risk surface can be computed for
any state honestly. *Registers are local*: shelter capacity and road state come
from a State Disaster Management Authority. Chamoli District, Uttarakhand is the
integrated MVP; every other state shows a **provisional register** and the
interface says so on the screen, every time.

> Model output on this platform is **AI-based risk prediction and decision support.
> It is not an official warning.** Official warnings come from IMD, NDMA/SACHET,
> CWC and the State Disaster Management Authorities, and are carried verbatim with
> their issuing authority attached.

---

## Run it

```bash
cp .env.example .env          # set POSTGRES_PASSWORD and AAPDA_JWT_SECRET
docker compose up -d --build
```

| Surface | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:8000/api |
| API docs (non-prod) | http://localhost:8000/docs |
| Liveness / readiness | `/healthz` · `/readyz` |
| Prometheus metrics | `/metrics` |

Then build the grid and load infrastructure:

```bash
docker compose exec worker python scripts/build_grid.py
docker compose exec worker python scripts/load_osm.py
```

The stack starts with **no credentials**. Every credentialed source reports
`NOT_CONFIGURED`, which is a supported running state — the platform runs, marks
those sources in the UI, and reduces the confidence of predictions that needed
them. Fill in `.env` to bring each one live (see `docs/10-data-sources.md`).

### Check what your host can reach

```bash
cd backend && python scripts/check_sources.py
```

Makes real calls to every configured source and prints which of the nine hazards
this server can actually feed, from this network, past this firewall. Run it
first on any new deployment.

### The dashboard on its own

`frontend/dist/aapdasync.html` is a single self-contained file — no server, no
build step, no network beyond the two web fonts. Open it directly. It is what
you email, put on a USB stick, or run in a district control room with no uplink.

```bash
cd frontend/standalone && node build.js     # rebuild it
```

---

## What is real time, precisely

The platform cannot be faster than the authorities it reads: IMD publishes on its
own cadence, CWC's gauges report when they report. What it guarantees is **zero
added latency** — the moment a fact arrives it is processed and on every open
dashboard.

Three paths, in order of speed:

| Path | Latency | Used by |
|---|---|---|
| **Push ingress** `POST /api/ingest/event` | ~1 s to the dashboard | Authorities and SDMA integrations that can push. HMAC-signed, replay-protected. |
| **Write-through** | ~1 s | Operator writes: a shelter fills, a road is cut, a report is verified. Each triggers an immediate district recompute. |
| **Polling** | source-dependent | The floor, for sources with no push. Per-source cadence, as tight as each one's rate limit allows. |

All three converge on one coalescing recompute bus (`app/realtime.py`): a burst
of ten road closures in one second produces one recompute carrying all ten, not
ten recomputes. The dashboard's live badge always states connection state and the
age of what is on screen — a disconnected dashboard says *Offline* and shows how
old its figures are, rather than displaying them as current.

**Nothing on screen is a baked-in timestamp.** Every time the dashboard displays
is derived at render time from the wall clock in `Asia/Kolkata`
(`Intl.DateTimeFormat`, not a counter), so an alert seeded "37 minutes ago"
reads as 37 minutes ago whenever the page is opened — never as yesterday's
16:42. The loop measures elapsed wall-clock time rather than counting ticks: if
the browser throttles a background tab or the machine sleeps, the missed
intervals are replayed on return so the figures catch up instead of resuming
where they paused, and every displayed age is re-derived once a minute.

**The screen is synchronised with the store once a second.** The model underneath
advances on the same second, in quarter-sized steps, so the rate of change is what
it always was and the surface moves in four small increments rather than one visible
jump every fourth second. The expensive parts are deliberately not on that cadence:
the relocation queue and the routing are re-derived once per full tick, because a
queue that reshuffles four times a second is unreadable and the documented promise
is that it does not reshuffle between ticks. None of this changes how often real
observations are fetched — polling Open-Meteo, GloFAS and USGS every second would
burn somebody else's free service to redraw numbers that change hourly, so each
source keeps its own cadence and the badge reports the true age of the reading
rather than the age of the repaint.

**Repainting never moves the ground under the reader.** Nothing calls `render()` on
a timer any more. The two screens people actually sit on — the command map and the
public landing page — have targeted paths that update every figure that moves
without replacing a single element anybody could be scrolling, reading or pointing
at. Everything else rebuilds only when the reader is not mid-scroll, mid-drag or
mid-sentence, and puts their scroll position and keyboard focus back afterwards.

**The whole country syncs, not just the open state.** Every tick advances all 36
states, and each state's headline is recomputed as the peak of its own grid rather
than nudged, so what the India map shows is genuinely the maximum risk anywhere in
that state right now.

The national alert feed is kept current rather than built once: entries age against
the wall clock, expired warnings leave, and one state is re-derived per tick so all
36 turn over inside two and a half minutes without recomputing the country every
four seconds. A warning the platform issues itself goes straight into that feed —
otherwise it could raise an alert and still report an older one as the newest thing
that had happened.

The result is surfaced twice, in the two framings the two audiences need. Operators
get *most severe now* and *newest warning* on **every** command screen, because
someone reading the shelter list still needs to know the worst situation has moved
to another state. The public portal gets the same live picture as *worst affected
right now* — the four hardest-hit states, ranked, with the reader's own marked
**you are here** — because a resident does not want a peak score, they want to know
which places are worst and whether one of them is theirs.

**The clock is an input, not a decoration.** A risk surface that opens with the
same figures in February and in July is not live — it is a screenshot that
animates. India's hazards are strongly seasonal and partly diurnal, and the
platform knows what time it is, so the opening state is derived from that:
flood and landslide peak in the southwest monsoon, cyclone in the post-monsoon
Bay season, heat and forest fire before the monsoon breaks, lightning through
the afternoon. Open it in November and Odisha leads on cyclone; open it in
February and the country is quiet with Rajasthan and Gujarat on drought.

The words move with the figures, which is the part that is easy to get wrong.
A state scoring 34 is *Monitored*, not "Flood + Landslide"; the authored Chamoli
narrative is only told while Chamoli is actually in flood; an alert's severity,
its headline wording and how recently it was issued all come from what the
hazard is doing now, so no Extreme warning is ever issued for a quiet hazard and
the public ticker does not paint a Minor advisory in the same crimson as an
Extreme one. `test/seasonal.spec.mjs` asserts all of it across four dates.

With a backend attached none of this is consulted — the values come from the
feeds. It is what makes the offline build honest about being live.

**A stalled pipeline says so.** `orchestrator.tick_watchdog` distinguishes
*never ran* from *stalled*, *lagging* and *healthy*, exports `PIPELINE_LAG`, and
publishes `pipeline_health` to every open dashboard. `/readyz` fails once the
pipeline is more than six risk intervals behind, so a load balancer pulls the
instance rather than serving figures that have quietly stopped moving.

---

## Repository

```
aapdasync/
├── docker-compose.yml          api · worker · postgis · redis · frontend
├── .env.example                every credential, with what it unlocks
├── docs/                       the design package (§34)
│   ├── 01-architecture.md      topology, failure posture, scaling path
│   └── 10-data-sources.md      the only place a source URL may be asserted
├── backend/
│   ├── sql/                    PostGIS schema + indexes, idempotent
│   └── app/
│       ├── config.py           every URL and credential enters here
│       ├── realtime.py         coalescing recompute bus
│       ├── orchestrator.py     the live pipeline
│       ├── worker.py           pipeline process entry point
│       ├── ingestion/          one package per source, common contract
│       ├── spatial/            H3 grid · quadtree D&C · KD-tree
│       ├── features/           leakage-safe as-of feature builder
│       ├── ml/                 training, calibration, registry, promotion gate
│       ├── risk/ impact/ vulnerability/ priority/ capacity/ routing/ evacuation/
│       ├── assistant/          BM25 retrieval + corpus, the assistant's contract
│       ├── core/               security, hardening, logging, metrics, lockout
│       └── api/ ws/            REST surface and WebSocket hub
└── frontend/
    ├── standalone/src/
    │   ├── states.js           all 36 states/UTs, rosters and grid generation
    │   ├── auth.js             the credential bridge into Command
    │   ├── rag.js              the assistant: index, retrieval, grounded answers
    │   ├── memorial.js         the record of past disasters, and relief routing
    │   └── ui.js               accessibility, guided mode, map navigation
    └── dist/aapdasync.html     single-file build
```

---

## The algorithms (§14–§16, §18)

| Where | Algorithm | Bound | Why this one |
|---|---|---|---|
| `spatial/quadtree.py` | Recursive quadrant subdivision | `T(n)=4T(n/4)+Θ(1) ⇒ Θ(n)` worst case, sublinear when pruning fires | Risk is spatially autocorrelated. Proving a quadrant uniform is cheap; the budget goes to quadrants that disagree with themselves. Measured prune rate ≈ 0.72 on a live monsoon tick. |
| `priority/mergesort.py` | Merge sort | `T(n)=2T(n/2)+Θ(n) ⇒ Θ(n log n)`, all cases | Stability under a documented tie-break, so the evacuation queue does not reshuffle between ticks; an auditable comparison trace; no pathological case inside a 15-minute deadline. |
| `spatial/nearest.py` | 2-d k-d tree | build `Θ(n log n)`, query `Θ(log n)` expected | Candidate generation for shelter selection, in microseconds, with no database round trip. Projected to metres — comparing degrees is subtly wrong north–south. |
| `routing/graph.py` | Dijkstra (one-to-many), A\* (point-to-point) | `Θ((V+E) log V)` | One Dijkstra per zone costs less than A\* per shelter. The A\* heuristic is great-circle ÷ max speed: admissible and consistent, so the result is provably optimal. |

Every bound above has a test that asserts it rather than asserting it in prose —
see `tests/test_daa.py`.

---

## Design commitments

These are enforced in code and covered by tests, not stated as intent.

0. **Every hazard names its real source, and its real fidelity.** Nine disasters,
   each wired to a live feed: IMD/CWC/NCS/NRSC/INCOIS where credentials exist,
   and Open-Meteo, GloFAS, USGS FDSN, GDACS and FIRMS where they do not. A
   supplementary source is never relabelled as the authority it stands in for —
   GloFAS discharge is not a CWC gauge stage, and the UI says which one it has.
1. **A model prediction is never presented as a warning.** Every risk response
   carries its attribution; official alerts live on a separate endpoint with the
   issuing authority intact.
2. **Stale is never presented as live.** Sources past their staleness window are
   marked; every response carries `data_freshness`; the dashboard shows the age,
   computed against the viewer's actual clock. A stopped pipeline fails `/readyz`
   rather than continuing to serve its last figures as current.
3. **No data is not zero risk.** A cell with no model output renders as *no data*
   with a hatched fill — never as a safe green cell.
4. **Exposure is a spatial overlay, not `p × population`.** 8 200 people in a cell
   12 m above the drainage line are not 5 250 people at risk.
5. **Physical capacity is not operational capacity.** A hall rated 5 000 with
   4 200 inside and one nurse does not have 800 usable places — and the platform
   names which constraint binds, so you know whether to send a tanker or open
   another hall.
6. **Priority is reconstructible.** The displayed contributions sum to the score
   exactly; `PriorityEngine.verify` raises if they ever diverge.
7. **No invented endpoints.** A credentialed source with no credential reports
   `NOT_CONFIGURED` and does not call anything.
8. **One failed source never takes down the platform.**
9. **An interaction costs what it is worth.** A small movement produces a small
   response and nothing else: the wheel over the map scrolls the page unless Ctrl
   is held, a two-pixel twitch does not pan, one finger on a phone always scrolls,
   rotation and pitch are not offered at all, and a pan that moved does not also
   open what it ended on. Asserted in `test/interaction.spec.mjs`.
10. **A repaint never takes the reader's place.** Nothing rebuilds the screen on a
   timer while somebody is scrolling, dragging or typing; what they had written is
   still there afterwards, and so is where they were on the page.
11. **A photograph without a credit and a licence is not displayed** — by the build
   or by the browser drop-in path — and a credit that has not been checked against
   its source says so on the image, not only in the build log.

---

## Security

| Control | Where |
|---|---|
| Boot refuses default secrets, debug or wide CORS in prod | `core/hardening.py: verify_configuration` |
| Command is unreachable without a credential — no toggle, no URL, no console call | `src/auth.js`, `views.js: go/render` |
| Per-account lockout with capped backoff, plus a per-address limit that catches enumeration | `core/lockout.py: LoginGuard` |
| Step-up re-authentication before any write other people will see | `core/lockout.py: StepUp`, `routes.py: require_step_up` |
| Five roles, scope-checked per shelter and per district | `core/security.py` |
| Sliding-window rate limits, tightest on login | `core/hardening.py: RateLimitMiddleware` |
| CSP, HSTS, frame-deny, no-store on API responses | `SecurityHeadersMiddleware` |
| HMAC-signed push ingress with replay protection | `verify_push_signature` |
| WebSocket topics scoped by role and district | `main.py: _scope_topics` |
| Argon2 password hashing, constant-time verification | `core/security.py` |
| Append-only audit log with real operator identity | `audit_log` table |
| Parameterised SQL throughout; no string-built queries | all of `app/` |
| Control-character and bidi-override stripping on free text | `clean_text` |
| Non-root container, multi-stage build, no build toolchain at runtime | `backend/Dockerfile` |

`tests/test_security.py` covers each of these, including replay, tampering,
privilege escalation and cross-tenant access.

---

## Tests

```bash
cd backend && python -m pytest tests/ -q      # 213 tests
cd frontend/standalone && node test/ui.spec.mjs        # 49 browser checks
                          node test/live-feed.spec.mjs # the feed stays current
                          node test/map-zoom.spec.mjs  # the map fills its box
                          node test/interaction.spec.mjs # scroll, map gestures, slideshow, the report form
                          node test/photos.spec.mjs    # photographs and the credit rule
                          node test/navigation.spec.mjs # every screen reachable by clicking
```

The browser suites drive the built single-file dashboard in real Chromium and
assert behaviour rather than markup — see `frontend/standalone/test/README.md`.

They found nine real bugs during development, all fixed: the quadtree could prune
a hotspot narrower than its sampling stride; priority contributions did not
reconstruct the displayed score; the rate limiter grew one entry per client
forever; the recompute bus waited a full second on an item ready in fifty
milliseconds; a public source needing a free key reported itself configured when
it could not call anything; the derived polling plan would have hammered a
donated JRC service every two minutes because one impatient hazard asked it to;
the assistant's absolute relevance floor silently refused every short question,
because BM25 scales with query length and "what should I do in a flood" has one
content word once the stopwords are gone; its intent filter kept the model
registry ahead of the safety guidance whenever only one better passage survived;
its extractive step reordered safety instructions by keyword overlap, which
put the third instruction first and dropped the one that saves you; the public
map's SVG had no sizing rule of its own, so it rendered nearly a thousand pixels
tall inside a 460-pixel box and the country came out as a clipped ribbon; and the
national alert feed was built once at boot and never touched again, so the strip
labelled *newest warning · 13 minutes ago* still said thirteen minutes an hour
later — stale data presented as live, in the one component whose whole job is to
show what is latest. A design pass then found four more: every past-disaster scene
shared one set of SVG gradient ids, so all ten resolved to the first one's and the
whole gallery wore Latur's night sky; three new CSS class names collided with
existing ones (`.sl`, `.stage`, `.term`), silently restyling unrelated components;
a red **0** sat in the "critical band" tile, colouring good news as an alarm; and the
shelter banner asserted "water is the binding constraint at 0 shelters" whatever
the real constraint was.

An interaction pass then found six more, all of which made the application feel
unstable rather than look wrong:

- **The pipeline replaced the whole page every four seconds.** `render()` rewrote
  `main.innerHTML` on a timer, which threw away the element holding the scroll
  position — a reader halfway down the public portal was returned to the top, mid
  sentence, forever. It is most of what "the whole site feels too sensitive" was.
- **An incident report could not be filed at all.** The same loop regenerated the
  open drawer, so the description someone was typing was deleted under them before
  they could reach Submit.
- **Every report was filed against the wrong zone.** `S.cells[0]`, whatever the
  person said about where they were, and report ids were drawn from the same range
  as the simulated feed's, so two different reports could carry one identifier.
- **The map took the page's scroll.** A wheel anywhere over it called
  `preventDefault` and zoomed 18% per event; on a trackpad, which emits thirty
  events a second, the country left the screen while someone was trying to read
  past it.
- **Dragging the map opened whatever you let go of.** A pan ended with a click on
  a state or a cell, so the map could not be moved without also being navigated.
- **Pausing the slideshow rewrote the button under the cursor**, which made the
  browser rebuild its hover chain, which fired `mouseenter` again, which paused it
  again — a loop that repainted several times a frame and destroyed the mousedown
  target before the mouseup, so the play button could never be clicked.

And three that only appeared on a small screen: the header ladder stopped at
1000 px and below that the sign-in button and the alert bell were simply off the
right of a phone; `1fr` floors at min-content, so the public grid stayed 639 px
wide inside a 390 px viewport; and a faded-out map tooltip, still laid out at the
last cursor position, made the document wider than the viewport with nothing
visible in it.

---

## Photographs

**Six of the ten past-disaster slides carry a photograph; the other four are
rendered scenes and say so on their face.** The scenes are each a specific place at
a specific hour, built the way a landscape painter builds one: a graded sky, ridges
that lose contrast with distance, haze, directional light and grain. They are
deliberately sober. These are events in which thousands of people died; the scenes
show the ground and the weather, never the dying — and a supplied photograph that
breaks that rule is not shipped either. The Latur 1993 photograph offered for this
build shows a casualty in the rubble, so that slide keeps its illustration; the
reason is recorded in `credits.json` rather than left to be rediscovered.

Where the photographs appear, and why each placement earns its space:

| Place | What it does |
|---|---|
| **Public landing page, hero** | A 21:9 slideshow above the fold, one photograph per event with the sentence that event forced the country to learn, and a way through to the full account. Autoplay at 6.5 s, pausing the moment anybody touches it. |
| **What we learned, gallery** | The existing coverflow. A slide with a photograph shows its credit; a slide without says it is an illustration. |
| **What to do, hazard cards** | The Indian event that hazard is known by, captioned. "Sixty centimetres of moving water will carry a car" is a sentence people nod at; a photograph of a flooded Chennai street is the same sentence in a form that argues back. |
| **District Command** | Nothing. An operational screen is not the place for a picture. |

Every image is a WebP capped at 1280 px on its long side and to 120 KB, chosen by
giving up pixels before quality — six photographs come to 464 KB before base64.
Each carries its intrinsic width and height and its dominant colour, so the box is
its final size and its final colour before a byte of it has decoded: no layout
shift, and no flash from empty to picture. Only the visible slide and its two
neighbours are ever decoded.

Two ways to add more. Both enforce the same rule — **credit and licence are
required, or the image is not displayed.**

**In the browser, immediately.** Open *What we learned*, press **Add a photo** on any
slide, drop the image in and type the credit. It is resized to 1400 px, stored in that
browser via IndexedDB and shown at once. *Export credits.json* then writes out exactly
what the build needs, so anything added this way can be promoted.

**In the build, permanently.**

```bash
cp kedarnath.jpg frontend/standalone/assets/photos/kedar13.jpg
$EDITOR frontend/standalone/assets/photos/credits.json    # credit + licence
cd frontend/standalone && node build.js
```

The build inlines each image as a data URI, prints how many it embedded, and **names
any it skipped for a missing credit**. Event ids: `latur`, `odisha99`, `tsunami04`,
`mumbai05`, `kedar13`, `hw15`, `chennai15`, `kerala18`, `josh23`, `wayanad24`.

`credits.json` also takes `verified`. Set it to `false` when the credit has been
recorded from a plausible source but not checked against the file page itself: the
photograph still renders, its caption carries a visible **attribution unverified**
mark, and the build prints a reminder naming every entry still in that state. Five
of the six shipped photographs are currently marked this way and are waiting on
their Wikimedia Commons file pages being opened and the author and licence version
written down exactly.

Usual sources for imagery you may publish: public-domain Government of India releases
(PIB, ISRO/NRSC, NDRF), NASA, NOAA, and Creative Commons photographs on Wikimedia Commons.

---

## Status and limits

Before any real deployment:

- Confidence percentages must be **calibrated against Indian outcomes** before an
  operator sees them. The isotonic wrapper is in place; it needs real history.
- Operator identities must come from the state's own directory, not a local table.
- The road graph is OSM. Where a district has an authoritative PWD network, use it.
- Population is WorldPop until Census ward figures are available.
- A predicted high-risk cell does not mean every point inside it is affected.
- The platform is decision support. It does not replace trained responder
  judgement, and no screen in it should imply otherwise.

---

## Data sources

Every source, its real access route and what it needs: **`docs/10-data-sources.md`**.
That file is the only place a source URL may be asserted; connectors read theirs
from configuration.

Sources: [IMD](https://mausam.imd.gov.in/responsive/apis.php) ·
[NDMA SACHET](https://sachet.ndma.gov.in/CapFeed) ·
[CWC](https://cwc.gov.in/flood-forecasting-hydrological-observation) ·
[Bhuvan / NRSC](https://bhuvan.nrsc.gov.in/) ·
[INCOIS ERDDAP](https://erddap.incois.gov.in/erddap/) ·
[NCS](https://seismo.gov.in/data-portal) ·
[USGS FDSN](https://earthquake.usgs.gov/fdsnws/event/1/) ·
[Open-Meteo](https://open-meteo.com/en/docs) ·
[OSM Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API) ·
[NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/) ·
[OpenTopography](https://portal.opentopography.org/apidocs/) ·
[WorldPop](https://www.worldpop.org/methods/)
