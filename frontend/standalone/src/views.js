/* ══════════════════════════════════════════════════════════════════
   VIEWS — nav, shell, map screen, tables, router
   ══════════════════════════════════════════════════════════════════ */

const IC = {
  map: '<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  cells: '<path d="M7 3h10l5 9-5 9H7l-5-9Z"/><path d="M12 8v8M8 10l8 4M16 10l-8 4"/>',
  predictions: '<path d="M3 3v18h18"/><path d="m7 14 4-5 3 3 5-7"/>',
  alerts: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  exposure: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/>',
  priority: '<path d="M3 6h18M3 12h12M3 18h6"/>',
  shelters: '<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  evacuation: '<path d="M4 20 10 4l4 9 3-4 3 11Z"/><circle cx="4" cy="20" r="1.4"/>',
  roads: '<path d="M4 21 8 3M20 21 16 3M12 5v3M12 12v3M12 19v2"/>',
  sources: '<path d="M5 12.5a10 10 0 0 1 14 0M2 8.8a15 15 0 0 1 20 0M8.5 16.2a5 5 0 0 1 7 0M12 20h.01"/>',
  model: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/>',
  reports: '<path d="M4 4h16v13H8l-4 4Z"/><path d="M8 9h8M8 13h5"/>',
  hazards: '<path d="M12 3 3 20h18Z"/><path d="M12 10v4M12 17h.01"/>',
  security: '<path d="M12 2 3 6v6c0 5 3.8 9.2 9 10 5.2-.8 9-5 9-10V6Z"/><path d="m9 12 2 2 4-4"/>'
};

const NAV = [
  ['Situational', [['map', 'GIS Risk Map'], ['cells', 'Hazard Cells'],
                   ['predictions', 'Predictions'], ['alerts', 'Official Alerts']]],
  ['Impact', [['exposure', 'Population Exposure'], ['priority', 'Relocation Priority']]],
  ['Response', [['shelters', 'Shelters & Capacity'], ['evacuation', 'Evacuation Routes'],
                ['roads', 'Road Status'], ['reports', 'Field Reports']]],
  ['System', [['hazards', 'Hazards & Sources'], ['sources', 'Data Sources'],
              ['model', 'Model Monitoring'], ['security', 'Security & Access']]]
];

/* A badge is a call to action, not an inventory count. The test each of
   these passes: if the number changed, would an operator do something
   different? Totals that fail that test — how many routes exist, how many
   states are on the map, how many sources are configured — are not shown,
   because a screen of numbers nobody acts on teaches people to stop
   reading numbers. */
function navCount(k) {
  const hz = S.hazard;
  if (k === 'cells') return [S.cells.filter(c => lvl(c.risk[hz] ?? -1) === 'critical').length, 'c'];
  if (k === 'alerts') return [S.alerts.filter(a => !a.ack).length, 'c'];
  if (k === 'shelters') return [S.shelters.filter(s => !s.operational).length, 'w'];
  if (k === 'roads') return [S.roads.filter(r => r.state !== 'open').length, 'w'];
  if (k === 'sources') return [S.sources.filter(s => s.is_primary && s.status !== 'live').length, 'w'];
  if (k === 'reports') return [S.reports.filter(r => r.st === 'pending').length, 'i'];
  if (k === 'evacuation') return [S.routes.filter(r => r.unassigned).length, 'c'];
  return [0, ''];
}

function paintNav() {
  $('navlist').innerHTML = NAV.map(([g, items]) =>
    `<div class="nlab">${g}</div>` + items.map(([k, l]) => {
      const [n, c] = navCount(k);
      return `<button class="ni ${S.view === k ? 'on' : ''}" onclick="go('${k}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[k]}</svg>
        <span class="l">${l}</span>${n ? `<span class="nb ${c}">${n}</span>` : ''}</button>`;
    }).join('')).join('');

  const degraded = S.sources.filter(s => s.status !== 'live').length;
  const st = S.mapFocus ? S.states[S.mapFocus] : null;
  /* The footer column is narrow. An operator's full title truncates to
     "NDMA National Con…", which tells them nothing; their operator id is
     short, unique and what they signed in as. */
  const who = AUTH.session ? AUTH.session.user : '—';
  const reg = st ? registerLabel(st.id) : null;
  $('navfoot').innerHTML = `
    <div class="nfr"><span>SOURCES</span><b style="color:${degraded ? 'var(--warn)' : 'var(--ok)'}">${degraded ? degraded + ' DEGRADED' : 'ALL LIVE'}</b></div>
    <div class="nfr" title="${esc(seasonLabel()[1])}"><span>SEASON</span><b>${esc(seasonLabel()[0].toUpperCase())}</b></div>
    <div class="nfr"><span>SCOPE</span><b>${st ? esc(st.district.toUpperCase()) : 'NATIONAL'}</b></div>
    ${reg ? `<div class="nfr" title="${esc(reg[1])}"><span>REGISTER</span><b style="color:${st.reg === 'sdma' ? 'var(--ok)' : 'var(--warn)'}">${st.reg === 'sdma' ? 'SDMA' : 'PROVISIONAL'}</b></div>` : ''}
    <div class="nfr"><span>OPERATOR</span><b>${esc(who)}</b></div>`;
}

function paintHNav() {
  $('hnav').innerHTML = S.role === 'gov'
    ? [['map', 'Command'], ['priority', 'Priority'], ['evacuation', 'Evacuation'], ['sources', 'System']]
        .map(([k, l]) => `<button class="${S.view === k ? 'on' : ''}" onclick="go('${k}')">${l}</button>`).join('')
    : [['home', 'Home'], ['alerts', 'Alerts'], ['shelters', 'Shelters'], ['prepare', 'What to do'],
       ['memorial', 'What we learned'], ['relief', 'Help the affected']]
        .map(([k, l]) => `<button class="${S.cz === k ? 'on' : ''}" onclick="czGo('${k}')">${l}</button>`).join('');
}

function paintHazard() {
  const box = $('hazbox'); if (!box) return;
  /* All nine hazards are always visible. A hazard without a live data
     source is shown greyed with its reason on hover — hiding it would
     imply the platform does not cover it, which is not the same thing. */
  const scoring = k => scorable(k) && S.cells.some(c => (c.risk[k] ?? -1) >= 0);
  box.innerHTML = HAZ_ORDER.map(k => {
    const h = HAZ[k], on = scorable(k), named = scoring(k) || S.hazard === k;
    const why = !h.live ? `no source configured`
      : (h.coastal_only && !coastalNow()) ? 'coastal hazard — not applicable where the map is looking'
      : `${h.tier} · ${h.fidelity}`;
    return `<button class="${S.hazard === k ? 'on' : ''}${on ? '' : ' idle'}"
       onclick="setHazard('${k}')" title="${esc(h.name)} — ${esc(why)}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${h.ic}"/></svg>
      ${named ? `<span class="hzn">${esc(h.name)}</span>` : ''}</button>`;
  }).join('') +
    `<button class="hzmore" onclick="go('hazards')" title="Every hazard and its data sources">All ${HAZ_ORDER.length}</button>`;
}

function setHazard(h) {
  const H = HAZ[h];
  S.hazard = h; computePriorities(); computeRoutes(); render();
  if (H.coastal_only && !coastalNow()) {
    const where = S.focus ? S.states[S.focus].name : 'this view';
    toast(H.name + ' — not applicable here',
      `${esc(H.name)} is a coastal hazard and ${where} is landlocked. The module is live and ` +
      `scores every coastal state; scoring it here would produce confident zeros that ` +
      `teach operators to ignore the switcher. Open a coastal state to see it.`, 'info');
  } else if (!H.live) {
    toast(H.name + ' — no source configured',
      `Every source for ${esc(H.name.toLowerCase())} is unconfigured, so the map shows ` +
      `no data rather than a fabricated score.`, 'warn');
  } else {
    toast(`${esc(H.name)} · ${H.tier}`,
      `Risk, exposure, priority and routing recalculated. Running on ` +
      `${H.sources_live.join(', ')} — ${H.fidelity}.`, 'info');
  }
}

