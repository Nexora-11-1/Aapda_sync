/* ============================================================================
   AapdaSync — data.js
   ---------------------------------------------------------------------------
   SIMULATED DATA ONLY. Not an official government dataset.

   Everything here is a RAW INPUT, never a score. Scores are derived in
   engine.js so that every number on screen can be traced back to an input
   the user can inspect and change.

   Two top-level objects are kept deliberately separate and are NEVER merged:
     SIM  — the simulated district (all planning surfaces)
     LIVE — the small set of genuinely live/derived values (clock, session)
   ========================================================================== */

'use strict';

var SIM = {};
/* Five stamps, deliberately separate. Each moves only when that event actually
   happens — a clock tick is not a data update, and re-rendering a screen is not
   a verification. Collapsing these into one "last updated" is how a dashboard
   comes to claim freshness it does not have. */
var LIVE = {
  boot: null,
  lastSyncAt: null,        // last time a source was polled
  lastDataUpdateAt: null,  // last time inbound data actually changed
  lastVerifiedAt: null,    // last time a human verified something
  lastComputeAt: null      // last time the model chain re-derived
};

/* ---------------------------------------------------------------------------
   0. Provenance — every layer declares where it would come from in production
   ------------------------------------------------------------------------ */
SIM.sources = [
  { id: 'SRC-SEIS', name: 'Seismic hazard (PGA, 475-yr)', owner: 'NCS / BIS 1893 zonation', mode: 'SIMULATED', refresh: 'static', note: 'Peak ground acceleration and liquefaction susceptibility per habitation.' },
  { id: 'SRC-FLOOD', name: 'Fluvial inundation model', owner: 'CWC gauge + DEM routing', mode: 'SIMULATED', refresh: '15 min', note: '100-yr depth grid and crest timing from upstream gauge.' },
  { id: 'SRC-SLIDE', name: 'Landslide susceptibility', owner: 'GSI NLSM 1:50k', mode: 'SIMULATED', refresh: 'static', note: 'Susceptibility index and slope angle; rainfall-triggered reactivation flag.' },
  { id: 'SRC-MAH', name: 'MAH industrial off-site plume', owner: 'Factory Inspectorate off-site plan', mode: 'SIMULATED', refresh: 'event', note: 'Toxic release footprint at 90th-percentile wind.' },
  { id: 'SRC-POP', name: 'Habitation register', owner: 'Census + SECC + Panchayat roll', mode: 'SIMULATED', refresh: 'annual', note: 'Population, households, structural typology, vulnerable counts.' },
  { id: 'SRC-SITE', name: 'Safe-site inventory', owner: 'DDMA shelter register', mode: 'SIMULATED', refresh: 'quarterly', note: 'Covered area, water, sanitation, medical, staffing, own hazard exposure.' },
  { id: 'SRC-ROAD', name: 'Road corridor status', owner: 'PWD / NHAI + field reports', mode: 'SIMULATED', refresh: '30 min', note: 'Throughput, cut status, hazard crossings.' },
  { id: 'SRC-FIELD', name: 'Ground reports', owner: 'Field responders + citizen reports', mode: 'SIMULATED', refresh: 'live', note: 'Unverified until an operator marks otherwise.' }
];

/* ---------------------------------------------------------------------------
   1. The district. Geometry space is 0 0 1000 700; 1 unit = 100 m.
   ------------------------------------------------------------------------ */
SIM.district = {
  name: 'Sarai Ghat',
  state: 'Simulated State',
  code: 'SG-00',
  disclaimer: 'Fictional district. Geometry, place names and all figures are invented for demonstration.',
  outline: 'M 60,150 L 150,60 L 330,42 L 520,58 L 700,40 L 890,70 L 960,150 L 972,330 L 940,520 L 880,650 L 690,678 L 470,668 L 280,676 L 120,630 L 52,470 L 40,300 Z',
  river: 'M 122,72 C 210,150 268,196 320,232 C 392,282 430,316 470,346 C 540,398 596,430 664,478 C 742,534 812,586 884,646',
  ridge: 'M 46,232 C 160,178 300,196 430,168 C 560,140 700,158 830,132 C 900,118 940,120 968,132',
  blocks: [
    { id: 'B-DEV', name: 'Devgarh',    terrain: 'Hill',   roadFactor: 2.35, label: [188, 96] },
    { id: 'B-SAR', name: 'Sarai Ghat', terrain: 'Valley', roadFactor: 1.45, label: [430, 258] },
    { id: 'B-NAN', name: 'Nandpur',    terrain: 'Upland', roadFactor: 1.30, label: [800, 208] },
    { id: 'B-KOT', name: 'Kotwa',      terrain: 'Plain',  roadFactor: 1.18, label: [366, 462] }
  ]
};

