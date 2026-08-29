/* ============================================================================
   AapdaSync — charts.js
   Hand-written inline SVG on a 340 x 170 viewBox. No chart library.
   Categorical identity: #1D5FA8, #C98A16, #1B7F3B.
   The risk ramp is treated as ORDINAL and is always paired with a shape and a
   printed number, so colour is never the only encoding.
   ========================================================================== */

'use strict';

var CHARTS = (function () {

  var W = 340, H = 170;
  var CAT = { a: '#1D5FA8', b: '#C98A16', c: '#1B7F3B', d: '#8A5AA8', grid: '#E2E8F0', axis: '#9AA6B8', ink: '#12263F', mut: '#77839A' };
  var RAMP = ['#1B7F3B', '#C98A16', '#D2551A', '#B3261E'];

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function svg(inner, w, h) {
    return '<svg viewBox="0 0 ' + (w || W) + ' ' + (h || H) + '" role="img" preserveAspectRatio="xMidYMid meet">' + inner + '</svg>';
  }
  function txt(x, y, s, o) {
    o = o || {};
    return '<text x="' + x + '" y="' + y + '" font-size="' + (o.size || 9.5) + '" fill="' + (o.fill || CAT.mut) + '"' +
      (o.anchor ? ' text-anchor="' + o.anchor + '"' : '') +
      (o.weight ? ' font-weight="' + o.weight + '"' : '') +
      (o.mono ? ' font-family="JetBrains Mono, monospace"' : ' font-family="Inter, sans-serif"') +
      '>' + esc(s) + '</text>';
  }
  function shape(kind, cx, cy, r, fill) {
    if (kind === 'circle') return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '"/>';
    if (kind === 'square') return '<rect x="' + (cx - r) + '" y="' + (cy - r) + '" width="' + (2 * r) + '" height="' + (2 * r) + '" fill="' + fill + '"/>';
    if (kind === 'triangle') return '<polygon points="' + cx + ',' + (cy - r * 1.15) + ' ' + (cx + r * 1.1) + ',' + (cy + r * .85) + ' ' + (cx - r * 1.1) + ',' + (cy + r * .85) + '" fill="' + fill + '"/>';
    return '<polygon points="' + cx + ',' + (cy - r * 1.25) + ' ' + (cx + r * 1.15) + ',' + cy + ' ' + cx + ',' + (cy + r * 1.25) + ' ' + (cx - r * 1.15) + ',' + cy + '" fill="' + fill + '"/>';
  }
  function pShape(score) {
    if (score >= 85) return 'diamond'; if (score >= 60) return 'triangle';
    if (score >= 30) return 'square'; return 'circle';
  }
  function pColor(score) {
    if (score >= 85) return RAMP[3]; if (score >= 60) return RAMP[2];
    if (score >= 30) return RAMP[1]; return RAMP[0];
  }
  function card(title, sub, body, legend) {
    return '<div class="chart"><h4>' + esc(title) + '</h4><p class="cs">' + esc(sub) + '</p>' + body +
      (legend ? '<div class="clg">' + legend + '</div>' : '') + '</div>';
  }
  function lg(color, label) { return '<span><i style="background:' + color + '"></i>' + esc(label) + '</span>'; }

  /* ====================================================================
     1. The register gap — claimed capacity against derived capacity
     ================================================================== */
  function registerGap(sites) {
    var rows = sites.slice().sort(function (a, b) { return b.claimed - a.claimed; }).slice(0, 9);
    var max = Math.max.apply(null, rows.map(function (s) { return s.claimed; }));
    var x0 = 96, x1 = 288, bh = 11, gap = 6.5, y = 24;
    var out = '';
    out += txt(x0, 15, '0', { size: 8.3, mono: true }) + txt(x1, 15, max.toLocaleString('en-IN'), { size: 8.3, mono: true, anchor: 'end' }) + txt(336, 15, 'real', { size: 8.3, anchor: 'end', weight: 600, fill: CAT.ink });
    rows.forEach(function (s) {
      var wC = (s.claimed / max) * (x1 - x0);
      var real = s.cap.disqualified ? 0 : s.cap.capacity;
      var wR = (real / max) * (x1 - x0);
      out += txt(x0 - 5, y + 8.5, s.name.replace(/,.*$/, '').slice(0, 18), { size: 8.6, anchor: 'end', fill: CAT.ink });
      out += '<rect x="' + x0 + '" y="' + y + '" width="' + wC + '" height="' + bh + '" rx="1.5" fill="#DDE4EC"/>';
      out += '<rect x="' + x0 + '" y="' + y + '" width="' + Math.max(wR, real > 0 ? 1.5 : 0) + '" height="' + bh + '" rx="1.5" fill="' + (s.cap.disqualified ? '#B3261E' : CAT.a) + '"/>';
      out += txt(336, y + 8.5, s.cap.disqualified ? 'DQ' : real.toLocaleString('en-IN'), { size: 8.3, mono: true, anchor: 'end', fill: s.cap.disqualified ? '#B3261E' : CAT.ink, weight: 600 });
      y += bh + gap;
    });
    return card('The register gap',
      'Grey is what the shelter register claims. Blue is what the five ceilings actually allow. DQ means the site itself stands in a red zone.',
      svg(out, W, y + 4),
      lg('#DDE4EC', 'Claimed on register') + lg(CAT.a, 'Derived capacity') + lg('#B3261E', 'Disqualified'));
  }

  /* ====================================================================
     2. What actually caps capacity — binding constraint distribution
     ================================================================== */
  function bindingMix(sites) {
    var buckets = {};
    sites.forEach(function (s) {
      var k = s.cap.disqualified ? 'Disqualified' : s.cap.binding.label;
      buckets[k] = buckets[k] || { n: 0, people: 0 };
      buckets[k].n++; buckets[k].people += s.cap.disqualified ? 0 : s.cap.capacity;
    });
    var keys = Object.keys(buckets).sort(function (a, b) { return buckets[b].n - buckets[a].n; });
    var totalN = sites.length;
    var pal = { 'Sanitation': '#C98A16', 'Covered floor area': '#1D5FA8', 'Assured water': '#0E7C7B',
                'Corridor throughput': '#8A5AA8', 'Structural safety': '#D2551A', 'Disqualified': '#B3261E' };
    var x = 8, y = 28, bw = 324, out = '';
    out += txt(8, 14, 'Sites by binding constraint (n=' + totalN + ')', { size: 9.1, fill: CAT.ink, weight: 600 });
    keys.forEach(function (k) {
      var w = (buckets[k].n / totalN) * bw;
      out += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="18" fill="' + (pal[k] || CAT.mut) + '"/>';
      if (w > 20) out += txt(x + w / 2, y + 12.5, buckets[k].n, { size: 10.4, anchor: 'middle', fill: '#fff', weight: 700, mono: true });
      x += w;
    });
    y = 62;
    keys.forEach(function (k) {
      out += '<rect x="8" y="' + (y - 7) + '" width="9" height="9" rx="1.5" fill="' + (pal[k] || CAT.mut) + '"/>';
      out += txt(22, y, k, { size: 9.4, fill: CAT.ink });
      out += txt(232, y, buckets[k].n + (buckets[k].n === 1 ? ' site' : ' sites'), { size: 9.1, anchor: 'end', mono: true });
      out += txt(332, y, buckets[k].people.toLocaleString('en-IN') + ' places', { size: 9.1, anchor: 'end', mono: true });
      y += 17;
    });
    out += '<line x1="8" y1="' + (y - 4) + '" x2="332" y2="' + (y - 4) + '" stroke="' + CAT.grid + '"/>';
    out += txt(8, y + 10, 'Sanitation is the most common ceiling — and the cheapest to lift.', { size: 8.8, fill: CAT.mut });
    return card('What actually caps capacity',
      'The binding constraint, site by site. A shortage of shelter is usually a shortage of one specific thing.',
      svg(out, W, y + 16));
  }

  /* ====================================================================
     3. THE COUPLING — urgency against reachable capacity coverage
        This is the chart that shows the model's central claim.
     ================================================================== */
  function coupling(habs) {
    var pl = { l: 30, r: 12, t: 16, b: 24 };
    var pw = W - pl.l - pl.r, ph = H - pl.t - pl.b;
    var out = '';
    // grid
    for (var i = 0; i <= 4; i++) {
      var gy = pl.t + ph - (i / 4) * ph;
      out += '<line x1="' + pl.l + '" y1="' + gy + '" x2="' + (pl.l + pw) + '" y2="' + gy + '" stroke="' + CAT.grid + '"/>';
      out += txt(pl.l - 4, gy + 2.5, i * 25, { size: 8.3, anchor: 'end', mono: true });
    }
    for (var j = 0; j <= 4; j++) {
      var gx = pl.l + (j / 4) * pw;
      out += txt(gx, H - 12, (j * 25) + '%', { size: 8.3, anchor: 'middle', mono: true });
    }
    // the danger quadrant: high urgency AND low coverage
    out += '<rect x="' + pl.l + '" y="' + pl.t + '" width="' + (pw * 0.4) + '" height="' + (ph * 0.4) + '" fill="#B3261E" opacity=".06"/>';
    out += '<line x1="' + (pl.l + pw * 0.4) + '" y1="' + pl.t + '" x2="' + (pl.l + pw * 0.4) + '" y2="' + (pl.t + ph * 0.4) + '" stroke="#B3261E" stroke-width=".7" stroke-dasharray="2 2"/>';
    out += '<line x1="' + pl.l + '" y1="' + (pl.t + ph * 0.4) + '" x2="' + (pl.l + pw * 0.4) + '" y2="' + (pl.t + ph * 0.4) + '" stroke="#B3261E" stroke-width=".7" stroke-dasharray="2 2"/>';

    habs.forEach(function (h) {
      var cov = Math.min(1, h.RUI.stress.coverage);
      var cx = pl.l + cov * pw;
      var cy = pl.t + ph - (h.RUI.score / 100) * ph;
      out += shape(pShape(h.RUI.score), cx, cy, 3.2, pColor(h.RUI.score));
    });
    out += txt(pl.l + pw / 2, H - 3, 'Reachable capacity as a share of need  →', { size: 8.3, anchor: 'middle' });
    out += '<text x="9" y="' + (pl.t + ph / 2) + '" font-size="6.4" fill="' + CAT.mut + '" font-family="Inter,sans-serif" text-anchor="middle" transform="rotate(-90 9 ' + (pl.t + ph / 2) + ')">Relocation urgency</text>';
    return card('Urgency against room to go',
      'Every habitation, plotted by how urgent it is and how much reachable capacity remains for it. Points in the shaded corner are the ones no risk map alone would surface.',
      svg(out),
      lg(RAMP[3], 'Critical ◆ 85+') + lg(RAMP[2], 'High ▲ 60–84') + lg(RAMP[1], 'Medium ■ 30–59') + lg(RAMP[0], 'Low ● 0–29'));
  }

  /* ====================================================================
     4. Deficit waterfall — need → capacity → augmentation → residual
     ================================================================== */
  function waterfall(d, augTotal) {
    var steps = [
      { k: ['Shelter', 'need'], v: d.demand, kind: 'base' },
      { k: ['Derived', 'capacity'], v: -Math.min(d.demand, d.totalUsable), kind: 'good' },
      { k: ['Augmentation', 'within 6 h'], v: -Math.min(Math.max(0, d.demand - d.totalUsable), augTotal), kind: 'good' },
      { k: ['Residual', 'deficit'], v: 0, kind: 'end' }
    ];
    var running = 0, pts = [];
    steps.forEach(function (s) {
      if (s.kind === 'base') { pts.push({ from: 0, to: s.v, s: s }); running = s.v; }
      else if (s.kind === 'end') { pts.push({ from: 0, to: running, s: s }); }
      else { pts.push({ from: running, to: running + s.v, s: s }); running += s.v; }
    });
    var max = d.demand;
    var pl = { l: 8, r: 8, t: 22, b: 34 }, pw = W - pl.l - pl.r, ph = H - pl.t - pl.b;
    var bw = pw / steps.length - 12, out = '';
    out += '<line x1="' + pl.l + '" y1="' + (pl.t + ph) + '" x2="' + (W - pl.r) + '" y2="' + (pl.t + ph) + '" stroke="' + CAT.axis + '"/>';
    pts.forEach(function (p, i) {
      var x = pl.l + i * (pw / steps.length) + 6;
      var yTop = pl.t + ph - (Math.max(p.from, p.to) / max) * ph;
      var yBot = pl.t + ph - (Math.min(p.from, p.to) / max) * ph;
      var col = p.s.kind === 'base' ? CAT.a : (p.s.kind === 'end' ? (running > 0 ? '#B3261E' : '#1B7F3B') : '#1B7F3B');
      out += '<rect x="' + x + '" y="' + yTop + '" width="' + bw + '" height="' + Math.max(2, yBot - yTop) + '" rx="1.5" fill="' + col + '"/>';
      var lbl = p.s.kind === 'end' ? running : Math.abs(p.to - p.from);
      out += txt(x + bw / 2, yTop - 4, Math.round(lbl).toLocaleString('en-IN'), { size: 9.6, anchor: 'middle', mono: true, weight: 700, fill: CAT.ink });
      out += txt(x + bw / 2, pl.t + ph + 12, p.s.k[0], { size: 8.6, anchor: 'middle', fill: CAT.ink });
      out += txt(x + bw / 2, pl.t + ph + 22, p.s.k[1], { size: 8.6, anchor: 'middle' });
      if (i < pts.length - 1) {
        var nx = pl.l + (i + 1) * (pw / steps.length) + 6;
        var cy = pl.t + ph - (p.to / max) * ph;
        out += '<line x1="' + (x + bw) + '" y1="' + cy + '" x2="' + nx + '" y2="' + cy + '" stroke="' + CAT.axis + '" stroke-dasharray="2 2"/>';
      }
    });
    return card('Closing the deficit',
      'How far the district gets from need to residual, and how much of the gap is closeable inside six hours by lifting binding constraints.',
      svg(out),
      lg(CAT.a, 'Need') + lg('#1B7F3B', 'Covered') + lg('#B3261E', 'Residual — needs escalation'));
  }

  /* ====================================================================
     5. Movement feasibility — can the fleet finish before impact?
     ================================================================== */
  function feasibility(d) {
    var pl = { l: 30, r: 46, t: 16, b: 24 }, pw = W - pl.l - pl.r, ph = H - pl.t - pl.b;
    var hrs = Math.max(d.windowHrs * 1.6, 4);
    var maxP = Math.max(d.demand, d.rate * hrs);
    var out = '';
    for (var i = 0; i <= 3; i++) {
      var gy = pl.t + ph - (i / 3) * ph;
      out += '<line x1="' + pl.l + '" y1="' + gy + '" x2="' + (pl.l + pw) + '" y2="' + gy + '" stroke="' + CAT.grid + '"/>';
      out += txt(pl.l - 4, gy + 2.5, Math.round((i / 3) * maxP / 1000) + 'k', { size: 8.3, anchor: 'end', mono: true });
    }
    // cumulative moved
    var px = pl.l + pw, ratePts = [];
    for (var t = 0; t <= hrs; t += 0.25) {
      var x = pl.l + (t / hrs) * pw;
      var y = pl.t + ph - (Math.min(d.rate * t, d.placed) / maxP) * ph;
      ratePts.push(x + ',' + y);
    }
    out += '<polyline points="' + ratePts.join(' ') + '" fill="none" stroke="' + CAT.a + '" stroke-width="1.8"/>';
    // demand line
    var dy = pl.t + ph - (d.demand / maxP) * ph;
    out += '<line x1="' + pl.l + '" y1="' + dy + '" x2="' + (pl.l + pw) + '" y2="' + dy + '" stroke="#B3261E" stroke-width="1.2" stroke-dasharray="3 2"/>';
    out += txt(pl.l + pw + 3, dy + 2, 'need', { size: 8.3, fill: '#B3261E', weight: 600 });
    // committed line
    var cy2 = pl.t + ph - (d.placed / maxP) * ph;
    out += '<line x1="' + pl.l + '" y1="' + cy2 + '" x2="' + (pl.l + pw) + '" y2="' + cy2 + '" stroke="#1B7F3B" stroke-width="1.2" stroke-dasharray="3 2"/>';
    out += txt(pl.l + pw + 3, cy2 + 2 + (Math.abs(cy2 - dy) < 8 ? 9 : 0), 'placed', { size: 8.3, fill: '#1B7F3B', weight: 600 });
    // impact line
    var ix = pl.l + (d.windowHrs / hrs) * pw;
    out += '<line x1="' + ix + '" y1="' + pl.t + '" x2="' + ix + '" y2="' + (pl.t + ph) + '" stroke="#12263F" stroke-width="1.2"/>';
    out += txt(ix - 3, pl.t + 8, 'impact', { size: 8.3, anchor: 'end', fill: CAT.ink, weight: 700 });
    out += txt(pl.l + pw / 2, H - 4, 'Hours from now  →', { size: 8.3, anchor: 'middle' });
    return card('Can the fleet finish in time?',
      'Cumulative people moved at ' + Math.round(d.rate) + '/hour against what has been placed and when the next hazard lands.',
      svg(out),
      lg(CAT.a, 'Cumulative moved') + lg('#1B7F3B', 'Placed by the engine') + lg('#B3261E', 'Total shelter need'));
  }

  /* ====================================================================
     6. Risk composition by block — what is driving each block's exposure
     ================================================================== */
  function composition(habs, blocks) {
    var HK = [{ k: 'seis', c: '#6B7A8F', l: 'Seismic' }, { k: 'flood', c: '#1D5FA8', l: 'Flood' },
              { k: 'slide', c: '#C98A16', l: 'Landslide' }, { k: 'mah', c: '#7A4E9E', l: 'Industrial' }];
    var pl = { l: 78, t: 20 }, bw = 232, out = '', y = pl.t;
    blocks.forEach(function (b) {
      var hs = habs.filter(function (h) { return h.block === b.id; });
      if (!hs.length) return;
      var sums = { seis: 0, flood: 0, slide: 0, mah: 0 }, tot = 0;
      hs.forEach(function (h) {
        h.HEI.parts.forEach(function (p) { sums[p.k] += p.v * h.pop; });
      });
      HK.forEach(function (d) { tot += sums[d.k]; });
      out += txt(pl.l - 5, y + 12, b.name, { size: 9.1, anchor: 'end', fill: CAT.ink, weight: 600 });
      var x = pl.l;
      HK.forEach(function (d) {
        if (tot <= 0) return;
        var w = (sums[d.k] / tot) * bw;
        if (w <= 0) return;
        out += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="17" fill="' + d.c + '"/>';
        if (w > 26) out += txt(x + w / 2, y + 12, Math.round((sums[d.k] / tot) * 100) + '%', { size: 8.3, anchor: 'middle', fill: '#fff', weight: 700, mono: true });
        x += w;
      });
      out += txt(pl.l + bw + 5, y + 12, hs.length + ' hab', { size: 8.3, mono: true });
      y += 24;
    });
    out += txt(pl.l, y + 10, 'Population-weighted share of exposure, by hazard.', { size: 8.6, fill: CAT.mut });
    return card('What drives each block',
      'Exposure decomposed by hazard and weighted by the population standing in it. A district-wide average would hide all four of these.',
      svg(out, W, y + 16),
      HK.map(function (d) { return lg(d.c, d.l); }).join(''));
  }

  /* ====================================================================
     7. Scenario sensitivity — how the answer moves under stress
     ================================================================== */
  function sensitivity(rows) {
    var pl = { l: 112, t: 18 }, bw = 158, out = '', y = pl.t;
    var max = Math.max.apply(null, rows.map(function (r) { return Math.max(r.deficit, 1); }));
    rows.forEach(function (r) {
      var w = (r.deficit / max) * bw;
      var col = r.id === 'SC-BASE' ? CAT.a : (r.deficit > rows[0].deficit * 1.5 ? '#B3261E' : '#D2551A');
      out += txt(pl.l - 5, y + 11, r.name.slice(0, 22), { size: 8.6, anchor: 'end', fill: CAT.ink, weight: r.id === 'SC-BASE' ? 700 : 400 });
      out += '<rect x="' + pl.l + '" y="' + y + '" width="' + Math.max(w, 1) + '" height="15" rx="1.5" fill="' + col + '"/>';
      out += txt(pl.l + w + 4, y + 11, r.deficit.toLocaleString('en-IN'), { size: 8.8, mono: true, fill: CAT.ink, weight: 600 });
      if (r.id !== 'SC-BASE') {
        var delta = r.deficit - rows[0].deficit;
        out += txt(W - 4, y + 11, (delta >= 0 ? '+' : '') + delta.toLocaleString('en-IN'), { size: 8.3, anchor: 'end', mono: true, fill: delta > 0 ? '#B3261E' : '#1B7F3B' });
      }
      y += 21;
    });
    out += txt(8, y + 11, 'People left without a reachable place, under each perturbation.', { size: 8.6, fill: CAT.mut });
    return card('How fragile is this plan?',
      'The residual deficit recomputed under each counterfactual. A plan that only works in the baseline is not a plan.',
      svg(out, W, y + 17));
  }


  /* ====================================================================
     8. Fourteen-day trajectory under one rainfall scenario
     ================================================================== */
  function trajectory(habId, scenarioId) {
    var t = FORECAST.trajectory(habId, scenarioId, 14);
    var pl = { l: 34, r: 12, t: 14, b: 26 }, pw = W - pl.l - pl.r, ph = H - pl.t - pl.b;
    var out = '';
    for (var i = 0; i <= 4; i++) {
      var gy = pl.t + ph - (i / 4) * ph;
      out += '<line x1="' + pl.l + '" y1="' + gy + '" x2="' + (pl.l + pw) + '" y2="' + gy + '" stroke="' + CAT.grid + '"/>';
      out += txt(pl.l - 4, gy + 2.5, (i * 25) + '%', { size: 8.3, anchor: 'end', mono: true });
    }
    var pts = t.points.map(function (p, i) {
      return (pl.l + (i / (t.points.length - 1)) * pw) + ',' + (pl.t + ph - p.p * ph);
    });
    out += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + CAT.a + '" stroke-width="2"/>';
    out += '<polygon points="' + pl.l + ',' + (pl.t + ph) + ' ' + pts.join(' ') + ' ' + (pl.l + pw) + ',' + (pl.t + ph) +
      '" fill="' + CAT.a + '" opacity=".12"/>';
    var last = t.points[t.points.length - 1];
    out += '<circle cx="' + (pl.l + pw) + '" cy="' + (pl.t + ph - last.p * ph) + '" r="3.2" fill="' + CAT.a + '"/>';
    // 35% "likely" threshold
    var ty = pl.t + ph - 0.35 * ph;
    out += '<line x1="' + pl.l + '" y1="' + ty + '" x2="' + (pl.l + pw) + '" y2="' + ty +
      '" stroke="#D2551A" stroke-width="1.1" stroke-dasharray="3 2"/>';
    out += txt(pl.l + pw - 2, ty - 4, 'likely', { size: 8, anchor: 'end', fill: '#D2551A', weight: 600 });
    out += txt(pl.l, H - 5, 'today', { size: 8.3 });
    out += txt(pl.l + pw, H - 5, '+14 days', { size: 8.3, anchor: 'end' });
    return svg(out);
  }

  /* ====================================================================
     9. Reliability on the held-out year
     ================================================================== */
  function reliability() {
    var rel = MODEL.reliability || [];
    var pl = { l: 34, r: 14, t: 14, b: 30 }, pw = W - pl.l - pl.r, ph = H - pl.t - pl.b;
    var out = '';
    for (var i = 0; i <= 4; i++) {
      var g = i / 4;
      out += '<line x1="' + pl.l + '" y1="' + (pl.t + ph - g * ph) + '" x2="' + (pl.l + pw) + '" y2="' + (pl.t + ph - g * ph) + '" stroke="' + CAT.grid + '"/>';
      out += txt(pl.l - 4, pl.t + ph - g * ph + 2.5, Math.round(g * 100) + '%', { size: 8.3, anchor: 'end', mono: true });
      out += txt(pl.l + g * pw, H - 16, Math.round(g * 100) + '%', { size: 8.3, anchor: 'middle', mono: true });
    }
    out += '<line x1="' + pl.l + '" y1="' + (pl.t + ph) + '" x2="' + (pl.l + pw) + '" y2="' + pl.t +
      '" stroke="' + CAT.axis + '" stroke-dasharray="3 3"/>';
    var maxN = Math.max.apply(null, rel.map(function (r) { return r.n; }).concat([1]));
    rel.forEach(function (r) {
      var x = pl.l + r.predicted * pw, y = pl.t + ph - r.observed * ph;
      var bh = (r.n / maxN) * 14;
      out += '<rect x="' + (x - 3) + '" y="' + (pl.t + ph + 2) + '" width="6" height="' + bh + '" fill="' + CAT.grid + '"/>';
      out += '<line x1="' + x + '" y1="' + y + '" x2="' + x + '" y2="' + (pl.t + ph - r.predicted * ph) + '" stroke="' + CAT.axis + '" stroke-width="1"/>';
      out += '<circle cx="' + x + '" cy="' + y + '" r="4" fill="' + CAT.a + '" stroke="#fff" stroke-width="1.2"/>';
    });
    out += txt(pl.l + pw / 2, H - 3, 'predicted  →  (bars: held-out cases per band)', { size: 8, anchor: 'middle' });
    out += '<text x="9" y="' + (pl.t + ph / 2) + '" font-size="8" fill="' + CAT.mut + '" font-family="Inter,sans-serif" text-anchor="middle" transform="rotate(-90 9 ' + (pl.t + ph / 2) + ')">observed</text>';
    return svg(out);
  }

  return {
    registerGap: registerGap, bindingMix: bindingMix, coupling: coupling,
    waterfall: waterfall, feasibility: feasibility, composition: composition,
    sensitivity: sensitivity, trajectory: trajectory, reliability: reliability, shape: shape, pShape: pShape, pColor: pColor, CAT: CAT, RAMP: RAMP
  };
})();