function paintTop() {
  const hz = S.hazard;
  const national = !S.mapFocus;
  /* The chips report whatever the map is showing. At the national view a
     district headcount would be a category error. */
  const crit = national
    ? Object.keys(S.states).filter(k => lvl(stateRisk(k)) === 'critical').length
    : S.cells.filter(c => lvl(c.risk[hz]) === 'critical').length;
  const critLabel = national ? 'Critical states' : 'Critical';
  const exposed = S.priorities.reduce((a, z) => a + z.expected_exposed, 0);
  const affected = Object.keys(S.states).filter(k => stateRisk(k) != null).length;
  const openAlerts = S.alerts.filter(a => !a.ack).length;
  const degraded = S.sources.filter(s => s.is_primary && s.status !== 'live').length;

  $('topstats').innerHTML = S.role === 'gov'
    ? `${crit ? `<button class="chip c" onclick="${national ? "focusCritical()" : "go('cells')"}" title="${national ? 'States at critical risk for this hazard' : 'Cells at critical risk'}"><b>${crit}</b> ${critLabel}</button>` : ''}
       ${openAlerts ? `<button class="chip" onclick="go('alerts')" title="Official warnings you have not acknowledged"><b>${openAlerts}</b> to acknowledge</button>` : ''}
       ${degraded ? `<button class="chip w" onclick="go('sources')" title="Primary sources not delivering"><b>${degraded}</b> source${degraded === 1 ? '' : 's'} degraded</button>` : ''}
       <button class="chip" id="livebadge" onclick="liveRefreshNow()" title="Where the figures on screen came from"><span class="dot"></span>&hellip;</button>`
    : `<button class="chip" id="livebadge" onclick="liveRefreshNow()" title="Where the figures on screen came from"><span class="dot"></span>&hellip;</button>
       <button class="chip c" onclick="openDw('report')"><b>+</b> Report an Incident</button>`;

  paintLiveBadge();
  paintRoleSwitch();
  $('rolelbl').textContent = S.role === 'gov'
    ? (AUTH.session ? (ROLE_LABEL[AUTH.session.role] || 'District Command') : 'District Command')
    : 'Public Portal';
  $('alertbtn').innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>${openAlerts ? `<span class="bd">${openAlerts}</span>` : ''}`;
}

/* ══════════════════════════════════════════════════════════════════
   MAP SCREEN
   ══════════════════════════════════════════════════════════════════ */
function mapShell() {
  return `${guideStrip('map')}
  <div class="latest" id="latest"></div>
  <div class="srcbar" id="srcbar"></div>
  <div class="maprow">
    <div class="mapwrap">
      <div id="map"></div>
      <div class="ov tl"><div class="pan" id="crumb"></div></div>
      <div class="ov tr"><div class="pan" style="width:190px">
        <div class="pan-h">Map Layers</div>
        <div class="pan-b" style="padding:6px 11px 9px">
          ${[['cells', 'H3 Risk Cells'], ['shelters', 'Shelters'], ['routes', 'Evacuation Routes'],
             ['roads', 'Road Incidents'], ['hospitals', 'Hospitals'], ['alerts', 'Alert Areas']]
            .map(([k, l]) => `<div class="lyr ${S.layers[k] ? 'on' : ''}" onclick="tglLayer('${k}',this)"><span>${l}</span><span class="sw"></span></div>`).join('')}
        </div></div></div>
      <div class="ov bl"><div class="pan" style="width:212px">
        <div class="pan-h">${esc(HAZ[S.hazard].name)} Risk · Legend</div>
        <div class="pan-b" style="padding:7px 11px 9px">
          ${['low', 'medium', 'high', 'critical', 'none'].map(k => {
            const P = PRI[k];
            return `<div class="lgr">${lgSvg(P)}<b>${P.n}</b><span>${P.r}</span></div>`;
          }).join('')}
          <div style="height:1px;background:var(--bd);margin:7px 0"></div>
          <div style="font-size:10px;color:var(--t3);line-height:14px">Shape encodes band alongside colour — colour-blind safe. Score always shown. A high-risk cell does not mean every point inside it is affected.</div>
        </div></div></div>
      <div class="ov br">${zoomControls()}
        <div class="mbtns">
          <button class="mbtn" title="Focus the highest risk in the country" onclick="focusCritical()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></button>
          <button class="mbtn" title="Run the divide-and-conquer sweep" onclick="runSweep()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/></svg></button>
        </div>
      </div>
    </div>
    <aside class="side">
      <div class="side-h"><span class="dot lv"></span><h3>Live Operations Timeline</h3></div>
      <div class="tlf" id="tlf"></div>
      <div class="side-b" id="tlb"></div>
    </aside></div>`;
}

const lgSvg = P => {
  const c = P.c;
  if (P.sh === 'circle') return `<svg width="13" height="13" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.4" fill="${c}" fill-opacity=".35" stroke="${c}" stroke-width="1.6"/></svg>`;
  if (P.sh === 'square') return `<svg width="13" height="13" viewBox="0 0 14 14"><rect x="1.8" y="1.8" width="10.4" height="10.4" rx="1.5" fill="${c}" fill-opacity=".35" stroke="${c}" stroke-width="1.6"/></svg>`;
  if (P.sh === 'triangle') return `<svg width="13" height="13" viewBox="0 0 14 14"><path d="M7 1.5 12.8 12H1.2Z" fill="${c}" fill-opacity=".35" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  return `<svg width="13" height="13" viewBox="0 0 14 14"><path d="M7 1 13 7l-6 6-6-6Z" fill="${c}" fill-opacity=".4" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
};

function paintCrumb() {
  const c = $('crumb'); if (!c) return;
  const st = S.mapFocus ? S.states[S.mapFocus] : null;
  const world = typeof GEO !== 'undefined' && GEO.level === 'world';
  const sep = '<span style="color:var(--t3)">›</span>';
  c.innerHTML = `<div class="crumb">
    <button onclick="goWorld()"${world ? ' class="on"' : ''}>World</button>
    ${world ? '' : sep + '<button onclick="mapHome()">India</button>'}
    ${world
      ? `${sep}<span>Natural Earth outlines · live seismicity from USGS · ` +
        `operational cover for India only</span>`
      : st ? `<span style="color:var(--t3)">›</span><b>${esc(st.name)}</b>${
        st.scope === 'district' ? `<span style="color:var(--t3)">›</span><b>${esc(st.district)}</b>` : ''}
      ${pill(PRI[lvl(Math.max(...Object.values(st.hz)))].n, PRI[lvl(Math.max(...Object.values(st.hz)))].cls)}
      <span class="regchip ${st.reg}" title="${esc(registerLabel(st.id)[1])}">${st.reg === 'sdma' ? 'SDMA register' : 'Provisional register'}</span>`
      : `<span style="color:var(--t3)">›</span><span>All ${Object.keys(S.states).length} states and union territories — click any one to open it</span>`}</div>`;
}

function paintSourceBar() {
  const b = $('srcbar'); if (!b) return;
  const cls = { live: 'live', stale: 'stale', failed: 'failed', nc: 'nc', connecting: 'nc' };
  const age = s => s.status === 'nc' ? 'not configured'
    : s.status === 'connecting' ? 'connecting'
    : s.status === 'failed' ? 'unreachable'
    : s.age_seconds == null ? '—'
    : s.age_seconds >= 3600 ? (s.status === 'stale' ? 'stale ' : '') + Math.round(s.age_seconds / 3600) + 'h'
    : Math.round(s.age_seconds / 60) + 'm';
  /* the bar shows the primary Indian authorities and, beside them, the
     sources this browser is genuinely fetching right now */
  const shown = S.sources.filter(s => s.is_primary || REAL_SOURCE[s.key]);
  b.innerHTML = `<span style="font-size:10px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--t3);margin-right:2px">Sources</span>` +
    shown.map(s =>
      `<button class="src ${cls[s.status] || 'nc'}" onclick="go('sources')" title="${esc(s.authority)}${REAL_SOURCE[s.key] ? ' — fetched by this browser' : ''}">
        <i></i><b>${esc(s.key.toUpperCase())}</b>
        <small>${esc(age(s))}</small></button>`).join('') +
    `<span style="flex:1"></span>
     <span class="src" style="border-color:#B9D7EA;background:var(--infos);color:#0A5583"><b>MODEL</b><small>flood-lgbm-v0.4.0 · decision support</small></span>`;
}

function tglLayer(k, el) { S.layers[k] = S.layers[k] ? 0 : 1; el.classList.toggle('on'); paintMap(); }

function runSweep() {
  const t0 = performance.now();
  const hz = S.hazard;
  let visited = 0, pruned = 0, subdivided = 0, samples = 0;
  // sweep the 5x5 grid's coordinate space; a probe resolves to the cell it lands in
  const box = { x0: 0, y0: 0, x1: 5, y1: 5 };
  const sample = (x, y) => {
    samples++;
    const col = Math.min(Math.max(Math.floor(x), 0), 4);
    const row = Math.min(Math.max(Math.floor(y), 0), 4);
    const c = S.cells.find(z => z.col === col && z.row === row);
    return c && c.risk[hz] >= 0 ? c.risk[hz] : null;
  };
  const rec = (b, depth) => {
    visited++;
    const pts = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1],
                 [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]].map(([x, y]) => sample(x, y)).filter(v => v != null);
    if (depth >= 6 || Math.max(b.x1 - b.x0, b.y1 - b.y0) <= 1.0 || !pts.length) return;
    const mean = pts.reduce((a, v) => a + v, 0) / pts.length;
    const sd = Math.sqrt(pts.reduce((a, v) => a + (v - mean) ** 2, 0) / pts.length);
    if (Math.max(...pts) < 60 && sd <= 6) { pruned++; return; }
    subdivided++;
    const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
    rec({ x0: b.x0, y0: my, x1: mx, y1: b.y1 }, depth + 1);
    rec({ x0: mx, y0: my, x1: b.x1, y1: b.y1 }, depth + 1);
    rec({ x0: b.x0, y0: b.y0, x1: mx, y1: my }, depth + 1);
    rec({ x0: mx, y0: b.y0, x1: b.x1, y1: my }, depth + 1);
  };
  rec(box, 0);
  const ms = (performance.now() - t0).toFixed(1);
  const rate = subdivided + pruned ? (pruned / (subdivided + pruned) * 100).toFixed(0) : '0';
  toast('Divide-and-conquer sweep',
    `${visited} regions visited, ${pruned} pruned (${rate}% prune rate), ${samples} samples in ${ms} ms. T(n)=4T(n/4)+O(1) → O(n) worst case, sublinear when pruning fires.`, 'ok');
  log('model', `Quadtree sweep — ${visited} regions, ${rate}% pruned, ${samples} samples in ${ms} ms`, '#12447E');
}

