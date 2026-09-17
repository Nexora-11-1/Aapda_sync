/* Real-time ingestion.
   ────────────────────────────────────────────────────────────────────
   The sandbox that builds this file cannot reach Open-Meteo or USGS, and
   a test that needs the live internet is a test that fails on a train.
   So the network is intercepted and fed the *real response shapes* —
   Open-Meteo's array-of-locations for a comma-separated coordinate list,
   the flood API's daily river_discharge series, USGS FDSN GeoJSON — and
   the assertions are about what the page does with them.

   Four things have to hold, and the last two matter more than the first:

     1. A good response replaces modelled figures with observed ones, and
        the observed ones survive the drift generator.
     2. The provenance surfaces say "live" only when it is live.
     3. A dead network leaves the modelled figures in place and SAYS SO.
        It must never show the model while claiming observation.
     4. A malformed or truncated response is a failure, not an accident
        that half-applies. */
import { chromium } from 'playwright';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const url = new URL('../../dist/aapdasync.html', import.meta.url).href;
let fails = 0;
const ok = (n, v) => { if (v !== true) fails++; console.log((v === true ? '  ok  ' : ' FAIL ') + n + (v === true ? '' : ' → ' + JSON.stringify(v))); };
const eq = (a, x) => a === x ? true : `${JSON.stringify(a)} !== ${JSON.stringify(x)}`;

/* ── Fixtures, shaped exactly as the services document them ────────── */
const DAYS = 10;                                   // past_days=7 + today + forecast_days=2 - 1
const dates = n => Array.from({ length: n }, (_, i) =>
  new Date(Date.UTC(2026, 6, 10 + i)).toISOString().slice(0, 10));

/* One location block. `heavy` produces an unmistakable flood/landslide
   signature (IMD calls 204.5 mm/day extremely heavy); `dry` produces an
   unmistakable drought/wildfire one. */
function weatherLoc(kind) {
  const rain = kind === 'heavy' ? [10, 20, 40, 60, 90, 120, 180, 240, 60, 20]
             : kind === 'dry'   ? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
             :                    [4, 6, 3, 8, 5, 7, 6, 9, 5, 4];
  const tmax = kind === 'dry' ? Array(DAYS).fill(44) : Array(DAYS).fill(29);
  return {
    latitude: 30.35, longitude: 79.4, timezone: 'Asia/Kolkata',
    current: { temperature_2m: kind === 'dry' ? 43.1 : 27.4, precipitation: 0, wind_gusts_10m: 12 },
    daily: {
      time: dates(DAYS),
      precipitation_sum: rain,
      temperature_2m_max: tmax,
      wind_gusts_10m_max: Array(DAYS).fill(kind === 'dry' ? 52 : 18),
      maximum_cape: Array(DAYS).fill(kind === 'heavy' ? 2800 : 300)
    }
  };
}
function floodLoc(ratioHigh) {
  const base = Array(30).fill(100);
  const q = ratioHigh ? [...base, 340] : [...base, 96];
  return { latitude: 30.35, longitude: 79.4, daily: { time: dates(31), river_discharge: q } };
}
const quakeFixture = {
  type: 'FeatureCollection',
  features: [{
    id: 'us7000abcd', type: 'Feature',
    properties: { mag: 6.1, place: '31 km NE of Joshimath, India', time: Date.now() - 3600e3 },
    geometry: { type: 'Point', coordinates: [79.6, 30.6, 22.4] }
  }, {
    id: 'us7000efgh', type: 'Feature',
    properties: { mag: 3.2, place: 'Andaman Islands region', time: Date.now() - 2 * 864e5 },
    geometry: { type: 'Point', coordinates: [92.8, 11.7, 40.0] }
  }]
};

