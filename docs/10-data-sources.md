# 10 · Data Source Register

Verified 2 September 2026. **This file is the only place a source URL is allowed to be
asserted.** Connectors read their base URL from configuration; none of them hardcodes a
path that is not listed here. If a source is not in this table with an `access` value of
`public`, its connector ships as an interface plus a configuration placeholder and returns
`SourceUnavailable` until an operator supplies credentials — it does **not** pretend the
API is reachable.

## Primary — Indian authorities

| Key | Authority | What it gives | Access route | `access` | Credentials |
|---|---|---|---|---|---|
| `imd` | India Meteorological Department | Station observations, nowcasts, district warnings, rainfall | Official API portal `https://api.imd.gov.in/` (reference at `/public/api_reference.html`; IP-whitelisting and issue portal under `/public/`) | `credentialed` | Registration **and** server IP whitelisting. Attribution to IMD required; client-side caching requested during peak events. |
| `sachet` | NDMA — SACHET National Disaster Alert Portal | Official CAP alerts, all hazards, all 36 states/UTs, 12 languages | CAP/RSS feed page `https://sachet.ndma.gov.in/CapFeed`; agency integration described in `https://sachet.ndma.gov.in/docs/Integration_Guide_For_Agencies.pdf` | `feed` | Feed page is public. Becoming an *alerting agency* requires NDMA onboarding. We consume only. |
| `cwc` | Central Water Commission | River level, discharge, danger/warning levels, flood forecasts | Flood Forecasting System portal `http://india-water.gov.in/ffs/`; India-WRIS `https://indiawris.gov.in/`; FloodWatch India app | `credentialed` | **The machine-readable route must be confirmed with CWC / NWIC.** The portal is a dashboard, not a documented public API. Connector is interface-only until a route is agreed in writing. |
| `nrsc` | ISRO / NRSC — Bhuvan | Flood inundation layers, landslide inventory, LULC, DEM products | Bhuvan geoportal `https://bhuvan.nrsc.gov.in/`; OGC WMS documented on the Bhuvan wiki | `credentialed` | Some WMS layers open; disaster-services products need a Bhuvan account. |
| `incois` | INCOIS (MoES) | Ocean state, tsunami bulletins, sea level, wave/surge | **ERDDAP** `https://erddap.incois.gov.in/erddap/` — genuine RESTful data server, dataset list at `/erddap/info/`, REST docs at `/erddap/rest.html`. Tsunami warning centre `https://tsunami.incois.gov.in/TEWS/` | `public` | None for ERDDAP datasets. |
| `ncs` | National Center for Seismology (MoES) | Indian earthquake catalogue, felt reports | `https://seismo.gov.in/data-portal`; RISEQ `https://riseq.seismo.gov.in/` | `credentialed` | Data portal registration for catalogue/waveform access. |
| `sdma` | State Disaster Management Authorities | State bulletins, shelter registers, road closures | Per-state; no common API | `manual` | Per-state MoU. Modelled as operator-entered data (§19, §20) until a state provides a feed. |

## Supplementary — open, keep a hazard live where a primary source is silent

| Key | Source | Endpoint | `access` | Credentials |
|---|---|---|---|---|
| `usgs` | USGS FDSN event web service | `https://earthquake.usgs.gov/fdsnws/event/1/query` | `public` | None |
| `openmeteo` | Open-Meteo forecast API | `https://api.open-meteo.com/v1/forecast` | `public` | None (free tier) |
| `glofas` | Open-Meteo Flood API — ECMWF GloFAS v4 | `https://flood-api.open-meteo.com/v1/flood` | `public` | None (free tier) |
| `gdacs` | GDACS — Global Disaster Alert and Coordination System (JRC / UN OCHA) | `https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH` | `public` | None. 100 records per page. |
| `overpass` | OpenStreetMap Overpass API | `https://overpass-api.de/api/interpreter` | `public` | None. Respect rate limits; we cache aggressively. |
| `firms` | NASA FIRMS active fire | `https://firms.modaps.eosdis.nasa.gov/api/` | `public` | **Free `MAP_KEY` required** |
| `opentopo` | OpenTopography global DEM | `https://portal.opentopography.org/API/globaldem` | `public` | **Free API key required** |
| `worldpop` | WorldPop population rasters | `https://data.worldpop.org/` | `public` | None (bulk download) |

