# Audit, and what is honestly not built

This is the answer to the production-grade brief: what the codebase actually
contains, measured rather than described, and what it does not.

It exists because the brief's own rule is the right one:

> At every stage ask: "Does this use real data, real geometry, real
> computation, or is it merely pretending?" If it is pretending, either
> implement it properly or clearly label it as simulation/demo.

Every claim below was checked against the files. Where the answer is "not
built", it says not built. A roadmap that reads as a feature list is how a
disaster platform ends up being trusted for something it cannot do.

---

## 1. What the audit found, and what was fixed

The audit ran before any of this session's changes. Seven defects were real,
silent, and would have shipped.

### Fixed

**Vulnerability scored 0.0 for every cell in the country.**
`VulnerabilityEngine` is fully implemented and unit-tested, and all six of its
terms need inputs — distance to shelter, travel time, distance to hospital,
independent routes out, road density, demographics. `orchestrator.py` supplied
none of them. Every term returned "input unavailable", `available_weight`
summed to zero, and the engine's final line returned `0.0`.

On a 0–1 scale where 1 means *harder to protect*, 0.0 is not silence. It is the
assertion that this is the easiest place in the district to evacuate. It then
entered the priority ranking as a real term carrying real weight, pushing
unmeasured places *down* the list — which is exactly the population an
evacuation is most likely to strand.

Three changes:

- `VulnerabilityEngine.compute()` now returns `score=None` when nothing was
  measurable, and says so in the explanation. `as_row()` carries `None` to the
  database as NULL.
- `PriorityEngine` treats a `None` term as absent: the term is dropped, the
  remaining weights are renormalised, and the *renormalised* weights are the
  ones displayed — so `verify()`, the audit that guarantees the explanation
  reconstructs the score, still passes. The rounding residue is given to the
  heaviest live term so the weights on screen sum to exactly 1.
- `orchestrator._accessibility()` now actually computes the four missing
  inputs: shelter and hospital distance via PostGIS KNN over the existing GiST
  indexes, blocked-route counts from `v_road_live`, and route redundancy from
  `RoadGraph.independent_routes()` — a method that existed, was documented as
  being "for the vulnerability engine", and had never been called by anything.

Route redundancy costs a Dijkstra per path per cell, so it is computed only for
cells whose risk already earns them a place in the ranking. Everywhere else the
term stays `None`. That is the point: unmeasured must remain unmeasured.

`tests/test_no_data.py` (11 tests) locks this down, including the case that
started it — an unmeasured cell must not rank below one measured as safe.

**The RAG assistant would have crashed on first use.**
`assistant/corpus.py`'s live half queried `cells`, `official_alerts` and
`source_health`. The schema has `spatial_cells`, `government_alerts` and
`data_sources`. Twenty-six identifiers were wrong, including columns
(`hand_m`, `risk_score`, `observed_at`, `effective_capacity`) that exist
nowhere. `tests/test_assistant.py` never imported the module, so nothing
caught it. All twenty-six are corrected against `sql/001_schema.sql`;
information the schema genuinely does not carry — degraded inputs on the risk
view, the shelter's binding constraint, the road reporter — is now omitted with
a sentence saying so, rather than selected from a column that does not exist.

**Five of seven hazards crash-looped every tick, forever.**
`orchestrator` derived its hazard list from the catalogue's *configured
sources* and ignored `settings.mvp_hazards`. With no credentials at all that
yields seven hazards. `FeatureBuilder` defines feature sets for two and raises
`ValueError` for the rest — caught by a generic handler and logged as
"recompute failed", every tick, indefinitely. The orchestrator now intersects
with `FEATURE_SETS` and logs the excluded hazards by name rather than dropping
them silently.

**Hazard-aware routing was inert.**
`edge_hazard()` prices a road by the risk of the cells it crosses, reading
`roads.cell_ids`. The OSM connector never wrote that column and no back-fill
existed, so the array was empty for every road in every deployment,
`edge_hazard()` returned 0.0 every time, and `hazard_alpha=3.0` — the entire
reason the router exists rather than a plain shortest path — did nothing.
Routes avoided *blocked* roads, because live road state is a separate term, but
would have sent people straight through a cell scored 95 for flood.
`spatial/grid.link_roads_to_cells()` now populates it, idempotently, whenever
the graph is rebuilt.

**Both containers ran the whole pipeline.**
`docker-compose.yml` sets `AAPDA_RUN_SCHEDULER=false` on `api` and `true` on
`worker`, with a comment explaining that running the scheduler in every replica
multiplies every external API call by the replica count. The setting did not
exist in `Settings`, so Pydantic's `extra="ignore"` swallowed it and
`main.py` started the orchestrator unconditionally. Every external API was
being polled twice. Declared and honoured.

