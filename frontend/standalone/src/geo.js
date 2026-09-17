/* ══════════════════════════════════════════════════════════════════
   GEOGRAPHY — the navigation hierarchy

     World  →  Country  →  State / UT  →  District  →  Basin  →  H3 cell

   Two coordinate systems, deliberately kept apart
   ───────────────────────────────────────────────
   The India view is a pre-projected SVG path set in its own 612×696
   space. The world view is Natural Earth in decimal degrees. Rather than
   force one into the other and inherit both sets of distortion, each
   level carries its own viewBox and the camera swaps between them. What
   the user sees is one continuous zoom; what the renderer does is switch
   atlases at the border, which is what an atlas is for.

   The world projection is plate carrée — x = longitude, y = −latitude.
   It is named on screen rather than left implicit, because at world zoom
   it stretches Greenland and Siberia badly and anyone reading area off
   this map should know that before they do.

   What this layer will NOT do
   ───────────────────────────
   It will not draw a boundary it does not have, and it will not imply
   operational coverage it does not have. AapdaSync holds an operational
   register — cells, shelters, roads, alerts, evacuation routing — for
   India only. Every other country renders as real Natural Earth geometry
   with real live seismicity on top and nothing else, and says so when
   clicked. A world map with plausible-looking risk shading over 176
   countries nobody is monitoring would be the single most dishonest
   thing this application could display.
   ══════════════════════════════════════════════════════════════════ */

const WORLD_VB = [-182, -84, 364, 152];        // lon −180..180, lat −62..90

/* Where the hierarchy currently sits. `level` drives the renderer, the
   breadcrumb, the zoom control and what the assistant treats as "here". */
const GEO = {
  level: 'country',        // world | country | state | cell
  country: '356',          // UN M49 numeric — India
  hoverCountry: null
};

/* ── Coverage, stated per layer ────────────────────────────────────
   §38: the platform must not pretend every layer is uniformly good. Each
   entry is what the Data Sources screen and the layer legend read from,
   so the claim on screen and the claim here cannot drift apart. */
const GEO_LAYERS = {
  world: {
    label: 'Countries',
    coverage: 'Global', resolution: 'Low (1:110m)',
    source: 'Natural Earth 4.1.0 Admin 0', licence: 'Public domain',
    note: 'A navigation outline, not a survey boundary. Rounded to about 1.1 km.',
    live: 'Seismicity only — USGS FDSN, worldwide. No other hazard is monitored outside India.'
  },
  country: {
    label: 'States and union territories',
    coverage: 'India', resolution: 'Medium',
    source: 'Simplified administrative outlines bundled with this build',
    licence: 'Derived for display',
    note: 'Shapes are generalised for a 5×5 operational grid and are not cadastral.',
    live: 'All 36 states and UTs carry live weather-derived risk and live seismicity.'
  },
  state: {
    label: 'Operational grid',
    coverage: 'The open state', resolution: 'H3 resolution 7 (≈5.16 km²)',
    source: 'H3 tiling of the state extent',
    licence: 'Derived',
    note: 'Cells carry terrain attributes; the register behind them is SDMA where '
        + 'one exists and provisional otherwise, and each cell says which.',
    live: 'Rainfall, discharge, temperature and wind are observed; the rest is modelled.'
  },
  basin: {
    label: 'River basins and valleys',
    coverage: 'Named rivers only', resolution: 'Named entity — NO POLYGON',
    source: 'Not bundled',
    licence: '—',
    note: 'This build ships no basin or valley polygons. HydroBASINS/HydroSHEDS is the '
        + 'right source and is freely licensed, but it is not redistributed here and '
        + 'a catchment boundary is not something to approximate: an evacuation drawn '
        + 'against an invented watershed sends people the wrong way up a valley. '
        + 'Basins therefore appear as named entities with their real river and the '
        + 'districts they cross, and the map does not draw an outline it does not have.',
    live: 'Discharge is observed per state point, not per basin.'
  }
};

/* ── Projection ────────────────────────────────────────────────────
   Plate carrée. Named on screen; see the module note above. */
const projX = lon => lon;
const projY = lat => -lat;

