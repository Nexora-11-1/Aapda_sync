-- ═══════════════════════════════════════════════════════════════════════
-- AapdaSync · PostgreSQL + PostGIS schema
-- Phase 1. Idempotent. Run order: 001_schema → 002_indexes → 003_seed_ref
--
-- Conventions
--   · every time-dependent table has observed_at (event time) AND
--     ingested_at (receipt time). They are never conflated — a late-synced
--     observation is placed at its observed_at, exactly as EchoTrace does.
--   · every externally-sourced row carries full provenance (§4).
--   · geometry is EPSG:4326. Distance work casts to geography or uses
--     the metric CRS 7755 (WGS84 / India NSF LCC) where planar maths is
--     needed. Never compare degrees to metres.
-- ═══════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── enumerations ──────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE hazard_type AS ENUM (
    'flood','landslide','earthquake','cyclone','wildfire',
    'heatwave','drought','lightning','tsunami','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE risk_level AS ENUM ('low','medium','high','critical','no_data');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE quality_status AS ENUM ('good','degraded','suspect','stale','missing');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE source_status AS ENUM ('live','degraded','stale','failed','not_configured');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE operator_role AS ENUM (
    'public','field_operator','shelter_operator','district_operator','admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE road_state AS ENUM (
    'open','slow','partially_blocked','blocked','flooded','landslide','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE shelter_state AS ENUM ('open','full','closed','standby','compromised');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · SOURCE REGISTRY AND DATA QUALITY  (§3, §26, §28)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS data_sources (
  key                 TEXT PRIMARY KEY,               -- 'imd', 'sachet', 'cwc' …
  authority           TEXT        NOT NULL,
  access_mode         TEXT        NOT NULL,           -- public|feed|credentialed|manual
  is_primary          BOOLEAN     NOT NULL DEFAULT TRUE,
  base_url            TEXT,                           -- from config, mirrored here for audit
  docs_url            TEXT,
  status              source_status NOT NULL DEFAULT 'not_configured',
  last_success_at     TIMESTAMPTZ,
  last_attempt_at     TIMESTAMPTZ,
  last_error          TEXT,
  consecutive_failures INT        NOT NULL DEFAULT 0,
  -- an observation older than this is not "live" any more
  staleness_threshold_s INT       NOT NULL DEFAULT 3600,
  quality_score       NUMERIC(4,3),                   -- 0.000 – 1.000, §26
  notes               TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- rolling per-fetch quality record; feeds data_sources.quality_score
CREATE TABLE IF NOT EXISTS ingestion_runs (
  id              BIGSERIAL PRIMARY KEY,
  source_key      TEXT        NOT NULL REFERENCES data_sources(key),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  ok              BOOLEAN,
  http_status     INT,
  records_fetched INT         NOT NULL DEFAULT 0,
  records_stored  INT         NOT NULL DEFAULT 0,
  records_rejected INT        NOT NULL DEFAULT 0,
  reject_reasons  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  quality_score   NUMERIC(4,3),
  error           TEXT,
  duration_ms     INT
);

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · ADMINISTRATIVE + SPATIAL BACKBONE  (§6)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS admin_states (
  code        TEXT PRIMARY KEY,          -- 'UT', 'AS' … matches frontend map ids
  name        TEXT NOT NULL,
  lgd_code    INT,                       -- Local Government Directory code
  geom        geometry(MultiPolygon,4326)
);

CREATE TABLE IF NOT EXISTS admin_districts (
  code        TEXT PRIMARY KEY,
  state_code  TEXT NOT NULL REFERENCES admin_states(code),
  name        TEXT NOT NULL,
  lgd_code    INT,
  geom        geometry(MultiPolygon,4326)
);

CREATE TABLE IF NOT EXISTS admin_tehsils (
  code          TEXT PRIMARY KEY,
  district_code TEXT NOT NULL REFERENCES admin_districts(code),
  name          TEXT NOT NULL,
  geom          geometry(MultiPolygon,4326)
);

-- The H3 grid. One row per cell. Static attributes only — anything that
-- changes with time lives in an observation or score table.
CREATE TABLE IF NOT EXISTS spatial_cells (
  cell_id           TEXT PRIMARY KEY,              -- H3 index, hex string
  resolution        SMALLINT     NOT NULL,
  centroid          geometry(Point,4326)   NOT NULL,
  geom              geometry(Polygon,4326) NOT NULL,
  area_km2          NUMERIC(10,4),

  state_code        TEXT REFERENCES admin_states(code),
  district_code     TEXT REFERENCES admin_districts(code),
  tehsil_code       TEXT REFERENCES admin_tehsils(code),

  -- terrain (from DEM, §8)
  elevation_m           NUMERIC(7,1),
  elevation_min_m       NUMERIC(7,1),
  elevation_max_m       NUMERIC(7,1),
  slope_deg             NUMERIC(5,2),
  aspect_deg            NUMERIC(5,1),
  terrain_ruggedness    NUMERIC(7,3),
  curvature             NUMERIC(8,4),

  -- hydrology
  dist_to_river_m       NUMERIC(9,1),
  dist_to_coast_m       NUMERIC(10,1),
  height_above_river_m  NUMERIC(7,1),        -- HAND, the flood discriminator
  upstream_area_km2     NUMERIC(10,2),
  drainage_density      NUMERIC(7,4),

  -- surface
  land_cover_class      TEXT,
  ndvi_baseline         NUMERIC(4,3),
  soil_type             TEXT,
  soil_depth_cm         NUMERIC(6,1),
  lithology             TEXT,
  built_up_fraction     NUMERIC(4,3),

  -- exposure (§11)
  population            INT,
  population_density    NUMERIC(10,2),
  households            INT,
  road_length_m         NUMERIC(10,1),
  building_count        INT,

  -- static hazard susceptibility (long-run, not the live score)
  flood_susceptibility      NUMERIC(4,3),
  landslide_susceptibility  NUMERIC(4,3),
  seismic_zone              SMALLINT,        -- IS 1893 zone II–V

  enriched_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- k-ring adjacency, materialised so routing/aggregation need not call H3 in SQL
CREATE TABLE IF NOT EXISTS cell_neighbours (
  cell_id      TEXT NOT NULL REFERENCES spatial_cells(cell_id) ON DELETE CASCADE,
  neighbour_id TEXT NOT NULL REFERENCES spatial_cells(cell_id) ON DELETE CASCADE,
  k            SMALLINT NOT NULL DEFAULT 1,
  PRIMARY KEY (cell_id, neighbour_id)
);

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · OBSERVATIONS  (§8) — every row carries provenance
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS weather_observations (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT        NOT NULL REFERENCES data_sources(key),
  source_id       TEXT,                              -- station id / upstream pk
  observed_at     TIMESTAMPTZ NOT NULL,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  quality         quality_status NOT NULL DEFAULT 'good',

  cell_id         TEXT REFERENCES spatial_cells(cell_id),
  location        geometry(Point,4326),
  station_name    TEXT,

  temp_c              NUMERIC(5,2),
  temp_min_c          NUMERIC(5,2),
  temp_max_c          NUMERIC(5,2),
  humidity_pct        NUMERIC(5,2),
  pressure_hpa        NUMERIC(7,2),
  wind_speed_ms       NUMERIC(6,2),
  wind_gust_ms        NUMERIC(6,2),
  wind_dir_deg        NUMERIC(5,1),
  rainfall_mm         NUMERIC(7,2),          -- for the interval this row covers
  interval_minutes    INT,
  cloud_cover_pct     NUMERIC(5,2),
  soil_moisture_frac  NUMERIC(4,3),
  raw                 JSONB,

  UNIQUE (source, source_id, observed_at)
);

CREATE TABLE IF NOT EXISTS river_observations (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT        NOT NULL REFERENCES data_sources(key),
  source_id       TEXT,
  observed_at     TIMESTAMPTZ NOT NULL,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  quality         quality_status NOT NULL DEFAULT 'good',

  cell_id         TEXT REFERENCES spatial_cells(cell_id),
  location        geometry(Point,4326),
  station_name    TEXT,
  river_name      TEXT,

  level_m               NUMERIC(8,3),
  warning_level_m       NUMERIC(8,3),
  danger_level_m        NUMERIC(8,3),
  hfl_m                 NUMERIC(8,3),        -- highest flood level on record
  discharge_cumecs      NUMERIC(11,2),
  level_change_1h_m     NUMERIC(7,3),
  level_change_6h_m     NUMERIC(7,3),
  trend                 TEXT,                -- rising|steady|falling
  raw                   JSONB,

  UNIQUE (source, source_id, observed_at)
);

CREATE TABLE IF NOT EXISTS seismic_events (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT        NOT NULL REFERENCES data_sources(key),
  source_id       TEXT        NOT NULL,
  observed_at     TIMESTAMPTZ NOT NULL,        -- origin time
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  quality         quality_status NOT NULL DEFAULT 'good',

  epicentre       geometry(Point,4326) NOT NULL,
  cell_id         TEXT REFERENCES spatial_cells(cell_id),
  magnitude       NUMERIC(4,2),
  magnitude_type  TEXT,
  depth_km        NUMERIC(7,2),
  place           TEXT,
  felt_reports    INT,
  raw             JSONB,

  UNIQUE (source, source_id)
);

CREATE TABLE IF NOT EXISTS satellite_observations (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT        NOT NULL REFERENCES data_sources(key),
  source_id       TEXT,
  observed_at     TIMESTAMPTZ NOT NULL,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  quality         quality_status NOT NULL DEFAULT 'good',

  cell_id         TEXT REFERENCES spatial_cells(cell_id),
  geom            geometry(Geometry,4326),
  product         TEXT NOT NULL,         -- 'inundation','ndvi','thermal_anomaly','burn_scar'
  value           NUMERIC(12,4),
  unit            TEXT,
  instrument      TEXT,
  raw             JSONB
);

-- ═══════════════════════════════════════════════════════════════════════
-- 4 · OFFICIAL ALERTS AND DISASTER EVENTS  (§8)
-- Government alerts are kept apart from model output on purpose (§32.7).
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS government_alerts (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT        NOT NULL REFERENCES data_sources(key),
  source_id       TEXT        NOT NULL,          -- CAP identifier
  issuing_authority TEXT      NOT NULL,          -- kept verbatim, always displayed
  observed_at     TIMESTAMPTZ NOT NULL,          -- CAP <sent>
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,

  hazard          hazard_type,
  cap_event       TEXT,
  severity        TEXT,        -- CAP: Extreme|Severe|Moderate|Minor|Unknown
  urgency         TEXT,
  certainty       TEXT,
  headline        TEXT,
  description     TEXT,
  instruction     TEXT,
  area_desc       TEXT,
  geom            geometry(Geometry,4326),
  language        TEXT DEFAULT 'en',
  web_url         TEXT,
  raw             JSONB,

  UNIQUE (source, source_id)
);

CREATE TABLE IF NOT EXISTS disaster_events (
  event_id        TEXT PRIMARY KEY,
  hazard          hazard_type NOT NULL,
  declared_at     TIMESTAMPTZ NOT NULL,
  start_time      TIMESTAMPTZ,
  end_time        TIMESTAMPTZ,
  severity        risk_level  NOT NULL DEFAULT 'medium',
  centroid        geometry(Point,4326),
  geom            geometry(Geometry,4326),
  state_code      TEXT REFERENCES admin_states(code),
  district_code   TEXT REFERENCES admin_districts(code),
  source          TEXT REFERENCES data_sources(key),
  confidence      NUMERIC(4,3),
  official_alert_id BIGINT REFERENCES government_alerts(id),
  headline        TEXT,
  notes           TEXT,
  is_historical   BOOLEAN NOT NULL DEFAULT FALSE,   -- true for replay/training records
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 5 · INFRASTRUCTURE  (§16 – §20)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS road_nodes (
  node_id     BIGINT PRIMARY KEY,          -- OSM node id where available
  geom        geometry(Point,4326) NOT NULL,
  cell_id     TEXT REFERENCES spatial_cells(cell_id)
);

CREATE TABLE IF NOT EXISTS roads (
  road_id       BIGINT PRIMARY KEY,        -- OSM way id
  name          TEXT,
  highway_class TEXT,                      -- motorway|trunk|primary|…|track
  from_node     BIGINT NOT NULL REFERENCES road_nodes(node_id),
  to_node       BIGINT NOT NULL REFERENCES road_nodes(node_id),
  geom          geometry(LineString,4326) NOT NULL,
  length_m      NUMERIC(10,2) NOT NULL,
  free_flow_kph NUMERIC(5,1)  NOT NULL DEFAULT 30,
  lanes         SMALLINT,
  capacity_pph  INT,                       -- persons per hour, for congestion
  bridge        BOOLEAN NOT NULL DEFAULT FALSE,
  oneway        BOOLEAN NOT NULL DEFAULT FALSE,
  min_elevation_m NUMERIC(7,1),
  cell_ids      TEXT[]                     -- cells this way passes through
);

-- Live edge state. Append-only; the routing engine reads the latest per road.
CREATE TABLE IF NOT EXISTS road_status (
  id            BIGSERIAL PRIMARY KEY,
  road_id       BIGINT NOT NULL REFERENCES roads(road_id),
  state         road_state NOT NULL,
  reason        TEXT,
  reported_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,
  location      geometry(Point,4326),
  source        TEXT NOT NULL,             -- 'field_operator' | 'sachet' | 'model'
  reported_by   TEXT,
  confidence    NUMERIC(4,3) NOT NULL DEFAULT 0.8,
  superseded    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS hospitals (
  hospital_id   TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  geom          geometry(Point,4326) NOT NULL,
  cell_id       TEXT REFERENCES spatial_cells(cell_id),
  district_code TEXT REFERENCES admin_districts(code),
  beds_total    INT,
  icu_total     INT,
  has_trauma    BOOLEAN NOT NULL DEFAULT FALSE,
  contact       TEXT,
  source        TEXT REFERENCES data_sources(key)
);

CREATE TABLE IF NOT EXISTS shelters (
  shelter_id      TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  geom            geometry(Point,4326) NOT NULL,
  cell_id         TEXT REFERENCES spatial_cells(cell_id),
  district_code   TEXT REFERENCES admin_districts(code),
  nearest_node    BIGINT REFERENCES road_nodes(node_id),
  building_type   TEXT,                    -- school|community hall|MPCS|…
  elevation_m     NUMERIC(7,1),
  max_capacity    INT NOT NULL,
  -- static resource ceilings; live values live in shelter_status
  water_capacity_lpd    INT,
  food_capacity_meals   INT,
  medical_capacity      INT,
  has_power_backup      BOOLEAN NOT NULL DEFAULT FALSE,
  accessible            BOOLEAN NOT NULL DEFAULT FALSE,
  contact               TEXT,
  managed_by            TEXT,
  source          TEXT REFERENCES data_sources(key)
);

-- Append-only operator updates (§19). Latest row wins.
CREATE TABLE IF NOT EXISTS shelter_status (
  id                  BIGSERIAL PRIMARY KEY,
  shelter_id          TEXT NOT NULL REFERENCES shelters(shelter_id),
  reported_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  reported_by         TEXT,
  state               shelter_state NOT NULL DEFAULT 'open',
  current_occupancy   INT NOT NULL DEFAULT 0,
  water_days_remaining      NUMERIC(5,2),
  food_days_remaining       NUMERIC(5,2),
  medical_staff_present     INT,
  beds_available            INT,
  special_resources         JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes               TEXT,
  superseded          BOOLEAN NOT NULL DEFAULT FALSE
);

-- ═══════════════════════════════════════════════════════════════════════
-- 6 · MODEL OUTPUT  (§9, §10, §25)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS model_versions (
  model_version   TEXT PRIMARY KEY,          -- 'flood-lgbm-v0.3.1'
  hazard          hazard_type NOT NULL,
  algorithm       TEXT NOT NULL,
  horizon_hours   INT  NOT NULL,
  trained_at      TIMESTAMPTZ NOT NULL,
  train_window    tstzrange,
  valid_window    tstzrange,
  feature_list    JSONB NOT NULL,
  hyperparams     JSONB NOT NULL DEFAULT '{}'::jsonb,
  metrics         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- roc_auc, pr_auc, brier, recall…
  calibration     JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active       BOOLEAN NOT NULL DEFAULT FALSE,
  artifact_path   TEXT,
  notes           TEXT
);

CREATE TABLE IF NOT EXISTS hazard_predictions (
  id              BIGSERIAL PRIMARY KEY,
  cell_id         TEXT NOT NULL REFERENCES spatial_cells(cell_id),
  hazard          hazard_type NOT NULL,
  model_version   TEXT NOT NULL REFERENCES model_versions(model_version),
  predicted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_from      TIMESTAMPTZ NOT NULL,
  valid_to        TIMESTAMPTZ NOT NULL,
  horizon_hours   INT NOT NULL,

  probability     NUMERIC(5,4) NOT NULL,
  level           risk_level   NOT NULL,
  confidence      NUMERIC(4,3) NOT NULL,      -- input-quality driven, not p
  feature_snapshot JSONB,                     -- what the model actually saw
  top_contributors JSONB,                     -- SHAP-style, for explainability
  degraded_inputs  TEXT[] NOT NULL DEFAULT '{}',
  -- outcome is written later by the evaluation job (§25)
  actual_outcome   BOOLEAN,
  outcome_recorded_at TIMESTAMPTZ,
  outcome_source   TEXT
);

CREATE TABLE IF NOT EXISTS risk_scores (
  id              BIGSERIAL PRIMARY KEY,
  cell_id         TEXT NOT NULL REFERENCES spatial_cells(cell_id),
  hazard          hazard_type NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  score           NUMERIC(5,2) NOT NULL,      -- 0–100, the map's number
  level           risk_level   NOT NULL,
  probability     NUMERIC(5,4),
  intensity       NUMERIC(6,3),
  confidence      NUMERIC(4,3) NOT NULL,
  time_to_impact_h NUMERIC(6,2),
  official_alert_id BIGINT REFERENCES government_alerts(id),
  components      JSONB NOT NULL DEFAULT '{}'::jsonb,
  prediction_id   BIGINT REFERENCES hazard_predictions(id)
);

CREATE TABLE IF NOT EXISTS exposure_scores (
  id              BIGSERIAL PRIMARY KEY,
  cell_id         TEXT NOT NULL REFERENCES spatial_cells(cell_id),
  hazard          hazard_type NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  population_total        INT     NOT NULL,
  population_in_footprint INT     NOT NULL,   -- spatial overlap, not p × pop
  expected_exposed        NUMERIC(12,2) NOT NULL,
  buildings_exposed       INT,
  road_length_exposed_m   NUMERIC(10,1),
  hospitals_exposed       INT,
  method          TEXT NOT NULL,              -- 'footprint_overlay_v1'
  components      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS vulnerability_scores (
  id              BIGSERIAL PRIMARY KEY,
  cell_id         TEXT NOT NULL REFERENCES spatial_cells(cell_id),
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  score           NUMERIC(5,4) NOT NULL,      -- 0–1
  components      JSONB NOT NULL DEFAULT '{}'::jsonb,
  explanation     TEXT[]  NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS relocation_priorities (
  id              BIGSERIAL PRIMARY KEY,
  cell_id         TEXT NOT NULL REFERENCES spatial_cells(cell_id),
  hazard          hazard_type NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  rank            INT NOT NULL,
  priority_score  NUMERIC(6,4) NOT NULL,
  band            risk_level NOT NULL,
  weights_version TEXT NOT NULL,
  terms           JSONB NOT NULL,             -- {hazard_risk: {raw, norm, w, contrib}, …}
  reasons         TEXT[] NOT NULL DEFAULT '{}',
  people_to_move  INT
);

CREATE TABLE IF NOT EXISTS priority_weights (
  version         TEXT PRIMARY KEY,
  weights         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT FALSE,
  notes           TEXT
);

CREATE TABLE IF NOT EXISTS evacuation_routes (
  id              BIGSERIAL PRIMARY KEY,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  origin_cell     TEXT NOT NULL REFERENCES spatial_cells(cell_id),
  shelter_id      TEXT NOT NULL REFERENCES shelters(shelter_id),
  hazard          hazard_type NOT NULL,
  people_assigned INT NOT NULL,
  distance_m      NUMERIC(10,1) NOT NULL,
  travel_time_s   NUMERIC(10,1) NOT NULL,
  hazard_exposure NUMERIC(6,4) NOT NULL,      -- integrated risk along the path
  algorithm       TEXT NOT NULL,              -- 'astar_hazard_weighted_v1'
  road_ids        BIGINT[] NOT NULL,
  geom            geometry(LineString,4326),
  feasible        BOOLEAN NOT NULL DEFAULT TRUE,
  infeasible_reason TEXT
);

-- ═══════════════════════════════════════════════════════════════════════
-- 7 · OPERATORS AND AUDIT  (§27)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS operators (
  operator_id     TEXT PRIMARY KEY,
  full_name       TEXT NOT NULL,
  role            operator_role NOT NULL DEFAULT 'public',
  organisation    TEXT,
  district_code   TEXT REFERENCES admin_districts(code),
  assigned_shelters TEXT[] NOT NULL DEFAULT '{}',
  password_hash   TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL PRIMARY KEY,
  at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  operator_id     TEXT REFERENCES operators(operator_id),
  role            operator_role,
  action          TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       TEXT,
  before          JSONB,
  after           JSONB,
  ip              INET,
  user_agent      TEXT
);

CREATE TABLE IF NOT EXISTS citizen_reports (
  report_id       TEXT PRIMARY KEY,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  category        TEXT NOT NULL,
  hazard          hazard_type,
  description     TEXT,
  location        geometry(Point,4326),
  cell_id         TEXT REFERENCES spatial_cells(cell_id),
  contact         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',   -- pending|verified|rejected|duplicate
  verified_by     TEXT REFERENCES operators(operator_id),
  verified_at     TIMESTAMPTZ,
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 0.4,
  media           JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- ═══════════════════════════════════════════════════════════════════════
-- 8 · REPLAY  (§31)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS replay_scenarios (
  scenario_id     TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  hazard          hazard_type NOT NULL,
  state_code      TEXT REFERENCES admin_states(code),
  district_code   TEXT REFERENCES admin_districts(code),
  real_start      TIMESTAMPTZ NOT NULL,
  real_end        TIMESTAMPTZ NOT NULL,
  tick_minutes    INT NOT NULL DEFAULT 15,
  description     TEXT,
  ground_truth_event TEXT REFERENCES disaster_events(event_id)
);

CREATE TABLE IF NOT EXISTS replay_runs (
  run_id          BIGSERIAL PRIMARY KEY,
  scenario_id     TEXT NOT NULL REFERENCES replay_scenarios(scenario_id),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  model_version   TEXT REFERENCES model_versions(model_version),
  speed_factor    NUMERIC(8,2) NOT NULL DEFAULT 60,
  ticks_completed INT NOT NULL DEFAULT 0,
  metrics         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'running'
);