**The WebSocket hub never received its Redis URL.**
`Hub.__init__` takes `redis_url`; the module-level singleton was `Hub()`.
`settings.redis_url` was correctly configured and never passed. The hub always
ran single-node, which in the shipped two-container topology means no client
connected to `api` would ever receive an event published by `worker`. Now
`Hub(settings.redis_url)`.

**Login lockout was split across two uvicorn workers.**
`LoginGuard`, `StepUp` and the rate limiter are in-process dicts. The Dockerfile
ran `--workers 2`, so an attacker got two independent attempt budgets and a
step-up confirmed on one worker was invisible to the other. The docstring
promised `bind_redis`, which does not exist anywhere in the repository.

Reduced to one worker, with the reasoning written into the Dockerfile as a
security boundary rather than a tuning knob, and the false docstring removed.
Concurrency comes from replicas, which are reached through a load balancer that
applies its own limits. Moving this state behind Redis is the correct fix and
is **not done** — until it is, the single-worker constraint is load-bearing.

### Found, not fixed — and why

**There is no way to train a model.** `ml/pipeline.py` is genuinely good:
forward-chained temporal split with a 72-hour embargo, isotonic calibration on
a later window, recall-floor threshold selection, a mandatory logistic-regression
baseline gate before promotion. Nothing in the repository ever calls `fit()`,
`save()` or `promote()`. There is no `scripts/train.py`. On a fresh deployment
`model_versions` is empty, `RiskEngine.compute()` short-circuits on a `None`
probability, and every `risk_scores.score` is `-1` (`no_data`) forever.

This is honest — the platform reports "no model output" rather than inventing
one — but it means **the ML half of the backend has never run end to end**, and
no accuracy figure in this repository has been measured on real outcomes. The
numbers on the Model Monitoring screen are illustrative and the screen should
say so; it currently does not, and that is a defect.

**No Alembic migrations.** `alembic` is pinned in `requirements.txt` and there
is no `alembic/` directory. Schema changes have no versioned path, only
"re-run the idempotent SQL".

**No integration tests.** 224 unit tests pass and cover the pure logic
thoroughly. Zero tests import `orchestrator`, `api.routes`, `main`, `db`,
`ws.hub`, `assistant.corpus`, `ml.pipeline`, `spatial.grid`, or any connector.
There is no `TestClient` anywhere. Both the corpus schema bug and the hazard-set
crash loop were invisible to the suite by construction.

**Scripts referenced but absent.** `.env.example` points at
`scripts/provision.sh` for staging the WorldPop raster; `README.md` points at
`scripts/load_osm.py`. Neither exists. `infra/` and top-level `scripts/` are
empty directories.

**`enrich_hydrology()` has a placeholder.** `SELECT geom FROM roads WHERE FALSE`
never returns a row. There is no river centreline layer anywhere in the
repository, so `dist_to_river_m` is derived only from NRSC water observations
that nothing currently ingests at scale.

---

## 2. Real-time data ingestion — what is actually live

`frontend/standalone/src/livedata.js` fetches from three keyless, CORS-enabled
services directly from the browser, with no backend and no API key:

| Service | What it gives | Cadence | Stale after |
|---|---|---|---|
| Open-Meteo forecast | rain over 24 h / 72 h / 7 d, daily max temperature, wind gusts, CAPE — **all 36 states in one request** (the API accepts comma-separated coordinates) | 15 min | 90 min |
| Open-Meteo flood (GloFAS v4) | ECMWF river discharge at ~5 km, compared against each river's own 30-day median | 6 h | 36 h |
| USGS FDSN | every M2.5+ event in the Indian region over 7 days; M4.5+ worldwide for the world layer | 5 min | 60 min |

Derivations follow the thresholds the risk engine documents — IMD's 64.5 /
115.6 / 204.5 mm bands for rainfall, antecedent rain against slope for
landslide, discharge against its own median for river state, 40 °C for
heatwave. CAPE is used as a lightning **proxy** and labelled as one everywhere
it appears; it says the atmosphere could produce a storm, not that one happened.

**Honesty properties, each with a test in `test/livedata.spec.mjs` (60 checks):**

- A failed fetch leaves the modelled figure in place and marks the source
  failed. It never keeps showing the last reading as current, and never
  substitutes zero.
- An observed figure is *anchored*: the simulated drift generator asks
  `liveAnchored()` before touching any number and leaves measurements alone.
  When the reading ages out of its window, the model takes the surface back —
  the screen does not freeze on a number nobody is standing behind.
