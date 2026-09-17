#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   Build the world layer from Natural Earth.

   Input   node_modules/world-atlas/countries-110m.json
           Natural Earth 4.1.0 Admin-0 boundaries at 1:110 000 000,
           redistributed as TopoJSON by the topojson project. Natural
           Earth is public domain; the redistribution is ISC.

   Output  assets/world.js  —  WORLD = { meta, countries: [...] }

   Why decode at build time rather than shipping TopoJSON and a decoder:
   the published build must run with no network at all, and pulling
   topojson-client from a CDN is a network dependency wearing a hat. The
   arc format is delta-encoded integers over a quantised grid, which is
   forty lines to unpack, so it is unpacked here once.

   Coordinates are rounded to two decimals — about 1.1 km at the equator,
   which is finer than a 1:110m source can honestly resolve anyway, and
   it roughly halves the payload. Rings that collapse below three points
   after rounding are dropped: a shape that small is a rendering artefact
   at world zoom, not a country.

   NOTHING here invents geometry. Every ring in the output traces back to
   a Natural Earth arc, and `meta` carries the source, the scale and the
   licence so the Data Sources screen can state them.
   ══════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const here = __dirname;
const src = path.join(here, '..', 'node_modules', 'world-atlas', 'countries-110m.json');
if (!fs.existsSync(src)) {
  console.error('world-atlas is not installed. Run:  npm i -D world-atlas@2');
  process.exit(1);
}
const topo = JSON.parse(fs.readFileSync(src, 'utf8'));

/* ── TopoJSON arc decoding ─────────────────────────────────────────
   Positions are quantised integers, delta-encoded after the first point.
   x = q[0] * scale[0] + translate[0]. An arc index of ~i (i.e. -i-1)
   means "that arc, reversed", and the shared endpoint is dropped when
   arcs are stitched so the ring does not repeat a vertex. */
const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;

const arcs = topo.arcs.map(arc => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => {
    x += dx; y += dy;
    return [x * sx + tx, y * sy + ty];
  });
});

function ringOf(indices) {
  const pts = [];
  for (const idx of indices) {
    const reversed = idx < 0;
    const arc = arcs[reversed ? ~idx : idx];
    const seq = reversed ? arc.slice().reverse() : arc;
    // the first point of each arc after the first repeats the previous end
    for (let i = pts.length ? 1 : 0; i < seq.length; i++) pts.push(seq[i]);
  }
  return pts;
}

const R2 = v => Math.round(v * 100) / 100;

function simplify(ring) {
  const out = [];
  let last = null;
  for (const [lon, lat] of ring) {
    const p = [R2(lon), R2(lat)];
    if (last && p[0] === last[0] && p[1] === last[1]) continue;  // collapsed by rounding
    out.push(p); last = p;
  }
  return out;
}

/* ── Continent, from the country's own numeric code ────────────────
   The ids in this file are UN M49 numeric country codes, and M49 assigns
   every one of them to a region. That assignment is a published standard,
   not a guess, so it is stored as a table keyed by the same code the
   geometry carries. A code with no entry is labelled `unassigned` and
   rendered without a continent rather than being placed by eye. */
const M49 = JSON.parse(fs.readFileSync(path.join(here, 'm49-regions.json'), 'utf8'));

const countries = [];
let dropped = 0;
for (const g of topo.objects.countries.geometries) {
  const polys = (g.type === 'Polygon' ? [g.arcs] : g.arcs)
    .map(poly => poly.map(ringOf).map(simplify).filter(r => r.length >= 3))
    .filter(rings => rings.length);
  if (!polys.length) { dropped++; continue; }

  /* bounding box and a rough centroid, both derived — used to frame the
     camera when the user drills into a country, never displayed as a fact */
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const poly of polys) for (const [lon, lat] of poly[0]) {
    if (lon < x0) x0 = lon; if (lon > x1) x1 = lon;
    if (lat < y0) y0 = lat; if (lat > y1) y1 = lat;
  }
  countries.push({
    id: g.id,
    name: g.properties.name,
    region: M49[g.id] || 'unassigned',
    bbox: [x0, y0, x1, y1],
    rings: polys
  });
}

countries.sort((a, b) => a.name.localeCompare(b.name));

const meta = {
  source: 'Natural Earth 4.1.0 — Admin 0 country boundaries',
  scale: '1:110,000,000',
  via: 'world-atlas 2.0.2 (TopoJSON)',
  licence: 'Natural Earth is public domain; the redistribution is ISC',
  url: 'https://www.naturalearthdata.com/',
  crs: 'EPSG:4326 (WGS 84), decimal degrees',
  precision_dp: 2,
  precision_note: 'Coordinates rounded to 0.01° (~1.1 km at the equator). '
    + 'This is a small-scale reference outline for navigation and context. '
    + 'It is not a survey boundary and must not be used to determine where a '
    + 'border lies.',
  regions: 'UN M49, keyed by the numeric country code carried in the source',
  built: new Date().toISOString().slice(0, 10),
  countries: countries.length
};

const out = path.join(here, '..', 'assets', 'world.js');
fs.writeFileSync(out, `/* Generated by tools/build-world.js — do not edit by hand.
   ${meta.source} · ${meta.scale} · ${meta.licence} */\nconst WORLD = ${JSON.stringify({ meta, countries })};\n`);

const kb = (fs.statSync(out).size / 1024).toFixed(0);
const unassigned = countries.filter(c => c.region === 'unassigned');
console.log(`assets/world.js — ${countries.length} countries, ${kb} KB`);
if (dropped) console.log(`  ${dropped} geometries had no ring left after rounding and were dropped`);
if (unassigned.length) console.log(`  no M49 region for: ${unassigned.map(c => `${c.name} (${c.id})`).join(', ')}`);