/** One SVG path for a country's rings. */
function worldPath(c) {
  let d = '';
  for (const poly of c.rings) {
    for (const ring of poly) {
      d += 'M' + ring.map(([lon, lat]) => `${projX(lon).toFixed(2)} ${projY(lat).toFixed(2)}`).join('L') + 'Z';
    }
  }
  return d;
}

/* Cache the path strings — 177 countries rebuilt on every repaint would
   make the 4-second pipeline tick visibly stutter. */
const worldPathCache = {};
const worldPathFor = c => worldPathCache[c.id] || (worldPathCache[c.id] = worldPath(c));

/** The camera box that frames a country, in world coordinates. */
function countryVB(c) {
  const [x0, y0, x1, y1] = c.bbox;
  const w = Math.max(x1 - x0, 4), h = Math.max(y1 - y0, 4);
  const side = Math.max(w, h) * 1.35;
  return [(x0 + x1) / 2 - side / 2, -(y0 + y1) / 2 - side / 2, side, side];
}

/* ── Live seismicity, worldwide ────────────────────────────────────
   The one hazard this build can honestly show outside India: USGS
   publishes every significant event on Earth and allows a direct call.
   Everything else on the world layer is geometry, not risk. */
const WORLD_QUAKES = { events: [], at: 0, status: 'idle', error: null };

async function pullWorldQuakes() {
  if (typeof getJSON !== 'function') return false;
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const url = `${ENDPOINT.quake}?format=geojson&starttime=${since}`
    + '&minmagnitude=4.5&orderby=time&limit=500';
  try {
    const body = await getJSON(url);
    WORLD_QUAKES.events = (body.features || []).map(f => ({
      mag: f.properties.mag, place: f.properties.place, time: f.properties.time,
      lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
      depth: f.geometry.coordinates[2], id: f.id
    })).filter(q => q.mag != null);
    WORLD_QUAKES.at = Date.now(); WORLD_QUAKES.status = 'live'; WORLD_QUAKES.error = null;
    return true;
  } catch (e) {
    WORLD_QUAKES.status = 'failed'; WORLD_QUAKES.error = e.message;
    return false;
  }
}

/** Recent events inside a country's bounding box. A box is not a border,
    so this is described as "in this region", never as "in this country". */
function quakesNear(c) {
  const [x0, y0, x1, y1] = c.bbox;
  return WORLD_QUAKES.events.filter(q =>
    q.lon >= x0 && q.lon <= x1 && q.lat >= y0 && q.lat <= y1);
}

/* ── Navigation ────────────────────────────────────────────────────── */
function goWorld() {
  GEO.level = 'world';
  S.mapFocus = null; S.cellSel = null;
  flyTo(WORLD_VB.slice());
  paintMap(); paintCrumb(); paintNav(); paintTop();
  if (typeof paintZoom === 'function') paintZoom();
  say('World view');
  /* the world layer is only honest if its one live source is actually
     asked for — fetch on arrival rather than on a timer nobody sees */
  if (Date.now() - WORLD_QUAKES.at > 5 * 60e3)
    pullWorldQuakes().then(okd => { if (okd && GEO.level === 'world') paintMap(); });
}

/** Enter a country. India has an operational register; nothing else does,
    and the difference is stated rather than implied by an empty screen. */
function pickCountry(id) {
  const c = WORLD.countries.find(x => x.id === id);
  if (!c) return;
  if (id === '356') {
    GEO.level = 'country'; GEO.country = '356';
    S.mapFocus = null; S.cellSel = null;
    flyTo(IN_VB.slice());
    paintMap(); paintCrumb(); paintNav(); paintTop();
    if (typeof paintZoom === 'function') paintZoom();
    say('India');
    return;
  }
  const qs = quakesNear(c);
  const seis = WORLD_QUAKES.status === 'live'
    ? (qs.length
        ? `USGS lists ${qs.length} event${qs.length === 1 ? '' : 's'} of magnitude 4.5 or above `
          + `in this region over the last seven days, the largest at M${Math.max(...qs.map(q => q.mag)).toFixed(1)}.`
        : 'USGS lists no event of magnitude 4.5 or above in this region in the last seven days.')
    : 'Live seismicity is not reaching this browser right now.';
  toast(c.name,
    `AapdaSync holds no operational register for ${c.name} — no cells, shelters, roads or `
    + `evacuation routing. ${seis} The outline is Natural Earth, for navigation only.`, 'info');
  flyTo(countryVB(c));
  GEO.hoverCountry = id;
  paintMap();
}

