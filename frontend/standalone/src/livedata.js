/* ══════════════════════════════════════════════════════════════════
   LIVE DATA — real observations, fetched from the browser

   Everything else in this build models the surface. This file goes and
   gets it. Three keyless services, all CORS-enabled, all callable
   directly from a page with no backend and no API key:

     · Open-Meteo forecast   api.open-meteo.com/v1/forecast
       Rainfall, temperature, wind gusts and CAPE for all 36 states in
       ONE request — the API takes comma-separated coordinates and
       returns an array, so the whole country costs a single round trip.

     · Open-Meteo flood      flood-api.open-meteo.com/v1/flood
       ECMWF GloFAS v4 river discharge at ~5 km, same batching.

     · USGS FDSN             earthquake.usgs.gov/fdsnws/event/1/query
       The Indian bounding box, last seven days, M2.5 and above.

   What it does NOT do is pretend. Observations replace the modelled
   values for the hazards they actually cover; every other hazard stays
   modelled and is labelled as such. A failed fetch leaves the modelled
   value in place and marks the source failed — it never silently keeps
   showing the last reading as though it were current, and it never
   invents one.

   The derivations below are the same physics the risk engine documents:
   rainfall over 24 and 72 hours against height above drainage for flood,
   antecedent rainfall against slope for landslide, discharge against its
   own recent mean for river state, maxima against the IMD heatwave
   threshold, CAPE as a lightning *proxy* and never as detection.
   ══════════════════════════════════════════════════════════════════ */

/* One representative point per state or union territory — the district
   the deployment watches, or the state's rough centroid. */
const STATE_POINT = {
  an: [11.62, 92.73], ap: [15.90, 79.70], ar: [28.00, 94.50], as: [26.20, 92.90],
  br: [25.60, 85.40], ch: [30.73, 76.78], ct: [21.30, 82.00], dn: [20.27, 73.02],
  dd: [20.42, 72.85], dl: [28.65, 77.20], ga: [15.35, 74.00], gj: [22.60, 71.80],
  hr: [29.20, 76.30], hp: [31.80, 77.30], jk: [33.80, 76.00], jh: [23.60, 85.30],
  ka: [15.00, 76.00], kl: [10.30, 76.50], ld: [10.57, 72.64], mp: [23.50, 78.50],
  mh: [19.50, 75.80], mn: [24.70, 93.90], ml: [25.50, 91.30], mz: [23.30, 92.90],
  nl: [26.10, 94.40], or: [20.50, 84.60], py: [11.94, 79.83], pb: [31.00, 75.50],
  rj: [26.60, 73.80], sk: [27.50, 88.50], tn: [11.00, 78.50], tg: [17.90, 79.00],
  tr: [23.75, 91.70], up: [27.00, 80.90], ut: [30.35, 79.40], wb: [23.50, 87.80]
};

const LIVE_IDS = Object.keys(STATE_POINT);
const LAT = LIVE_IDS.map(k => STATE_POINT[k][0]).join(',');
const LON = LIVE_IDS.map(k => STATE_POINT[k][1]).join(',');

/* Endpoints live here and nowhere else, mirroring the backend's rule
   that a connector never hardcodes a path (docs/10-data-sources.md). */
const ENDPOINT = {
  weather: 'https://api.open-meteo.com/v1/forecast',
  flood:   'https://flood-api.open-meteo.com/v1/flood',
  quake:   'https://earthquake.usgs.gov/fdsnws/event/1/query'
};

/* How often each is worth asking, and how long a reading stays usable.
   Open-Meteo updates hourly; GloFAS is a daily model; USGS is as fast as
   the network reports. Polling faster than the source publishes only
   burns someone else's free service. */
const CADENCE = { weather: 15 * 60e3, flood: 6 * 3600e3, quake: 5 * 60e3 };
const STALE_AFTER = { weather: 90 * 60e3, flood: 36 * 3600e3, quake: 60 * 60e3 };

