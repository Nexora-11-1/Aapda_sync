"""
Configuration. Every external URL and credential enters the process here and
nowhere else (§3.9 — never hardcode API keys; §34 — no fake endpoints in code).

A source whose `access` is `credentialed` and whose credential is absent is not
an error at boot: it is registered as NOT_CONFIGURED, and every downstream
consumer is told so. The platform runs without it and says that it is running
without it (§28).
"""
from __future__ import annotations

from enum import Enum
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AccessMode(str, Enum):
    PUBLIC = "public"            # open endpoint, no credential
    FEED = "feed"                # public feed (CAP/RSS), may be rate limited
    CREDENTIALED = "credentialed"  # registration / key / IP allow-list required
    MANUAL = "manual"            # no machine route; operator-entered


class SourceConfig(BaseSettings):
    """One external data source.

    `base_url` is required for anything we actually call. It is supplied by
    configuration and mirrored into `data_sources.base_url` for audit. There is
    deliberately no default for credentialed sources — a missing URL means the
    connector reports NOT_CONFIGURED rather than guessing a path.
    """
    key: str
    authority: str
    access: AccessMode
    is_primary: bool = True
    base_url: str | None = None
    docs_url: str | None = None
    api_key: str | None = None
    username: str | None = None
    password: str | None = None
    enabled: bool = True
    #: An open endpoint that still demands a free key. `access=PUBLIC` says
    #: "no registration bureaucracy"; this says "but you still need a token".
    #: Conflating the two makes a source look configured when it cannot call.
    requires_key: bool = False
    poll_seconds: int = 900
    timeout_seconds: float = 20.0
    max_retries: int = 3
    staleness_seconds: int = 3600
    rate_limit_per_minute: int = 30
    notes: str = ""

    @property
    def configured(self) -> bool:
        if not self.enabled:
            return False
        if self.access in (AccessMode.PUBLIC, AccessMode.FEED):
            return bool(self.base_url) and (not self.requires_key or bool(self.api_key))
        if self.access is AccessMode.MANUAL:
            return True          # operator-entered; nothing to call
        return bool(self.base_url) and bool(self.api_key or self.username)


