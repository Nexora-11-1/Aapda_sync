/* ============================================================================
   AapdaSync — map.js
   Inline SVG district map. No map library, no tiles, no external requests.
   Coordinate space 0 0 1000 700; 1 unit = 100 m of simulated ground.
   ========================================================================== */

'use strict';

var MAP = (function () {

  var LAYERS = {
    hazard:  { on: true,  label: 'Hazard footprints' },
    zones:   { on: true,  label: 'Habitations' },
    sites:   { on: true,  label: 'Safe sites' },
    flows:   { on: true,  label: 'Relocation flows' },
    stranded:{ on: true,  label: 'Unplaced population' },
    roads:   { on: true,  label: 'Corridors' }
  };

  var VIEW = { x: 0, y: 0, w: 1000, h: 700 };
  var FULL = { x: 0, y: 0, w: 1000, h: 700 };
  var animTimer = null;

  var HZ_FILL = { flood: '#1D5FA8', flood25: '#0B6BA8', slide: '#C98A16', liq: '#8FA0B5', mah: '#7A4E9E' };

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function marker(kind, cx, cy, r, fill, extra) {
    extra = extra || '';
    if (kind === 'circle') return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '"' + extra + '/>';
    if (kind === 'square') return '<rect x="' + (cx - r) + '" y="' + (cy - r) + '" width="' + (2 * r) + '" height="' + (2 * r) + '" fill="' + fill + '"' + extra + '/>';
    if (kind === 'triangle') return '<polygon points="' + cx + ',' + (cy - r * 1.2) + ' ' + (cx + r * 1.12) + ',' + (cy + r * .86) + ' ' + (cx - r * 1.12) + ',' + (cy + r * .86) + '" fill="' + fill + '"' + extra + '/>';
    return '<polygon points="' + cx + ',' + (cy - r * 1.3) + ' ' + (cx + r * 1.2) + ',' + cy + ' ' + cx + ',' + (cy + r * 1.3) + ' ' + (cx - r * 1.2) + ',' + cy + '" fill="' + fill + '"' + extra + '/>';
  }

  /* A gently bowed arc so overlapping flows stay separable. */
  function arc(a, b, bow) {
    var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len;
    var k = (bow == null ? 0.16 : bow) * len;
    return 'M ' + a[0] + ',' + a[1] + ' Q ' + (mx + nx * k) + ',' + (my + ny * k) + ' ' + b[0] + ',' + b[1];
  }

  function render(opts) {
    opts = opts || {};
    var S = ENG.STATE;
    var focusHab = opts.focusHab || null;
    var out = '';

    out += '<defs>' +
      '<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="#12447E"/></marker>' +
      '<marker id="ahr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="#B3261E"/></marker>' +
      '<pattern id="hatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">' +
      '<line x1="0" y1="0" x2="0" y2="7" stroke="#B3261E" stroke-width="2.4" opacity=".5"/></pattern>' +
      '</defs>';

    /* --- district body --- */
    out += '<path d="' + SIM.district.outline + '" fill="#FAFCFE" stroke="#B7C4D4" stroke-width="1.6"/>';

    /* --- hazard footprints --- */
    if (LAYERS.hazard.on) {
      out += '<g aria-label="Hazard footprints">';
      SIM.hazardShapes.forEach(function (h) {
        var f = HZ_FILL[h.kind] || '#999';
        if (h.buffer) {
          out += '<path d="' + SIM.district.river + '" fill="none" stroke="' + f + '" stroke-width="' + h.buffer +
                 '" stroke-linecap="round" stroke-linejoin="round" opacity="' + h.opacity + '"/>';
        } else if (h.d) {
          out += '<path d="' + h.d + '" fill="' + f + '" opacity="' + h.opacity + '"/>';
        } else {
          out += '<circle cx="' + h.cx + '" cy="' + h.cy + '" r="' + h.r + '" fill="' + f + '" opacity="' + h.opacity +
                 '" stroke="' + f + '" stroke-width="1.6" stroke-dasharray="7 5"/>';
        }
      });
      out += '</g>';
    }

    /* --- river and ridge --- */
    out += '<path d="' + SIM.district.river + '" fill="none" stroke="#3C7FBE" stroke-width="3" opacity=".85" stroke-linecap="round"/>';
    out += '<path d="' + SIM.district.ridge + '" fill="none" stroke="#B08A50" stroke-width="1.6" stroke-dasharray="9 6" opacity=".55"/>';

    /* --- block labels --- */
    SIM.district.blocks.forEach(function (b) {
      out += '<text x="' + b.label[0] + '" y="' + b.label[1] + '" font-size="13" fill="#8494A8" font-family="Inter,sans-serif" font-weight="600" letter-spacing="1.6" text-anchor="middle">' + esc(b.name.toUpperCase()) + '</text>';
    });

    /* --- corridors: straight links from each habitation to its corridor hub --- */
    if (LAYERS.roads.on) {
      out += '<g aria-label="Road corridors">';
      SIM.corridors.forEach(function (c) {
        var members = S.habs.filter(function (h) { return h.corridor === c.id; });
        if (members.length < 2) return;
        var pts = members.map(function (h) { return h.xy; }).sort(function (a, b) { return a[0] - b[0]; });
        var d = 'M ' + pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' L ');
        var col = c.status === 'cut' ? '#B3261E' : (c.status === 'open' ? '#C3CEDC' : '#C98A16');
        out += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + (c.status === 'cut' ? 2.6 : 2) + '" opacity=".75" stroke-dasharray="' + (c.status === 'open' ? 'none' : '8 5') + '" stroke-linejoin="round"/>';
      });
      out += '</g>';
    }

    /* --- relocation flows --- */
    if (LAYERS.flows.on && S.plan) {
      out += '<g aria-label="Relocation flows">';
      var maxP = Math.max.apply(null, S.plan.assignments.map(function (a) { return a.persons; }).concat([1]));
      S.plan.assignments.forEach(function (a) {
        var hb = S.habs.filter(function (h) { return h.id === a.habId; })[0];
        var st = S.sites.filter(function (s) { return s.id === a.siteId; })[0];
        if (!hb || !st) return;
        if (focusHab && a.habId !== focusHab) return;
        var w = 1.1 + (a.persons / maxP) * 5.2;
        out += '<path class="flow" data-hab="' + a.habId + '" d="' + arc(hb.xy, st.xy) + '" fill="none" stroke="#12447E" stroke-width="' + w + '" opacity="' + (focusHab ? 0.85 : 0.32) + '" marker-end="url(#ah)" stroke-linecap="round"/>';
        if (focusHab) {
          var mx = (hb.xy[0] + st.xy[0]) / 2, my = (hb.xy[1] + st.xy[1]) / 2;
          out += '<rect x="' + (mx - 26) + '" y="' + (my - 20) + '" width="52" height="15" rx="3" fill="#fff" stroke="#C0CBDA"/>';
          out += '<text x="' + mx + '" y="' + (my - 9) + '" font-size="10" text-anchor="middle" font-family="JetBrains Mono,monospace" fill="#12263F">' + a.persons + ' pax</text>';
        }
      });
      out += '</g>';
    }

    /* --- safe sites --- */
    if (LAYERS.sites.on) {
      out += '<g aria-label="Safe sites">';
      S.sites.forEach(function (s) {
        var x = s.xy[0], y = s.xy[1];
        var dq = s.cap.disqualified;
        var fillPct = s.usableTotal > 0 ? s.committed / s.usableTotal : 0;
        var col = dq ? '#B3261E' : (fillPct >= 0.999 ? '#A96700' : '#1B7F3B');
        var sz = 9 + Math.min(9, Math.sqrt(Math.max(s.cap.capacity, 1)) / 4.4);
        var stip = '<b>' + esc(s.name) + '</b><i>' + esc(s.type) + ' · tier ' + s.tier + '</i>' +
          (dq
            ? '<u>State</u><span style="color:#FFB3AC">disqualified — site HEI ' + Math.round(s.cap.hei) + '</span>' +
              '<u>Register claims</u><span>' + s.claimed.toLocaleString('en-IN') + '</span>' +
              '<u>Real capacity</u><span>0</span>'
            : '<u>Register claims</u><span>' + s.claimed.toLocaleString('en-IN') + '</span>' +
              '<u>Derived capacity</u><span>' + s.cap.capacity.toLocaleString('en-IN') + '</span>' +
              '<u>Capped by</u><span>' + esc(s.cap.binding.label) + '</span>' +
              '<u>Free now</u><span>' + s.residual.toLocaleString('en-IN') + ' places</span>') +
          '<em>Click for the five ceilings</em>';
        out += '<g class="site" data-id="' + s.id + '" tabindex="0" role="button" ' +
          'data-tip="' + stip.replace(/"/g, '&quot;') + '" ' +
          'aria-label="' + esc(s.name + '. ' + (dq ? 'Disqualified: site stands in a red zone.' : 'Capacity ' + s.cap.capacity + ', ' + s.residual + ' places free. Binding constraint ' + s.cap.binding.label)) + '">';
        out += '<rect x="' + (x - sz / 2) + '" y="' + (y - sz / 2) + '" width="' + sz + '" height="' + sz + '" rx="2" fill="#fff" stroke="' + col + '" stroke-width="2.4"/>';
        if (dq) {
          out += '<rect x="' + (x - sz / 2) + '" y="' + (y - sz / 2) + '" width="' + sz + '" height="' + sz + '" rx="2" fill="url(#hatch)"/>';
          out += '<line x1="' + (x - sz / 2 - 3) + '" y1="' + (y - sz / 2 - 3) + '" x2="' + (x + sz / 2 + 3) + '" y2="' + (y + sz / 2 + 3) + '" stroke="#B3261E" stroke-width="2.2"/>';
        } else if (fillPct > 0) {
          out += '<rect x="' + (x - sz / 2) + '" y="' + (y + sz / 2 - sz * fillPct) + '" width="' + sz + '" height="' + (sz * fillPct) + '" fill="' + col + '" opacity=".78"/>';
        }
        out += '<text x="' + x + '" y="' + (y - sz / 2 - 4) + '" font-size="9.5" text-anchor="middle" font-family="Inter,sans-serif" fill="#48586E" font-weight="600">' + esc(s.id) + '</text>';
        out += '</g>';
      });
      out += '</g>';
    }

    /* --- habitations --- */
    if (LAYERS.zones.on) {
      out += '<g aria-label="Habitations">';
      S.habs.forEach(function (h) {
        var pr = ENG.priority(h.RUI.score);
        var r = 4.5 + Math.sqrt(h.pop) / 12;
        var held = ENG.heldFor(h.id);
        var planned = S.plan ? S.plan.assignments.filter(function (a) { return a.habId === h.id; })
          .reduce(function (n, a) { return n + a.persons; }, 0) : 0;
        var covered = Math.max(held, planned);
        var short = h.demand.shelterNeed - covered;
        var htip = '<b>' + esc(h.name) + '</b><i>' + esc(h.HEI.dominant.label) + ' · ' + pr.label.toLowerCase() + ' priority</i>' +
          '<u>Urgency (RUI)</u><span>' + Math.round(h.RUI.score) + ' / 100</span>' +
          '<u>Population</u><span>' + h.pop.toLocaleString('en-IN') + '</span>' +
          '<u>Needs a place</u><span>' + h.demand.shelterNeed.toLocaleString('en-IN') + '</span>' +
          '<u>Unplaced</u><span' + (short > 0 ? ' style="color:#FFB3AC"' : '') + '>' + Math.max(0, short).toLocaleString('en-IN') + '</span>' +
          '<em>Click for the full derivation</em>';
        out += '<g class="hab" data-id="' + h.id + '" tabindex="0" role="button" ' +
          'data-tip="' + htip.replace(/"/g, '&quot;') + '" ' +
          'aria-label="' + esc(h.name + '. Urgency ' + Math.round(h.RUI.score) + ' of 100, ' + pr.label +
            '. Population ' + h.pop + ', shelter need ' + h.demand.shelterNeed +
            (short > 0 ? ', ' + short + ' with no place allocated.' : ', fully placed.')) + '">';
        // stranded ring first, so it reads as a halo
        if (LAYERS.stranded.on && short > 0) {
          out += '<circle cx="' + h.xy[0] + '" cy="' + h.xy[1] + '" r="' + (r + 5.5) + '" fill="none" stroke="#B3261E" stroke-width="2" stroke-dasharray="3.5 3"/>';
        }
        out += marker(pr.shape, h.xy[0], h.xy[1], r, pr.color, ' stroke="#fff" stroke-width="1.4"');
        out += '<text x="' + h.xy[0] + '" y="' + (h.xy[1] + r + 11) + '" font-size="9.5" text-anchor="middle" font-family="Inter,sans-serif" fill="#48586E">' + esc(h.name.length > 15 ? h.name.slice(0, 14) + '…' : h.name) + '</text>';
        out += '<text x="' + h.xy[0] + '" y="' + (h.xy[1] + r + 20) + '" font-size="9" text-anchor="middle" font-family="JetBrains Mono,monospace" fill="' + pr.color + '" font-weight="600">' + Math.round(h.RUI.score) + '</text>';
        out += '</g>';
      });
      out += '</g>';
    }

    return '<svg id="mapsvg" viewBox="' + VIEW.x + ' ' + VIEW.y + ' ' + VIEW.w + ' ' + VIEW.h + '" ' +
      'role="group" aria-label="Simulated district map of Sarai Ghat">' + out + '</svg>';
  }

  /* Animate the viewBox rather than jumping — an operator who loses the frame
     loses orientation, which costs more time than the animation does. */
  function animateTo(target, ms) {
    if (animTimer) { clearInterval(animTimer); animTimer = null; }
    var el = document.getElementById('mapsvg');
    if (!el) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var from = { x: VIEW.x, y: VIEW.y, w: VIEW.w, h: VIEW.h };
    if (reduce) { VIEW = target; el.setAttribute('viewBox', target.x + ' ' + target.y + ' ' + target.w + ' ' + target.h); return; }
    var t0 = Date.now(), dur = ms || 560;
    animTimer = setInterval(function () {
      var p = Math.min(1, (Date.now() - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      var v = {
        x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e
      };
      el.setAttribute('viewBox', v.x.toFixed(1) + ' ' + v.y.toFixed(1) + ' ' + v.w.toFixed(1) + ' ' + v.h.toFixed(1));
      if (p >= 1) { clearInterval(animTimer); animTimer = null; VIEW = target; }
    }, 16);
  }

  function zoomToDistrict() { animateTo({ x: FULL.x, y: FULL.y, w: FULL.w, h: FULL.h }); }
  function resetView() { VIEW = { x: FULL.x, y: FULL.y, w: FULL.w, h: FULL.h }; }

  function zoomTo(xy, span) {
    span = span || 300;
    animateTo({ x: xy[0] - span / 2, y: xy[1] - (span * 0.7) / 2, w: span, h: span * 0.7 });
  }

  function zoomToBlock(blockId) {
    var pts = ENG.STATE.habs.filter(function (h) { return h.block === blockId; }).map(function (h) { return h.xy; })
      .concat(ENG.STATE.sites.filter(function (s) { return s.block === blockId; }).map(function (s) { return s.xy; }));
    if (!pts.length) return zoomToDistrict();
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var pad = 70;
    var x0 = Math.min.apply(null, xs) - pad, x1 = Math.max.apply(null, xs) + pad;
    var y0 = Math.min.apply(null, ys) - pad, y1 = Math.max.apply(null, ys) + pad;
    var w = x1 - x0, h = y1 - y0;
    if (w / h < 1000 / 700) { w = h * (1000 / 700); x0 = (x0 + x1) / 2 - w / 2; }
    else { h = w * (700 / 1000); y0 = (y0 + y1) / 2 - h / 2; }
    animateTo({ x: x0, y: y0, w: w, h: h });
  }

  function toggle(k) { if (LAYERS[k]) LAYERS[k].on = !LAYERS[k].on; }

  return { render: render, LAYERS: LAYERS, zoomToDistrict: zoomToDistrict, zoomTo: zoomTo, resetView: resetView,
           zoomToBlock: zoomToBlock, toggle: toggle, VIEW: VIEW, arc: arc, marker: marker };
})();