/* Hazard footprints drawn on the map. Advisory geometry — the numbers that
   drive scoring live on each habitation, not on these shapes. */
SIM.hazardShapes = [
  /* Flood bands are drawn as buffers around the real river line rather than as
     free-hand polygons, so the inundation footprint stays geometrically honest
     relative to the channel it comes from. */
  { id: 'HZ-FL100', kind: 'flood',   band: '100-yr inundation', buffer: 58, opacity: 0.20 },
  { id: 'HZ-FL025', kind: 'flood25', band: '25-yr inundation',  buffer: 26, opacity: 0.26 },
  { id: 'HZ-SLIDE-A', kind: 'slide', band: 'Very high landslide susceptibility', d: 'M 96,86 C 150,58 224,62 268,96 C 306,126 300,168 262,192 C 214,222 142,214 106,180 C 76,152 74,104 96,86 Z', opacity: 0.34 },
  { id: 'HZ-SLIDE-B', kind: 'slide', band: 'High landslide susceptibility', d: 'M 300,72 C 366,52 432,74 448,116 C 462,154 428,192 376,200 C 322,208 282,182 278,142 C 275,110 282,80 300,72 Z', opacity: 0.26 },
  { id: 'HZ-LIQ', kind: 'liq', band: 'Liquefaction susceptible', d: 'M 250,452 C 360,420 500,432 610,470 C 700,502 740,556 700,606 C 650,664 470,672 366,640 C 262,608 218,516 250,452 Z', opacity: 0.26 },
  { id: 'HZ-MAH', kind: 'mah', band: 'MAH off-site plume (worst case)', cx: 790, cy: 268, r: 96, opacity: 0.20 }
];

/* Active declared events. time-to-impact hours are relative to session start. */
SIM.events = [
  { id: 'EV-01', kind: 'flood', name: 'Upper-catchment cloudburst — river crest', declared: '2026-08-23T04:10+05:30', severity: 'critical', impactInHrs: 13.5, source: 'SRC-FLOOD', note: 'Gauge at Naugaon rising 42 cm/hr. Crest projected +13h30m.' },
  { id: 'EV-02', kind: 'slide', name: 'Devgarh ghat slope reactivation', declared: '2026-08-23T01:55+05:30', severity: 'critical', impactInHrs: 0, source: 'SRC-SLIDE', note: 'Active movement observed. Ghat road intermittently blocked.' },
  { id: 'EV-03', kind: 'seis', name: 'M5.8 mainshock — aftershock sequence', declared: '2026-08-20T22:41+05:30', severity: 'high', impactInHrs: 0, source: 'SRC-SEIS', note: 'Damage grade 2–3 widespread in kutcha stock. Aftershock probability elevated 72h.' },
  { id: 'EV-04', kind: 'mah', name: 'Nandpur estate — ammonia vessel integrity alert', declared: '2026-08-23T07:20+05:30', severity: 'high', impactInHrs: 6, source: 'SRC-MAH', note: 'Off-site emergency plan at standby. Not a release.' }
];

/* ---------------------------------------------------------------------------
   2. Road corridors. Throughput is persons/hour that the corridor can move.
   ------------------------------------------------------------------------ */
SIM.corridors = [
  { id: 'C-1', name: 'Devgarh Ghat Road',      throughput: 420,  status: 'restricted', hazard: 0.82, note: 'Single lane, active slide zone, night movement barred.', crosses: ['slide'] },
  { id: 'C-2', name: 'NH-31 River Bridge',     throughput: 2600, status: 'open',       hazard: 0.58, note: 'Deck 1.1 m above projected crest. Closes if crest exceeds forecast.', crosses: ['flood'] },
  { id: 'C-3', name: 'Nandpur Industrial Road',throughput: 1800, status: 'open',       hazard: 0.46, note: 'Passes within the MAH plume envelope. Downwind risk on E-wind.', crosses: ['mah'] },
  { id: 'C-4', name: 'Kotwa Link Road',        throughput: 2200, status: 'open',       hazard: 0.14, note: 'All-weather, embankment protected.', crosses: [] },
  { id: 'C-5', name: 'Ridge Fair-weather Track',throughput: 180, status: 'degraded',   hazard: 0.66, note: 'Unmetalled. Unusable in sustained rain.', crosses: ['slide'] },
  { id: 'C-6', name: 'Rampur Embankment Road', throughput: 1400, status: 'open',       hazard: 0.31, note: 'Runs on the flood embankment; safe until overtopping.', crosses: ['flood'] }
];

