/* ══════════════════════════════════════════════════════════════════
   AapdaSync — store, scenario, helpers

   The store `S` mirrors the shape the API returns, so going live is a
   matter of replacing seed() with fetch() against /api and pushing
   WebSocket frames through apply(). Nothing else changes.

   Endpoint map (see backend/app/api/routes.py):
     GET  /api/risk?district=&hazard=      → S.cells
     GET  /api/priorities?hazard=          → S.priorities
     GET  /api/alerts                      → S.alerts
     GET  /api/shelters?district=          → S.shelters
     GET  /api/roads                       → S.roads
     GET  /api/evacuation?hazard=          → S.routes
     GET  /api/sources                     → S.sources
     WS   /ws?topics=risk:UT-CHAMOLI,...   → apply()
   ══════════════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = n => Number(n).toLocaleString('en-IN');
const p2 = n => String(n).padStart(2, '0');

/* ── Time is the wall clock, not a counter ──────────────────────────
   Every timestamp on screen is derived from the viewer's actual clock,
   rendered in the deployment's timezone. Seeding fixed times is what
   makes a dashboard read as "yesterday" the moment you open it the
   next day — the figures were current when they were written and
   stopped being current the instant the file was saved.

   TZ is the district's, not the browser's: an operator in Delhi and one
   in Chamoli must read the same clock off the same screen. */
const TZ = 'Asia/Kolkata';
const nowIST = () => new Date();
const fmtIST = (d, withSeconds) => new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour12: false,
  hour: '2-digit', minute: '2-digit',
  ...(withSeconds ? { second: '2-digit' } : {})
}).format(d);

const clk = () => fmtIST(nowIST(), true);
const hm  = () => fmtIST(nowIST(), false);

/** HH:MM as of `minutes` ago — how every seeded timestamp is built. */
const ago = minutes => fmtIST(new Date(Date.now() - minutes * 60_000), false);
/** A date+time label for an expiry that is `hours` from now. */
const ahead = hours => new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour12: false, day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit'
}).format(new Date(Date.now() + hours * 3_600_000));
/** Human age for a moment `minutes` in the past. */
const agoText = minutes => minutes < 1 ? 'just now'
  : minutes < 60 ? `${Math.round(minutes)} min ago`
  : minutes < 1440 ? `${(minutes / 60).toFixed(1)} h ago`
  : `${Math.round(minutes / 1440)} d ago`;

/* ── risk bands, matching backend/app/risk/engine.py ── */
const PRI = {
  low:      { c: '#1B7F3B', n: 'Low',      cls: 'p-low',  sh: 'circle',   r: '0–29' },
  medium:   { c: '#C98A16', n: 'Medium',   cls: 'p-med',  sh: 'square',   r: '30–59' },
  high:     { c: '#D2551A', n: 'High',     cls: 'p-high', sh: 'triangle', r: '60–84' },
  critical: { c: '#B3261E', n: 'Critical', cls: 'p-crit', sh: 'diamond',  r: '85–100' },
  none:     { c: '#7A8698', n: 'No Data',  cls: 'p-off',  sh: 'square',   r: 'no model output' }
};
const lvl = s => s == null || s < 0 ? 'none' : s < 30 ? 'low' : s < 60 ? 'medium' : s < 85 ? 'high' : 'critical';
const pc = s => PRI[lvl(s)].c;
/* The label goes into innerHTML and one caller passes a shelter's binding
   constraint, which arrives from a feed. No caller passes markup. */
const pill = (t, c) => `<span class="p ${c}"><i></i>${esc(t)}</span>`;

/* HAZ, SOURCES and POLLING_PLAN come from src/catalogue.js, which is
   generated from backend/app/hazards/catalogue.py. Nothing here restates
   which source feeds which disaster — the two would drift apart. */

/* Hazards this deployment can actually score: live in the catalogue AND
   physically possible where the map is currently looking. A landlocked
   state does not get a cyclone score — a confident zero teaches an
   operator to ignore the switcher, which is worse than an empty layer. */
const coastalNow = () => S.focus ? isCoastal(S.focus)
  : stateIds().some(id => isCoastal(id));
const scorable = k => HAZ[k].live && !(HAZ[k].coastal_only && !coastalNow());
const HAZ_ORDER = Object.keys(HAZ);

/* ══════════════════════════════════════════════════════════════════
   STORE
   ══════════════════════════════════════════════════════════════════ */
const S = {
  role: 'gov', view: 'map', cz: 'home', dw: null, chat: false, hazard: 'flood',
  bootedAt: Date.now(),
  mapFocus: null, cellSel: null, shelterSel: null, alertSel: null, zoneSel: null,
  layers: { cells: 1, shelters: 1, hospitals: 0, routes: 1, roads: 1, alerts: 1 },
  tlFilter: 'all',

  /* ── The national picture ──────────────────────────────────────
     Every state and union territory, built from src/states.js. `hz` maps
     hazard → risk score, so switching the hazard layer re-tints the whole
     country. A state with no entry for the selected hazard is not affected
     by it, which is information rather than a gap.

     Every one of the 36 is drillable. What differs between them is the
     register, not the coverage — see registerLabel(). */
  states: {},
  focus: null,            // the state whose operational data is loaded
  drillHint: null,

  cells: [], priorities: [], shelters: [], hospitals: [], routes: [], roads: [],
  alerts: [], sources: [], timeline: [], reports: [], models: []
};

/* ══════════════════════════════════════════════════════════════════
   SCENARIO — Chamoli district, Uttarakhand, active monsoon
   Localities are real places in the Alaknanda valley. Figures are
   representative of a district-scale monsoon event, not a record of
   any specific past disaster.
   ══════════════════════════════════════════════════════════════════ */

