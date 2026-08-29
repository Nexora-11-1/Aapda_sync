/* ============================================================================
   AapdaSync — national.js
   ---------------------------------------------------------------------------
   The national layer. Real state geometry (36 states and union territories,
   @svg-maps/india, CC BY 4.0) in the 0 0 612 696 coordinate space.

   An honesty rule runs through this whole file: only ONE district in the
   country has a connected feed, and that is the simulated Sarai Ghat district.
   Everywhere else the map shows what a state has DECLARED — an event, a
   severity, a headline population figure — and nothing is derived from it.
   Declared and derived are drawn differently, labelled differently, and
   totalled separately, because presenting a declared number as a computed one
   is the exact failure this system is built to stop.
   ========================================================================== */

'use strict';

/* The simulated district is placed in Uttarakhand purely so the drill-down has
   a real place to land. Sarai Ghat is fictional; the placement is illustrative. */
SIM.homeState = 'ut';

SIM.national = [
  { st: 'ut', sev: 92, feed: 'connected', districts: 13, affected: 4, popAtRisk: 40695,
    events: ['Upper-catchment cloudburst — river crest', 'Ghat slope reactivation', 'M5.8 aftershock sequence', 'MAH vessel alert'],
    note: 'Simulated district feed connected. Every figure on the district screens is derived from raw inputs.' },
  { st: 'as', sev: 78, feed: 'declared', districts: 35, affected: 11, popAtRisk: 412000,
    events: ['Brahmaputra in spate — 3 gauges above danger'],
    note: 'Declared by the state EOC. No district feed connected — capacity is unverified.' },
  { st: 'br', sev: 74, feed: 'declared', districts: 38, affected: 9, popAtRisk: 386000,
    events: ['Kosi embankment under pressure'],
    note: 'Declared by the state EOC. No district feed connected — capacity is unverified.' },
  { st: 'hp', sev: 71, feed: 'declared', districts: 12, affected: 5, popAtRisk: 64000,
    events: ['Landslide closures on two national highways'],
    note: 'Declared by the state EOC. No district feed connected — capacity is unverified.' },
  { st: 'or', sev: 63, feed: 'declared', districts: 30, affected: 6, popAtRisk: 248000,
    events: ['Depression over the Bay — cyclone watch'],
    note: 'Declared by the state EOC. No district feed connected — capacity is unverified.' },
  { st: 'kl', sev: 55, feed: 'declared', districts: 14, affected: 4, popAtRisk: 96000,
    events: ['Orange alert — Western Ghats landslide risk'],
    note: 'Declared by the state EOC. No district feed connected — capacity is unverified.' },
  { st: 'mh', sev: 48, feed: 'declared', districts: 36, affected: 3, popAtRisk: 132000,
    events: ['Urban flooding — two municipal areas'],
    note: 'Declared by the state EOC. No district feed connected — capacity is unverified.' },
  { st: 'wb', sev: 44, feed: 'declared', districts: 23, affected: 3, popAtRisk: 88000,
    events: ['Coastal wind warning'],
    note: 'Declared by the state EOC. No district feed connected — capacity is unverified.' },
  { st: 'sk', sev: 41, feed: 'declared', districts: 6, affected: 2, popAtRisk: 9500,
    events: ['Glacial lake monitoring — level rising'],
    note: 'Declared by the state EOC. No district feed connected — capacity is unverified.' },
  { st: 'gj', sev: 33, feed: 'declared', districts: 33, affected: 2, popAtRisk: 41000,
    events: ['Seismic swarm — Kutch, no damage reported'],
    note: 'Declared by the state EOC. No district feed connected — capacity is unverified.' },
  { st: 'an', sev: 29, feed: 'declared', districts: 3, affected: 1, popAtRisk: 4200,
    events: ['Tsunami buoy maintenance advisory'],
    note: 'Declared by the state EOC. No district feed connected — capacity is unverified.' }
];

