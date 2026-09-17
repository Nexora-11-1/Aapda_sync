# 01 · Architecture

## The shape of the system

```
                          INDIAN DATA SOURCES
   IMD          NDMA/SACHET        CWC          ISRO/NRSC      INCOIS    NCS
  weather      official alerts   rivers        satellite       ocean   seismic
     │              │              │               │             │        │
     └──────────────┴──────────────┴───────────────┴─────────────┴────────┘
                                   │
                          ┌────────▼────────┐
                          │ DATA INGESTION  │   one connector per source
                          │ fetch validate  │   retry · timeout · circuit breaker
                          │ normalize store │   provenance on every record
                          └────────┬────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
              STREAMING/LIVE                BATCH/HISTORICAL
              5–15 min cadence              one-off + replay
                    │                             │
                    └──────────────┬──────────────┘
                                   │
                          ┌────────▼────────┐
                          │ DATA VALIDATION │   range, coordinate, timestamp,
                          │ + QUALITY SCORE │   duplicate, staleness, anomaly
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │  PostgreSQL     │   raw observations, provenance,
                          │  + PostGIS      │   append-only operational state
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │    H3 GRID      │   res 7 operational (~5.2 km²)
                          │  spatial_cells  │   res 5 national rollup
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │    FEATURES     │   leakage-safe, as-of queries
                          └────────┬────────┘
                    ┌──────────────┴──────────────┐
                    │                             │
             HISTORICAL DATA                 LIVE DATA
                    │                             │
             MODEL TRAINING                  INFERENCE
             forward-chained                 every 15 min
                    └──────────────┬──────────────┘
                                   │
                          ┌────────▼────────┐
                          │   RISK ENGINE   │   probability × intensity ×
                          │                 │   corroboration; confidence
                          └────────┬────────┘   computed separately
                                   │
                          ┌────────▼────────┐
                          │ IMPACT / EXPOSURE│  footprint overlay, not p × pop
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │  VULNERABILITY  │   situational, explainable
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │ PRIORITY ENGINE │   6 weighted factors
                          │   MERGE SORT    │   O(n log n), stable
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │ CAPACITY ENGINE │   binding-constraint model
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │ ROUTING ENGINE  │   Dijkstra / A*, live edge state
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │   EVACUATION    │   priority-greedy with
                          │   OPTIMIZER     │   capacity reservation
                          └────────┬────────┘
                                   │
                     ┌─────────────┴─────────────┐
                     │                           │
                REST API                    WEBSOCKET
                     └─────────────┬─────────────┘
                                   │
                          ┌────────▼────────┐
                          │  LIVE GIS MAP   │
                          │   DASHBOARD     │
                          └─────────────────┘
```

## Process topology

Three long-running processes, deliberately separated:

| Process | Replicas | Owns |
|---|---|---|
| `api` | N (behind a load balancer) | HTTP, WebSocket fan-out, auth |
| `worker` | **exactly 1** | ingestion, inference, risk, priority, routing |
| `db` / `cache` | 1 + replicas | PostGIS, Redis pub/sub |

The worker count is one and not one-per-replica. Every API replica running its
own scheduler would multiply each external call by the replica count — which is
how a platform gets rate-limited by IMD on the day it matters most. The API
replicas all publish to and receive from Redis, so an event computed by the
single worker reaches every connected dashboard regardless of which replica it
is attached to.

## Why Redis and not Kafka (§5)

§5 asks explicitly not to introduce Kafka if the MVP does not need it, while
keeping the door open. The MVP's peak event volume is a few thousand messages
per tick over one district — three orders of magnitude below where Kafka's
partitioning and replay start earning their operational cost.

The abstraction is `app/ws/hub.py`, which publishes to a channel and fans out to
subscribers. Swapping the transport is one class, not a rewrite. Kafka becomes
the right answer when: more than ~20 districts are live, or replay of the live
event stream (not just historical files) is needed, or a second consumer group
appears — for instance a state-level aggregator reading the same events.

## Failure posture (§28)

The platform is designed around external sources being unreliable, because they
are. Four rules, enforced in code rather than documented as intent:

1. **A failed source never takes down the platform.** Every connector stage is
   wrapped; failure produces a `RunResult`, not an exception.
2. **Stale is never presented as live.** A source past its staleness window is
   marked `STALE`; every downstream response carries `data_freshness`.
3. **Degraded input reduces confidence, not silence.** A flood prediction made
   without CWC river level is still produced — flagged `degraded_inputs=['cwc']`
   and damped — because an empty map cannot be distinguished from a safe one.
4. **Readiness does not depend on source health.** `/readyz` fails only when the
   database is unreachable or the grid is unbuilt. Refusing traffic because IMD
   is down is worse than serving the last valid observation and saying so.

## Scaling path

| Stage | Change |
|---|---|
| One district → one state | Increase `mvp_district_codes`. The grid builder and orchestrator already iterate districts. |
| One state → India | Partition the worker by state (one worker per state, each with its own source subset). `spatial_cells` is already indexed by `state_code`. |
| More hazards | Add a feature set to `FEATURE_SETS`, a model to the registry, an intensity branch to `RiskEngine.intensity`. Nothing else changes — the risk → exposure → priority → routing chain is hazard-agnostic. |
| Heavier routing | Contraction hierarchies behind the same `RoadGraph` interface; the Dijkstra/A* call sites do not change. |
| Higher observation volume | TimescaleDB hypertables on the four observation tables; the queries are already time-ordered range scans. |