/* 5x5 operational grid inside the focused state, exactly as EchoTrace draws it.
   col = 'ABCDE'.indexOf(letter), row = number - 1. Each grid cell carries the
   H3 index it corresponds to at resolution 7. */
const UT_CELLS = [
  // grid  h3 index          locality        flood land  pop   elev slope hand  rain24 river
  ['A1','871e2a32fffffff','Gwaldam',          22,  48,  1230, 1629, 35, 44.0, 132, null],
  ['A2','871e2a35fffffff','Tharali',          45,  36,  3820,  856, 15,  6.8, 167, 0.83],
  ['A3','871e2a34fffffff','Dewal',            28,  55,   910, 1466, 38, 34.0, 143, null],
  ['A4','871e2a33fffffff','Narayanbagar',     35,  32,  1780, 1008, 20, 15.0, 151, null],
  ['A5','871e2a36fffffff','Adibadri',         33,  24,  1440, 1102, 23, 21.0, 154, null],

  ['B1','871e2a3afffffff','Simli',            64,  27,  4180,  744, 12,  3.4, 199, 1.01],
  ['B2','871e2a48fffffff','Karnaprayag',      87,  38, 11640,  788, 14,  2.8, 224, 1.09],
  ['B3','871e2a46fffffff','Gauchar',          76,  29,  6910,  762, 11,  2.2, 211, 1.04],
  ['B4','871e2a45fffffff','Sonala',           41,  47,  1540,  998, 28, 16.5, 172, null],
  ['B5','871e2a3bfffffff','Ravigram',         52,  31,  2740,  906, 18,  8.3, 176, null],

  ['C1','871e2a47fffffff','Langasu',          58,  33,  2380,  842, 19,  7.4, 189, 0.91],
  ['C2','871e2a4ffffffff','Nandprayag',       94,  61,  4820,  912, 22,  3.1, 218, 1.06],
  ['C3','871e2a4dfffffff','Chamoli Town',     88,  44,  8240,  954, 17,  4.6, 201, 1.02],
  ['C4','871e2a3cfffffff','Nauli',            69,  35,  3260,  880, 16,  5.1, 194, 0.97],
  ['C5','871e2a37fffffff','Kaleshwar',        59,  41,  2020, 1024, 21, 10.5, 183, null],

  ['D1','871e2a3ffffffff','Marwari',          44,  51,  1870, 1180, 24, 12.0, 165, null],
  ['D2','871e2a4cfffffff','Birahi',           71,  78,  1960, 1104, 34,  9.2, 196, 0.94],
  ['D3','871e2a4bfffffff','Pipalkoti',        63,  52,  3410, 1260, 26, 14.0, 178, 0.88],
  ['D4','871e2a40fffffff','Helang',           57,  66,  2140, 1420, 31, 18.0, 181, 0.89],
  ['D5','871e2a39fffffff','Ghat',             38,  69,  1650, 1310, 36, 24.0, 162, null],

  ['E1','871e2a49fffffff','Gulabkoti',        49,  86,  1120, 1388, 41, 22.0, 184, null],
  ['E2','871e2a43fffffff','Tapovan',          62,  84,  1380, 1902, 39, 26.0, 174, 0.86],
  ['E3','871e2a42fffffff','Joshimath',        46,  89, 16800, 1875, 33, 48.0, 158, null],
  ['E4','871e2a44fffffff','Reni',             55,  92,   820, 1620, 46, 31.0, 168, null],
  ['E5','871e2a3efffffff','Sukhi Top',        -1,  -1,   410, 2240, 48, 62.0, null,null]
];

const UT_SHELTERS = [
  // id      name                          zone   x    y    cap  occ  water food med state
  ['SH-201','GIC Karnaprayag',             'B2', .30, .34,  900, 612, 3.5, 4.0, 2, 'open'],
  ['SH-202','Chamoli Community Hall',      'C3', .50, .54,  520, 486, 1.4, 2.2, 1, 'open'],
  ['SH-203','Gauchar Relief Camp',         'B3', .28, .52, 1400, 730, 6.0, 5.5, 4, 'open'],
  ['SH-204','Pipalkoti Inter College',     'D3', .70, .54,  680, 214, 4.2, 3.8, 2, 'open'],
  ['SH-205','Joshimath ITBP Ground',       'E3', .90, .52, 2200,1180, 7.5, 6.0, 6, 'open'],
  ['SH-206','Nandprayag Sanskrit Vidyalaya','C2', .52, .34,  380, 380, 0.8, 1.1, 0, 'full'],
  ['SH-207','Tharali Block Office',        'A2', .10, .32,  450,  96, 5.0, 4.5, 1, 'open'],
  ['SH-208','Simli Degree College',        'B1', .32, .14,  760, 302, 3.0, 3.5, 2, 'open'],
  ['SH-209','Birahi Panchayat Bhawan',     'D2', .68, .32,  240,  88, 2.5, 2.0, 0, 'compromised'],
  ['SH-210','Gwaldam Tourist Rest House',  'A1', .08, .12,  300,  44, 6.0, 6.0, 1, 'standby']
];

const UT_HOSPITALS = [
  ['HOSP-1','District Hospital Gopeshwar', .46, .62, 180, 12],
  ['HOSP-2','CHC Karnaprayag',             .26, .26,  60,  4],
  ['HOSP-3','CHC Joshimath',               .86, .44,  40,  2]
];

/* Alerts carry an `age` in minutes and an `expires_in` in hours. Both are
   resolved against the wall clock at seed time and re-resolved whenever the
   page catches up, so an alert issued "45 minutes ago" is always 45 minutes
   ago — never 15:30 on a day that has passed. */