/* ---------------------------------------------------------------------------
   3. Habitations — RAW inputs only.
   h  : hazard raw inputs
        pga    peak ground acceleration, g (475-yr)
        liq    liquefaction susceptibility 0-1
        depth  100-yr flood depth at habitation, m
        dur    inundation duration, hrs
        slide  landslide susceptibility 0-1
        slope  degrees
        plume  fraction of habitation inside MAH worst-case footprint 0-1
   v  : vulnerability raw inputs
        kutcha / semi / pucca fractions of the housing stock
        eld    persons 60+
        u5     children under 5
        pwd    persons with disability / bedridden
        preg   pregnant & lactating
        veh    households per 100 owning any motor vehicle
        cov    mobile coverage % (warning reach)
        prior  previously displaced in last 5 yrs (0/1)
        stock  large livestock head
   ------------------------------------------------------------------------ */
SIM.habitations = [
  // --- Devgarh block (hills) ---
  { id: 'HB-01', name: 'Bhaironkhal',        block: 'B-DEV', xy: [180, 120], pop: 1240, hh: 268, corridor: 'C-1', elev: 1420,
    h: { pga: 0.28, liq: 0.05, depth: 0.0, dur: 0,  slide: 0.91, slope: 38, plume: 0 },
    v: { kutcha: 0.46, semi: 0.38, pucca: 0.16, eld: 186, u5: 108, pwd: 31, preg: 24, veh: 14, cov: 62, prior: 1, stock: 340 } },
  { id: 'HB-02', name: 'Talla Chopra',       block: 'B-DEV', xy: [255, 168], pop: 860,  hh: 191, corridor: 'C-1', elev: 1180,
    h: { pga: 0.28, liq: 0.05, depth: 0.0, dur: 0,  slide: 0.74, slope: 31, plume: 0 },
    v: { kutcha: 0.39, semi: 0.42, pucca: 0.19, eld: 121, u5: 74,  pwd: 19, preg: 16, veh: 21, cov: 71, prior: 0, stock: 210 } },
  { id: 'HB-03', name: 'Dungri Tok',         block: 'B-DEV', xy: [128, 196], pop: 430,  hh: 98,  corridor: 'C-5', elev: 1560,
    h: { pga: 0.30, liq: 0.04, depth: 0.0, dur: 0,  slide: 0.95, slope: 44, plume: 0 },
    v: { kutcha: 0.61, semi: 0.30, pucca: 0.09, eld: 79,  u5: 41,  pwd: 14, preg: 8,  veh: 6,  cov: 38, prior: 1, stock: 165 } },
  { id: 'HB-04', name: 'Ranipathar',         block: 'B-DEV', xy: [320, 110], pop: 1610, hh: 352, corridor: 'C-1', elev: 1340,
    h: { pga: 0.26, liq: 0.05, depth: 0.0, dur: 0,  slide: 0.68, slope: 27, plume: 0 },
    v: { kutcha: 0.33, semi: 0.44, pucca: 0.23, eld: 214, u5: 132, pwd: 36, preg: 29, veh: 28, cov: 84, prior: 0, stock: 285 } },
  { id: 'HB-05', name: 'Malla Siyari',       block: 'B-DEV', xy: [392, 182], pop: 720,  hh: 158, corridor: 'C-1', elev: 1050,
    h: { pga: 0.25, liq: 0.06, depth: 0.0, dur: 0,  slide: 0.52, slope: 22, plume: 0 },
    v: { kutcha: 0.28, semi: 0.46, pucca: 0.26, eld: 96,  u5: 58,  pwd: 15, preg: 13, veh: 33, cov: 88, prior: 0, stock: 120 } },
  { id: 'HB-06', name: 'Kaflani',            block: 'B-DEV', xy: [98, 132],  pop: 305,  hh: 71,  corridor: 'C-5', elev: 1620,
    h: { pga: 0.31, liq: 0.04, depth: 0.0, dur: 0,  slide: 0.88, slope: 41, plume: 0 },
    v: { kutcha: 0.68, semi: 0.26, pucca: 0.06, eld: 61,  u5: 28,  pwd: 11, preg: 5,  veh: 4,  cov: 29, prior: 1, stock: 140 } },

  // --- Sarai Ghat block (river valley) ---
  { id: 'HB-07', name: 'Sarai Ghat Ward 3',  block: 'B-SAR', xy: [420, 318], pop: 5240, hh: 1188, corridor: 'C-2', elev: 210,
    h: { pga: 0.22, liq: 0.34, depth: 2.9, dur: 46, slide: 0.10, slope: 4,  plume: 0 },
    v: { kutcha: 0.24, semi: 0.39, pucca: 0.37, eld: 618, u5: 402, pwd: 96, preg: 88, veh: 41, cov: 96, prior: 1, stock: 190 } },
  { id: 'HB-08', name: 'Naugaon',            block: 'B-SAR', xy: [352, 286], pop: 2180, hh: 486,  corridor: 'C-2', elev: 226,
    h: { pga: 0.23, liq: 0.41, depth: 3.6, dur: 58, slide: 0.14, slope: 5,  plume: 0 },
    v: { kutcha: 0.41, semi: 0.37, pucca: 0.22, eld: 288, u5: 191, pwd: 44, preg: 38, veh: 22, cov: 91, prior: 1, stock: 410 } },
  { id: 'HB-09', name: 'Bansi Tola',         block: 'B-SAR', xy: [486, 362], pop: 1470, hh: 331,  corridor: 'C-2', elev: 198,
    h: { pga: 0.22, liq: 0.47, depth: 4.1, dur: 62, slide: 0.08, slope: 3,  plume: 0 },
    v: { kutcha: 0.58, semi: 0.31, pucca: 0.11, eld: 201, u5: 138, pwd: 33, preg: 27, veh: 11, cov: 78, prior: 1, stock: 520 } },
  { id: 'HB-10', name: 'Ghat Kinara',        block: 'B-SAR', xy: [556, 404], pop: 990,  hh: 224,  corridor: 'C-6', elev: 186,
    h: { pga: 0.21, liq: 0.52, depth: 4.8, dur: 71, slide: 0.06, slope: 2,  plume: 0 },
    v: { kutcha: 0.66, semi: 0.27, pucca: 0.07, eld: 138, u5: 96,  pwd: 24, preg: 19, veh: 8,  cov: 74, prior: 1, stock: 610 } },
  { id: 'HB-11', name: 'Pipariya',           block: 'B-SAR', xy: [300, 372], pop: 1330, hh: 297,  corridor: 'C-4', elev: 244,
    h: { pga: 0.23, liq: 0.29, depth: 1.4, dur: 22, slide: 0.11, slope: 6,  plume: 0 },
    v: { kutcha: 0.35, semi: 0.42, pucca: 0.23, eld: 172, u5: 112, pwd: 26, preg: 22, veh: 27, cov: 89, prior: 0, stock: 230 } },
  { id: 'HB-12', name: 'Amrai Basti',        block: 'B-SAR', xy: [610, 352], pop: 2640, hh: 604,  corridor: 'C-6', elev: 192,
    h: { pga: 0.21, liq: 0.49, depth: 3.8, dur: 55, slide: 0.07, slope: 3,  plume: 0.12 },
    v: { kutcha: 0.62, semi: 0.29, pucca: 0.09, eld: 341, u5: 246, pwd: 58, preg: 49, veh: 9,  cov: 69, prior: 1, stock: 380 } },

  // --- Nandpur block (upland / industrial) ---
  { id: 'HB-13', name: 'Nandpur Khas',       block: 'B-NAN', xy: [700, 288], pop: 3120, hh: 712,  corridor: 'C-3', elev: 262,
    h: { pga: 0.24, liq: 0.18, depth: 0.6, dur: 9,  slide: 0.09, slope: 5,  plume: 0.58 },
    v: { kutcha: 0.31, semi: 0.40, pucca: 0.29, eld: 372, u5: 251, pwd: 61, preg: 54, veh: 36, cov: 94, prior: 0, stock: 145 } },
  { id: 'HB-14', name: 'Rasoolabad',         block: 'B-NAN', xy: [778, 240], pop: 1880, hh: 428,  corridor: 'C-3', elev: 278,
    h: { pga: 0.24, liq: 0.15, depth: 0.0, dur: 0,  slide: 0.08, slope: 4,  plume: 0.94 },
    v: { kutcha: 0.44, semi: 0.36, pucca: 0.20, eld: 236, u5: 162, pwd: 41, preg: 33, veh: 19, cov: 87, prior: 0, stock: 210 } },
  { id: 'HB-15', name: 'Chakiya',            block: 'B-NAN', xy: [826, 336], pop: 1040, hh: 238,  corridor: 'C-3', elev: 252,
    h: { pga: 0.25, liq: 0.20, depth: 0.9, dur: 12, slide: 0.10, slope: 6,  plume: 0.41 },
    v: { kutcha: 0.37, semi: 0.41, pucca: 0.22, eld: 133, u5: 88,  pwd: 21, preg: 18, veh: 24, cov: 90, prior: 0, stock: 160 } },
  { id: 'HB-16', name: 'Jhilmil Colony',     block: 'B-NAN', xy: [742, 352], pop: 2260, hh: 538,  corridor: 'C-3', elev: 234,
    h: { pga: 0.24, liq: 0.31, depth: 2.2, dur: 31, slide: 0.08, slope: 4,  plume: 0.67 },
    v: { kutcha: 0.71, semi: 0.24, pucca: 0.05, eld: 264, u5: 218, pwd: 52, preg: 46, veh: 6,  cov: 61, prior: 1, stock: 90 } },
  { id: 'HB-17', name: 'Sonbarsa',           block: 'B-NAN', xy: [890, 282], pop: 640,  hh: 149,  corridor: 'C-3', elev: 288,
    h: { pga: 0.25, liq: 0.13, depth: 0.0, dur: 0,  slide: 0.07, slope: 3,  plume: 0.22 },
    v: { kutcha: 0.29, semi: 0.43, pucca: 0.28, eld: 82,  u5: 49,  pwd: 12, preg: 11, veh: 31, cov: 92, prior: 0, stock: 75 } },

  // --- Kotwa block (plains) ---
  { id: 'HB-18', name: 'Kotwa Bazar',        block: 'B-KOT', xy: [400, 498], pop: 4380, hh: 1004, corridor: 'C-4', elev: 168,
    h: { pga: 0.27, liq: 0.72, depth: 1.1, dur: 16, slide: 0.03, slope: 1,  plume: 0 },
    v: { kutcha: 0.33, semi: 0.38, pucca: 0.29, eld: 512, u5: 336, pwd: 82, preg: 71, veh: 38, cov: 95, prior: 0, stock: 260 } },
  { id: 'HB-19', name: 'Rampur Diyara',      block: 'B-KOT', xy: [520, 556], pop: 1720, hh: 392,  corridor: 'C-6', elev: 154,
    h: { pga: 0.27, liq: 0.81, depth: 3.2, dur: 68, slide: 0.02, slope: 1,  plume: 0 },
    v: { kutcha: 0.69, semi: 0.26, pucca: 0.05, eld: 226, u5: 161, pwd: 39, preg: 32, veh: 7,  cov: 72, prior: 1, stock: 740 } },
  { id: 'HB-20', name: 'Belahi',             block: 'B-KOT', xy: [300, 588], pop: 980,  hh: 221,  corridor: 'C-4', elev: 161,
    h: { pga: 0.28, liq: 0.76, depth: 1.9, dur: 34, slide: 0.02, slope: 1,  plume: 0 },
    v: { kutcha: 0.57, semi: 0.33, pucca: 0.10, eld: 129, u5: 91,  pwd: 22, preg: 18, veh: 12, cov: 81, prior: 1, stock: 415 } },
  { id: 'HB-21', name: 'Majhauli',           block: 'B-KOT', xy: [640, 600], pop: 1560, hh: 358,  corridor: 'C-6', elev: 149,
    h: { pga: 0.26, liq: 0.79, depth: 2.6, dur: 52, slide: 0.02, slope: 1,  plume: 0 },
    v: { kutcha: 0.63, semi: 0.29, pucca: 0.08, eld: 198, u5: 143, pwd: 35, preg: 29, veh: 10, cov: 76, prior: 1, stock: 560 } },
  { id: 'HB-22', name: 'Semra Tand',         block: 'B-KOT', xy: [760, 522], pop: 870,  hh: 198,  corridor: 'C-4', elev: 176,
    h: { pga: 0.26, liq: 0.61, depth: 0.7, dur: 11, slide: 0.03, slope: 2,  plume: 0.06 },
    v: { kutcha: 0.41, semi: 0.38, pucca: 0.21, eld: 111, u5: 74,  pwd: 18, preg: 15, veh: 26, cov: 88, prior: 0, stock: 190 } },
  { id: 'HB-23', name: 'Harnaut',            block: 'B-KOT', xy: [200, 470], pop: 1180, hh: 264,  corridor: 'C-4', elev: 183,
    h: { pga: 0.28, liq: 0.58, depth: 0.4, dur: 6,  slide: 0.04, slope: 2,  plume: 0 },
    v: { kutcha: 0.36, semi: 0.41, pucca: 0.23, eld: 151, u5: 98,  pwd: 24, preg: 20, veh: 29, cov: 90, prior: 0, stock: 205 } },
  { id: 'HB-24', name: 'Dhanaura',           block: 'B-KOT', xy: [860, 640], pop: 2050, hh: 471,  corridor: 'C-6', elev: 158,
    h: { pga: 0.25, liq: 0.74, depth: 2.1, dur: 39, slide: 0.02, slope: 1,  plume: 0 },
    v: { kutcha: 0.52, semi: 0.35, pucca: 0.13, eld: 261, u5: 178, pwd: 43, preg: 36, veh: 17, cov: 83, prior: 0, stock: 480 } }
];

