/* Generated from backend/app/hazards/catalogue.py — do not edit by hand.
   Regenerate: cd backend && python scripts/export_catalogue.py */

const HAZ = {
  "flood": {
    "hazard": "flood",
    "name": "Flood",
    "live": true,
    "tier": "supplementary",
    "signal": "rainfall accumulation over 1–72 h, river discharge against its own climatology, and height above nearest drainage",
    "cadence_seconds": 900,
    "horizon_hours": 6,
    "sources_live": [
      "openmeteo",
      "glofas",
      "gdacs"
    ],
    "authoritative": [
      "imd",
      "cwc"
    ],
    "supplementary": [
      "openmeteo",
      "glofas",
      "gdacs",
      "nrsc"
    ],
    "degraded_inputs": [
      "imd",
      "cwc"
    ],
    "fidelity": "reanalysis rainfall at ~11 km + modelled discharge at ~5 km — not a gauge stage + event-level flood alerts only",
    "fidelity_by_source": {
      "imd": "station rainfall from the statutory network",
      "cwc": "surveyed gauge stage against a real danger level",
      "openmeteo": "reanalysis rainfall at ~11 km",
      "glofas": "modelled discharge at ~5 km — not a gauge stage",
      "gdacs": "event-level flood alerts only",
      "nrsc": "satellite inundation extent after the event, not a forecast"
    },
    "notes": "GloFAS gives modelled discharge at ~5 km, which is a different quantity from a CWC gauge stage reading and is labelled as such.",
    "ic": "M2 15c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M2 20c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2",
    "c": "#0B6BA8",
    "coastal_only": false
  },
  "landslide": {
    "hazard": "landslide",
    "name": "Landslide",
    "live": true,
    "tier": "supplementary",
    "signal": "antecedent precipitation index over 15 days against slope angle, curvature and soil depth",
    "cadence_seconds": 900,
    "horizon_hours": 24,
    "sources_live": [
      "openmeteo",
      "gdacs"
    ],
    "authoritative": [
      "imd",
      "nrsc"
    ],
    "supplementary": [
      "openmeteo",
      "opentopo",
      "gdacs"
    ],
    "degraded_inputs": [
      "imd",
      "nrsc"
    ],
    "fidelity": "rainfall trigger at ~11 km over a static slope layer + event-level landslide alerts only",
    "fidelity_by_source": {
      "imd": "station rainfall from the statutory network",
      "nrsc": "ISRO landslide inventory as the susceptibility prior",
      "openmeteo": "rainfall trigger at ~11 km over a static slope layer",
      "opentopo": "30 m DEM slope and curvature",
      "gdacs": "event-level landslide alerts only"
    },
    "notes": "Needs a DEM once, then rainfall continuously. The slope term is static; the trigger term is live.",
    "ic": "M3 20 10 8l4 6 3-4 4 10Z",
    "c": "#8A5A2B",
    "coastal_only": false
  },
  "earthquake": {
    "hazard": "earthquake",
    "name": "Earthquake",
    "live": true,
    "tier": "supplementary",
    "signal": "magnitude and depth attenuated over epicentral distance to an estimated PGA, weighted by IS 1893 seismic zone",
    "cadence_seconds": 120,
    "horizon_hours": 1,
    "sources_live": [
      "usgs",
      "gdacs"
    ],
    "authoritative": [
      "ncs"
    ],
    "supplementary": [
      "usgs",
      "gdacs"
    ],
    "degraded_inputs": [
      "ncs"
    ],
    "fidelity": "reviewed global solutions — adequate above about M4 + impact alerts only, no catalogue",
    "fidelity_by_source": {
      "ncs": "Indian statutory catalogue, densest station coverage",
      "usgs": "reviewed global solutions — adequate above about M4",
      "gdacs": "impact alerts only, no catalogue"
    },
    "notes": "USGS FDSN is public and reviewed, and covers India adequately for situational awareness. NCS remains the statutory catalogue and resolves smaller local events USGS does not.",
    "ic": "M2 12h3l2-6 4 13 3-9 2 4h6",
    "c": "#B3261E",
    "coastal_only": false
  },
  "cyclone": {
    "hazard": "cyclone",
    "name": "Cyclone",
    "live": true,
    "tier": "supplementary",
    "signal": "sustained wind and pressure from the track, distance from the centre, and coastal exposure",
    "cadence_seconds": 600,
    "horizon_hours": 48,
    "sources_live": [
      "gdacs",
      "openmeteo",
      "incois"
    ],
    "authoritative": [
      "imd"
    ],
    "supplementary": [
      "gdacs",
      "openmeteo",
      "incois"
    ],
    "degraded_inputs": [
      "imd"
    ],
    "fidelity": "track and alert level, no wind field + forecast wind at the coast only + sea state and storm surge at the coast",
    "fidelity_by_source": {
      "imd": "official track, radius of maximum wind and pressure field",
      "gdacs": "track and alert level, no wind field",
      "openmeteo": "forecast wind at the coast only",
      "incois": "sea state and storm surge at the coast"
    },
    "notes": "GDACS TC carries track and alert level for North Indian Ocean systems. IMD's own track remains the operational source.",
    "ic": "M12 12a4 4 0 1 0 4 4M21 8a9 9 0 0 0-9-4 9 9 0 0 0-8 5M3 16a9 9 0 0 0 9 4",
    "c": "#6B4FA8",
    "coastal_only": true
  },
  "wildfire": {
    "hazard": "wildfire",
    "name": "Wildfire",
    "live": true,
    "tier": "supplementary",
    "signal": "VIIRS thermal anomalies weighted by satellite confidence, against fuel moisture, NDVI and wind",
    "cadence_seconds": 3600,
    "horizon_hours": 24,
    "sources_live": [
      "gdacs"
    ],
    "authoritative": [
      "nrsc"
    ],
    "supplementary": [
      "firms",
      "gdacs"
    ],
    "degraded_inputs": [
      "nrsc"
    ],
    "fidelity": "coarse large-fire alerts only — no per-pixel detection",
    "fidelity_by_source": {
      "nrsc": "ISRO burn-scar and fire products",
      "firms": "per-pixel VIIRS thermal anomalies at 375 m",
      "gdacs": "coarse large-fire alerts only — no per-pixel detection"
    },
    "notes": "Runs keyless on GDACS large-fire alerts. A free NASA FIRMS MAP_KEY upgrades it to per-pixel VIIRS detection, which is the difference between knowing a district is burning and knowing which ridge.",
    "ic": "M12 22c4 0 6-3 6-6 0-4-4-5-3-9-3 1-4 4-4 6-1-1-1-3-1-4-2 2-4 4-4 7 0 3 2 6 6 6Z",
    "c": "#D2551A",
    "coastal_only": false
  },
  "heatwave": {
    "hazard": "heatwave",
    "name": "Heatwave",
    "live": true,
    "tier": "supplementary",
    "signal": "apparent temperature over consecutive days against the station normal, weighted by night-time minimum",
    "cadence_seconds": 1800,
    "horizon_hours": 72,
    "sources_live": [
      "openmeteo"
    ],
    "authoritative": [
      "imd"
    ],
    "supplementary": [
      "openmeteo"
    ],
    "degraded_inputs": [
      "imd"
    ],
    "fidelity": "30-day local mean standing in for a 30-year normal",
    "fidelity_by_source": {
      "imd": "station normals — the basis IMD declares heatwaves against",
      "openmeteo": "30-day local mean standing in for a 30-year normal"
    },
    "notes": "IMD's heatwave declaration is a departure from a local normal, not an absolute threshold. Open-Meteo supplies both.",
    "ic": "M12 3v2M12 19v2M5 12H3M21 12h-2M6 6 4.5 4.5M19.5 19.5 18 18M18 6l1.5-1.5M4.5 19.5 6 18M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    "c": "#A96700",
    "coastal_only": false
  },
  "drought": {
    "hazard": "drought",
    "name": "Drought",
    "live": true,
    "tier": "supplementary",
    "signal": "standardised precipitation index over 3, 6 and 12 months against the district's own long-period average",
    "cadence_seconds": 86400,
    "horizon_hours": 720,
    "sources_live": [
      "openmeteo",
      "gdacs"
    ],
    "authoritative": [
      "imd"
    ],
    "supplementary": [
      "openmeteo",
      "gdacs"
    ],
    "degraded_inputs": [
      "imd"
    ],
    "fidelity": "short-window precipitation z-score — an SPI proxy + continental drought alerts",
    "fidelity_by_source": {
      "imd": "long-period average for a true SPI",
      "openmeteo": "short-window precipitation z-score — an SPI proxy",
      "gdacs": "continental drought alerts"
    },
    "notes": "A slow hazard. Daily is ample; hourly would be noise.",
    "ic": "M4 18h16M6 14h12M8 10h8M12 3v3",
    "c": "#8A7B3B",
    "coastal_only": false
  },
  "lightning": {
    "hazard": "lightning",
    "name": "Lightning",
    "live": true,
    "tier": "supplementary",
    "signal": "convective available potential energy and lifted index as a storm-potential proxy",
    "cadence_seconds": 900,
    "horizon_hours": 6,
    "sources_live": [
      "openmeteo"
    ],
    "authoritative": [
      "imd"
    ],
    "supplementary": [
      "openmeteo"
    ],
    "degraded_inputs": [
      "imd"
    ],
    "fidelity": "CAPE-based storm potential — a proxy, not detection",
    "fidelity_by_source": {
      "imd": "actual strike detections from the lightning network",
      "openmeteo": "CAPE-based storm potential — a proxy, not detection"
    },
    "notes": "This is a PROXY, not a strike network. CAPE says the atmosphere could produce lightning; only IMD's detection network says it did. Output from this hazard is labelled accordingly.",
    "ic": "M13 2 4 14h7l-1 8 10-13h-8Z",
    "c": "#7A5AA8",
    "coastal_only": false
  },
  "tsunami": {
    "hazard": "tsunami",
    "name": "Tsunami",
    "live": true,
    "tier": "authoritative",
    "signal": "submarine earthquake magnitude and depth, then sea-level anomaly from the tide-gauge network",
    "cadence_seconds": 120,
    "horizon_hours": 6,
    "sources_live": [
      "incois",
      "usgs",
      "gdacs"
    ],
    "authoritative": [
      "incois"
    ],
    "supplementary": [
      "usgs",
      "gdacs"
    ],
    "degraded_inputs": [],
    "fidelity": "tide-gauge sea level and ITEWC bulletins + submarine earthquake parameters only + impact alerts only",
    "fidelity_by_source": {
      "incois": "tide-gauge sea level and ITEWC bulletins",
      "usgs": "submarine earthquake parameters only",
      "gdacs": "impact alerts only"
    },
    "notes": "Tsunami WARNINGS come from the Indian Tsunami Early Warning Centre and are never modelled here. This hazard supplies situational awareness only, and defers to ITEWC on every surface.",
    "ic": "M2 18c3 0 3-3 6-3s3 3 6 3 3-3 6-3M3 12c4-6 10-8 18-6",
    "c": "#0E6B7A",
    "coastal_only": true
  }
};