const UT_ALERTS = [
  { id: 'CAP-IMD-UT-014', auth: 'India Meteorological Department, Dehradun',
    sev: 'Extreme', urg: 'Immediate', cert: 'Observed', haz: 'flood',
    event: 'Extremely Heavy Rainfall Warning',
    head: 'Extremely heavy rainfall very likely over Chamoli and Rudraprayag districts',
    area: 'Chamoli, Rudraprayag — Uttarakhand', age: 72, expires_in: 7,
    inst: 'Avoid travel on hill roads. Move away from riverbanks and slope toes.' },
  { id: 'CAP-CWC-AL-006', auth: 'Central Water Commission, Flood Forecasting Directorate',
    sev: 'Severe', urg: 'Immediate', cert: 'Observed', haz: 'flood',
    event: 'River in Severe Flood Situation',
    head: 'Alaknanda at Nandprayag above danger level, rising',
    area: 'Alaknanda basin — Nandprayag to Karnaprayag', age: 37, expires_in: 12,
    inst: 'Riverside settlements to move to designated relief camps.' },
  { id: 'CAP-USDMA-021', auth: 'Uttarakhand State Disaster Management Authority',
    sev: 'Severe', urg: 'Expected', cert: 'Likely', haz: 'landslide',
    event: 'Landslide Warning',
    head: 'High landslide risk on NH-7 between Pipalkoti and Joshimath',
    area: 'Chamoli — NH-7 corridor', age: 114, expires_in: 19,
    inst: 'NH-7 restricted to emergency traffic. Do not halt below cut slopes.' },
  { id: 'CAP-IMD-UT-009', auth: 'India Meteorological Department, Dehradun',
    sev: 'Moderate', urg: 'Future', cert: 'Possible', haz: 'lightning',
    event: 'Thunderstorm with Lightning',
    head: 'Thunderstorm with lightning likely at isolated places',
    area: 'Garhwal division', age: 267, expires_in: 5,
    inst: 'Take shelter indoors. Avoid open fields and isolated trees.' }
];

const UT_ROADS = [
  // name, state, reason, minutes ago, reported by, confidence
  ['NH-7 · Pipalkoti–Helang', 'landslide', 'Debris across both lanes, 40 m stretch', 50, 'FO-Chamoli-04', 0.95],
  ['NH-7 · Nandprayag bridge approach', 'flooded', 'Water over carriageway, 0.4 m', 24, 'FO-Chamoli-02', 0.9],
  ['SH-9 · Karnaprayag–Gwaldam', 'partially_blocked', 'Single lane, boulder fall cleared partially', 132, 'FO-Chamoli-07', 0.85],
  ['NH-7 · Chamoli–Birahi', 'slow', 'Surface water, heavy traffic', 20, 'FO-Chamoli-04', 0.8],
  ['Link road · Reni–Tapovan', 'blocked', 'Slope failure, no access', 217, 'SDRF-Joshimath', 0.98],
  ['SH-9 · Tharali–Dewal', 'open', 'Reopened after clearance', 92, 'FO-Chamoli-09', 0.9]
];

const SOURCES = [
  ['sachet', 'NDMA · SACHET', 'live', 1, 62, 0.98, 'CAP feed'],
  ['imd', 'India Meteorological Department', 'live', 1, 420, 0.96, 'API portal'],
  ['cwc', 'Central Water Commission', 'stale', 1, 9840, 0.61, 'route pending'],
  ['incois', 'INCOIS', 'live', 1, 1180, 0.94, 'ERDDAP'],
  ['nrsc', 'ISRO · NRSC Bhuvan', 'live', 1, 2740, 0.88, 'WMS'],
  ['ncs', 'National Center for Seismology', 'nc', 1, null, null, 'registration pending'],
  /* The three below are really fetched by this browser at run time — see
     src/livedata.js. They open as CONNECTING and are moved to LIVE, STALE
     or FAILED by whatever the network actually does. Nothing here is
     seeded with a status it has not earned. */
  ['usgs', 'USGS FDSN · earthquakes', 'connecting', 0, null, null, 'connecting'],
  ['openmeteo', 'Open-Meteo · rain, temperature, wind, CAPE', 'connecting', 0, null, null, 'connecting'],
  ['glofas', 'ECMWF GloFAS v4 · river discharge', 'connecting', 0, null, null, 'connecting'],
  ['overpass', 'OpenStreetMap', 'live', 0, 51200, 0.91, 'daily'],
  ['firms', 'NASA FIRMS', 'nc', 0, null, null, 'registration pending']
];

const MODELS = [
  ['flood-lgbm-v0.4.0', 'flood', 'LightGBM', 6, 0.941, 0.727, 0.93, 0.61, 0.038, 1],
  ['landslide-lgbm-v0.3.1', 'landslide', 'LightGBM', 24, 0.907, 0.612, 0.91, 0.48, 0.052, 1],
  ['flood-logreg-v0.1.0', 'flood', 'Logistic Regression', 6, 0.862, 0.541, 0.88, 0.44, 0.071, 0]
];

/* ══════════════════════════════════════════════════════════════════
   SEED / LOAD

   seed()        builds the national picture — all 36 states/UTs.
   loadState(id) loads one state's operational data into the store.

   The split matters: the national risk surface is computed for every
   state from feeds that genuinely cover the whole country, while the
   registers that only exist locally are loaded per state and marked.
   ══════════════════════════════════════════════════════════════════ */