var NAT = (function () {

  var VIEW = { x: 0, y: 0, w: 612, h: 696 };
  var FULL = { x: 0, y: 0, w: 612, h: 696 };
  var animTimer = null;
  var LEVEL = 'india';                 // 'india' | 'district'

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function byId(id) { return INDIA.states.filter(function (s) { return s.id === id; })[0]; }
  function entry(id) { return SIM.national.filter(function (s) { return s.st === id; })[0]; }

  /* Short labels — "West" is not a state, and a first-word split produces it. */
  var SHORT = { wb: 'W. Bengal', an: 'A & N Islands', hp: 'Himachal', ut: 'Uttarakhand',
    up: 'Uttar Pradesh', mp: 'Madhya Pradesh', ap: 'Andhra Pradesh', ar: 'Arunachal',
    tn: 'Tamil Nadu', jk: 'J & K', dn: 'D & N Haveli', dd: 'Daman & Diu', ct: 'Chhattisgarh' };
  function shortName(st) { return SHORT[st.id] || st.name; }

  function tint(sev) {
    if (sev == null) return '#EAEFF5';
    if (sev >= 85) return '#F3C9C4';
    if (sev >= 60) return '#F6D3BE';
    if (sev >= 30) return '#F5E4BC';
    return '#D7EADD';
  }

  function summary() {
    var n = SIM.national;
    return {
      states: n.length,
      districts: n.reduce(function (t, s) { return t + s.affected; }, 0),
      declaredPop: n.filter(function (s) { return s.feed !== 'connected'; })
        .reduce(function (t, s) { return t + s.popAtRisk; }, 0),
      derivedPop: n.filter(function (s) { return s.feed === 'connected'; })
        .reduce(function (t, s) { return t + s.popAtRisk; }, 0),
      connected: n.filter(function (s) { return s.feed === 'connected'; }).length,
      events: n.reduce(function (t, s) { return t + s.events.length; }, 0),
      critical: n.filter(function (s) { return s.sev >= 85; }).length
    };
  }

  function render() {
    var out = '';
    out += '<defs>' +
      '<pattern id="declared" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">' +
      '<line x1="0" y1="0" x2="0" y2="6" stroke="#FFFFFF" stroke-width="2.6" opacity=".62"/></pattern>' +
      '</defs>';

    /* --- every state, tinted by declared severity --- */
    out += '<g aria-label="States and union territories">';
    INDIA.states.forEach(function (st) {
      var e = entry(st.id);
      var home = st.id === SIM.homeState;
      var f = tint(e ? e.sev : null);
      var lbl = st.name + (e
        ? '. ' + (home ? 'District feed connected. ' : 'Declared only. ') + e.events.length +
          ' declared event' + (e.events.length === 1 ? '' : 's') + ', severity ' + e.sev + ' of 100, ' +
          e.affected + ' districts affected.'
        : '. No declared event.');
      var tip = '<b>' + esc(st.name) + '</b>' + (e
        ? '<i>' + (home ? 'district feed connected' : 'declared only — not computed') + '</i>' +
          '<u>Declared severity</u><span>' + e.sev + ' / 100</span>' +
          '<u>Districts affected</u><span>' + e.affected + ' of ' + e.districts + '</span>' +
          '<u>Reported at risk</u><span>' + e.popAtRisk.toLocaleString('en-IN') + '</span>' +
          '<u>Derived capacity</u><span>' + (home ? ENG.deficit().totalUsable.toLocaleString('en-IN') + ' places' : '— no feed') + '</span>' +
          '<em>' + (home ? 'Click to open the district' : 'Click for what this state declared') + '</em>'
        : '<i>no declared event</i><em>Absence of a declaration is not evidence of safety</em>');
      out += '<g class="stt" data-st="' + st.id + '" tabindex="' + (e ? '0' : '-1') + '"' +
        (e ? ' role="button"' : '') + ' data-tip="' + tip.replace(/"/g, '&quot;') + '"' +
        ' aria-label="' + esc(lbl) + '">';
      out += '<path d="' + st.d + '" fill="' + f + '" stroke="#93A5BC" stroke-width="0.7"/>';
      if (e && e.feed !== 'connected') out += '<path d="' + st.d + '" fill="url(#declared)"/>';
      if (home) out += '<path d="' + st.d + '" fill="none" stroke="#12447E" stroke-width="2.6"/>';
      out += '</g>';
    });
    out += '</g>';

    /* --- markers: shape and number, never colour alone --- */
    out += '<g aria-hidden="true">';
    SIM.national.forEach(function (e) {
      var st = byId(e.st); if (!st) return;
      var pr = ENG.priority(e.sev);
      var home = e.st === SIM.homeState;
      var r = home ? 8 : 5.5;
      if (home) out += '<circle cx="' + st.cx + '" cy="' + st.cy + '" r="' + (r + 7) + '" fill="none" stroke="#12447E" stroke-width="1.6" stroke-dasharray="3 2.5"/>';
      out += MAP.marker(pr.shape, st.cx, st.cy, r, pr.color, ' stroke="#fff" stroke-width="1.4"');
      /* White halo under the label: state fills are tinted and hatched, and a
         plain glyph on top of them is unreadable at small sizes. */
      out += '<text x="' + st.cx + '" y="' + (st.cy - r - 8) + '" font-size="10" text-anchor="middle" ' +
        'font-family="Inter,sans-serif" font-weight="700" fill="#12263F" ' +
        'stroke="#FFFFFF" stroke-width="3.2" paint-order="stroke" stroke-linejoin="round">' + esc(shortName(st)) + '</text>';
      out += '<text x="' + st.cx + '" y="' + (st.cy + r + 12) + '" font-size="9.5" text-anchor="middle" ' +
        'font-family="JetBrains Mono,monospace" font-weight="700" fill="' + pr.color + '" ' +
        'stroke="#FFFFFF" stroke-width="3" paint-order="stroke" stroke-linejoin="round">' + e.sev + '</text>';
    });
    out += '</g>';

    return '<svg id="natsvg" viewBox="' + VIEW.x + ' ' + VIEW.y + ' ' + VIEW.w + ' ' + VIEW.h + '" ' +
      'role="group" aria-label="India — states with declared disaster events">' + out + '</svg>';
  }

  function animateTo(target, ms, done) {
    if (animTimer) { clearInterval(animTimer); animTimer = null; }
    var el = document.getElementById('natsvg');
    if (!el) { if (done) done(); return; }
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var from = { x: VIEW.x, y: VIEW.y, w: VIEW.w, h: VIEW.h };
    if (reduce) {
      VIEW = target; el.setAttribute('viewBox', target.x + ' ' + target.y + ' ' + target.w + ' ' + target.h);
      if (done) done(); return;
    }
    var t0 = Date.now(), dur = ms || 560;
    animTimer = setInterval(function () {
      var p = Math.min(1, (Date.now() - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      var v = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e,
                w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e };
      el.setAttribute('viewBox', v.x.toFixed(1) + ' ' + v.y.toFixed(1) + ' ' + v.w.toFixed(1) + ' ' + v.h.toFixed(1));
      if (p >= 1) { clearInterval(animTimer); animTimer = null; VIEW = target; if (done) done(); }
    }, 16);
  }

  function stateBox(id, padFrac) {
    var st = byId(id); if (!st) return FULL;
    var b = st.bbox, pad = (padFrac == null ? 0.22 : padFrac);
    var w = b[2] - b[0], h = b[3] - b[1];
    var px = w * pad, py = h * pad;
    var x = b[0] - px, y = b[1] - py; w += px * 2; h += py * 2;
    var ar = 612 / 696;
    if (w / h < ar) { var nw = h * ar; x -= (nw - w) / 2; w = nw; }
    else { var nh = w / ar; y -= (nh - h) / 2; h = nh; }
    return { x: x, y: y, w: w, h: h };
  }

  function zoomOut() { animateTo({ x: FULL.x, y: FULL.y, w: FULL.w, h: FULL.h }); }
  function zoomState(id) { animateTo(stateBox(id)); }
  function resetView() { VIEW = { x: FULL.x, y: FULL.y, w: FULL.w, h: FULL.h }; }

  return {
    render: render, summary: summary, entry: entry, byId: byId, tint: tint, shortName: shortName,
    zoomOut: zoomOut, zoomState: zoomState, stateBox: stateBox, animateTo: animateTo,
    resetView: resetView,
    get level() { return LEVEL; }, set level(v) { LEVEL = v; }
  };
})();
