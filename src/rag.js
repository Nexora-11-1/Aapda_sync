/* ============================================================================
   AapdaSync — rag.js
   ---------------------------------------------------------------------------
   Retrieval-augmented answering, with two paths and one refusal.

   PATH 1 — COMPUTED. Questions about this district ("how many people have no
   place", "what caps Kotwa") are answered from live engine state, not from
   text. The figure quoted is the same object the screens render, so an answer
   can never drift from the dashboard beside it.

   PATH 2 — RETRIEVED. Questions about the historical record or about method
   are answered by BM25 retrieval over a corpus of cited passages, and the
   answer shows which passage each clause came from.

   REFUSAL. If neither path clears its threshold the assistant says it does not
   know. It does not compose a plausible sentence from the nearest passage.
   In a system whose whole argument is that unbacked numbers get people killed,
   a confidently wrong answer is the worst possible failure.

   LIVE NEWS is deliberately NOT wired up. The adapter is at the bottom of this
   file and is inert: a browser cannot fetch cross-origin from file://, and the
   hosted build's CSP blocks external hosts outright. Shipping a retriever that
   silently returned nothing while looking live would be exactly the dishonesty
   this prototype exists to argue against.
   ========================================================================== */

'use strict';

var RAG = (function () {

  /* ------------------------------------------------------------------ corpus */
  function buildCorpus() {
    var docs = [];

    /* The historical record — real events, cited. */
    RECORD.forEach(function (r) {
      docs.push({
        id: r.id + '-sum', title: r.year + ' · ' + r.name,
        text: r.name + ', ' + r.place + ', ' + r.date + '. ' + r.kindLabel + '. ' +
              r.headline + ' ' + r.headlineNote + '. ' + r.lesson,
        source: r.source, url: r.url, kind: 'record', provenance: 'Cited historical record'
      });
      r.facts.forEach(function (f, i) {
        docs.push({
          id: r.id + '-f' + i, title: r.year + ' · ' + r.name + ' — ' + f[0],
          text: r.name + ' ' + f[0] + ': ' + f[1],
          source: r.source, url: r.url, kind: 'record', provenance: 'Cited historical record'
        });
      });
      docs.push({
        id: r.id + '-mech', title: r.year + ' · ' + r.name + ' — what the system does about it',
        text: r.mechanism, source: r.source, url: r.url, kind: 'method',
        provenance: 'System method, motivated by ' + r.year + ' ' + r.name
      });
    });

    /* Method — how each number on the screens is produced. */
    [
      ['Carrying capacity', 'A safe site capacity is the minimum of five ceilings: covered floor area divided by 3.5 square metres per person, assured water divided by 15 litres per person per day, toilets multiplied by 20 persons per toilet, a structural ceiling from the site own hazard exposure, and corridor throughput multiplied by the hours the approach road stays open. The binding constraint is the smallest of the five and is named on every screen.'],
      ['Hazard exposure index', 'HEI combines four hazards by dominant plus residual. The worst hazard sets the floor and the remaining hazards eat into what is left of the scale. Averaging would let three quiet hazards hide one lethal one. Each hazard sub-score is scaled by an activity factor so the index reflects current exposure rather than the static design hazard.'],
      ['Vulnerability index', 'VCI weights structural fragility 0.28, dependency load 0.26, self evacuation deficit 0.18, warning reach deficit 0.14, livestock anchoring 0.08 and displacement fatigue 0.06. Livestock and prior displacement are included because they are the two commonest reasons a warned household still does not leave.'],
      ['Relocation urgency', 'RUI is a severity core of 0.60 times HEI plus 0.40 times VCI, multiplied by an amplifier of one plus 0.22 times time pressure plus 0.30 times capacity stress. Capacity stress is the habitation proportional share of every reachable safe site, weighted by all competing demand. Time and capacity can raise urgency but never dilute life safety.'],
      ['Forecast model', 'The seven day hazard occurrence forecast is a logistic regression on fifteen features: antecedent precipitation over seven and thirty days, yesterday rainfall, three day maximum rainfall, season, slope, landslide susceptibility, elevation, hundred year flood depth, liquefaction, plume fraction, river proximity, days since last event, and two rainfall terrain interactions. It was fitted on a simulated six year history with a time based split and scores 0.83 area under curve on a held out year against a base rate of 0.22.'],
      ['No orphan orders', 'The system refuses to issue a relocation order without a debited capacity allocation behind it. An order with nothing backing it is an instruction to walk somewhere that may already be full.'],
      ['Ledger', 'Safe capacity is a double entry account. Every commitment debits a site and credits a habitation and carries the operator who made it. Nothing is deleted; a release is a compensating posting. Two officers cannot promise the same places twice.'],
      ['Red zone meaning', 'A red zone means elevated modelled risk. It is not proof that every point inside it is unsafe, and it is not an evacuation order. Relocation recommendations require human approval by a government officer.']
    ].forEach(function (m, i) {
      docs.push({ id: 'M-' + i, title: 'Method — ' + m[0], text: m[1],
        source: 'AapdaSync method', url: null, kind: 'method', provenance: 'System method' });
    });

    /* Public safety guidance, per hazard. */
    var G = {
      flood: 'In a flood move to the highest floor or the marked shelter before water enters the lane. Carry identity documents and medicines in a sealed bag. Switch off the mains before leaving. Move livestock to the embankment early. Do not walk or drive through moving water even if it looks shallow. Do not return for belongings once the lane is flowing.',
      slide: 'In a landslide leave along the slope rather than down the valley line. Watch for new cracks, tilting poles and sudden muddy water in a clear stream. Do not shelter at the toe of a slope and do not cross a fresh debris fan on foot.',
      seis: 'In an earthquake drop, cover and hold on until the shaking stops. Leave a damaged kutcha or semi pucca house and stay out. Expect aftershocks for days. Gather at the open assembly ground rather than against a wall. Do not use a lift.',
      mah: 'In a toxic release move crosswind and then upwind, sideways to the smell and then away from it. Cover mouth and nose with a wet cloth. Go to higher ground because most of these gases are heavier than air. Do not shelter in a basement or a pit.'
    };
    Object.keys(G).forEach(function (k) {
      docs.push({ id: 'G-' + k, title: 'Guidance — ' + k, text: G[k],
        source: 'Public safety guidance', url: null, kind: 'guidance', provenance: 'Bundled guidance' });
    });

    docs.push({ id: 'X-emerg', title: 'Emergency numbers', kind: 'guidance',
      text: 'For immediate danger to life call 112, the all India emergency number. AapdaSync does not dispatch emergency services and is a student prototype.',
      source: 'Public safety guidance', url: null, provenance: 'Bundled guidance' });

    return docs;
  }

  /* ------------------------------------------------------------------- BM25 */
  var STOP = {};
  'a an the is are was were of to in on for and or with by at from that this it as be do does did what which who how why when where'.split(' ')
    .forEach(function (w) { STOP[w] = 1; });

  function tok(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(function (w) { return w.length > 2 && !STOP[w]; });
  }

  var DOCS = null, IDF = null, AVGLEN = 0;
  function index() {
    if (DOCS) return;
    DOCS = buildCorpus().map(function (d) {
      var t = tok(d.title + ' ' + d.text);
      var tf = {};
      t.forEach(function (w) { tf[w] = (tf[w] || 0) + 1; });
      return Object.assign({}, d, { tf: tf, len: t.length });
    });
    AVGLEN = DOCS.reduce(function (a, d) { return a + d.len; }, 0) / DOCS.length;
    var df = {};
    DOCS.forEach(function (d) { Object.keys(d.tf).forEach(function (w) { df[w] = (df[w] || 0) + 1; }); });
    IDF = {};
    Object.keys(df).forEach(function (w) {
      IDF[w] = Math.log(1 + (DOCS.length - df[w] + 0.5) / (df[w] + 0.5));
    });
  }

  function search(q, k) {
    index();
    var qt = tok(q), k1 = 1.5, b = 0.75;
    if (!qt.length) return [];
    var scored = DOCS.map(function (d) {
      var s = 0;
      qt.forEach(function (w) {
        var f = d.tf[w]; if (!f) return;
        s += (IDF[w] || 0) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / AVGLEN));
      });
      return { doc: d, score: s };
    }).filter(function (r) { return r.score > 0; })
      .sort(function (x, y) { return y.score - x.score; });
    return scored.slice(0, k || 4);
  }

  /* ------------------------------------------------- path 1: computed facts */
  function findHab(q) {
    var l = q.toLowerCase();
    return (ENG.STATE.habs || []).filter(function (h) { return l.indexOf(h.name.toLowerCase()) >= 0; })[0] || null;
  }
  function findSite(q) {
    var l = q.toLowerCase();
    return (ENG.STATE.sites || []).filter(function (s) {
      var n = s.name.toLowerCase().replace(/,.*$/, '');
      return l.indexOf(n) >= 0 || l.indexOf(s.name.toLowerCase()) >= 0;
    })[0] || null;
  }
  function has(q, words) {
    var l = q.toLowerCase();
    return words.some(function (w) { return l.indexOf(w) >= 0; });
  }
  function n(v) { return Math.round(v).toLocaleString('en-IN'); }

  function computed(q) {
    var d = ENG.deficit();
    var hab = findHab(q), site = findSite(q);

    if (site && has(q, ['capacity', 'cap', 'hold', 'places', 'constraint', 'ceiling'])) {
      var c = site.cap;
      return {
        text: c.disqualified
          ? site.name + ' carries no capacity. Its own hazard exposure is ' + c.hei.toFixed(1) +
            ', above the disqualification cutoff of ' + ENG.STATE.standards.siteHeiCutoff +
            ' — the shelter itself stands in a red zone. The register lists it at ' + n(site.claimed) + '.'
          : site.name + ' can take ' + n(c.capacity) + ' people. The register claims ' + n(site.claimed) +
            '. What caps it is ' + c.binding.label.toLowerCase() + ': ' + c.binding.basis +
            '. ' + n(site.residual) + ' places are free right now.',
        chips: [['Computed', 'ok'], [site.id, 'pri']]
      };
    }
    if (hab && has(q, ['forecast', 'likely', 'predict', 'probability', 'chance', 'next week', 'seven day', '7 day'])) {
      var f = FORECAST.predict(hab.id), tr = FORECAST.trend(hab.id);
      if (!f) return null;
      var bd = FORECAST.band(f.p);
      return {
        text: 'The model puts a hazard impact at ' + hab.name + ' within seven days at ' +
          Math.round(f.p * 100) + '% — ' + bd.label.toLowerCase() + ', and ' + (tr ? tr.label.toLowerCase() : 'flat') +
          ' against last week. The largest contribution is ' + f.parts[0].f.replace(/_/g, ' ') +
          '. Held-out AUC for this model is ' + MODEL.metrics.auc + ' against a base rate of ' +
          MODEL.metrics.base_rate + ', so treat it as a ranking aid, not a certainty.',
        chips: [['Model output', 'inf'], ['Simulated training', 'off']]
      };
    }
    if (hab && has(q, ['where', 'sent', 'shelter', 'go', 'allocat', 'place'])) {
      var as = ENG.STATE.plan.assignments.filter(function (a) { return a.habId === hab.id; });
      var got = as.reduce(function (t, a) { return t + a.persons; }, 0);
      var short = hab.demand.shelterNeed - got;
      return {
        text: as.length
          ? n(hab.demand.shelterNeed) + ' people from ' + hab.name + ' need a shelter place. ' +
            as.map(function (a) { return n(a.persons) + ' to ' + a.siteName + ' (about ' + Math.round(a.travelMin) + ' minutes)'; }).join(', ') +
            '. ' + (short > 0 ? n(short) + ' still have nowhere.' : 'Everyone is placed.')
          : n(hab.demand.shelterNeed) + ' people from ' + hab.name + ' need a shelter place and none has been allocated. ' +
            'The reason recorded is: ' + ((ENG.STATE.plan.unmet.filter(function (u) { return u.habId === hab.id; })[0] || {}).reason || 'unknown') + '.',
        chips: [['Computed', 'ok'], [hab.id, 'pri']]
      };
    }
    if (hab) {
      return {
        text: hab.name + ' scores ' + Math.round(hab.RUI.score) + ' of 100 for relocation urgency — ' +
          ENG.priority(hab.RUI.score).label.toLowerCase() + '. Hazard exposure ' + Math.round(hab.HEI.score) +
          ' (' + hab.HEI.dominant.label.toLowerCase() + '), vulnerability ' + Math.round(hab.VCI.score) +
          ', capacity stress ' + Math.round(hab.RUI.stress.score) + '. Population ' + n(hab.pop) +
          ', of whom ' + n(hab.demand.shelterNeed) + ' would need a shelter place.',
        chips: [['Computed', 'ok'], [hab.id, 'pri']]
      };
    }
    if (has(q, ['deficit', 'nowhere', 'unplaced', 'shortfall', 'short of'])) {
      return {
        text: n(d.capacityDeficit) + ' people have a relocation need and no reachable qualified place. ' +
          'Total shelter need is ' + n(d.demand) + ' against ' + n(d.totalUsable) + ' usable places. ' +
          'The register claims ' + n(d.claimedTotal) + ', which overstates real capacity by ' +
          Math.round((d.claimedTotal - d.realTotal) / d.claimedTotal * 100) + '%.',
        chips: [['Computed', 'ok']]
      };
    }
    if (has(q, ['register', 'overstat', 'claimed', 'real capacity'])) {
      return {
        text: 'The shelter register claims ' + n(d.claimedTotal) + ' places across ' + ENG.STATE.sites.length +
          ' sites. Applying the five ceilings gives ' + n(d.realTotal) + ' — an overstatement of ' +
          n(d.claimedTotal - d.realTotal) + '. ' + d.disqualified.length + ' registered sites carry zero capacity ' +
          'because they stand inside a red zone themselves.',
        chips: [['Computed', 'ok']]
      };
    }
    if (has(q, ['how many', 'total', 'population']) && has(q, ['risk', 'red zone', 'exposed'])) {
      var pop = ENG.STATE.habs.filter(function (h) { return h.RUI.score >= 60; })
        .reduce(function (t, h) { return t + h.pop; }, 0);
      return { text: n(pop) + ' people live in habitations scoring 60 or above for relocation urgency, ' +
        'out of ' + n(ENG.STATE.habs.reduce(function (t, h) { return t + h.pop; }, 0)) + ' in the district.',
        chips: [['Computed', 'ok']] };
    }
    return null;
  }

  /* --------------------------------------------------------------- answering */
  var MIN_SCORE = 2.4;

  function ask(q) {
    if (!q || !q.trim()) return { kind: 'refused', text: 'Ask me something about this district, the method behind a number, or the historical record.' };

    var c = computed(q);
    if (c) return { kind: 'computed', text: c.text, chips: c.chips, sources: [] };

    var hits = search(q, 4);
    if (!hits.length || hits[0].score < MIN_SCORE) {
      return {
        kind: 'refused',
        text: 'I do not have a sourced answer for that. This assistant only answers from computed district state, ' +
          'from the cited historical record, or from the bundled method and guidance notes — it will not guess. ' +
          'For immediate danger to life, call 112.',
        sources: []
      };
    }

    var top = hits[0].doc;
    var body = top.text;
    var extra = hits.slice(1).filter(function (h) { return h.score > hits[0].score * 0.55; });

    return {
      kind: 'retrieved',
      text: body,
      extra: extra.map(function (h) { return { title: h.doc.title, text: h.doc.text }; }),
      sources: hits.filter(function (h) { return h.score > hits[0].score * 0.45; }).map(function (h, i) {
        return { n: i + 1, title: h.doc.title, source: h.doc.source, url: h.doc.url,
                 provenance: h.doc.provenance, score: Math.round(h.score * 100) / 100 };
      })
    };
  }

  var SUGGESTIONS = [
    'What caps Kotwa Higher Sec. School?',
    'How many people have nowhere to go?',
    'Is Dungri Tok likely to be hit next week?',
    'Where are people from Bansi Tola being sent?',
    'How is carrying capacity calculated?',
    'What happened at Bhopal?',
    'What should I do in a landslide?'
  ];

  /* ------------------------------------------------------------ live adapter */
  /* Not connected, and says so. To wire a real feed in a hosted deployment,
     implement fetchLive() against your own same-origin endpoint and push the
     results through addLive(); the retriever will index them like any other
     passage. Nothing in the UI will claim a live source until this returns. */
  var LIVE = { connected: false, endpoint: null, lastAttempt: null, items: [] };
  function fetchLive() {
    return Promise.reject(new Error(
      'No live news source is connected. Cross-origin fetch is blocked from file:// ' +
      'and the hosted build\'s CSP blocks external hosts. Point LIVE.endpoint at a ' +
      'same-origin endpoint and implement this function to enable it.'));
  }
  function addLive(items) {
    index();
    (items || []).forEach(function (it) {
      var t = tok(it.title + ' ' + it.text), tf = {};
      t.forEach(function (w) { tf[w] = (tf[w] || 0) + 1; });
      DOCS.push(Object.assign({ kind: 'live', provenance: 'Live feed' }, it, { tf: tf, len: t.length }));
    });
    LIVE.items = (LIVE.items || []).concat(items || []);
    LIVE.connected = true;
  }
  function status() {
    index();
    return {
      passages: DOCS.length,
      byKind: DOCS.reduce(function (a, d) { a[d.kind] = (a[d.kind] || 0) + 1; return a; }, {}),
      live: LIVE.connected, endpoint: LIVE.endpoint
    };
  }

  return { ask: ask, search: search, status: status, SUGGESTIONS: SUGGESTIONS,
           fetchLive: fetchLive, addLive: addLive, LIVE: LIVE };
})();