/** The 36-entry national picture, rebuilt from src/states.js. */
function seedStates() {
  S.states = {};
  for (const id of stateIds()) {
    const P = stateProfile(id);
    /* The seeded scores are a seasonal baseline; what the clock says
       shifts them, so a February open and a July open do not start from
       the same country. */
    const hz = {};
    for (const h in P.hz) hz[h] = Math.max(4, Math.min(98, Math.round(P.hz[h] * clockFactor(h))));

    /* The situation label and the note have to follow the season too.
       A February open that scores flood at 18 must not still read
       "Alaknanda above danger level, 14 relief camps activated" — the
       figures and the words would be describing different months. */
    const top = Object.entries(hz).sort((a, b) => b[1] - a[1]);
    const [topHz, topV] = top[0];
    const named = top.filter(([, v]) => v >= 60).map(([h]) => HAZ[h].name);
    const dis = named.length ? named.slice(0, 2).join(' + ')
      : topV >= 40 ? HAZ[topHz].name + ' Watch'
      : 'Monitored';
    /* the authored note describes an active event, so it is only shown
       while there is one */
    const note = topV >= 60 ? P.note
      : topV >= 40 ? `${HAZ[topHz].name} risk is elevated for the season. ${seasonLabel()[1]}`
      : `No declared event. ${seasonLabel()[1]}`;
    /* and an event that is not happening did not start eight hours ago */
    const age = topV >= 60 ? P.age : Math.round(P.age * 0.35);

    S.states[id] = {
      id, name: P.n, district: P.d, pop: P.pop, hz,
      primary: topHz, since_age: age, since: ago(age),
      dis, note, reg: P.reg, scope: P.scope,
      coastal: !!P.cst, drill: 1
    };
  }
}

/** The state whose operational data is currently in the store. */
function loadState(id) {
  const P = stateProfile(id);
  if (!P) return false;
  S.focus = id;

  /* The authored Chamoli scenario describes a live monsoon flood. It is
     used while that is what the season and the scores say is happening;
     out of season the state is loaded the same way as every other. */
  const utActive = id === 'ut' && (S.states.ut ? S.states.ut.hz.flood >= 60 : true);

  if (utActive) {
    /* Chamoli is the integrated district: hand-surveyed localities,
       a real shelter register, real road segments. */
    S.cells = UT_CELLS.map(([gid, h3, name, fl, ls, pop, elev, slope, hand, rain, riv]) => {
      const conf = riv == null && fl > 0 ? 0.62 : fl < 0 ? 0.0 : 0.84 - (hand > 30 ? 0.09 : 0);
      return {
        id: gid, cell_id: h3, short: h3.slice(4, 10).toUpperCase(),
        col: 'ABCDE'.indexOf(gid[0]), row: +gid[1] - 1, name,
        risk: { flood: fl, landslide: ls },
        probability: { flood: fl < 0 ? null : +(fl / 100 * 0.86).toFixed(3),
                       landslide: ls < 0 ? null : +(ls / 100 * 0.79).toFixed(3) },
        confidence: { flood: fl < 0 ? 0.0 : +conf.toFixed(2),
                      landslide: ls < 0 ? 0.0 : +(conf - 0.06).toFixed(2) },
        pop, elevation_m: elev, slope_deg: slope, hand_m: hand,
        rainfall_24h: rain, rainfall_72h: rain == null ? null : Math.round(rain * 2.3),
        river_ratio: riv, soil_moisture: rain == null ? null : +(0.22 + rain / 900).toFixed(2),
        degraded: riv == null && fl > 0 ? ['cwc'] : [],
        hist: [-3, -2, -1, 0].map(k => ({
          t: ago(-k * 45),
          flood: Math.max(0, Math.round(fl - (-k) * (fl > 60 ? 17 : 8))),
          landslide: Math.max(0, Math.round(ls - (-k) * (ls > 60 ? 13 : 6)))
        }))
      };
    });
    S.shelters = mkShelters(UT_SHELTERS, [30, 54, 22, 97, 12, 17, 110, 43, 182, 272]);
    S.hospitals = UT_HOSPITALS.map(([hid, name, x, y, beds, icu]) => ({
      shelter_id: hid, id: hid, name, x, y, k: 'med', st: 'open',
      beds, icu, d: `${beds} beds · ${icu} ICU` }));
    S.alerts = UT_ALERTS.map((a, i) => ({ ...a, ack: 0, n: i, t: ago(a.age), exp: ahead(a.expires_in) }));
    S.roads = UT_ROADS.map(([name, state, reason, age, by, conf], i) => ({
      road_id: 90100 + i, name, state, reason, age, t: ago(age), by,
      confidence: conf, zone: ['D3', 'C2', 'A2', 'C3', 'E4', 'A3'][i] }));
    S.reports = UT_REPORTS.map(r => ({ ...r, t: ago(r.age) }));
  } else {
    const cells = buildStateCells(id);
    S.cells = cells;
    S.shelters = mkShelters(buildStateShelters(id, cells), null);
    S.hospitals = buildStateHospitals(id, cells).map(([hid, name, x, y, beds, icu]) => ({
      shelter_id: hid, id: hid, name, x, y, k: 'med', st: 'open',
      beds, icu, d: `${beds} beds · ${icu} ICU` }));
    S.alerts = buildStateAlerts(id, cells)
      .map((a, i) => ({ ...a, ack: 0, n: i, t: ago(a.age), exp: ahead(a.expires_in) }));
    S.roads = buildStateRoads(id, cells).map(([name, state, reason, age, by, conf, zone], i) => ({
      road_id: 90100 + i, name, state, reason, age, t: ago(age), by, confidence: conf, zone }));
    S.reports = buildStateReports(id, cells);
  }

  /* the hazard layer must be one this state actually has */
  if (!S.cells.some(c => (c.risk[S.hazard] ?? -1) >= 0)) {
    S.hazard = stateProfile(id).pri;
  }
  computePriorities();
  computeRoutes();
  return true;
}