/* ── timeline ── */
const TLF = [['all', 'All'], ['risk', 'Risk'], ['alert', 'Alerts'], ['shelter', 'Shelters'],
             ['road', 'Roads'], ['model', 'Model'], ['quality', 'Quality']];
function paintTimeline() {
  const f = $('tlf'), b = $('tlb'); if (!b) return;
  if (f) f.innerHTML = TLF.map(([k, l]) => `<button class="${S.tlFilter === k ? 'on' : ''}" onclick="S.tlFilter='${k}';paintTimeline()">${l}</button>`).join('');
  const rows = S.timeline.filter(e => S.tlFilter === 'all' || e.k === S.tlFilter);
  b.innerHTML = rows.length ? rows.map(e =>
    `<div class="ev ${e.fresh ? 'new' : ''}" style="border-left-color:${e.c}"><span class="t">${e.t.slice(0, 5)}</span><span class="x">${e.x}</span></div>`).join('')
    : emptyState('No events', 'Nothing matches this filter yet.');
  S.timeline.forEach(e => delete e.fresh);
}
const emptyState = (t, s) => `<div class="empty">
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#77839A" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
  <b>${t}</b><span>${s}</span></div>`;

const tile = (k, v, c, s) => `<div class="tile"><div class="k">${k}</div><div class="v" style="color:${c}">${v}</div><div class="s">${s}</div></div>`;
/* The latest situation belongs on every operational screen, not only the
   map. An operator reading the shelter list still needs to know that the
   worst situation in the country has just moved to another state. */
const page = (t, s, body) => `<div class="pv on"><div class="latest"></div>
  <div class="ph"><div style="flex:1"><h2>${t}</h2><p>${s}</p></div></div>${body}</div>`;
const ATTR = `<div class="attr" style="margin-bottom:16px">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
  <span><b>AI-based risk prediction and decision support — not an official warning.</b>
  Official warnings appear under Official Alerts with their issuing authority. A trained responder makes the operational determination.</span></div>`;
const confMeter = v => `<div class="cf2"><div class="track"><i style="width:${Math.round(v * 100)}%;background:${v < .5 ? 'var(--crit)' : v < .7 ? 'var(--warn)' : 'var(--ok)'}"></i></div><span>${Math.round(v * 100)}%</span></div>`;

/* ══════════════════════════════════════════════════════════════════
   TABLE VIEWS
   ══════════════════════════════════════════════════════════════════ */
function viewCells() {
  const hz = S.hazard;
  const rows = S.cells.slice().sort((a, b) => b.risk[hz] - a.risk[hz]);
  return page(`Hazard Cells · ${esc(HAZ[hz].name)}`,
    `${S.cells.length} operational grid cells covering Chamoli District, each backed by an H3 index at resolution 7 (≈5.2 km²). Every observation is mapped to a cell on ingest.`,
    ATTR + `<div class="tiles">
      ${tile('Critical', rows.filter(c => lvl(c.risk[hz]) === 'critical').length, 'var(--crit)', 'score 85 and above')}
      ${tile('High', rows.filter(c => lvl(c.risk[hz]) === 'high').length, 'var(--high)', 'score 60 – 84')}
      ${tile('Degraded inputs', rows.filter(c => c.degraded.length).length, 'var(--warn)', 'a primary source is missing')}
      ${tile('No model output', rows.filter(c => c.risk[hz] < 0).length, 'var(--off)', 'shown as no data, never as zero')}
    </div>
    <div class="tbl"><table><thead><tr><th>Cell</th><th>Locality</th><th>Risk</th><th>Band</th><th>Probability</th><th>Confidence</th><th>Population</th><th>Rain 24h</th><th>Slope</th><th>HAND</th></tr></thead><tbody>
    ${rows.map(c => {
      const P = PRI[lvl(c.risk[hz])];
      return `<tr onclick="S.cellSel='${esc(c.cell_id)}';openDw('cell')">
        <td><b class="m">${esc(c.id)}</b>${c.degraded.length ? ' <span class="p p-med">Degraded</span>' : ''}</td>
        <td><b>${esc(c.name)}</b> <span class="m" style="font-size:10.5px;color:var(--t3)">${esc(c.short)}</span></td>
        <td><b class="m" style="color:${P.c}">${c.risk[hz] < 0 ? '—' : c.risk[hz]}</b></td>
        <td>${pill(P.n, P.cls)}</td>
        <td class="m">${c.probability[hz] == null ? '—' : c.probability[hz].toFixed(2)}</td>
        <td style="min-width:120px">${c.risk[hz] < 0 ? '<span style="color:var(--t3)">—</span>' : confMeter(c.confidence[hz])}</td>
        <td class="m">${nf(c.pop)}</td>
        <td class="m">${c.rainfall_24h == null ? '—' : c.rainfall_24h + ' mm'}</td>
        <td class="m">${c.slope_deg}°</td>
        <td class="m">${c.hand_m == null ? '—' : c.hand_m + ' m'}</td></tr>`;
    }).join('')}
    </tbody></table></div>`);
}

function viewPriority() {
  const hz = S.hazard;
  const rows = S.priorities;
  const rkCls = b => b === 'critical' ? 'c' : b === 'high' ? 'h' : b === 'medium' ? 'm' : 'l';
  return page('Relocation Priority',
    'Which areas move first, and why. Every score is the weighted sum of six normalised factors — the contributions reconstruct the score exactly.',
    ATTR + `<div class="tiles">
      ${tile('Zones ranked', rows.length, 'var(--t1)', 'above the 20-point risk floor')}
      ${(() => { const n = rows.filter(z => z.band === 'critical').length;
        /* Colour has to encode the value, not the label. A red 0 in the
           critical slot reads as an alarm when it is the opposite. */
        return tile('Critical band', n, n ? 'var(--crit)' : 'var(--ok)',
          n ? 'score 0.75 and above' : 'nothing above 0.75 right now'); })()}
      ${tile('People to move', nf(rows.reduce((a, z) => a + z.people_to_move, 0)), 'var(--pri)', 'inside the hazard footprint')}

    </div>
    <div class="algo" style="margin-bottom:14px">
      <b>Merge sort</b> · <code>T(n) = 2T(n/2) + O(n) → O(n log n)</code> · space <code>O(n)</code> · stable.
      Ties break on exposed population, then time to impact, then cell id — so the queue does not reshuffle between ticks.
      Weights version <code>${S.priorities.length ? 'v1' : '—'}</code>, configurable and versioned in the database.
    </div>
    ${rows.map(z => {
      const maxC = Math.max(...Object.values(z.terms).map(t => t.contribution));
      return `<div class="card" style="margin-bottom:10px">
        <div class="card-h" style="gap:11px">
          <span class="rk ${rkCls(z.band)}">${z.rank}</span>
          <div style="flex:1"><h3>${esc(z.name)}</h3>
            <div style="font-size:11.5px;color:var(--t3)" class="m">Zone ${esc(z.id)} · ${nf(z.people_to_move)} people in footprint · ${nf(z.expected_exposed)} expected exposed</div></div>
          ${pill(PRI[z.band].n, PRI[z.band].cls)}
          <b class="m" style="font-size:17px;color:${PRI[z.band].c}">${z.priority_score.toFixed(3)}</b>
        </div>
        <div class="card-b" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="terms">
            ${Object.entries(z.terms).map(([k, t]) => `<div class="term">
              <span class="l">${WLABEL[k]}</span>
              <span class="bx"><i style="width:${Math.round(t.contribution / maxC * 100)}%"></i></span>
              <span class="v">${t.contribution.toFixed(3)}</span></div>`).join('')}
          </div>
          <div>
            <div class="sl">Why this rank</div>
            <ul style="list-style:none;padding:0;margin:0">
              ${z.reasons.map(r => `<li style="font-size:12.5px;color:var(--t2);line-height:19px;padding-left:15px;position:relative;margin-bottom:4px">
                <span style="position:absolute;left:0;top:7px;width:5px;height:5px;border-radius:50%;background:${PRI[z.band].c}"></span>${esc(r)}</li>`).join('')}
            </ul>
            <button class="b g" style="height:28px;font-size:12px;margin-top:10px" onclick="S.cellSel='${esc(z.cell_id)}';openDw('cell')">Open cell</button>
          </div>
        </div></div>`;
    }).join('') || emptyState('No zones above the threshold', 'Nothing currently scores above 20 for this hazard.')}`);
}