- `provenance()` returns `live` only when **all three** services are inside
  their windows. One service reporting out of three is `partial`, because the
  weather service alone carries seven of the nine hazards and "Live" over a
  mostly-modelled board is the exact dishonesty the file exists to prevent.
- The live badge renders `provenance()` and nothing else. It cannot say "Live"
  because a recompute loop ran fast.

### The limitation that matters most

**Observations are sampled at one representative point per state**, not per
cell and not per district. `STATE_POINT` holds 36 coordinates. Uttarakhand's
rainfall is measured at 30.35 N, 79.40 E and applied to the whole state, then
spread across the 25-cell grid using each cell's existing terrain offset.

That is a real observation honestly propagated, and it is **not** a
distributed observation network. A cloudburst 60 km from the sample point will
not appear. Fixing it properly means per-cell ingestion through the backend
connectors, which exist and are good — this browser-side path is what works
with no server at all.

### The other limitation: the preview sandbox

A published preview frame blocks outbound requests to third-party APIs at the
Content-Security-Policy level, before a request is made. **Inside such a frame
no live data can reach the page at all**, and the badge reads
"Modelled — preview sandbox" with an explanation. Open the file directly, or
serve it, and the same code fetches all three services. This distinction is
detected and stated rather than left to look like a network fault.

---

## 3. The geographic hierarchy — what is real geometry

```
World  →  Country  →  State / UT  →  District  →  Basin  →  H3 cell
 ✅         ✅            ✅             ⚠️          ❌         ✅
```

| Layer | Coverage | Resolution | Source | Honest status |
|---|---|---|---|---|
| Countries | Global, 177 | 1:110m, rounded to 0.01° | Natural Earth 4.1.0 Admin 0, public domain, via world-atlas | **Real geometry.** Decoded from TopoJSON at build time by `tools/build-world.js`. Bounds verified against independent geography in `test/geo.spec.mjs`. |
| States / UTs | India, 36 | Generalised | Bundled outlines | Real but simplified for display; not cadastral. |
| Districts | India | Named only | State rosters | Named district lists are real; **no district polygons are bundled.** |
| Basins / valleys | — | **No polygon** | Not bundled | **Not built.** See below. |
| H3 cells | Open state | res 7 (≈5.16 km²) | H3 tiling | Real tiling; attributes are terrain-derived. |

### Valleys and basins: deliberately not drawn

The brief asks for valley-level intelligence and, in the same breath, says
*"Do NOT invent valley boundaries."* Those two instructions resolve in only one
direction.

HydroBASINS / HydroSHEDS is the right dataset, is freely licensed, and is not
redistributed on npm — the only network this build environment can reach. So
this build ships **no basin or valley polygons at all**, and the map does not
draw an outline it does not have. Basins appear as named entities with their
real river and the districts they cross.

An approximated catchment is not a cosmetic shortcut. An evacuation drawn
against an invented watershed sends people the wrong way up a valley. The
layer metadata (`GEO_LAYERS.basin`) states `resolution: 'Named entity — NO
POLYGON'` on screen, names HydroBASINS as the dataset that would supply one,
and a test asserts that it does.

### The world layer claims nothing it does not have

176 of 177 countries render as plain geometry with **no risk shading**, because
nobody is monitoring them. A test counts distinct fill colours and fails if the
map starts shading risk it does not have. Clicking any uncovered country says,
in words: *no operational register — no cells, shelters, roads or evacuation
routing.*

The one genuinely live thing at world scale is **seismicity**: USGS publishes
every M4.5+ event worldwide and allows a direct call, so those are drawn at
their real coordinates, sized by magnitude, faded by age. When that fetch
fails, zero events are drawn and the tooltip says the feed is not reaching the
browser — it does not show yesterday's earthquakes as today's.

The projection is plate carrée (`x = lon`, `y = −lat`), named on screen because
at world zoom it stretches Greenland and Siberia badly and anyone reading area
off the map should know that first.

---

## 4. The brief, section by section

Marked against what is in the repository now.