/** Shared shelter shaping — the capacity engine's output contract (§17). */
function mkShelters(rows, ages) {
  return rows.map(([id, name, zone, x, y, cap, occ, water, food, med, state], i) => {
    const spaceAvail = Math.max(Math.floor(cap * 0.9) - occ, 0);
    const waterAvail = water >= 2 ? spaceAvail : Math.floor(spaceAvail * Math.max(water / 2, 0));
    const foodAvail  = food  >= 2 ? spaceAvail : Math.floor(spaceAvail * Math.max(food / 2, 0));
    const medAvail   = Math.max(med * 250 - occ, 0);
    const cellObj = S.cells.find(c => c.id === zone);
    const hz = S.hazard;
    const hazardRisk = cellObj ? Math.max(cellObj.risk[hz] ?? 0, 0) : 0;
    let binding = 'space', eff = spaceAvail;
    const cands = { space: spaceAvail, water: waterAvail, food: foodAvail, medical: medAvail };
    for (const k in cands) if (cands[k] < eff) { eff = cands[k]; binding = k; }
    let operational = true;
    if (state === 'compromised') { eff = 0; operational = false; binding = 'shelter is compromised'; }
    else if (hazardRisk >= 60)   { eff = 0; operational = false; binding = 'inside hazard footprint'; }
    else if (state === 'standby'){ eff = Math.floor(eff * 0.5); binding = binding + ' (standby)'; }
    const agem = ages ? ages[i] : Math.round(6 + zhash(id + 'age') * 240);
    return {
      shelter_id: id, name, zone, x, y, k: 'shelter',
      max_capacity: cap, current_occupancy: occ, state,
      water_days: water, food_days: food, medical_staff: med,
      effective_capacity: Math.max(eff, 0), raw_available: Math.max(cap - occ, 0),
      binding_constraint: binding, operational, hazard_risk: hazardRisk,
      utilisation: +(occ / cap).toFixed(3),
      st: operational ? (eff > 0 ? 'open' : 'full') : 'closed',
      reported_age: agem, reported: ago(agem),
      d: `${nf(occ)} / ${nf(cap)} places used`
    };
  });
}

/* ── The national alert feed ────────────────────────────────────────
   At national scope the alert list is national: the most severe alert
   in force in each affected state, newest first. This is what makes
   "the latest disaster" visible without drilling into 36 states. */
function buildNationalFeed() {
  const rows = [];
  for (const id of stateIds()) {
    const P = stateProfile(id);
    const cells = id === 'ut' ? S.cells : buildStateCells(id);
    const a = buildStateAlerts(id, cells)[0];
    if (!a) continue;
    rows.push({ ...a, state: id, stateName: P.n, ack: 0,
                t: ago(a.age), exp: ahead(a.expires_in), stampedAt: Date.now() });
  }
  rows.sort((a, b) => a.age - b.age);
  S.national = rows;
  S.feedCursor = 0;
  return rows;
}

/* ── Keeping the national feed honest ────────────────────────────────
   Building the feed once at boot and never touching it again is the
   exact failure this platform exists to avoid: a strip labelled "newest
   warning · 13 minutes ago" that still says 13 minutes an hour later,
   and that never learns about a warning the platform itself has since
   issued. Three things have to happen on a tick:

     1. every entry ages against the wall clock,
     2. expired warnings leave,
     3. one state is re-derived per tick, so all 36 turn over in a couple
        of minutes without recomputing the country every four seconds.
*/
function refreshNationalFeed() {
  const now = Date.now();
  const ids = stateIds();

  for (const row of S.national) {
    const elapsed = (now - (row.stampedAt || now)) / 60000;
    if (elapsed >= 1) {
      row.age += elapsed;
      row.stampedAt = now;
      row.t = ago(row.age);
    }
  }

  /* a warning that has run out is not the newest warning */
  S.national = S.national.filter(r => r.age < r.expires_in * 60 + 240);

  /* rotate: one state re-derived per call */
  if (ids.length) {
    const id = ids[S.feedCursor % ids.length];
    S.feedCursor = (S.feedCursor + 1) % ids.length;
    const cells = id === S.focus ? S.cells : buildStateCells(id);
    const a = buildStateAlerts(id, cells)[0];
    if (a) {
      const i = S.national.findIndex(r => r.state === id);
      const row = { ...a, state: id, stateName: stateProfile(id).n, ack: 0,
                    t: ago(a.age), exp: ahead(a.expires_in), stampedAt: now };
      if (i >= 0) { if (a.age < S.national[i].age) S.national[i] = row; }
      else S.national.push(row);
    }
  }

  S.national.sort((a, b) => a.age - b.age);
  return S.national;
}

/** An alert raised anywhere must reach the national feed immediately —
    otherwise the platform can issue a warning and still report an older
    one as the newest thing that happened. */
function pushNational(alert, stateId) {
  const id = stateId || S.focus || 'ut';
  S.national = S.national.filter(r => r.id !== alert.id);
  S.national.unshift({ ...alert, state: id,
                       stateName: (S.states[id] || {}).name || id,
                       stampedAt: Date.now() });
  if (S.national.length > 60) S.national.pop();
  S.national.sort((a, b) => a.age - b.age);
}

/** Peak risk anywhere in the country for the current hazard layer. */
function nationalPeak(hazard) {
  const h = hazard || S.hazard;
  let best = null;
  for (const id in S.states) {
    const v = S.states[id].hz[h];
    if (v != null && (best == null || v > best.v)) best = { id, v, st: S.states[id] };
  }
  return best;
}

