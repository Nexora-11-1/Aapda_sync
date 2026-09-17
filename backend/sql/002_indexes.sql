-- ═══════════════════════════════════════════════════════════════════════
-- AapdaSync · indexes (§23)
-- Indexed for the four access patterns the platform actually has:
--   1. "latest N observations for cell X"            → (cell_id, observed_at DESC)
--   2. "everything inside this polygon"              → GiST on geometry
--   3. "what is happening in district D right now"   → (district, computed_at DESC)
--   4. "latest state of shelter/road S"              → partial index on NOT superseded
-- ═══════════════════════════════════════════════════════════════════════

-- ── spatial ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_cells_geom       ON spatial_cells USING GIST (geom);
CREATE INDEX IF NOT EXISTS ix_cells_centroid   ON spatial_cells USING GIST (centroid);
CREATE INDEX IF NOT EXISTS ix_cells_district   ON spatial_cells (district_code);
CREATE INDEX IF NOT EXISTS ix_cells_state      ON spatial_cells (state_code);
CREATE INDEX IF NOT EXISTS ix_cells_res        ON spatial_cells (resolution);

CREATE INDEX IF NOT EXISTS ix_states_geom      ON admin_states    USING GIST (geom);
CREATE INDEX IF NOT EXISTS ix_districts_geom   ON admin_districts USING GIST (geom);
CREATE INDEX IF NOT EXISTS ix_districts_state  ON admin_districts (state_code);
CREATE INDEX IF NOT EXISTS ix_tehsils_geom     ON admin_tehsils   USING GIST (geom);

CREATE INDEX IF NOT EXISTS ix_neigh_cell       ON cell_neighbours (cell_id);