/* ---------------------------------------------------------------------------
   4. Safe sites — RAW inputs only. Capacity is DERIVED, never stated.
      area   covered floor area, m2
      water  assured water, litres/day
      toilet functioning toilet units
      beds   staffed medical beds on site
      nurse  health staff on site
      tier   1 designated shelter, 2 contingency, 3 last resort
      own    the site's OWN hazard exposure raw inputs (a shelter can itself
             stand in a red zone — this is the single most common real failure)
      corridor  the corridor that feeds it
      openHrs   hours the feeding corridor is usable before impact
   ------------------------------------------------------------------------ */
SIM.sites = [
  { id: 'SS-01', name: 'Govt. Inter College, Devgarh', type: 'School', block: 'B-DEV', xy: [240, 240], tier: 1, elev: 1090,
    area: 2400, water: 26000, toilet: 22, beds: 6, nurse: 3, corridor: 'C-1', openHrs: 9,
    own: { pga: 0.26, liq: 0.05, depth: 0.0, dur: 0, slide: 0.34, slope: 14, plume: 0 },
    claimed: 900, note: 'Two RCC blocks, retrofitted 2019. Ghat road is the only approach.' },

  { id: 'SS-02', name: 'Sarai Ghat Stadium', type: 'Stadium', block: 'B-SAR', xy: [470, 250], tier: 1, elev: 268,
    area: 5600, water: 62000, toilet: 60, beds: 12, nurse: 6, corridor: 'C-2', openHrs: 13,
    own: { pga: 0.22, liq: 0.22, depth: 0.0, dur: 0, slide: 0.05, slope: 3, plume: 0 },
    claimed: 2600, note: 'Covered galleries plus indoor hall. Above the 100-yr line by 1.8 m.' },

  { id: 'SS-03', name: 'District HQ Community Hall', type: 'Civic', block: 'B-SAR', xy: [560, 300], tier: 1, elev: 254,
    area: 1900, water: 30000, toilet: 18, beds: 4, nurse: 2, corridor: 'C-2', openHrs: 13,
    own: { pga: 0.22, liq: 0.25, depth: 0.2, dur: 4, slide: 0.05, slope: 3, plume: 0.04 },
    claimed: 700, note: 'Adjoining the collectorate. Generator-backed.' },

  { id: 'SS-04', name: 'Nandpur Mandi Yard', type: 'Market', block: 'B-NAN', xy: [800, 190], tier: 2, elev: 296,
    area: 7200, water: 34000, toilet: 14, beds: 0, nurse: 1, corridor: 'C-3', openHrs: 6,
    own: { pga: 0.24, liq: 0.12, depth: 0.0, dur: 0, slide: 0.06, slope: 3, plume: 0.71 },
    claimed: 3000, note: 'Huge covered sheds. Sits inside the MAH off-site envelope.' },

  { id: 'SS-05', name: 'Kotwa Higher Sec. School', type: 'School', block: 'B-KOT', xy: [380, 440], tier: 1, elev: 179,
    area: 4100, water: 41000, toilet: 8, beds: 4, nurse: 2, corridor: 'C-4', openHrs: 18,
    own: { pga: 0.27, liq: 0.55, depth: 0.0, dur: 0, slide: 0.03, slope: 1, plume: 0 },
    claimed: 1400, note: 'Largest floor plate in the block. Sanitation never upgraded after the 2021 extension.' },

  { id: 'SS-06', name: 'Rampur Panchayat Bhawan', type: 'Civic', block: 'B-KOT', xy: [556, 610], tier: 2, elev: 160,
    area: 900, water: 9000, toilet: 6, beds: 0, nurse: 0, corridor: 'C-6', openHrs: 11,
    own: { pga: 0.27, liq: 0.78, depth: 1.6, dur: 30, slide: 0.02, slope: 1, plume: 0 },
    claimed: 350, note: 'On the register since 2016. Flooded in 2022 to 1.2 m.' },

  { id: 'SS-07', name: 'Sub-district Hospital Annexe', type: 'Medical', block: 'B-KOT', xy: [620, 470], tier: 1, elev: 188,
    area: 1600, water: 48000, toilet: 26, beds: 64, nurse: 22, corridor: 'C-4', openHrs: 18,
    own: { pga: 0.26, liq: 0.44, depth: 0.0, dur: 0, slide: 0.02, slope: 1, plume: 0 },
    claimed: 500, note: 'Only site able to receive bedridden and high-dependency evacuees.' },

  { id: 'SS-08', name: 'Chakiya Flood Shelter', type: 'MPCS', block: 'B-NAN', xy: [868, 400], tier: 1, elev: 268,
    area: 2100, water: 44000, toilet: 40, beds: 8, nurse: 4, corridor: 'C-3', openHrs: 8,
    own: { pga: 0.25, liq: 0.16, depth: 0.0, dur: 0, slide: 0.04, slope: 2, plume: 0.09 },
    claimed: 800, note: 'Purpose-built multi-purpose cyclone/flood shelter, stilted.' },

  { id: 'SS-09', name: 'Ridge Camp Site (Tented)', type: 'Camp', block: 'B-DEV', xy: [150, 270], tier: 3, elev: 1240,
    area: 3000, water: 7000, toilet: 5, beds: 0, nurse: 0, corridor: 'C-5', openHrs: 5,
    own: { pga: 0.29, liq: 0.04, depth: 0.0, dur: 0, slide: 0.21, slope: 11, plume: 0 },
    claimed: 850, note: 'Flat ground only. No hard shelter, no assured water tanker route in rain.' },

  { id: 'SS-10', name: 'Majhauli Warehouse (FCI)', type: 'Warehouse', block: 'B-KOT', xy: [690, 650], tier: 2, elev: 171,
    area: 5400, water: 8000, toilet: 30, beds: 0, nurse: 1, corridor: 'C-6', openHrs: 11,
    own: { pga: 0.26, liq: 0.66, depth: 0.8, dur: 14, slide: 0.02, slope: 1, plume: 0 },
    claimed: 2100, note: 'Grain stock must be moved before occupancy. 6-hour lead.' },

  { id: 'SS-11', name: 'Belahi Primary School', type: 'School', block: 'B-KOT', xy: [268, 630], tier: 1, elev: 157,
    area: 1100, water: 12000, toilet: 8, beds: 0, nurse: 0, corridor: 'C-4', openHrs: 16,
    own: { pga: 0.28, liq: 0.79, depth: 2.4, dur: 44, slide: 0.02, slope: 1, plume: 0 },
    claimed: 400, note: 'On the DDMA register as a designated shelter. Sits inside the 25-yr inundation band.' },

  { id: 'SS-12', name: 'Sonbarsa ITI Campus', type: 'Institute', block: 'B-NAN', xy: [930, 220], tier: 1, elev: 292,
    area: 3300, water: 52000, toilet: 50, beds: 6, nurse: 3, corridor: 'C-3', openHrs: 8,
    own: { pga: 0.25, liq: 0.11, depth: 0.0, dur: 0, slide: 0.05, slope: 2, plume: 0.14 },
    claimed: 1200, note: 'Hostel blocks plus workshop sheds. Edge of the plume envelope only.' }
];