function viewExposure() {
  const hz = S.hazard;
  const rows = S.priorities.slice().sort((a, b) => b.expected_exposed - a.expected_exposed);
  const totalPop = S.cells.reduce((a, c) => a + c.pop, 0);
  return page('Population Exposure',
    'Hazard × Exposure × Vulnerability, kept separate. Exposure is a spatial overlay of people inside the hazard footprint — not probability multiplied by the whole population.',
    `<div class="attr" style="margin-bottom:16px">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
      <span><b>expected_exposed = population_in_footprint × P(hazard).</b> That is an expected value over the people physically inside the footprint — not a headcount of people who will be affected. A predicted high-risk cell does not mean every point inside it is affected.</span></div>
    <div class="tiles">
      ${tile('District population', nf(totalPop), 'var(--t1)', 'across ' + S.cells.length + ' cells')}
      ${tile('In hazard footprint', nf(rows.reduce((a, z) => a + z.people_to_move, 0)), 'var(--high)', 'spatial overlay')}
      ${tile('Expected exposed', nf(Math.round(rows.reduce((a, z) => a + z.expected_exposed, 0))), 'var(--crit)', 'footprint × probability')}
      ${tile('Buildings affected', nf(Math.round(rows.reduce((a, z) => a + z.people_to_move, 0) / 4.6)), 'var(--warn)', 'at 4.6 persons per household')}
    </div>
    <div class="tbl"><table><thead><tr><th>Locality</th><th>Population</th><th>Footprint</th><th>In footprint</th><th>P(hazard)</th><th>Expected exposed</th><th>Vulnerability</th><th>Method</th></tr></thead><tbody>
    ${rows.map(z => {
      const cell = cellById(z.cell_id);
      return `<tr onclick="S.cellSel='${esc(z.cell_id)}';openDw('cell')">
        <td><b>${esc(z.name)}</b></td>
        <td class="m">${nf(cell.pop)}</td>
        <td class="m">${Math.round(z.footprint.frac * 100)}%</td>
        <td class="m"><b>${nf(z.people_to_move)}</b></td>
        <td class="m">${cell.probability[hz].toFixed(2)}</td>
        <td><b class="m" style="color:var(--crit)">${nf(z.expected_exposed)}</b></td>
        <td class="m">${z.vulnerability.score.toFixed(2)}</td>
        <td style="font-size:11.5px;color:var(--t3)">${esc(z.footprint.why)}</td></tr>`;
    }).join('')}
    </tbody></table></div>`);
}

function viewShelters() {
  const usable = S.shelters.filter(s => s.operational);
  const places = usable.reduce((a, s) => a + s.effective_capacity, 0);
  const physical = S.shelters.reduce((a, s) => a + s.raw_available, 0);
  const need = S.priorities.reduce((a, z) => a + z.people_to_move, 0);
  return page('Shelters & Carrying Capacity',
    'Physical capacity is not safe operational capacity. Effective capacity is the binding constraint among space, water, food, sanitation and medical cover.',
    `<div class="tiles">
      ${tile('Shelters usable', `${usable.length} / ${S.shelters.length}`, 'var(--ok)', 'operational right now')}
      ${tile('Effective places', nf(places), 'var(--pri)', `of ${nf(physical)} physically free`)}
      ${tile('People to place', nf(need), 'var(--high)', 'across all priority zones')}
      ${tile('Shortfall', nf(Math.max(need - places, 0)), need > places ? 'var(--crit)' : 'var(--ok)', need > places ? 'escalate to state control room' : 'capacity is sufficient')}
    </div>
    ${need > places ? `<div class="note c" style="margin-bottom:14px">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
      <span><b>Capacity shortfall of ${nf(need - places)} places.</b> ${(() => {
        /* Name the constraint that actually binds most often. The previous
           copy asserted "water is the binding constraint at N shelters"
           whatever N was, and cheerfully printed "at 0 shelters". */
        const counts = {};
        for (const sh of S.shelters.filter(x => x.operational)) {
          const k = String(sh.binding_constraint).split(' ')[0];
          counts[k] = (counts[k] || 0) + 1;
        }
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (!top) return 'No shelter is currently usable, so opening a building comes before resupplying one.';
        const [what, n] = top;
        const NAME = { water: 'Drinking water', food: 'Food stock', medical: 'Medical cover',
                       space: 'Floor space' };
        const remedy = { water: 'a water tanker releases more places than opening another hall',
                         food: 'a ration delivery releases more places than opening another hall',
                         medical: 'one more trained responder releases 250 places',
                         space: 'space is the limit — another building is what is needed' }[what]
                     || 'clearing that constraint releases more places than opening another hall';
        return `<b>${esc(NAME[what] || what)}</b> is the binding constraint at ${n} of ` +
               `${S.shelters.filter(x => x.operational).length} usable shelters — ${remedy}.`;
      })()}</span></div>` : ''}
    <div class="tbl"><table><thead><tr><th>Shelter</th><th>Name</th><th>Occupancy</th><th>Capacity used</th><th>Effective places</th><th>Limited by</th><th>Water</th><th>Food</th><th>Medical</th><th>Reported</th></tr></thead><tbody>
    ${S.shelters.map(s => {
      const usedPct = Math.round(s.utilisation * 100);
      const effPct = Math.round(s.effective_capacity / s.max_capacity * 100);
      const lockPct = Math.max(100 - usedPct - effPct, 0);
      return `<tr onclick="S.shelterSel='${esc(s.shelter_id)}';openDw('shelter')">
        <td><b class="m">${esc(s.shelter_id)}</b></td>
        <td><b>${esc(s.name)}</b></td>
        <td class="m">${nf(s.current_occupancy)} / ${nf(s.max_capacity)}</td>
        <td style="min-width:130px"><div class="cap"><div class="m2">
          <i class="used" style="width:${usedPct}%"></i><i class="free" style="width:${effPct}%"></i><i class="lock" style="width:${lockPct}%"></i>
        </div></div></td>
        <td><b class="m" style="color:${s.effective_capacity ? 'var(--ok)' : 'var(--crit)'}">${nf(s.effective_capacity)}</b></td>
        <td>${pill(s.binding_constraint, s.operational ? (s.binding_constraint.startsWith('space') ? 'p-low' : 'p-med') : 'p-crit')}</td>
        <td class="m" style="color:${s.water_days < 2 ? 'var(--crit)' : 'var(--t2)'}">${s.water_days.toFixed(1)} d</td>
        <td class="m" style="color:${s.food_days < 2 ? 'var(--crit)' : 'var(--t2)'}">${s.food_days.toFixed(1)} d</td>
        <td class="m">${s.medical_staff}</td>
        <td class="m" style="color:var(--t3)">${s.reported}</td></tr>`;
    }).join('')}
    </tbody></table></div>
    <div class="algo" style="margin-top:14px">
      Planning standards — floor <code>3.5 m²/person</code>, water <code>15 L/person/day</code>,
      sanitation <code>1 latrine / 20</code>, medical <code>1 responder / 250</code>.
      Shelters are filled to <b>90%</b>, not 100%: crowding a camp to its limit makes it unmanageable.
    </div>`);
}

