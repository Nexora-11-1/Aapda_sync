/* ============================================================================
   AapdaSync — views.js
   Every screen renders through page(title, subtitle, body).
   ========================================================================== */

'use strict';

var V = (function () {

  /* ------------------------------------------------------------- helpers */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function n(v) { return Math.round(v).toLocaleString('en-IN'); }
  function d1(v) { return (Math.round(v * 10) / 10).toLocaleString('en-IN'); }
  function pc(v) { return Math.round(v * 100) + '%'; }

  /* Long rationale belongs behind a disclosure, not in front of the number it
     explains. The default screen stays scannable; the argument is one click
     away for anyone who wants to disagree with it. */
  /* Data freshness. Mode is one of Official / Seeded / Predicted / Simulated and
     is never blended, because a screen that mixes an official gauge with a
     model output under one "last updated" is lying about both. */
  function freshness() {
    function ago(d) {
      if (!d) return 'never';
      var s0 = Math.round((Date.now() - d.getTime()) / 1000);
      if (s0 < 60) return s0 + 's ago';
      if (s0 < 3600) return Math.round(s0 / 60) + 'm ago';
      return Math.round(s0 / 3600) + 'h ago';
    }
    var rows = [
      ['Last sync', ago(LIVE.lastSyncAt), 'a source was polled'],
      ['Last data update', ago(LIVE.lastDataUpdateAt), 'inbound data actually changed'],
      ['Last compute', ago(LIVE.lastComputeAt), 'the model chain re-derived'],
      ['Last verification', LIVE.lastVerifiedAt ? ago(LIVE.lastVerifiedAt) : 'never', 'a human confirmed a report']
    ];
    return '<div class="fresh">' + rows.map(function (r) {
      return '<div class="fr"><span class="fk">' + esc(r[0]) + '</span>' +
        '<span class="fv m">' + esc(r[1]) + '</span>' +
        '<span class="fn">' + esc(r[2]) + '</span></div>';
    }).join('') +
    '<div class="fr"><span class="fk">Mode</span><span class="fv">' +
      pill('off', 'Simulated') + pill('inf', 'Predicted') + '</span>' +
      '<span class="fn">no official feed is connected</span></div></div>';
  }

  function why(summary, html) {
    return '<details class="why"><summary>' + esc(summary) + '</summary>' +
      '<div class="whyb">' + html + '</div></details>';
  }

  function page(title, sub, body, right) {
    return '<div class="page"><div class="ph"><div><h1>' + esc(title) + '</h1><p>' + sub + '</p></div>' +
      (right ? '<div class="phr">' + right + '</div>' : '') + '</div>' + body + '</div>';
  }
  function tile(k, v, d, cls) {
    return '<div class="tile ' + (cls || '') + '"><div class="k">' + esc(k) + '</div><div class="v m">' + v + '</div><div class="d">' + d + '</div></div>';
  }
  function pill(kind, label) { return '<span class="p p-' + kind + '">' + esc(label) + '</span>'; }
  function pillFor(score) { var p = ENG.priority(score); return pill(p.k, p.label); }
  function note(kind, html) {
    var ic = { r: '⚠', y: '⚠', g: '✓', b: 'ℹ', '': 'ℹ' }[kind] || 'ℹ';
    return '<div class="note ' + kind + '"><span class="ic">' + ic + '</span><div>' + html + '</div></div>';
  }
  function card(title, sub, body, right, tight) {
    return '<div class="card"><div class="card-h"><h3>' + esc(title) + '</h3>' +
      (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') +
      (right ? '<span class="r">' + right + '</span>' : '') + '</div>' +
      '<div class="card-b' + (tight ? ' tight' : '') + '">' + body + '</div></div>';
  }
  function kv(pairs) {
    return '<div class="kv">' + pairs.map(function (p) {
      return '<div>' + esc(p[0]) + '</div><div>' + p[1] + '</div>';
    }).join('') + '</div>';
  }
  function bar(label, value, max, caption, color) {
    var w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    return '<div class="blk"><div class="bl"><span>' + esc(label) + '</span><b>' + (typeof value === 'number' ? n(value) : value) + '</b></div>' +
      '<div class="bar"><i style="width:' + w + '%;background:' + (color || '#12447E') + '"></i></div>' +
      (caption ? '<div class="bsc">' + caption + '</div>' : '') + '</div>';
  }
  function swatch(shape, color, size) {
    size = size || 12;
    var c = size / 2, r = size / 2 - 1, s = '';
    if (shape === 'circle') s = '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="' + color + '"/>';
    else if (shape === 'square') s = '<rect x="1" y="1" width="' + (size - 2) + '" height="' + (size - 2) + '" fill="' + color + '"/>';
    else if (shape === 'triangle') s = '<polygon points="' + c + ',0.5 ' + (size - 0.5) + ',' + (size - 1) + ' 0.5,' + (size - 1) + '" fill="' + color + '"/>';
    else s = '<polygon points="' + c + ',0 ' + size + ',' + c + ' ' + c + ',' + size + ' 0,' + c + '" fill="' + color + '"/>';
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' + s + '</svg>';
  }
  function tbl(cols, rows, caption) {
    return '<div class="tblwrap"><table class="tbl">' +
      '<thead><tr>' + cols.map(function (c) { return '<th' + (c.num ? ' style="text-align:right"' : '') + '>' + esc(c.t) + '</th>'; }).join('') + '</tr></thead>' +
      '<tbody>' + rows.join('') + '</tbody>' +
      (caption ? '<caption>' + caption + '</caption>' : '') + '</table></div>';
  }
  function empty(title, msg) {
    return '<div class="empty"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg><b>' + esc(title) + '</b><span>' + esc(msg) + '</span></div>';
  }
  function simTag() { return '<span class="sim">simulated</span>'; }

  /* ====================================================================
     1. COMMAND DECK — the one screen the decision is made on
     ================================================================== */
  function deck() {
    var S = ENG.STATE, d = ENG.deficit();
    var augs = ENG.augmentations().filter(function (a) { return a.delta > 0; });
    var closeable = augs.filter(function (a) { return a.leadHrs <= 6; }).reduce(function (t, a) { return t + a.delta; }, 0);
    var residual = Math.max(0, d.capacityDeficit - closeable);
    var stranded = S.plan.unmet.length;

    var ok = d.capacityDeficit === 0;
    var clock =
      '<div class="clock' + (ok ? ' ok' : '') + '">' +
        '<div><div class="lbl">Capacity deficit</div><div class="big">' + n(d.capacityDeficit) + '</div>' +
        '<div class="sub">people with a relocation need and no reachable, qualified place to go. ' +
        stranded + ' habitation' + (stranded === 1 ? '' : 's') + ' affected.</div></div>' +
        '<div class="rule"></div>' +
        '<div class="brk">' +
          '<div><div class="k">Shelter need</div><div class="v">' + n(d.demand) + '</div><div class="n">of ' + n(SIM.habitations.reduce(function (t, h) { return t + h.pop; }, 0)) + ' residents</div></div>' +
          '<div><div class="k">Placed</div><div class="v">' + n(d.placed) + '</div><div class="n">across ' + S.plan.assignments.length + ' allocations</div></div>' +
          '<div><div class="k">Closeable ≤6 h</div><div class="v">' + n(closeable) + '</div><div class="n">by lifting binding constraints</div></div>' +
          '<div><div class="k">Residual</div><div class="v">' + n(residual) + '</div><div class="n">' + (residual > 0 ? 'needs inter-district transfer' : 'no escalation required') + '</div></div>' +
        '</div>' +
        '<div class="act">' +
          (residual > 0
            ? '<button class="esc" data-act="escalate">Escalate ' + n(residual) + ' to State EOC</button>'
            : '<button class="esc" style="background:#1B7F3B" data-act="escalate">Confirm no escalation</button>') +
          '<span style="font-size:10.5px;color:#93A9C4">Window to next impact <b class="m" style="color:#fff">' + d1(d.windowHrs) + ' h</b> · fleet <b class="m" style="color:#fff">' + n(d.rate) + '/hr</b></span>' +
        '</div>' +
      '</div>';

    var top = S.habs.slice(0, 6).map(function (h) {
      var placed = S.plan.assignments.filter(function (a) { return a.habId === h.id; });
      var got = placed.reduce(function (t, a) { return t + a.persons; }, 0);
      var short = h.demand.shelterNeed - got;
      return '<tr data-hab="' + h.id + '">' +
        '<td>' + swatch(ENG.priority(h.RUI.score).shape, ENG.priority(h.RUI.score).color) + ' <b>' + esc(h.name) + '</b><div class="mini">' + esc(h.HEI.dominant.label) + ' · ' + esc(blockName(h.block)) + '</div></td>' +
        '<td class="num"><b>' + Math.round(h.RUI.score) + '</b></td>' +
        '<td>' + pillFor(h.RUI.score) + '</td>' +
        '<td class="num">' + n(h.demand.shelterNeed) + '</td>' +
        '<td>' + (placed.length ? placed.map(function (a) { return '<div class="mini">' + n(a.persons) + ' → ' + esc(a.siteName.replace(/,.*$/, '')) + '</div>'; }).join('') : '<span class="mini">—</span>') + '</td>' +
        '<td class="num">' + (short > 0 ? '<b style="color:#B3261E">' + n(short) + '</b>' : '<span style="color:#1B7F3B">0</span>') + '</td>' +
        '<td><button class="rowbtn" data-open="hab" data-id="' + h.id + '">Open</button></td>' +
        '</tr>';
    });

    var body =
      clock +
      freshness() +
      (d.ongoingEvents.length ? note('r', '<b>' + d.ongoingEvents.length + ' hazard(s) already impacting.</b> ' +
        d.ongoingEvents.map(function (e) { return esc(e.name); }).join('; ') +
        '. Movement in these areas runs under exposure — time pressure for the affected habitations is pinned at maximum rather than counted down.') : '') +
      '<div class="maprow">' + mapPanel('tall', true) + '</div>' +
      card('Highest relocation urgency', 'Ranked by RUI — hazard and vulnerability, amplified by time and by how little room is left',
        tbl([{ t: 'Habitation' }, { t: 'RUI', num: 1 }, { t: 'Priority' }, { t: 'Shelter need', num: 1 }, { t: 'Allocated to' }, { t: 'Unplaced', num: 1 }, { t: '' }],
          top, 'Six of ' + S.habs.length + ' habitations. ' + simTag() + ' Open the full list on Red Zones.'),
        '<button class="btn sm" data-nav="zones">All ' + S.habs.length + ' habitations</button>', true);

    return page('District Deck',
      'One screen: which habitations are red, whether there is anywhere to put their people, and what has to happen in the next ' + d1(d.windowHrs) + ' hours.',
      body,
      '<button class="btn" data-act="recompute">Recompute</button>' +
      '<button class="btn pri" data-act="wizard">Issue relocation orders</button>');
  }

  /* The map has two levels. India is the default, because the first question a
     state or national officer asks is "where", and the district view answers a
     question they have not asked yet. Drilling into the one district with a
     connected feed is what shows the difference between a declared number and
     a derived one. */
  function zoomControls(extra) {
    return '<div class="ov ov-br">' + (extra || '') +
      '<button class="mapbtn" data-zoom="in" title="Zoom in" aria-label="Zoom in">+</button>' +
      '<button class="mapbtn" data-zoom="out" title="Zoom out" aria-label="Zoom out">−</button>' +
      '<button class="mapbtn" data-zoom="reset" title="Reset view" aria-label="Reset view">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5"/></svg></button>' +
      '<button class="mapbtn" data-act="mapfull" title="Full screen map" aria-label="Toggle full screen map" aria-pressed="' + (APP.mapFull ? 'true' : 'false') + '">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg></button>' +
      '<span class="zoomlbl m" data-zoomlabel>100%</span></div>';
  }
  function mapHint() {
    return '<div class="ov ov-tc">Scroll to zoom · drag to pan · hover for figures · double-click to zoom out</div>';
  }

  function mapPanel(size, withRail) {
    var cls = 'mapbox ' + (size || 'tall') + (withRail && !ENG.STATE.railOff ? '' : ' norail');
    var inner = APP.mapLevel === 'district'
      ? MAP.render({ focusHab: APP.mapFocus }) + mapOverlays()
      : NAT.render() + nationalOverlays();
    var rail = withRail
      ? (ENG.STATE.railOff
          ? '<button class="mapbtn railtog" data-act="rail" title="Show timeline" aria-label="Show timeline">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></button>'
          : timelineRail(true))
      : '';
    return '<div class="' + cls + '" id="mapbox">' + inner + rail + '</div>';
  }

  function nationalOverlays() {
    var sm = NAT.summary();
    var home = NAT.byId(SIM.homeState);
    var legend = [
      { s: 'diamond', c: '#B3261E', l: 'Critical', r: '85–100' },
      { s: 'triangle', c: '#D2551A', l: 'High', r: '60–84' },
      { s: 'square', c: '#C98A16', l: 'Medium', r: '30–59' },
      { s: 'circle', c: '#1B7F3B', l: 'Low', r: '0–29' }
    ].map(function (x) {
      return '<div class="lgrow"><span class="sw">' + swatch(x.s, x.c, 11) + '</span>' + x.l + '<span class="rg">' + x.r + '</span></div>';
    }).join('');

    return '' +
      '<div class="ov ov-tl"><div class="crumb"><b>India</b><span>›</span>' +
        '<span>' + sm.states + ' states with declared events</span><span>›</span>' +
        '<button data-map="drill">' + esc(home ? home.name : 'home state') + ' — open district</button></div></div>' +
      '<div class="ov ov-tl2"><h5>Feed status</h5><div class="ovb">' +
        '<div class="natkey"><span class="sw" style="background:#F3C9C4;border:2px solid #12447E"></span><b style="color:#12447E">Derived</b> — district feed connected</div>' +
        '<div class="natkey"><span class="sw declared-hatch"></span>Declared only — not computed</div>' +
        '<div class="natkey"><span class="sw" style="background:#D7EADD"></span>No declared event</div>' +
        '<div class="lgnote" style="border:none;padding:6px 0 0">' + sm.connected + ' of ' + sm.states +
        ' reporting states has a district feed. Everywhere else the figure is what the state declared, ' +
        'and this system has not verified it.</div>' +
      '</div></div>' +
      '<div class="ov ov-bl"><h5>Declared severity</h5><div class="ovb">' + legend + '</div>' +
        '<div class="lgnote">Shape encodes severity alongside colour — colour-blind safe. Score always shown.</div></div>' +
      zoomControls('<button class="mapbtn" data-map="drill" title="Open the connected district" aria-label="Open the connected district"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/></svg></button>') +
      mapHint() +
      '<div class="ov ov-bc">Simulated national picture · state boundaries illustrative, not authoritative</div>';
  }

  function blockName(id) {
    var b = SIM.district.blocks.filter(function (x) { return x.id === id; })[0];
    return b ? b.name : id;
  }

  function mapOverlays() {
    var S = ENG.STATE;
    var active = SIM.events.length;
    var lyr = Object.keys(MAP.LAYERS).map(function (k) {
      return '<label class="lyr"><input type="checkbox" data-layer="' + k + '"' + (MAP.LAYERS[k].on ? ' checked' : '') + '> ' + esc(MAP.LAYERS[k].label) + '</label>';
    }).join('');
    var legend = [
      { s: 'diamond', c: '#B3261E', l: 'Critical', r: '85–100' },
      { s: 'triangle', c: '#D2551A', l: 'High', r: '60–84' },
      { s: 'square', c: '#C98A16', l: 'Medium', r: '30–59' },
      { s: 'circle', c: '#1B7F3B', l: 'Low', r: '0–29' }
    ].map(function (x) {
      return '<div class="lgrow"><span class="sw">' + swatch(x.s, x.c, 11) + '</span>' + x.l + '<span class="rg">' + x.r + '</span></div>';
    }).join('');

    return '' +
      '<div class="ov ov-tl"><div class="crumb"><button data-map="india">India</button><span>›</span><button data-map="india">' + esc((NAT.byId(SIM.homeState) || {}).name || 'State') + '</button><span>›</span><b>' + esc(SIM.district.name) + '</b><span>·</span><span>' + active + ' declared events</span></div></div>' +
      '<div class="ov ov-tl2"><h5>Map layers</h5><div class="ovb">' + lyr + '</div></div>' +
      '<div class="ov ov-bl"><h5>Relocation urgency</h5><div class="ovb">' + legend +
        '<div class="lgrow" style="margin-top:4px"><span class="sw"><svg width="13" height="13" viewBox="0 0 13 13"><circle cx="6.5" cy="6.5" r="5" fill="none" stroke="#B3261E" stroke-width="1.6" stroke-dasharray="2.5 2"/></svg></span>Unplaced population</div>' +
        '<div class="lgrow"><span class="sw"><svg width="13" height="13" viewBox="0 0 13 13"><rect x="1.5" y="1.5" width="10" height="10" fill="none" stroke="#1B7F3B" stroke-width="1.8"/><rect x="1.5" y="7" width="10" height="4.5" fill="#1B7F3B" opacity=".7"/></svg></span>Safe site · fill = committed</div>' +
      '</div><div class="lgnote">Shape encodes priority alongside colour — colour-blind safe. Score always shown.</div></div>' +
      zoomControls(
        '<button class="mapbtn" data-map="critical" title="Focus most critical" aria-label="Focus the most critical habitation"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></button>' +
        '<button class="mapbtn" data-map="emergency" title="Emergency mode" aria-label="Toggle emergency mode" aria-pressed="false"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3 9 16H3z"/><path d="M12 9v4M12 16h.01"/></svg></button>') +
      mapHint() +
      '<div class="ov ov-bc">Simulated prediction layer — illustrative locations, not exact GPS positions</div>';
  }

  function timelineRail(overlay) {
    var S = ENG.STATE;
    var items = [];
    SIM.events.forEach(function (e) {
      items.push({ k: e.severity === 'critical' ? 'crit' : 'high', t: e.impactInHrs > 0 ? 'T−' + d1(e.impactInHrs) + ' h' : 'ongoing',
        x: e.name, m: e.note, kind: 'Event' });
    });
    S.plan.unmet.slice(0, 4).forEach(function (u) {
      items.push({ k: 'crit', t: 'now', x: n(u.persons) + ' unplaced at ' + u.habName, m: u.reason, kind: 'Deficit' });
    });
    S.sites.filter(function (s) { return s.cap.disqualified; }).forEach(function (s) {
      items.push({ k: 'crit', t: 'auto', x: s.name + ' disqualified', m: 'Site HEI ' + d1(s.cap.hei) + ' — the shelter itself stands in a red zone.', kind: 'Capacity' });
    });
    S.sites.filter(function (s) { return !s.cap.disqualified && s.cap.overstatement > 200; })
      .slice(0, 3).forEach(function (s) {
        items.push({ k: 'high', t: 'auto', x: s.name + ' overstated by ' + n(s.cap.overstatement), m: 'Register says ' + n(s.claimed) + '; ' + s.cap.binding.label.toLowerCase() + ' caps it at ' + n(s.cap.capacity) + '.', kind: 'Capacity' });
      });
    SIM.reports.slice(0, 4).forEach(function (r) {
      items.push({ k: r.status === 'verified' ? 'ok' : 'med', t: r.at, x: r.text, m: r.by + ' · ' + r.status, kind: 'Report' });
    });

    var feed = items.map(function (i) {
      return '<div class="fev ' + i.k + '" data-kind="' + i.kind + '"><div class="ft">' + esc(i.t) + ' · ' + esc(i.kind) + '</div>' +
        '<div class="fx">' + esc(i.x) + '</div><div class="fm">' + esc(i.m) + '</div></div>';
    }).join('');

    var chips = ['All', 'Event', 'Deficit', 'Capacity', 'Report'].map(function (c, i) {
      return '<button class="fchip" data-filter="' + c + '" aria-pressed="' + (i === 0) + '">' + c + '</button>';
    }).join('');

    /* Docked into the map rather than beside it. On a GIS product the map is
       the work surface, so the feed collapses to a tab and gives its width
       back the moment it is not being read. */
    var shut = ENG.STATE.railShut;
    return '<div class="ov ov-rail' + (shut ? ' shut' : '') + '" id="rail">' +
      '<div class="railh"><span class="live"></span><h3>Live operations</h3>' +
      '<span class="mini">' + items.length + '</span>' +
      '<button class="railx" data-act="rail" title="' + (shut ? 'Show the timeline' : 'Collapse the timeline') +
      '" aria-label="' + (shut ? 'Show the timeline' : 'Collapse the timeline') + '" aria-expanded="' + (!shut) + '">' +
      (shut ? '\u2039' : '\u203a') + '</button></div>' +
      '<div class="railf">' + chips + '</div><div class="feed" id="feed">' + feed + '</div></div>';
  }

  /* ====================================================================
     2. RED ZONES
     ================================================================== */
  function zones() {
    var S = ENG.STATE;
    var crit = S.habs.filter(function (h) { return h.RUI.score >= 85; });
    var high = S.habs.filter(function (h) { return h.RUI.score >= 60 && h.RUI.score < 85; });
    var popRed = S.habs.filter(function (h) { return h.RUI.score >= 60; }).reduce(function (t, h) { return t + h.pop; }, 0);

    var tiles = '<div class="tiles">' +
      tile('Critical habitations', crit.length, 'RUI 85+ · ' + n(crit.reduce(function (t, h) { return t + h.pop; }, 0)) + ' residents', 'crit') +
      tile('High', high.length, 'RUI 60–84', 'warn') +
      tile('Population in a red zone', n(popRed), 'of ' + n(SIM.habitations.reduce(function (t, h) { return t + h.pop; }, 0)) + ' district-wide') +
      tile('Multi-hazard', S.habs.filter(function (h) { return h.HEI.parts.filter(function (p) { return p.v > 25; }).length > 1; }).length,
        'exposed to two or more live hazards', 'inf') +
      '</div>';

    var rows = S.habs.map(function (h) {
      var pr = ENG.priority(h.RUI.score);
      var second = h.HEI.parts.slice().sort(function (a, b) { return b.v - a.v; })[1];
      return '<tr>' +
        '<td class="m">' + esc(h.id) + '</td>' +
        '<td>' + swatch(pr.shape, pr.color) + ' <b>' + esc(h.name) + '</b></td>' +
        '<td>' + esc(blockName(h.block)) + '</td>' +
        '<td class="num">' + n(h.pop) + '</td>' +
        '<td>' + esc(h.HEI.dominant.label) + '<div class="mini">' + (second && second.v > 15 ? '+ ' + esc(second.label) + ' ' + Math.round(second.v) : 'single hazard') + '</div></td>' +
        '<td class="num">' + Math.round(h.HEI.score) + '</td>' +
        '<td class="num">' + Math.round(h.VCI.score) + '</td>' +
        '<td class="num">' + Math.round(h.RUI.stress.score) + '</td>' +
        '<td class="num"><b>' + Math.round(h.RUI.score) + '</b></td>' +
        '<td>' + pill(pr.k, pr.label) + '</td>' +
        '<td><button class="rowbtn" data-open="hab" data-id="' + h.id + '">Why</button></td>' +
        '</tr>';
    });

    var body = tiles +
      why('Why this is not a hazard map',
        '<p>A habitation is red when four things combine: the hazard on it, the population standing in it, the time left, ' +
        'and whether there is anywhere to put its people. Two habitations under identical flood depth rank differently if ' +
        'one has a shelter with room and the other does not.</p>' +
        '<p>A red zone means elevated modelled risk. It is not proof that every point inside it is unsafe, and it is not ' +
        'an evacuation order. Every score opens to its full derivation.</p>') +
      card('Habitation register — derived scores', SIM.district.name + ' district',
        tbl([{ t: 'ID' }, { t: 'Habitation' }, { t: 'Block' }, { t: 'Population', num: 1 }, { t: 'Dominant hazard' },
             { t: 'HEI', num: 1 }, { t: 'VCI', num: 1 }, { t: 'Cap. stress', num: 1 }, { t: 'RUI', num: 1 }, { t: 'Priority' }, { t: '' }],
          rows, 'HEI hazard exposure · VCI vulnerability &amp; capability · Cap. stress how little reachable capacity remains · RUI relocation urgency. ' + simTag()),
        '', true);

    return page('Red Zones',
      'Hazard-based identification of habitations that must be relocated, and the order in which they must be relocated.',
      body,
      '<button class="btn" data-act="method">Method</button><button class="btn" data-act="export-zones">Export CSV</button>');
  }

  /* ====================================================================
     3. CARRYING CAPACITY — the ledger
     ================================================================== */
  function capacityView() {
    var S = ENG.STATE, d = ENG.deficit();
    var dq = S.sites.filter(function (s) { return s.cap.disqualified; });
    var overstated = d.claimedTotal - d.realTotal;

    var tiles = '<div class="tiles">' +
      tile('On the register', n(d.claimedTotal), S.sites.length + ' designated and contingency sites') +
      tile('Actually available', n(d.realTotal), 'after five binding ceilings', 'inf') +
      tile('Overstatement', n(overstated), pc(overstated / d.claimedTotal) + ' of the register', 'crit') +
      tile('Committed', n(d.totalCommitted), n(d.residualNow) + ' places still free', d.residualNow > 0 ? 'ok' : 'warn') +
      '</div>';

    var rows = S.sites.map(function (s) {
      var c = s.cap;
      var fill = s.usableTotal > 0 ? s.committed / s.usableTotal : 0;
      return '<tr' + (c.disqualified ? ' class="dq"' : '') + '>' +
        '<td class="m">' + esc(s.id) + '</td>' +
        '<td><b>' + esc(s.name) + '</b><div class="mini">' + esc(s.type) + ' · tier ' + s.tier + ' · ' + esc(blockName(s.block)) + '</div></td>' +
        '<td class="num">' + n(s.claimed) + '</td>' +
        '<td class="num">' + (c.disqualified ? '<b style="color:#B3261E">0</b>' : '<b>' + n(c.capacity) + '</b>') + '</td>' +
        '<td>' + (c.disqualified
          ? '<span style="color:#B3261E;font-weight:600">Site in a red zone</span><div class="mini">HEI ' + d1(c.hei) + ' ≥ cutoff ' + S.standards.siteHeiCutoff + '</div>'
          : esc(c.binding.label) + '<div class="mini">' + esc(c.binding.basis) + '</div>') + '</td>' +
        '<td class="num">' + n(s.usableTotal) + '</td>' +
        '<td class="num">' + n(s.committed) + '</td>' +
        '<td class="num">' + (c.disqualified ? '—' : n(s.residual)) + '</td>' +
        '<td>' + (c.disqualified ? pill('crit', 'Disqualified')
          : fill >= 0.999 ? pill('warn', 'Full') : fill > 0 ? pill('inf', Math.round(fill * 100) + '% held') : pill('low', 'Open')) + '</td>' +
        '<td><button class="rowbtn" data-open="site" data-id="' + s.id + '">Ceilings</button></td>' +
        '</tr>';
    });

    var body = tiles +
      note('r', '<b>The register overstates capacity by ' + n(overstated) + ' places (' + pc(overstated / d.claimedTotal) + ').</b>' +
        (dq.length ? ' ' + dq.length + ' registered site' + (dq.length === 1 ? '' : 's') + ' stand' + (dq.length === 1 ? 's' : '') +
          ' inside a red zone and carry no capacity at all.' : '')) +
      why('How the five ceilings work',
        '<p>The claimed figure on a shelter register is almost always the floor-area number with nothing else checked. ' +
        'Capacity here is the minimum of five independent ceilings — floor area, water, sanitation, the site\'s own hazard ' +
        'exposure, and what its approach road can deliver before impact.</p>' +
        '<p>Planning against the register instead of against the ceilings is how a shelter ends up holding four times the ' +
        'people it can water.</p>') +
      card('Safe-site capacity ledger', 'capacity = min(area, water, sanitation, structural safety, corridor throughput)',
        tbl([{ t: 'ID' }, { t: 'Safe site' }, { t: 'Claimed', num: 1 }, { t: 'Derived', num: 1 }, { t: 'Binding constraint' },
             { t: 'Usable', num: 1 }, { t: 'Committed', num: 1 }, { t: 'Residual', num: 1 }, { t: 'State' }, { t: '' }],
          rows, 'Usable = derived capacity less the ' + pc(S.standards.surgeBuffer) + ' surge reserve held for unregistered arrivals, plus any posted augmentation. ' + simTag()),
        '<button class="btn sm" data-act="standards">Planning standards</button>', true) +
      augmentationCard();

    return page('Carrying Capacity',
      'What each safe site can actually take — and which single constraint is deciding that number.',
      body,
      '<button class="btn" data-act="export-sites">Export CSV</button>');
  }

  function augmentationCard() {
    var augs = ENG.augmentations();
    var real = augs.filter(function (a) { return a.delta > 0; });
    if (!real.length) return '';
    var rows = real.map(function (a) {
      return '<tr>' +
        '<td><b>' + esc(a.title) + '</b><div class="mini">' + esc(a.detail) + '</div></td>' +
        '<td>' + esc(a.siteName) + '</td>' +
        '<td class="num"><b style="color:#1B7F3B">+' + n(a.delta) + '</b></td>' +
        '<td class="num">' + a.leadHrs + ' h</td>' +
        '<td class="m">' + esc(a.cost) + '</td>' +
        '<td><button class="rowbtn" data-act="augment" data-id="' + esc(a.id) + '">Post</button></td>' +
        '</tr>';
    });
    var total = real.reduce(function (t, a) { return t + a.delta; }, 0);
    return card('Closing the gap — what the binding constraints cost to lift',
      '+' + n(total) + ' places available',
      tbl([{ t: 'Intervention' }, { t: 'Site' }, { t: 'Capacity gained', num: 1 }, { t: 'Lead', num: 1 }, { t: 'Indicative cost' }, { t: '' }],
        rows, 'Each row relieves one binding constraint and re-derives the site up to its next ceiling. Posting an augmentation writes an AUGMENT entry to the ledger. ' + simTag()),
      '', true);
  }

  /* ====================================================================
     4. RELOCATION QUEUE
     ================================================================== */
  function queue() {
    var S = ENG.STATE;
    var rows = [];
    S.habs.forEach(function (h) {
      if (h.demand.shelterNeed <= 0) return;
      var as = S.plan.assignments.filter(function (a) { return a.habId === h.id; });
      var got = as.reduce(function (t, a) { return t + a.persons; }, 0);
      var short = h.demand.shelterNeed - got;
      var pr = ENG.priority(h.RUI.score);
      var w = ENG.windowInfo(h);
      rows.push('<tr>' +
        '<td class="num">' + (rows.length + 1) + '</td>' +
        '<td>' + swatch(pr.shape, pr.color) + ' <b>' + esc(h.name) + '</b><div class="mini">' + esc(h.id) + ' · ' + esc(blockName(h.block)) + '</div></td>' +
        '<td class="num"><b>' + Math.round(h.RUI.score) + '</b></td>' +
        '<td class="num">' + n(h.demand.mustMove) + '</td>' +
        '<td class="num">' + n(h.demand.shelterNeed) + '</td>' +
        '<td class="num">' + n(h.demand.highDependency) + '</td>' +
        '<td>' + (as.length
          ? as.map(function (a) { return '<div>' + n(a.persons) + ' → <b>' + esc(a.siteName.replace(/,.*$/, '')) + '</b> <span class="mini m">' + Math.round(a.travelMin) + ' min</span></div>'; }).join('')
          : '<span style="color:#B3261E;font-weight:600">nowhere</span>') + '</td>' +
        '<td class="num">' + (short > 0 ? '<b style="color:#B3261E">' + n(short) + '</b>' : '0') + '</td>' +
        '<td>' + (w.ongoing ? pill('crit', 'ongoing') : '<span class="m">T−' + d1(w.hrs) + ' h</span>') + '</td>' +
        '<td><button class="rowbtn" data-open="hab" data-id="' + h.id + '">Detail</button></td>' +
        '</tr>');
    });

    var totalShort = S.plan.unmetTotal;
    var body =
      note(totalShort > 0 ? 'r' : 'g', totalShort > 0
        ? '<b>' + n(totalShort) + ' people in the queue have no allocated place.</b> No order will be issued for them.'
        : '<b>Every person in the queue has a debited place.</b> No orphan orders.') +
      (totalShort > 0 ? why('Why the system refuses rather than issues optimistically',
        '<p>An order without a debited allocation is an instruction to walk somewhere that may already be full. ' +
        'The wizard\'s final step disables itself and says so. The remainder stays on the escalation list.</p>') : '') +
      card('Relocation queue', 'ordered by urgency, not by block or by convenience',
        tbl([{ t: '#', num: 1 }, { t: 'Habitation' }, { t: 'RUI', num: 1 }, { t: 'Must move', num: 1 }, { t: 'Shelter need', num: 1 },
             { t: 'High-dependency', num: 1 }, { t: 'Allocated to' }, { t: 'Unplaced', num: 1 }, { t: 'Window' }, { t: '' }],
          rows, 'Must move = population × evacuation fraction from HEI. Shelter need = of those, the share that cannot self-host, from VCI. ' + simTag()),
        '', true);

    return page('Relocation Queue',
      'Who must be moved, how urgently, and to exactly which site — with the people who have nowhere to go named rather than averaged away.',
      body,
      '<button class="btn" data-act="export-queue">Export CSV</button>' +
      '<button class="btn pri" data-act="wizard">Issue orders</button>');
  }

  /* ====================================================================
     5. MATCHING ENGINE
     ================================================================== */
  function engineView() {
    var S = ENG.STATE, p = S.plan;
    var rows = p.assignments.slice().sort(function (a, b) { return b.rui - a.rui; }).map(function (a) {
      var hb = S.habs.filter(function (x) { return x.id === a.habId; })[0];
      var st = S.sites.filter(function (x) { return x.id === a.siteId; })[0];
      var cor = SIM.corridors.filter(function (c) { return c.id === a.corridor; })[0];
      return '<tr>' +
        '<td>' + esc(a.habName) + '<div class="mini m">' + esc(a.habId) + '</div></td>' +
        '<td>' + esc(a.siteName) + '<div class="mini m">' + esc(a.siteId) + '</div></td>' +
        '<td class="num">' + n(a.persons) + '</td>' +
        '<td class="num">' + Math.round(a.travelMin) + '</td>' +
        '<td>' + esc(cor ? cor.name : '—') + '<div class="mini">hazard ' + (cor ? d1(cor.hazard * 100) : '—') + '</div></td>' +
        '<td class="num">' + d1(st.cap.hei) + '</td>' +
        '<td class="num">' + (a.highDep > 0 ? (st.beds > 0 ? '<span style="color:#1B7F3B">' + n(a.highDep) + ' ✓</span>' : '<span style="color:#B3261E">' + n(a.highDep) + ' ✗</span>') : '—') + '</td>' +
        '<td class="num">' + d1(a.cost) + '</td>' +
        '<td><button class="rowbtn" data-open="assign" data-id="' + esc(a.habId + '|' + a.siteId) + '">Why here</button></td>' +
        '</tr>';
    });

    var unmet = p.unmet.map(function (u) {
      return '<tr><td><b>' + esc(u.habName) + '</b><div class="mini m">' + esc(u.habId) + '</div></td>' +
        '<td class="num"><b style="color:#B3261E">' + n(u.persons) + '</b></td>' +
        '<td class="num">' + Math.round(u.rui) + '</td>' +
        '<td>' + esc(u.reason) + '</td></tr>';
    });

    var W = ENG.COST_W;
    var body =
      '<div class="tiles">' +
        tile('Allocations', p.assignments.length, 'covering ' + n(p.placed) + ' people') +
        tile('Unplaced', n(p.unmetTotal), p.unmet.length + ' habitations', p.unmetTotal > 0 ? 'crit' : 'ok') +
        tile('Improving swaps', p.improvedSwaps, 'accepted in the local pass') +
        tile('Total plan cost', d1(p.cost), 'weighted units, lower is better', 'inf') +
      '</div>' +
      '<div class="split">' +
        card('The cost function', 'what the solver is actually minimising',
          '<div class="formula">cost(habitation, site) =\n' +
          '  ' + W.travel.toFixed(1) + ' × travel_minutes\n' +
          '+ ' + W.corridor + '   × corridor_hazard        (0–1)\n' +
          '+ ' + W.siteHei + '   × site_HEI / 100\n' +
          '+ ' + W.medMismatch + '   × medical_mismatch       (0 | 1)\n' +
          '+ ' + W.tier + '    × (site_tier − 1)\n' +
          '+ ' + W.split + '   × community_split_penalty</div>' +
          '<div class="mini" style="margin-top:9px">Infinite — the pair is refused outright — when the site is disqualified, ' +
          'when its corridor is cut, or when the leg cannot be completed inside the habitation\'s own warning window. ' +
          'Refusing is safer than assigning a place that cannot be reached in time.</div>') +
        card('How the assignment is built', 'deterministic — the same inputs always give the same plan',
          '<ol style="margin:0;padding-left:18px;font-size:12.5px;color:#48586E;line-height:1.65">' +
          '<li>Habitations are ordered by RUI, so the most urgent choose first.</li>' +
          '<li>Each takes the lowest-cost site with residual capacity, splitting across at most three sites.</li>' +
          '<li>Each allocation immediately debits that site, so nothing is promised twice.</li>' +
          '<li>A bounded local pass swaps pairs of allocations wherever the swap strictly lowers total cost and both capacities still hold.</li>' +
          '<li>Anything that cannot be placed is recorded by name with the reason, never absorbed into a total.</li>' +
          '</ol>') +
      '</div>' +
      card('Assignments', p.assignments.length + ' allocations',
        tbl([{ t: 'From' }, { t: 'To' }, { t: 'People', num: 1 }, { t: 'Travel min', num: 1 }, { t: 'Corridor' },
             { t: 'Site HEI', num: 1 }, { t: 'High-dep.', num: 1 }, { t: 'Cost', num: 1 }, { t: '' }],
          rows, 'High-dependency evacuees are matched to a site with staffed beds where one is reachable; ✗ marks a mismatch the solver could not avoid. ' + simTag()),
        '', true) +
      (unmet.length ? card('Refused — no backing capacity', n(p.unmetTotal) + ' people',
        tbl([{ t: 'Habitation' }, { t: 'People', num: 1 }, { t: 'RUI', num: 1 }, { t: 'Why the engine refused' }], unmet,
          'These are the rows a system that reported only a district total would have hidden.'), '', true) : '');

    return page('Matching Engine',
      'The capacity-constrained assignment from red zones to safe sites — and, for every row, why that site and not another.',
      body,
      '<button class="btn" data-act="resolve">Re-run solver</button>' +
      '<button class="btn pri" data-act="commit">Commit plan to ledger</button>');
  }

  /* ====================================================================
     6. MOVEMENT & CONVOYS
     ================================================================== */
  function convoys() {
    var S = ENG.STATE, d = ENG.deficit();
    var rows = SIM.assets.map(function (a) {
      var perHr = (a.perTrip / a.cycleMin) * 60;
      return '<tr>' +
        '<td class="m">' + esc(a.id) + '</td>' +
        '<td><b>' + esc(a.name) + '</b><div class="mini">' + esc(a.kind) + ' · ' + esc(a.terrain) + ' terrain</div></td>' +
        '<td class="num">' + n(a.perTrip) + '</td>' +
        '<td class="num">' + a.cycleMin + '</td>' +
        '<td class="num"><b>' + n(perHr) + '</b></td>' +
        '<td class="num">' + n(perHr * d.windowHrs) + '</td>' +
        '<td>' + (a.status === 'available' ? pill('low', 'Available') : pill('off', 'Standby')) + '</td>' +
        '</tr>';
    });

    var orders = (S.orders || []);
    var orderRows = orders.slice(0, 40).map(function (o) {
      return '<tr>' +
        '<td class="m">' + esc(o.id) + '</td>' +
        '<td>' + esc(o.habName) + '</td>' +
        '<td>' + esc(o.siteName) + '</td>' +
        '<td class="num">' + n(o.persons) + '</td>' +
        '<td class="num">' + Math.round(o.travelMin) + '</td>' +
        '<td class="num">' + Math.round(o.rui) + '</td>' +
        '<td class="m">' + esc(o.issuedBy) + '</td>' +
        '<td>' + pill('inf', o.status) + '</td>' +
        '</tr>';
    });

    var body =
      '<div class="tiles">' +
        tile('Fleet rate', n(d.rate) + '/hr', 'across ' + SIM.assets.filter(function (a) { return a.status === 'available'; }).length + ' available units') +
        tile('Window', d1(d.windowHrs) + ' h', 'to the next hazard impact', 'warn') +
        tile('Moveable in window', n(d.moveableInWindow), 'at the current rate', 'inf') +
        tile('Movement deficit', n(d.movementDeficit), d.movementDeficit > 0 ? 'placed but not reachable in time' : 'the fleet can finish', d.movementDeficit > 0 ? 'crit' : 'ok') +
      '</div>' +
      note(d.movementDeficit > 0 ? 'r' : 'g',
        d.movementDeficit > 0
          ? '<b>Capacity and movement are different shortages.</b> ' + n(d.movementDeficit) + ' people have a place held for them that the fleet cannot physically reach in ' + d1(d.windowHrs) + ' hours. Opening more shelters does not fix this; more lift does.'
          : '<b>The fleet can complete every committed movement inside the window.</b> ' + n(d.moveableInWindow) + ' movement capacity against ' + n(d.placed) + ' placed.') +
      card('Movement assets', 'simulated fleet',
        tbl([{ t: 'ID' }, { t: 'Asset' }, { t: 'Seats/trip', num: 1 }, { t: 'Cycle min', num: 1 }, { t: 'Persons/hr', num: 1 }, { t: 'In window', num: 1 }, { t: 'Status' }],
          rows, 'Cycle time is a full out-and-back including loading. ' + simTag()), '', true) +
      (orders.length
        ? card('Issued relocation orders', orders.length + ' orders',
            tbl([{ t: 'Order' }, { t: 'From' }, { t: 'To' }, { t: 'People', num: 1 }, { t: 'Travel min', num: 1 }, { t: 'RUI', num: 1 }, { t: 'Issued by' }, { t: 'Status' }],
              orderRows, 'Each order is backed by an ALLOC posting in the ledger. Invariant I3 fails loudly if that stops being true.'), '', true)
        : card('Issued relocation orders', 'none yet',
            empty('No orders issued', 'Commit a plan on the Matching Engine screen, or use the dispatch wizard (Ctrl D).')));

    return page('Movement & Convoys',
      'Whether the people who have somewhere to go can physically be taken there before the hazard lands.',
      body,
      '<button class="btn pri" data-act="wizard">Dispatch wizard</button>');
  }

  /* ====================================================================
     7. SCENARIO SANDBOX
     ================================================================== */
  function scenarios() {
    var cur = ENG.STATE.scenario;
    var cards = SIM.scenarios.map(function (s) {
      var on = s.id === cur;
      return '<div class="card" style="margin:0;' + (on ? 'border-color:#12447E;box-shadow:0 0 0 3px #E8EFF8' : '') + '">' +
        '<div class="card-h"><h3>' + esc(s.name) + '</h3>' + (on ? '<span class="r">' + pill('pri', 'active') + '</span>' : '') + '</div>' +
        '<div class="card-b"><div class="mini" style="min-height:46px;color:#48586E;font-size:12px">' + esc(s.desc) + '</div>' +
        '<button class="btn ' + (on ? '' : 'pri') + '" style="width:100%;margin-top:8px" data-act="scenario" data-id="' + s.id + '"' + (on ? ' disabled' : '') + '>' +
        (on ? 'Currently applied' : 'Apply and re-solve') + '</button></div></div>';
    }).join('');

    var d = ENG.deficit();
    var body =
      why('What a scenario actually changes',
        '<p>Each scenario perturbs the raw inputs — depths, plume fractions, ground motion, corridor status — and the whole ' +
        'chain re-derives: exposure, site capacity, reachability, urgency, assignment. Nothing is patched by hand.</p>' +
        '<p>A plan that only works in the baseline is not a plan.</p>') +
      '<div class="tiles">' +
        tile('Active scenario', esc((SIM.scenarios.filter(function (s) { return s.id === cur; })[0] || {}).name || '—'), 'all figures below are under this scenario', 'inf') +
        tile('Capacity deficit', n(d.capacityDeficit), 'people with nowhere reachable', d.capacityDeficit > 0 ? 'crit' : 'ok') +
        tile('Sites disqualified', d.disqualified.length, 'of ' + ENG.STATE.sites.length + ' on the register', d.disqualified.length ? 'warn' : 'ok') +
        tile('Usable capacity', n(d.totalUsable), 'after every ceiling and derate') +
      '</div>' +
      '<div class="split3" style="margin-bottom:12px">' + cards + '</div>' +
      card('Sensitivity sweep', 'each scenario evaluated independently',
        '<div class="charts">' + CHARTS.sensitivity(sweep()) + '</div>');

    return page('Scenario Sandbox',
      'What happens to the answer when the assumptions break.',
      body,
      '<button class="btn" data-act="scenario" data-id="SC-BASE">Reset to baseline</button>');
  }

  var _sweepCache = null;
  function sweep() {
    if (_sweepCache) return _sweepCache;
    var keep = ENG.STATE.scenario;
    var rows = SIM.scenarios.map(function (s) {
      ENG.setScenario(s.id);
      return { id: s.id, name: s.name, deficit: ENG.STATE.plan.unmetTotal };
    });
    ENG.setScenario(keep);
    _sweepCache = rows;
    return rows;
  }
  function clearSweep() { _sweepCache = null; }

  /* ====================================================================
     8. AUDIT LEDGER
     ================================================================== */
  function ledgerView() {
    var inv = ENG.invariants();
    var invRows = inv.map(function (i) {
      return '<tr><td class="m">' + esc(i.id) + '</td><td>' + esc(i.text) + '</td>' +
        '<td>' + (i.ok ? pill('low', 'holding') : pill('crit', 'violated')) + '</td>' +
        '<td class="mini">' + esc(i.detail) + '</td></tr>';
    });

    var L = ENG.ledger.slice().reverse();
    var rows = L.slice(0, 120).map(function (e) {
      var site = ENG.STATE.sites.filter(function (s) { return s.id === e.site; })[0];
      var hab = ENG.STATE.habs.filter(function (h) { return h.id === e.hab; })[0];
      return '<tr>' +
        '<td class="m">' + String(e.seq).padStart(4, '0') + '</td>' +
        '<td class="m">' + e.ts.toTimeString().slice(0, 8) + '</td>' +
        '<td>' + pill(e.type === 'ALLOC' ? 'pri' : e.type === 'RELEASE' ? 'off' : e.type === 'AUGMENT' ? 'low' : 'inf', e.type) + '</td>' +
        '<td>' + esc(site ? site.name : e.site || '—') + '</td>' +
        '<td>' + esc(hab ? hab.name : e.hab || '—') + '</td>' +
        '<td class="num ledger ' + (e.persons < 0 ? 'cr' : 'dr') + '">' + (e.persons > 0 ? '−' : '+') + n(Math.abs(e.persons)) + '</td>' +
        '<td class="m">' + esc(e.operator) + '</td>' +
        '<td class="mini">' + esc(e.reason) + '</td>' +
        '</tr>';
    });

    var body =
      why('Why capacity is an account rather than a label',
        '<p>Every commitment debits a site and credits a habitation, carrying the operator who made it. Nothing is ever ' +
        'deleted — a release is a compensating posting, so the history of a decision survives the decision being reversed.</p>' +
        '<p>That is what makes two officers physically unable to promise the same 500 places twice.</p>') +
      card('Invariants enforced in code', 'checked on every render, not asserted in copy',
        tbl([{ t: 'ID' }, { t: 'Rule' }, { t: 'State' }, { t: 'Detail' }], invRows), '', true) +
      card('Safe-capacity postings', ENG.ledger.length + ' entries',
        rows.length ? tbl([{ t: 'Seq' }, { t: 'Time' }, { t: 'Type' }, { t: 'Site' }, { t: 'Habitation' }, { t: 'Places', num: 1 }, { t: 'Operator' }, { t: 'Reason' }],
          rows, 'Negative postings are compensating entries. Times come from the real system clock in Asia/Kolkata, never a simulated counter.')
          : empty('The ledger is empty', 'Commit a plan on the Matching Engine screen to write the first postings.'), '', true);

    return page('Audit Ledger',
      'Double-entry accounting for safe capacity — append-only, attributed, and reconciled on every render.',
      body,
      '<button class="btn" data-act="export-ledger">Export JSON</button>');
  }

  /* ====================================================================
     8b. FIELD REPORTS — the operator side of citizen reporting
     --------------------------------------------------------------------
     The queue is ordered by CAPTURE, not by arrival. A citizen in a flood is
     the person most likely to have no signal, so the report describing the
     first wall to go can easily arrive after three describing what happened
     afterwards. Sorting by receipt would rebuild the event backwards.

     Verifying is a decision with a name on it, so it posts to the same ledger
     as a capacity commitment. Dismissing does too — a dismissal that leaves no
     trace is indistinguishable from nobody having looked.
     ================================================================== */
  function reportsView() {
    var all = REPORTS.byCapture();
    var unver = all.filter(function (r) { return r.status === 'unverified'; });
    var cit = all.filter(function (r) { return r.citizen; });

    function ago(r) {
      var h = REPORTS.capturedHoursAgo(r);
      if (h < 0.05) return 'now';
      if (h < 1) return Math.round(h * 60) + ' min ago';
      return d1(h) + ' h ago';
    }

    var rows = all.map(function (r) {
      var st = r.status === 'verified' ? pill('low', 'verified')
        : r.status === 'dismissed' ? pill('off', 'dismissed')
        : pill('med', 'unverified');
      var hab = (ENG.STATE.habs || []).filter(function (x) { return x.id === r.hab; })[0];
      var act = r.status === 'unverified'
        ? '<button class="btn sm" data-act="report-verify" data-id="' + esc(r.id) + '">Verify</button> ' +
          '<button class="btn sm" data-act="report-dismiss" data-id="' + esc(r.id) + '">Dismiss</button>'
        : '<span class="mini">' + esc(r.verifiedBy || '—') + (r.verifyNote ? ' · ' + esc(r.verifyNote) : '') + '</span>';
      return '<tr>' +
        '<td class="m">' + esc(r.id) + '</td>' +
        '<td class="mini">' + esc(ago(r)) + '</td>' +
        '<td>' + esc(hab ? hab.name : r.hab || '—') + '</td>' +
        '<td>' + esc(r.kindLabel || REPORTS.kindLabel(r.kind)) + '</td>' +
        '<td>' + esc(r.text) + (r.landmark ? '<div class="mini">near ' + esc(r.landmark) + '</div>' : '') +
          (r.persons != null ? '<div class="mini">' + n(r.persons) + ' people affected, as reported</div>' : '') + '</td>' +
        '<td class="mini">' + esc(r.by) + (r.contact ? '<div class="m">' + esc(r.contact) + '</div>' : '') + '</td>' +
        '<td>' + st + '</td>' +
        '<td>' + act + '</td>' +
        '</tr>';
    });

    var body =
      why('Why a report cannot move a number on its own',
        '<p>Everything on the other screens is derived from the district record. A citizen report is an ' +
        '<b>observation</b>, and it stays one until a named officer confirms it. Nothing in this queue changes ' +
        'exposure, capacity, urgency or the assignment.</p>' +
        '<p>That is not caution for its own sake. A system where anyone with a phone can move the numbers that ' +
        'decide who is evacuated first has an obvious attack — and in a real emergency it does not need an ' +
        'attacker, because panic and double-reporting do the same thing. Ten calls about one collapsed wall are ' +
        'one wall. So reports queue, and a person is accountable for each one that becomes true.</p>') +
      '<div class="tiles">' +
      tile('In queue', String(unver.length), unver.length ? 'awaiting an operator decision' : 'nothing waiting', unver.length ? 'crit' : '') +
      tile('From citizens', String(cit.length), 'submitted through the public view') +
      tile('Total held', String(all.length), 'ordered by capture, not by arrival') +
      '</div>' +
      card('Report queue', all.length + ' held · most recent observation first',
        rows.length
          ? tbl([{ t: 'Ref' }, { t: 'Seen' }, { t: 'Habitation' }, { t: 'Kind' }, { t: 'What was reported' }, { t: 'Source' }, { t: 'State' }, { t: 'Decision' }],
              rows, 'Ordered by when the observation was made. A report captured offline and sent hours later belongs where it was seen, or the sequence of the event is wrong.')
          : empty('No reports held', 'Reports submitted from the public view arrive here immediately, marked unverified.'),
        '', true);

    return page('Field Reports',
      'Everything the district has been told but has not yet confirmed — from field teams and from the public.',
      body,
      '<button class="btn" data-act="export-reports">Export CSV</button>');
  }

  /* ====================================================================
     9. ANALYTICS
     ================================================================== */
  function analytics() {
    var S = ENG.STATE, d = ENG.deficit();
    var augs = ENG.augmentations().filter(function (a) { return a.delta > 0 && a.leadHrs <= 6; });
    var augTotal = augs.reduce(function (t, a) { return t + a.delta; }, 0);

    var body =
      '<div class="tiles">' +
        tile('Register overstatement', pc((d.claimedTotal - d.realTotal) / d.claimedTotal), n(d.claimedTotal - d.realTotal) + ' places that do not exist', 'crit') +
        tile('Capacity deficit', n(d.capacityDeficit), 'people with nowhere reachable', d.capacityDeficit ? 'warn' : 'ok') +
        tile('Closeable in 6 h', n(augTotal), 'by lifting binding constraints', 'ok') +
        tile('Residual', n(Math.max(0, d.capacityDeficit - augTotal)), 'requires inter-district transfer', 'inf') +
      '</div>' +
      '<div class="charts">' +
        CHARTS.coupling(S.habs) +
        CHARTS.registerGap(S.sites) +
        CHARTS.bindingMix(S.sites) +
        CHARTS.waterfall(d, augTotal) +
        CHARTS.feasibility(d) +
        CHARTS.composition(S.habs, SIM.district.blocks) +
        CHARTS.sensitivity(sweep()) +
      '</div>';

    return page('Analytics',
      'The seven views that justify the decision — and the ones that show where it is fragile.',
      body,
      '<button class="btn" data-act="export-all">Export CSV</button><button class="btn" data-act="export-json">Export JSON</button>');
  }

  /* ====================================================================
     10. METHOD — the model, written out
     ================================================================== */
  function method() {
    var W = ENG.RUI_W, st = ENG.STATE.standards;
    var body =
      note('b', '<b>Nothing on any screen is a stored number.</b> Every score is derived, on each render, from the raw inputs in ' +
        '<span class="m">src/data.js</span> — ground motion, depth, susceptibility, plume fraction, housing typology, ' +
        'floor area, litres per day, toilet count, road throughput. Change an input and the whole chain moves.') +
      '<div class="split">' +
        card('1 · Hazard Exposure Index', 'dominant hazard, plus what the rest add on top',
          '<div class="formula">HEI = worst + (100 − worst) × (1 − Π(1 − 0.5·sᵢ/100))</div>' +
          '<p style="font-size:12.5px;color:#48586E;margin:9px 0 0">Averaging four hazards lets three quiet ones hide one lethal one. ' +
          'A plain maximum ignores that flooding, shaking and a gas plume together are worse than any one alone. ' +
          'So the worst hazard sets the floor and the others eat into what is left of the scale.</p>' +
          '<div class="hr"></div>' +
          '<div class="mini" style="margin-bottom:6px"><b>Activity factors</b> — HEI is current exposure, not the design hazard:</div>' +
          Object.keys(ENG.ACTIVITY).map(function (k) {
            return '<div class="constraint"><span class="cn">' + k + '</span><span class="cb"><i style="width:' + (ENG.ACTIVITY[k].v * 100) + '%"></i></span>' +
              '<span class="cv">×' + ENG.ACTIVITY[k].v.toFixed(2) + '</span></div><div class="mini" style="margin:-2px 0 5px 132px">' + esc(ENG.ACTIVITY[k].why) + '</div>';
          }).join('')) +
        card('2 · Vulnerability & Capability Index', 'how badly a population copes, and how little it can move itself',
          ENG.VCI_W.map(function (v) {
            return '<div class="constraint"><span class="cn">' + esc(v.label) + '</span><span class="cb"><i style="width:' + (v.w * 100 / 0.28) + '%"></i></span><span class="cv">' + v.w.toFixed(2) + '</span></div>';
          }).join('') +
          '<p style="font-size:12.5px;color:#48586E;margin:10px 0 0">Livestock anchoring and displacement fatigue are in here because they are ' +
          'the two reasons people who have been warned still do not leave — and a model that cannot see them will keep being surprised.</p>') +
      '</div>' +
      card('3 · Carrying capacity — five ceilings, one binding', 'capacity = min(…)',
        '<div class="formula">area       = floor_area / ' + st.areaPerPerson + ' m² per person\n' +
        'water      = litres_per_day / ' + st.waterPerPerson + ' L per person per day\n' +
        'sanitation = toilets × ' + st.personsPerToilet + ' persons per toilet\n' +
        'structural = area × derate(site_HEI)      derate 1 below ' + st.siteHeiDerate + ', 0 at ' + st.siteHeiCutoff + '\n' +
        'corridor   = throughput × open_hours × 0.25 share\n\n' +
        'capacity   = min(area, water, sanitation, structural, corridor)\n' +
        'usable     = capacity × (1 − ' + st.surgeBuffer + ' surge reserve)</div>' +
        '<p style="font-size:12.5px;color:#48586E;margin:10px 0 0">A shelter\'s structural ceiling uses the shelter\'s <i>own</i> hazard exposure. ' +
        'Building resistance is applied only to the seismic term — retrofitted RCC survives shaking, it does not survive standing in four metres of water. ' +
        'This is why two sites on the register carry zero capacity here.</p>') +
      card('4 · Relocation Urgency Index — the coupled score', 'severity core, amplified by time and by capacity stress',
        '<div class="formula">core = ' + W.hei + ' × HEI + ' + W.vci + ' × VCI\n' +
        'amp  = 1 + ' + W.ampTime + ' × time_pressure + ' + W.ampCap + ' × capacity_stress\n' +
        'RUI  = min(100, core × amp)</div>' +
        '<p style="font-size:12.5px;color:#48586E;margin:10px 0 0"><b>Capacity stress is the part no other index has.</b> ' +
        'It is not "is there a shelter nearby" — on its own almost every habitation can see one with room. ' +
        'It is the habitation\'s proportional share of every site it can reach, weighted by all the other demand competing for the same site. ' +
        'When a shelter is disqualified, filled or cut off, the demand pointed at it redistributes, every competitor\'s share falls, ' +
        'and urgency upstream rises — without anyone touching the hazard model.</p>' +
        '<p style="font-size:12.5px;color:#48586E;margin:8px 0 0">It is an amplifier rather than a fourth weighted term on purpose. ' +
        'In a flat weighted sum a quiet term drags the score down, so a village that will be under four metres of water scores "medium" ' +
        'because its road happens to be short. Life-safety is the core; time and room can only raise urgency, never dilute it.</p>') +
      card('5 · What the system refuses to do', 'enforced in code',
        '<ol style="margin:0;padding-left:18px;font-size:12.5px;color:#48586E;line-height:1.7">' +
        '<li>It will not issue a relocation order without a debited capacity allocation behind it.</li>' +
        '<li>It will not allocate anyone to a site whose own HEI exceeds the cutoff, however large that site is.</li>' +
        '<li>It will not commit a site beyond its derived usable capacity, even across separate operators.</li>' +
        '<li>It will not delete a posting. A reversal is a compensating entry with its own operator and reason.</li>' +
        '<li>It will not report a district total that hides an unplaced habitation. Every refusal is named.</li>' +
        '</ol>');

    return page('Method',
      'The model, written out — so a district officer can disagree with a number by disagreeing with an assumption.',
      body);
  }

  /* ====================================================================
     14. GIS COMMAND MAP — the map with nothing else on the screen
     ================================================================== */
  function gisView() {
    return page('GIS Map',
      APP.mapLevel === 'district'
        ? 'Sarai Ghat district — hazard footprints, habitations, safe sites and relocation flows.'
        : 'India — declared events by state. Open the connected district to see derived figures.',
      mapPanel('full', true),
      '<button class="btn" data-map="india">India</button>' +
      '<button class="btn" data-map="drill">District</button>' +
      '<button class="btn" data-act="rail">Timeline</button>');
  }

  /* ====================================================================
     12. HAZARD FORECAST — the trained model, and what it will not claim
     ================================================================== */
  function forecast() {
    var b = FORECAST.board();
    var M = MODEL.metrics;
    var likely = b.filter(function (r) { return r.p >= 0.55; });
    var expected = b.reduce(function (t, r) { return t + r.expected; }, 0);
    var sel = ENG.STATE.fcSel || b[0].hab.id;
    ENG.STATE.fcSel = sel;
    var scen = ENG.STATE.fcScenario || 'normal';

    var rows = b.map(function (r) {
      var bd = FORECAST.band(r.p);
      var tr = r.trend;
      return '<tr>' +
        '<td>' + swatch(ENG.priority(r.hab.RUI.score).shape, ENG.priority(r.hab.RUI.score).color) +
          ' <b>' + esc(r.hab.name) + '</b><div class="mini">' + esc(blockName(r.hab.block)) + '</div></td>' +
        '<td class="num"><b>' + Math.round(r.p * 100) + '%</b></td>' +
        '<td style="min-width:96px"><div class="fcbar"><i style="width:' + (r.p * 100) + '%;background:' +
          ENG.priority(r.p >= 0.6 ? 90 : r.p >= 0.35 ? 70 : r.p >= 0.15 ? 40 : 10).color + '"></i></div></td>' +
        '<td>' + pill(bd.k, bd.label) + '</td>' +
        '<td>' + (tr ? (tr.label === 'Worsening' ? pill('crit', '↑ ' + tr.label)
                      : tr.label === 'Improving' ? pill('low', '↓ ' + tr.label) : pill('off', '→ ' + tr.label)) : '—') +
          (tr ? '<div class="mini m">' + (tr.dz >= 0 ? '+' : '') + tr.dz.toFixed(2) + ' logit</div>' : '') + '</td>' +
        '<td>' + pill(r.confidence.level, r.confidence.label) + '</td>' +
        '<td class="mini">' + esc((r.parts[0] || {}).f || '—').replace(/_/g, ' ') + '</td>' +
        '<td class="num">' + n(r.expected) + '</td>' +
        '<td><button class="rowbtn" data-open="fc" data-id="' + r.hab.id + '">Why</button></td>' +
        '</tr>';
    });

    var traj = FORECAST.SCENARIOS.map(function (sc) {
      return '<button class="fchip" data-fcs="' + sc.id + '" aria-pressed="' + (sc.id === scen) + '">' + esc(sc.label) + '</button>';
    }).join('');

    var body =
      '<div class="tiles">' +
        tile('Likely within 7 days', likely.length, 'habitations at 55% or above', likely.length ? 'warn' : 'ok') +
        tile('Expected exposure', n(expected), 'population-weighted, across the district', 'inf') +
        tile('Held-out AUC', M.auc, 'against a base rate of ' + M.base_rate) +
        tile('Rainfall window', MODEL.weather.window_days + ' d', 'simulated catchment series', 'off') +
      '</div>' +
      note('y', '<b>Trained on a simulated six-year history for a fictional district.</b> ' +
        'It ranks where to look first. It is not a forecast of any real place.') +
      why('How the model was built and tested',
        '<p>Logistic regression on ' + MODEL.features.length + ' features — antecedent rainfall over 7 and 30 days, ' +
        'yesterday\'s rain, 3-day maximum, season, and per-habitation terrain: slope, landslide susceptibility, elevation, ' +
        '100-year flood depth, liquefaction, plume fraction, river proximity, days since last event, and two rainfall × terrain interactions.</p>' +
        '<p>The split is by <b>time</b>, not at random: fitted on years 1–5, scored on year 6. A random split would leak the ' +
        'same storm into both halves through the antecedent-rainfall terms and inflate every metric. Held-out AUC ' + M.auc +
        ' against a training AUC of ' + M.train_auc + ' — a small gap, so it is not memorising.</p>' +
        '<p>The event history it learned from is generated by a process the model cannot see: a catchment store, a ' +
        'slope-stability reservoir and district-wide shock days, none of which are features. Training a model on its own ' +
        'scoring function would report a meaningless AUC.</p>' +
        '<p>Logistic regression rather than gradient boosting on purpose: the contribution of each feature is exactly ' +
        'coefficient × standardised value, so "why this score" is arithmetic rather than an approximation.</p>') +
      card('Seven-day hazard likelihood', 'ranked, ' + b.length + ' habitations',
        tbl([{ t: 'Habitation' }, { t: 'P(impact)', num: 1 }, { t: '' }, { t: 'Band' }, { t: 'Trend' },
             { t: 'Confidence' }, { t: 'Largest driver' }, { t: 'Expected people', num: 1 }, { t: '' }],
          rows, 'Trend compares today against seven days ago on the same rainfall series. Confidence is read off the ' +
          'held-out reliability table, not asserted. ' + simTag()), '', true) +
      '<div class="split">' +
        card('Fourteen-day trajectory', esc((ENG.STATE.habs.filter(function (h) { return h.id === sel; })[0] || {}).name || ''),
          '<div class="railf" style="border:none;background:none;padding:0 0 9px">' + traj + '</div>' +
          CHARTS.trajectory(sel, scen) +
          '<div class="mini">Scenarios are assumptions about rainfall, not forecasts of it. ' +
          esc((FORECAST.SCENARIOS.filter(function (x) { return x.id === scen; })[0] || {}).note || '') + '.</div>') +
        card('Calibration on the held-out year', 'predicted against observed',
          CHARTS.reliability() +
          '<div class="mini">A model that says 40% should be right 40% of the time. Points on the diagonal are ' +
          'calibrated; the bar under each point is how many held-out cases fell in that band.</div>') +
      '</div>';

    return page('Hazard Forecast',
      'Where a hazard is likely to land in the next seven days — and how far the model can be trusted.',
      body,
      '<button class="btn" data-act="export-forecast">Export CSV</button>');
  }

  /* ====================================================================
     13. ASK — retrieval with sources, and a refusal when there are none
     ================================================================== */
  function askPanel(compact) {
    var a = ENG.STATE.askAnswer;
    var sugg = RAG.SUGGESTIONS.slice(0, compact ? 4 : 7).map(function (q) {
      return '<button data-askq="' + esc(q) + '">' + esc(q) + '</button>';
    }).join('');

    var answer = '';
    if (a) {
      var kindChip = a.kind === 'computed' ? pill('ok', 'Computed from live district state')
        : a.kind === 'retrieved' ? pill('inf', 'Retrieved from sourced passages')
        : pill('med', 'No sourced answer');
      answer =
        '<div class="ans' + (a.kind === 'refused' ? ' refused' : '') + '">' +
          '<div class="ah">' + kindChip +
          (a.chips || []).map(function (c) { return pill(c[1], c[0]); }).join('') + '</div>' +
          '<div class="ab">' + esc(a.text) + '</div>' +
          ((a.sources && a.sources.length) ? '<div class="af">' +
            '<div class="mini" style="margin-bottom:4px"><b>Sources</b></div>' +
            a.sources.map(function (sc) {
              return '<div class="src"><b>' + sc.n + '</b><div>' + esc(sc.title) +
                '<div class="mini">' + esc(sc.provenance) +
                (sc.url ? ' · <a href="' + esc(sc.url) + '" target="_blank" rel="noopener">' + esc(sc.source) + '</a>' : '') +
                ' · match ' + sc.score + '</div></div></div>';
            }).join('') + '</div>' : '') +
        '</div>';
    }

    var st = RAG.status();
    return card('Ask AapdaSync', st.passages + ' sourced passages',
      '<div class="askwrap">' +
        '<div class="askq"><input id="askInput" placeholder="Ask about this district, a number, or the record…" ' +
        'value="' + esc(ENG.STATE.askQ || '') + '"><button class="btn pri" data-act="ask">Ask</button></div>' +
        '<div class="sugg">' + sugg + '</div>' +
        answer +
        '<div class="mini">Answers come from computed district state or from cited passages, and show which. ' +
        'When neither supports an answer it says so rather than guessing. No live news feed is connected.' +
        '</div>' +
      '</div>');
  }

  function askView() {
    var st = RAG.status();
    var kinds = Object.keys(st.byKind).map(function (k) {
      return '<div class="constraint"><span class="cn">' + esc(k) + '</span>' +
        '<span class="cb"><i style="width:' + (st.byKind[k] / st.passages * 100) + '%"></i></span>' +
        '<span class="cv">' + st.byKind[k] + '</span></div>';
    }).join('');

    return page('Ask & Sources',
      'Grounded answering over computed state and cited passages — with a refusal when neither supports an answer.',
      '<div class="split">' + askPanel(false) +
      '<div>' +
        card('What the retriever can see', st.passages + ' passages, BM25 ranked', kinds +
          '<div class="hr"></div>' +
          '<div class="mini"><b>Live news is not connected.</b> A browser cannot fetch cross-origin from ' +
          '<span class="m">file://</span>, and the hosted build\'s CSP blocks external hosts. The adapter is in ' +
          '<span class="m">src/rag.js</span> — point it at a same-origin endpoint and retrieved items index like any ' +
          'other passage. Until then nothing in this panel claims a live source.</div>') +
        why('Why it refuses instead of answering anyway',
          '<p>The retriever scores every passage against the question and takes the best. If the best is still weak, ' +
          'the honest output is "I do not know" — not a fluent sentence assembled from the nearest paragraph.</p>' +
          '<p>This system\'s entire argument is that unbacked numbers get people hurt. An assistant that invents a ' +
          'confident shelter capacity would undo it.</p>') +
      '</div></div>');
  }

  /* ====================================================================
     11. PUBLIC VIEW
     ================================================================== */

  /* --- CSS-3D coverflow over the real historical record --- */
  /* Four sources per card, in falling order of how much they are worth: a photo
     you dropped in this browser, a file at assets/photos/<id>.jpg, a verified
     NASA public-domain frame, and finally the rendered illustration bundled as
     a data URI. Each step falls through on error, so nothing has to be
     configured; the last step is a data URI, so no card can end up blank —
     including on file:// and in the hosted build, where the network step is
     unreachable by construction.

     The caption is carried per source rather than per card, because the sources
     do not deserve the same caption. A photograph you supplied is captioned
     with your credit and only on hover. The NASA frame and the illustration are
     not photographs of the event on that card, and a reader must not be able to
     miss that, so those two get a caption strip that is always on screen. */
  /* The illustration is carried as a key, not as its own bytes. Inlining the
     data URI into a data-fb attribute would put a second copy of all six
     images — about 360 KB — into the DOM for a fallback most cards never take.
     scene() resolves the key at the moment the step is actually used. */
  /* assets/photos/<id>.jpg only exists in the unpacked folder build. The
     single-file and hosted builds have no folder beside them, so probing it
     there is six guaranteed 404s in the console for no possible gain — and a
     console full of red is how a reviewer decides a build is broken. The test
     is whether this page was assembled from separate files at all. */
  var folderBuild = !!document.querySelector('script[src]');

  /* The hosted build runs under a CSP that blocks every external host, so the
     NASA step there is not a fallback, it is a guaranteed failure. The build
     script sets this flag on that one output rather than the app guessing at
     its own hosting from location.protocol, which would be wrong on both a
     local web server and a file:// open. */
  var offline = (typeof NO_NETWORK !== 'undefined') && NO_NETWORK;

  function photoChain(r) {
    var chain = [];
    var own = (typeof PHOTOS !== 'undefined') && PHOTOS.get(r.id);
    if (own) chain.push({ src: own.src, cap: own.credit || '', always: false });

    /* The supplied photographs, bundled into the build. They sit above every
       other source, so a card shows a photograph unless someone has dropped
       their own over it in this browser. Their caption stays on screen while
       `verified` is false — see train/bundle_photos.py. */
    var ph = bundled(r.id);
    if (ph) chain.push({ photo: r.id, cap: photoCaption(ph), always: !ph.verified });

    if (r.photo && folderBuild) chain.push({ src: r.photo, cap: r.credit || '', always: false });
    if (r.photoFallback && !offline) chain.push({ src: r.photoFallback, cap: r.fallbackCredit || '', always: true });
    var sc = scene(r.id);
    if (sc) chain.push({ scene: r.id, cap: sc.caption || '', always: true });
    return chain;
  }

  function scene(id) {
    return (typeof SCENE_IMG !== 'undefined' && SCENE_IMG[id]) || null;
  }

  function bundled(id) {
    return (typeof PHOTO_IMG !== 'undefined' && PHOTO_IMG[id]) || null;
  }

  function photoCaption(ph) {
    var c = ph.caption || '';
    if (ph.credit) c += (c ? ' · ' : '') + ph.credit;
    return c;
  }

  function stepSrc(step) {
    if (step.scene) { var s = scene(step.scene); return s ? s.uri : ''; }
    if (step.photo) { var p = bundled(step.photo); return p ? p.uri : ''; }
    return step.src || '';
  }

  /* Advance to the next source. Called from the img's own onerror, so a 404, a
     blocked host and a corrupt file all take the same path. */
  function cfNext(img) {
    var q;
    try { q = JSON.parse(img.getAttribute('data-fb') || '[]'); } catch (e) { q = []; }
    while (q.length) {
      var step = q.shift();
      var src = stepSrc(step);
      if (!src) continue;
      img.setAttribute('data-fb', JSON.stringify(q));
      img.setAttribute('data-cap', step.cap || '');
      img.setAttribute('data-always', step.always ? '1' : '');
      img.src = src;
      return;
    }
    img.setAttribute('data-fb', '[]');
    img.remove();
  }

  function cfShown(img) {
    img.classList.add('on');
    var c = img.parentNode && img.parentNode.querySelector('.cfcr');
    if (!c) return;
    var cap = img.getAttribute('data-cap') || '';
    c.textContent = cap;
    c.classList.toggle('always', img.getAttribute('data-always') === '1');
    c.classList.toggle('on', !!cap);
  }

  function photoLayer(r) {
    var chain = photoChain(r);
    if (!chain.length) return '';
    var first = chain[0], rest = chain.slice(1);
    return '<img class="cfphoto" src="' + esc(stepSrc(first)) + '" alt="" ' +
      'data-cap="' + esc(first.cap) + '" data-always="' + (first.always ? '1' : '') + '" ' +
      'data-fb=\'' + esc(JSON.stringify(rest)).replace(/'/g, '&#39;') + '\' ' +
      'onerror="V.cfNext(this)" onload="V.cfShown(this)">' +
      '<span class="cfcr"></span>';
  }

  function coverflow() {
    var idx = ENG.STATE.cfIndex || 0;
    var cards = RECORD.map(function (r, i) {
      /* The drawing is always the base layer. A photograph, if one has been
         dropped into assets/photos/, fades in over it; if the file is not
         there the img removes itself and the drawing simply stays. Nothing
         has to be configured either way. */
      var art = sceneSVG(r.kind, r.id) + photoLayer(r);
      return '<button class="cf-card" data-cf="' + i + '" data-drop="' + esc(r.id) + '" ' +
        'aria-label="' + esc(r.year + ', ' + r.name + '. ' + r.headline + ' ' + r.headlineNote) + '">' +
        '<div class="cfimg">' + art +
        '<span class="cfdrop">Drop a photograph here</span>' +
          '<span class="cfyr">' + esc(r.year) + '</span>' +
          '<span class="cfk">' + esc(r.kindLabel.split('—')[0].trim()) + '</span>' +
        '</div>' +
        '<div class="cfb"><h4>' + esc(r.name) + '</h4>' +
        '<div class="cfp">' + esc(r.place) + '</div>' +
        '<div class="cfn">' + esc(r.headline) + '</div>' +
        '<div class="cfd">' + esc(r.headlineNote) + '</div>' +
        '<div class="cfl">' + esc(r.lesson) + '</div>' +
        '<div class="cfmore">Read the record <span aria-hidden="true">→</span></div>' +
        '</div></button>';
    }).join('');
    var dots = RECORD.map(function (r, i) {
      return '<button data-cf="' + i + '" aria-current="' + (i === idx) + '" aria-label="Go to ' + esc(r.year + ' ' + r.name) + '"></button>';
    }).join('');
    return '<div class="cfwrap">' +
      '<div class="cfhead"><h3>The record</h3>' +
      '<p>Six events that actually happened, and the rule each one put into this system. Select a card to see which.</p></div>' +
      '<div class="cf" id="cf"><div class="cf-stage">' + cards + '</div>' +
      '<button class="cf-nav prev" data-cf="prev" aria-label="Previous event">‹</button>' +
      '<button class="cf-nav next" data-cf="next" aria-label="Next event">›</button></div>' +
      '<div class="cf-dots">' + dots + '</div>' +
      '<div class="cfcap">Figures as reported by the source cited on each card. ' +
      'Photographs were supplied with this build and their provenance has not been verified — each says what it ' +
      'actually shows. Drag your own onto any card to replace one. ' +
      '<button class="cflink" data-act="photos">Add photographs (' + PHOTOS.count() + '/' + RECORD.length + ')</button></div>' +
      '</div>';
  }

  function ticker() {
    var S = ENG.STATE, d = ENG.deficit();
    var bits = [];
    SIM.events.forEach(function (e) {
      bits.push('<b>' + esc(e.name) + '</b> — ' + (e.impactInHrs > 0 ? 'impact in about ' + d1(e.impactInHrs) + ' hours' : 'happening now'));
    });
    bits.push('<b>' + n(d.demand) + '</b> people in ' + esc(SIM.district.name) + ' need a place in a shelter');
    bits.push('<b>' + n(d.capacityDeficit) + '</b> of them do not yet have one');
    var line = bits.join('<span class="sep">•</span>');
    return '<div class="ticker"><div class="tl">Live</div><div class="tt"><div>' + line + '<span class="sep">•</span>' + line + '</div></div></div>';
  }

  function publicNationalMap() {
    var sm = NAT.summary();
    return card('Live risk map — India', sm.states + ' states reporting',
      '<div class="mapbox short" style="box-shadow:none;border-radius:8px">' + NAT.render() +
      '<div class="ov ov-tl" style="font-size:11px">Tap a marked state for what it has declared</div>' +
      '<div class="ov ov-bc">Simulated national picture · state boundaries illustrative, not authoritative</div>' +
      '</div>' +
      '<div class="mini" style="margin-top:8px">Colour and shape show what each state has <b>declared</b>. ' +
      'Only ' + esc((NAT.byId(SIM.homeState) || {}).name || '') + ' has a district feed connected, so it is the only ' +
      'place where the numbers below are computed rather than reported.</div>');
  }

  /* Each instruction is [pictogram, sentence]. The pictogram key is part of the
     content, not a decoration chosen at render time: which symbol belongs on
     "do not shelter at the toe of the slope" is a question about the
     instruction, and it belongs beside the instruction where it can be read
     and argued with. */
  var DOS = {
    flood: {
      dos: [['shelter-up',  'Move to the highest floor or the marked shelter before water enters the lane, not after'],
            ['gobag',       'Carry ID, medicines and a phone charger in a sealed bag'],
            ['mains-off',   'Switch off the mains at the meter before you leave'],
            ['livestock',   'Move livestock to the embankment early — it is the commonest reason families delay']],
      donts: [['wade',      'Do not walk or drive through moving water, even shallow'],
              ['go-back',   'Do not go back for belongings once the lane is flowing'],
              ['live-wire', 'Do not touch fallen wires or standing water near a pole'],
              ['wait',      'Do not wait for a second warning']]
    },
    slide: {
      dos: [['traverse',    'Leave along the slope, not down the valley line'],
            ['watch',       'Watch for new cracks, tilting poles and sudden muddy water in a clear stream'],
            ['first-light', 'Move at first light if movement is reported at night'],
            ['road-clear',  'Keep the ghat road clear for clearing equipment']],
      donts: [['slope-toe',    'Do not shelter at the toe of the slope'],
              ['debris-cross', 'Do not cross a fresh debris fan on foot'],
              ['cracked',      'Do not re-enter a house with a new crack across the floor'],
              ['park-under',   'Do not park under a cut slope']]
    },
    seis: {
      dos: [['drop-cover', 'Drop, cover and hold on until the shaking stops'],
            ['exit-house', 'Leave a damaged kutcha or semi-pucca house and stay out'],
            ['aftershock', 'Expect aftershocks for days and treat every one as the real thing'],
            ['assembly',   'Gather at the open assembly ground, not against a wall']],
      donts: [['lift',         'Do not use a lift'],
              ['doorway',      'Do not stand in a doorway of an unreinforced masonry house'],
              ['enter-house',  'Do not enter a building to retrieve possessions'],
              ['flame',        'Do not light a flame until you are sure there is no gas']]
    },
    mah: {
      dos: [['crosswind',   'Move crosswind and upwind — sideways to the smell, then away from it'],
            ['wet-cloth',   'Cover your mouth and nose with a wet cloth'],
            ['high-ground', 'Go to higher ground if you can; most of these gases are heavier than air'],
            ['children',    'Take children and the elderly first, and count them']],
      donts: [['run-downwind', 'Do not run downwind, however short the route looks'],
              ['basement',     'Do not shelter in a basement or a pit'],
              ['drive-plume',  'Do not drive into the plume to collect someone'],
              ['siren',        'Do not assume the siren means the release has stopped']]
    }
  };

  /* The symbol carries the instruction to anyone who will not read the
     sentence; the sentence disambiguates the symbol for everyone who will.
     Neither is sufficient alone, so neither is offered alone. */
  function guideList(items, kind) {
    return '<ul class="dolist">' + items.map(function (it) {
      return '<li>' + PICTO.icon(it[0], kind) + '<span>' + esc(it[1]) + '</span></li>';
    }).join('') + '</ul>';
  }


  /* --- Relief contribution: fund one binding constraint, not a general fund ---
     The list is ordered by rupees per shelter place, which is only possible
     because capacity is derived. "₹700 unlocks a place at Kotwa" is a claim
     the capacity model can actually stand behind; "help the flood victims"
     is not. */
  function reliefPanel() {
    var needs = ENG.fundableNeeds().filter(function (x) { return !x.done; }).slice(0, 4);
    var doneNeeds = ENG.fundableNeeds().filter(function (x) { return x.done; });
    var sel = ENG.STATE.reliefSel;
    if (!sel || !needs.some(function (x) { return x.id === sel; })) sel = needs.length ? needs[0].id : null;
    ENG.STATE.reliefSel = sel;
    var amt = ENG.STATE.reliefAmt || 2000;
    var pay = ENG.STATE.reliefPay || 'upi';
    var chosen = needs.filter(function (x) { return x.id === sel; })[0];

    var rows = needs.map(function (a) {
      return '<div class="needrow' + (a.id === sel ? ' sel' : '') + '" data-need="' + esc(a.id) + '" role="button" tabindex="0">' +
        '<div class="nh"><b>' + esc(a.title) + '</b><span class="np">₹' + a.perPlace + '/place</span></div>' +
        '<div class="nm">' + esc(a.siteName) + ' · unlocks <b>' + n(a.delta) + '</b> places · ready in ' + a.leadHrs + ' h</div>' +
        '<div class="bar"><i style="width:' + (a.pct * 100) + '%;background:#1B7F3B"></i></div>' +
        '<div class="nf"><span>₹' + n(a.funded) + ' of ₹' + n(a.costNum) + '</span><span>' + esc(a.unit) + '</span></div>' +
        '</div>';
    }).join('');

    var amounts = [500, 2000, 10000, 50000].map(function (v) {
      return '<button data-amt="' + v + '" aria-pressed="' + (amt === v) + '">₹' + v.toLocaleString('en-IN') + '</button>';
    }).join('');

    var methods = [['upi', 'UPI'], ['card', 'Card'], ['nb', 'Net banking']].map(function (m) {
      return '<button data-pay="' + m[0] + '" aria-pressed="' + (pay === m[0]) + '">' +
        '<span style="font-size:15px">' + (m[0] === 'upi' ? '⌗' : m[0] === 'card' ? '▭' : '⌸') + '</span>' + m[1] + '</button>';
    }).join('');

    var body =
      note('y', '<b>Nothing here takes a payment.</b> No card, UPI ID or bank detail is asked for or stored, ' +
        'and no money moves. The flow is here to show what a transparent relief contribution could look like.') +
      (needs.length
        ? '<div style="margin-bottom:11px">' + rows + '</div>' +
          '<div class="mini" style="margin-bottom:6px"><b>Amount</b></div>' +
          '<div class="chips-amt">' + amounts + '</div>' +
          '<div class="mini" style="margin-bottom:6px"><b>Method</b> <span style="color:#77839A">— label only, nothing is collected</span></div>' +
          '<div class="pay">' + methods + '</div>' +
          (chosen
            ? '<div class="note b" style="margin-bottom:10px"><span class="ic">→</span><div>' +
              '₹' + n(Math.min(amt, chosen.remaining)) + ' toward <b>' + esc(chosen.title) + '</b> at ' + esc(chosen.siteName) + '. ' +
              'That is <b>' + n(Math.floor(Math.min(amt, chosen.remaining) / chosen.perPlace)) + ' shelter places</b> at the current rate. ' +
              '₹' + n(chosen.remaining) + ' still needed to release all ' + n(chosen.delta) + '.</div></div>'
            : '') +
          '<button class="btn pri" data-act="contribute" style="width:100%">Contribute ₹' + n(amt) + ' (simulated)</button>'
        : note('g', 'Every constraint that money can lift is already funded. What remains needs an inter-district transfer, not a contribution.')) +
      (doneNeeds.length
        ? '<div class="hr"></div><div class="mini" style="margin-bottom:5px"><b>Funded and posted</b></div>' +
          doneNeeds.map(function (a) {
            return '<div class="helprow"><span class="hi" style="background:var(--oks);color:var(--ok)">✓</span>' +
              '<div><b>' + esc(a.title) + '</b><span>' + esc(a.siteName) + ' — ' + n(a.delta) + ' places released</span></div></div>';
          }).join('')
        : '');

    return '<div class="card" id="reliefPanel"><div class="card-h"><h3>Contribute to relief</h3>' +
      '<span class="sub">fund one constraint, not a fund</span></div><div class="card-b">' + body + '</div></div>';
  }

  /* Public view never prints exact occupancy. A live headcount at a named
     shelter is operational information, and it changes minute to minute. */
  function spaceWord(st) {
    if (!st.usableTotal) return 'not usable';
    var f = st.committed / st.usableTotal;
    return f >= 0.999 ? 'full' : f >= 0.8 ? 'nearly full' : f >= 0.4 ? 'filling' : 'space available';
  }

  function publicView() {
    var S = ENG.STATE;
    var sel = S.publicHab || S.habs[0].id;
    var h = S.habs.filter(function (x) { return x.id === sel; })[0] || S.habs[0];
    var as = S.plan.assignments.filter(function (a) { return a.habId === h.id; });
    var got = as.reduce(function (t, a) { return t + a.persons; }, 0);
    var short = h.demand.shelterNeed - got;
    var pr = ENG.priority(h.RUI.score);
    var w = ENG.windowInfo(h);
    var guide = DOS[h.HEI.dominant.k] || DOS.flood;

    var options = S.habs.map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === h.id ? ' selected' : '') + '>' + esc(x.name) + '</option>';
    }).join('');

    var med = S.sites.filter(function (x) { return x.beds > 0 && !x.cap.disqualified; })
      .sort(function (a, b) { return ENG.travel(h, a).min - ENG.travel(h, b).min; })[0];
    var nearest = ENG.reachableSites(h, S.sites).slice(0, 3);
    var medShown = med && nearest.some(function (r0) { return r0.site.id === med.id; });
    var farHelp = nearest.length && nearest[0].min > 90;

    var main =
      publicNationalMap() +
      card('Active events in ' + SIM.district.name, SIM.events.length + ' declared',
        SIM.events.map(function (e) {
          return '<div class="helprow"><span class="hi">' +
            (e.severity === 'critical' ? '⚠' : 'ℹ') + '</span><div><b>' + esc(e.name) + '</b>' +
            '<span>' + esc(e.note) + '</span></div>' +
            '<span style="margin-left:auto">' + (e.impactInHrs > 0
              ? '<span class="m" style="font-size:12px">T−' + d1(e.impactInHrs) + ' h</span>'
              : pill('crit', 'now')) + '</span></div>';
        }).join('')) +
      '<div class="card"><div class="card-h"><h3>What has been decided for your habitation</h3><span class="r">' +
        '<select id="pubSel" aria-label="Choose a habitation" style="border:1px solid #D9E0EA;border-radius:7px;padding:5px 9px;font-size:13px">' + options + '</select></span></div>' +
        '<div class="card-b"><div class="split">' +
          '<div>' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
              swatch(pr.shape, pr.color, 22) +
              '<div><div style="font-size:20px;font-weight:700">' + esc(h.name) + '</div>' +
              '<div class="mini">' + esc(blockName(h.block)) + ' block · population ' + n(h.pop) + '</div></div>' +
              '<div style="margin-left:auto;text-align:right"><div class="m" style="font-size:28px;font-weight:600;color:' + pr.color + '">' + Math.round(h.RUI.score) + '</div>' +
              '<div class="mini">relocation urgency</div></div>' +
            '</div>' +
            kv([
              ['Status', pill(pr.k, pr.label + ' priority')],
              ['Main danger', esc(h.HEI.dominant.label) + ' — ' + esc((SIM.events.filter(function (e) { return e.kind === h.HEI.dominant.k; })[0] || {}).name || '')],
              ['Time', w.ongoing ? '<b style="color:#B3261E">Happening now</b>' : 'About <b>' + d1(w.hrs) + ' hours</b> from now'],
              ['People who should move', '<b>' + n(h.demand.mustMove) + '</b> of ' + n(h.pop)],
              ['Places needed in a shelter', '<b>' + n(h.demand.shelterNeed) + '</b> <span class="mini">(others can stay with family or on higher ground)</span>'],
              ['Places arranged', got > 0 ? '<b style="color:#1B7F3B">' + n(got) + '</b>' : '<b style="color:#B3261E">none yet</b>'],
              ['Still without a place', short > 0 ? '<b style="color:#B3261E">' + n(short) + '</b>' : '<b style="color:#1B7F3B">none</b>']
            ]) +
          '</div>' +
          '<div>' +
            '<h4 style="margin:0 0 8px;font-size:13px">Where people from here are being sent</h4>' +
            (as.length ? as.map(function (a) {
              var st = S.sites.filter(function (x) { return x.id === a.siteId; })[0];
              return '<div class="card" style="margin-bottom:8px"><div class="card-b">' +
                '<b>' + esc(a.siteName) + '</b>' +
                '<div class="mini" style="margin:3px 0 7px">' + esc(st.type) + ' · about ' + Math.round(a.travelMin) + ' minutes by road · ' + esc((SIM.corridors.filter(function (c) { return c.id === st.corridor; })[0] || {}).name || '') + '</div>' +
                bar('Places held for ' + h.name, a.persons, Math.max(a.persons, st.usableTotal),
                  n(a.persons) + ' places held · this site is ' + spaceWord(st), '#1B7F3B') +
                '</div></div>';
            }).join('') : empty('No place arranged yet', 'The district has not been able to allocate a safe place for this habitation. It is on the escalation list.')) +
            (short > 0 ? note('r', '<b>' + n(short) + ' people from ' + esc(h.name) + ' do not yet have a place.</b> ' +
              'The district has been told, in these words, rather than being shown a total that hides it.') : '') +
          '</div>' +
        '</div></div></div>' +
      card('If you are told to move', esc(h.HEI.dominant.label.toLowerCase()),
        '<div class="dosrow">' +
        '<div class="do"><h5><span class="dmark yes" aria-hidden="true">\u2713</span>Do</h5>' +
          guideList(guide.dos, 'yes') + '</div>' +
        '<div class="dont"><h5><span class="dmark no" aria-hidden="true">\u2715</span>Do not</h5>' +
          guideList(guide.donts, 'no') + '</div>' +
        '</div>') +
      card('Why this habitation is ranked where it is', 'plain language',
        '<p style="font-size:13px;color:#48586E;margin:0">' + plainExplain(h) + '</p>' +
        '<div class="redact">The numeric vulnerability breakdown behind this ranking is held in Government View. ' +
        'Published household vulnerability data tells anyone which families cannot leave on their own.</div>') +
      askPanel(true);

    var side =
      card('Nearest help', 'from ' + esc(h.name),
        nearest.map(function (r2) {
          return '<div class="helprow"><span class="hi">' +
            (r2.site.beds > 0 ? '✚' : '⌂') + '</span><div><b>' + esc(r2.site.name) + '</b>' +
            '<span>' + esc(r2.site.type) + ' · about ' + Math.round(r2.min) + ' min · ' + spaceWord(r2.site) + '</span></div></div>';
        }).join('') +
        (med && !medShown ? '<div class="helprow"><span class="hi">✚</span><div><b>' + esc(med.name) + '</b>' +
          '<span>' + med.beds + ' staffed beds · ' + Math.round(ENG.travel(h, med).min) + ' min — for anyone who cannot be moved unaided</span></div></div>' : '') +
        (nearest.length ? '' : note('r', 'No safe site is reachable from here inside the warning window.')) +
        (farHelp ? note('y', '<b>The nearest safe site is ' + Math.round(nearest[0].min) + ' minutes away.</b> ' +
          'That is a long way, and it is the honest figure — the road from here is ' +
          esc(((SIM.corridors.filter(function (c) { return c.id === h.corridor; })[0]) || {}).status || 'restricted') +
          '. Start earlier than you think you need to.') : '')) +
      reportPanel(h) +
      card('Live updates', 'field reports',
        SIM.reports.slice(0, 5).map(function (r2) {
          return '<div class="fev ' + (r2.status === 'verified' ? 'ok' : 'med') + '" style="margin-bottom:8px">' +
            '<div class="ft">' + esc(r2.at) + ' · ' + esc(r2.status) + '</div>' +
            '<div class="fx">' + esc(r2.text) + '</div>' +
            '<div class="fm">' + esc(r2.by) + '</div></div>';
        }).join('') +
        '<div class="mini">Reports are labelled before verification. Hiding them until an officer confirms is how a lane floods while a form is being filled.</div>') +
      reliefPanel();

    var body =
      note('y', '<b>Student prototype · invented data · not an official instruction.</b> For danger to life call <b>112</b>.') +
      ticker() +
      coverflow() +
      '<div class="pubgrid"><div>' + main + '</div><div class="stack">' + side + '</div></div>';

    return page('Public View',
      'What has been decided for a habitation, where its people are being sent, and why — in language a resident can check.',
      body);
  }

  /* --- Citizen reporting -------------------------------------------------
     The panel leads with what this is NOT. Someone reaching for a report form
     during a flood is looking for help, and a form that lets them believe help
     is coming when it is not is the most dangerous thing on this page. So the
     emergency number is above the button, not in a footnote below it.

     Below the button, the reports this browser has sent, with live status read
     back from the queue — a report you cannot follow is a report you send twice.
     ---------------------------------------------------------------------- */
  function reportPanel(h) {
    var list = REPORTS.mineList();
    var rows = list.slice(0, 4).map(function (r) {
      var k = r.status === 'verified' ? 'ok' : (r.status === 'dismissed' ? 'off' : 'med');
      var word = r.status === 'verified' ? 'Confirmed by an officer'
        : r.status === 'dismissed' ? 'Not confirmed'
        : 'Waiting for an officer to check it';
      return '<div class="crrow"><span class="p p-' + k + '">' + esc(r.id) + '</span>' +
        '<div><b>' + esc(REPORTS.kindLabel(r.kind)) + ' · ' + esc(r.habName) + '</b>' +
        '<span>' + esc(word) + (r.note ? ' — ' + esc(r.note) : '') + '</span></div></div>';
    }).join('');

    return card('Report what you can see', 'goes to the district as unverified',
      '<p class="crlead">If you can see water rising, ground moving, a damaged building or people trapped, ' +
      'tell the district control room. It is checked by an officer before it counts.</p>' +
      note('r', '<b>This does not send help.</b> For danger to life call <b>112</b>, or the district control room on ' +
        '<b>1077</b>. Use this to tell them what is happening, not to ask for rescue.') +
      '<button class="btn pri crbtn" data-act="report-open">Report what you can see</button>' +
      (list.length
        ? '<div class="crmine"><h5>What you have sent from this device</h5>' + rows +
          (list.length > 4 ? '<div class="mini">' + (list.length - 4) + ' more.</div>' : '') +
          (REPORTS.storageOK ? '' : '<div class="mini">Browser storage is unavailable, so this list will not survive a reload.</div>') +
          '</div>'
        : '<div class="mini crnone">Nothing sent from this device yet.</div>'));
  }

  /* The form. One screen, no steps, every field except the description
     optional — a person standing in rising water fills in what they can and
     presses send. Nothing here is required that an officer could work out for
     themselves from the habitation and the description. */
  function reportForm(preHab) {
    var opts = (ENG.STATE.habs || []).map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (x.id === preHab ? ' selected' : '') + '>' + esc(x.name) + '</option>';
    }).join('');
    var kinds = REPORTS.kinds().map(function (k, i) {
      return '<button type="button" class="crkind" data-kind="' + esc(k.k) + '" aria-pressed="' + (i === 0 ? 'false' : 'false') + '">' +
        esc(k.label) + '</button>';
    }).join('');
    var whens = REPORTS.whens().map(function (w, i) {
      return '<button type="button" class="crwhen" data-when="' + esc(w.k) + '" aria-pressed="' + (i === 0) + '">' +
        esc(w.label) + '</button>';
    }).join('');

    return '<div class="mh"><div><h3>Report what you can see</h3>' +
      '<div class="ms">The district control room · checked by an officer before it counts</div></div></div>' +
      '<div class="mb">' +
      note('r', '<b>This does not send help.</b> For danger to life call <b>112</b>.') +
      '<div class="field"><label for="crHab">Which habitation is this about?</label>' +
      '<select id="crHab">' + opts + '</select></div>' +
      '<div class="field"><label>What can you see?</label><div class="crkinds">' + kinds + '</div></div>' +
      '<div class="field"><label for="crText">Describe it</label>' +
      '<textarea id="crText" rows="3" placeholder="Water is over the road by the bus stop and still rising."></textarea>' +
      '<div class="mini">Say what you can see, not what you think caused it. Where exactly, and how bad.</div></div>' +
      '<div class="field"><label>When did you see it?</label><div class="crwhens">' + whens + '</div></div>' +
      '<div class="crtwo">' +
      '<div class="field"><label for="crPersons">People affected <span class="opt">optional</span></label>' +
      '<input id="crPersons" class="m" inputmode="numeric" placeholder="e.g. 20"></div>' +
      '<div class="field"><label for="crLandmark">Nearest landmark <span class="opt">optional</span></label>' +
      '<input id="crLandmark" placeholder="e.g. behind the school"></div>' +
      '</div>' +
      '<div class="field"><label for="crContact">Your phone number <span class="opt">optional</span></label>' +
      '<input id="crContact" class="m" inputmode="tel" placeholder="so an officer can call you back">' +
      '<div class="mini">Only used to check the report. It is not shown on the public pages.</div></div>' +
      '<div id="crErr"></div>' +
      '</div>' +
      '<div class="mf"><button class="btn" data-act="close-modal">Cancel</button>' +
      '<button class="btn pri" data-act="report-send">Send report</button></div>';
  }

  /* The receipt says three things, in this order: it arrived, here is the
     number to quote, and here is exactly what will and will not happen next.
     A receipt that only says "thank you" leaves the person waiting for a
     rescue nobody has dispatched. */
  function reportReceipt(res) {
    var r = res.record;
    return '<div class="mh"><div><h3>Report ' + esc(res.ref) + ' received</h3>' +
      '<div class="ms">In the district queue, marked unverified</div></div></div>' +
      '<div class="mb">' +
      note('g', '<b>It is in the queue.</b> Quote <b class="m">' + esc(res.ref) + '</b> if you call the control room about it.') +
      kv([
        ['What you reported', esc(r.kindLabel)],
        ['Where', esc(r.habName) + (r.landmark ? ' — ' + esc(r.landmark) : '')],
        ['When you saw it', esc(r.at === 'now' ? 'just now' : 'about ' + r.at.replace('-', '').split(':')[0] + ' h ago')],
        ['Status', pill('med', 'unverified')]
      ]) +
      '<h5 class="crh">What happens now</h5>' +
      '<ul class="crsteps">' +
      '<li>An officer sees it in the district queue immediately, marked unverified.</li>' +
      '<li>They confirm or dismiss it, and their name is recorded against that decision.</li>' +
      '<li>Until then it changes nothing that has already been decided — including the relocation order for your habitation.</li>' +
      '</ul>' +
      note('y', '<b>Nobody has been dispatched by this.</b> If someone is in danger now, call <b>112</b>.') +
      (res.persisted ? '' : note('', 'Your browser could not save this locally, so it will disappear from your list when you reload. It is still in the district queue.')) +
      '</div>' +
      '<div class="mf"><button class="btn pri" data-act="close-modal">Done</button></div>';
  }

  function plainExplain(h) {
    var pr = ENG.priority(h.RUI.score);
    var dom = h.HEI.dominant;
    var w = ENG.windowInfo(h);
    var cs = h.RUI.stress;
    var s = esc(h.name) + ' is ranked <b>' + pr.label.toLowerCase() + '</b> priority. ';
    s += 'The main danger is ' + dom.label.toLowerCase() + ', scoring ' + Math.round(dom.v) + ' out of 100' +
      (h.HEI.compounding > 8 ? ', with other hazards adding another ' + Math.round(h.HEI.compounding) + ' points on top' : '') + '. ';
    s += 'Its people are ' + (h.VCI.score > 65 ? 'unusually hard to move' : h.VCI.score > 45 ? 'moderately hard to move' : 'relatively able to move themselves') +
      ' — mainly ' + esc(h.VCI.parts[0].label.toLowerCase()) + ' and ' + esc(h.VCI.parts[1].label.toLowerCase()) + '. ';
    s += w.ongoing ? 'The hazard is already on top of them, so time pressure is at maximum. '
      : 'There are about ' + d1(w.hrs) + ' hours before impact. ';
    if (cs.score > 60) s += '<b>Critically, there is very little safe capacity within reach</b> — about ' + n(cs.fairShare) +
      ' places once the other habitations competing for the same sites are counted, against a need of ' + n(h.demand.shelterNeed) + '. That is what pushes it up the queue.';
    else if (cs.score > 25) s += 'There is some safe capacity within reach, but it is contested by other habitations, which raises the urgency.';
    else s += 'There is enough reachable capacity for it, which is the only reason it is not higher in the queue.';
    return s;
  }

  return {
    deck: deck, zones: zones, capacity: capacityView, queue: queue, engine: engineView,
    convoys: convoys, scenarios: scenarios, ledger: ledgerView, analytics: analytics,
    method: method, publicView: publicView, reports: reportsView, forecast: forecast, gisView: gisView, askView: askView, askPanel: askPanel,
    page: page, card: card, tile: tile, pill: pill, pillFor: pillFor, note: note, kv: kv, bar: bar,
    tbl: tbl, empty: empty, swatch: swatch, why: why, freshness: freshness, esc: esc, n: n, d1: d1, pc: pc, blockName: blockName,
    mapOverlays: mapOverlays, mapPanel: mapPanel, timelineRail: timelineRail, zoomControls: zoomControls, reliefPanel: reliefPanel,
    reportForm: reportForm, reportReceipt: reportReceipt, photoLayer: photoLayer, cfNext: cfNext, cfShown: cfShown, coverflow: coverflow, ticker: ticker, nationalOverlays: nationalOverlays, clearSweep: clearSweep, plainExplain: plainExplain, simTag: simTag
  };
})();
