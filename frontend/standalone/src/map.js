/* ══════════════════════════════════════════════════════════════════
   MAP — real India geography, two levels

   Level 0  36 states and union territories as SVG paths in a
            0 0 612 696 space, tinted by the risk of any declared event.
   Level 1  the focused state's viewBox animates to its bounds and the
            5x5 operational grid is drawn clipped to the real state
            outline, with shelters, evacuation routes and road incidents
            positioned inside it.

   Each grid cell maps to an H3 index at resolution 7 (carried in
   cell_id); the grid is how an operator addresses it on screen.
   ══════════════════════════════════════════════════════════════════ */

const NS = 'http://www.w3.org/2000/svg';
const E = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) if (a[k] != null) e.setAttribute(k, a[k]); return e; };
const IN_VB = [0, 0, 612, 696];

/* Risk of the *selected* hazard in this state. A state with no entry for
   the current layer is unaffected by it — rendered plain, which is
   information rather than a gap. */
const stateRisk = (id, hazard) => {
  const st = S.states[id];
  if (!st) return null;
  const h = hazard || S.hazard;
  return st.hz[h] != null ? st.hz[h] : null;
};
const stateAffected = id => S.states[id] && stateRisk(id) != null;
const statePeak = id => {
  const st = S.states[id]; if (!st) return null;
  return Math.max(...Object.values(st.hz));
};

let VB = IN_VB.slice(), VBto = IN_VB.slice(), vbRaf = null;

/* ── The camera fills its box ────────────────────────────────────────
   VB is the *logical* camera: what we want in view. The element it is
   drawn into is rarely the same shape — the command map is wide, the
   public map is a wide short strip, and India's outline is tall. With
   plain preserveAspectRatio the browser letterboxes: it fits the tall
   country to the short strip, and the map ends up a thin ribbon adrift
   in empty space, which reads as "zoomed out to nothing".

   So the displayed viewBox is the logical one grown along whichever axis
   the host has spare, keeping the centre. Nothing is cropped, nothing is
   letterboxed, and the map is the size of the space it was given. */
function aspectFit(vb, host) {
  const r = host && host.getBoundingClientRect ? host.getBoundingClientRect() : null;
  if (!r || !r.width || !r.height) return vb.slice();
  const want = r.width / r.height, have = vb[2] / vb[3];
  let [x, y, w, h] = vb;
  if (want > have) { const nw = h * want; x -= (nw - w) / 2; w = nw; }
  else             { const nh = w / want; y -= (nh - h) / 2; h = nh; }
  return [x, y, w, h];
}

/** Every host that is currently showing a map. */
const mapHosts = () => [document.getElementById('map'),
                        document.querySelector('.czmap .cm')].filter(Boolean);

/** Push the current camera to every map, fitted to each one's own shape. */
function applyVB() {
  for (const host of mapHosts()) {
    const svg = host.querySelector('svg');
    if (svg) svg.setAttribute('viewBox', aspectFit(VB, host).map(n => n.toFixed(2)).join(' '));
  }
}

/* Someone who has asked their system to reduce motion has asked for this
   too: the camera arrives, it does not travel. */
const REDUCED_MOTION = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Move the camera to `vb`.

    `dur` is how long the move should take, and it is a real parameter
    rather than a constant because the three things that move the camera
    want three different speeds. Opening a state is a journey and reads
    better slow. A zoom button is a command and wants to land promptly. A
    wheel notch is one of thirty arriving in a second, and a long ease
    there means every notch cancels the last one before it finishes — the
    map never settles, which is exactly what "too sensitive" feels like.

    The ease always starts from where the camera actually is, so an
    interrupted move continues from the current frame instead of snapping
    back to where the previous one began. */
function flyTo(vb, dur = 560) {
  VBto = vb; cancelAnimationFrame(vbRaf);
  if (REDUCED_MOTION || dur <= 0) { VB = VBto.slice(); applyVB(); return; }
  const from = VB.slice(), t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    VB = from.map((v, i) => v + (VBto[i] - v) * e);
    applyVB();
    if (k < 1) vbRaf = requestAnimationFrame(step);
  };
  vbRaf = requestAnimationFrame(step);
}
function stateVB(id) {
  const b = BBOX[id]; if (!b) return IN_VB.slice();
  const pad = Math.max(b[2], b[3]) * 0.16;
  const w = b[2] + pad * 2, h = b[3] + pad * 2, side = Math.max(w, h);
  return [b[0] - pad - (side - w) / 2, b[1] - pad - (side - h) / 2, side, side];
}