const SOURCE_REGISTRY = {
  "imd": {
    "authority": "India Meteorological Department",
    "access": "credentialed",
    "is_primary": true,
    "requires_key": false,
    "configured": false,
    "docs_url": "https://api.imd.gov.in/public/api_reference.html",
    "poll_seconds": 900
  },
  "sachet": {
    "authority": "NDMA — SACHET National Disaster Alert Portal",
    "access": "feed",
    "is_primary": true,
    "requires_key": false,
    "configured": true,
    "docs_url": "https://sachet.ndma.gov.in/docs/Integration_Guide_For_Agencies.pdf",
    "poll_seconds": 300
  },
  "cwc": {
    "authority": "Central Water Commission",
    "access": "credentialed",
    "is_primary": true,
    "requires_key": false,
    "configured": false,
    "docs_url": "http://india-water.gov.in/ffs/",
    "poll_seconds": 1800
  },
  "nrsc": {
    "authority": "ISRO / NRSC — Bhuvan",
    "access": "credentialed",
    "is_primary": true,
    "requires_key": false,
    "configured": false,
    "docs_url": "https://bhuvan.nrsc.gov.in/wiki/index.php/How_to_use_WMS_services",
    "poll_seconds": 3600
  },
  "incois": {
    "authority": "INCOIS (Ministry of Earth Sciences)",
    "access": "public",
    "is_primary": true,
    "requires_key": false,
    "configured": true,
    "docs_url": "https://erddap.incois.gov.in/erddap/rest.html",
    "poll_seconds": 1800
  },
  "ncs": {
    "authority": "National Center for Seismology (MoES)",
    "access": "credentialed",
    "is_primary": true,
    "requires_key": false,
    "configured": false,
    "docs_url": "https://seismo.gov.in/data-portal",
    "poll_seconds": 300
  },
  "sdma": {
    "authority": "State Disaster Management Authorities",
    "access": "manual",
    "is_primary": true,
    "requires_key": false,
    "configured": true,
    "docs_url": null,
    "poll_seconds": 0
  },
  "usgs": {
    "authority": "USGS FDSN event web service",
    "access": "public",
    "is_primary": false,
    "requires_key": false,
    "configured": true,
    "docs_url": "https://earthquake.usgs.gov/fdsnws/event/1/",
    "poll_seconds": 300
  },
  "openmeteo": {
    "authority": "Open-Meteo",
    "access": "public",
    "is_primary": false,
    "requires_key": false,
    "configured": true,
    "docs_url": "https://open-meteo.com/en/docs",
    "poll_seconds": 900
  },
  "overpass": {
    "authority": "OpenStreetMap Overpass API",
    "access": "public",
    "is_primary": false,
    "requires_key": false,
    "configured": true,
    "docs_url": "https://wiki.openstreetmap.org/wiki/Overpass_API",
    "poll_seconds": 86400
  },
  "firms": {
    "authority": "NASA FIRMS active fire",
    "access": "public",
    "is_primary": false,
    "requires_key": true,
    "configured": false,
    "docs_url": "https://firms.modaps.eosdis.nasa.gov/api/",
    "poll_seconds": 3600
  },
  "opentopo": {
    "authority": "OpenTopography global DEM",
    "access": "public",
    "is_primary": false,
    "requires_key": true,
    "configured": false,
    "docs_url": "https://portal.opentopography.org/apidocs/",
    "poll_seconds": 0
  },
  "glofas": {
    "authority": "Open-Meteo Flood API (ECMWF GloFAS v4)",
    "access": "public",
    "is_primary": false,
    "requires_key": false,
    "configured": true,
    "docs_url": "https://open-meteo.com/en/docs/flood-api",
    "poll_seconds": 3600
  },
  "gdacs": {
    "authority": "GDACS — Global Disaster Alert and Coordination System (JRC/UN)",
    "access": "public",
    "is_primary": false,
    "requires_key": false,
    "configured": true,
    "docs_url": "https://www.gdacs.org/gdacsapi/swagger/index.html",
    "poll_seconds": 900
  },
  "worldpop": {
    "authority": "WorldPop",
    "access": "public",
    "is_primary": false,
    "requires_key": false,
    "configured": true,
    "docs_url": "https://www.worldpop.org/methods/",
    "poll_seconds": 0
  }
};

const POLLING_PLAN = {
  "openmeteo": 900,
  "glofas": 3600,
  "gdacs": 900,
  "usgs": 300,
  "incois": 1800
};
