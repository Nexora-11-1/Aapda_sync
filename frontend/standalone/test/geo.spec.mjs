/* The geographic hierarchy.
   ────────────────────────────────────────────────────────────────────
   World → India → state → cell, and back up again.

   The assertions that matter here are not "does it draw". They are:

     · the world outlines are the real Natural Earth ones, checked against
       coordinates that can be looked up independently;
     · the one live thing on the world layer is genuinely live, and says so
       when it is not;
     · and the map does NOT imply operational coverage where there is none.
       176 countries render as geometry with no hazard shading, because
       nobody is monitoring them, and clicking one says that in words.
       A world map that shades every country plausibly is the most
       expensive lie this application could tell. */
import { chromium } from 'playwright';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const url = new URL('../../dist/aapdasync.html', import.meta.url).href;
let fails = 0;
const ok = (n, v) => { if (v !== true) fails++; console.log((v === true ? '  ok  ' : ' FAIL ') + n + (v === true ? '' : ' → ' + JSON.stringify(v))); };
const eq = (a, x) => a === x ? true : `${JSON.stringify(a)} !== ${JSON.stringify(x)}`;

const QUAKES = {
  features: [
    { id: 'jp1', properties: { mag: 6.8, place: '52 km E of Tokyo, Japan', time: Date.now() - 7200e3 },
      geometry: { coordinates: [139.7, 35.7, 30] } },
    { id: 'cl1', properties: { mag: 5.1, place: 'offshore Valparaiso, Chile', time: Date.now() - 864e5 },
      geometry: { coordinates: [-71.5, -33.4, 60] } },
    { id: 'in1', properties: { mag: 5.4, place: '30 km NE of Joshimath, India', time: Date.now() - 3600e3 },
      geometry: { coordinates: [79.6, 30.6, 22] } }
  ]
};

async function open(quakesLive = true) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route('**://earthquake.usgs.gov/**', r => quakesLive
    ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(QUAKES) })
    : r.abort('failed'));
  await p.route('**://*.open-meteo.com/**', r => r.abort('failed'));
  await p.goto(url);
  await p.waitForTimeout(700);
  await p.click('.role:nth-child(2)');
  await p.waitForTimeout(500);
  await p.fill('#au', 'dm.chamoli');
  await p.fill('#ap', 'Chamoli@DM#2026');
  await p.click('#authgo');
  await p.waitForTimeout(1800);
  return { p, errs };
}

/* ══ The bundled geometry is the real thing ════════════════════════ */
console.log('\nBundled world geometry');
{
  const { p, errs } = await open();
  const g = await p.evaluate(() => {
    const f = n => WORLD.countries.find(c => c.name === n);
    return {
      n: WORLD.countries.length,
      source: WORLD.meta.source,
      licence: WORLD.meta.licence,
      crs: WORLD.meta.crs,
      hasPrecisionNote: /not a survey boundary/i.test(WORLD.meta.precision_note || ''),
      india: f('India') && f('India').bbox,
      nepal: f('Nepal') && f('Nepal').bbox,
      japan: f('Japan') && f('Japan').bbox,
      chile: f('Chile') && f('Chile').bbox,
      indiaRegion: f('India') && f('India').region,
      unassigned: WORLD.countries.filter(c => c.region === 'unassigned').map(c => c.name)
    };
  });
  ok('no page errors', eq(errs.length, 0) === true ? true : errs);
  ok('177 countries bundled', eq(g.n, 177));
  ok('source is named', /Natural Earth/.test(g.source) || g.source);
  ok('licence is named', /public domain/i.test(g.licence) || g.licence);
  ok('CRS is stated', /4326/.test(g.crs) || g.crs);
  ok('the outline says it is not a survey boundary', g.hasPrecisionNote === true);

  /* Independently checkable: these bounds are geography, not this build's
     opinion. India spans roughly 68–97°E, 8–35°N. */
  const near = (a, x, tol) => Math.abs(a - x) <= tol ? true : `${a} not within ${tol} of ${x}`;
  ok('India west bound',  near(g.india[0], 68.2, 1.0));
  ok('India south bound', near(g.india[1], 8.1,  1.0));
  ok('India east bound',  near(g.india[2], 97.4, 1.0));
  ok('India north bound', near(g.india[3], 35.5, 1.5));
  ok('Nepal is where Nepal is', near(g.nepal[0], 80.1, 1.0) === true && near(g.nepal[3], 30.4, 1.0) === true
     ? true : g.nepal);
  ok('Japan is east of 129°E', g.japan[0] > 126 && g.japan[2] > 140 ? true : g.japan);
  ok('Chile is in the southern hemisphere', g.chile[1] < -50 && g.chile[3] < 0 ? true : g.chile);
  ok('India is in Asia', eq(g.indiaRegion, 'Asia'));
  ok('unrecognised territories are marked unassigned, not guessed',
     g.unassigned.length > 0 && g.unassigned.every(n => /Kosovo|Cyprus|Somaliland/.test(n))
       ? true : g.unassigned);
  await p.close();
}

