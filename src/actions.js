/* ============================================================================
   AapdaSync — actions.js
   Drawers, modals, the command palette, toasts and exports.
   ========================================================================== */

'use strict';

var ACT = (function () {

  var esc = V.esc, n = V.n, d1 = V.d1, pc = V.pc;
  var openModalKind = null;

  /* --------------------------------------------------------------- toasts */
  function toast(title, msg, kind) {
    var wrap = document.getElementById('toasts');
    var el = document.createElement('div');
    el.className = 'tst ' + (kind || '');
    el.innerHTML = '<b>' + esc(title) + '</b>' + (msg ? '<span>' + esc(msg) + '</span>' : '');
    wrap.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0'; el.style.transform = 'translateY(6px)';
      setTimeout(function () { el.remove(); }, 320);
    }, 4200);
  }

  /* --------------------------------------------------------------- drawer */
  function closeDrawer() {
    var d = document.getElementById('drawer');
    d.classList.remove('on'); d.setAttribute('aria-hidden', 'true');
    APP.mapFocus = null;
    if (APP.route === 'deck') APP.refreshMap();
  }
  function drawer(title, sub, body, footer) {
    var d = document.getElementById('drawer');
    d.innerHTML =
      '<div class="dh"><div><h3>' + title + '</h3><div class="ds">' + sub + '</div></div>' +
      '<button class="x" data-act="close-drawer" aria-label="Close">✕</button></div>' +
      '<div class="db">' + body + '</div>' +
      (footer ? '<div class="df">' + footer + '</div>' : '');
    d.classList.add('on'); d.setAttribute('aria-hidden', 'false');
    var f = d.querySelector('.x'); if (f) f.focus();
  }

  /* ---- habitation drawer: the full derivation, top to bottom ---- */
  function openHab(id) {
    var S = ENG.STATE;
    var h = S.habs.filter(function (x) { return x.id === id; })[0];
    if (!h) return;
    var pr = ENG.priority(h.RUI.score);
    var as = S.plan.assignments.filter(function (a) { return a.habId === h.id; });
    var got = as.reduce(function (t, a) { return t + a.persons; }, 0);
    var short = h.demand.shelterNeed - got;
    var w = ENG.windowInfo(h);
    var cs = h.RUI.stress;

    var heiRows = h.HEI.parts.slice().sort(function (a, b) { return b.v - a.v; }).map(function (p) {
      return '<div class="constraint' + (p.k === h.HEI.dominant.k ? ' bind' : '') + '">' +
        '<span class="cn">' + esc(p.label) + (p.k === h.HEI.dominant.k ? ' <b>·dominant</b>' : '') + '</span>' +
        '<span class="cb"><i style="width:' + p.v + '%"></i></span>' +
        '<span class="cv">' + Math.round(p.v) + '</span></div>';
    }).join('');

    var vciRows = h.VCI.parts.map(function (p) {
      return '<div class="constraint"><span class="cn">' + esc(p.label) + '</span>' +
        '<span class="cb"><i style="width:' + p.raw + '%"></i></span>' +
        '<span class="cv">' + Math.round(p.raw) + '</span>' +
        '<span class="cx mini">×' + p.w + '</span></div>';
    }).join('');

    var ruiRows = h.RUI.parts.map(function (p) {
      return '<div class="constraint' + (p.kind === 'amp' ? ' ' : '') + '"><span class="cn">' + esc(p.label) + '</span>' +
        '<span class="cb"><i style="width:' + p.raw + '%;background:' + (p.kind === 'amp' ? '#C98A16' : '#12447E') + '"></i></span>' +
        '<span class="cv">' + Math.round(p.raw) + '</span>' +
        '<span class="cx mini">' + (p.kind === 'core' ? '×' + p.w : '+' + Math.round(p.w * p.raw / 100 * 100) + '%') + '</span></div>';
    }).join('');

    var body =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:11px">' +
        V.swatch(pr.shape, pr.color, 20) +
        '<div class="m" style="font-size:30px;font-weight:600;line-height:1;color:' + pr.color + '">' + Math.round(h.RUI.score) + '</div>' +
        '<div><div>' + V.pill(pr.k, pr.label + ' priority') + '</div>' +
        '<div class="mini">core ' + d1(h.RUI.core) + ' × amplifier ' + d1(h.RUI.amp) + (h.RUI.capped ? ' (capped at 100)' : '') + '</div></div>' +
      '</div>' +
      V.note('', V.plainExplain(h)) +
      V.kv([
        ['Habitation', '<b>' + esc(h.name) + '</b> <span class="m mini">' + esc(h.id) + '</span>'],
        ['Block · terrain', esc(V.blockName(h.block)) + ' · ' + esc((SIM.district.blocks.filter(function (b) { return b.id === h.block; })[0] || {}).terrain || '')],
        ['Population · households', n(h.pop) + ' · ' + n(h.hh)],
        ['Corridor', esc((SIM.corridors.filter(function (c) { return c.id === h.corridor; })[0] || {}).name || '—')],
        ['Window', w.ongoing ? '<b style="color:#B3261E">hazard already impacting</b>' : 'T−' + d1(w.hrs) + ' h · ' + esc(w.event ? w.event.name : '')]
      ]) +
      '<div class="hr"></div>' +
      '<h4 style="margin:0 0 7px;font-size:12.5px">Hazard exposure — ' + Math.round(h.HEI.score) + '</h4>' + heiRows +
      '<div class="mini" style="margin-top:6px">Dominant hazard sets the floor; the others add ' + Math.round(h.HEI.compounding) + ' points of compounding on top.</div>' +
      '<div class="hr"></div>' +
      '<h4 style="margin:0 0 7px;font-size:12.5px">Vulnerability &amp; capability — ' + Math.round(h.VCI.score) + '</h4>' + vciRows +
      '<div class="hr"></div>' +
      '<h4 style="margin:0 0 7px;font-size:12.5px">Relocation urgency — ' + Math.round(h.RUI.score) + '</h4>' + ruiRows +
      '<div class="hr"></div>' +
      '<h4 style="margin:0 0 7px;font-size:12.5px">Demand</h4>' +
      V.kv([
        ['Evacuation fraction', pc(h.demand.evacFraction) + ' <span class="mini">from HEI ' + Math.round(h.HEI.score) + '</span>'],
        ['Must move', '<b>' + n(h.demand.mustMove) + '</b>'],
        ['Shelter dependency', pc(h.demand.shelterDependency) + ' <span class="mini">from VCI ' + Math.round(h.VCI.score) + '</span>'],
        ['Needs a shelter place', '<b>' + n(h.demand.shelterNeed) + '</b>'],
        ['Self-hosting', n(h.demand.selfHosted) + ' <span class="mini">kin, higher ground, embankment</span>'],
        ['High-dependency', n(h.demand.highDependency) + ' <span class="mini">needs a staffed bed</span>']
      ]) +
      '<div class="hr"></div>' +
      '<h4 style="margin:0 0 7px;font-size:12.5px">Reachable capacity — the coupling</h4>' +
      V.kv([
        ['Sites reachable in window', cs.sites.length + ' of ' + S.sites.length],
        ['Residual at those sites', n(cs.reachable)],
        ['Fair share after contest', '<b>' + n(cs.fairShare) + '</b> <span class="mini">weighted by all competing demand</span>'],
        ['Coverage', '<b style="color:' + (cs.coverage < 0.5 ? '#B3261E' : '#1B7F3B') + '">' + pc(Math.min(1, cs.coverage)) + '</b> of need'],
        ['Capacity stress', '<b>' + Math.round(cs.score) + '</b> / 100']
      ]) +
      '<div class="hr"></div>' +
      '<h4 style="margin:0 0 7px;font-size:12.5px">Allocation</h4>' +
      (as.length ? as.map(function (a) {
        return '<div class="constraint"><span class="cn">' + esc(a.siteName.replace(/,.*$/, '')) + '</span>' +
          '<span class="cb"><i style="width:' + Math.min(100, (a.persons / h.demand.shelterNeed) * 100) + '%;background:#1B7F3B"></i></span>' +
          '<span class="cv">' + n(a.persons) + '</span><span class="cx mini">' + Math.round(a.travelMin) + ' min</span></div>';
      }).join('') : '<div class="mini">No allocation.</div>') +
      (short > 0 ? V.note('r', '<b>' + n(short) + ' people unplaced.</b> ' + esc((S.plan.unmet.filter(function (u) { return u.habId === h.id; })[0] || {}).reason || '')) : V.note('g', 'Every person needing a shelter place has one held for them.'));

    drawer(esc(h.name), esc(h.id) + ' · ' + esc(V.blockName(h.block)) + ' block · ' + V.simTag(), body,
      '<button class="btn" data-act="focus-map" data-id="' + h.id + '">Show on map</button>' +
      '<button class="btn pri" data-act="wizard" data-id="' + h.id + '">Raise movement order</button>');

    APP.mapFocus = h.id;
    if (APP.route === 'deck') { APP.refreshMap(); MAP.zoomTo(h.xy, 420); }
  }

  /* ---- safe site drawer: the five ceilings, named ---- */
  function openSite(id) {
    var S = ENG.STATE;
    var s = S.sites.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var c = s.cap;
    var maxC = Math.max.apply(null, c.ceilings.map(function (x) { return x.v; }).concat([1]));

    var ceil = c.ceilings.slice().sort(function (a, b) { return a.v - b.v; }).map(function (x) {
      var isBind = x.k === c.binding.k;
      return '<div class="constraint' + (isBind ? ' bind' : '') + '">' +
        '<span class="cn">' + esc(x.label) + (isBind ? ' <b>· binding</b>' : '') + '</span>' +
        '<span class="cb"><i style="width:' + (x.v / maxC) * 100 + '%"></i></span>' +
        '<span class="cv">' + n(x.v) + '</span></div>' +
        '<div class="mini" style="margin:-3px 0 6px 132px">' + esc(x.basis) + '</div>';
    }).join('');

    var hp = ENG.siteHeiParts(s).slice().sort(function (a, b) { return b.v - a.v; }).map(function (p) {
      return '<div class="constraint"><span class="cn">' + esc(p.label) + '</span>' +
        '<span class="cb"><i style="width:' + p.v + '%"></i></span>' +
        '<span class="cv">' + Math.round(p.v) + '</span>' +
        '<span class="cx mini">' + (p.resisted ? 'resisted' : '') + '</span></div>';
    }).join('');

    var holders = S.plan.assignments.filter(function (a) { return a.siteId === s.id; });

    var body =
      (c.disqualified
        ? V.note('r', '<b>Disqualified.</b> This site\'s own hazard exposure is ' + d1(c.hei) + ', above the cutoff of ' +
            S.standards.siteHeiCutoff + '. It carries zero capacity no matter how large it is. It is on the DDMA register as a designated shelter.')
        : V.note('b', '<b>' + esc(c.binding.label) + ' is what caps this site</b> at ' + n(c.capacity) + ' places. ' +
            'The register claims ' + n(s.claimed) + '. ' + esc(c.binding.basis) + '.')) +
      V.kv([
        ['Site', '<b>' + esc(s.name) + '</b> <span class="m mini">' + esc(s.id) + '</span>'],
        ['Type · tier', esc(s.type) + ' · tier ' + s.tier],
        ['Claimed on register', '<b>' + n(s.claimed) + '</b>'],
        ['Derived capacity', c.disqualified ? '<b style="color:#B3261E">0</b>' : '<b>' + n(c.capacity) + '</b>'],
        ['Surge reserve', n(c.surge) + ' <span class="mini">' + pc(S.standards.surgeBuffer) + ' held for unregistered arrivals</span>'],
        ['Posted augmentation', s.aug > 0 ? '<b style="color:#1B7F3B">+' + n(s.aug) + '</b>' : '—'],
        ['Usable', '<b>' + n(s.usableTotal) + '</b>'],
        ['Committed', n(s.committed)],
        ['Residual', '<b style="color:' + (s.residual > 0 ? '#1B7F3B' : '#A96700') + '">' + n(s.residual) + '</b>']
      ]) +
      '<div class="hr"></div>' +
      '<h4 style="margin:0 0 7px;font-size:12.5px">The five ceilings</h4>' + ceil +
      '<div class="hr"></div>' +
      '<h4 style="margin:0 0 7px;font-size:12.5px">The site\'s own hazard exposure — ' + d1(c.hei) + '</h4>' + hp +
      '<div class="mini" style="margin-top:6px">Construction resistance (' + pc(s.resist) + ') is applied to the seismic term only. ' +
      'A retrofitted building survives shaking; it does not survive standing in water or downwind of a release.</div>' +
      '<div class="hr"></div>' +
      '<h4 style="margin:0 0 7px;font-size:12.5px">Readiness</h4>' +
      V.kv([
        ['Health staff on site', s.nurse + ' <span class="mini">need ' + c.staffNeed + '</span>'],
        ['Staffing gap', c.staffGap > 0 ? '<b style="color:#A96700">' + c.staffGap + '</b>' : '<span style="color:#1B7F3B">none</span>'],
        ['Staffed beds', s.beds + ' <span class="mini">need ' + c.medNeed + '</span>'],
        ['Bed gap', c.medGap > 0 ? '<b style="color:#A96700">' + c.medGap + '</b>' : '<span style="color:#1B7F3B">none</span>'],
        ['Feeding corridor', esc((SIM.corridors.filter(function (x) { return x.id === s.corridor; })[0] || {}).name || '—')],
        ['Note', esc(s.note)]
      ]) +
      '<div class="hr"></div>' +
      '<h4 style="margin:0 0 7px;font-size:12.5px">Who is held here</h4>' +
      (holders.length ? holders.map(function (a) {
        return '<div class="constraint"><span class="cn">' + esc(a.habName) + '</span>' +
          '<span class="cb"><i style="width:' + Math.min(100, (a.persons / Math.max(1, s.usableTotal)) * 100) + '%;background:#12447E"></i></span>' +
          '<span class="cv">' + n(a.persons) + '</span></div>';
      }).join('') : '<div class="mini">Nobody allocated here.</div>');

    drawer(esc(s.name), esc(s.id) + ' · ' + esc(s.type) + ' · ' + V.simTag(), body,
      (c.disqualified ? '<button class="btn" disabled>Cannot be used</button>'
        : '<button class="btn" data-act="release" data-id="' + s.id + '">Release places</button>') +
      '<button class="btn pri" data-act="focus-site" data-id="' + s.id + '">Show on map</button>');
  }

  /* ---- assignment drawer: why this site and not another ---- */
  function openAssign(pair) {
    var S = ENG.STATE;
    var parts = pair.split('|');
    var hb = S.habs.filter(function (x) { return x.id === parts[0]; })[0];
    var chosen = S.sites.filter(function (x) { return x.id === parts[1]; })[0];
    if (!hb || !chosen) return;

    var ranked = S.sites.map(function (s) {
      var cost = ENG.pairCost(hb, s, true);
      var t = ENG.travel(hb, s);
      return { s: s, cost: cost, t: t };
    }).sort(function (a, b) { return a.cost - b.cost; });

    var finite = ranked.filter(function (x) { return isFinite(x.cost); });
    var worst = finite.length ? finite[finite.length - 1].cost : 1;
    var rows = ranked.map(function (r) {
      var reason = '';
      if (!isFinite(r.cost)) {
        if (r.s.cap.disqualified) reason = 'site disqualified — stands in a red zone';
        else if (!isFinite(r.t.min)) reason = 'corridor cut';
        else reason = 'cannot be reached inside the window';
      }
      var isChosen = r.s.id === chosen.id;
      return '<div class="constraint' + (isChosen ? ' bind' : '') + '" style="align-items:flex-start">' +
        '<span class="cn">' + (isChosen ? '<b>' + esc(r.s.name.replace(/,.*$/, '')) + '</b> ✓' : esc(r.s.name.replace(/,.*$/, ''))) +
        '<div class="mini">' + (reason ? '<span style="color:#B3261E">' + reason + '</span>' : Math.round(r.t.min) + ' min · residual ' + n(r.s.residual)) + '</div></span>' +
        '<span class="cb"><i style="width:' + (isFinite(r.cost) ? Math.min(100, (r.cost / Math.max(1, worst)) * 100) : 100) + '%"></i></span>' +
        '<span class="cv">' + (isFinite(r.cost) ? d1(r.cost) : '∞') + '</span></div>';
    }).join('');

    var alt = ranked.filter(function (r) { return isFinite(r.cost) && r.s.id !== chosen.id; })[0];
    var chosenRow = ranked.filter(function (r) { return r.s.id === chosen.id; })[0];

    var body =
      V.note('b', '<b>' + esc(chosen.name) + '</b> was chosen for ' + esc(hb.name) + ' at cost ' + d1(chosenRow.cost) + '. ' +
        (alt ? 'The next best option, ' + esc(alt.s.name) + ', costs ' + d1(alt.cost) + ' — ' +
          (alt.t.min > chosenRow.t.min ? Math.round(alt.t.min - chosenRow.t.min) + ' minutes further' : 'a worse corridor or site exposure') + '.'
          : 'No alternative was available at all.')) +
      '<h4 style="margin:12px 0 7px;font-size:12.5px">Every site ranked by cost</h4>' + rows +
      '<div class="hr"></div>' +
      '<div class="formula">travel   ' + Math.round(chosenRow.t.min) + ' min × ' + ENG.COST_W.travel + '\n' +
      'corridor ' + d1((SIM.corridors.filter(function (c) { return c.id === chosen.corridor; })[0] || {}).hazard || 0) + ' × ' + ENG.COST_W.corridor + '\n' +
      'site HEI ' + d1(chosen.cap.hei / 100) + ' × ' + ENG.COST_W.siteHei + '\n' +
      'med gap  ' + (hb.demand.highDependency > 0 && chosen.beds === 0 ? '1' : '0') + ' × ' + ENG.COST_W.medMismatch + '\n' +
      'tier     ' + (chosen.tier - 1) + ' × ' + ENG.COST_W.tier + '\n' +
      '───────────────────────────\n' +
      'total    ' + d1(chosenRow.cost) + '</div>';

    drawer('Why ' + esc(chosen.name.replace(/,.*$/, '')) + '?', 'for ' + esc(hb.name), body,
      '<button class="btn" data-open="hab" data-id="' + hb.id + '">Habitation</button>' +
      '<button class="btn" data-open="site" data-id="' + chosen.id + '">Safe site</button>');
  }

  /* ---------------------------------------------------------------- modals */
  function closeModal() {
    var s = document.getElementById('scrim');
    s.classList.remove('on'); s.innerHTML = ''; openModalKind = null;
  }
  function modal(kind, html, cls) {
    var s = document.getElementById('scrim');
    s.innerHTML = '<div class="modal ' + (cls || '') + '" role="document">' + html + '</div>';
    s.classList.add('on'); openModalKind = kind;
    var f = s.querySelector('input,select,button.pri,button');
    if (f) f.focus();
  }

  /* The barrier between the public view and Government View.
     The command side carries habitation-level vulnerability records, exact
     site occupancy and operational routing. None of that is public-safe, so
     the crossing is explicit rather than a silent toggle. */
  function restricted() {
    modal('restricted',
      '<div class="mh"><div><h3>Restricted area</h3><div class="ms">Government View · sign-in required every time</div></div></div>' +
      '<div class="mb">' +
      V.note('y', '<b>This is not the public view.</b> Government View holds habitation-level vulnerability ' +
        'records, exact shelter occupancy and movement routing. Those are withheld from the public view on ' +
        'purpose — published vulnerability data tells anyone which households cannot leave on their own.') +
      '<div class="field"><label>Operator ID</label><input class="m" id="opId" placeholder="OP-0000" value="OP-4417"></div>' +
      '<div class="field"><label>Name</label><input id="opName" value="A. Rawat"></div>' +
      '<div class="field"><label>Rank / role</label><input id="opRank" value="Additional District Magistrate"></div>' +
      '<div class="field"><label>Unit</label><input id="opUnit" value="DDMA Sarai Ghat"></div>' +
      V.note('r', '<b>No credential is checked.</b> The gate demonstrates where authorisation belongs, nothing more. ' +
        'Leaving for the public view ends the session, so returning asks again.') +
      V.note('', 'Leaving for the public view ends the session, so coming back asks again. On a shared ' +
        'district terminal, the person who walks up next is not the person who signed in.') +
      '</div>' +
      '<div class="mf"><button class="btn" data-act="close-modal">Stay in the public view</button>' +
      '<button class="btn pri" data-act="signin-go">Enter Government View</button></div>',
      'narrow');
  }

  function signIn() {
    modal('signin',
      '<div class="mh"><div><h3>Operator sign-in</h3><div class="ms">Every allocation below is attributed to this operator</div></div></div>' +
      '<div class="mb">' +
      '<div class="field"><label>Operator ID</label><input class="m" id="opId" value="OP-4417"></div>' +
      '<div class="field"><label>Name</label><input id="opName" value="A. Rawat"></div>' +
      '<div class="field"><label>Rank / role</label><input id="opRank" value="Additional District Magistrate"></div>' +
      '<div class="field"><label>Unit</label><input id="opUnit" value="DDMA Sarai Ghat"></div>' +
      V.note('y', 'No credential is checked. This is a prototype. A production deployment needs SSO, role-based authorisation and an immutable audit trail — the ledger here is append-only in memory only.') +
      '</div>' +
      '<div class="mf"><button class="btn" data-act="close-modal">Cancel</button><button class="btn pri" data-act="signin-go">Enter command</button></div>',
      'narrow');
  }

  function standards() {
    var st = ENG.STATE.standards;
    modal('standards',
      '<div class="mh"><div><h3>Planning standards</h3><div class="ms">Change an assumption and every capacity figure re-derives</div></div></div>' +
      '<div class="mb">' +
      '<div class="field"><label>Covered area per person (m²)</label><input id="stArea" class="m" value="' + st.areaPerPerson + '"></div>' +
      '<div class="field"><label>Water per person per day (litres)</label><input id="stWater" class="m" value="' + st.waterPerPerson + '"></div>' +
      '<div class="field"><label>Persons per toilet</label><input id="stToilet" class="m" value="' + st.personsPerToilet + '"></div>' +
      '<div class="field"><label>Site HEI cutoff — disqualify above</label><input id="stCut" class="m" value="' + st.siteHeiCutoff + '"></div>' +
      '<div class="field"><label>Surge reserve (0–1)</label><input id="stSurge" class="m" value="' + st.surgeBuffer + '"></div>' +
      V.note('b', 'Area, water and sanitation defaults follow Sphere minimums. They are shown here rather than buried because the difference between 3.5 m² and 2.0 m² per person is the difference between a shelter and a crowd.') +
      '</div>' +
      '<div class="mf"><button class="btn" data-act="close-modal">Cancel</button><button class="btn pri" data-act="standards-go">Apply and re-derive</button></div>',
      'narrow');
  }

  /* ---- dispatch wizard: four steps, refuses to finish without backing ---- */
  var wiz = { step: 1, habId: null };
  function wizard(habId) {
    wiz.step = 1;
    wiz.habId = habId || (ENG.STATE.habs[0] && ENG.STATE.habs[0].id);
    renderWizard();
  }
  function renderWizard() {
    var S = ENG.STATE;
    var h = S.habs.filter(function (x) { return x.id === wiz.habId; })[0] || S.habs[0];
    var as = S.plan.assignments.filter(function (a) { return a.habId === h.id; });
    var got = as.reduce(function (t, a) { return t + a.persons; }, 0);
    var short = h.demand.shelterNeed - got;
    var d = ENG.deficit();

    var steps = ['Select', 'Verify capacity', 'Movement', 'Issue'].map(function (t, i) {
      var num = i + 1;
      return '<div class="step ' + (wiz.step === num ? 'on' : (wiz.step > num ? 'done' : '')) + '" data-n="' + num + '">' + t + '</div>';
    }).join('');

    var body = '';
    if (wiz.step === 1) {
      body = '<div class="field"><label>Habitation</label><select id="wizHab">' +
        S.habs.map(function (x) {
          return '<option value="' + x.id + '"' + (x.id === h.id ? ' selected' : '') + '>' +
            esc(x.name) + ' — RUI ' + Math.round(x.RUI.score) + ' · needs ' + n(x.demand.shelterNeed) + '</option>';
        }).join('') + '</select></div>' +
        V.kv([
          ['Priority', V.pillFor(h.RUI.score)],
          ['Population', n(h.pop)],
          ['Must move', n(h.demand.mustMove)],
          ['Needs a shelter place', '<b>' + n(h.demand.shelterNeed) + '</b>'],
          ['High-dependency', n(h.demand.highDependency)]
        ]);
    } else if (wiz.step === 2) {
      body = (as.length
        ? V.note('g', '<b>' + n(got) + ' places are held for ' + esc(h.name) + '</b> across ' + as.length + ' site(s), each already debited in the ledger.')
        : V.note('r', '<b>No capacity is held for ' + esc(h.name) + '.</b> An order cannot be issued.')) +
        (as.length ? as.map(function (a) {
          var st = S.sites.filter(function (s) { return s.id === a.siteId; })[0];
          return '<div class="constraint bind"><span class="cn">' + esc(st.name.replace(/,.*$/, '')) + '<div class="mini">' + esc(st.cap.binding.label) + '-capped · ' + n(st.residual) + ' free</div></span>' +
            '<span class="cb"><i style="width:' + Math.min(100, (a.persons / Math.max(1, st.usableTotal)) * 100) + '%;background:#1B7F3B"></i></span>' +
            '<span class="cv">' + n(a.persons) + '</span></div>';
        }).join('') : '') +
        (short > 0 ? V.note('r', '<b>' + n(short) + ' people have no place.</b> The order will cover only the ' + n(got) + ' who do. ' +
          'The remainder stays on the escalation list rather than being sent somewhere that cannot take them.') : '');
    } else if (wiz.step === 3) {
      var need = got;
      var hrs = d.rate > 0 ? need / d.rate : 0;
      var t = as.length ? Math.max.apply(null, as.map(function (a) { return a.travelMin; })) : 0;
      body = V.kv([
        ['People to move', '<b>' + n(need) + '</b>'],
        ['Fleet rate', n(d.rate) + ' persons/hour'],
        ['Longest leg', Math.round(t) + ' min'],
        ['Estimated completion', '<b>' + d1(hrs + t / 60) + ' h</b>'],
        ['Window to impact', d1(ENG.windowInfo(h).hrs) + ' h'],
        ['Feasible in window', (hrs + t / 60) <= ENG.windowInfo(h).hrs
          ? '<b style="color:#1B7F3B">yes</b>' : '<b style="color:#B3261E">no — request additional lift</b>']
      ]) +
      '<div class="field" style="margin-top:11px"><label>Movement assets</label><select id="wizAsset">' +
        SIM.assets.filter(function (a) { return a.status === 'available'; }).map(function (a) {
          return '<option value="' + a.id + '">' + esc(a.name) + ' — ' + n((a.perTrip / a.cycleMin) * 60) + '/hr</option>';
        }).join('') + '</select></div>' +
      '<div class="field"><label>Note for the movement order</label><textarea id="wizNote" rows="2" placeholder="e.g. livestock party to follow; two bedridden in lane 4"></textarea></div>';
    } else {
      body = (got > 0
        ? V.note('g', '<b>Ready to issue.</b> ' + n(got) + ' people from ' + esc(h.name) + ', backed by ' + as.length + ' debited allocation(s). ' +
            'The order will be attributed to ' + esc(S.operator ? S.operator.id : 'SYSTEM') + ' and written to the ledger.')
        : V.note('r', '<b>Refused.</b> There is no debited allocation behind this order. Issuing it would tell people to walk to a shelter that may already be full. Lift a binding constraint or escalate instead.')) +
        (as.length ? as.map(function (a) {
          return '<div class="constraint"><span class="cn">' + esc(a.siteName.replace(/,.*$/, '')) + '</span>' +
            '<span class="cb"><i style="width:100%;background:#1B7F3B"></i></span><span class="cv">' + n(a.persons) + '</span></div>';
        }).join('') : '');
    }

    modal('wizard',
      '<div class="mh"><div><h3>Relocation order — ' + esc(h.name) + '</h3><div class="ms">Step ' + wiz.step + ' of 4</div></div></div>' +
      '<div class="mb"><div class="steps">' + steps + '</div>' + body + '</div>' +
      '<div class="mf">' +
      (wiz.step > 1 ? '<button class="btn" data-act="wiz-back">Back</button>' : '<button class="btn" data-act="close-modal">Cancel</button>') +
      (wiz.step < 4
        ? '<button class="btn pri" data-act="wiz-next">Continue</button>'
        : '<button class="btn ' + (got > 0 ? 'pri' : '') + '" data-act="wiz-issue"' + (got > 0 ? '' : ' disabled') + '>Issue order</button>') +
      '</div>');
  }

  function escalate() {
    var d = ENG.deficit();
    var augs = ENG.augmentations().filter(function (a) { return a.delta > 0 && a.leadHrs <= 6; });
    var closeable = augs.reduce(function (t, a) { return t + a.delta; }, 0);
    var residual = Math.max(0, d.capacityDeficit - closeable);
    var S = ENG.STATE;

    modal('escalate',
      '<div class="mh"><div><h3>Escalation to State EOC</h3><div class="ms">Generated from the ledger — nothing here is typed by hand</div></div></div>' +
      '<div class="mb">' +
      V.kv([
        ['District', esc(SIM.district.name) + ' <span class="sim">simulated</span>'],
        ['Raised by', esc(S.operator ? S.operator.name + ' (' + S.operator.id + ')' : 'SYSTEM')],
        ['Total shelter need', '<b>' + n(d.demand) + '</b>'],
        ['Usable capacity in district', n(d.totalUsable) + ' <span class="mini">register claims ' + n(d.claimedTotal) + '</span>'],
        ['Placed', n(d.placed)],
        ['Capacity deficit', '<b style="color:#B3261E">' + n(d.capacityDeficit) + '</b>'],
        ['Closeable locally ≤6 h', '<b style="color:#1B7F3B">' + n(closeable) + '</b>'],
        ['Residual — transfer required', '<b style="color:#B3261E">' + n(residual) + '</b>'],
        ['Window to next impact', d1(d.windowHrs) + ' h']
      ]) +
      '<div class="hr"></div>' +
      '<h4 style="margin:0 0 7px;font-size:12.5px">Habitations with unplaced population</h4>' +
      (S.plan.unmet.length ? S.plan.unmet.map(function (u) {
        return '<div class="constraint bind"><span class="cn">' + esc(u.habName) + '<div class="mini">' + esc(u.reason) + '</div></span>' +
          '<span class="cb"><i style="width:100%"></i></span><span class="cv">' + n(u.persons) + '</span></div>';
      }).join('') : '<div class="mini">None.</div>') +
      '<div class="hr"></div>' +
      '<h4 style="margin:0 0 7px;font-size:12.5px">Local actions already identified</h4>' +
      augs.slice(0, 6).map(function (a) {
        return '<div class="constraint"><span class="cn">' + esc(a.title) + '<div class="mini">' + esc(a.siteName) + '</div></span>' +
          '<span class="cb"><i style="width:' + Math.min(100, (a.delta / Math.max(1, closeable)) * 260) + '%;background:#1B7F3B"></i></span>' +
          '<span class="cv">+' + n(a.delta) + '</span></div>';
      }).join('') +
      V.note('y', 'This is a prototype. Nothing is transmitted anywhere.') +
      '</div>' +
      '<div class="mf"><button class="btn" data-act="close-modal">Close</button>' +
      '<button class="btn pri" data-act="export-escalation">Download request</button></div>',
      'wide');
  }

  /* ---- the record: coverflow layout, and the detail behind a card ---- */
  function cfLayout() {
    var idx = ENG.STATE.cfIndex || 0;
    var cards = document.querySelectorAll('.cf-card');
    if (!cards.length) return;
    var N = cards.length;
    for (var i = 0; i < N; i++) {
      /* Circular offset: with six cards a linear offset leaves the front card
         at one end of an empty stage. Wrapping keeps depth on both sides. */
      var d = ((i - idx) % N + N + Math.floor(N / 2)) % N - Math.floor(N / 2);
      var ad = Math.abs(d), el = cards[i], sign = d < 0 ? -1 : 1;
      el.classList.toggle('on', d === 0);
      el.setAttribute('aria-current', String(d === 0));
      if (ad > 2) {
        el.style.opacity = '0'; el.style.pointerEvents = 'none'; el.style.zIndex = '0';
        el.style.transform = 'translateX(' + (sign * 140) + '%) translateZ(-520px) rotateY(' + (-sign * 46) + 'deg)';
        continue;
      }
      el.style.pointerEvents = 'auto';
      var tx = ad === 0 ? 0 : sign * (ad === 1 ? 50 : 90);
      var tz = ad === 0 ? 0 : (ad === 1 ? -210 : -430);
      var ry = ad === 0 ? 0 : -sign * (ad === 1 ? 36 : 44);
      el.style.transform = 'translateX(' + tx + '%) translateZ(' + tz + 'px) rotateY(' + ry + 'deg) scale(' + (1 - ad * 0.055) + ')';
      el.style.opacity = String(1 - ad * 0.28);
      el.style.zIndex = String(30 - ad * 10);
    }
    var dots = document.querySelectorAll('.cf-dots button');
    for (var j = 0; j < dots.length; j++) dots[j].setAttribute('aria-current', String(j === idx));
  }
  function cfGo(what) {
    var n0 = RECORD.length, idx = ENG.STATE.cfIndex || 0;
    if (what === 'prev') idx = (idx - 1 + n0) % n0;
    else if (what === 'next') idx = (idx + 1) % n0;
    else {
      var t = parseInt(what, 10);
      if (isNaN(t)) return;
      if (t === idx) { openRecord(t); return; }   // clicking the front card opens it
      idx = t;
    }
    ENG.STATE.cfIndex = idx;
    cfLayout();
  }

  function openRecord(i) {
    var r = RECORD[i]; if (!r) return;
    var body =
      '<div class="drawerart">' +
      sceneSVG(r.kind, r.id + 'd') + V.photoLayer(r) + '</div>' +
      V.kv([['When', esc(r.date)], ['Where', esc(r.place)], ['Type', esc(r.kindLabel)]]) +
      '<div class="hr"></div>' +
      '<h4 style="margin:0 0 7px;font-size:12.5px">What happened</h4>' +
      V.kv(r.facts.map(function (f) { return [f[0], esc(f[1])]; })) +
      '<div class="hr"></div>' +
      V.note('r', '<b>' + esc(r.lesson) + '</b>') +
      '<h4 style="margin:11px 0 7px;font-size:12.5px">What AapdaSync does about it</h4>' +
      '<p style="font-size:12.5px;color:#48586E;margin:0">' + esc(r.mechanism) + '</p>' +
      '<div class="hr"></div>' +
      '<div class="mini">Source: <a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.source) + '</a>. ' +
      'Figures are as reported there. Where sources disagree — they usually do on mortality — the disagreement is shown ' +
      'rather than resolved.</div>';
    drawer(esc(r.year + ' · ' + r.name), esc(r.place) + ' · <b>real event</b>, unlike everything else in this prototype', body,
      '<button class="btn" data-cf="prev">Previous</button><button class="btn" data-cf="next">Next</button>');
  }

  /* ---- a state on the national map ---- */
  function openState(id) {
    var e = NAT.entry(id), st = NAT.byId(id);
    if (!st) return;
    if (!e) {
      drawer(esc(st.name), 'no declared event', V.note('g', 'No state EOC declaration is on the national feed for ' + esc(st.name) + '.') +
        '<div class="mini">Absence of a declaration is not evidence of safety. It means nothing has been reported to this system.</div>', '');
      return;
    }
    var home = id === SIM.homeState, pr = ENG.priority(e.sev);
    var body =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:11px">' +
      V.swatch(pr.shape, pr.color, 20) +
      '<div class="m" style="font-size:30px;font-weight:600;line-height:1;color:' + pr.color + '">' + e.sev + '</div>' +
      '<div><div>' + V.pill(pr.k, pr.label + ' — declared') + '</div>' +
      '<div class="mini">' + (home ? 'district feed connected' : 'declared only, not computed') + '</div></div></div>' +
      (home
        ? V.note('g', '<b>This is the one state with a connected district feed.</b> Everything on the command screens for ' +
            esc(SIM.district.name) + ' is derived from raw inputs and can be traced back to them.')
        : V.note('y', '<b>Declared, not derived.</b> These are the figures ' + esc(st.name) + ' has reported. ' +
            'AapdaSync has not seen its habitation register or its shelter inventory, so it cannot tell you whether ' +
            'the shelter capacity behind that population figure actually exists. That is precisely the gap this system closes ' +
            'once a district connects.')) +
      V.kv([
        ['State', '<b>' + esc(st.name) + '</b>'],
        ['Declared severity', '<b>' + e.sev + '</b> / 100'],
        ['Districts affected', e.affected + ' of ' + e.districts],
        ['Population reported at risk', '<b>' + n(e.popAtRisk) + '</b>'],
        ['Derived capacity', home ? '<b>' + n(ENG.deficit().totalUsable) + '</b> usable places' : '<span style="color:#A96700">not available — no feed</span>'],
        ['Feed', home ? V.pill('low', 'connected') : V.pill('off', 'declared only')]
      ]) +
      '<div class="hr"></div>' +
      '<h4 style="margin:0 0 7px;font-size:12.5px">Declared events</h4>' +
      e.events.map(function (x) {
        return '<div class="constraint"><span class="cn" style="flex:1">' + esc(x) + '</span></div>';
      }).join('') +
      '<div class="hr"></div><div class="mini">' + esc(e.note) + '</div>';
    drawer(esc(st.name), (home ? 'connected' : 'declared only') + ' · ' + V.simTag(), body,
      home ? '<button class="btn pri" data-map="drill" style="width:100%">Open ' + esc(SIM.district.name) + ' district</button>'
           : '<button class="btn" disabled style="width:100%">No district feed to open</button>');
  }

  /* --------------------------------------------------------------- palette */
  var palIdx = 0, palItems = [];
  function openPalette() {
    var p = document.getElementById('palette');
    p.classList.add('on');
    var i = document.getElementById('palInput');
    i.value = ''; i.focus();
    buildPalette('');
  }
  function closePalette() { document.getElementById('palette').classList.remove('on'); }

  function buildPalette(q) {
    q = (q || '').toLowerCase();
    var S = ENG.STATE;
    var groups = [
      { g: 'Navigate', items: APP.ROUTES.map(function (r) { return { t: r.title, s: 'Go to ' + r.title, run: function () { APP.go(r.k); } }; }) },
      { g: 'Action', items: [
        { t: 'Re-run the solver', s: 'Recompute the assignment', run: function () { APP.recompute(); } },
        { t: 'Commit plan to ledger', s: 'Post every allocation', run: function () { commitPlan(); } },
        { t: 'Dispatch wizard', s: 'Ctrl D', run: function () { wizard(); } },
        { t: 'Escalate residual deficit', s: 'Generate a State EOC request', run: function () { escalate(); } },
        { t: 'Planning standards', s: 'Change an assumption', run: function () { standards(); } }
      ] },
      { g: 'Scenario', items: SIM.scenarios.map(function (s) {
        return { t: s.name, s: s.desc, run: function () { APP.setScenario(s.id); } };
      }) },
      { g: 'Habitations', items: S.habs.map(function (h) {
        return { t: h.name, s: h.id + ' · RUI ' + Math.round(h.RUI.score) + ' · needs ' + n(h.demand.shelterNeed), run: function () { openHab(h.id); } };
      }) },
      { g: 'Safe sites', items: S.sites.map(function (s) {
        return { t: s.name, s: s.id + ' · ' + (s.cap.disqualified ? 'disqualified' : n(s.residual) + ' free · ' + s.cap.binding.label), run: function () { openSite(s.id); } };
      }) }
    ];

    palItems = []; var html = '';
    groups.forEach(function (gr) {
      var matched = gr.items.filter(function (it) {
        return !q || (it.t + ' ' + it.s).toLowerCase().indexOf(q) >= 0;
      });
      if (!matched.length) return;
      html += '<div class="palgrp">' + esc(gr.g) + '</div>';
      matched.slice(0, 8).forEach(function (it) {
        var idx = palItems.length; palItems.push(it);
        html += '<button class="palitem" data-pal="' + idx + '"><span>' + esc(it.t) + '</span><span class="pt">' + esc(it.s) + '</span></button>';
      });
    });
    if (!palItems.length) html = '<div class="palgrp">No match</div>';
    document.getElementById('palRes').innerHTML = html;
    palIdx = 0; hilite();
  }
  function hilite() {
    var els = document.querySelectorAll('.palitem');
    for (var i = 0; i < els.length; i++) els[i].classList.toggle('on', i === palIdx);
    if (els[palIdx]) els[palIdx].scrollIntoView({ block: 'nearest' });
  }
  function palMove(d) { if (!palItems.length) return; palIdx = (palIdx + d + palItems.length) % palItems.length; hilite(); }
  function palRun(i) {
    var it = palItems[i == null ? palIdx : i];
    if (!it) return;
    closePalette(); it.run();
  }

  /* ---------------------------------------------------------------- actions */
  function commitPlan() {
    var S = ENG.STATE;
    if (!S.plan || !S.plan.assignments.length) { toast('Nothing to commit', 'The solver produced no allocations.', 'warn'); return; }
    if (ENG.ledger.filter(function (e) { return e.type === 'ALLOC'; }).length) {
      toast('Already committed', 'Release places or re-run the solver before committing again.', 'warn'); return;
    }
    var r = ENG.commitPlan(S.operator ? S.operator.id : 'SYSTEM', 'Solver plan committed');
    toast('Plan committed', r.postings + ' postings, ' + n(r.people) + ' places debited across the register.', 'ok');
    APP.render();
  }

  function doAugment(id) {
    var a = ENG.augmentations().filter(function (x) { return x.id === id; })[0];
    if (!a || a.delta <= 0) { toast('Nothing to post', 'This constraint cannot be relieved.', 'warn'); return; }
    ENG.applyAugmentation(a, ENG.STATE.operator ? ENG.STATE.operator.id : 'SYSTEM');
    ENG.solve();
    toast('Augmentation posted', '+' + n(a.delta) + ' places at ' + a.siteName + ' in ' + a.leadHrs + ' h. Re-solved.', 'ok');
    V.clearSweep();
    APP.render();
  }

  function releasePrompt(siteId) {
    var s = ENG.STATE.sites.filter(function (x) { return x.id === siteId; })[0];
    if (!s || s.committed <= 0) { toast('Nothing held', 'No places are committed at this site.', 'warn'); return; }
    modal('release',
      '<div class="mh"><div><h3>Release places</h3><div class="ms">' + esc(s.name) + '</div></div></div>' +
      '<div class="mb">' +
      '<div class="field"><label>Places to release (held: ' + n(s.committed) + ')</label><input id="relN" class="m" value="' + s.committed + '"></div>' +
      '<div class="field"><label>Reason</label><input id="relWhy" value="Site condition changed"></div>' +
      V.note('b', 'This writes a compensating RELEASE posting. The original allocation is not deleted — both entries stay in the ledger, so the history of the decision survives the reversal.') +
      '</div>' +
      '<div class="mf"><button class="btn" data-act="close-modal">Cancel</button><button class="btn dgr" data-act="release-go" data-id="' + siteId + '">Post release</button></div>',
      'narrow');
  }

  /* ------------------------------------------------------------- photographs */
  function photoManager() {
    var rows = RECORD.map(function (r) {
      var st = PHOTOS.get(r.id);
      return '<div class="prow" data-drop="' + esc(r.id) + '">' +
        '<div class="pth">' + (st
          ? '<img src="' + st.src + '" alt="">'
          : '<span class="pthx">' + esc(r.year) + '</span>') + '</div>' +
        '<div class="pmeta">' +
          '<b>' + esc(r.year + ' · ' + r.name) + '</b>' +
          '<div class="mini">' + esc(r.place) + '</div>' +
          (st
            ? '<input class="pcred" data-credit="' + esc(r.id) + '" placeholder="Credit — photographer, licence, source" value="' + esc(st.credit || '') + '">' +
              '<div class="mini">' + st.w + '×' + st.h + ' · ' + Math.round(st.bytes / 1024) + ' KB' +
              '<span class="pmiss" style="color:#A96700' + (st.credit ? ';display:none' : '') +
              '"> · credit missing</span></div>'
            : '<div class="mini">Using the bundled photograph. Drop a file here to replace it, or choose one.</div>' +
              (r.prompt ? '<details class="pprompt"><summary>Prompt for an image generator</summary>' +
                '<textarea readonly rows="3" class="ppt" onclick="this.select()">' + esc(r.prompt) + '</textarea></details>' : '')) +
        '</div>' +
        '<div class="pact">' +
          '<label class="btn sm">Choose<input type="file" accept="image/*" data-pick="' + esc(r.id) + '" hidden></label>' +
          (st ? '<button class="btn sm" data-act="photo-del" data-id="' + esc(r.id) + '">Remove</button>' : '') +
        '</div>' +
        '</div>';
    }).join('');

    var kb = Math.round(PHOTOS.bytes() / 1024);
    modal('photos',
      '<div class="mh"><div><h3>Add photographs</h3><div class="ms">' + PHOTOS.count() + ' of ' + RECORD.length +
      ' cards have one · ' + kb + ' KB stored</div></div></div>' +
      '<div class="mb">' +
      V.note('b', '<b>Nothing is uploaded.</b> Files are downscaled and kept in this browser. ' +
        'You can also drop a photograph straight onto a card in the carousel.') +
      V.note('y', '<b>The bundled photographs have unverified provenance.</b> They were supplied with this build, ' +
        'no credit or licence is recorded for any of them, and several are not the event on their card — each one ' +
        'says what it actually shows, on screen at all times. Replace any of them below and your credit takes over.') +
      V.note('', '<b>No image model runs inside this page.</b> To use AI-generated images, make them in whatever ' +
        'tool you prefer — each card below carries a ready-made prompt — then bring all six back here at once ' +
        'with <b>Choose several at once</b>.') +
      (PHOTOS.storageOK ? '' : V.note('y', '<b>Browser storage is unavailable or full.</b> ' +
        'Photographs will work for this session but will not survive a reload.')) +
      '<label class="btn pri pbulk">Choose several at once' +
        '<input type="file" accept="image/*" multiple data-pickmany="1" hidden></label>' +
      '<div class="mini pbulkm">Files are assigned to the cards below in the order you pick them, ' +
        'skipping any card that already has one. Six files fills the set.</div>' +
      '<div class="plist">' + rows + '</div>' +
      V.note('', '<b>Fill in the credit.</b> Most freely-licensed photographs — CC BY, CC BY-SA — legally ' +
        'require attribution, and a credit box filled in later is a credit box left empty. ' +
        'Wikimedia Commons categories for all six events are listed in <span class="m">assets/photos/README.txt</span>.') +
      '</div>' +
      '<div class="mf">' +
      (PHOTOS.count() ? '<button class="btn" data-act="photo-clear">Remove all</button>' : '') +
      '<button class="btn pri" data-act="close-modal">Done</button></div>',
      'wide');
  }

  /* Bulk import. Generated images arrive as a folder of six, and making
     someone place them one at a time — six dialogs, six chances to put Bhopal
     on the Kerala card — is the kind of friction that stops the feature being
     used at all. Files fill the empty cards in order; cards that already have
     a photograph are left alone, so a second import tops up rather than
     overwriting what is there. */
  function takePhotos(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var open = RECORD.filter(function (r) { return !PHOTOS.get(r.id); }).map(function (r) { return r.id; });
    if (!open.length) {
      toast('Every card already has one', 'Remove a photograph first, or drop a file straight onto a card to replace it.', 'warn');
      return;
    }
    var pairs = list.slice(0, open.length).map(function (f, i) { return [open[i], f]; });
    var done = 0, ok = 0, lastMsg = '';

    /* Sequential, not parallel: each ingest decodes and re-encodes on a canvas,
       and six at once on a phone is how you get an out-of-memory tab. */
    (function next(i) {
      if (i >= pairs.length) {
        toast(ok + ' image' + (ok === 1 ? '' : 's') + ' added',
          (list.length > open.length ? (list.length - open.length) + ' ignored — no empty cards left. ' : '') + lastMsg,
          ok ? 'ok' : 'warn');
        if (document.getElementById('scrim').classList.contains('on')) photoManager();
        APP.render();
        return;
      }
      PHOTOS.ingest(pairs[i][0], pairs[i][1], function (res) {
        done++; if (res.ok) { ok++; lastMsg = res.msg; }
        next(i + 1);
      });
    })(0);
  }

  function takePhoto(id, file) {
    PHOTOS.ingest(id, file, function (res) {
      if (!res.ok) { toast('Could not add that image', res.msg, 'warn'); return; }
      var r = RECORD.filter(function (x) { return x.id === id; })[0];
      toast('Photograph added', (r ? r.name + ' — ' : '') + res.w + '×' + res.h + '. ' + res.msg, 'ok');
      if (document.getElementById('scrim').classList.contains('on')) photoManager();
      APP.render();
    });
  }

  /* ---------------------------------------------------- relief contribution */
  function repaintRelief() {
    var el = document.getElementById('reliefPanel');
    if (!el) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = V.reliefPanel();
    el.parentNode.replaceChild(wrap.firstChild, el);
  }
  function pickNeed(id) { ENG.STATE.reliefSel = id; repaintRelief(); }
  function pickAmount(v) { ENG.STATE.reliefAmt = parseInt(v, 10) || 2000; repaintRelief(); }
  function pickPay(v) { ENG.STATE.reliefPay = v; repaintRelief(); }

  function contribute() {
    var sel = ENG.STATE.reliefSel, amt = ENG.STATE.reliefAmt || 2000;
    var pay = { upi: 'UPI', card: 'Card', nb: 'Net banking' }[ENG.STATE.reliefPay || 'upi'];
    if (!sel) { toast('Nothing selected', 'Choose a constraint to fund.', 'warn'); return; }
    var before = ENG.deficit().capacityDeficit;
    var r = ENG.contribute(sel, amt, pay);
    if (!r.ok) { toast('Could not record', r.msg, 'warn'); return; }
    var after = ENG.deficit().capacityDeficit;
    receipt(r, pay, before, after);
    if (r.fullyFunded) {
      V.clearSweep();
      toast('Constraint lifted', n(r.unlocked) + ' places released at ' + r.need.siteName +
        '. District deficit fell from ' + n(before) + ' to ' + n(after) + '.', 'ok');
    }
    APP.render();
  }

  function receipt(r, pay, before, after) {
    var t = new Date();
    modal('receipt',
      '<div class="mh"><div><h3>Contribution recorded</h3><div class="ms">Nothing was charged — this is a prototype</div></div></div>' +
      '<div class="mb">' +
      '<div class="receipt">' +
        '<div class="simstamp">Simulated · no payment processed · no money moved</div>' +
        '<div class="rh"><div class="rt">Amount recorded</div><div class="rv">₹' + n(r.applied) + '</div>' +
        '<div style="font-size:11.5px;color:#A9BDD6;margin-top:4px">' + esc(pay) + ' · ' + esc(r.ref) + ' · ' +
        t.toLocaleString('en-IN') + '</div></div>' +
        '<div class="rb">' + V.kv([
          ['Funded', '<b>' + esc(r.need.title) + '</b>'],
          ['Site', esc(r.need.siteName)],
          ['Unit cost', esc(r.need.unit)],
          ['Rate', '₹' + r.need.perPlace + ' per shelter place'],
          ['Progress', n(Math.min(r.need.costNum, (ENG.STATE.relief[r.need.id] || 0))) + ' of ₹' + n(r.need.costNum)],
          ['Places released now', r.fullyFunded ? '<b style="color:#1B7F3B">' + n(r.unlocked) + '</b>' : '<span class="mini">0 — releases when fully funded</span>'],
          ['District deficit', before === after
            ? n(before) + ' — unchanged'
            : '<b>' + n(before) + ' → ' + n(after) + '</b> <span style="color:#1B7F3B">(−' + n(before - after) + ')</span>']
        ]) + '</div>' +
      '</div>' +
      (r.refunded > 0 ? V.note('b', '₹' + n(r.refunded) + ' of your amount was not applied — this constraint needed only ₹' + n(r.applied) + ' more. In a real system that surplus would go to the next constraint or back to you, and it would say which.') : '') +
      V.note('', '<b>What this receipt does not do.</b> It is not a financial record, it is not a tax document, ' +
        'and it does not evidence a transaction, because there was none. It exists to show the shape of the thing: ' +
        'a contribution tied to one named constraint at one named site, with the number of places it releases ' +
        'computed by the same model that produced the deficit.') +
      '</div>' +
      '<div class="mf"><button class="btn" data-act="close-modal">Close</button>' +
      '<button class="btn pri" data-act="export-receipt" data-id="' + esc(r.ref) + '">Download record</button></div>');
    STATE_RECEIPT = { r: r, pay: pay, before: before, after: after, at: t };
  }
  var STATE_RECEIPT = null;

  function exportReceipt() {
    if (!STATE_RECEIPT) return;
    var s0 = STATE_RECEIPT, lines = [];
    lines.push('SIMULATED — NO PAYMENT WAS PROCESSED — NOT A FINANCIAL RECORD');
    lines.push('');
    lines.push('AapdaSync — relief contribution record');
    lines.push('Reference     ' + s0.r.ref);
    lines.push('Recorded      ' + s0.at.toString());
    lines.push('Amount        ₹' + n(s0.r.applied));
    lines.push('Method        ' + s0.pay + ' (label only — no detail was collected)');
    lines.push('');
    lines.push('Funded        ' + s0.r.need.title);
    lines.push('Site          ' + s0.r.need.siteName);
    lines.push('Unit cost     ' + s0.r.need.unit);
    lines.push('Rate          ₹' + s0.r.need.perPlace + ' per shelter place');
    lines.push('Released now  ' + (s0.r.fullyFunded ? s0.r.unlocked + ' places' : '0 — releases when fully funded'));
    lines.push('Deficit       ' + s0.before + ' → ' + s0.after);
    lines.push('');
    lines.push('This file is generated by a student prototype using simulated data.');
    download('aapdasync-contribution-SIMULATED.txt', lines.join('\n'), 'text/plain');
  }

  /* ------------------------------------------------------------------- ask */
  function ask(q) {
    ENG.STATE.askQ = q;
    ENG.STATE.askAnswer = RAG.ask(q);
    APP.render();
    var i = document.getElementById('askInput');
    if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }

  /* ---- why this forecast score ---- */
  function openForecast(habId) {
    var h = ENG.STATE.habs.filter(function (x) { return x.id === habId; })[0];
    if (!h) return;
    var r = FORECAST.predict(habId), tr = FORECAST.trend(habId);
    if (!r) return;
    var bd = FORECAST.band(r.p), conf = FORECAST.confidenceFor(r.p, r);
    ENG.STATE.fcSel = habId;

    var maxAbs = Math.max.apply(null, r.parts.map(function (p) { return Math.abs(p.contribution); }));
    var contrib = r.parts.slice(0, 9).map(function (p) {
      var pos = p.contribution >= 0;
      return '<div class="constraint"><span class="cn">' + esc(p.f.replace(/_/g, ' ')) + '</span>' +
        '<span class="cb"><i style="width:' + (Math.abs(p.contribution) / maxAbs * 100) + '%;background:' +
        (pos ? '#B3261E' : '#1B7F3B') + '"></i></span>' +
        '<span class="cv" style="color:' + (pos ? '#B3261E' : '#1B7F3B') + '">' +
        (pos ? '+' : '') + p.contribution.toFixed(2) + '</span>' +
        '<span class="cx mini">' + (Math.round(p.raw * 100) / 100) + '</span></div>';
    }).join('');

    var body =
      '<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:10px">' +
      '<div class="m" style="font-size:34px;font-weight:600;line-height:1">' + Math.round(r.p * 100) + '%</div>' +
      '<div><div>' + V.pill(bd.k, bd.label) + ' ' + V.pill(conf.level, conf.label) + '</div>' +
      '<div class="mini">chance of a hazard impact within 7 days</div></div></div>' +
      V.note('', esc(conf.why)) +
      (r.extrapolating ? V.note('y', '<b>Outside the fitted range.</b> ' + esc(r.farFeatures.join(', ')) +
        ' lie more than three standard deviations from anything in training. The probability is an extrapolation.') : '') +
      V.kv([
        ['Habitation', '<b>' + esc(h.name) + '</b> <span class="m mini">' + esc(h.id) + '</span>'],
        ['Trend vs last week', tr ? (tr.label + ' (' + (tr.delta >= 0 ? '+' : '') + Math.round(tr.delta * 100) + ' pts)') : '—'],
        ['Expected people exposed', n(r.p * h.pop) + ' <span class="mini">probability × population</span>'],
        ['Observed base rate here', ((MODEL.observed || {})[habId] != null
          ? Math.round(MODEL.observed[habId] * 100) + '% <span class="mini">held-out year</span>' : '—')]
      ]) +
      '<div class="hr"></div>' +
      '<h4 style="margin:0 0 3px;font-size:12.5px">Why this score</h4>' +
      '<div class="mini" style="margin-bottom:7px">Each bar is coefficient × standardised feature — the exact ' +
      'contribution to the log-odds. Red pushes the probability up, green pulls it down. The raw value is on the right.</div>' +
      contrib +
      '<div class="hr"></div>' +
      V.note('y', '<b>This is a ranking aid, not a warning.</b> No evacuation follows from it. ' +
        'Held-out AUC ' + MODEL.metrics.auc + ', Brier ' + MODEL.metrics.brier + ', base rate ' +
        MODEL.metrics.base_rate + '. Trained on a simulated history.');

    drawer(esc(h.name) + ' — 7-day forecast', 'model output · ' + V.simTag(), body,
      '<button class="btn" data-open="hab" data-id="' + habId + '">Habitation</button>' +
      '<button class="btn pri" data-act="focus-map" data-id="' + habId + '">Show on map</button>');
  }

  function exportForecast() {
    var rows = [['habitation', 'block', 'p_impact_7d', 'band', 'trend', 'confidence', 'largest_driver',
                 'expected_people', 'extrapolating', 'model_auc', 'simulated']];
    FORECAST.board().forEach(function (r) {
      rows.push([r.hab.name, V.blockName(r.hab.block), Math.round(r.p * 1000) / 1000,
        FORECAST.band(r.p).label, r.trend ? r.trend.label : '', r.confidence.label,
        (r.parts[0] || {}).f || '', Math.round(r.expected), r.extrapolating ? 'YES' : 'NO',
        MODEL.metrics.auc, 'YES']);
    });
    download('aapdasync-forecast-SIMULATED.csv', csv(rows), 'text/csv');
  }

  /* ----------------------------------------------------------------- export */
  /* Three ways a build can hand over a file, tried in the order of how good the
     result is for the person asking:

       1. file:// or a plain web server — an <a download> blob, which is the
          normal thing and needs no permission.
       2. The hosted page — <a download> is inert inside the artifact viewer,
          so the host's save surface is asked instead. The viewer confirms.
       3. Anything else, or a refusal that is not a plain "no" — the payload is
          put on screen in full, ready to copy.

     Silence was never an option. An export button that appears to work and
     produces nothing is worse than one that says it cannot. */
  function embedded() {
    try { return window.top !== window.self; } catch (e) { return true; }
  }

  var savePromise = null;
  function saver() {
    if (!savePromise) {
      savePromise = (window.claude && typeof window.claude.use === 'function')
        ? window.claude.use('downloads').catch(function () { return null; })
        : Promise.resolve(null);
    }
    return savePromise;
  }

  function download(name, text, mime) {
    if (!embedded()) {
      try {
        var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
        toast('Downloaded', name, 'ok');
        return;
      } catch (e) { showPayload(name, text); return; }
    }
    hostSave(name, text);
  }

  /* The host allows txt/json/md everywhere and csv only where extended types
     are enabled, so a refused .csv is retried once as .txt rather than thrown
     away — same bytes, a name the viewer's save surface will accept. */
  function hostSave(name, text, retried) {
    saver().then(function (dl) {
      if (!dl) { showPayload(name, text); return; }
      return dl.save({ filename: name, data: text }).then(function () {
        toast('Saved', name, 'ok');
      }, function (err) {
        var code = (err && err.code) || 'unavailable';
        if (code === 'extension_not_enabled' && !retried) {
          hostSave(name.replace(/\.[^.]+$/, '') + '.txt', text, true);
          return;
        }
        if (code === 'declined') { toast('Not saved', 'You declined the download.', 'warn'); return; }
        if (code === 'rate_limited') { toast('Try again', 'A save prompt is already open.', 'warn'); return; }
        showPayload(name, text);
      });
    }).catch(function () { showPayload(name, text); });
  }

  function showPayload(name, text) {
    modal('payload',
      '<div class="mh"><div><h3>' + esc(name) + '</h3><div class="ms">' +
      (text.length > 1000 ? Math.round(text.length / 1024) + ' KB' : text.length + ' bytes') +
      ' · select and copy, or open the app from a local copy to download the file directly</div></div></div>' +
      '<div class="mb">' +
      V.note('b', 'This build cannot save a file here. The export is below in full — copy it, or run ' +
        '<span class="m">index.html</span> from your own disk, where it downloads as a file.') +
      '<textarea id="payloadBox" rows="16" readonly class="m" style="width:100%;font-size:11.5px;line-height:1.5;' +
      'border:1px solid var(--bd);border-radius:8px;padding:9px;background:var(--card2);white-space:pre;overflow:auto">' +
      esc(text) + '</textarea></div>' +
      '<div class="mf"><button class="btn" data-act="close-modal">Close</button>' +
      '<button class="btn pri" data-act="copy-payload">Copy to clipboard</button></div>',
      'wide');
  }
  function csv(rows) {
    return rows.map(function (r) {
      return r.map(function (c) {
        var s = String(c == null ? '' : c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\n');
  }

  function exportZones() {
    var rows = [['id', 'habitation', 'block', 'population', 'dominant_hazard', 'HEI', 'VCI', 'capacity_stress', 'RUI', 'priority', 'must_move', 'shelter_need', 'simulated']];
    ENG.STATE.habs.forEach(function (h) {
      rows.push([h.id, h.name, V.blockName(h.block), h.pop, h.HEI.dominant.label,
        Math.round(h.HEI.score), Math.round(h.VCI.score), Math.round(h.RUI.stress.score),
        Math.round(h.RUI.score), ENG.priority(h.RUI.score).label, h.demand.mustMove, h.demand.shelterNeed, 'YES']);
    });
    download('aapdasync-redzones-SIMULATED.csv', csv(rows), 'text/csv');
  }
  function exportSites() {
    var rows = [['id', 'site', 'type', 'tier', 'claimed', 'derived', 'binding_constraint', 'binding_basis', 'site_HEI', 'disqualified', 'usable', 'committed', 'residual', 'simulated']];
    ENG.STATE.sites.forEach(function (s) {
      rows.push([s.id, s.name, s.type, s.tier, s.claimed, s.cap.disqualified ? 0 : s.cap.capacity,
        s.cap.disqualified ? 'DISQUALIFIED' : s.cap.binding.label, s.cap.binding.basis,
        Math.round(s.cap.hei * 10) / 10, s.cap.disqualified ? 'YES' : 'NO',
        s.usableTotal, s.committed, s.residual, 'YES']);
    });
    download('aapdasync-capacity-SIMULATED.csv', csv(rows), 'text/csv');
  }
  function exportQueue() {
    var rows = [['rank', 'habitation', 'RUI', 'shelter_need', 'allocated_to', 'persons', 'travel_min', 'unplaced', 'simulated']];
    var i = 1;
    ENG.STATE.habs.forEach(function (h) {
      if (h.demand.shelterNeed <= 0) return;
      var as = ENG.STATE.plan.assignments.filter(function (a) { return a.habId === h.id; });
      var got = as.reduce(function (t, a) { return t + a.persons; }, 0);
      if (!as.length) rows.push([i, h.name, Math.round(h.RUI.score), h.demand.shelterNeed, 'NONE', 0, '', h.demand.shelterNeed, 'YES']);
      as.forEach(function (a) {
        rows.push([i, h.name, Math.round(h.RUI.score), h.demand.shelterNeed, a.siteName, a.persons, Math.round(a.travelMin), h.demand.shelterNeed - got, 'YES']);
      });
      i++;
    });
    download('aapdasync-relocation-queue-SIMULATED.csv', csv(rows), 'text/csv');
  }
  function exportLedger() {
    var payload = {
      _warning: 'SIMULATED DATA — student prototype, not an official government record',
      district: SIM.district.name, generated: new Date().toISOString(),
      scenario: ENG.STATE.scenario,
      operator: ENG.STATE.operator,
      invariants: ENG.invariants(),
      postings: ENG.ledger.map(function (e) {
        return { seq: e.seq, ts: e.ts.toISOString(), type: e.type, site: e.site, hab: e.hab, persons: e.persons, operator: e.operator, reason: e.reason };
      })
    };
    download('aapdasync-ledger-SIMULATED.json', JSON.stringify(payload, null, 2), 'application/json');
  }
  function exportAll() {
    var d = ENG.deficit();
    var rows = [['metric', 'value', 'note']];
    rows.push(['shelter_need', d.demand, 'people needing a public shelter place']);
    rows.push(['register_claimed_capacity', d.claimedTotal, 'as stated on the DDMA register']);
    rows.push(['derived_capacity', d.realTotal, 'after five binding ceilings']);
    rows.push(['usable_capacity', d.totalUsable, 'after surge reserve and augmentation']);
    rows.push(['placed', d.placed, 'by the matching engine']);
    rows.push(['capacity_deficit', d.capacityDeficit, 'no reachable qualified place']);
    rows.push(['movement_deficit', d.movementDeficit, 'placed but not reachable in the window']);
    rows.push(['fleet_rate_per_hour', Math.round(d.rate), '']);
    rows.push(['window_hours', d.windowHrs, 'to next hazard impact']);
    rows.push(['sites_disqualified', d.disqualified.length, 'shelter itself inside a red zone']);
    rows.push(['SIMULATED', 'YES', 'student prototype — not an official government system']);
    download('aapdasync-summary-SIMULATED.csv', csv(rows), 'text/csv');
  }
  function exportJSON() {
    var S = ENG.STATE;
    var payload = {
      _warning: 'SIMULATED DATA — student prototype, not an official government record',
      generated: new Date().toISOString(), district: SIM.district, scenario: S.scenario,
      standards: S.standards,
      deficit: (function () { var d = ENG.deficit(); delete d.readiness; delete d.disqualified; delete d.ongoingEvents; return d; })(),
      habitations: S.habs.map(function (h) {
        return { id: h.id, name: h.name, block: h.block, pop: h.pop, HEI: h.HEI.score, VCI: h.VCI.score,
          RUI: h.RUI.score, capacityStress: h.RUI.stress.score, demand: h.demand };
      }),
      sites: S.sites.map(function (s) {
        return { id: s.id, name: s.name, claimed: s.claimed, derived: s.cap.capacity, binding: s.cap.binding.label,
          hei: s.cap.hei, disqualified: s.cap.disqualified, usable: s.usableTotal, committed: s.committed, residual: s.residual };
      }),
      assignments: S.plan.assignments,
      unmet: S.plan.unmet
    };
    download('aapdasync-plan-SIMULATED.json', JSON.stringify(payload, null, 2), 'application/json');
  }
  function exportEscalation() {
    var d = ENG.deficit();
    var augs = ENG.augmentations().filter(function (a) { return a.delta > 0 && a.leadHrs <= 6; });
    var closeable = augs.reduce(function (t, a) { return t + a.delta; }, 0);
    var lines = [];
    lines.push('SIMULATED — STUDENT PROTOTYPE — NOT AN OFFICIAL GOVERNMENT RECORD');
    lines.push('');
    lines.push('REQUEST FOR INTER-DISTRICT SHELTER TRANSFER');
    lines.push('District: ' + SIM.district.name + ' (simulated)');
    lines.push('Raised: ' + new Date().toString());
    lines.push('Operator: ' + (ENG.STATE.operator ? ENG.STATE.operator.name + ' / ' + ENG.STATE.operator.id : 'SYSTEM'));
    lines.push('Scenario: ' + ENG.STATE.scenario);
    lines.push('');
    lines.push('Shelter need                 ' + n(d.demand));
    lines.push('Register claims              ' + n(d.claimedTotal));
    lines.push('Derived usable capacity      ' + n(d.totalUsable));
    lines.push('Placed by matching engine    ' + n(d.placed));
    lines.push('Capacity deficit             ' + n(d.capacityDeficit));
    lines.push('Closeable locally within 6h  ' + n(closeable));
    lines.push('RESIDUAL — TRANSFER NEEDED   ' + n(Math.max(0, d.capacityDeficit - closeable)));
    lines.push('Window to next impact        ' + d1(d.windowHrs) + ' h');
    lines.push('');
    lines.push('HABITATIONS WITH UNPLACED POPULATION');
    ENG.STATE.plan.unmet.forEach(function (u) {
      lines.push('  ' + u.habName.padEnd(24) + String(u.persons).padStart(6) + '   ' + u.reason);
    });
    lines.push('');
    lines.push('LOCAL ACTIONS ALREADY IDENTIFIED');
    augs.forEach(function (a) {
      lines.push('  +' + String(a.delta).padStart(5) + '  ' + a.leadHrs + 'h  ' + a.siteName + ' — ' + a.title);
    });
    download('aapdasync-escalation-SIMULATED.txt', lines.join('\n'), 'text/plain');
  }

  /* ------------------------------------------------------- citizen reports */
  /* Form state lives here rather than in the DOM because the kind and time
     pickers are buttons, not inputs — a button has no value to read back. */
  var draft = { kind: '', when: 'now' };

  function reportOpen() {
    draft = { kind: '', when: 'now' };
    modal('report', V.reportForm(ENG.STATE.publicHab || (ENG.STATE.habs[0] || {}).id), 'narrow');
  }

  function reportPick(what, value) {
    draft[what] = value;
    var sel = what === 'kind' ? '.crkind' : '.crwhen';
    var attr = what === 'kind' ? 'kind' : 'when';
    document.querySelectorAll(sel).forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset[attr] === value));
    });
  }

  function reportSend() {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var res = REPORTS.submit({
      hab: g('crHab'), kind: draft.kind, when: draft.when,
      text: g('crText'), persons: g('crPersons').trim(),
      landmark: g('crLandmark'), contact: g('crContact')
    });
    if (!res.ok) {
      /* Errors go inside the form, above the buttons, not into a toast that
         slides away while the person is still reading the field it refers to. */
      var box = document.getElementById('crErr');
      if (box) {
        box.innerHTML = V.note('r', '<b>Not sent yet.</b><ul style="margin:6px 0 0;padding-left:18px">' +
          res.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>');
        box.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    modal('receipt', V.reportReceipt(res), 'narrow');
    toast('Report ' + res.ref + ' sent', 'It is in the district queue, marked unverified.', 'ok');
    APP.render();
  }

  /* Verify and dismiss are both operator decisions, so both are attributed and
     both post to the ledger. The persons figure is zero: this changes what the
     district BELIEVES, not what it has committed, and posting a number here
     would put an observation into the capacity account. */
  function reportDecide(id, verdict) {
    var r = SIM.reports.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var op = ENG.STATE.operator;
    if (!op) { restricted(); return; }
    r.status = verdict === 'verify' ? 'verified' : 'dismissed';
    r.verifiedBy = op.id;
    r.verifyNote = verdict === 'verify' ? 'confirmed' : 'not confirmed';
    r.decidedAt = new Date().toISOString();
    ENG.post({
      type: 'VERIFY', hab: r.hab, persons: 0, operator: op.id, ref: r.id,
      reason: (verdict === 'verify' ? 'Report confirmed: ' : 'Report dismissed: ') + r.text.slice(0, 90)
    });
    toast(verdict === 'verify' ? 'Report verified' : 'Report dismissed',
      r.id + ' — recorded against ' + op.id + '. No computed figure changed.',
      verdict === 'verify' ? 'ok' : 'warn');
    APP.render();
  }

  function exportReports() {
    var rows = [['ref', 'capturedHoursAgo', 'habitation', 'kind', 'text', 'source', 'status', 'decidedBy']];
    REPORTS.byCapture().forEach(function (r) {
      var hab = (ENG.STATE.habs || []).filter(function (x) { return x.id === r.hab; })[0];
      rows.push([r.id, REPORTS.capturedHoursAgo(r).toFixed(2), hab ? hab.name : (r.hab || ''),
        r.kindLabel || REPORTS.kindLabel(r.kind), r.text, r.by, r.status, r.verifiedBy || '']);
    });
    download('aapdasync-field-reports-SIMULATED.csv', csv(rows), 'text/csv');
  }

  return {
    reportOpen: reportOpen, reportPick: reportPick, reportSend: reportSend,
    reportDecide: reportDecide, exportReports: exportReports,
    toast: toast, drawer: drawer, closeDrawer: closeDrawer, showPayload: showPayload, embedded: embedded,
    openHab: openHab, openSite: openSite, openAssign: openAssign,
    cfLayout: cfLayout, cfGo: cfGo, openRecord: openRecord, openState: openState,
    pickNeed: pickNeed, pickAmount: pickAmount, pickPay: pickPay, contribute: contribute,
    photoManager: photoManager, takePhoto: takePhoto, takePhotos: takePhotos,
    ask: ask, openForecast: openForecast, exportForecast: exportForecast,
    repaintRelief: repaintRelief, exportReceipt: exportReceipt,
    modal: modal, closeModal: closeModal, signIn: signIn, restricted: restricted, standards: standards,
    wizard: wizard, renderWizard: renderWizard, wiz: wiz, escalate: escalate,
    openPalette: openPalette, closePalette: closePalette, buildPalette: buildPalette,
    palMove: palMove, palRun: palRun,
    commitPlan: commitPlan, doAugment: doAugment, releasePrompt: releasePrompt,
    exportZones: exportZones, exportSites: exportSites, exportQueue: exportQueue,
    exportLedger: exportLedger, exportAll: exportAll, exportJSON: exportJSON, exportEscalation: exportEscalation,
    get modalKind() { return openModalKind; }
  };
})();