/* ── Harness ──────────────────────────────────────────────────────── */
async function run(mode) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [], hits = [];
  p.on('pageerror', e => errs.push(e.message));

  await p.route('**://api.open-meteo.com/**', async r => {
    hits.push('weather');
    if (mode === 'dead') return r.abort('failed');
    if (mode === 'malformed') return r.fulfill({ status: 200, contentType: 'application/json', body: '{"error":true,"reason":"bad"}' });
    if (mode === 'httperror') return r.fulfill({ status: 429, contentType: 'text/plain', body: 'rate limited' });
    if (mode === 'short') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([weatherLoc('heavy')]) });
    /* the real thing: one block per requested coordinate, in order.
       `ut` is index 34 in the STATE_POINT ordering; give it the deluge and
       give Rajasthan (index 28) the drought so both directions are tested. */
    const n = new URL(r.request().url()).searchParams.get('latitude').split(',').length;
    const arr = Array.from({ length: n }, (_, i) =>
      weatherLoc(i === 34 ? 'heavy' : i === 28 ? 'dry' : 'calm'));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(arr) });
  });
  await p.route('**://flood-api.open-meteo.com/**', async r => {
    hits.push('flood');
    if (mode === 'dead') return r.abort('failed');
    const n = new URL(r.request().url()).searchParams.get('latitude').split(',').length;
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(Array.from({ length: n }, (_, i) => floodLoc(i === 34))) });
  });
  await p.route('**://earthquake.usgs.gov/**', async r => {
    hits.push('quake');
    if (mode === 'dead') return r.abort('failed');
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(quakeFixture) });
  });

  await p.goto(url);
  await p.waitForTimeout(1600);
  return { p, errs, hits };
}

async function snap(p) {
  return p.evaluate(() => ({
    prov: provenance(),
    healthy: liveDataHealthy(),
    ever: LIVEDATA.everConnected,
    src: Object.fromEntries(Object.entries(LIVEDATA.src).map(([k, v]) => [k, v.status])),
    errors: Object.fromEntries(Object.entries(LIVEDATA.src).map(([k, v]) => [k, v.error])),
    obsStates: Object.keys(LIVEDATA.obs).length,
    utFlood: S.states.ut.hz.flood,
    utLive: S.states.ut.live ? S.states.ut.live.flood : null,
    utObs: S.states.ut.obs ? S.states.ut.obs.flood : null,
    rjDrought: S.states.rj.hz.drought,
    rjWildfire: S.states.rj.hz.wildfire,
    utQuake: S.states.ut.hz.earthquake,
    quakes: LIVEDATA.quakes.length,
    badge: (document.getElementById('livebadge') || {}).textContent || '',
    badgeTitle: (document.getElementById('livebadge') || {}).title || '',
    srcRows: Object.fromEntries(S.sources.filter(s => ['openmeteo', 'glofas', 'usgs'].includes(s.key))
      .map(s => [s.key, s.status])),
    anyZero: Object.values(S.states).some(s => Object.values(s.hz).some(v => v === 0))
  }));
}

/* ══ 1. The happy path ═════════════════════════════════════════════ */
console.log('\nLive responses accepted');
{
  const { p, errs, hits } = await run('live');
  const s = await snap(p);
  ok('no page errors', eq(errs.length, 0) === true ? true : errs);
  ok('all three services called', eq([...new Set(hits)].sort().join(','), 'flood,quake,weather'));
  ok('every source live', eq(JSON.stringify(s.src), '{"weather":"live","flood":"live","quake":"live"}'));
  ok('observations held for all 36 states', eq(s.obsStates, 36));
  ok('provenance is live', eq(s.prov[0], 'live'));
  ok('badge says Live', s.badge.startsWith('Live') || s.badge);
  ok('240 mm of rain drives flood high', s.utFlood >= 80 || s.utFlood);
  ok('flood figure is recorded as observed', eq(s.utObs, 'openmeteo+glofas'));
  ok('flood anchor matches the score', eq(s.utLive, s.utFlood));
  ok('zero rain over a week drives drought high', s.rjDrought >= 80 || s.rjDrought);
  ok('44 °C and no rain drives wildfire high', s.rjWildfire >= 60 || s.rjWildfire);
  ok('a real M6.1 nearby raises earthquake', s.utQuake >= 60 || s.utQuake);
  ok('both USGS events parsed', eq(s.quakes, 2));
  ok('source register shows live', eq(JSON.stringify(s.srcRows), '{"usgs":"live","openmeteo":"live","glofas":"live"}'));
  ok('no hazard was zeroed', eq(s.anyZero, false));

  /* the drift generator must not walk an observation away */
  const before = await p.evaluate(() => ({ ut: S.states.ut.hz.flood, rj: S.states.rj.hz.drought }));
  await p.waitForTimeout(9000);                                  // > 2 pipeline ticks
  const after = await p.evaluate(() => ({ ut: S.states.ut.hz.flood, rj: S.states.rj.hz.drought,
                                          ticks: LIVE.received }));
  ok('pipeline did tick', after.ticks > 1 || after.ticks);
  ok('observed flood held across ticks', eq(after.ut, before.ut));
  ok('observed drought held across ticks', eq(after.rj, before.rj));

  /* cells must agree with their state, and keep terrain spread */
  const cells = await p.evaluate(() => {
    const v = S.cells.filter(c => (c.risk.flood ?? -1) >= 0).map(c => c.risk.flood);
    return { max: Math.max(...v), min: Math.min(...v), n: v.length, state: S.states[S.focus].hz.flood };
  });
  ok('cell grid still varies across terrain', cells.max - cells.min >= 5 || cells);
  ok('cells sit around the observed state figure',
     Math.abs(cells.max - cells.state) <= 25 || cells);
  await p.close();
}