/* ── The world layer, drawn ────────────────────────────────────────── */
function buildWorldLayer(svg) {
  svg.appendChild(E('rect', { x: -400, y: -400, width: 1400, height: 1400, fill: '#DCE6F0' }));

  const g = E('g');
  for (const c of WORLD.countries) {
    const covered = c.id === '356';
    const p = E('path', {
      d: worldPathFor(c), class: 'st',
      fill: covered ? '#12447E' : '#E4EAF1',
      'fill-opacity': covered ? 0.88 : 1,
      stroke: covered ? '#0C2E57' : '#B9C4D3',
      'stroke-width': 0.55, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke'
    });
    p.addEventListener('mouseenter', ev => tipCountry(c, ev));
    p.addEventListener('mousemove', tipMove);
    p.addEventListener('mouseleave', tipOff);
    p.addEventListener('click', ev => { ev.stopPropagation(); pickCountry(c.id); });
    g.appendChild(p);
  }
  svg.appendChild(g);

  /* Real events, at their real coordinates, sized by magnitude. Nothing
     is drawn where nothing was reported. */
  if (WORLD_QUAKES.events.length) {
    const gq = E('g');
    for (const q of WORLD_QUAKES.events) {
      const r = Math.max(1.1, (q.mag - 3.6) * 1.25);
      const age = (Date.now() - q.time) / 864e5;
      const c = q.mag >= 6.5 ? '#B3261E' : q.mag >= 5.5 ? '#C4571A' : '#A96700';
      const node = E('circle', {
        cx: projX(q.lon).toFixed(2), cy: projY(q.lat).toFixed(2), r: r.toFixed(2),
        fill: c, 'fill-opacity': Math.max(0.25, 0.85 - age * 0.08),
        stroke: '#FFFFFF', 'stroke-width': 0.35, 'vector-effect': 'non-scaling-stroke',
        class: 'mk'
      });
      node.addEventListener('mouseenter', ev => tipQuake(q, ev));
      node.addEventListener('mousemove', tipMove);
      node.addEventListener('mouseleave', tipOff);
      gq.appendChild(node);
    }
    svg.appendChild(gq);
  }
}

function tipCountry(c, ev) {
  const t = tipEl();
  const covered = c.id === '356';
  const qs = quakesNear(c);
  t.innerHTML =
    `<b>${esc(c.name)}</b>
     <div style="font-size:11px;color:var(--t3);margin-top:1px">${esc(c.region)}</div>
     <div style="margin-top:6px">
       ${covered
         ? pill('Operational register', 'p-low')
         : pill('Navigation only', 'p-off')}
     </div>
     ${kvLine('Live seismicity', WORLD_QUAKES.status === 'live'
        ? `<b>${qs.length}</b> M4.5+ / 7 days` : '<span style="color:var(--t3)">not reaching</span>')}
     ${covered ? kvLine('States and UTs', `<b>${Object.keys(S.states).length}</b>`) : ''}
     <div style="font-size:11px;color:var(--t3);margin-top:6px;max-width:230px;line-height:15px">
       ${covered ? 'Click to open the Indian deployment.'
                 : 'No hazard register outside India. Outline is Natural Earth, 1:110m.'}</div>`;
  t.classList.add('on'); tipMove(ev);
}

function tipQuake(q, ev) {
  const t = tipEl();
  const mins = Math.round((Date.now() - q.time) / 60000);
  t.innerHTML =
    `<b>M${q.mag.toFixed(1)}</b> <span style="color:var(--t2)">${esc(q.place || 'unknown location')}</span>
     ${kvLine('Depth', `<b>${Math.round(q.depth)}</b> km`)}
     ${kvLine('Reported', ago(mins))}
     <div style="font-size:11px;color:var(--t3);margin-top:6px;max-width:230px;line-height:15px">
       USGS FDSN, event <span class="m">${esc(q.id)}</span>. This is an observation, not a forecast.</div>`;
  t.classList.add('on'); tipMove(ev);
}