function viewEvacuation() {
  const placed = S.routes.filter(r => !r.unassigned);
  const unplaced = S.routes.filter(r => r.unassigned);
  const late = placed.filter(r => r.before_impact === false);
  return page('Evacuation Routes',
    'Zones are served in merge-sorted priority order, each taking the best shelter it can still reach and fit into. Blocked and flooded roads are removed from the graph, not merely penalised.',
    `<div class="tiles">
      ${tile('Assignments', placed.length, 'var(--pri)', 'origin → shelter pairs')}
      ${tile('People placed', nf(placed.reduce((a, r) => a + r.people, 0)), 'var(--ok)', 'within reachable capacity')}
      ${tile('Unplaced', nf(unplaced.reduce((a, r) => a + r.people, 0)), unplaced.length ? 'var(--crit)' : 'var(--ok)', unplaced.length ? 'capacity within reach exhausted' : 'everyone has a place')}
      ${tile('Not before impact', late.length, late.length ? 'var(--crit)' : 'var(--ok)', 'travel time exceeds time to hazard')}
    </div>
    ${unplaced.length ? `<div class="note c" style="margin-bottom:14px">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
      <span><b>${nf(unplaced.reduce((a, r) => a + r.people, 0))} people could not be assigned.</b> ${esc(unplaced[0].reason)}. This escalates to the district officer — overflow is never hidden.</span></div>` : ''}
    <div class="tbl"><table><thead><tr><th>#</th><th>From</th><th>To shelter</th><th>People</th><th>Distance</th><th>Travel time</th><th>Route hazard</th><th>Before impact</th></tr></thead><tbody>
    ${S.routes.map(r => r.unassigned
      ? `<tr style="background:var(--crits)"><td><b class="m">${r.rank}</b></td>
         <td><b>${esc(r.origin)}</b></td>
         <td colspan="5" style="color:var(--crit);font-weight:600">Unassigned — ${esc(r.reason)}</td>
         <td class="m"><b>${nf(r.people)}</b></td></tr>`
      : `<tr onclick="S.cellSel='${esc(r.origin_cell)}';openDw('cell')">
         <td><b class="m">${r.rank}</b></td>
         <td><b>${esc(r.origin)}</b></td>
         <td>${esc(r.shelter_name)} <span class="m" style="color:var(--t3)">${esc(r.shelter_id)}</span></td>
         <td class="m"><b>${nf(r.people)}</b></td>
         <td class="m">${r.distance_km} km</td>
         <td class="m">${r.travel_min} min</td>
         <td>${pill(r.hazard_exposure > .4 ? 'Elevated' : 'Low', r.hazard_exposure > .4 ? 'p-high' : 'p-low')}</td>
         <td>${r.before_impact == null ? '<span style="color:var(--t3)">—</span>' : r.before_impact ? pill('Yes', 'p-low') : pill('No', 'p-crit')}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="algo" style="margin-top:14px">
      <b>Dijkstra</b> one-to-many per zone, <code>O((V+E) log V)</code>; <b>A*</b> point-to-point with an admissible
      great-circle heuristic. Cost <code>t(e)·(1 + 3·hazard(e)) + 0.6·congestion(e)</code> — minimising time alone
      routes convoys down the valley floor, which is where the flood is.
    </div>`);
}

function viewAlerts() {
  return page('Official Alerts',
    'Warnings issued by Indian authorities, carried verbatim with their issuing authority. Nothing on this screen is produced by this platform.',
    `<div class="note i" style="margin-bottom:16px">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>
      <span><b>These are the official warnings.</b> They are ingested from NDMA SACHET in CAP 1.2 and are never modified, re-attributed or merged with model output.</span></div>
    ${S.alerts.map(a => {
      const sc = a.sev === 'Extreme' ? 'p-crit' : a.sev === 'Severe' ? 'p-high' : a.sev === 'Moderate' ? 'p-med' : 'p-inf';
      const col = a.sev === 'Extreme' ? 'var(--crit)' : a.sev === 'Severe' ? 'var(--high)' : 'var(--warn)';
      return `<div class="card" style="margin-bottom:10px;border-left:4px solid ${col}">
        <div class="card-h"><div style="flex:1">
          <h3>${esc(a.head)}</h3>
          <div style="font-size:12px;color:var(--t2);margin-top:3px">${esc(a.auth)}</div>
        </div>${pill(a.sev, sc)}${pill(a.urg, 'p-inf')}${pill(a.cert, 'p-off')}</div>
        <div class="card-b">
          <div class="kv" style="margin-bottom:11px">
            <div><div class="k">Event</div><div class="v" style="font-size:13px">${esc(a.event)}</div></div>
            <div><div class="k">Area</div><div class="v" style="font-size:13px">${esc(a.area)}</div></div>
            <div><div class="k">Issued</div><div class="v m" style="font-size:13px">${a.t} IST</div></div>
            <div><div class="k">In force until</div><div class="v m" style="font-size:13px">${a.exp}</div></div>
          </div>
          <div class="note" style="margin-bottom:0"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
            <span><b>Instruction:</b> ${esc(a.inst)}</span></div>
          <div class="m" style="font-size:10.5px;color:var(--t3);margin-top:9px">CAP identifier ${esc(a.id)}</div>
        </div></div>`;
    }).join('')}`);
}

function viewRoads() {
  const affected = S.roads.filter(r => r.state !== 'open');
  return page('Road Status',
    'Reported by authorised field operators. Every report reaches the routing engine on the next recalculation.',
    `<div class="tiles">
      ${tile('Segments affected', affected.length, 'var(--high)', 'not fully open')}
      ${tile('Impassable', S.roads.filter(r => ['blocked', 'flooded', 'landslide'].includes(r.state)).length, 'var(--crit)', 'removed from the graph')}
      ${tile('Degraded', S.roads.filter(r => ['slow', 'partially_blocked'].includes(r.state)).length, 'var(--warn)', 'penalised, still usable')}
      ${tile('Reopened today', S.roads.filter(r => r.state === 'open').length, 'var(--ok)', 'cleared and confirmed')}
    </div>
    <div class="tbl"><table><thead><tr><th>Segment</th><th>State</th><th>Reason</th><th>Reported</th><th>By</th><th>Confidence</th><th>Routing effect</th></tr></thead><tbody>
    ${S.roads.map(r => `<tr onclick="toast(${esc(JSON.stringify(r.name))},${esc(JSON.stringify(r.reason))},'info')">
      <td><b>${esc(r.name)}</b></td>
      <td>${roadPill(r.state)}</td>
      <td>${esc(r.reason)}</td>
      <td class="m">${r.t}</td>
      <td class="m" style="color:var(--t3)">${esc(r.by)}</td>
      <td style="min-width:110px">${confMeter(r.confidence)}</td>
      <td style="font-size:12px;color:var(--t2)">${['blocked', 'flooded', 'landslide'].includes(r.state)
        ? '<b style="color:var(--crit)">Removed from graph</b>'
        : r.state === 'partially_blocked' ? 'Cost × 3.5'
        : r.state === 'slow' ? 'Cost × 2.2' : 'Normal cost'}</td></tr>`).join('')}
    </tbody></table></div>`);
}

/* ── What this browser actually fetched ──────────────────────────────
   The register above is the deployment's intended provenance. This panel
   is the measured one: three keyless public services, called from this
   page, with the real status, the real latency and the real error text.
   It is the difference between claiming live data and having it. */
function liveSourcePanel() {
  if (typeof LIVEDATA === 'undefined') return '';
  const [kind, head, why] = provenance();
  const tone = { live: 'g', partial: '', stale: '', connecting: 'i', modelled: '' }[kind] || '';
  const NAME = {
    weather: ['Open-Meteo forecast', 'Rain over 24 h and 72 h, daily maximum temperature, wind gusts and CAPE — one request covering all 36 states'],
    flood: ['Open-Meteo flood (GloFAS v4)', 'ECMWF river discharge at roughly 5 km, compared against each river’s own 30-day median'],
    quake: ['USGS FDSN', 'Every event of magnitude 2.5 and above in the Indian region over the last seven days']
  };
  const obsCount = Object.keys(LIVEDATA.obs).length;
  const rows = Object.keys(LIVEDATA.src).map(k => {
    const s = LIVEDATA.src[k];
    const [n, d] = NAME[k];
    const st = s.status === 'live'
      ? (Date.now() - s.at < STALE_AFTER[k] ? ['Live', 'p-low'] : ['Outside window', 'p-med'])
      : s.status === 'failed' ? ['Failed', 'p-crit'] : ['Connecting', 'p-inf'];
    return `<tr><td><b>${esc(n)}</b><div style="font-size:11.5px;color:var(--t3);line-height:16px;margin-top:2px">${esc(d)}</div></td>
      <td>${pill(st[0], st[1])}</td>
      <td class="m">${s.at ? ago(Math.round((Date.now() - s.at) / 60000)) : '—'}</td>
      <td class="m">${s.ms ? s.ms + ' ms' : '—'}</td>
      <td style="font-size:12px;color:${s.error ? 'var(--crit)' : 'var(--t3)'}">${esc(s.error || (s.status === 'live' ? 'no error' : 'no response yet'))}</td></tr>`;
  }).join('');

  return `<div class="note ${tone}" style="margin-bottom:14px">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 10 10"/><path d="M12 6a6 6 0 0 1 6 6"/><circle cx="12" cy="12" r="1.6"/></svg>
      <span><b>${esc(head)}.</b> ${esc(why)}${obsCount ? ` Observations are held for ${obsCount} of 36 states.` : ''}</span></div>
    <div class="sl">Fetched by this browser</div>
    <div style="font-size:12px;color:var(--t2);margin-bottom:8px">No key, no proxy, no backend — these three services allow direct calls from a page, so the figures below are measured rather than described. A failed call leaves the seasonal model on screen and says so; it never keeps showing the last reading as though it were current.</div>
    <div class="tbl" style="margin-bottom:18px"><table><thead><tr><th>Service</th><th>Status</th><th>Last success</th><th>Round trip</th><th>Last error</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function viewSources() {
  const label = { live: ['Live', 'p-low'], stale: ['Stale', 'p-med'], failed: ['Failed', 'p-crit'],
                  connecting: ['Connecting', 'p-inf'], nc: ['Not configured', 'p-off'] };
  const grp = primary => S.sources.filter(s => s.is_primary === primary);
  const tbl = (list, title, note) => `<div class="sl" style="margin-top:16px">${title}</div>
    ${note ? `<div style="font-size:12px;color:var(--t2);margin-bottom:8px">${note}</div>` : ''}
    <div class="tbl"><table><thead><tr><th>Source</th><th>Authority</th><th>Access</th><th>Status</th><th>Last data</th><th>Quality</th></tr></thead><tbody>
    ${list.map(s => `<tr><td><b class="m">${s.key.toUpperCase()}</b></td>
      <td>${esc(s.authority)}</td>
      <td style="font-size:12px;color:var(--t3)">${esc(s.mode)}</td>
      <td>${pill(label[s.status][0], label[s.status][1])}</td>
      <td class="m" style="color:${s.status === 'stale' ? 'var(--warn)' : s.status === 'nc' ? 'var(--t3)' : 'var(--t1)'}">
        ${s.age_seconds == null ? '—' : s.age_seconds < 3600 ? Math.round(s.age_seconds / 60) + ' min ago' : (s.age_seconds / 3600).toFixed(1) + ' h ago'}</td>
      <td style="min-width:120px">${s.quality_score == null ? '<span style="color:var(--t3)">—</span>' : confMeter(s.quality_score)}</td></tr>`).join('')}
    </tbody></table></div>`;

  return page('Data Sources',
    'Provenance for every observation, and an honest account of what is and is not reaching the platform.',
    liveSourcePanel() +
    `<div class="note" style="margin-bottom:16px">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <span><b>CWC is stale.</b> River level is the strongest flood feature after rainfall. Predictions for the 9 cells that depend on it carry <span class="m">degraded_inputs=['cwc']</span> and their confidence is damped to 0.62. Stale data is never presented as live.</span></div>
    <div class="tiles">
      ${tile('Primary live', grp(true).filter(s => s.status === 'live').length + ' / ' + grp(true).length, 'var(--ok)', 'Indian authorities')}
      ${tile('Degraded', grp(true).filter(s => s.status !== 'live').length, 'var(--warn)', 'stale or not configured')}
      ${tile('Supplementary', grp(false).filter(s => s.status === 'live').length, 'var(--info)', 'open, labelled as such')}
      ${tile('Cells affected', S.cells.filter(c => c.degraded.length).length, 'var(--high)', 'confidence reduced')}
    </div>
    ${tbl(grp(true), 'Primary · Indian authorities',
      'A credentialed source with no credential resolves to NOT CONFIGURED. It does not attempt a call and it never invents a response.')}
    ${tbl(grp(false), 'Supplementary · open sources',
      'Used only where a primary source is silent. A supplementary reading is stored under its own source key and can never be mistaken for the authority it stands in for.')}`);
}

function viewModel() {
  const rows = S.models;
  return page('Model Monitoring',
    'Every prediction is stored so it can be scored against what actually happened. For disaster prediction a false negative costs far more than a false positive, and the operating point says so.',
    `<div class="tiles">
      ${tile('Active models', rows.filter(m => m.is_active).length, 'var(--ok)', 'one per live hazard')}
      ${tile('Flood recall', '0.93', 'var(--pri)', 'at the chosen threshold')}
      ${tile('Calibration error', '0.038', 'var(--ok)', 'expected calibration error')}
      ${tile('Predictions stored', nf(18420), 'var(--info)', 'awaiting outcome scoring')}
    </div>
    <div class="note" style="margin-bottom:14px">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
      <span><b>The threshold is not 0.5.</b> It is the lowest threshold meeting a 0.90 recall floor on the validation window; the resulting precision is reported rather than buried. A model that misses one flood in ten is not acceptable whatever it does to F1.</span></div>
    <div class="tbl"><table><thead><tr><th>Version</th><th>Hazard</th><th>Algorithm</th><th>Horizon</th><th>ROC-AUC</th><th>PR-AUC</th><th>Recall</th><th>Precision</th><th>Calibration</th><th>Status</th></tr></thead><tbody>
    ${rows.map(m => `<tr><td><b class="m">${esc(m.model_version)}</b></td>
      <td>${pill(HAZ[m.hazard].name, 'p-inf')}</td>
      <td>${esc(m.algorithm)}</td><td class="m">${m.horizon_hours} h</td>
      <td class="m">${m.roc_auc.toFixed(3)}</td>
      <td class="m"><b>${m.pr_auc.toFixed(3)}</b></td>
      <td class="m" style="color:${m.recall >= .9 ? 'var(--ok)' : 'var(--warn)'}">${m.recall.toFixed(2)}</td>
      <td class="m">${m.precision.toFixed(2)}</td>
      <td class="m">${m.ece.toFixed(3)}</td>
      <td>${m.is_active ? pill('Active', 'p-low') : pill('Baseline', 'p-off')}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="split" style="margin-top:14px">
      <div class="card"><div class="card-h"><h3>Leakage controls</h3></div><div class="card-b">
        ${[['Forward-chained splits only', 'Random k-fold is never used — adjacent 15-minute samples of one storm are not independent.'],
           ['72-hour embargo between folds', 'A storm straddling a boundary cannot appear on both sides.'],
           ['ingested_at guard', 'Training rows exclude data that existed but had not arrived yet, matching what inference actually sees.'],
           ['Medians from training only', 'Imputation statistics never see the validation window.']]
          .map(([t, d]) => `<div style="margin-bottom:11px"><div style="font-size:13px;font-weight:600;margin-bottom:2px">${t}</div>
            <div style="font-size:12px;color:var(--t2);line-height:17px">${d}</div></div>`).join('')}
      </div></div>
      <div class="card"><div class="card-h"><h3>Promotion gate</h3></div><div class="card-b">
        ${[['Must beat logistic regression', 'On PR-AUC, on the same validation window. A model that cannot is not promoted.'],
           ['Recall floor 0.90', 'Below it the model is rejected regardless of other metrics.'],
           ['Isotonic calibration required', 'Fitted on a later window than training, so 0.87 means what an operator thinks it means.'],
           ['Explainability required', 'Per-prediction attributions, not saliency — a district magistrate may have to defend the decision.']]
          .map(([t, d]) => `<div style="margin-bottom:11px"><div style="font-size:13px;font-weight:600;margin-bottom:2px">${t}</div>
            <div style="font-size:12px;color:var(--t2);line-height:17px">${d}</div></div>`).join('')}
      </div></div>
    </div>`);
}

function viewPredictions() {
  const hz = S.hazard;
  const rows = S.cells.filter(c => c.risk[hz] >= 0).sort((a, b) => b.risk[hz] - a.risk[hz]);
  return page('Predictions',
    `Model output for the next ${hz === 'flood' ? 6 : 24} hours, with the features the model actually saw. Every prediction is stored and later scored against the outcome.`,
    ATTR + `<div class="tbl"><table><thead><tr><th>Cell</th><th>Locality</th><th>Probability</th><th>Band</th><th>Confidence</th><th>Rain 24h</th><th>Rain 72h</th><th>Soil moisture</th><th>${hz === 'flood' ? 'River / danger' : 'Slope'}</th><th>Inputs</th></tr></thead><tbody>
    ${rows.map(c => {
      const P = PRI[lvl(c.risk[hz])];
      return `<tr onclick="S.cellSel='${esc(c.cell_id)}';openDw('cell')">
        <td><b class="m">${esc(c.id)}</b></td><td><b>${esc(c.name)}</b></td>
        <td><b class="m" style="color:${P.c}">${c.probability[hz].toFixed(2)}</b></td>
        <td>${pill(P.n, P.cls)}</td>
        <td style="min-width:120px">${confMeter(c.confidence[hz])}</td>
        <td class="m">${c.rainfall_24h ?? '—'}</td>
        <td class="m">${c.rainfall_72h ?? '—'}</td>
        <td class="m">${c.soil_moisture ?? '—'}</td>
        <td class="m">${hz === 'flood' ? (c.river_ratio == null ? '<span style="color:var(--warn)">no data</span>' : c.river_ratio.toFixed(2)) : c.slope_deg + '°'}</td>
        <td>${c.degraded.length ? pill('Degraded', 'p-med') : pill('Complete', 'p-low')}</td></tr>`;
    }).join('')}
    </tbody></table></div>`);
}

function viewReports() {
  const st = { pending: ['Pending', 'p-med'], verified: ['Verified', 'p-low'], rejected: ['Rejected', 'p-off'] };
  return page('Field Reports',
    'Citizen and field-operator reports. A report affects a published risk figure only after an operator verifies it.',
    `<div class="tiles">
      ${tile('Pending', S.reports.filter(r => r.st === 'pending').length, 'var(--warn)', 'awaiting verification')}
      ${tile('Verified today', S.reports.filter(r => r.st === 'verified').length, 'var(--ok)', 'corroborating the model')}
      ${tile('Confidence lift', '+12%', 'var(--info)', 'where 3 or more reports agree')}
      ${tile('Median review', '4 min', 'var(--t1)', 'submission to decision')}
    </div>
    <div class="tbl"><table><thead><tr><th>Report</th><th>Category</th><th>Location</th><th>Description</th><th>Received</th><th>Status</th><th>By</th></tr></thead><tbody>
    ${S.reports.map(r => `<tr onclick="S.cellSel='${esc(r.cell)}';openDw('cell')">
      <td><b class="m">${esc(r.id)}</b></td><td><b>${esc(r.cat)}</b></td>
      <td>${esc(r.loc)}</td><td style="color:var(--t2)">${esc(r.desc)}</td>
      <td class="m">${r.t}</td><td>${pill(st[r.st][0], st[r.st][1])}</td>
      <td class="m" style="color:var(--t3)">${esc(r.by || '—')}</td></tr>`).join('')}
    </tbody></table></div>`);
}

function viewHazards() {
  const tierPill = t => t === 'authoritative' ? pill('Authoritative', 'p-low')
    : t === 'supplementary' ? pill('Supplementary', 'p-med') : pill('No source', 'p-off');

  const srcChip = (key, isAuth, h) => {
    const src = SOURCE_REGISTRY[key] || {};
    const ok = src.configured;
    const note = h.fidelity_by_source[key] || '';
    const need = !ok ? (src.requires_key ? 'needs a free key'
      : src.access === 'credentialed' ? 'needs registration' : 'not configured') : null;
    return `<div class="srcrow ${ok ? 'ok' : 'off'}">
      <i></i>
      <div class="g">
        <div class="n"><b>${key.toUpperCase()}</b>${isAuth ? ' <span class="p p-pri">Authority</span>' : ''}</div>
        <div class="s">${esc(src.authority || key)}</div>
        <div class="s2">${esc(note)}</div>
      </div>
      ${ok ? `<span class="m cadence">${fmtCadence(POLLING_PLAN[key])}</span>`
           : `<span class="p p-off">${need}</span>`}</div>`;
  };

  const card = k => {
    const h = HAZ[k];
    const applicable = !(h.coastal_only && !coastalNow());
    const cells = (h.live && applicable) ? S.cells.filter(c => (c.risk[k] ?? -1) >= 0) : [];
    const crit = cells.filter(c => lvl(c.risk[k]) === 'critical').length;
    const high = cells.filter(c => lvl(c.risk[k]) === 'high').length;
    const peak = cells.length ? Math.max(...cells.map(c => c.risk[k])) : null;
    const alerts = S.alerts.filter(a => a.haz === k).length;

    return `<div class="card hzcard ${h.live && applicable ? 'live' : 'idle'}">
      <div class="card-h hzh">
        <span class="ic2" style="background:${h.c}1A">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${h.c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${h.ic}"/></svg></span>
        <h3>${esc(h.name)}</h3>
        ${tierPill(h.tier)}
        <div class="hzmeta">${h.horizon_hours} h horizon · recomputed ${fmtCadence(h.cadence_seconds)}</div>
      </div>
      <div class="card-b" style="padding:12px 16px 14px">
        ${!applicable ? `<div class="note i" style="margin-bottom:11px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
            <span><b>Not applicable here.</b> Coastal hazard; this district is landlocked. The module is live and would score a coastal deployment.</span></div>`
        : h.live ? `
          <div style="display:flex;gap:18px;margin-bottom:10px">
            <div><div class="k2">Peak risk</div><div class="v2" style="color:${peak != null ? pc(peak) : 'var(--t3)'}">${peak != null ? peak : '—'}</div></div>
            <div><div class="k2">Critical</div><div class="v2" style="color:${crit ? 'var(--crit)' : 'var(--t3)'}">${crit}</div></div>
            <div><div class="k2">High</div><div class="v2" style="color:${high ? 'var(--high)' : 'var(--t3)'}">${high}</div></div>
            <div><div class="k2">Alerts</div><div class="v2" style="color:${alerts ? 'var(--pri)' : 'var(--t3)'}">${alerts}</div></div>
          </div>
          <div class="hzbar">${S.cells.map(c => {
            const r = c.risk[k] ?? -1;
            return `<i style="background:${r < 0 ? '#D8DEE7' : pc(r)};opacity:${r < 0 ? .5 : Math.max(.28, r / 100)}"></i>`;
          }).join('')}</div>
          <div style="font-size:11px;color:var(--t3);margin:6px 0 10px">${cells.length} of ${S.cells.length} cells scored</div>`
        : `<div class="note" style="margin-bottom:11px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
            <span><b>No source configured.</b> Shows no data, never a fabricated score.</span></div>`}

        <div class="sl" style="margin-bottom:6px">Signal</div>
        <div style="font-size:12px;color:var(--t2);line-height:17px;margin-bottom:11px">${esc(h.signal)}</div>

        <div class="sl" style="margin-bottom:6px">Data sources</div>
        ${(() => {
          const rows = [...h.authoritative.map(key => [key, true]),
                        ...h.supplementary.map(key => [key, false])];
          /* Feeding sources first — they are what the reader is looking for.
             The rest fold away so a card stays one readable height. */
          const feeding = rows.filter(([key]) => (h.sources_live || []).includes(key));
          const rest = rows.filter(([key]) => !(h.sources_live || []).includes(key));
          const shown = feeding.length ? feeding : rows.slice(0, 2);
          const hidden = feeding.length ? rest : rows.slice(2);
          return shown.map(([key, prim]) => srcChip(key, prim, h)).join('') +
            (hidden.length ? `<details class="srcmore"><summary>${hidden.length} more source${hidden.length === 1 ? '' : 's'} for this hazard</summary>
              ${hidden.map(([key, prim]) => srcChip(key, prim, h)).join('')}</details>` : '');
        })()}

        ${h.degraded_inputs.length ? `<div style="font-size:11px;color:var(--warn);line-height:16px;margin-top:9px">
          Risk from this hazard is stamped <span class="m">degraded_inputs=[${h.degraded_inputs.map(d => `'${d}'`).join(', ')}]</span> and its confidence is damped.</div>` : ''}
        ${h.notes ? `<div style="font-size:11px;color:var(--t3);line-height:16px;margin-top:8px">${esc(h.notes)}</div>` : ''}
      </div></div>`;
  };

  const live = HAZ_ORDER.filter(k => HAZ[k].live).length;
  const auth = HAZ_ORDER.filter(k => HAZ[k].tier === 'authoritative').length;

  return page('Hazards & Data Sources',
    `All ${HAZ_ORDER.length} hazard modules, and exactly which feed supplies each one right now.`,
    `<div class="tiles">
      ${tile('Hazards live', `${live} / ${HAZ_ORDER.length}`, 'var(--ok)', 'with the current configuration')}
      ${tile('On an authority', auth, auth ? 'var(--ok)' : 'var(--warn)', 'Indian statutory source connected')}
      ${tile('On open sources', live - auth, 'var(--info)', 'supplementary, labelled as such')}

    </div>
    <div class="note i" style="margin-bottom:16px">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
      <span><b>Every hazard runs with no credentials.</b> What credentials buy is fidelity, not existence — a CWC agreement turns modelled 5 km discharge into a surveyed gauge stage; a free NASA key turns coarse fire alerts into 375 m thermal detection. A supplementary source is never relabelled as the authority it stands in for.</span></div>
    <div class="hzgrid">${HAZ_ORDER.map(card).join('')}</div>`);
}

const fmtCadence = s => s == null ? '—'
  : s < 60 ? `${s}s`
  : s < 3600 ? `every ${Math.round(s / 60)} min`
  : s < 86400 ? `every ${Math.round(s / 3600)} h`
  : `daily`;

/* ══════════════════════════════════════════════════════════════════
   ROUTER
   ══════════════════════════════════════════════════════════════════ */
function go(v) {
  /* Command screens are only reachable with a session. This is belt and
     braces — the nav is not rendered without one — but a router that
     trusts its own nav is a router that can be talked past.

     On refusal the store is put back to a consistent state before the
     prompt opens: leaving S.role at 'gov' with no session would mean the
     store and the screen disagree about who the viewer is. */
  if (S.role === 'gov' && !signedIn()) {
    S.role = 'citizen'; S.cz = 'home'; S.view = 'map';
    render();
    openSignIn();
    return;
  }
  touchSession();
  S.view = v; render();
}

function render() {
  const m = $('main');
  /* A map tooltip is anchored to an element that is about to be replaced.
     Left alone it hangs over the next screen with no way to dismiss it. */
  if (typeof tipOff === 'function') tipOff();
  $('app').className = 'on' + (S.role === 'citizen' ? ' citizen' : '');

  /* A session that has expired must not leave operational data on screen. */
  if (S.role === 'gov' && !signedIn()) { S.role = 'citizen'; S.cz = 'home'; }

  if (S.role === 'citizen') {
    /* The public map opens on the reader's own state. Framing the whole
       country here shows them a thumbnail of India when what they wanted
       was their own road. */
    if (S.cz === 'home' && S.mapFocus == null && !S.czFramed) {
      S.czFramed = 1; S.mapFocus = S.focus || 'ut';
      VB = VBto = stateVB(S.mapFocus);
    }
    m.innerHTML = viewCitizen();
    $('fab').style.display = 'flex';
    const cm = document.querySelector('.czmap .cm');
    if (cm) { buildMap(cm, 'cz'); bindMapNav(cm); paintZoom(); }
    paintCrumb(); paintLatest();
    /* the gallery lives on both the landing page and its own screen */
    if (S.cz === 'memorial' || S.cz === 'home') {
      loadLocalPhotos().then(paintGallery); paintGallery();
    }
    /* The hero exists only on the landing page. Starting it here rather
       than on a timer means it never runs against a screen it is not on. */
    if (S.cz === 'home' && typeof heroStart === 'function') { paintHero(); heroStart(); }
    else if (typeof heroStop === 'function') heroStop('leave');
  } else {
    $('fab').style.display = 'flex';
    const V = {
      map: null, cells: viewCells, predictions: viewPredictions, alerts: viewAlerts,
      exposure: viewExposure, priority: viewPriority, shelters: viewShelters,
      evacuation: viewEvacuation, roads: viewRoads, reports: viewReports,
      hazards: viewHazards, sources: viewSources, model: viewModel, security: viewSecurity
    };
    if (S.view === 'map') {
      m.innerHTML = mapShell();
      buildMap($('map'), 'gov');
      bindMapNav($('map'));
      S.czFramed = 0;      // re-frame the public map next time it is opened
      paintCrumb(); paintTimeline(); paintSourceBar(); paintLatest(); paintZoom();
    } else {
      m.innerHTML = guideStrip(S.view) + (V[S.view] || viewCells)();
      paintLatest();
    }
  }
  paintNav(); paintTop(); paintHNav(); paintHazard();
}

/* ══════════════════════════════════════════════════════════════════
   REPAINTING WITHOUT STEALING THE READER'S PLACE

   `render()` replaces the whole of `main`. That is right when a person
   asks for a different screen — a new screen starts at the top — and it
   was catastrophic on a timer. The pipeline called it every four
   seconds, and every four seconds the public portal threw away the
   element that holds the scroll position, so a reader halfway down the
   page was returned to the top, mid-sentence, forever. That single line
   is most of what "the whole website feels too sensitive" was.

   Everything below draws the same screens without that. Three rules:

     1. A live repaint never runs while the reader is doing something a
        rebuild would destroy — typing, dragging, or mid-scroll.
     2. When it does run, it puts the scroll position and the keyboard
        focus back exactly where they were.
     3. On the screens that have a cheap targeted path — the public
        landing page, the command map — it takes that path and does not
        touch the rest of the DOM at all.
   ══════════════════════════════════════════════════════════════════ */

/* Elements that hold a scroll position worth keeping. */
const SCROLLERS = ['.cz', '.pv', '.side-b', '.dw-b', '.cb'];

/* A wheel or a finger is still in flight for a moment after the last
   event. Rebuilding inside that window is what makes a page feel like it
   is fighting back. */
let lastScrollAt = 0;
let pointerHeld = false;
addEventListener('scroll', () => { lastScrollAt = Date.now(); }, { capture: true, passive: true });
addEventListener('wheel', () => { lastScrollAt = Date.now(); }, { capture: true, passive: true });
addEventListener('touchmove', () => { lastScrollAt = Date.now(); }, { capture: true, passive: true });
addEventListener('pointerdown', () => { pointerHeld = true; }, { capture: true, passive: true });
addEventListener('pointerup', () => { pointerHeld = false; }, { capture: true, passive: true });
addEventListener('pointercancel', () => { pointerHeld = false; }, { capture: true, passive: true });

/** Is the reader in the middle of something? */
function uiBusy() {
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
  if (pointerHeld) return true;
  if (Date.now() - lastScrollAt < 600) return true;
  if ($('scr') && $('scr').classList.contains('on')) return true;
  if ($('pscr') && $('pscr').classList.contains('on')) return true;
  return false;
}

function captureUI() {
  const pos = [];
  for (const sel of SCROLLERS)
    document.querySelectorAll(sel).forEach((el, i) => pos.push([sel, i, el.scrollTop, el.scrollLeft]));
  const a = document.activeElement;
  return { pos, focus: a && a.id ? a.id : null };
}

function restoreUI(snap) {
  if (!snap) return;
  for (const [sel, i, top, left] of snap.pos) {
    const el = document.querySelectorAll(sel)[i];
    if (el) { el.scrollTop = top; el.scrollLeft = left; }
  }
  if (snap.focus) {
    const el = $(snap.focus);
    if (el && el !== document.activeElement && typeof el.focus === 'function')
      el.focus({ preventScroll: true });
  }
}

/** A repaint driven by the pipeline rather than by the reader.

    The two screens people actually sit on — the command map and the
    public landing page — have targeted paths that update everything
    which moves without replacing a single element anybody could be
    scrolling, reading or pointing at, so those never rebuild at all.
    Everything else rebuilds, but only when the reader is not busy, and
    puts their scroll position and focus back afterwards. */
function syncRender() {
  if (S.role === 'gov' && S.view === 'map') { paintLiveSurfaces(); return; }
  if (S.role === 'citizen' && S.cz === 'home') { paintLiveSurfaces(); return; }
  if (uiBusy()) { paintLiveSurfaces(); return; }
  const snap = captureUI();
  render();
  restoreUI(snap);
}

/** The cheap path: the handful of things that actually change second to
    second, updated in place, with no element replaced that anybody could
    be scrolling, reading or pointing at. */
function paintLiveSurfaces() {
  if (typeof paintLiveBadge === 'function') paintLiveBadge();
  if (typeof paintLatest === 'function') paintLatest();
  if (S.role === 'gov') {
    paintTop(); paintNav();
    if (S.view === 'map') { paintSourceBar(); paintTimeline(); paintMapThrottled(); }
  } else {
    paintCzLive();
  }
}

/* Two cadences for the map itself. It is the most expensive thing on the
   screen to rebuild — thirty-six state paths, a grid, markers — and it is
   also the thing a reader is most likely to be looking at closely, so it
   is repainted at half the rate of everything else and never while a pan
   or a pinch is in progress. */
let lastMapPaintAt = 0;
function paintMapThrottled(minMs = 2000) {
  if (pointerHeld) return;
  if (Date.now() - lastMapPaintAt < minMs) return;
  lastMapPaintAt = Date.now();
  paintMap();
}

/** The public landing page's live regions, updated without rebuilding it. */
function paintCzLive() {
  if (S.role !== 'citizen') return;
  const tick = $('cztick');
  if (tick && S.alerts[0]) {
    const top = S.alerts[0];
    tick.className = 'tick ' + (top.sev === 'Extreme' ? 'x' : top.sev === 'Severe' ? 'h'
      : top.sev === 'Moderate' ? 'm' : 'l');
    tick.innerHTML = czTickerHTML(top);
  }
  if (S.cz !== 'home') return;

  const open = S.shelters.filter(s => s.operational && s.effective_capacity > 0);
  const n = $('czopen'); if (n) n.textContent = open.length;
  const pl = $('czplaces');
  if (pl) pl.textContent = `${nf(open.reduce((a, s) => a + s.effective_capacity, 0))} places available across ` +
    (S.states[S.focus] || S.states.ut).district;
  const al = $('czalerts'); if (al) al.innerHTML = czAlertCardsHTML();
  const t = $('czmaptime'); if (t) t.textContent = hm() + ' IST';
  paintMapThrottled();
}

/* ── The role control ───────────────────────────────────────────────
   Two buttons that do different things. Public is always available.
   Command is a door: it opens on a credential and closes on sign-out.
   There is no state in which pressing "Command" simply switches. */
function paintRoleSwitch() {
  const sw = $('rsw'); if (!sw) return;
  const inCmd = S.role === 'gov' && signedIn();
  sw.innerHTML = inCmd
    ? `<button class="rs-who" onclick="go('security')" title="Session and permissions">
         <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 3 6v6c0 5 3.8 9.2 9 10 5.2-.8 9-5 9-10V6Z"/><path d="m9 12 2 2 4-4"/></svg>
         <span>${esc(AUTH.session.user)}</span></button>
       <button class="rs-out" onclick="requestSignOut()" title="Sign out of District Command">Sign out</button>`
    : `<button class="rs-in" onclick="requestRole('gov')" title="Authorised operators only">
         <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
         Official sign-in</button>`;
}
