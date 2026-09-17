# 09 · Development Roadmap

Phases follow §30. Each row states what exists now, so the gap between built and
deployable is visible rather than implied.

| # | Phase | State | Where |
|---|---|---|---|
| 1 | Database + PostGIS | **Built** | `backend/sql/001_schema.sql`, `002_indexes.sql` — 24 tables, enums, 3 views, spatial and partial indexes |
| 2 | Indian geography + H3 layer | **Built** | `app/spatial/grid.py`, `scripts/build_grid.py`. Needs admin boundary geometry loaded |
| 3 | Historical ingestion | **Built** | Connector framework + batch path. Needs credentials per source |
| 4 | Live IMD ingestion | **Interface built, credential-gated** | `ingestion/imd/`. Open-Meteo covers the slot meanwhile, labelled |
| 5 | Live disaster alerts | **Built** | `ingestion/sachet/` — CAP 1.2 parser is real code; needs the feed path |
| 6 | Feature engineering | **Built** | `app/features/builder.py` — leakage-safe as-of queries with an `ingested_at` guard |
| 7 | Flood ML model | **Built** | `app/ml/pipeline.py`. Needs Indian training history to fit |
| 8 | Landslide ML model | **Built** | Same pipeline, own feature set |
| 9 | Risk engine | **Built + tested** | `app/risk/engine.py` |
| 10 | Population exposure | **Built + tested** | `app/impact/exposure.py` |
| 11 | Shelter / capacity engine | **Built + tested** | `app/capacity/engine.py` |
| 12 | Relocation priority engine | **Built + tested** | `app/priority/engine.py` |
| 13 | Merge sort | **Built + tested** | `app/priority/mergesort.py` — 10 tests incl. stability and bounds |
| 14 | Recursive spatial D&C | **Built + tested** | `app/spatial/quadtree.py` — 11 tests |
| 15 | Road routing | **Built + tested** | `app/routing/graph.py` — Dijkstra + A*, 10 tests |
| 16 | Evacuation optimisation | **Built** | `app/evacuation/optimizer.py` with a stated optimality gap |
| 17 | Live WebSocket dashboard | **Built** | `app/ws/hub.py`, `frontend/` — plus event-driven recompute |
| 18 | Historical replay | **Schema built, engine pending** | `replay_scenarios`, `replay_runs` tables exist |

## What is not built

Named explicitly so nobody discovers it during an event.

| Gap | Consequence | Effort |
|---|---|---|
| **Replay engine** (§31) | Cannot re-run a past disaster to validate the models end-to-end. The schema and the leakage-safe as-of query it needs both exist. | ~3 days |
| **Trained models** | The pipeline is complete; no Indian training set has been assembled, so no model is promoted. Until one is, risk endpoints return *no model output* rather than a fabricated score. | Weeks — data assembly, not code |
| **Admin boundary load** | The grid builder needs district geometry. Source it from the LGD/Survey of India dataset the state uses. | ~1 day |
| **Model monitoring job** | Predictions are stored with an `actual_outcome` column and a partial index; nothing writes the outcome back yet. | ~2 days |
| **Operator directory integration** | Operators live in a local table. Production needs the state's own identity provider. | ~1 week |
| **Kafka** | Not needed at MVP scale. `app/ws/hub.py` is the swap point. | ~1 week when >20 districts |

## Sequence to first real deployment

1. **Load boundaries and build the grid.** Nothing else works without it.
2. **Get SACHET.** It is the only source that produces *official warnings*, it is
   a public feed, and it is the highest-value single integration.
3. **Get IMD.** Registration plus IP whitelisting; start it early, it is the long
   pole.
4. **Stage WorldPop and a DEM.** Without population, exposure reports "unknown";
   without a DEM, the landslide model has no slope.
5. **Assemble training history.** Past events with dates and footprints for
   Chamoli. This gates the models, and it is the slowest step.
6. **Agree the CWC route.** River level is the strongest flood feature after
   rainfall. Until it exists, flood predictions are flagged degraded — honest,
   but weaker than they should be.
7. **Build the replay engine and validate** against a past event before anyone
   acts on a live number.
8. **Calibrate.** An uncalibrated 96% misleads an operator. The isotonic wrapper
   is in place and needs real outcomes.

Steps 1–4 are engineering. Steps 5–8 are the ones that decide whether the
platform is trustworthy, and they cannot be shortened by writing more code.