/* ══ 2. Dead network — the honesty case ════════════════════════════ */
console.log('\nNo network — modelled figures kept, and labelled');
{
  const { p, errs } = await run('dead');
  const s = await snap(p);
  ok('no page errors', eq(errs.length, 0) === true ? true : errs);
  ok('nothing claims to have connected', eq(s.ever, false));
  ok('provenance is modelled', eq(s.prov[0], 'modelled'));
  ok('provenance explains why', /unreachable/i.test(s.prov[2]) || s.prov[2]);
  ok('badge does NOT say Live', eq(/^Live/.test(s.badge), false));
  ok('badge says Model', /Model/.test(s.badge) || s.badge);
  ok('badge tooltip is honest', /seasonal model/i.test(s.badgeTitle) || s.badgeTitle);
  ok('every source marked failed', eq(JSON.stringify(s.src), '{"weather":"failed","flood":"failed","quake":"failed"}'));
  ok('source register shows failed', eq(JSON.stringify(s.srcRows), '{"usgs":"failed","openmeteo":"failed","glofas":"failed"}'));
  ok('no figure was zeroed by the failure', eq(s.anyZero, false));
  ok('modelled figures are still present', s.utFlood > 0 || s.utFlood);
  ok('nothing was marked observed', eq(s.utObs, null));

  /* and the model must still be moving, so the dashboard is not frozen.
     One state can land back on its own value by chance; the country cannot. */
  const board = () => p.evaluate(() => Object.values(S.states).map(x => x.hz.flood ?? -1).join());
  const a = await board();
  await p.waitForTimeout(9000);
  const c = await board();
  ok('modelled surface still advances when offline', a !== c || `unchanged: ${a}`);
  await p.close();
}

/* ══ 3. Malformed and error responses ══════════════════════════════ */
for (const [mode, label] of [['malformed', 'a body that is not the documented shape'],
                             ['httperror', 'an HTTP 429'],
                             ['short', 'fewer locations than were asked for']]) {
  console.log(`\nWeather returns ${label}`);
  const { p, errs } = await run(mode);
  const s = await snap(p);
  ok('no page errors', eq(errs.length, 0) === true ? true : errs);
  ok('weather marked failed', eq(s.src.weather, 'failed'));
  ok('an error string was captured', typeof s.errors.weather === 'string' && s.errors.weather.length > 0
     ? true : s.errors.weather);
  ok('no flood figure claims to be observed', eq(s.utObs, undefined));
  ok('no figure was zeroed', eq(s.anyZero, false));
  /* USGS still answered, so the quake half may legitimately be live —
     what must NOT happen is the whole board claiming full live status */
  ok('provenance reports a partial picture, not "live"', eq(s.prov[0], 'partial'));
  ok('provenance names what is missing', /rain, temperature/.test(s.prov[2]) || s.prov[2]);
  await p.close();
}

/* ══ 4. Stale readings ═════════════════════════════════════════════ */
console.log('\nReadings age out of their window');
{
  const { p } = await run('live');
  await p.evaluate(() => {                       // push every success far into the past
    for (const k in LIVEDATA.src) LIVEDATA.src[k].at = Date.now() - 72 * 3600e3;
    paintLiveBadge();                            // the badge repaints on a timer; don't race it
  });
  const s = await snap(p);
  ok('healthy is false once outside the window', eq(s.healthy, false));
  ok('provenance is stale', eq(s.prov[0], 'stale'));
  ok('stale is explained', /model/i.test(s.prov[2]) || s.prov[2]);
  ok('badge does not lead with Live', eq(/^Live/.test(s.badge), false));
  /* a stale anchor must release the drift generator again */
  const a = await p.evaluate(() => S.states.ut.hz.flood);
  await p.waitForTimeout(9000);
  const c = await p.evaluate(() => S.states.ut.hz.flood);
  ok('stale figures resume modelling rather than freezing', a !== c || `${a} === ${c}`);
  await p.close();
}

await b.close();
console.log(fails ? `\n${fails} failed\n` : '\nall passed\n');
process.exit(fails ? 1 : 0);