| § | Item | Status |
|---|---|---|
| 1 | Repository audit | **Done** — §1 above |
| 2 | Map as the central product | Partial — the map is the primary screen; it is not yet full-bleed |
| 3 | Hierarchical global map | Partial — World→Country→State→Cell works; district and basin levels do not |
| 4 | Valley-level intelligence | **Not built** — deliberately, §3 above |
| 5 | Vector tiles / PMTiles pipeline | **Not built** |
| 6 | MapLibre GL renderer | **Not built** — see §5 below |
| 7 | Operations-centre layout | Partial |
| 8 | Normalised event model | Backend only (`disaster_events`, `hazard_observations`) |
| 9 | Provider abstraction | **Done, backend** — `ingestion/base.py`, 15 connectors, circuit breaker, honest `NOT_CONFIGURED` |
| 10 | Live update without refresh | **Done** — browser ingestion + WS client; the hub's Redis fanout is now wired |
| 11 | Time control / historical replay | **Not built** — `app/replay/` is an empty package |
| 12 | Continuous risk surfaces | Partial — H3 fill by score; no contours |
| 13 | Risk panel | **Done** for cells and states |
| 14 | Valley dashboard | **Not built** (follows §4) |
| 15 | Layer toggles | Partial — hazard layers yes; hydrology layers do not exist |
| 16 | Geographic search | Partial — states, districts, cells, shelters; not global |
| 17 | Drill-down at every level | Partial — see §3 |
| 18 | Infrastructure intelligence | Backend real (OSM connector); frontend shows shelters, roads, hospitals |
| 19 | Evacuation mode | **Done** — optimiser, capacity-constrained assignment, hazard-weighted routing (now actually weighted) |
| 20 | Alert hierarchy, official vs model | **Done** — enforced visually everywhere, and the platform never labels a model output as an official warning |
| 21 | Data provenance | **Done** — every figure carries its source; `provenance()` drives the badge |
| 22 | No-data behaviour | **Done** — this is what §1's largest fix was about |
| 23 | ML productisation | Library done, **never executed** — no training entry point exists |
| 24 | Historical validation / lead time | **Not built** — the ten past disasters in the gallery are documented history, not a replay harness |
| 25 | System status | **Done** — Data Sources shows real fetch status, latency and error text |
| 26 | Performance | Partial — spatial indexes and KNN yes; no vector tiles, no caching layer |
| 27 | Frontend design | Done to a government-service register, not the dark command-centre aesthetic asked for |
| 28 | Public + Command modes | **Done** |
| 29 | RAG assistant | **Done** — BM25 + MMR + intent routing, honest refusals; the live-corpus half now queries a schema that exists |
| 30 | Map ↔ AI structured actions | **Not built** — the assistant answers but cannot drive the map |
| 31 | Dynamic legend | Partial |
| 32 | Accessibility | **Done** — text scaling, skip-to-content, screen-reader mode, non-colour-only severity, keyboard navigation |
| 33 | Security | **Done and improved** — see §1; XSS eliminated earlier and guarded by two probe suites |
| 34 | Observability | Backend done (structlog, Prometheus); no dashboard |
| 35 | Testing | Partial — 224 backend unit + 9 browser suites; **no integration tests** |
| 36 | Demo mode | Partial — the modelled surface is labelled but there is no explicit DEMO switch |
| 37 | Database design | **Done** — 32 tables, 3 views, full GiST/partial indexing; **no migrations** |
| 38 | Coverage metadata | **Done** — `GEO_LAYERS`, asserted by test |
| 39 | Startup sequence | Partial |
| 40 | Product home screen | Partial |
| 41 | Do not break existing features | **Held** — 224 backend + 9 browser suites pass |

---

## 5. The one architectural decision worth stating plainly

The brief asks for MapLibre GL, vector tiles, PMTiles and PostGIS-backed tile
generation. That is the right architecture for a served application, and the
backend already has the PostGIS half of it.

It is incompatible with the artefact this project currently ships: **one
self-contained HTML file that must render with no network at all.** Vector
tiles are, by definition, fetched. A published preview frame blocks those
fetches outright (§2), so a MapLibre basemap inside one would render as an
empty grey rectangle — a worse product than the SVG map that works.

So the map here is SVG over real bundled geometry, which works offline, in a
sandbox, and on a phone. Moving to MapLibre is the correct next step **for the
served deployment**, alongside the tile pipeline, and both are listed as not
built rather than half-built behind a loading spinner.

---

## 6. What to do next, in order of what it buys

1. **A training entry point** (`scripts/train.py`) so the ML half runs end to
   end at least once. Until then no accuracy claim in this repository has been
   measured, and the Model Monitoring screen should say so.
2. **Integration tests** — a `TestClient` suite over `api/routes.py` and a
   docker-compose smoke test. Both defects that would have taken production
   down were invisible to a unit suite.
3. **Alembic migrations**, before the schema changes again.
4. **HydroBASINS ingestion** — a loader plus the `basins` / `sub_basins` tables.
   This unlocks §4, §14 and the valley half of §17 together.
5. **Redis-backed lockout and rate limiting**, which removes the single-worker
   constraint that is currently a security boundary.
6. **Per-cell ingestion** through the existing backend connectors, replacing the
   one-point-per-state sampling described in §2.
7. **The tile pipeline and MapLibre**, for the served deployment.