/* ══ Navigating the hierarchy ══════════════════════════════════════ */
console.log('\nDrill-down: world → India → state → cell');
{
  const { p, errs } = await open();
  const at = () => p.evaluate(() => ({
    level: GEO.level, focus: S.mapFocus,
    paths: (document.querySelector('#map svg') || { querySelectorAll: () => [] }).querySelectorAll('path').length,
    crumb: (document.getElementById('crumb') || {}).textContent.replace(/\s+/g, ' ').trim(),
    vb: (document.querySelector('#map svg') || {}).getAttribute
        ? document.querySelector('#map svg').getAttribute('viewBox') : null
  }));

  const start = await at();
  ok('opens on India, not the world', eq(start.level, 'country'));
  ok('India level draws the states', start.paths >= 30 || start.paths);

  await p.evaluate(() => goWorld());
  await p.waitForTimeout(900);
  const world = await at();
  ok('world level entered', eq(world.level, 'world'));
  ok('world draws every country', world.paths >= 170 || world.paths);
  ok('breadcrumb names the world level', /World/.test(world.crumb) || world.crumb);
  ok('breadcrumb states the coverage limit',
     /operational cover for India only/i.test(world.crumb) || world.crumb);

  await p.evaluate(() => pickCountry('356'));
  await p.waitForTimeout(900);
  const back = await at();
  ok('clicking India returns to the country level', eq(back.level, 'country'));
  ok('country level draws the states again', back.paths >= 30 || back.paths);

  await p.evaluate(() => pickState('ut'));
  await p.waitForTimeout(900);
  const state = await at();
  ok('opening a state moves to the state level', eq(state.level, 'state'));
  ok('state focus recorded', eq(state.focus, 'ut'));
  ok('the state grid is loaded', await p.evaluate(() => S.cells.length) >= 20
     || await p.evaluate(() => S.cells.length));

  await p.evaluate(() => mapHome());
  await p.waitForTimeout(700);
  ok('home returns to the country level', eq((await at()).level, 'country'));
  ok('no page errors through the whole walk', eq(errs.length, 0) === true ? true : errs);
  await p.close();
}

/* ══ Coverage is not overstated ════════════════════════════════════ */
console.log('\nThe world layer does not claim what it does not have');
{
  const { p } = await open();
  await p.evaluate(() => goWorld());
  await p.waitForTimeout(1000);

  const fills = await p.evaluate(() => {
    const paths = [...document.querySelectorAll('#map svg path')];
    const counted = {};
    for (const el of paths) {
      const f = el.getAttribute('fill');
      counted[f] = (counted[f] || 0) + 1;
    }
    return counted;
  });
  const distinct = Object.keys(fills).length;
  ok('countries are not risk-shaded', distinct <= 2
     ? true : `${distinct} distinct fills — the world map appears to be shading risk it does not have`);

  const said = await p.evaluate(async () => {
    pickCountry('392');                             // Japan
    await new Promise(r => setTimeout(r, 400));
    return [...document.querySelectorAll('.tst')].map(t => t.textContent).join(' | ');
  });
  ok('clicking an uncovered country says so',
     /no operational register/i.test(said) || said);
  ok('and does not imply hazard data', /navigation only/i.test(said) || said);

  const layers = await p.evaluate(() => GEO_LAYERS);
  ok('the basin layer admits it ships no polygon',
     /NO POLYGON/.test(layers.basin.resolution) || layers.basin.resolution);
  ok('and names the dataset that would supply one',
     /HydroBASINS/.test(layers.basin.note) || layers.basin.note);
  ok('every layer carries coverage metadata',
     Object.values(layers).every(l => l.coverage && l.source && l.licence) === true);
  await p.close();
}

/* ══ Live seismicity, and its absence ══════════════════════════════ */
console.log('\nWorld seismicity is live, or says it is not');
{
  const { p } = await open(true);
  await p.evaluate(() => goWorld());
  await p.waitForTimeout(1000);
  const s = await p.evaluate(() => ({
    status: WORLD_QUAKES.status, n: WORLD_QUAKES.events.length,
    circles: document.querySelectorAll('#map svg circle').length
  }));
  ok('USGS reported', eq(s.status, 'live'));
  ok('all three events parsed', eq(s.n, 3));
  ok('each event is drawn at its own coordinate', s.circles >= 3 || s.circles);
  await p.close();

  const { p: p2 } = await open(false);
  await p2.evaluate(() => goWorld());
  await p2.waitForTimeout(1200);
  const f = await p2.evaluate(async () => {
    pickCountry('392');
    await new Promise(r => setTimeout(r, 400));
    return { status: WORLD_QUAKES.status, n: WORLD_QUAKES.events.length,
             circles: document.querySelectorAll('#map svg circle').length,
             toast: [...document.querySelectorAll('.tst')].map(t => t.textContent).join(' | ') };
  });
  ok('a failed fetch is marked failed', eq(f.status, 'failed'));
  ok('and draws no events rather than stale ones', eq(f.circles, 0));
  ok('and says the feed is not reaching', /not reaching this browser/i.test(f.toast) || f.toast);
  await p2.close();
}

await b.close();
console.log(fails ? `\n${fails} failed\n` : '\nall passed\n');
process.exit(fails ? 1 : 0);