-- ── observations ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_wx_cell_time  ON weather_observations (cell_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS ix_wx_time       ON weather_observations (observed_at DESC);
CREATE INDEX IF NOT EXISTS ix_wx_source     ON weather_observations (source, observed_at DESC);
CREATE INDEX IF NOT EXISTS ix_wx_geom       ON weather_observations USING GIST (location);

CREATE INDEX IF NOT EXISTS ix_river_cell_time ON river_observations (cell_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS ix_river_time      ON river_observations (observed_at DESC);
CREATE INDEX IF NOT EXISTS ix_river_station   ON river_observations (station_name, observed_at DESC);
CREATE INDEX IF NOT EXISTS ix_river_geom      ON river_observations USING GIST (location);

CREATE INDEX IF NOT EXISTS ix_seis_time     ON seismic_events (observed_at DESC);
CREATE INDEX IF NOT EXISTS ix_seis_geom     ON seismic_events USING GIST (epicentre);
CREATE INDEX IF NOT EXISTS ix_seis_mag      ON seismic_events (magnitude DESC, observed_at DESC);

CREATE INDEX IF NOT EXISTS ix_sat_cell_time ON satellite_observations (cell_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS ix_sat_product   ON satellite_observations (product, observed_at DESC);
CREATE INDEX IF NOT EXISTS ix_sat_geom      ON satellite_observations USING GIST (geom);

-- ── alerts and events ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_alerts_time    ON government_alerts (observed_at DESC);
CREATE INDEX IF NOT EXISTS ix_alerts_hazard  ON government_alerts (hazard, observed_at DESC);
CREATE INDEX IF NOT EXISTS ix_alerts_geom    ON government_alerts USING GIST (geom);
CREATE INDEX IF NOT EXISTS ix_alerts_live    ON government_alerts (expires_at)
  WHERE expires_at IS NULL OR expires_at > now();

CREATE INDEX IF NOT EXISTS ix_events_hazard  ON disaster_events (hazard, declared_at DESC);
CREATE INDEX IF NOT EXISTS ix_events_geom    ON disaster_events USING GIST (geom);
CREATE INDEX IF NOT EXISTS ix_events_district ON disaster_events (district_code, declared_at DESC);
CREATE INDEX IF NOT EXISTS ix_events_hist    ON disaster_events (is_historical, declared_at DESC);

-- ── infrastructure ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_roads_geom     ON roads USING GIST (geom);
CREATE INDEX IF NOT EXISTS ix_roads_nodes    ON roads (from_node, to_node);
CREATE INDEX IF NOT EXISTS ix_roads_cells    ON roads USING GIN (cell_ids);
CREATE INDEX IF NOT EXISTS ix_nodes_geom     ON road_nodes USING GIST (geom);

-- latest-state lookups: only the live row per road is ever scanned
CREATE INDEX IF NOT EXISTS ix_roadstat_live  ON road_status (road_id, reported_at DESC)
  WHERE superseded = FALSE;

CREATE INDEX IF NOT EXISTS ix_shelters_geom  ON shelters USING GIST (geom);
CREATE INDEX IF NOT EXISTS ix_shelters_dist  ON shelters (district_code);
CREATE INDEX IF NOT EXISTS ix_shstat_live    ON shelter_status (shelter_id, reported_at DESC)
  WHERE superseded = FALSE;

CREATE INDEX IF NOT EXISTS ix_hosp_geom      ON hospitals USING GIST (geom);
CREATE INDEX IF NOT EXISTS ix_hosp_dist      ON hospitals (district_code);

-- ── model output ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_pred_cell      ON hazard_predictions (cell_id, hazard, predicted_at DESC);
CREATE INDEX IF NOT EXISTS ix_pred_time      ON hazard_predictions (predicted_at DESC);
CREATE INDEX IF NOT EXISTS ix_pred_model     ON hazard_predictions (model_version, predicted_at DESC);
CREATE INDEX IF NOT EXISTS ix_pred_valid     ON hazard_predictions (valid_from, valid_to);
-- the model-monitoring job's only query: scored predictions whose window has closed
CREATE INDEX IF NOT EXISTS ix_pred_pending_outcome ON hazard_predictions (valid_to)
  WHERE actual_outcome IS NULL;

CREATE INDEX IF NOT EXISTS ix_risk_cell      ON risk_scores (cell_id, hazard, computed_at DESC);
CREATE INDEX IF NOT EXISTS ix_risk_time      ON risk_scores (computed_at DESC);
CREATE INDEX IF NOT EXISTS ix_risk_level     ON risk_scores (level, computed_at DESC);

CREATE INDEX IF NOT EXISTS ix_exp_cell       ON exposure_scores (cell_id, hazard, computed_at DESC);
CREATE INDEX IF NOT EXISTS ix_vuln_cell      ON vulnerability_scores (cell_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS ix_prio_rank      ON relocation_priorities (computed_at DESC, rank);
CREATE INDEX IF NOT EXISTS ix_prio_cell      ON relocation_priorities (cell_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS ix_route_origin   ON evacuation_routes (origin_cell, computed_at DESC);
CREATE INDEX IF NOT EXISTS ix_route_shelter  ON evacuation_routes (shelter_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS ix_route_geom     ON evacuation_routes USING GIST (geom);

-- ── operations ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_audit_time     ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_operator ON audit_log (operator_id, at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_entity   ON audit_log (entity_type, entity_id, at DESC);

CREATE INDEX IF NOT EXISTS ix_reports_status ON citizen_reports (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS ix_reports_cell   ON citizen_reports (cell_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS ix_reports_geom   ON citizen_reports USING GIST (location);

CREATE INDEX IF NOT EXISTS ix_runs_source    ON ingestion_runs (source_key, started_at DESC);

-- ── convenience views the API leans on ────────────────────────────────
CREATE OR REPLACE VIEW v_shelter_live AS
SELECT s.*,
       st.reported_at, st.state, st.current_occupancy, st.water_days_remaining,
       st.food_days_remaining, st.medical_staff_present, st.beds_available,
       st.special_resources, st.reported_by,
       GREATEST(s.max_capacity - COALESCE(st.current_occupancy,0), 0) AS raw_available
FROM shelters s
LEFT JOIN LATERAL (
  SELECT * FROM shelter_status x
  WHERE x.shelter_id = s.shelter_id AND x.superseded = FALSE
  ORDER BY x.reported_at DESC LIMIT 1
) st ON TRUE;

CREATE OR REPLACE VIEW v_road_live AS
SELECT r.*,
       COALESCE(rs.state,'open'::road_state) AS current_state,
       rs.reason, rs.reported_at, rs.confidence AS state_confidence
FROM roads r
LEFT JOIN LATERAL (
  SELECT * FROM road_status x
  WHERE x.road_id = r.road_id AND x.superseded = FALSE
    AND (x.expires_at IS NULL OR x.expires_at > now())
  ORDER BY x.reported_at DESC LIMIT 1
) rs ON TRUE;

CREATE OR REPLACE VIEW v_cell_current_risk AS
SELECT DISTINCT ON (cell_id, hazard)
       cell_id, hazard, score, level, probability, confidence,
       time_to_impact_h, computed_at, components
FROM risk_scores
ORDER BY cell_id, hazard, computed_at DESC;