/* ---------------------------------------------------------------------------
   5. Planning standards. Every one of these is editable in the UI so the
      operator can see the assumption that produced the number.
   ------------------------------------------------------------------------ */
SIM.standards = {
  areaPerPerson:   3.5,    // m2 covered — Sphere minimum
  waterPerPerson:  15,     // litres/person/day — Sphere
  personsPerToilet: 20,    // Sphere
  personsPerNurse: 250,    // indicative
  medFraction:     0.018,  // share of an evacuated population needing a staffed bed
  siteHeiCutoff:   55,     // a site with HEI above this is disqualified outright
  siteHeiDerate:   35,     // above this, capacity is de-rated linearly
  surgeBuffer:     0.12,   // reserve held back for unregistered arrivals
  hostTolerance:   0.85    // fraction of derived capacity that may be committed in one planning round
};

/* ---------------------------------------------------------------------------
   6. Field reports — unverified until an operator says otherwise.
   ------------------------------------------------------------------------ */
/* capturedAt is when the observation was made; receivedAt is when it reached
   the system. Offline replay orders by capture, never by receipt. */
SIM.reports = [
  { id: 'FR-118', at: '-00:12', hab: 'HB-10', text: 'Water entered the lower lane. Six families moved to the embankment on their own.', by: 'Citizen (SMS)', status: 'unverified', kind: 'flood' },
  { id: 'FR-117', at: '-00:31', hab: 'HB-03', text: 'Fresh crown crack behind the school, roughly 40 m long.', by: 'Panchayat secretary', status: 'unverified', kind: 'slide' },
  { id: 'FR-116', at: '-00:47', hab: 'HB-16', text: 'Ammonia smell reported near the estate wall. No confirmation from the plant.', by: 'Citizen (app)', status: 'unverified', kind: 'mah' },
  { id: 'FR-115', at: '-01:05', hab: 'HB-19', text: 'Cattle being moved to the embankment. Families refusing to leave livestock.', by: 'Field team T-04', status: 'verified', kind: 'social' },
  { id: 'FR-114', at: '-01:22', hab: 'HB-07', text: 'Ward 3 loudspeaker not working. Warning did not reach the eastern lanes.', by: 'Field team T-02', status: 'verified', kind: 'warning' },
  { id: 'FR-113', at: '-01:58', hab: 'HB-01', text: 'Ghat road blocked by debris at km 7. Clearing under way.', by: 'PWD JE', status: 'verified', kind: 'road' },
  { id: 'FR-112', at: '-02:14', hab: 'HB-12', text: 'Two bedridden patients in lane 4, no vehicle in the family.', by: 'ASHA worker', status: 'verified', kind: 'medical' },
  { id: 'FR-111', at: '-02:40', hab: 'HB-20', text: 'Community hall roof sheets loose after last night.', by: 'Citizen (call)', status: 'unverified', kind: 'infra' }
];