function seed() {
  seedStates();
  S.sources = SOURCES.map(([key, authority, status, primary, age, q, mode]) => ({
    key, authority, status, is_primary: !!primary, age_seconds: age, quality_score: q, mode
  }));
  S.models = MODELS.map(([v, h, alg, hz, roc, pr, rec, prec, ece, active]) => ({
    model_version: v, hazard: h, algorithm: alg, horizon_hours: hz,
    roc_auc: roc, pr_auc: pr, recall: rec, precision: prec, ece, is_active: !!active
  }));

  loadState('ut');
  buildNationalFeed();

  /* The seeded timeline is the Chamoli flood's own story. Out of season
     there is no such event, so the log opens with what is actually true:
     the pipeline running and nothing declared. */
  const active = S.states.ut && S.states.ut.hz.flood >= 60;
  S.timeline = !active ? [
    [2,  'model',   `Inference tick complete — ${S.cells.length} cells scored across all 36 states`, '#0B6BA8'],
    [14, 'quality', 'All primary sources reporting inside their staleness windows', '#1B7F3B'],
    [31, 'model',   `Seasonal baseline applied — ${seasonLabel()[0].toLowerCase()}`, '#12447E'],
    [58, 'event',   'No disaster declared. Monitoring continues across every state and union territory.', '#5B6779']
  ].map(([age, k, x, c]) => ({ t: ago(age) + ':00', k, x, c })) : [
    [0,   'risk',    'Zone <b>C2</b> Nandprayag escalated to <b>CRITICAL</b> — flood risk 94', '#B3261E'],
    [12,  'model',   'Inference tick complete — 25 cells scored, flood-lgbm-v0.4.0', '#0B6BA8'],
    [17,  'shelter', '<b>SH-206</b> Nandprayag reported <b>FULL</b> by shelter operator', '#A96700'],
    [20,  'road',    '<b>NH-7 Chamoli–Birahi</b> reported SLOW — surface water', '#A96700'],
    [24,  'road',    '<b>NH-7 Nandprayag approach</b> reported <b>FLOODED</b> — 0.4 m', '#B3261E'],
    [30,  'shelter', '<b>SH-201</b> GIC Karnaprayag occupancy updated to 612 / 900', '#0B6BA8'],
    [37,  'alert',   'Official alert from <b>Central Water Commission</b> — river above danger level', '#B3261E'],
    [50,  'road',    '<b>NH-7 Pipalkoti–Helang</b> reported <b>LANDSLIDE</b> — both lanes', '#B3261E'],
    [72,  'alert',   'Official alert from <b>IMD Dehradun</b> — extremely heavy rainfall', '#B3261E'],
    [87,  'risk',    'Priority list recomputed — merge sort, O(n log n)', '#12447E'],
    [114, 'alert',   'Official alert from <b>USDMA</b> — landslide warning NH-7', '#D2551A'],
    [142, 'quality', 'Source <b>CWC</b> marked <b>STALE</b> — flood confidence reduced to 0.62', '#A96700'],
    [212, 'event',   'Flood event declared — Chamoli District, Uttarakhand', '#B3261E']
  ].map(([age, k, x, c]) => ({ t: ago(age) + ':00', k, x, c }));
}

/* Chamoli's citizen reports, carried as ages like everything else. */
const UT_REPORTS = [
  { id: 'CR-40218', cat: 'Water entering houses', loc: 'Nandprayag bazaar', cell: 'C2', age: 22,
    desc: 'Water has come into the ground floor of shops near the bridge.', st: 'verified', by: 'FO-Chamoli-02' },
  { id: 'CR-40221', cat: 'Road blocked', loc: 'Pipalkoti–Helang, NH-7', cell: 'D3', age: 52,
    desc: 'Big rocks and mud on the road. Nothing can pass.', st: 'verified', by: 'FO-Chamoli-04' },
  { id: 'CR-40226', cat: 'Cracks in ground', loc: 'Joshimath, Sunil ward', cell: 'E3', age: 8,
    desc: 'New cracks have appeared in the lane since morning.', st: 'pending', by: null },
  { id: 'CR-40229', cat: 'Shelter overcrowded', loc: 'Nandprayag Vidyalaya', cell: 'C2', age: 3,
    desc: 'The camp is full, people are standing outside in the rain.', st: 'pending', by: null }
];

/* ══════════════════════════════════════════════════════════════════
   PRIORITY — mirrors backend/app/priority/engine.py
   Same weights, same normalisation, same merge sort.
   ══════════════════════════════════════════════════════════════════ */
const WEIGHTS = {
  hazard_risk: 0.30, population_exposure: 0.22, vulnerability: 0.18,
  evacuation_difficulty: 0.12, time_to_hazard: 0.13, accessibility: 0.05
};
const WLABEL = {
  hazard_risk: 'Hazard risk', population_exposure: 'Population exposure',
  vulnerability: 'Vulnerability', evacuation_difficulty: 'Evacuation difficulty',
  time_to_hazard: 'Time to hazard', accessibility: 'Accessibility'
};

/* footprint fraction — the §11 rule: overlay, not probability × population */
function footprint(cell, hazard) {
  if (hazard === 'flood') {
    const h = cell.hand_m;
    if (h == null) return [0.55, 'no height-above-drainage data'];
    if (h <= 2) return [0.90, 'cell sits at drainage level'];
    if (h <= 5) return [0.65, `${h.toFixed(0)} m above nearest drainage`];
    if (h <= 10) return [0.35, `${h.toFixed(0)} m above nearest drainage`];
    if (h <= 20) return [0.12, `${h.toFixed(0)} m above nearest drainage`];
    return [0.03, 'well above the drainage line'];
  }
  const s = cell.slope_deg;
  if (s == null) return [0.25, 'no slope data'];
  if (s >= 35) return [0.40, `steep terrain, ${s}°`];
  if (s >= 25) return [0.30, `failure-prone slope, ${s}°`];
  if (s >= 15) return [0.15, `moderate slope, ${s}°`];
  return [0.05, 'gentle terrain'];
}

