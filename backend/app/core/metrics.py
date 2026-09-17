"""
Prometheus metrics.

The set is chosen so that the two questions an on-call engineer actually asks
during an event can be answered from the dashboard alone:

  1. Is the platform keeping up?      pipeline_tick_seconds, pipeline_lag_seconds
  2. Is it telling the truth?         source_staleness_seconds, degraded_predictions
"""
from __future__ import annotations

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
    multiprocess,
)

REGISTRY = CollectorRegistry()

# ── HTTP ──────────────────────────────────────────────────────────────
HTTP_REQUESTS = Counter(
    "aapda_http_requests_total", "HTTP requests",
    ["method", "path", "status"], registry=REGISTRY)
HTTP_LATENCY = Histogram(
    "aapda_http_request_seconds", "HTTP request latency",
    ["method", "path"], registry=REGISTRY,
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0))

# ── live dashboard ────────────────────────────────────────────────────
WS_CLIENTS = Gauge("aapda_ws_clients", "Connected dashboard clients", registry=REGISTRY)
WS_DROPPED = Counter("aapda_ws_dropped_total", "Messages dropped to slow clients",
                     registry=REGISTRY)

# ── ingestion ─────────────────────────────────────────────────────────
INGEST_RUNS = Counter("aapda_ingest_runs_total", "Ingestion runs",
                      ["source", "outcome"], registry=REGISTRY)
INGEST_RECORDS = Counter("aapda_ingest_records_total", "Records stored",
                         ["source"], registry=REGISTRY)
INGEST_DURATION = Histogram("aapda_ingest_seconds", "Ingestion duration",
                            ["source"], registry=REGISTRY,
                            buckets=(0.5, 1, 2, 5, 10, 30, 60, 120, 300))
SOURCE_STALENESS = Gauge("aapda_source_staleness_seconds",
                         "Seconds since a source last delivered data",
                         ["source", "is_primary"], registry=REGISTRY)
SOURCE_QUALITY = Gauge("aapda_source_quality_score", "Rolling data-quality score",
                       ["source"], registry=REGISTRY)

# ── pipeline ──────────────────────────────────────────────────────────
PIPELINE_TICK = Histogram("aapda_pipeline_tick_seconds", "Full pipeline tick duration",
                          ["stage"], registry=REGISTRY,
                          buckets=(0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600))
PIPELINE_LAG = Gauge("aapda_pipeline_lag_seconds",
                     "Age of the newest risk computation", registry=REGISTRY)
PIPELINE_ERRORS = Counter("aapda_pipeline_errors_total", "Pipeline stage failures",
                          ["stage"], registry=REGISTRY)

# ── model ─────────────────────────────────────────────────────────────
PREDICTIONS = Counter("aapda_predictions_total", "Predictions produced",
                      ["hazard", "level"], registry=REGISTRY)
DEGRADED_PREDICTIONS = Counter(
    "aapda_degraded_predictions_total",
    "Predictions produced with at least one degraded primary input",
    ["hazard"], registry=REGISTRY)
MODEL_CONFIDENCE = Histogram("aapda_prediction_confidence", "Prediction confidence",
                             ["hazard"], registry=REGISTRY,
                             buckets=(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0))
CELLS_SCORED = Gauge("aapda_cells_scored", "Cells with a current risk score",
                     ["hazard"], registry=REGISTRY)
CRITICAL_CELLS = Gauge("aapda_critical_cells", "Cells currently at critical risk",
                       ["hazard", "district"], registry=REGISTRY)

# ── DAA instrumentation — the quadtree's payoff, measured not asserted ─
QUADTREE_PRUNE_RATE = Gauge("aapda_quadtree_prune_rate",
                            "Fraction of internal nodes pruned by the homogeneity test",
                            registry=REGISTRY)
QUADTREE_SAMPLES = Histogram("aapda_quadtree_samples", "Samples taken per sweep",
                             registry=REGISTRY,
                             buckets=(100, 500, 1000, 5000, 10000, 50000, 100000))
ROUTE_SETTLED_NODES = Histogram("aapda_route_settled_nodes",
                                "Nodes settled per routing query", ["algorithm"],
                                registry=REGISTRY,
                                buckets=(10, 50, 100, 500, 1000, 5000, 20000))


def render_metrics() -> tuple[bytes, str]:
    try:
        registry = CollectorRegistry()
        multiprocess.MultiProcessCollector(registry)
        return generate_latest(registry), CONTENT_TYPE_LATEST
    except Exception:                              # noqa: BLE001 — single-process mode
        return generate_latest(REGISTRY), CONTENT_TYPE_LATEST
