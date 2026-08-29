/* ============================================================================
   AapdaSync — app.js  (bootstrap; must load last)
   ========================================================================== */

'use strict';

var APP = (function () {

  var ROUTES = [
    { k: 'deck',      title: 'District Deck',     grp: 'Assessment', view: function () { return V.deck(); },      icon: 'grid' },
    { k: 'gis',       title: 'GIS Map',           grp: 'Assessment', view: function () { return V.gisView(); },   icon: 'globe' },
    { k: 'zones',     title: 'Red Zones',         grp: 'Assessment', view: function () { return V.zones(); },     icon: 'alert' },
    { k: 'forecast',  title: 'Hazard Forecast',   grp: 'Assessment', view: function () { return V.forecast(); },  icon: 'chart' },
    { k: 'reports',   title: 'Field Reports',     grp: 'Assessment', view: function () { return V.reports(); },   icon: 'inbox' },
    { k: 'capacity',  title: 'Carrying Capacity', grp: 'Assessment', view: function () { return V.capacity(); },  icon: 'home' },
    { k: 'queue',     title: 'Relocation Queue',  grp: 'Decision',   view: function () { return V.queue(); },     icon: 'list' },
    { k: 'engine',    title: 'Matching Engine',   grp: 'Decision',   view: function () { return V.engine(); },    icon: 'link' },
    { k: 'convoys',   title: 'Movement & Convoys',grp: 'Decision',   view: function () { return V.convoys(); },   icon: 'truck' },
    { k: 'scenario',  title: 'Scenario Sandbox',  grp: 'Assurance',  view: function () { return V.scenarios(); }, icon: 'branch' },
    { k: 'ledger',    title: 'Audit Ledger',      grp: 'Assurance',  view: function () { return V.ledger(); },    icon: 'book' },
    { k: 'analytics', title: 'Analytics',         grp: 'Assurance',  view: function () { return V.analytics(); }, icon: 'chart' },
    { k: 'ask',       title: 'Ask & Sources',     grp: 'Assurance',  view: function () { return V.askView(); },   icon: 'info' },
    { k: 'method',    title: 'Method',            grp: 'Assurance',  view: function () { return V.method(); },    icon: 'info' }
  ];

  var TOPNAV = ['deck', 'gis', 'zones', 'forecast', 'capacity', 'queue'];

  var ICONS = {
    grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
    alert: '<path d="m12 3 9 16H3z"/><path d="M12 9v4M12 16h.01"/>',
    home: '<path d="M3 10 12 3l9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
    truck: '<path d="M1 6h13v10H1zM14 9h4l3 3v4h-7z"/><circle cx="5" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M8 19h4a4 4 0 0 0 4-4v-1M8 5h4a4 4 0 0 1 4 4v1"/>',
    book: '<path d="M4 4h13a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2z"/><path d="M4 18a2 2 0 0 1 2-2h13"/>',
    chart: '<path d="M3 21h18M6 17v-6M11 17V6M16 17v-9M21 17v-4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M4.5 5h15l1.5 8v6H3v-6z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>'
  };
  function ic(k, sz) {
    return '<svg width="' + (sz || 15) + '" height="' + (sz || 15) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[k] || '') + '</svg>';
  }

  var state = { route: 'deck', role: 'gov', emergency: false, mapFocus: null, fs: 14, mapLevel: 'india', mapFull: false };

  /* ------------------------------------------------------------------ nav */
  function badgeFor(k) {
    var S = ENG.STATE;
    if (!S.plan) return null;
    if (k === 'zones') return { v: S.habs.filter(function (h) { return h.RUI.score >= 85; }).length, crit: true };
    if (k === 'capacity') return { v: S.sites.filter(function (s) { return s.cap.disqualified; }).length, crit: true };
    if (k === 'queue') return { v: S.plan.unmet.length, crit: S.plan.unmet.length > 0 };
    if (k === 'engine') return { v: S.plan.assignments.length, crit: false };
    if (k === 'ledger') return { v: ENG.ledger.length, crit: false };
    if (k === 'forecast') return { v: FORECAST.board().filter(function (r) { return r.p >= 0.55; }).length, crit: true };
    if (k === 'convoys') return { v: (S.orders || []).length, crit: false };
    if (k === 'reports') { var u = SIM.reports.filter(function (r) { return r.status === 'unverified'; }).length; return { v: u, crit: u > 0 }; }
    return null;
  }

  function renderNav() {
    var groups = {};
    ROUTES.forEach(function (r) { (groups[r.grp] = groups[r.grp] || []).push(r); });
    var html = '';
    Object.keys(groups).forEach(function (g) {
      html += '<div class="navgrp"><h4>' + g + '</h4>';
      groups[g].forEach(function (r) {
        var b = badgeFor(r.k);
        html += '<button class="navitem" data-nav="' + r.k + '"' + (state.route === r.k ? ' aria-current="page"' : '') + '>' +
          ic(r.icon) + '<span>' + r.title + '</span>' +
          (b ? '<span class="bdg' + (b.crit && b.v > 0 ? ' crit' : '') + '">' + b.v + '</span>' : '') + '</button>';
      });
      html += '</div>';
    });
    document.getElementById('navscroll').innerHTML = html;

    var S = ENG.STATE, d = ENG.deficit();
    document.getElementById('navfoot').innerHTML =
      '<div class="nfrow"><span>SAFE SITES</span><b class="m">' + S.sites.filter(function (s) { return !s.cap.disqualified; }).length + ' / ' + S.sites.length + '</b></div>' +
      '<div class="nfrow"><span>RESIDUAL PLACES</span><b class="m">' + V.n(d.residualNow) + '</b></div>' +
      '<div class="nfrow"><span>LEDGER POSTINGS</span><b class="m">' + ENG.ledger.length + '</b></div>' +
      '<div class="nfrow"><span>OPERATOR</span><b class="m">' + V.esc(S.operator ? S.operator.id : '—') + '</b></div>' +
      '<div class="nfrow"><span>UNIT</span><b>' + V.esc(S.operator ? S.operator.unit : '—') + '</b></div>' +
      '<button class="signout" data-act="signout">Sign out</button>';

    document.getElementById('topnav').innerHTML = TOPNAV.map(function (k) {
      var r = ROUTES.filter(function (x) { return x.k === k; })[0];
      return '<button data-nav="' + k + '"' + (state.route === k ? ' aria-current="page"' : '') + '>' + r.title + '</button>';
    }).join('');
  }

  function renderChips() {
    var S = ENG.STATE, d = ENG.deficit();
    var crit = S.habs.filter(function (h) { return h.RUI.score >= 85; }).length;
    var unver = SIM.reports.filter(function (r) { return r.status === 'unverified'; }).length;
    var t = new Date();
    document.getElementById('topchips').innerHTML =
      '<span class="chip c-crit" title="Habitations at critical relocation urgency">Critical <b>' + crit + '</b></span>' +
      '<span class="chip ' + (d.capacityDeficit > 0 ? 'c-crit' : 'c-ok') + '" title="People with no reachable qualified place">Deficit <b class="m">' + V.n(d.capacityDeficit) + '</b></span>' +
      '<span class="chip c-warn" title="Field reports awaiting operator verification">Unverified <b>' + unver + '</b></span>' +
      '<span class="chip c-inf" title="Places still free across the district">Free <b class="m">' + V.n(d.residualNow) + '</b></span>' +
      '<span class="chip" title="Real system clock, Asia/Kolkata">Sync <b class="m">' + t.toTimeString().slice(0, 8) + '</b></span>';
    fitChips();
  }

  /* Drop whole chips until the bar stops overflowing. A media query cannot do
     this: how many chips fit depends on the rendered width of numbers that
     change every second — "Deficit 3,544" and "Deficit 12" are not the same
     width — so the decision has to be measured after layout rather than
     guessed from the viewport. Chips drop from the right, which is least
     important first; Critical and Deficit lead the row and so never drop.

     The alternative was letting the flex container shrink under overflow:hidden,
     which slices the last chip down the middle. A half-chip reads as a
     rendering fault, and on a screen whose entire claim is that its numbers can
     be trusted, looking broken is expensive. */
  function fitChips() {
    var bar = document.getElementById('top'), box = document.getElementById('topchips');
    if (!bar || !box) return;
    var chips = Array.prototype.slice.call(box.children);
    chips.forEach(function (c) { c.style.display = ''; });
    for (var i = chips.length - 1; i > 1 && bar.scrollWidth > bar.clientWidth; i--) {
      chips[i].style.display = 'none';
    }
  }

  /* ---------------------------------------------------------------- render */
  function render() {
    var r = ROUTES.filter(function (x) { return x.k === state.route; })[0];
    var main = document.getElementById('main');
    if (state.role === 'pub') {
      main.innerHTML = V.publicView();
    } else {
      main.innerHTML = r ? r.view() : V.deck();
    }
    main.scrollTop = 0;
    renderNav(); renderChips();
    document.getElementById('roleLabel').textContent = state.role === 'pub' ? 'Public View' : 'Government View';
    var govBtn = document.querySelector('#roleSwitch button[data-role="gov"]');
    if (govBtn) {
      var locked = !ENG.STATE.operator;
      govBtn.innerHTML = (locked ? '<span class="lock" aria-hidden="true">\u{1F512}</span>' : '') + 'Government';
      govBtn.setAttribute('title', locked ? 'Restricted — operator sign-in required' : 'Government View');
    }
    document.body.classList.toggle('emerg', state.emergency);
    var em = document.querySelector('[data-map="emergency"]');
    if (em) em.setAttribute('aria-pressed', String(state.emergency));
    var bell = document.getElementById('bellDot');
    if (bell) bell.style.display = ENG.STATE.plan && ENG.STATE.plan.unmetTotal > 0 ? 'block' : 'none';
    ACT.cfLayout();
    attachPanZoom();
  }

  /* The SVG node is thrown away and rebuilt on every render, so the pan/zoom
     controller is re-attached each time and handed the viewBox it finds — that
     way a drill-down animation or a focus call keeps the frame the operator
     was already looking at instead of snapping back to the whole country. */
  function attachPanZoom(delay) {
    if (delay) { setTimeout(function () { attachPanZoom(0); }, delay); return; }
    var isNat = !document.getElementById('mapsvg');
    var id = isNat ? 'natsvg' : 'mapsvg';
    var el = document.getElementById(id);
    if (!el) { PZ.detach(); return; }
    var vb = (el.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    var full = isNat ? { x: 0, y: 0, w: 612, h: 696 } : { x: 0, y: 0, w: 1000, h: 700 };
    var view = (vb.length === 4 && !vb.some(isNaN)) ? { x: vb[0], y: vb[1], w: vb[2], h: vb[3] } : null;
    PZ.attach(id, full, { view: view, min: 0.05, max: 1 });
  }

  /* Hovering a habitation isolates its relocation flows. With eighteen
     allocations on one map the bundle is unreadable; one hover answers
     "where do these particular people go" without a click. */
  function onHover(e) {
    var svg = document.getElementById('mapsvg');
    if (!svg) return;
    var h = e.target && e.target.closest ? e.target.closest('.hab') : null;
    var id = h ? h.dataset.id : null;
    if (svg.getAttribute('data-hl') === (id || null)) return;
    if (!id) {
      svg.removeAttribute('data-hl');
      Array.prototype.forEach.call(svg.querySelectorAll('.on'), function (nn) { nn.classList.remove('on'); });
      return;
    }
    svg.setAttribute('data-hl', id);
    Array.prototype.forEach.call(svg.querySelectorAll('.flow'), function (f) {
      f.classList.toggle('on', f.getAttribute('data-hab') === id);
    });
    Array.prototype.forEach.call(svg.querySelectorAll('.hab'), function (nn) {
      nn.classList.toggle('on', nn.dataset.id === id);
    });
  }

  function refreshMap() {
    var box = document.getElementById('mapbox');
    if (!box) return;
    box.innerHTML = (state.mapLevel === 'district'
      ? MAP.render({ focusHab: state.mapFocus }) + V.mapOverlays()
      : NAT.render() + V.nationalOverlays()) + V.timelineRail();
    attachPanZoom();
  }

  /* India → district. The zoom runs on the national SVG first so the operator
     sees where the district is before the frame is replaced; jumping straight
     to a district view costs re-orientation the same way a reflowing map does. */
  function drill() {
    if (state.mapLevel === 'district') return;
    if (state.route !== 'deck') { go('deck'); }
    NAT.zoomState(SIM.homeState);
    setTimeout(function () {
      state.mapLevel = 'district'; state.mapFocus = null;
      NAT.resetView(); MAP.resetView(); refreshMap();
    }, 620);
  }
  function surface() {
    state.mapLevel = 'india'; state.mapFocus = null;
    NAT.resetView(); MAP.resetView(); refreshMap();
  }

  /* Leaving Government ends the session. Returning asks for sign-in again.
     A role switch that stays authorised is not a barrier, it is a tab — and on
     a shared district terminal the person who walks up next is not the person
     who signed in. Every crossing is a fresh, attributed authorisation. */
  function setRole(role) {
    if (role === 'pub' && state.role === 'gov') { ENG.STATE.operator = null; }
    state.role = role;
    if (role === 'pub') { state.mapLevel = 'india'; NAT.resetView(); ACT.closeDrawer(); }
    document.getElementById('app').classList.toggle('citizen', role === 'pub');
    render();
  }

  /* Navigation is the other way into Government, and it used to be the way
     round the gate: a route change from the public view promoted the role
     silently. The palette, the alert bell and any deep link all funnel through
     here, so the check belongs here rather than on each caller. The requested
     route is held and honoured once sign-in completes, so the barrier costs the
     operator a form and not their place. */
  var pendingRoute = null;

  function go(k) {
    if (!ROUTES.filter(function (x) { return x.k === k; }).length) return;
    if (state.role === 'pub' && !ENG.STATE.operator) { pendingRoute = k; ACT.restricted(); return; }
    state.route = k;
    state.role = 'gov';
    document.querySelectorAll('#roleSwitch button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.role === state.role));
    });
    render();
  }

  function takePendingRoute() {
    var k = pendingRoute; pendingRoute = null;
    if (k && ROUTES.filter(function (x) { return x.k === k; }).length) state.route = k;
    return k;
  }

  function recompute() {
    ENG.recompute();
    V.clearSweep();
    ACT.toast('Recomputed', 'Exposure, capacity, urgency and the assignment re-derived from raw inputs.', 'ok');
    render();
  }

  function setScenario(id) {
    var s = SIM.scenarios.filter(function (x) { return x.id === id; })[0];
    ENG.setScenario(id);
    V.clearSweep();
    ACT.toast('Scenario applied', (s ? s.name : id) + ' — every downstream figure re-derived.', id === 'SC-BASE' ? 'ok' : 'warn');
    render();
  }

  /* ------------------------------------------------------------- emergency */
  function toggleEmergency() {
    if (state.emergency) {
      var d = ENG.deficit();
      if (d.capacityDeficit > 0) {
        ACT.toast('Emergency mode held', V.n(d.capacityDeficit) + ' people still have no reachable place. Close or escalate the deficit before standing down.', 'crit');
        return;
      }
      state.emergency = false;
      ACT.toast('Emergency mode off', 'No unplaced population remains.', 'ok');
    } else {
      state.emergency = true;
      ACT.toast('Emergency mode on', 'Cannot be exited while any population is unplaced.', 'crit');
    }
    render();
  }

  /* ------------------------------------------------------------ delegation */
  function onClick(e) {
    if (e.target && e.target.closest && e.target.closest('[data-pick],[data-pickmany],.pcred,.prow')) {
      if (!e.target.closest('[data-act]')) return;   // let file pickers and credit fields be
    }
    var t = e.target.closest('[data-nav],[data-act],[data-open],[data-map],[data-zoom],[data-layer],[data-filter],[data-pal],[data-cf],[data-need],[data-amt],[data-pay],[data-askq],[data-fcs],[data-hab],[data-kind],[data-when],.hab,.site,.stt,.grole');
    if (!t) return;

    if (t.dataset.nav) { go(t.dataset.nav); return; }
    if (t.dataset.pal != null) { ACT.palRun(parseInt(t.dataset.pal, 10)); return; }
    if (t.dataset.zoom) {
      if (t.dataset.zoom === 'in') PZ.zoomBy(1 / 1.35);
      if (t.dataset.zoom === 'out') PZ.zoomBy(1.35);
      if (t.dataset.zoom === 'reset') PZ.reset();
      return;
    }
    if (t.dataset.kind) { ACT.reportPick('kind', t.dataset.kind); return; }
    if (t.dataset.when) { ACT.reportPick('when', t.dataset.when); return; }
    if (t.dataset.need) { ACT.pickNeed(t.dataset.need); return; }
    if (t.dataset.askq) { ACT.ask(t.dataset.askq); return; }
    if (t.dataset.fcs) { ENG.STATE.fcScenario = t.dataset.fcs; render(); return; }
    if (t.dataset.amt) { ACT.pickAmount(t.dataset.amt); return; }
    if (t.dataset.pay) { ACT.pickPay(t.dataset.pay); return; }

    if (t.classList.contains('grole')) {
      if (t.id === 'roleGov') { ACT.signIn(); }
      else { enter('pub'); }
      return;
    }
    if (t.dataset.cf != null) { ACT.cfGo(t.dataset.cf); return; }
    if (t.classList.contains('hab')) { ACT.openHab(t.dataset.id); return; }
    if (t.classList.contains('site')) { ACT.openSite(t.dataset.id); return; }
    if (t.classList.contains('stt')) {
      var sid = t.dataset.st;
      if (sid === SIM.homeState && state.role !== 'pub') { drill(); return; }
      ACT.openState(sid); return;
    }

    if (t.dataset.open) {
      if (t.dataset.open === 'hab') ACT.openHab(t.dataset.id);
      if (t.dataset.open === 'site') ACT.openSite(t.dataset.id);
      if (t.dataset.open === 'assign') ACT.openAssign(t.dataset.id);
      if (t.dataset.open === 'fc') ACT.openForecast(t.dataset.id);
      return;
    }
    if (t.dataset.map) {
      if (t.dataset.map === 'india') { ACT.closeDrawer(); surface(); }
      if (t.dataset.map === 'drill') { ACT.closeDrawer(); drill(); attachPanZoom(760); }
      if (t.dataset.map === 'district') { state.mapFocus = null; refreshMap(); MAP.zoomToDistrict(); }
      if (t.dataset.map === 'critical') {
        var h = ENG.STATE.habs[0];
        if (h) { state.mapLevel = 'district'; state.mapFocus = h.id; refreshMap(); MAP.zoomTo(h.xy, 420); attachPanZoom(700); ACT.openHab(h.id); }
      }
      if (t.dataset.map === 'emergency') toggleEmergency();
      return;
    }
    if (t.dataset.filter) {
      var f = t.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.filter === f)); });
      document.querySelectorAll('#feed .fev').forEach(function (el) {
        el.style.display = (f === 'All' || el.dataset.kind === f) ? '' : 'none';
      });
      return;
    }

    var a = t.dataset.act;
    if (!a) return;
    switch (a) {
      case 'rail': ENG.STATE.railShut = !ENG.STATE.railShut; refreshMap(); break;
      case 'mapfull': state.mapFull = !state.mapFull;
        var mb = document.getElementById('mapbox');
        if (mb) { mb.classList.toggle('full', state.mapFull); attachPanZoom(60); }
        break;
      case 'close-drawer': ACT.closeDrawer(); break;
      case 'close-modal': ACT.closeModal(); break;
      case 'recompute': recompute(); break;
      case 'resolve': ENG.solve(); V.clearSweep(); ACT.toast('Solver re-run', ENG.STATE.plan.assignments.length + ' allocations, ' + V.n(ENG.STATE.plan.unmetTotal) + ' unplaced.', 'ok'); render(); break;
      case 'commit': ACT.commitPlan(); break;
      case 'wizard': ACT.closeDrawer(); ACT.wizard(t.dataset.id); break;
      case 'escalate': ACT.escalate(); break;
      case 'standards': ACT.standards(); break;
      case 'method': go('method'); break;
      case 'augment': ACT.doAugment(t.dataset.id); break;
      case 'release': ACT.releasePrompt(t.dataset.id); break;
      case 'scenario': setScenario(t.dataset.id); break;
      case 'signout': setRole('pub');
        ACT.toast('Signed out', 'Government View is locked. Re-entry needs a fresh sign-in.', 'warn'); break;
      case 'focus-map': state.mapFocus = t.dataset.id; state.mapLevel = 'district'; if (state.route !== 'deck') go('deck'); else refreshMap(); attachPanZoom(700);
        var hh = ENG.STATE.habs.filter(function (x) { return x.id === t.dataset.id; })[0]; if (hh) MAP.zoomTo(hh.xy, 420); break;
      case 'focus-site': var ss = ENG.STATE.sites.filter(function (x) { return x.id === t.dataset.id; })[0];
        state.mapLevel = 'district'; if (state.route !== 'deck') go('deck'); else refreshMap(); if (ss) MAP.zoomTo(ss.xy, 420); break;
      case 'signin-go': {
        var id = (document.getElementById('opId') || {}).value || 'OP-0000';
        ENG.STATE.operator = {
          id: id, name: (document.getElementById('opName') || {}).value || 'Operator',
          rank: (document.getElementById('opRank') || {}).value || '', unit: (document.getElementById('opUnit') || {}).value || ''
        };
        ACT.closeModal(); takePendingRoute(); enter('gov');
        ACT.toast('Signed in', ENG.STATE.operator.id + ' — every allocation from here is attributed to you.', 'ok');
        break;
      }
      case 'standards-go': {
        var st = ENG.STATE.standards;
        function num(idv, dflt) { var v = parseFloat((document.getElementById(idv) || {}).value); return isNaN(v) ? dflt : v; }
        st.areaPerPerson = num('stArea', st.areaPerPerson);
        st.waterPerPerson = num('stWater', st.waterPerPerson);
        st.personsPerToilet = num('stToilet', st.personsPerToilet);
        st.siteHeiCutoff = num('stCut', st.siteHeiCutoff);
        st.surgeBuffer = num('stSurge', st.surgeBuffer);
        ACT.closeModal(); ENG.recompute(); V.clearSweep();
        ACT.toast('Standards applied', 'Every capacity figure re-derived from the new assumptions.', 'ok');
        render(); break;
      }
      case 'release-go': {
        var sid = t.dataset.id;
        var num2 = parseInt((document.getElementById('relN') || {}).value, 10) || 0;
        var why = (document.getElementById('relWhy') || {}).value || 'Manual release';
        ENG.releaseSite(sid, num2, ENG.STATE.operator ? ENG.STATE.operator.id : 'SYSTEM', why);
        ENG.solve(); ACT.closeModal(); V.clearSweep();
        ACT.toast('Release posted', V.n(num2) + ' places returned. Compensating entry written; the original allocation remains.', 'warn');
        render(); break;
      }
      case 'wiz-next': {
        if (ACT.wiz.step === 1) {
          var sel = document.getElementById('wizHab');
          if (sel) ACT.wiz.habId = sel.value;
        }
        ACT.wiz.step = Math.min(4, ACT.wiz.step + 1); ACT.renderWizard(); break;
      }
      case 'wiz-back': ACT.wiz.step = Math.max(1, ACT.wiz.step - 1); ACT.renderWizard(); break;
      case 'wiz-issue': {
        var S = ENG.STATE;
        var hb = S.habs.filter(function (x) { return x.id === ACT.wiz.habId; })[0];
        var as = S.plan.assignments.filter(function (x) { return x.habId === hb.id; });
        var people = as.reduce(function (n2, x) { return n2 + x.persons; }, 0);
        if (!people) { ACT.toast('Refused', 'No debited allocation backs this order.', 'crit'); break; }
        var held = ENG.heldFor(hb.id);
        if (held < people) {
          as.forEach(function (x) {
            ENG.post({ type: 'ALLOC', site: x.siteId, hab: x.habId, persons: x.persons,
              operator: S.operator ? S.operator.id : 'SYSTEM', reason: 'Movement order — ' + hb.name });
          });
        }
        S.orders = (S.orders || []).concat(as.map(function (x, i) {
          return { id: 'RO-' + String(2000 + (S.orders || []).length + i), habId: hb.id, habName: hb.name,
            siteId: x.siteId, siteName: x.siteName, persons: x.persons, rui: hb.RUI.score,
            travelMin: x.travelMin, corridor: x.corridor, highDep: x.highDep, status: 'issued',
            issuedBy: S.operator ? S.operator.id : 'SYSTEM', at: new Date() };
        }));
        ENG.STATE.sites = ENG.recompute().sites;
        ACT.closeModal();
        ACT.toast('Order issued', V.n(people) + ' people from ' + hb.name + ', every place debited and attributed.', 'ok');
        go('convoys'); break;
      }
      case 'copy-payload': {
        var box = document.getElementById('payloadBox');
        if (!box) break;
        box.select(); box.setSelectionRange(0, box.value.length);
        var done = false;
        try { done = document.execCommand('copy'); } catch (e2) { done = false; }
        if (!done && navigator.clipboard) {
          navigator.clipboard.writeText(box.value).then(function () {
            ACT.toast('Copied', 'The export is on your clipboard.', 'ok');
          }, function () { ACT.toast('Select and copy', 'The text is selected — press Ctrl C.', 'warn'); });
        } else {
          ACT.toast(done ? 'Copied' : 'Select and copy', done ? 'The export is on your clipboard.' : 'The text is selected — press Ctrl C.', done ? 'ok' : 'warn');
        }
        break;
      }
      case 'ask': {
        var qi = document.getElementById('askInput');
        ACT.ask(qi ? qi.value : ''); break;
      }
      case 'export-forecast': ACT.exportForecast(); break;
      case 'rail': ENG.STATE.railOff = !ENG.STATE.railOff; render(); break;
      case 'photos': ACT.photoManager(); break;
      case 'photo-del': PHOTOS.remove(t.dataset.id); ACT.photoManager(); render();
        ACT.toast('Photograph removed', 'That card is back to the drawing.', 'warn'); break;
      case 'photo-clear': PHOTOS.clear(); ACT.photoManager(); render();
        ACT.toast('All photographs removed', 'Every card is back to the drawing.', 'warn'); break;
      case 'contribute': ACT.contribute(); break;
      case 'export-receipt': ACT.exportReceipt(); break;
      case 'export-zones': ACT.exportZones(); break;
      case 'export-sites': ACT.exportSites(); break;
      case 'export-queue': ACT.exportQueue(); break;
      case 'export-ledger': ACT.exportLedger(); break;
      case 'export-all': ACT.exportAll(); break;
      case 'export-json': ACT.exportJSON(); break;
      case 'export-escalation': ACT.exportEscalation(); break;
      case 'export-reports': ACT.exportReports(); break;
      case 'report-open': ACT.reportOpen(); break;
      case 'report-send': ACT.reportSend(); break;
      case 'report-verify': ACT.reportDecide(t.dataset.id, 'verify'); break;
      case 'report-dismiss': ACT.reportDecide(t.dataset.id, 'dismiss'); break;
    }
  }

  function onChange(e) {
    var t = e.target;
    if (t.dataset && t.dataset.pickmany) {
      if (t.files && t.files.length) ACT.takePhotos(t.files);
      t.value = '';
      return;
    }
    if (t.dataset && t.dataset.pick) {
      if (t.files && t.files[0]) ACT.takePhoto(t.dataset.pick, t.files[0]);
      return;
    }
    if (t.classList && t.classList.contains('pcred')) {
      PHOTOS.setCredit(t.dataset.credit, t.value);
      /* Update the hint in place rather than rebuilding the panel — rebuilding
         on every keystroke would take the caret out of the field being typed in. */
      var hint = t.parentNode && t.parentNode.querySelector('.pmiss');
      if (hint) hint.style.display = t.value.trim() ? 'none' : '';
      render(); return;
    }
    if (t.dataset && t.dataset.layer) { MAP.toggle(t.dataset.layer); refreshMap(); return; }
    if (t.id === 'pubSel') { ENG.STATE.publicHab = t.value; render(); return; }
  }

  function onKey(e) {
    var pal = document.getElementById('palette').classList.contains('on');
    if (e.key === 'Escape') {
      if (pal) { ACT.closePalette(); return; }
      if (state.mapFull) { state.mapFull = false; render(); return; }
      if (document.getElementById('scrim').classList.contains('on')) { ACT.closeModal(); return; }
      ACT.closeDrawer(); return;
    }
    if (pal) {
      if (e.key === 'ArrowDown') { e.preventDefault(); ACT.palMove(1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); ACT.palMove(-1); }
      if (e.key === 'Enter') { e.preventDefault(); ACT.palRun(); }
      return;
    }
    if (document.querySelector('.cf-card') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') {
        e.preventDefault(); ACT.cfGo(e.key === 'ArrowLeft' ? 'prev' : 'next'); return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ACT.openPalette(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); toggleEmergency(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); ACT.wizard(); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); ACT.commitPlan(); return; }
  }

  function onKeyActivate(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var nd = e.target.closest ? e.target.closest('[data-need]') : null;
    if (nd) { e.preventDefault(); ACT.pickNeed(nd.dataset.need); return; }
    var t = e.target.closest('.hab,.site,.stt,.grole');
    if (!t) return;
    e.preventDefault();
    if (t.classList.contains('hab')) ACT.openHab(t.dataset.id);
    else if (t.classList.contains('site')) ACT.openSite(t.dataset.id);
    else if (t.classList.contains('stt')) {
      if (t.dataset.st === SIM.homeState && state.role !== 'pub') drill(); else ACT.openState(t.dataset.st);
    }
    else if (t.id === 'roleGov') ACT.signIn();
    else if (t.id === 'rolePub') enter('pub');
  }

  /* ----------------------------------------------------------------- boot */
  function enter(role) {
    state.role = role;
    if (role === 'pub' && !ENG.STATE.operator) ENG.STATE.operator = null;
    document.getElementById('gate').style.display = 'none';
    var app = document.getElementById('app');
    app.classList.add('on');
    app.classList.toggle('citizen', role === 'pub');
    document.querySelectorAll('#roleSwitch button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.role === role));
    });
    render();
    if (role === 'gov') {
      var d = ENG.deficit();
      setTimeout(function () {
        ACT.toast('District state loaded', SIM.district.name + ': ' + V.n(d.demand) + ' need a shelter place, ' +
          V.n(d.totalUsable) + ' usable places exist. Deficit ' + V.n(d.capacityDeficit) + '.', d.capacityDeficit > 0 ? 'crit' : 'ok');
      }, 400);
    }
  }

  function setFontScale(px) {
    state.fs = Math.max(12, Math.min(17, px));
    document.documentElement.style.setProperty('--fs', state.fs + 'px');
    ['tsm', 'tsn', 'tsp'].forEach(function (id) { var el = document.getElementById(id); if (el) el.setAttribute('aria-pressed', 'false'); });
    var which = state.fs < 14 ? 'tsm' : state.fs > 14 ? 'tsp' : 'tsn';
    var el2 = document.getElementById(which); if (el2) el2.setAttribute('aria-pressed', 'true');
  }

  function boot() {
    LIVE.boot = new Date();
    ENG.STATE.cfIndex = 2;
    ENG.recompute();

    document.addEventListener('click', onClick);
    document.addEventListener('pointermove', onHover);

    /* Drag a photograph anywhere onto a card or an import row. The page-wide
       preventDefault stops the browser from navigating away to the dropped
       file, which is the default and is always wrong here. */
    ['dragenter', 'dragover'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        var z = e.target.closest && e.target.closest('[data-drop]');
        e.preventDefault();
        document.querySelectorAll('.dragover').forEach(function (n) { n.classList.remove('dragover'); });
        if (z) z.classList.add('dragover');
      });
    });
    document.addEventListener('dragleave', function (e) {
      var z = e.target.closest && e.target.closest('[data-drop]');
      if (z) z.classList.remove('dragover');
    });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      document.querySelectorAll('.dragover').forEach(function (n) { n.classList.remove('dragover'); });
      var z = e.target.closest && e.target.closest('[data-drop]');
      if (!z) return;
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) ACT.takePhoto(z.dataset.drop, f);
    });
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onKeyActivate);

    document.getElementById('searchBtn').addEventListener('click', ACT.openPalette);
    document.getElementById('palInput').addEventListener('input', function (e) { ACT.buildPalette(e.target.value); });
    document.addEventListener('input', function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('pcred')) onChange(e);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.id === 'askInput') { e.preventDefault(); ACT.ask(e.target.value); }
    });
    document.getElementById('palette').addEventListener('click', function (e) {
      if (e.target.id === 'palette') ACT.closePalette();
    });
    document.getElementById('scrim').addEventListener('click', function (e) {
      if (e.target.id === 'scrim') ACT.closeModal();
    });
    document.getElementById('bellBtn').addEventListener('click', function () {
      var u = ENG.STATE.plan.unmet;
      if (!u.length) { ACT.toast('No unplaced population', 'Every person in the queue has a debited place.', 'ok'); return; }
      go('queue');
      ACT.toast(u.length + ' habitations with unplaced people', V.n(ENG.STATE.plan.unmetTotal) + ' people have no reachable qualified place.', 'crit');
    });
    document.querySelectorAll('#roleSwitch button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.role === 'gov') { ACT.restricted(); return; }   // always re-authorise
        setRole(b.dataset.role);
      });
    });
    document.getElementById('tsm').addEventListener('click', function () { setFontScale(state.fs - 1); });
    document.getElementById('tsn').addEventListener('click', function () { setFontScale(14); });
    document.getElementById('tsp').addEventListener('click', function () { setFontScale(state.fs + 1); });

    setInterval(function () {
      if (document.getElementById('app').classList.contains('on')) renderChips();
    }, 1000);

    /* The per-second tick re-fits anyway; this is for the moment a window is
       dragged wider, so chips come back immediately instead of on the next tick. */
    window.addEventListener('resize', fitChips);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return {
    ROUTES: ROUTES, go: go, render: render, refreshMap: refreshMap, recompute: recompute,
    setScenario: setScenario, enter: enter, toggleEmergency: toggleEmergency, setRole: setRole,
    drill: drill, surface: surface, attachPanZoom: attachPanZoom,
    get route() { return state.route; },
    get mapFull() { return state.mapFull; },
    get mapLevel() { return state.mapLevel; },
    set mapLevel(v) { state.mapLevel = v; },
    get role() { return state.role; },
    get mapFocus() { return state.mapFocus; },
    set mapFocus(v) { state.mapFocus = v; }
  };
})();