# ── The register. URLs here are the ones verified in docs/10-data-sources.md.
#    Credentialed sources ship with base_url set (the documented portal) but no
#    key: they resolve to NOT_CONFIGURED until an operator supplies one. ──────
DEFAULT_SOURCES: dict[str, dict] = {
    # ---- primary, Indian authorities ------------------------------------
    "imd": dict(
        key="imd", authority="India Meteorological Department",
        access=AccessMode.CREDENTIALED,
        base_url="https://api.imd.gov.in",
        docs_url="https://api.imd.gov.in/public/api_reference.html",
        poll_seconds=900, staleness_seconds=3600,
        notes="Registration AND server IP whitelisting required. Attribution to IMD "
              "is mandatory. Cache client-side during peak events.",
    ),
    "sachet": dict(
        key="sachet", authority="NDMA — SACHET National Disaster Alert Portal",
        access=AccessMode.FEED,
        base_url="https://sachet.ndma.gov.in",
        docs_url="https://sachet.ndma.gov.in/docs/Integration_Guide_For_Agencies.pdf",
        poll_seconds=300, staleness_seconds=1800,
        notes="Official CAP alerts. We consume only; publishing requires NDMA onboarding. "
              "Issuing authority is preserved verbatim and always displayed.",
    ),
    "cwc": dict(
        key="cwc", authority="Central Water Commission",
        access=AccessMode.CREDENTIALED,
        base_url="https://indiawris.gov.in",
        docs_url="http://india-water.gov.in/ffs/",
        poll_seconds=1800, staleness_seconds=10800,
        notes="The FFS portal is a dashboard, not a documented public API. The "
              "machine-readable route must be agreed with CWC/NWIC before this "
              "connector fetches anything.",
    ),
    "nrsc": dict(
        key="nrsc", authority="ISRO / NRSC — Bhuvan",
        access=AccessMode.CREDENTIALED,
        base_url="https://bhuvan.nrsc.gov.in",
        docs_url="https://bhuvan.nrsc.gov.in/wiki/index.php/How_to_use_WMS_services",
        poll_seconds=3600, staleness_seconds=86400,
        notes="OGC WMS. Some layers open, disaster-services products need a Bhuvan account.",
    ),
    "incois": dict(
        key="incois", authority="INCOIS (Ministry of Earth Sciences)",
        access=AccessMode.PUBLIC,
        base_url="https://erddap.incois.gov.in/erddap",
        docs_url="https://erddap.incois.gov.in/erddap/rest.html",
        poll_seconds=1800, staleness_seconds=10800,
        notes="ERDDAP RESTful data server. Genuinely public.",
    ),
    "ncs": dict(
        key="ncs", authority="National Center for Seismology (MoES)",
        access=AccessMode.CREDENTIALED,
        base_url="https://seismo.gov.in",
        docs_url="https://seismo.gov.in/data-portal",
        poll_seconds=300, staleness_seconds=3600,
        notes="Data-portal registration required for the catalogue. USGS FDSN is the "
              "supplementary fallback and is labelled as such.",
    ),
    "sdma": dict(
        key="sdma", authority="State Disaster Management Authorities",
        access=AccessMode.MANUAL, poll_seconds=0,
        notes="No common API. Modelled as operator-entered shelter and road data.",
    ),
    # ---- supplementary, open --------------------------------------------
    "usgs": dict(
        key="usgs", authority="USGS FDSN event web service",
        access=AccessMode.PUBLIC, is_primary=False,
        base_url="https://earthquake.usgs.gov/fdsnws/event/1",
        docs_url="https://earthquake.usgs.gov/fdsnws/event/1/",
        poll_seconds=300, staleness_seconds=1800,
    ),
    "openmeteo": dict(
        key="openmeteo", authority="Open-Meteo", access=AccessMode.PUBLIC,
        is_primary=False,
        base_url="https://api.open-meteo.com/v1",
        docs_url="https://open-meteo.com/en/docs",
        poll_seconds=900, staleness_seconds=5400,
        notes="Stands in for IMD only when IMD is unavailable. Stored under its own "
              "source key; affected risk output is stamped degraded_inputs=['imd'].",
    ),
    "overpass": dict(
        key="overpass", authority="OpenStreetMap Overpass API",
        access=AccessMode.PUBLIC, is_primary=False,
        base_url="https://overpass-api.de/api",
        docs_url="https://wiki.openstreetmap.org/wiki/Overpass_API",
        poll_seconds=86400, staleness_seconds=604800, rate_limit_per_minute=2,
    ),
    "firms": dict(
        key="firms", authority="NASA FIRMS active fire",
        access=AccessMode.PUBLIC, is_primary=False,
        base_url="https://firms.modaps.eosdis.nasa.gov/api",
        docs_url="https://firms.modaps.eosdis.nasa.gov/api/",
        requires_key=True,
        poll_seconds=3600, staleness_seconds=21600,
        notes="Free MAP_KEY required; set AAPDA_SOURCE_FIRMS_API_KEY.",
    ),
    "opentopo": dict(
        key="opentopo", authority="OpenTopography global DEM",
        access=AccessMode.PUBLIC, is_primary=False,
        base_url="https://portal.opentopography.org/API",
        docs_url="https://portal.opentopography.org/apidocs/",
        requires_key=True,
        poll_seconds=0, staleness_seconds=31536000,
        notes="Free API key required. Used once per grid build, not polled.",
    ),
    "glofas": dict(
        key="glofas", authority="Open-Meteo Flood API (ECMWF GloFAS v4)",
        access=AccessMode.PUBLIC, is_primary=False,
        base_url="https://flood-api.open-meteo.com/v1",
        docs_url="https://open-meteo.com/en/docs/flood-api",
        poll_seconds=3600, staleness_seconds=21600,
        notes="Daily river discharge from GloFAS v4 at ~5 km. Stands in for CWC "
              "river level where CWC is not configured; stored under its own key "
              "and never presented as a CWC gauge reading.",
    ),
    "gdacs": dict(
        key="gdacs", authority="GDACS — Global Disaster Alert and Coordination System (JRC/UN)",
        access=AccessMode.PUBLIC, is_primary=False,
        base_url="https://www.gdacs.org/gdacsapi/api",
        docs_url="https://www.gdacs.org/gdacsapi/swagger/index.html",
        poll_seconds=900, staleness_seconds=7200,
        notes="Multi-hazard event feed: cyclone, flood, earthquake, drought, wildfire. "
              "Free, no key, max 100 records per query. Supplementary — GDACS is an "
              "international coordination feed, not an Indian statutory warning.",
    ),
    "worldpop": dict(
        key="worldpop", authority="WorldPop", access=AccessMode.PUBLIC,
        is_primary=False,
        base_url="https://data.worldpop.org",
        docs_url="https://www.worldpop.org/methods/",
        poll_seconds=0, staleness_seconds=31536000,
        notes="Bulk raster download. Used once per grid build.",
    ),
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AAPDA_", env_file=".env", env_nested_delimiter="__", extra="ignore"
    )

    app_name: str = "AapdaSync"
    environment: Literal["dev", "staging", "prod"] = "dev"
    debug: bool = False
    api_prefix: str = "/api"

    # ── storage ───────────────────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://aapda:aapda@localhost:5432/aapdasync"
    database_url_sync: str = "postgresql+psycopg://aapda:aapda@localhost:5432/aapdasync"
    redis_url: str = "redis://localhost:6379/0"
    pool_size: int = 10
    pool_max_overflow: int = 20

    # ── security (§27) ────────────────────────────────────────────────
    jwt_secret: str = Field(default="change-me-in-production", min_length=8)
    jwt_algorithm: str = "HS256"
    jwt_expiry_minutes: int = 720
    cors_origins: list[str] = ["http://localhost:3000"]

    # ── MVP scope (§29) ───────────────────────────────────────────────
    mvp_state_code: str = "UT"
    mvp_district_codes: list[str] = ["UT-CHAMOLI", "UT-RUDRAPRAYAG", "UT-PAURI"]
    mvp_hazards: list[str] = ["flood", "landslide"]
    # One process owns ingestion and analysis. Running the scheduler in every
    # API replica multiplies every external call by the replica count — which
    # is how a free public API bans you. docker-compose sets this false on
    # `api` and true on `worker`; without it declared here, Pydantic's
    # extra="ignore" swallowed the variable and BOTH ran the pipeline.
    run_scheduler: bool = True
    h3_resolution: int = 7          # ≈5.16 km² per cell — district-scale operations
    h3_resolution_coarse: int = 5   # ≈252 km² — state rollup

    # ── engine cadence ────────────────────────────────────────────────
    inference_interval_seconds: int = 900
    risk_interval_seconds: int = 900
    priority_interval_seconds: int = 900
    quality_interval_seconds: int = 300

    # ── model behaviour ───────────────────────────────────────────────
    active_priority_weights: str = "v1"
    min_prediction_confidence: float = 0.35
    # a prediction built on stale inputs is still produced, but flagged and damped
    stale_confidence_penalty: float = 0.45

    # ── message bus (§5 — Kafka is a later swap, not an MVP dependency) ─
    bus_backend: Literal["redis", "kafka"] = "redis"
    kafka_bootstrap_servers: str | None = None

    sources: dict[str, SourceConfig] = Field(default_factory=dict)

    @field_validator("sources", mode="before")
    @classmethod
    def _merge_sources(cls, v):
        merged = {k: dict(cfg) for k, cfg in DEFAULT_SOURCES.items()}
        for k, override in (v or {}).items():
            merged.setdefault(k, {"key": k}).update(
                override if isinstance(override, dict) else override.model_dump()
            )
        return {k: SourceConfig(**cfg) for k, cfg in merged.items()}

    def source(self, key: str) -> SourceConfig:
        if key not in self.sources:
            raise KeyError(
                f"Unknown source {key!r}. Add it to docs/10-data-sources.md and "
                f"DEFAULT_SOURCES before writing a connector for it."
            )
        return self.sources[key]


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if not s.sources:
        s.sources = {k: SourceConfig(**cfg) for k, cfg in DEFAULT_SOURCES.items()}
    return s


settings = get_settings()