function exposureOf(cell, hazard) {
  const p = cell.probability[hazard];
  if (p == null) return null;
  const [frac, why] = footprint(cell, hazard);
  const occ = 0.92;
  const inFootprint = Math.round(cell.pop * frac * occ);
  return { frac, why, inFootprint, expected: inFootprint * p, occ };
}

function vulnerabilityOf(cell) {
  const evac = Math.min((cell.slope_deg > 30 ? 62 : 38) / 90, 1);
  const routes = cell.slope_deg > 40 ? 1 : cell.slope_deg > 25 ? 2 : 3;
  const routeTerm = { 0: 1, 1: 0.85, 2: 0.45 }[routes] ?? 0.15;
  const med = Math.min((cell.slope_deg > 35 ? 42 : 18) / 50, 1);
  const shelter = Math.min((cell.slope_deg > 35 ? 11 : 5) / 15, 1);
  const age = 0.44, assist = 0.32;
  const terms = { evacuation_difficulty: evac, medical_access: med, route_redundancy: routeTerm,
                  shelter_access: shelter, age_structure: age, assistance_need: assist };
  const w = { evacuation_difficulty: .22, medical_access: .18, route_redundancy: .16,
              shelter_access: .16, age_structure: .15, assistance_need: .13 };
  let score = 0; for (const k in terms) score += terms[k] * w[k];
  return { score: +Math.min(score * 1.06, 1).toFixed(4), terms, routes };
}

function timeToImpact(cell, hazard) {
  if (hazard === 'flood') {
    if (cell.river_ratio == null) return cell.rainfall_24h > 190 ? 6 : null;
    if (cell.river_ratio >= 1) return 0;
    return +(((1 - cell.river_ratio) / 0.02)).toFixed(1);
  }
  return cell.rainfall_24h > 170 ? 12 : cell.rainfall_24h > 140 ? 20 : null;
}

/* merge sort — stable, O(n log n), ties broken exactly as the backend does */
let SORT_STATS = { n: 0, comparisons: 0, depth: 0 };
function mergeSort(arr, key) {
  SORT_STATS.n = SORT_STATS.n || arr.length;
  const rec = (a, d) => {
    SORT_STATS.depth = Math.max(SORT_STATS.depth, d);
    if (a.length <= 1) return a;
    const mid = a.length >> 1;
    const L = rec(a.slice(0, mid), d + 1), R = rec(a.slice(mid), d + 1);
    const out = []; let i = 0, j = 0;
    while (i < L.length && j < R.length) {
      SORT_STATS.comparisons++;
      if (cmp(key(R[j]), key(L[i])) < 0) out.push(R[j++]); else out.push(L[i++]);
    }
    return out.concat(L.slice(i), R.slice(j));
  };
  return rec(arr.slice(), 0);
}
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };
const priorityKey = z => [-z.priority_score, -z.expected_exposed,
  z.time_to_impact_h == null ? 1e9 : z.time_to_impact_h, z.cell_id];

function computePriorities() {
  const hazard = S.hazard;
  SORT_STATS = { n: 0, comparisons: 0, depth: 0 };
  const scored = [];
  for (const cell of S.cells) {
    const risk = cell.risk[hazard];
    if (risk == null || risk < 20) continue;
    const ex = exposureOf(cell, hazard); if (!ex) continue;
    const vu = vulnerabilityOf(cell);
    const tti = timeToImpact(cell, hazard);
    const evacMin = vu.routes <= 1 ? 78 : vu.routes === 2 ? 52 : 34;

    const n = {
      hazard_risk: Math.min(risk / 100, 1),
      population_exposure: Math.min(Math.log1p(ex.expected) / Math.log1p(5000), 1),
      vulnerability: vu.score,
      evacuation_difficulty: Math.min(evacMin / 90, 1),
      time_to_hazard: tti == null ? 0.4 : tti <= 0 ? 1 : Math.min(Math.exp(-tti / 8), 1),
      accessibility: { 0: 1, 1: 0.8, 2: 0.45 }[vu.routes] ?? 0.2
    };
    const notes = {
      hazard_risk: `predicted hazard risk ${risk}/100`,
      population_exposure: `about ${nf(Math.round(ex.expected))} people expected to be exposed`,
      vulnerability: `vulnerability index ${vu.score.toFixed(2)}`,
      evacuation_difficulty: `nearest shelter about ${evacMin} minutes away`,
      time_to_hazard: tti == null ? 'time to impact not estimated'
        : tti <= 0 ? 'hazard conditions are already present'
        : `estimated ${tti} hours before conditions reach this area`,
      accessibility: vu.routes <= 1 ? 'only one route out — a single blockage isolates this area'
        : `${vu.routes} independent routes out`
    };

    /* The displayed contribution is the audit trail, so the score is the sum
       of exactly the numbers shown — round first, then total. Mirrors
       backend/app/priority/engine.py. */
    const terms = {}; let total = 0;
    for (const k in WEIGHTS) {
      const contrib = +(n[k] * WEIGHTS[k]).toFixed(6); total += contrib;
      terms[k] = { normalised: +n[k].toFixed(4), weight: WEIGHTS[k],
                   contribution: contrib, note: notes[k] };
    }
    total = +total.toFixed(6);
    const band = total >= 0.75 ? 'critical' : total >= 0.55 ? 'high' : total >= 0.32 ? 'medium' : 'low';
    const reasons = Object.entries(terms)
      .sort((a, b) => b[1].contribution - a[1].contribution)
      .filter(e => e[1].contribution >= 0.15 * total).slice(0, 4).map(e => e[1].note);
    if (cell.confidence[hazard] < 0.66)
      reasons.push(`input confidence is only ${Math.round(cell.confidence[hazard] * 100)}% — verify on the ground before acting`);

    scored.push({
      cell_id: cell.cell_id, id: cell.id, name: cell.name, hazard,
      col: cell.col, row: cell.row,
      priority_score: +total.toFixed(6), band, terms, reasons,
      expected_exposed: Math.round(ex.expected), people_to_move: ex.inFootprint,
      footprint: ex, vulnerability: vu, risk, time_to_impact_h: tti,
      confidence: cell.confidence[hazard]
    });
  }
  SORT_STATS.n = scored.length;
  S.priorities = mergeSort(scored, priorityKey).map((z, i) => ({ ...z, rank: i + 1 }));
}

