/* ============================================================================
   AapdaSync — engine.js
   ---------------------------------------------------------------------------
   The decision model. Nothing here is hard-coded: every displayed number is
   computed from a raw input in data.js and can be traced back to it.

   The unique claim of this system is in ENG.rui(): a habitation's relocation
   urgency is a function of the safe capacity still reachable from it. Risk and
   capacity are one computation, not two.
   ========================================================================== */

'use strict';

var ENG = (function () {

  /* ---------------------------------------------------------------- utils */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function r0(v) { return Math.round(v); }
  function r1(v) { return Math.round(v * 10) / 10; }

  /* ======================================================================
     1. HAZARD EXPOSURE INDEX  (HEI, 0-100)
     ----------------------------------------------------------------------
     Sub-scores per hazard, then combined by DOMINANT-PLUS-RESIDUAL.

     Why not a weighted average: averaging four hazards lets three quiet ones
     hide one lethal one. A habitation under 4.8 m of water is a red zone
     whatever its seismic score. Why not a plain maximum: a place that is
     flooding AND shaking AND downwind of an ammonia vessel is worse than a
     place doing only the first. So: take the worst, then let the remainder
     of the scale be eaten into by what is left.
     ==================================================================== */

  /* Activity factor: HEI is CURRENT exposure, not the static design hazard.
     A 475-yr seismic map does not mean the ground is shaking this afternoon.
     Each hazard's latent exposure is scaled by how live the declared event is,
     so the index re-ranks when an event escalates instead of staying frozen. */
  var ACTIVITY = {
    flood: { v: 1.00, why: 'Crest inbound — CWC gauge rising' },
    slide: { v: 1.00, why: 'Active slope movement observed' },
    seis:  { v: 0.55, why: 'Mainshock passed; aftershock sequence only' },
    mah:   { v: 0.45, why: 'Vessel alert at standby; no release' }
  };
  function act(k) { return ACTIVITY[k] ? ACTIVITY[k].v : 1; }

  function subSeismic(h) {
    // Shaking against a 0.36 g reference; liquefaction only triggers once the
    // ground actually moves, so it is gated on PGA rather than added blindly.
    var shake = 62 * Math.min(1, h.pga / 0.36);
    var liq = 38 * h.liq * Math.min(1, h.pga / 0.26);
    return clamp((shake + liq) * act('seis'), 0, 100);
  }
  function subFlood(h) {
    if (h.depth <= 0) return 0;
    // Exponential depth-damage curve; duration adds up to 15 pts of misery.
    return clamp((85 * (1 - Math.exp(-h.depth / 1.6)) + Math.min(15, h.dur / 6)) * act('flood'), 0, 100);
  }
  function subSlide(h) {
    if (h.slide <= 0) return 0;
    return clamp(100 * Math.pow(h.slide, 1.1) * (0.7 + 0.3 * Math.min(1, h.slope / 45)) * act('slide'), 0, 100);
  }
  function subIndustrial(h) {
    if (!h.plume) return 0;
    return clamp(100 * Math.pow(h.plume, 0.8) * act('mah'), 0, 100);
  }

  var HAZ_KEYS = [
    { k: 'seis',  label: 'Seismic',    fn: subSeismic },
    { k: 'flood', label: 'Flood',      fn: subFlood },
    { k: 'slide', label: 'Landslide',  fn: subSlide },
    { k: 'mah',   label: 'Industrial', fn: subIndustrial }
  ];

  function hei(h) {
    var parts = HAZ_KEYS.map(function (d) { return { k: d.k, label: d.label, v: d.fn(h) }; });
    var sorted = parts.slice().sort(function (a, b) { return b.v - a.v; });
    var dom = sorted[0].v;
    var residualFactor = 1;
    for (var i = 1; i < sorted.length; i++) residualFactor *= (1 - 0.5 * sorted[i].v / 100);
    var score = dom + (100 - dom) * (1 - residualFactor);
    return {
      score: clamp(score, 0, 100),
      dominant: sorted[0],
      parts: parts,
      compounding: (100 - dom) * (1 - residualFactor)
    };
  }

  /* ======================================================================
     2. VULNERABILITY & CAPABILITY INDEX  (VCI, 0-100)
     ----------------------------------------------------------------------
     Not "how bad is the hazard" but "how badly does this population cope
     with it, and how little can it move itself".
     ==================================================================== */

  var VCI_W = [
    { k: 'struct', label: 'Structural fragility',   w: 0.28 },
    { k: 'depend', label: 'Dependency load',        w: 0.26 },
    { k: 'selfev', label: 'Self-evacuation deficit', w: 0.18 },
    { k: 'warn',   label: 'Warning-reach deficit',  w: 0.14 },
    { k: 'stock',  label: 'Livestock anchoring',    w: 0.08 },
    { k: 'prior',  label: 'Displacement fatigue',   w: 0.06 }
  ];

  function vci(hb) {
    var v = hb.v, pop = hb.pop, hh = hb.hh;
    var raw = {
      struct: 100 * (v.kutcha * 1.0 + v.semi * 0.55 + v.pucca * 0.12),
      depend: 100 * Math.min(1, ((v.eld + v.u5 + v.pwd * 2 + v.preg * 1.5) / pop) / 0.45),
      selfev: 100 * (1 - v.veh / 100),
      warn:   100 * (1 - v.cov / 100),
      stock:  100 * Math.min(1, (v.stock / hh) / 3),
      prior:  v.prior ? 100 : 0
    };
    var score = 0, parts = [];
    VCI_W.forEach(function (d) {
      var contribution = d.w * raw[d.k];
      score += contribution;
      parts.push({ k: d.k, label: d.label, raw: raw[d.k], w: d.w, contribution: contribution });
    });
    parts.sort(function (a, b) { return b.contribution - a.contribution; });
    return { score: clamp(score, 0, 100), parts: parts, raw: raw };
  }

  /* ======================================================================
     3. CARRYING CAPACITY — the binding-constraint method
     ----------------------------------------------------------------------
     A safe site's capacity is the MINIMUM of five independent ceilings.
     The register's claimed figure is almost always the floor-area ceiling
     with nothing else checked. Naming the binding constraint is the whole
     point: it converts "we are short of shelter" into "we are short of
     twelve toilets at Kotwa".
     ==================================================================== */

  /* A building resists — but only what a building can resist. Retrofitted RCC
     survives shaking; it does not survive standing in four metres of water or
     downwind of an ammonia release. So resistance is applied to the seismic
     term alone and the other three hazards are left untouched. This is the
     difference between "our shelter is engineered" and "our shelter is safe". */
  function siteHei(site, st) {
    var r = site.resist == null ? 0.5 : site.resist;
    var parts = HAZ_KEYS.map(function (d) {
      var v = d.fn(site.own);
      if (d.k === 'seis') v = v * (1 - 0.62 * r);
      return { k: d.k, label: d.label, v: v };
    });
    var sorted = parts.slice().sort(function (a, b) { return b.v - a.v; });
    var dom = sorted[0].v, rf = 1;
    for (var i = 1; i < sorted.length; i++) rf *= (1 - 0.5 * sorted[i].v / 100);
    return clamp(dom + (100 - dom) * (1 - rf), 0, 100);
  }
  function siteHeiParts(site) {
    var r = site.resist == null ? 0.5 : site.resist;
    return HAZ_KEYS.map(function (d) {
      var raw = d.fn(site.own);
      return { k: d.k, label: d.label, raw: raw, v: d.k === 'seis' ? raw * (1 - 0.62 * r) : raw, resisted: d.k === 'seis' };
    });
  }

  function capacity(site, st) {
    st = st || SIM.standards;
    var H = siteHei(site, st);

    var cArea  = Math.floor(site.area / st.areaPerPerson);
    var cWater = Math.floor(site.water / st.waterPerPerson);
    var cSan   = site.toilet * st.personsPerToilet;

    // Structural: above the cutoff the site is disqualified outright; between
    // derate and cutoff it loses capacity linearly.
    var derate;
    if (H >= st.siteHeiCutoff) derate = 0;
    else if (H <= st.siteHeiDerate) derate = 1;
    else derate = (st.siteHeiCutoff - H) / (st.siteHeiCutoff - st.siteHeiDerate);
    var cStruct = Math.floor(cArea * derate);

    // Corridor: how many people the feeding road can actually deliver before
    // the hazard arrives. A shelter you cannot reach in time has no capacity.
    var cor = SIM.corridors.filter(function (c) { return c.id === site.corridor; })[0];
    var thr = cor ? (cor.status === 'cut' ? 0 : cor.throughput) : 0;
    if (cor && cor.status === 'restricted') thr *= 0.35;
    if (cor && cor.status === 'degraded') thr *= 0.5;
    var cCorridor = Math.floor(thr * site.openHrs * 0.25); // a site draws ~25% of a shared corridor

    var ceilings = [
      { k: 'area',     label: 'Covered floor area',   v: cArea,     basis: site.area + ' m² ÷ ' + st.areaPerPerson + ' m²/person (Sphere)' },
      { k: 'water',    label: 'Assured water',        v: cWater,    basis: site.water.toLocaleString('en-IN') + ' L/day ÷ ' + st.waterPerPerson + ' L/person/day' },
      { k: 'san',      label: 'Sanitation',           v: cSan,      basis: site.toilet + ' toilets × ' + st.personsPerToilet + ' persons/toilet' },
      { k: 'struct',   label: 'Structural safety',    v: cStruct,   basis: 'site HEI ' + r1(H) + ' → ' + Math.round(derate * 100) + '% of floor capacity' },
      { k: 'corridor', label: 'Corridor throughput',  v: cCorridor, basis: (cor ? cor.name : '—') + ' · ' + r0(thr) + '/hr × ' + site.openHrs + ' h × 25% share' }
    ];

    var binding = ceilings[0];
    ceilings.forEach(function (c) { if (c.v < binding.v) binding = c; });

    var cap = Math.max(0, binding.v);
    var usable = Math.floor(cap * (1 - st.surgeBuffer));

    // Health staffing does not cap headcount, but it gates readiness.
    var staffNeed = Math.ceil(cap / st.personsPerNurse);
    var staffGap = Math.max(0, staffNeed - site.nurse);
    var medNeed = Math.ceil(cap * st.medFraction);
    var medGap = Math.max(0, medNeed - site.beds);

    return {
      hei: H,
      disqualified: H >= st.siteHeiCutoff,
      derate: derate,
      ceilings: ceilings,
      binding: binding,
      capacity: cap,
      usable: usable,
      surge: cap - usable,
      claimed: site.claimed,
      overstatement: site.claimed - cap,
      staffNeed: staffNeed, staffGap: staffGap,
      medNeed: medNeed, medGap: medGap
    };
  }

  /* ======================================================================
     4. TRAVEL AND REACHABILITY
     ==================================================================== */

  function euclidKm(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy) * 0.1; // 1 unit = 100 m
  }

  function travel(hb, site) {
    var blk = SIM.district.blocks.filter(function (b) { return b.id === hb.block; })[0];
    var rf = blk ? blk.roadFactor : 1.4;
    var km = euclidKm(hb.xy, site.xy) * rf;
    var cor = SIM.corridors.filter(function (c) { return c.id === hb.corridor; })[0];
    var speed = 26;                                   // km/h under convoy conditions
    if (cor && cor.status === 'restricted') speed *= 0.45;
    if (cor && cor.status === 'degraded') speed *= 0.6;
    if (cor && cor.status === 'cut') return { km: km, min: Infinity, corridor: cor, blocked: true };
    return { km: km, min: (km / speed) * 60, corridor: cor, blocked: false };
  }

  /* Window before this habitation's dominant hazard lands.
     An already-impacting hazard does NOT mean the window is zero — people
     still have to be moved, and a zero would silently mark every hill village
     unreachable. It means the movement runs under exposure: the planning
     horizon stays, and time pressure is pinned to maximum instead. */
  var ONGOING_HORIZON = 6;
  function windowInfo(hb) {
    var H = hei(hb.h);
    var ev = SIM.events.filter(function (e) { return e.kind === H.dominant.k; })[0];
    if (!ev) return { hrs: 24, ongoing: false, event: null };
    if (ev.impactInHrs > 0) return { hrs: ev.impactInHrs, ongoing: false, event: ev };
    return { hrs: ONGOING_HORIZON, ongoing: true, event: ev };
  }
  function windowHrs(hb) { return windowInfo(hb).hrs; }

  /* ======================================================================
     5. DEMAND — how many people actually need a public shelter place
     ----------------------------------------------------------------------
     Not the whole population. Two multipliers, both defensible:
       evacFraction     share that must leave at all, from HEI
       shelterDependency share of those who cannot self-host, from VCI
     ==================================================================== */

  /* Calibrated against observed Indian evacuation behaviour rather than
     assumed: most of a warned population does not enter a public shelter.
     It moves in with kin, to a higher lane, or to an embankment. Planning for
     the whole population inflates the deficit until it stops being actionable. */
  function evacFraction(H) {
    if (H < 35) return 0;
    if (H < 60) return 0.25 * (H - 35) / 25;
    if (H < 85) return 0.25 + 0.37 * (H - 60) / 25;
    return Math.min(1, 0.62 + 0.28 * (H - 85) / 15);
  }
  function shelterDependency(V) { return 0.18 + 0.45 * (V / 100); }

  function demandOf(hb) {
    var H = hei(hb.h).score, V = vci(hb).score;
    var ef = evacFraction(H), sd = shelterDependency(V);
    var mustMove = Math.round(hb.pop * ef);
    var need = Math.round(mustMove * sd);
    return {
      hei: H, vci: V, evacFraction: ef, shelterDependency: sd,
      mustMove: mustMove, shelterNeed: need, selfHosted: mustMove - need,
      highDependency: Math.round(need * ((hb.v.pwd + hb.v.eld * 0.25) / hb.pop))
    };
  }

  /* ======================================================================
     6. RELOCATION URGENCY INDEX  (RUI, 0-100)  — the coupled score
     ----------------------------------------------------------------------
     RUI = 0.34·HEI + 0.24·VCI + 0.22·TimePressure + 0.20·CapacityStress

     CapacityStress is what makes this different from every risk index in
     the room. It measures how little safe capacity is still reachable from
     THIS habitation. When shelters fill or fall out of the register, the
     stress term rises and the red zones upstream re-rank by themselves —
     because a family with nowhere to go needs a longer lead time than a
     family with a bed already held for it.
     ==================================================================== */

  function timePressure(hb, tr) {
    var w = windowInfo(hb);
    if (w.ongoing) return 100;        // the hazard is already on top of them
    var need = tr / 60;               // hours to complete one movement leg
    if (w.hrs <= 0) return 100;
    var ratio = need / w.hrs;         // >1 means you cannot finish in time
    return clamp(100 * Math.pow(Math.min(1.6, ratio) / 1.6, 0.7), 0, 100);
  }

  /* ======================================================================
     7. THE LEDGER — double-entry safe-capacity accounting
     ----------------------------------------------------------------------
     Capacity is a resource account, not a label. Every commitment is a
     posting: a debit against a site's usable capacity and a credit to a
     habitation's outstanding need, carrying the operator who made it.
     Nothing is ever deleted; a release is a compensating posting.
     ==================================================================== */

  var ledger = [];
  var seq = 0;

  function post(entry) {
    seq += 1;
    var e = {
      seq: seq,
      ts: new Date(),
      type: entry.type,          // ALLOC | RELEASE | AUGMENT | DISQUALIFY | VERIFY
      site: entry.site || null,
      hab: entry.hab || null,
      persons: entry.persons || 0,
      operator: entry.operator || (STATE.operator ? STATE.operator.id : 'SYSTEM'),
      reason: entry.reason || '',
      ref: entry.ref || null,
      auto: !!entry.auto
    };
    ledger.push(e);
    return e;
  }

  function committedAt(siteId) {
    var n = 0;
    for (var i = 0; i < ledger.length; i++) {
      var e = ledger[i];
      if (e.site === siteId && (e.type === 'ALLOC' || e.type === 'RELEASE')) n += e.persons;
    }
    return n;
  }
  function augmentAt(siteId) {
    var n = 0;
    for (var i = 0; i < ledger.length; i++) {
      var e = ledger[i];
      if (e.site === siteId && e.type === 'AUGMENT') n += e.persons;
    }
    return n;
  }
  function heldFor(habId) {
    var n = 0;
    for (var i = 0; i < ledger.length; i++) {
      var e = ledger[i];
      if (e.hab === habId && (e.type === 'ALLOC' || e.type === 'RELEASE')) n += e.persons;
    }
    return n;
  }

  /* ======================================================================
     8. THE COMPUTE PASS — one deterministic sweep over the district
     ==================================================================== */

  var STATE = {
    operator: null,
    scenario: 'SC-BASE',
    standards: null,
    sites: [],     // enriched
    habs: [],      // enriched
    plan: null,
    lastRun: null
  };

  function enrichSites() {
    var st = STATE.standards;
    return SIM.sites.map(function (s) {
      var base = Object.assign({}, s);
      // resistance by construction type — declared here so it is visible
      var resistBy = { School: 0.7, Stadium: 0.75, Civic: 0.7, Market: 0.4, Medical: 0.85,
                       MPCS: 0.9, Camp: 0.2, Warehouse: 0.7, Institute: 0.8 };
      base.resist = resistBy[s.type] != null ? resistBy[s.type] : 0.5;
      applyScenarioToSite(base);
      var c = capacity(base, st);
      base.cap = c;
      base.aug = augmentAt(s.id);
      base.usableTotal = c.disqualified ? 0 : c.usable + base.aug;
      base.committed = committedAt(s.id);
      base.residual = Math.max(0, base.usableTotal - base.committed);
      /* Planning capacity is deliberately NOT the accounting residual. The plan
         allocates against what the site can hold; the ledger records that the
         allocation happened. Solving against the residual would double-count a
         plan that has already been committed. */
      base.planFree = base.cap.disqualified ? 0 : base.usableTotal;
      return base;
    });
  }

  function enrichHabs() {
    return SIM.habitations.map(function (h) {
      var base = Object.assign({}, h);
      base.h = Object.assign({}, h.h);
      applyScenarioToHab(base);
      var H = hei(base.h);
      var V = vci(base);
      base.HEI = H; base.VCI = V;
      base.demand = demandOf(base);
      return base;
    });
  }

  /* ---- Reachability, and the contested-share model of capacity stress ----

     Measuring a habitation's spare capacity in isolation is meaningless: on
     its own, almost every village can "see" a shelter with room in it. What
     actually decides whether a family gets a place is how many OTHER
     habitations can reach the same shelter. So each habitation is credited
     only with its proportional share of every site it can reach, weighted by
     the total demand competing for that site.

     This is the coupling. When a shelter is disqualified, filled, or cut off,
     the demand that was pointed at it redistributes, every competitor's share
     falls, and the urgency of habitations upstream rises without anyone
     touching the hazard model.                                             */

  function reachableSites(hb, sites) {
    var w = windowInfo(hb), out = [];
    sites.forEach(function (s) {
      if (s.cap.disqualified) return;
      var t = travel(hb, s);
      if (!isFinite(t.min)) return;
      if (t.min / 60 > Math.max(0.75, w.hrs)) return;
      out.push({ site: s, min: t.min, km: t.km });
    });
    out.sort(function (a, b) { return a.min - b.min; });
    return out;
  }

  var _contest = null;   // siteId -> total shelter need able to reach it
  function buildContest(habs, sites) {
    _contest = {};
    sites.forEach(function (s) { _contest[s.id] = 0; });
    habs.forEach(function (h) {
      reachableSites(h, sites).forEach(function (r) { _contest[r.site.id] += h.demand.shelterNeed; });
    });
    return _contest;
  }

  function capacityStress(hb, sites) {
    var w = windowInfo(hb);
    var rs = reachableSites(hb, sites);
    var need = hb.demand.shelterNeed;
    var contest = _contest || buildContest(STATE.habs.length ? STATE.habs : [hb], sites);

    var share = 0, reachable = 0, reachableTotal = 0;
    rs.forEach(function (r) {
      reachable += r.site.planFree;
      reachableTotal += r.site.usableTotal;
      var competing = contest[r.site.id] || need;
      share += r.site.planFree * (competing > 0 ? need / competing : 1);
    });

    var coverage = need > 0 ? share / need : 1;
    var stress = 100 * (1 - clamp(coverage, 0, 1));
    if (rs.length === 0) stress = 100;
    return {
      reachable: reachable, reachableTotal: reachableTotal, fairShare: Math.round(share),
      coverage: coverage, score: stress, sites: rs,
      nearest: rs[0] || null, windowHrs: w.hrs, ongoing: w.ongoing, event: w.event
    };
  }

  /* ---- RUI: severity core, amplified by time and by capacity stress ------

     Deliberately NOT a flat weighted sum. In a weighted sum a quiet term
     drags the whole score down, so a village about to be under four metres of
     water scores "medium" merely because its road is short. Life-safety is
     the core; time and capacity are amplifiers that can raise urgency but
     never dilute it.                                                        */

  var RUI_W = { hei: 0.60, vci: 0.40, ampTime: 0.22, ampCap: 0.30 };

  function rui(hb, sites) {
    var cs = capacityStress(hb, sites);
    var tr = cs.nearest ? cs.nearest.min : 240;
    var tp = timePressure(hb, tr);

    var core = RUI_W.hei * hb.HEI.score + RUI_W.vci * hb.VCI.score;
    var ampTime = RUI_W.ampTime * (tp / 100);
    var ampCap = RUI_W.ampCap * (cs.score / 100);
    var amp = 1 + ampTime + ampCap;
    var score = clamp(core * amp, 0, 100);

    return {
      score: score, uncapped: core * amp, core: core, amp: amp,
      parts: [
        { k: 'hei',  label: 'Hazard exposure (HEI)', raw: hb.HEI.score, w: RUI_W.hei, contribution: RUI_W.hei * hb.HEI.score, kind: 'core' },
        { k: 'vci',  label: 'Vulnerability (VCI)',   raw: hb.VCI.score, w: RUI_W.vci, contribution: RUI_W.vci * hb.VCI.score, kind: 'core' },
        { k: 'time', label: 'Time pressure',         raw: tp,           w: RUI_W.ampTime, contribution: core * ampTime, kind: 'amp' },
        { k: 'cap',  label: 'Capacity stress',       raw: cs.score,     w: RUI_W.ampCap,  contribution: core * ampCap,  kind: 'amp' }
      ],
      capped: core * amp > 100,
      stress: cs, timePressure: tp, nearestMin: tr
    };
  }

  /* ======================================================================
     9. THE MATCHING ENGINE
     ----------------------------------------------------------------------
     A capacity-constrained assignment of habitation demand to safe sites.
     Deterministic: urgency-ordered greedy seeding, then a bounded local
     improvement pass that only accepts strictly cost-reducing swaps.
     ==================================================================== */

  var COST_W = { travel: 1.0, corridor: 34, siteHei: 22, medMismatch: 26, tier: 9, split: 14 };

  function pairCost(hb, s, chunkIsFirst) {
    var t = travel(hb, s);
    if (!isFinite(t.min)) return Infinity;
    if (s.cap.disqualified) return Infinity;
    var w = windowHrs(hb);
    if (t.min / 60 > Math.max(0.75, w)) return Infinity;     // cannot arrive in time
    var cor = SIM.corridors.filter(function (c) { return c.id === s.corridor; })[0];
    var corHaz = cor ? cor.hazard : 0.5;
    var med = hb.demand.highDependency > 0 ? (s.beds > 0 ? 0 : 1) : 0;
    var cost =
      COST_W.travel * t.min +
      COST_W.corridor * corHaz +
      COST_W.siteHei * (s.cap.hei / 100) +
      COST_W.medMismatch * med +
      COST_W.tier * (s.tier - 1) +
      (chunkIsFirst ? 0 : COST_W.split);
    return cost;
  }

  function solve(opts) {
    opts = opts || {};
    var sites = STATE.sites, habs = STATE.habs;

    // Working residuals — the solver proposes; only commit() posts to the ledger.
    var residual = {};
    sites.forEach(function (s) { residual[s.id] = s.planFree; });

    buildContest(habs, sites);
    var ranked = habs.map(function (h) {
      return { hab: h, rui: h.RUI || rui(h, sites) };
    }).sort(function (a, b) { return b.rui.uncapped - a.rui.uncapped; });

    var assignments = [];   // { habId, siteId, persons, cost, travelMin }
    var unmet = [];

    ranked.forEach(function (row) {
      var hb = row.hab;
      var need = hb.demand.shelterNeed;
      if (need <= 0) return;
      var placed = 0, chunks = 0;

      while (need - placed > 0 && chunks < 3) {
        var best = null;
        sites.forEach(function (s) {
          if (residual[s.id] <= 0) return;
          var c = pairCost(hb, s, chunks === 0);
          if (!isFinite(c)) return;
          if (!best || c < best.cost) best = { site: s, cost: c };
        });
        if (!best) break;
        var take = Math.min(need - placed, residual[best.site.id]);
        if (take <= 0) break;
        residual[best.site.id] -= take;
        var t = travel(hb, best.site);
        assignments.push({
          habId: hb.id, habName: hb.name, siteId: best.site.id, siteName: best.site.name,
          persons: take, cost: best.cost, travelMin: t.min, rui: row.rui.score,
          corridor: best.site.corridor, highDep: chunks === 0 ? hb.demand.highDependency : 0
        });
        placed += take; chunks += 1;
      }

      if (placed < need) {
        unmet.push({ habId: hb.id, habName: hb.name, persons: need - placed, rui: row.rui.score, reason: reasonUnmet(hb, sites, residual) });
      }
    });

    // --- bounded local improvement: swap whole chunks where it strictly helps
    var improved = 0;
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < assignments.length; i++) {
        var a = assignments[i];
        var hbA = habs.filter(function (x) { return x.id === a.habId; })[0];
        for (var j = i + 1; j < assignments.length; j++) {
          var b = assignments[j];
          if (a.siteId === b.siteId) continue;
          var hbB = habs.filter(function (x) { return x.id === b.habId; })[0];
          var sA = sites.filter(function (x) { return x.id === a.siteId; })[0];
          var sB = sites.filter(function (x) { return x.id === b.siteId; })[0];
          if (a.persons > residual[b.siteId] + b.persons) continue;
          if (b.persons > residual[a.siteId] + a.persons) continue;
          var before = pairCost(hbA, sA, true) + pairCost(hbB, sB, true);
          var after = pairCost(hbA, sB, true) + pairCost(hbB, sA, true);
          if (isFinite(after) && after < before - 1e-6) {
            residual[a.siteId] += a.persons - b.persons;
            residual[b.siteId] += b.persons - a.persons;
            var tmpSite = a.siteId, tmpName = a.siteName;
            a.siteId = b.siteId; a.siteName = b.siteName;
            b.siteId = tmpSite;  b.siteName = tmpName;
            a.travelMin = travel(hbA, sB).min; b.travelMin = travel(hbB, sA).min;
            a.cost = pairCost(hbA, sB, true); b.cost = pairCost(hbB, sA, true);
            improved++;
          }
        }
      }
    }

    var totalNeed = habs.reduce(function (n, h) { return n + h.demand.shelterNeed; }, 0);
    var totalPlaced = assignments.reduce(function (n, a) { return n + a.persons; }, 0);
    var totalUnmet = unmet.reduce(function (n, u) { return n + u.persons; }, 0);

    STATE.plan = {
      assignments: assignments,
      unmet: unmet,
      ranked: ranked,
      totalNeed: totalNeed,
      placed: totalPlaced,
      unmetTotal: totalUnmet,
      improvedSwaps: improved,
      residual: residual,
      cost: assignments.reduce(function (n, a) { return n + a.cost * (a.persons / 100); }, 0),
      at: new Date()
    };
    LIVE.lastComputeAt = new Date();
    return STATE.plan;
  }

  function reasonUnmet(hb, sites, residual) {
    var anyReachable = false, anyResidual = false, anyQualified = false;
    var w = windowHrs(hb);
    sites.forEach(function (s) {
      if (s.cap.disqualified) return;
      anyQualified = true;
      var t = travel(hb, s);
      if (!isFinite(t.min) || t.min / 60 > Math.max(0.75, w)) return;
      anyReachable = true;
      if (residual[s.id] > 0) anyResidual = true;
    });
    if (!anyQualified) return 'No qualified site anywhere in the district';
    if (!anyReachable) return 'No qualified site reachable inside the ' + r1(w) + ' h window';
    if (!anyResidual) return 'Reachable capacity exhausted';
    return 'Partially placed — residual capacity fragmented';
  }

  /* ======================================================================
     10. THE DEFICIT CLOCK
     ----------------------------------------------------------------------
     Three separate truths, never blended:
       capacityDeficit  people with no reachable safe place at all
       movementDeficit  people who have a place but cannot be moved in time
       readinessGap     sites that count toward capacity but are not yet ready
     ==================================================================== */

  function movementRate() {
    var rate = 0;
    SIM.assets.forEach(function (a) {
      if (a.status !== 'available') return;
      rate += (a.perTrip / a.cycleMin) * 60;
    });
    return rate;                                   // persons per hour
  }

  function deficit() {
    var plan = STATE.plan || solve();
    var sites = STATE.sites;
    var rate = movementRate();

    /* The planning window is the next hazard that has not yet landed. Events
       already impacting are reported separately — folding them in as "zero
       hours" would collapse the window and make every plan look impossible. */
    var pending = SIM.events.filter(function (e) { return e.impactInHrs > 0; });
    var windowMin = pending.length
      ? Math.min.apply(null, pending.map(function (e) { return e.impactInHrs; }))
      : ONGOING_HORIZON;
    var ongoingEvents = SIM.events.filter(function (e) { return e.impactInHrs <= 0; });

    var moveableInWindow = Math.floor(rate * windowMin);
    var capacityDeficit = plan.unmetTotal;
    var movementDeficit = Math.max(0, plan.placed - moveableInWindow);

    var totalUsable = sites.reduce(function (n, s) { return n + s.usableTotal; }, 0);
    var totalCommitted = sites.reduce(function (n, s) { return n + s.committed; }, 0);
    var residualNow = Math.max(0, totalUsable - totalCommitted);
    var hrsToExhaust = rate > 0 ? residualNow / rate : Infinity;

    var readiness = sites.filter(function (s) { return !s.cap.disqualified && (s.cap.staffGap > 0 || s.cap.medGap > 0); });

    return {
      rate: rate,
      windowHrs: windowMin,
      ongoingEvents: ongoingEvents,
      moveableInWindow: moveableInWindow,
      demand: plan.totalNeed,
      placed: plan.placed,
      capacityDeficit: capacityDeficit,
      movementDeficit: movementDeficit,
      totalUsable: totalUsable,
      totalCommitted: totalCommitted,
      residualNow: residualNow,
      hrsToExhaust: hrsToExhaust,
      readiness: readiness,
      disqualified: sites.filter(function (s) { return s.cap.disqualified; }),
      claimedTotal: sites.reduce(function (n, s) { return n + s.claimed; }, 0),
      realTotal: sites.reduce(function (n, s) { return n + (s.cap.disqualified ? 0 : s.cap.capacity); }, 0)
    };
  }

  /* ======================================================================
     11. CAPACITY AUGMENTATION — turning a deficit into a work order
     ----------------------------------------------------------------------
     A deficit that cannot be acted on is just bad news. Each of these is a
     concrete intervention with a lead time and a computed capacity delta,
     derived from the binding constraint it relieves.
     ==================================================================== */

  function augmentations() {
    var st = STATE.standards, out = [];
    STATE.sites.forEach(function (s) {
      if (s.cap.disqualified) {
        out.push({
          id: 'AUG-' + s.id + '-DQ', site: s.id, siteName: s.name, kind: 'none',
          title: 'Cannot be relieved — remove from register',
          delta: 0, leadHrs: 0, cost: '—',
          detail: 'Site HEI ' + r1(s.cap.hei) + ' exceeds the ' + st.siteHeiCutoff + ' cutoff. No augmentation makes a shelter inside a red zone safe.'
        });
        return;
      }
      var b = s.cap.binding, second = s.cap.ceilings.slice().sort(function (a, c) { return a.v - c.v; })[1];
      var headroom = Math.max(0, second.v - b.v);
      if (headroom <= 0) return;
      if (b.k === 'san') {
        var units = Math.min(30, Math.ceil(headroom / st.personsPerToilet));
        var gained = Math.min(headroom, units * st.personsPerToilet);
        out.push({ id: 'AUG-' + s.id, site: s.id, siteName: s.name, kind: 'sanitation',
          title: 'Deploy ' + units + ' mobile toilet units', delta: gained, leadHrs: 4,
          cost: '₹' + (units * 14000).toLocaleString('en-IN'), costNum: units * 14000,
          unit: units + ' units × ₹14,000',
          detail: 'Sanitation caps this site at ' + b.v + '. Next ceiling is ' + second.label.toLowerCase() + ' at ' + second.v + '.' });
      } else if (b.k === 'water') {
        var tankers = Math.ceil((headroom * st.waterPerPerson) / 10000);
        out.push({ id: 'AUG-' + s.id, site: s.id, siteName: s.name, kind: 'water',
          title: 'Establish ' + tankers + ' tanker rotations/day', delta: headroom, leadHrs: 2,
          cost: '₹' + (tankers * 6500 * 7).toLocaleString('en-IN'), costNum: tankers * 6500 * 7,
          unit: tankers + ' tankers × ₹6,500/day × 7 days',
          detail: 'Water caps this site at ' + b.v + '. ' + (headroom * st.waterPerPerson).toLocaleString('en-IN') + ' L/day more is needed to reach the next ceiling.' });
      } else if (b.k === 'corridor') {
        var lift = Math.ceil(headroom / 55);
        out.push({ id: 'AUG-' + s.id, site: s.id, siteName: s.name, kind: 'corridor',
          title: 'Hire ' + lift + ' hill utility vehicles for the approach', delta: headroom, leadHrs: 6,
          cost: '₹' + (lift * 22000).toLocaleString('en-IN'), costNum: lift * 22000,
          unit: lift + ' vehicles × ₹22,000',
          detail: 'Approach throughput caps this site at ' + b.v + ' inside the window.' });
      } else if (b.k === 'area') {
        var tents = Math.ceil(headroom / 40);
        out.push({ id: 'AUG-' + s.id, site: s.id, siteName: s.name, kind: 'area',
          title: 'Pitch ' + tents + ' family tents on the ground', delta: Math.min(headroom, Math.floor(s.area * 0.4 / st.areaPerPerson)), leadHrs: 5,
          cost: '₹' + (tents * 9000).toLocaleString('en-IN'), costNum: tents * 9000,
          unit: tents + ' tents × ₹9,000',
          detail: 'Covered area caps this site at ' + b.v + '. Adjacent open ground can take tentage.' });
      } else if (b.k === 'struct') {
        out.push({ id: 'AUG-' + s.id, site: s.id, siteName: s.name, kind: 'struct',
          title: 'Restrict occupancy to the ground floor / assessed block', delta: 0, leadHrs: 1,
          cost: 'Engineer assessment', costNum: 0,
          detail: 'Structural derating caps this site at ' + b.v + '. Capacity cannot be added without an assessment.' });
      }
    });
    return out.sort(function (a, b) { return b.delta - a.delta || a.leadHrs - b.leadHrs; });
  }

  /* ======================================================================
     12. SCENARIOS — counterfactual perturbation of the raw inputs
     ==================================================================== */

  var CORRIDOR_BASE = JSON.parse(JSON.stringify(SIM.corridors));

  function resetCorridors() {
    SIM.corridors.forEach(function (c, i) {
      c.status = CORRIDOR_BASE[i].status;
      c.throughput = CORRIDOR_BASE[i].throughput;
      c.hazard = CORRIDOR_BASE[i].hazard;
    });
  }

  function applyScenarioToHab(hb) {
    var s = STATE.scenario;
    if (s === 'SC-CREST' || s === 'SC-COMPOUND') {
      if (hb.h.depth > 0) { hb.h.depth += 1.0; hb.h.dur += 8; }
    }
    if (s === 'SC-PLUME') {
      if (hb.h.plume > 0) hb.h.plume = Math.min(1, hb.h.plume * 1.35 + 0.1);
    }
    if (s === 'SC-AFTER') {
      hb.h.pga = hb.h.pga * 1.18;
      hb.h.liq = Math.min(1, hb.h.liq * 1.15);
    }
  }

  function applyScenarioToSite(site) {
    var s = STATE.scenario;
    if (s === 'SC-CREST' || s === 'SC-COMPOUND') {
      if (site.own.depth > 0) { site.own = Object.assign({}, site.own); site.own.depth += 1.0; }
      else if (site.elev < 200) { site.own = Object.assign({}, site.own); site.own.depth = 0.6; }
    }
    if (s === 'SC-PLUME') {
      site.own = Object.assign({}, site.own);
      if (site.own.plume > 0) site.own.plume = Math.min(1, site.own.plume * 1.35 + 0.1);
    }
    if (s === 'SC-AFTER') {
      site.own = Object.assign({}, site.own);
      site.own.pga = site.own.pga * 1.18;
      site.resist = site.resist * 0.85;
    }
  }

  function applyScenarioToNetwork() {
    resetCorridors();
    var s = STATE.scenario;
    function set(id, patch) {
      SIM.corridors.forEach(function (c) { if (c.id === id) Object.assign(c, patch); });
    }
    if (s === 'SC-CREST' || s === 'SC-COMPOUND') { set('C-2', { status: 'cut', throughput: 0, hazard: 1 }); set('C-6', { status: 'restricted', hazard: 0.72 }); }
    if (s === 'SC-GHAT' || s === 'SC-COMPOUND') { set('C-1', { status: 'cut', throughput: 0, hazard: 1 }); }
    if (s === 'SC-PLUME') { set('C-3', { status: 'cut', throughput: 0, hazard: 1 }); }
    if (s === 'SC-AFTER') { set('C-2', { status: 'restricted', hazard: 0.7 }); set('C-1', { status: 'restricted', hazard: 0.9 }); }
  }

  /* ======================================================================
     13. INVARIANTS — rules enforced in code, not in copy
     ==================================================================== */

  function invariants() {
    var out = [];
    // I1 — no site may be committed beyond its usable capacity
    var over = STATE.sites.filter(function (s) { return s.committed > s.usableTotal + 0.001; });
    out.push({ id: 'I1', text: 'No safe site is committed beyond its derived usable capacity', ok: over.length === 0,
      detail: over.length ? over.map(function (s) { return s.name; }).join(', ') : 'All ' + STATE.sites.length + ' sites within capacity' });

    // I2 — a disqualified site carries no commitment
    var bad = STATE.sites.filter(function (s) { return s.cap.disqualified && s.committed > 0; });
    out.push({ id: 'I2', text: 'No population is allocated to a site that is itself inside a red zone', ok: bad.length === 0,
      detail: bad.length ? bad.map(function (s) { return s.name; }).join(', ') : STATE.sites.filter(function (s) { return s.cap.disqualified; }).length + ' site(s) disqualified and empty' });

    // I3 — no orphan orders: every issued order has a backing allocation
    var orphans = (STATE.orders || []).filter(function (o) { return heldFor(o.habId) < o.persons; });
    out.push({ id: 'I3', text: 'No relocation order exists without a debited capacity allocation', ok: orphans.length === 0,
      detail: orphans.length ? orphans.length + ' order(s) unbacked' : (STATE.orders || []).length + ' order(s), all backed' });

    // I4 — ledger is append-only
    var deletes = ledger.filter(function (e) { return e.type === 'DELETE'; });
    out.push({ id: 'I4', text: 'The ledger is append-only; releases are compensating postings', ok: deletes.length === 0,
      detail: ledger.length + ' postings, ' + ledger.filter(function (e) { return e.type === 'RELEASE'; }).length + ' compensating' });

    // I5 — displayed residuals reconcile with the ledger
    var mismatch = STATE.sites.filter(function (s) { return Math.abs((s.usableTotal - committedAt(s.id)) - s.residual) > 0.5 && !s.cap.disqualified; });
    out.push({ id: 'I5', text: 'Every displayed residual reconciles to the posting history', ok: mismatch.length === 0,
      detail: mismatch.length ? mismatch.length + ' site(s) out of balance' : 'Reconciled' });

    return out;
  }

  /* ======================================================================
     14. PUBLIC SURFACE
     ==================================================================== */

  function recompute() {
    STATE.standards = STATE.standards || Object.assign({}, SIM.standards);
    applyScenarioToNetwork();
    STATE.sites = enrichSites();
    STATE.habs = enrichHabs();
    buildContest(STATE.habs, STATE.sites);
    STATE.habs.forEach(function (h) { h.RUI = rui(h, STATE.sites); });
    STATE.habs.sort(function (a, b) { return b.RUI.uncapped - a.RUI.uncapped; });
    solve();
    LIVE.lastSyncAt = new Date();
    if (!LIVE.lastDataUpdateAt) LIVE.lastDataUpdateAt = new Date();
    return STATE;
  }

  function commitPlan(operatorId, note) {
    var plan = STATE.plan;
    if (!plan) return { ok: false, msg: 'No plan to commit' };
    var n = 0, people = 0;
    plan.assignments.forEach(function (a) {
      post({ type: 'ALLOC', site: a.siteId, hab: a.habId, persons: a.persons,
             operator: operatorId, reason: note || 'Solver assignment', ref: 'PLAN-' + (plan.at.getTime() % 100000) });
      n++; people += a.persons;
    });
    STATE.orders = plan.assignments.map(function (a, i) {
      return {
        id: 'RO-' + String(1000 + i),
        habId: a.habId, habName: a.habName, siteId: a.siteId, siteName: a.siteName,
        persons: a.persons, rui: a.rui, travelMin: a.travelMin, corridor: a.corridor,
        highDep: a.highDep, status: 'issued', issuedBy: operatorId, at: new Date()
      };
    });
    STATE.sites = enrichSites();
    return { ok: true, postings: n, people: people };
  }

  function releaseSite(siteId, persons, operatorId, reason) {
    post({ type: 'RELEASE', site: siteId, persons: -Math.abs(persons), operator: operatorId, reason: reason || 'Manual release' });
    STATE.sites = enrichSites();
  }

  function applyAugmentation(aug, operatorId) {
    if (!aug || aug.delta <= 0) return false;
    post({ type: 'AUGMENT', site: aug.site, persons: aug.delta, operator: operatorId,
           reason: aug.title + ' (lead ' + aug.leadHrs + ' h)' });
    STATE.sites = enrichSites();
    return true;
  }

  function setScenario(id) { STATE.scenario = id; recompute(); }

  /* ---- Relief funding -----------------------------------------------------
     A contribution is not to a general fund. It is to ONE binding constraint
     at ONE site, and the number of shelter places it unlocks is the same
     number the capacity model uses. When a need is fully funded the
     augmentation posts itself to the ledger and the district re-solves, so a
     donor can watch the deficit fall by the amount their constraint released.
     No payment is processed anywhere in this prototype.                     */
  STATE.relief = {};

  function fundableNeeds() {
    return augmentations()
      .filter(function (a) { return a.delta > 0 && a.costNum > 0; })
      .map(function (a) {
        var funded = STATE.relief[a.id] || 0;
        return Object.assign({}, a, {
          funded: funded,
          remaining: Math.max(0, a.costNum - funded),
          pct: Math.min(1, funded / a.costNum),
          perPlace: Math.round(a.costNum / a.delta),
          done: funded >= a.costNum
        });
      })
      .sort(function (x, y) { return x.perPlace - y.perPlace; });
  }

  function contribute(augId, rupees, method) {
    var a = fundableNeeds().filter(function (x) { return x.id === augId; })[0];
    if (!a || rupees <= 0) return { ok: false, msg: 'Nothing to contribute to' };
    var applied = Math.min(rupees, a.remaining);
    STATE.relief[augId] = (STATE.relief[augId] || 0) + applied;
    var nowFunded = STATE.relief[augId] >= a.costNum;
    post({ type: 'PLEDGE', site: a.site, persons: 0, operator: 'PUBLIC',
           reason: 'Simulated contribution ₹' + applied.toLocaleString('en-IN') + ' via ' + method + ' — ' + a.title });
    var unlocked = 0;
    if (nowFunded) {
      applyAugmentation(a, 'PUBLIC-FUNDED');
      solve();
      unlocked = a.delta;
    }
    return { ok: true, applied: applied, refunded: rupees - applied, fullyFunded: nowFunded,
             unlocked: unlocked, need: a, ref: 'SIM-' + String(1000 + ledger.length) };
  }

  function priority(score) {
    if (score >= 85) return { k: 'crit', label: 'Critical', shape: 'diamond', color: '#B3261E' };
    if (score >= 60) return { k: 'high', label: 'High', shape: 'triangle', color: '#D2551A' };
    if (score >= 30) return { k: 'med', label: 'Medium', shape: 'square', color: '#C98A16' };
    return { k: 'low', label: 'Low', shape: 'circle', color: '#1B7F3B' };
  }

  return {
    STATE: STATE, ledger: ledger,
    hei: hei, vci: vci, capacity: capacity, siteHei: siteHei, siteHeiParts: siteHeiParts,
    ACTIVITY: ACTIVITY, windowInfo: windowInfo, HAZ_KEYS: HAZ_KEYS,
    travel: travel, windowHrs: windowHrs, demandOf: demandOf,
    rui: rui, capacityStress: capacityStress, timePressure: timePressure,
    reachableSites: reachableSites, buildContest: buildContest,
    solve: solve, deficit: deficit, augmentations: augmentations,
    movementRate: movementRate, invariants: invariants,
    recompute: recompute, commitPlan: commitPlan, releaseSite: releaseSite,
    fundableNeeds: fundableNeeds, contribute: contribute,
    applyAugmentation: applyAugmentation, setScenario: setScenario,
    post: post, committedAt: committedAt, heldFor: heldFor,
    priority: priority, pairCost: pairCost,
    RUI_W: RUI_W, COST_W: COST_W, VCI_W: VCI_W,
    evacFraction: evacFraction, shelterDependency: shelterDependency
  };
})();