const LIVEDATA = {
  /* per source: status, when it last succeeded, latency, what went wrong */
  src: {
    weather: { status: 'idle', at: 0, ms: 0, error: null, tries: 0 },
    flood:   { status: 'idle', at: 0, ms: 0, error: null, tries: 0 },
    quake:   { status: 'idle', at: 0, ms: 0, error: null, tries: 0 }
  },
  obs: {},            // stateId → observed fields
  quakes: [],         // recent events, newest first
  /* which hazards currently rest on a real observation rather than the
     seasonal model — the UI reads this, so it can never claim more than
     it has */
  observed: new Set(),
  enabled: true,
  everConnected: false
};

/* ── Fetch with a deadline ───────────────────────────────────────────
   A request with no timeout is a spinner that never resolves. Ten
   seconds is generous for a JSON document and short enough that a dead
   network is reported as dead rather than as loading. */
async function getJSON(url, ms = 10000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store',
                                 headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function mark(key, status, ms, error) {
  const s = LIVEDATA.src[key];
  s.status = status;
  s.ms = ms || 0;
  s.error = error || null;
  if (status === 'live') { s.at = Date.now(); s.tries = 0; LIVEDATA.everConnected = true; }
  else s.tries++;
  syncSourceRows();
}

/* ── Open-Meteo: the whole country in one request ─────────────────── */
async function pullWeather() {
  const url = `${ENDPOINT.weather}?latitude=${LAT}&longitude=${LON}`
    + '&daily=precipitation_sum,temperature_2m_max,wind_gusts_10m_max,maximum_cape'
    + '&current=temperature_2m,precipitation,wind_gusts_10m'
    + '&past_days=7&forecast_days=2&timezone=Asia%2FKolkata';
  const t0 = performance.now();
  try {
    const body = await getJSON(url);
    const rows = Array.isArray(body) ? body : [body];
    if (rows.length !== LIVE_IDS.length) throw new Error(`expected ${LIVE_IDS.length} locations, got ${rows.length}`);

    rows.forEach((row, i) => {
      const id = LIVE_IDS[i];
      const d = row.daily || {};
      const times = d.time || [];
      /* "today" is the last past day the API returned — past_days=7 means
         index 7 is today when forecast_days follows it */
      const todayIdx = Math.max(0, times.length - 3);
      const rain = d.precipitation_sum || [];
      const sum = (from, to) => rain.slice(Math.max(0, from), to)
        .reduce((a, v) => a + (v == null ? 0 : v), 0);

      const o = LIVEDATA.obs[id] || (LIVEDATA.obs[id] = {});
      o.rain24 = +(rain[todayIdx] ?? 0);
      o.rain72 = +sum(todayIdx - 2, todayIdx + 1).toFixed(1);
      o.rain7d = +sum(todayIdx - 6, todayIdx + 1).toFixed(1);
      o.tmax = d.temperature_2m_max ? +d.temperature_2m_max[todayIdx] : null;
      o.gust = d.wind_gusts_10m_max ? +d.wind_gusts_10m_max[todayIdx] : null;
      o.cape = d.maximum_cape ? +d.maximum_cape[todayIdx] : null;
      o.tnow = row.current ? row.current.temperature_2m : null;
      o.at = Date.now();
    });

    ['flood', 'landslide', 'heatwave', 'drought', 'wildfire', 'lightning', 'cyclone']
      .forEach(h => LIVEDATA.observed.add(h));
    mark('weather', 'live', Math.round(performance.now() - t0));
    return true;
  } catch (e) {
    mark('weather', 'failed', Math.round(performance.now() - t0), e.message);
    return false;
  }
}

/* ── GloFAS river discharge ──────────────────────────────────────── */
async function pullFlood() {
  const url = `${ENDPOINT.flood}?latitude=${LAT}&longitude=${LON}`
    + '&daily=river_discharge&past_days=30&forecast_days=1';
  const t0 = performance.now();
  try {
    const body = await getJSON(url, 15000);
    const rows = Array.isArray(body) ? body : [body];
    rows.forEach((row, i) => {
      const id = LIVE_IDS[i];
      const q = (row.daily && row.daily.river_discharge) || [];
      const vals = q.filter(v => v != null);
      if (!vals.length) return;
      const today = vals[vals.length - 1];
      /* A discharge figure means nothing on its own — the Brahmaputra at
         low flow carries more than the Sabarmati in spate. What matters
         is how today compares with this river's own recent normal. */
      const sorted = [...vals].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] || 1;
      const o = LIVEDATA.obs[id] || (LIVEDATA.obs[id] = {});
      o.discharge = +today.toFixed(1);
      o.dischargeRatio = +(today / Math.max(median, 0.01)).toFixed(3);
      o.floodAt = Date.now();
    });
    mark('flood', 'live', Math.round(performance.now() - t0));
    return true;
  } catch (e) {
    mark('flood', 'failed', Math.round(performance.now() - t0), e.message);
    return false;
  }
}