/* ══════════════════════════════════════════════════════════════════
   ROUTING — greedy priority assignment with capacity reservation
   ══════════════════════════════════════════════════════════════════ */
function computeRoutes() {
  const remaining = {};
  S.shelters.forEach(s => { remaining[s.shelter_id] = s.operational ? s.effective_capacity : 0; });
  const routes = [];
  const blocked = S.roads.filter(r => ['blocked', 'flooded', 'landslide'].includes(r.state));
  const blockedZones = new Set(blocked.map(r => r.zone));

  for (const z of S.priorities.slice(0, 14)) {
    const cell = S.cells.find(c => c.id === z.id); if (!cell) continue;
    let toPlace = z.people_to_move, used = 0;

    /* grid distance: cell centre (col+.5)/5,(row+.5)/5 to the shelter's
       fractional position, scaled to the district's ~32 km span */
    const cx = (cell.col + 0.5) / 5, cy = (cell.row + 0.5) / 5;
    const cands = S.shelters
      .filter(s => s.operational && remaining[s.shelter_id] > 0)
      .map(s => {
        const d = Math.hypot(s.x - cx, s.y - cy) * 32;
        const detour = blockedZones.has(s.zone) || blockedZones.has(cell.id);
        const hazardOnRoute = Math.min(s.hazard_risk / 100 * 0.8 + (detour ? 0.22 : 0), 1);
        const mins = d / 22 * 60 * (1 + 2.2 * hazardOnRoute);
        return { s, d, mins, hazardOnRoute, detour,
                 score: mins + hazardOnRoute * 25
                        - Math.min(remaining[s.shelter_id] / Math.max(z.people_to_move, 1), 2) * 6 };
      })
      .sort((a, b) => a.score - b.score);

    for (const c of cands) {
      if (toPlace <= 0 || used >= 3) break;
      const take = Math.min(toPlace, remaining[c.s.shelter_id]);
      if (take <= 0) continue;
      routes.push({
        origin_cell: z.cell_id, origin_id: z.id, origin: z.name,
        shelter_id: c.s.shelter_id, shelter_name: c.s.name, people: take, rank: z.rank,
        distance_km: +c.d.toFixed(1), travel_min: Math.round(c.mins),
        hazard_exposure: +c.hazardOnRoute.toFixed(3), detour: c.detour,
        before_impact: z.time_to_impact_h == null ? null : (c.mins / 60) < z.time_to_impact_h
      });
      remaining[c.s.shelter_id] -= take; toPlace -= take; used++;
    }
    if (toPlace > 0)
      routes.push({ origin_cell: z.cell_id, origin_id: z.id, origin: z.name,
        shelter_id: null, shelter_name: null, people: toPlace, rank: z.rank,
        unassigned: true, reason: 'shelter capacity within reach is exhausted' });
  }
  S.routes = routes;
}

/* ── lookups ── */
const cellById = id => S.cells.find(c => c.cell_id === id || c.id === id);
const shelterById = id => S.shelters.find(s => s.shelter_id === id);
const zoneById = id => S.priorities.find(z => z.cell_id === id || z.id === id);

/* `log` takes markup: its callers bold the subject of the entry. That
   makes every interpolated value a sink, so each call site escapes what
   it inserts — see the callers in boot.js, actions.js and views.js. */
function log(k, x, c) {
  S.timeline.unshift({ t: clk(), k, x, c, fresh: 1 });
  if (S.timeline.length > 60) S.timeline.pop();
  if (typeof markRagDirty === 'function') markRagDirty();
  if (S.view === 'map') paintTimeline();
}
/* say() is in src/ui.js, alongside the rest of the accessibility layer. */

/* ── toast ── */
const TK = {
  ok: ['var(--oks)', 'var(--ok)', 'M20 6 9 17l-5-5'],
  info: ['var(--infos)', 'var(--info)', 'M12 16v-5M12 8h.01'],
  warn: ['var(--warns)', 'var(--warn)', 'M12 9v4M12 17h.01'],
  crit: ['var(--crits)', 'var(--crit)', 'M12 9v4M12 17h.01']
};
/* Toasts carry names and notes that arrive from feeds, from operator
   input and from the photo credit box — `pickState` passes a state's
   note, `saveShelter` passes a shelter's name, the sign-in error passes
   whatever was typed into the operator field. Every one of those is
   attacker-reachable, and this was the one sink in the application that
   put them into innerHTML unescaped. No caller passes markup, so both
   arguments are escaped unconditionally. */
function toast(t, s, k = 'info') {
  const [bg, fg, d] = TK[k] || TK.info;
  const e = document.createElement('div');
  e.className = 'tst'; e.style.borderLeftColor = fg;
  e.innerHTML = `<div class="i" style="background:${bg};color:${fg}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="${d}"/>${k !== 'ok' ? '<circle cx="12" cy="12" r="9"/>' : ''}</svg></div>
    <div style="flex:1"><div class="t">${esc(t)}</div><div class="s">${esc(s)}</div></div>`;
  const box = $('tsts');
  while (box.children.length > 3) box.firstChild.remove();
  box.appendChild(e); say(t + '. ' + s);
  setTimeout(() => { e.classList.add('out'); setTimeout(() => e.remove(), 250); }, 4400);
}

seed();