/* ---------------------------------------------------------------------------
   7. Movement assets available to actually execute a relocation order.
   ------------------------------------------------------------------------ */
SIM.assets = [
  { id: 'MV-01', name: 'SDRF Coy A — 4 trucks', seats: 160, perTrip: 160, cycleMin: 75,  base: 'SS-02', kind: 'truck',  status: 'available', terrain: 'all' },
  { id: 'MV-02', name: 'SDRF Coy B — 3 trucks', seats: 120, perTrip: 120, cycleMin: 75,  base: 'SS-05', kind: 'truck',  status: 'available', terrain: 'all' },
  { id: 'MV-03', name: 'Roadways buses ×6',     seats: 300, perTrip: 300, cycleMin: 95,  base: 'SS-03', kind: 'bus',    status: 'available', terrain: 'road' },
  { id: 'MV-04', name: 'Hired tractors ×14',    seats: 280, perTrip: 280, cycleMin: 60,  base: 'SS-05', kind: 'tractor',status: 'available', terrain: 'rural' },
  { id: 'MV-05', name: 'Hill utility vehicles ×9', seats: 72, perTrip: 72, cycleMin: 110, base: 'SS-01', kind: 'lmv',   status: 'available', terrain: 'hill' },
  { id: 'MV-06', name: 'Boat section ×8',       seats: 96,  perTrip: 96,  cycleMin: 55,  base: 'SS-07', kind: 'boat',   status: 'available', terrain: 'water' },
  { id: 'MV-07', name: '108 ambulances ×5',     seats: 10,  perTrip: 10,  cycleMin: 45,  base: 'SS-07', kind: 'amb',    status: 'available', terrain: 'road' },
  { id: 'MV-08', name: 'NDRF Team 3 (air-lift standby)', seats: 24, perTrip: 24, cycleMin: 150, base: 'SS-02', kind: 'heli', status: 'standby', terrain: 'all' }
];