function buildMap(host, mode) {
  const svg = E('svg', { viewBox: VB.join(' '), preserveAspectRatio: 'xMidYMid meet' });
  const defs = E('defs');
  defs.innerHTML = `
    <pattern id="hx" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <rect width="6" height="6" fill="#E4E9F0"/>
      <line x1="0" y1="0" x2="0" y2="6" stroke="#9AA7B8" stroke-width="1.6"/></pattern>`;
  svg.appendChild(defs);

  /* The world level is a different atlas in a different projection — see
     src/geo.js. It renders and returns; nothing below it applies. */
  if (typeof GEO !== 'undefined' && GEO.level === 'world') {
    buildWorldLayer(svg);
    host.innerHTML = ''; host.appendChild(svg);
    svg.setAttribute('viewBox', aspectFit(VB, host).map(n => n.toFixed(2)).join(' '));
    return;
  }

  svg.appendChild(E('rect', { x: -200, y: -200, width: 1200, height: 1200, fill: '#E9EEF4' }));

  /* ── states ── */
  const gS = E('g');
  for (const id in INDIA) {
    const [nm, d] = INDIA[id], rk = stateRisk(id), L = lvl(rk), act = stateAffected(id);
    const focused = S.mapFocus === id, dim = S.mapFocus && !focused;
    const p = E('path', {
      d, class: 'st',
      fill: focused ? '#FFFFFF' : (act ? PRI[L].c : '#DCE3EC'),
      'fill-opacity': focused ? 1 : (dim ? .16 : (act ? (L === 'critical' ? .5 : L === 'high' ? .44 : L === 'medium' ? .38 : .3) : 1)),
      stroke: focused ? '#12447E' : (act ? PRI[L].c : '#B9C4D3'),
      'stroke-opacity': focused ? .85 : (dim ? .25 : 1),
      'stroke-width': .8, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke'
    });
    p.addEventListener('mouseenter', ev => tipState(id, nm, rk, ev));
    p.addEventListener('mousemove', tipMove);
    p.addEventListener('mouseleave', tipOff);
    p.addEventListener('click', ev => { ev.stopPropagation(); pickState(id); });
    gS.appendChild(p);
  }
  svg.appendChild(gS);

  /* ── level 0 markers ── */
  if (!S.mapFocus) {
    const gM = E('g');
    for (const id in S.states) {
      const b = BBOX[id]; if (!b) continue;
      const rk = stateRisk(id); if (rk == null) continue;
      const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2, st = S.states[id], c = pc(rk);
      if (lvl(rk) === 'critical' || lvl(rk) === 'high')
        gM.appendChild(E('circle', { cx, cy, r: 11, fill: c, 'fill-opacity': .3, class: 'ping' }));
      const g = E('g', { transform: `translate(${cx} ${cy})`, class: 'mk' });
      g.appendChild(E('circle', { r: 4.6, fill: '#FFFFFF', stroke: c, 'stroke-width': 1.8, 'vector-effect': 'non-scaling-stroke' }));
      g.appendChild(E('circle', { r: 2, fill: c }));
      if (rk >= 55) {
        const lw = st.name.length * 3.5 + 9;
        g.appendChild(E('rect', { x: -lw / 2, y: 7, width: lw, height: 8.5, rx: 2, fill: '#FFFFFF', 'fill-opacity': .92, stroke: '#C8D2DF', 'stroke-width': .4 }));
        const tx = E('text', { y: 13.2, 'text-anchor': 'middle', 'font-size': 5.4, 'font-weight': 700, fill: c, 'font-family': 'Inter,sans-serif' });
        tx.textContent = st.name; g.appendChild(tx);
      }
      g.addEventListener('mouseenter', ev => tipState(id, st.name, rk, ev));
      g.addEventListener('mousemove', tipMove);
      g.addEventListener('mouseleave', tipOff);
      g.addEventListener('click', ev => { ev.stopPropagation(); pickState(id); });
      gM.appendChild(g);
    }
    svg.appendChild(gM);
  }

  /* ── level 1: operational grid clipped to the state shape ──
     Identical construction to EchoTrace: a 5x5 grid over the state's
     bounding box, clipped to the real outline, cells drawn as rounded
     rects with the zone id top-left, the score top-right and the
     colour-blind-safe priority glyph bottom-right. */
  if (S.mapFocus) {
    const id = S.mapFocus, b = BBOX[id];
    const cp = E('clipPath', { id: 'cp-' + id });
    cp.appendChild(E('path', { d: INDIA[id][1] }));
    defs.appendChild(cp);
    const gg = E('g', { 'clip-path': `url(#cp-${id})` });
    const gx = b[2] / 5, gy = b[3] / 5;
    const hz = S.hazard;

    if (S.layers.cells) S.cells.forEach(z => {
      const risk = z.risk[hz];
      const L = lvl(risk), P = PRI[L];
      const x = b[0] + z.col * gx, y = b[1] + z.row * gy;
      const op = L === 'critical' ? .4 : L === 'high' ? .34 : L === 'medium' ? .28 : L === 'none' ? .9 : .22;
      const c = E('rect', {
        x: x + gx * .03, y: y + gy * .03, width: gx * .94, height: gy * .94, rx: gx * .05,
        fill: L === 'none' ? 'url(#hx)' : P.c, 'fill-opacity': op,
        stroke: P.c, 'stroke-opacity': .85,
        'stroke-width': S.cellSel === z.cell_id ? 2.4 : 1,
        'vector-effect': 'non-scaling-stroke',
        'stroke-dasharray': L === 'none' ? '4 3' : null, class: 'cell'
      });
      c.addEventListener('mouseenter', ev => tipCell(z, ev));
      c.addEventListener('mousemove', tipMove);
      c.addEventListener('mouseleave', tipOff);
      c.addEventListener('click', ev => { ev.stopPropagation(); S.cellSel = z.cell_id; openDw('cell'); paintMap(); });
      gg.appendChild(c);

      const fs = gx * .115;
      const t1 = E('text', { x: x + gx * .10, y: y + gy * .20, fill: P.c, 'font-size': fs,
        'font-weight': 700, 'font-family': 'JetBrains Mono,monospace', 'pointer-events': 'none' });
      t1.textContent = z.id; gg.appendChild(t1);

      const t2 = E('text', { x: x + gx * .90, y: y + gy * .20, fill: P.c, 'font-size': fs * .92,
        'text-anchor': 'end', 'font-family': 'JetBrains Mono,monospace',
        'fill-opacity': .8, 'pointer-events': 'none' });
      t2.textContent = risk < 0 ? '—' : risk; gg.appendChild(t2);

      const t3 = E('text', { x: x + gx * .10, y: y + gy * .38, fill: P.c, 'font-size': fs * .70,
        'font-family': 'Inter,sans-serif', 'fill-opacity': .78, 'pointer-events': 'none' });
      t3.textContent = z.name.length > 13 ? z.name.slice(0, 12) + '…' : z.name;
      gg.appendChild(t3);

      gg.appendChild(glyph(P.sh, x + gx * .86, y + gy * .82, gx * .07, P.c));

      if (L === 'critical') gg.appendChild(E('circle', {
        cx: x + gx / 2, cy: y + gy / 2, r: gx * .32, fill: 'none', stroke: P.c,
        'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke', class: 'ping' }));

      if (z.degraded.length) gg.appendChild(E('circle', {
        cx: x + gx * .90, cy: y + gy * .82, r: gx * .035,
        fill: '#A96700', 'fill-opacity': .9, 'pointer-events': 'none' }));
    });

    /* evacuation routes, beneath the markers */
    if (S.layers.routes) {
      const gR = E('g');
      S.routes.filter(r => !r.unassigned).slice(0, 20).forEach(r => {
        const cell = S.cells.find(c => c.id === r.origin_id);
        const sh = shelterById(r.shelter_id);
        if (!cell || !sh) return;
        const x1 = b[0] + (cell.col + .5) * gx, y1 = b[1] + (cell.row + .5) * gy;
        const x2 = b[0] + sh.x * b[2], y2 = b[1] + sh.y * b[3];
        const mx = (x1 + x2) / 2 + (y2 - y1) * .12, my = (y1 + y2) / 2 - (x2 - x1) * .12;
        gR.appendChild(E('path', {
          d: `M${x1} ${y1}Q${mx} ${my} ${x2} ${y2}`, fill: 'none',
          stroke: r.hazard_exposure > .4 ? '#D2551A' : '#12447E',
          'stroke-width': Math.max(.9, Math.min(r.people / 700, 3)),
          'stroke-opacity': .5, 'stroke-linecap': 'round',
          'stroke-dasharray': r.before_impact === false ? '4 3' : null,
          'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
      });
      gg.appendChild(gR);
    }
    svg.appendChild(gg);

    /* state outline on top */
    svg.appendChild(E('path', { d: INDIA[id][1], fill: 'none', stroke: '#12447E',
      'stroke-opacity': .8, 'stroke-width': 1.8, 'vector-effect': 'non-scaling-stroke',
      'pointer-events': 'none' }));

    /* markers */
    const gA = E('g');
    const vbSide = stateVB(id)[2];
    const put = (o, kind) => {
      const cx = b[0] + o.x * b[2], cy = b[1] + o.y * b[3];
      gA.appendChild(markerNode(o, kind, cx, cy, vbSide));
    };
    if (S.layers.shelters) S.shelters.forEach(sh => put(sh, 'shelter'));
    if (S.layers.hospitals) S.hospitals.forEach(h => put(h, 'med'));
    if (S.layers.roads) S.roads.filter(r => r.state !== 'open').forEach(r => {
      const cell = S.cells.find(c => c.id === r.zone); if (!cell) return;
      put({ ...r, id: r.name.split('·')[0].trim(), x: (cell.col + .78) / 5, y: (cell.row + .78) / 5 },
          'road');
    });
    svg.appendChild(gA);
  }

  host.innerHTML = ''; host.appendChild(svg);
  svg.setAttribute('viewBox', aspectFit(VB, host).map(n => n.toFixed(2)).join(' '));
}

/* colour-blind-safe priority glyph, EchoTrace's shapes */
function glyph(sh, cx, cy, r, c) {
  const o = { fill: c, 'fill-opacity': .6, stroke: c, 'stroke-width': .8,
              'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' };
  if (sh === 'circle') return E('circle', { cx, cy, r, ...o });
  if (sh === 'square') return E('rect', { x: cx - r, y: cy - r, width: r * 2, height: r * 2, rx: r * .28, ...o });
  if (sh === 'triangle') return E('path', { d: `M${cx} ${cy - r * 1.1}L${cx + r} ${cy + r * .8}L${cx - r} ${cy + r * .8}Z`, 'stroke-linejoin': 'round', ...o });
  return E('path', { d: `M${cx} ${cy - r * 1.15}L${cx + r * 1.15} ${cy}L${cx} ${cy + r * 1.15}L${cx - r * 1.15} ${cy}Z`, 'stroke-linejoin': 'round', ...o });
}

const MKI = {
  shelter: '<path d="M-4 4V-.6L0 -4l4 3.4V4Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  med: '<path d="M-1.2 -3.8h2.4v2.6h2.6v2.4h-2.6v2.6h-2.4v-2.6h-2.6v-2.4h2.6z" fill="currentColor"/>',
  road: '<path d="M0 -4.2 4.4 3.6H-4.4Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M0 -1.4v2.2M0 2.4v.1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'
};
const MKC = {
  shelter: { open: '#1B7F3B', full: '#A96700', closed: '#7A8698' },
  med: { open: '#0B6BA8' },
  road: { slow: '#A96700', partially_blocked: '#D2551A', blocked: '#B3261E',
          flooded: '#B3261E', landslide: '#B3261E' }
};

function markerNode(o, kind, cx, cy, scale) {
  const stt = o.st || o.state || 'open';
  const c = (MKC[kind] || {})[stt] || '#5B6779';
  const dead = kind === 'shelter' && o.operational === false;
  const s = scale / 700;
  const g = E('g', { transform: `translate(${cx} ${cy}) scale(${s})`, class: 'mk' + (dead ? ' ghost' : '') });
  g.style.color = c;

  if (kind === 'shelter' && !dead && o.effective_capacity > 0)
    g.appendChild(E('circle', { r: 13, fill: c, 'fill-opacity': .07, stroke: c,
      'stroke-opacity': .28, 'stroke-width': .7, 'stroke-dasharray': '2 2' }));
  if (kind === 'road')
    g.appendChild(E('circle', { r: 11, fill: 'none', stroke: c, 'stroke-width': 1.2, class: 'ping' }));

  g.appendChild(E('circle', { r: 7.4, fill: '#FFFFFF', stroke: c, 'stroke-width': 1.5 }));
  const ic = E('g'); ic.innerHTML = MKI[kind] || MKI.shelter; g.appendChild(ic);

  const lab = String(o.shelter_id || o.id || '').replace('HOSP-', 'H-');
  const lw = lab.length * 3.9 + 7;
  const lg = E('g', { transform: 'translate(0 16)', 'pointer-events': 'none' });
  lg.appendChild(E('rect', { x: -lw / 2, y: -6, width: lw, height: 9, rx: 2,
    fill: '#FFFFFF', 'fill-opacity': .93, stroke: '#C8D2DF', 'stroke-width': .4 }));
  const tx = E('text', { 'text-anchor': 'middle', 'font-size': 6, 'font-weight': 700,
    fill: c, 'font-family': 'JetBrains Mono,monospace' });
  tx.textContent = lab; lg.appendChild(tx); g.appendChild(lg);

  if (dead) {
    const w = E('g', { transform: 'translate(8 -8)' });
    w.appendChild(E('circle', { r: 4.2, fill: '#FFFFFF', stroke: '#7A8698', 'stroke-width': 1.1 }));
    const wt = E('text', { 'text-anchor': 'middle', y: 2, 'font-size': 6, 'font-weight': 700, fill: '#5B6779' });
    wt.textContent = '!'; w.appendChild(wt); g.appendChild(w);
  }

  g.addEventListener('mouseenter', ev => kind === 'road' ? tipRoad(o, ev) : tipShelter(o, ev));
  g.addEventListener('mousemove', tipMove);
  g.addEventListener('mouseleave', tipOff);
  g.addEventListener('click', ev => {
    ev.stopPropagation();
    if (kind === 'road') go('roads');
    else if (kind === 'med') toast(o.name, o.d, 'info');
    else { S.shelterSel = o.shelter_id; openDw('shelter'); }
  });
  return g;
}

/* ── tooltips ── */
function tipEl() {
  let t = document.querySelector('.tip');
  if (!t) { t = document.createElement('div'); t.className = 'tip pan'; document.body.appendChild(t); }
  return t;
}
const kvLine = (k, v) => `<div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--t2);padding:2px 0"><span>${k}</span>${v}</div>`;

function tipState(id, nm, rk, ev) {
  const t = tipEl(), st = S.states[id];
  const L = lvl(rk), P = PRI[L];
  const notThis = st && rk == null;
  t.innerHTML = `<div style="padding:10px 11px 8px;display:flex;justify-content:space-between;align-items:center;gap:8px">
      <b style="font-size:14px">${esc(nm)}</b>${
        !st ? '<span class="p p-off">No Active Event</span>'
        : notThis ? `<span class="p p-off">No ${esc(HAZ[S.hazard].name)}</span>`
        : pill(P.n, P.cls)}</div>
    ${st ? `<div style="padding:0 11px 10px">
      ${kvLine('Situation', `<b style="color:var(--t1)">${esc(st.dis)}</b>`)}
      ${kvLine('Since', `<b class="m" style="color:var(--t1)">${st.since} IST</b>`)}
      ${kvLine('Population', `<b class="m" style="color:var(--t1)">${esc(st.pop)}</b>`)}
      <div style="margin-top:7px;padding-top:7px;border-top:1px solid var(--bd)">
        <div style="font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--t3);margin-bottom:4px">Hazards active here</div>
        ${Object.entries(st.hz).sort((a,b) => b[1] - a[1]).map(([h, v]) =>
          `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:11.5px;
                ${h === S.hazard ? 'font-weight:600' : 'opacity:.72'}">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="${HAZ[h].c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${HAZ[h].ic}"/></svg>
            <span style="flex:1;color:var(--t2)">${esc(HAZ[h].name)}</span>
            <b class="m" style="color:${pc(v)}">${v}</b></div>`).join('')}
      </div>
      <div style="margin-top:7px;padding-top:7px;border-top:1px solid var(--bd);font-size:10.5px;color:var(--t3)">${
        'Click to open ' + esc(st.district) +
        (st.reg === 'sdma' ? ' · SDMA register' : ' · provisional register')}</div>
    </div>` : `<div style="padding:0 11px 10px;font-size:11.5px;color:var(--t3)">No declared disaster. Monitored only.</div>`}`;
  t.classList.add('on'); tipMove(ev);
}

function tipCell(cell, ev) {
  const t = tipEl(), hz = S.hazard, risk = cell.risk[hz], P = PRI[lvl(risk)];
  const z = zoneById(cell.cell_id);
  t.innerHTML = `<div style="padding:10px 11px 8px;display:flex;justify-content:space-between;align-items:center;gap:8px">
      <b style="font-size:14px">Zone ${esc(cell.id)} · ${esc(cell.name)}</b>${pill(P.n, P.cls)}</div>
    <div style="padding:0 11px 10px">
      <div class="m" style="font-size:10px;color:var(--t3);margin-bottom:6px">Zone ${esc(cell.id)} · H3 ${esc(cell.short)} · res 7</div>
      ${kvLine(HAZ[hz].name + ' risk', `<b class="m" style="color:${P.c}">${risk < 0 ? 'NO DATA' : risk + ' / 100'}</b>`)}
      ${kvLine('Population', `<b class="m" style="color:var(--t1)">${nf(cell.pop)}</b>`)}
      ${risk >= 0 ? kvLine('Confidence', `<b class="m" style="color:${cell.confidence[hz] < .7 ? 'var(--warn)' : 'var(--t1)'}">${Math.round(cell.confidence[hz] * 100)}%</b>`) : ''}
      ${z ? kvLine('Priority', `<b class="m" style="color:var(--t1)">#${z.rank}</b>`) : ''}
      ${cell.degraded.length ? `<div style="margin-top:7px;padding:6px 8px;border-radius:6px;background:var(--warns);border:1px solid #EBD3A9;font-size:10.5px;color:#7A4B00;line-height:14px"><b>Degraded input.</b> ${cell.degraded.join(', ').toUpperCase()} unavailable — confidence reduced.</div>` : ''}
      <div style="margin-top:7px;padding-top:7px;border-top:1px solid var(--bd);font-size:10.5px;color:var(--t3)">Click to open the cell</div></div>`;
  t.classList.add('on'); tipMove(ev);
}

function tipShelter(sh, ev) {
  const t = tipEl();
  t.innerHTML = `<div style="padding:10px 11px 8px;display:flex;justify-content:space-between;align-items:center;gap:8px">
      <b class="m" style="font-size:13.5px">${esc(sh.shelter_id)}</b>
      ${pill(sh.operational ? (sh.effective_capacity ? 'Usable' : 'Full') : 'Not usable', sh.operational ? (sh.effective_capacity ? 'p-low' : 'p-med') : 'p-off')}</div>
    <div style="padding:0 11px 10px">
      <div style="font-size:11.5px;color:var(--t2);margin-bottom:5px">${esc(sh.name)}</div>
      ${kvLine('Occupancy', `<b class="m" style="color:var(--t1)">${nf(sh.current_occupancy)} / ${nf(sh.max_capacity)}</b>`)}
      ${kvLine('Effective places', `<b class="m" style="color:${sh.effective_capacity ? 'var(--ok)' : 'var(--crit)'}">${nf(sh.effective_capacity)}</b>`)}
      ${kvLine('Limited by', `<b style="color:var(--t1);font-size:11.5px">${esc(sh.binding_constraint)}</b>`)}
      <div style="margin-top:7px;padding-top:7px;border-top:1px solid var(--bd);font-size:10.5px;color:var(--t3)">Reported ${sh.reported} IST · click to open</div></div>`;
  t.classList.add('on'); tipMove(ev);
}

function tipRoad(r, ev) {
  const t = tipEl();
  t.innerHTML = `<div style="padding:10px 11px 8px;display:flex;justify-content:space-between;align-items:center;gap:8px">
      <b style="font-size:13px">${esc(r.name)}</b>${roadPill(r.state)}</div>
    <div style="padding:0 11px 10px">
      <div style="font-size:11.5px;color:var(--t2)">${esc(r.reason)}</div>
      ${kvLine('Reported', `<b class="m" style="color:var(--t1)">${r.t} · ${esc(r.by)}</b>`)}
      <div style="margin-top:7px;padding-top:7px;border-top:1px solid var(--bd);font-size:10.5px;color:var(--t3)">The routing engine excludes or penalises this segment.</div></div>`;
  t.classList.add('on'); tipMove(ev);
}

let tipPark = null;
function tipMove(ev) {
  const t = tipEl();
  clearTimeout(tipPark);
  let x = ev.clientX + 16, y = ev.clientY + 16;
  if (x + 238 > innerWidth) x = ev.clientX - 238;
  if (y + 210 > innerHeight) y = ev.clientY - 216;
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
function tipOff() {
  const t = document.querySelector('.tip');
  if (!t) return;
  t.classList.remove('on');
  /* A faded-out tooltip left parked at the last cursor position is still
     laid out, and at the right-hand edge of a wide window it made the
     document wider than a narrow viewport that came later — a phantom
     sideways overflow with nothing visible in it. Send it home once the
     fade has finished, not during it. */
  clearTimeout(tipPark);
  tipPark = setTimeout(() => {
    if (!t.classList.contains('on')) { t.style.left = '0px'; t.style.top = '0px'; }
  }, 170);
}

const ROAD_STATE = {
  open: ['Open', 'p-low'], slow: ['Slow', 'p-med'],
  partially_blocked: ['Partially blocked', 'p-high'], blocked: ['Blocked', 'p-crit'],
  flooded: ['Flooded', 'p-crit'], landslide: ['Landslide', 'p-crit'], unknown: ['Unknown', 'p-off']
};
const roadPill = st => pill(ROAD_STATE[st][0], ROAD_STATE[st][1]);

/* ── drill ── */
function pickState(id) {
  const st = S.states[id];
  if (!st) { toast(INDIA[id] ? INDIA[id][0] : id, 'No record for this territory.', 'info'); return; }

  /* Every state opens. Loading swaps the operational data in the store —
     cells, shelters, roads, alerts, reports — and recomputes priority and
     routing against it, exactly as a district switch would against the API. */
  loadState(id);
  markRagDirty();
  if (typeof GEO !== 'undefined') GEO.level = 'state';
  S.mapFocus = id; S.cellSel = null;
  flyTo(stateVB(id));
  paintMap(); paintCrumb(); paintNav(); paintTop(); paintHazard();
  if (typeof paintZoom === 'function') paintZoom();
  if (typeof paintLatest === 'function') paintLatest();
  log('event', `Scope changed to <b>${esc(st.name)}</b> — ${S.cells.length} zones loaded, ` +
      `${st.reg === 'sdma' ? 'SDMA register' : 'provisional register'}`, '#12447E');
  if (S.role === 'citizen') openDw('pubstate');

  const [regLabel, regNote] = registerLabel(id);
  say('Opened ' + st.name);
  if (st.reg !== 'sdma') {
    toast(st.name + ' · ' + regLabel, regNote, 'warn');
  } else {
    toast(st.name, `${esc(st.dis)}. ${esc(st.note)}`, 'info');
  }
}

function mapHome() {
  S.mapFocus = null; S.cellSel = null;
  if (typeof GEO !== 'undefined') GEO.level = 'country';
  flyTo(IN_VB.slice());
  paintMap(); paintCrumb(); paintNav(); paintTop();
  if (typeof paintZoom === 'function') paintZoom();
}
function paintMap() {
  const h = $('map'); if (h) buildMap(h, 'gov');
  const z = document.querySelector('.czmap .cm'); if (z) buildMap(z, 'cz');
}
function focusCritical() {
  let best = null, bv = -1;
  for (const id in S.states) {
    const r = stateRisk(id);
    if (r != null && r > bv) { bv = r; best = id; }
  }
  if (best) pickState(best);
}