## Hazard → source map

`backend/app/hazards/catalogue.py` is the machine-readable version of this
table, and the dashboard's *Hazards & Data Sources* screen is generated from it
(`scripts/export_catalogue.py`) so the two cannot disagree.

| Hazard | Authoritative (Indian, gated) | Keyless fallback | What keyless costs you |
|---|---|---|---|
| Flood | IMD rainfall, CWC river stage | Open-Meteo + GloFAS + GDACS | modelled 5 km discharge instead of a surveyed gauge stage |
| Landslide | IMD, NRSC inventory | Open-Meteo + OpenTopography + GDACS | rainfall trigger at ~11 km over a static slope layer |
| Earthquake | NCS catalogue | USGS FDSN + GDACS | adequate above ~M4; misses smaller local events |
| Cyclone | IMD track | GDACS + Open-Meteo + INCOIS | track and alert level, no wind field |
| Wildfire | NRSC | GDACS *(FIRMS with a free key)* | coarse large-fire alerts, no per-pixel detection |
| Heatwave | IMD normals | Open-Meteo | 30-day local mean standing in for a 30-year normal |
| Drought | IMD long-period average | Open-Meteo + GDACS | short-window z-score, not a true SPI |
| Lightning | IMD strike network | Open-Meteo CAPE | **a proxy, not detection** — CAPE says the atmosphere could, not that it did |
| Tsunami | INCOIS / ITEWC | USGS + GDACS | submarine quake parameters only |

**All nine run with an empty `.env`.** Credentials buy fidelity, not existence.

## Coverage vs registers

These come from different places and the platform never conflates them.

| | Where it comes from | Coverage today |
|---|---|---|
| **Modelled risk** | Feeds that genuinely cover the whole country — IMD/Open-Meteo, GloFAS, USGS/GDACS, INCOIS, FIRMS | All 36 states and union territories |
| **Shelter and road registers** | A State Disaster Management Authority. There is no national register and no common API (`sdma` is `access = manual`) | Chamoli District, Uttarakhand |

A state without an integrated SDMA feed is shown with a **provisional register**
— marked in the breadcrumb, in the sidebar, and in a notice when the state is
opened. Its capacity figures are planning estimates, never presented as a
verified register. `registerLabel()` in `frontend/standalone/src/states.js` is
the single place that distinction is expressed, so no screen can quietly drop it.

Check what your host can actually reach:

```bash
cd backend && python scripts/check_sources.py            # everything
python scripts/check_sources.py --hazard flood           # one hazard's chain
python scripts/check_sources.py --keyless                # no-credential only
```

## Rules the code enforces

1. A connector's base URL comes from `settings.sources.<key>.base_url`. There is no literal
   URL in connector code.
2. `access = credentialed` + missing credentials ⇒ the connector reports
   `status = NOT_CONFIGURED`, the source appears in the UI as *not configured*, and the risk
   engine reduces confidence for cells that depended on it. It never fabricates a reading.
3. Every stored record carries `source`, `source_id`, `observed_at`, `ingested_at`,
   `confidence`, `quality_status` (§4).
4. A supplementary source may never silently substitute for a primary one. When
   `openmeteo` fills in for `imd`, the observation is stored with `source='openmeteo'` and
   the risk output for affected cells is stamped `degraded_inputs=['imd']`.
5. **ML output is never labelled a warning.** Official warnings shown in the UI come from
   `sachet` only and keep their issuing authority. Model output is labelled
   *AI-based risk prediction and decision support*.