/* Named scenario perturbations for the counterfactual sandbox. */
SIM.scenarios = [
  { id: 'SC-BASE', name: 'Baseline — as declared', desc: 'Current declared events, corridors as reported.', apply: null },
  { id: 'SC-CREST', name: 'Crest +1.0 m over forecast', desc: 'Every flood depth rises 1.0 m. NH-31 bridge deck is overtopped and the corridor closes.', apply: 'crest' },
  { id: 'SC-GHAT', name: 'Devgarh ghat road severed', desc: 'C-1 throughput falls to zero. The hill block can only be served by the fair-weather ridge track.', apply: 'ghat' },
  { id: 'SC-PLUME', name: 'MAH release — plume realised', desc: 'Off-site plume becomes real. Everything inside it is uninhabitable, including two safe sites.', apply: 'plume' },
  { id: 'SC-AFTER', name: 'M5.2 aftershock', desc: 'Structural derating across the district; kutcha stock loses habitability, two sites drop a tier.', apply: 'after' },
  { id: 'SC-COMPOUND', name: 'Compound — crest + ghat', desc: 'Both the river crest overshoot and the ghat severance occur together.', apply: 'compound' }
];

/* Operator roster for attribution. */
SIM.operators = [
  { id: 'OP-4417', name: 'A. Rawat',   rank: 'Additional District Magistrate', unit: 'DDMA Sarai Ghat' },
  { id: 'OP-2290', name: 'S. Iyer',    rank: 'Incident Commander',              unit: 'EOC' },
  { id: 'OP-3812', name: 'M. Qureshi', rank: 'Shelter Officer',                 unit: 'Relief Branch' }
];