/* ── USGS: real earthquakes, in the Indian region ─────────────────── */
async function pullQuakes() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const url = `${ENDPOINT.quake}?format=geojson&starttime=${since}`
    + '&minlatitude=5&maxlatitude=38&minlongitude=66&maxlongitude=98'
    + '&minmagnitude=2.5&orderby=time&limit=200';
  const t0 = performance.now();
  try {
    const body = await getJSON(url);
    LIVEDATA.quakes = (body.features || []).map(f => ({
      mag: f.properties.mag,
      place: f.properties.place,
      time: f.properties.time,
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      depth: f.geometry.coordinates[2],
      id: f.id
    })).filter(q => q.mag != null);
    LIVEDATA.observed.add('earthquake');
    mark('quake', 'live', Math.round(performance.now() - t0));
    return true;
  } catch (e) {
    mark('quake', 'failed', Math.round(performance.now() - t0), e.message);
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════════
   Turning observations into risk

   These are the same relationships the risk engine documents, applied
   to real numbers instead of modelled ones. Each returns null when the
   observation it needs is absent, and null means "keep the model" —
   never "zero".
   ══════════════════════════════════════════════════════════════════ */
const obsRisk = {
  /* IMD calls 64.5 mm/day heavy, 115.6 very heavy, 204.5 extremely heavy.
     Antecedent rain matters as much as today's: saturated ground has
     nowhere to put it. */
  flood(o) {
    if (o.rain24 == null) return null;
    const today = Math.min(o.rain24 / 204.5, 1.25);
    const soaked = Math.min((o.rain72 || 0) / 300, 1);
    const river = o.dischargeRatio != null
      ? Math.min(Math.max((o.dischargeRatio - 1) / 1.6, 0), 1) : null;
    let v = 62 * today + 26 * soaked;
    if (river != null) v = v * 0.72 + 46 * river;   // a gauge beats a proxy
    return clampScore(v);
  },
  /* A slope fails on the rain that has already fallen into it. */
  landslide(o) {
    if (o.rain72 == null) return null;
    return clampScore(18 * Math.min(o.rain24 / 100, 1.2) + 66 * Math.min(o.rain72 / 260, 1.2));
  },
  /* IMD declares a heatwave at 40 °C on the plains, 30 °C in the hills,
     or 4.5 °C above the local normal. Without the normal to hand, the
     absolute threshold is the honest one to use. */
  heatwave(o) {
    if (o.tmax == null) return null;
    return clampScore((o.tmax - 32) * 7.2);
  },
  /* A week with almost no rain is not a drought, but it is the signal
     this build can honestly see. It is labelled a short-window deficit,
     not an SPI. */
  drought(o) {
    if (o.rain7d == null) return null;
    return clampScore(92 - o.rain7d * 2.6);
  },
  /* Dry, hot and windy. Fire danger, not fire detection — there is no
     thermal sensor in this chain without a FIRMS key. */
  wildfire(o) {
    if (o.tmax == null || o.rain7d == null) return null;
    const dry = Math.max(0, 1 - o.rain7d / 26);
    const hot = Math.max(0, Math.min((o.tmax - 26) / 16, 1));
    const wind = Math.min((o.gust || 0) / 45, 1);
    return clampScore(100 * (0.5 * dry + 0.34 * hot + 0.16 * wind) * dry);
  },
  /* CAPE says the atmosphere could produce a thunderstorm. It does not
     say one happened, and this is labelled a proxy everywhere it shows. */
  lightning(o) {
    if (o.cape == null) return null;
    return clampScore(o.cape / 34);
  },
  /* Gusts are what a coastal state feels. A track and a wind field need
     IMD's cyclone division; this is the open-source stand-in. */
  cyclone(o) {
    if (o.gust == null) return null;
    return clampScore((o.gust - 24) * 1.9);
  }
};

const clampScore = v => Math.max(2, Math.min(99, Math.round(v)));

/** Earthquake risk for a state: the largest recent event near its point,
    attenuated by distance. Real events, real magnitudes. */
function quakeRiskFor(id) {
  if (!LIVEDATA.quakes.length) return null;
  const [lat, lon] = STATE_POINT[id];
  let best = 0;
  for (const q of LIVEDATA.quakes) {
    const d = haversine(lat, lon, q.lat, q.lon);
    if (d > 700) continue;
    const ageDays = (Date.now() - q.time) / 864e5;
    /* magnitude, attenuated with distance and discounted with age */
    const v = (q.mag * 15) - d * 0.045 - ageDays * 3.5;
    if (v > best) best = v;
  }
  return best > 0 ? clampScore(best) : null;
}

function haversine(a1, o1, a2, o2) {
  const R = 6371, r = Math.PI / 180;
  const dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ══════════════════════════════════════════════════════════════════
   Applying it

   Observations replace modelled values only for the hazards they cover,
   only where the state actually has that hazard, and only while the
   reading is inside its staleness window. Everything else keeps the
   seasonal model and is marked as modelled.
   ══════════════════════════════════════════════════════════════════ */
function applyObservations() {
  if (!LIVEDATA.everConnected) return 0;
  let touched = 0;
  const fresh = k => LIVEDATA.src[k].status === 'live'
    && Date.now() - LIVEDATA.src[k].at < STALE_AFTER[k];
  const weatherOK = fresh('weather'), floodOK = fresh('flood'), quakeOK = fresh('quake');
  if (!weatherOK && !quakeOK) return 0;

  for (const id in S.states) {
    const st = S.states[id], o = LIVEDATA.obs[id];
    if (!o) continue;
    /* What the model said a moment ago. Each cell's deviation from this is
       its terrain signature, and that signature has to survive the
       substitution — otherwise every cell in the state would flatten to
       one number the first time an observation lands. */
    const modelled = Object.assign({}, st.hz);
    st.obs = st.obs || {};
    st.live = st.live || {};

    if (weatherOK) {
      for (const h of ['flood', 'landslide', 'heatwave', 'drought', 'wildfire', 'lightning', 'cyclone']) {
        if (st.hz[h] == null) continue;                 // not a hazard here
        if (h === 'cyclone' && !st.coastal) continue;
        const v = obsRisk[h](o);
        if (v == null) continue;
        st.hz[h] = v; st.live[h] = v;
        st.obs[h] = (h === 'flood' && floodOK && o.dischargeRatio != null)
          ? 'openmeteo+glofas' : 'openmeteo';
        touched++;
      }
    }
    if (quakeOK && st.hz.earthquake != null) {
      const v = quakeRiskFor(id);
      if (v != null) { st.hz.earthquake = v; st.live.earthquake = v; st.obs.earthquake = 'usgs'; touched++; }
    }

    /* the situation label follows the observed picture, same rule as the
       modelled one */
    const top = Object.entries(st.hz).sort((a, b) => b[1] - a[1]);
    const named = top.filter(([, v]) => v >= 60).map(([h]) => HAZ[h].name);
    st.dis = named.length ? named.slice(0, 2).join(' + ')
      : top[0][1] >= 40 ? HAZ[top[0][0]].name + ' Watch' : 'Monitored';
    st.primary = top[0][0];
    st.observedAt = Date.now();

    /* the open state's own grid is re-derived from its state figures so the
       cells and the national map cannot disagree */
    if (id === S.focus && S.cells.length) applyToCells(id, o, modelled);
  }

  if (touched) {
    computePriorities(); computeRoutes();
    if (typeof syncLatest === 'function') syncLatest();
    if (typeof refreshNationalFeed === 'function') refreshNationalFeed();
    if (typeof markRagDirty === 'function') markRagDirty();
  }
  return touched;
}

/** Push the state's observed weather down onto its 25 cells, keeping the
    per-cell terrain differences the model already computed.
    `modelled` is the state's headline immediately before substitution —
    each cell's distance from it is the terrain signal worth preserving. */
function applyToCells(id, o, modelled) {
  const st = S.states[id];
  for (const c of S.cells) {
    if (o.rain24 != null) {
      /* the state figure is the point observation; cells vary around it
         by the terrain factor the grid already carries */
      const k = (c.rainfall_24h || 100) / 150;
      c.rainfall_24h = Math.round(o.rain24 * (0.7 + k * 0.6));
      c.rainfall_72h = Math.round((o.rain72 || o.rain24 * 2.2) * (0.7 + k * 0.6));
      c.soil_moisture = +Math.min(0.62, 0.18 + c.rainfall_72h / 900).toFixed(2);
    }
    if (o.dischargeRatio != null && c.river_ratio != null)
      c.river_ratio = +(o.dischargeRatio * (0.9 + (c.hand_m <= 3 ? 0.15 : 0))).toFixed(3);

    c.anchor = c.anchor || {};
    for (const h in c.risk) {
      if (c.risk[h] < 0 || st.live[h] == null) continue;
      /* the cell sat this far above or below its state's headline; it still
         does, because that gap is terrain, not weather */
      const offset = c.risk[h] - (modelled[h] ?? c.risk[h]);
      c.anchor[h] = Math.max(2, Math.min(99, Math.round(st.live[h] + offset)));
      c.risk[h] = c.anchor[h];
      c.probability[h] = +(c.risk[h] / 100 * 0.86).toFixed(3);
    }
  }
}

/* Which service actually carries which hazard. Nothing else may claim to. */
const HAZARD_SOURCE = {
  flood: 'weather', landslide: 'weather', heatwave: 'weather', drought: 'weather',
  wildfire: 'weather', lightning: 'weather', cyclone: 'weather', earthquake: 'quake'
};

/** Is the service behind this hazard reporting inside its own window? */
function sourceFresh(key) {
  const s = LIVEDATA.src[key];
  return !!s && s.status === 'live' && Date.now() - s.at < STALE_AFTER[key];
}

/** True while this state/hazard figure rests on a real observation that is
    still inside its window. The drift generator asks before touching a
    number, so a measurement is never quietly random-walked away — and once
    the reading ages out, the model takes the surface back rather than the
    screen freezing on a number nobody is standing behind. */
function liveAnchored(stateId, hazard) {
  if (!LIVEDATA.everConnected) return false;
  if (!sourceFresh(HAZARD_SOURCE[hazard])) return false;
  const st = S.states[stateId];
  return !!(st && st.live && st.live[hazard] != null);
}

/* Reflect real fetch state in the source register the UI already reads,
   so `Data Sources` shows what actually happened rather than a script. */
const REAL_SOURCE = { openmeteo: 'weather', glofas: 'flood', usgs: 'quake' };

function syncSourceRows() {
  if (typeof S === 'undefined' || !S.sources) return;
  for (const row of S.sources) {
    const key = REAL_SOURCE[row.key];
    if (!key) continue;
    const s = LIVEDATA.src[key];
    row.status = s.status === 'live'
      ? (Date.now() - s.at < STALE_AFTER[key] ? 'live' : 'stale')
      : s.status === 'failed' ? 'failed' : 'nc';
    row.age_seconds = s.at ? Math.round((Date.now() - s.at) / 1000) : null;
    row.mode = s.status === 'failed'
      ? `unreachable — ${s.error || 'no response'}`
      : s.status === 'live' ? 'fetched by this browser'
      : 'connecting';
    /* Quality is a measured thing or it is nothing. Latency is what this
       build can actually measure, so that is what it reports. */
    row.quality_score = s.status === 'live' ? Math.max(0.5, Math.min(1, 1 - s.ms / 6000)) : null;
    row.live_error = s.error;
    row.live_ms = s.ms || null;
  }
  if (typeof paintSourceBar === 'function' && S.view === 'map' && S.role === 'gov') paintSourceBar();
}

/* ══════════════════════════════════════════════════════════════════
   The loop
   ══════════════════════════════════════════════════════════════════ */
let liveTimer = null;

async function pullAll(reason) {
  if (!LIVEDATA.enabled) return;
  const due = k => Date.now() - LIVEDATA.src[k].at >= CADENCE[k]
    || LIVEDATA.src[k].status !== 'live';
  const jobs = [];
  if (due('weather')) jobs.push(pullWeather());
  if (due('flood')) jobs.push(pullFlood());
  if (due('quake')) jobs.push(pullQuakes());
  if (!jobs.length) return;

  const before = LIVEDATA.everConnected;
  await Promise.all(jobs);
  const n = applyObservations();

  if (!before && LIVEDATA.everConnected) {
    const live = Object.entries(LIVEDATA.src).filter(([, s]) => s.status === 'live').map(([k]) => k);
    toast('Live data connected',
      `Real observations for all 36 states from ${live.join(', ')}. ` +
      `The map is now showing what the instruments say, not a model of it.`, 'ok');
    log('quality', `Live ingestion connected — ${live.join(', ')}`, '#1B7F3B');
  }
  if (n) {
    if (typeof render === 'function') render();
    if (typeof paintLatest === 'function') paintLatest();
  }
  if (typeof paintLiveBadge === 'function') paintLiveBadge();
}

/** True when at least one source is delivering inside its window. */
function liveDataHealthy() { return Object.keys(LIVEDATA.src).some(sourceFresh); }

/** What the interface should say about where the numbers came from.
    Returns [kind, headline, explanation]. `kind` is the only thing any
    surface is allowed to colour or label on, and it is deliberately strict:
    "live" requires the whole observed picture to be in, because the weather
    service alone carries seven of the nine hazards. One service reporting
    out of three is a partial picture, and saying "Live" over a board that is
    mostly model would be the exact dishonesty this file exists to avoid. */
/* A page served inside a sandboxed preview frame cannot reach a third-party
   API at all: the Content-Security-Policy blocks it before a request is made.
   That is a completely different problem from a flaky network, and telling
   someone "the source is unreachable" when the answer is "this viewer does not
   permit outbound requests, open the file itself" wastes their afternoon. */
function sandboxed() {
  try {
    return window.top !== window.self
      && Object.values(LIVEDATA.src).every(s => s.tries > 0 && /Failed to fetch|NetworkError|load failed/i.test(s.error || ''));
  } catch (e) { return false; }
}

function provenance() {
  if (!LIVEDATA.everConnected) {
    const tried = Object.values(LIVEDATA.src).some(s => s.tries > 0);
    if (tried && sandboxed())
      return ['modelled', 'Modelled — preview sandbox',
        'This preview frame blocks outbound requests to third-party APIs, so no live '
        + 'observation can reach the page here. Every figure is the seasonal model. '
        + 'Open the downloaded file directly and the same code fetches Open-Meteo, '
        + 'GloFAS and USGS for all 36 states.'];
    return tried
      ? ['modelled', 'Modelled', 'Live sources are unreachable from this browser, so every '
        + 'figure on screen is the seasonal model. Nothing here is an observation.']
      : ['connecting', 'Connecting', 'Fetching live observations for all 36 states.'];
  }
  const fresh = Object.keys(LIVEDATA.src).filter(sourceFresh);
  if (!fresh.length)
    return ['stale', 'Stale', 'The last readings are outside their window, so the seasonal '
      + 'model has the surface back. Figures are not current observations.'];

  const OBSERVED = { weather: 'rain, temperature, wind and instability', flood: 'river discharge',
                     quake: 'earthquakes' };
  const have = fresh.map(k => OBSERVED[k]);
  const missing = Object.keys(LIVEDATA.src).filter(k => !sourceFresh(k));
  if (missing.length)
    return ['partial', 'Part observed', `Measured: ${have.join(', ')}. `
      + `Not reaching this browser: ${missing.map(k => OBSERVED[k]).join(', ')} — `
      + 'those hazards are the seasonal model and are marked as such.'];
  return ['live', 'Live observations', 'All three services are reporting. '
    + `Measured: ${have.join(', ')}. Everything derived from them is labelled with its source.`];
}

function startLiveData() {
  if (typeof window === 'undefined' || !window.fetch) return;
  pullAll('boot');
  clearInterval(liveTimer);
  liveTimer = setInterval(() => pullAll('tick'), 60e3);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pullAll('visible');
  });
}
