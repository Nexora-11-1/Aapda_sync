# ── build stage ───────────────────────────────────────────────────────
FROM python:3.12-slim AS build

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

# Build-only toolchain. GDAL/GEOS/PROJ are needed by rasterio and shapely;
# they do not ship in the runtime image, which keeps it ~400 MB smaller.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential gcc g++ \
      libgeos-dev libproj-dev gdal-bin libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY requirements.txt .
RUN python -m venv /opt/venv && \
    /opt/venv/bin/pip install --upgrade pip setuptools wheel && \
    /opt/venv/bin/pip install -r requirements.txt

# ── runtime stage ─────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    PROMETHEUS_MULTIPROC_DIR=/tmp/prom

RUN apt-get update && apt-get install -y --no-install-recommends \
      libgeos-c1v5 libproj25 libgdal34 curl tini \
    && rm -rf /var/lib/apt/lists/*

# Never run as root. The model directory is the only writable path the
# application needs, and it is owned by the service account.
RUN groupadd --system --gid 10001 aapda && \
    useradd  --system --uid 10001 --gid aapda --create-home aapda && \
    mkdir -p /var/lib/aapdasync/models /tmp/prom && \
    chown -R aapda:aapda /var/lib/aapdasync /tmp/prom

COPY --from=build /opt/venv /opt/venv

WORKDIR /srv
COPY --chown=aapda:aapda app ./app
COPY --chown=aapda:aapda sql ./sql
COPY --chown=aapda:aapda scripts ./scripts

USER aapda
EXPOSE 8000

# tini reaps the zombie processes uvicorn's reloader and the scheduler
# can leave behind under SIGTERM.
ENTRYPOINT ["/usr/bin/tini", "--"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS http://localhost:8000/healthz || exit 1

# ONE worker per container, and horizontal scale is by replica count.
#
# This used to be 2, and that was a security defect rather than a tuning
# choice. Account lockout, per-address throttling and step-up confirmation are
# held in process memory (app/core/lockout.py, app/core/hardening.py). Two
# uvicorn workers means two independent copies of all three: an attacker gets
# double the login budget before either copy locks the account, and a step-up
# confirmed on one worker is invisible to the other. Until that state is moved
# behind Redis, the process count IS the security boundary — so it is one, and
# concurrency comes from replicas, which the same argument does not apply to
# because a replica is reached through the load balancer's own limits.
#
# The pipeline scheduler runs in the separate worker service (AAPDA_RUN_SCHEDULER),
# so external APIs are polled exactly once regardless of replica count.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*", \
     "--timeout-keep-alive", "65", "--access-log"]
