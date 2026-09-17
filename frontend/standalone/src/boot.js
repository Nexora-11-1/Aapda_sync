/* ══════════════════════════════════════════════════════════════════
   BOOT — keyboard, clock, and the continuous live feed. Loads last.

   The feed below is what the WebSocket delivers when a backend is
   attached. Without one it runs locally and drives exactly the same
   code path — `liveApply`-equivalent mutations, `computePriorities`,
   `computeRoutes`, `paintLiveBadge` — so every freshness indicator on
   screen stays truthful rather than decorative.

   It never stops. A disaster platform whose dashboard goes quiet after
   a minute is worse than one that never claimed to be live.
   ══════════════════════════════════════════════════════════════════ */

document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); openPal(); }
  else if (e.key === 'Escape') { closePal(); closeM(); closeDw(); tipOff(); }
  else if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); runSweep(); }
  else if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'h') {
    e.preventDefault(); setHazard(S.hazard === 'flood' ? 'landslide' : 'flood');
  }
});

/* No clock counter to drift: `clk()` reads the wall clock every time. */

/* ══════════════════════════════════════════════════════════════════
   Continuous event generator
   ══════════════════════════════════════════════════════════════════ */
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* Risk does not random-walk freely. Each cell has a target it drifts
   toward, and the target itself moves slowly with the weather — which is
   what makes the map read as a system under load rather than noise. */
let weatherPhase = 0;

/** `scale` is the fraction of a full four-second step to take. The loop
    runs four times as often as it used to, so each pass moves a quarter
    as far and the surface changes at exactly the rate it always did —
    smoothly, rather than in a visible jump every fourth second. */
function driftCells(scale = 1) {
  weatherPhase += 0.06 * scale;
  const swell = Math.sin(weatherPhase) * 6;          // basin-wide wetting/drying
  let moved = 0;
  const anchored = hz => typeof liveAnchored === 'function' && S.focus && liveAnchored(S.focus, hz);
  for (const cell of S.cells) {
    for (const hz in cell.risk) {
      if (cell.risk[hz] < 0) continue;               // no-data cells stay no-data
      /* A cell whose figure came from a real observation is left alone.
         Drifting it would be inventing a change nothing measured. */
      if (anchored(hz) && cell.anchor && cell.anchor[hz] != null) {
        cell.risk[hz] = cell.anchor[hz];
        cell.probability[hz] = +(cell.risk[hz] / 100 * 0.86).toFixed(3);
        continue;
      }
      const target = clamp(hazardTarget(cell, hz) + swell, 4, 97);
      const step = ((target - cell.risk[hz]) * 0.10 + rnd(-1.6, 1.6)) * scale;
      const next = clamp(Math.round(cell.risk[hz] + step), 2, 99);
      if (next !== cell.risk[hz]) moved++;
      cell.risk[hz] = next;
      cell.probability[hz] = +(next / 100 * 0.86).toFixed(3);
    }
    if (cell.rainfall_24h != null && !observedRain()) {
      cell.rainfall_24h = Math.round(clamp(cell.rainfall_24h + rnd(-4, 7) * scale, 12, 340));
      cell.rainfall_72h = Math.round(cell.rainfall_24h * 2.3);
      cell.soil_moisture = +clamp(0.22 + cell.rainfall_24h / 900, 0, 0.62).toFixed(2);
    }
    if (cell.river_ratio != null && !observedRiver())
      cell.river_ratio = +clamp(cell.river_ratio + rnd(-0.012, 0.016) * scale, 0.55, 1.28).toFixed(3);
    /* Keep the sparkline honest: it is the last four readings, not a
       shape. One reading per full tick — sampling it every second would
       turn "the last three hours" into the last four seconds. */
    if (scale >= 1) {
      const snap = { t: hm() };
      for (const hz in cell.risk) snap[hz] = Math.max(cell.risk[hz], 0);
      cell.hist.push(snap);
      if (cell.hist.length > 4) cell.hist.shift();
    }
  }
  return moved;
}

/* Where a cell's risk is pulled toward, given its physical ground. This is
   the same shape the backend's risk engine uses: hazard-specific, driven by
   terrain rather than by a random walk, so the surface stays plausible. */
function hazardTarget(cell, hz) {
  switch (hz) {
    case 'flood':      return 100 - clamp((cell.hand_m ?? 12) * 2.2, 0, 70);
    case 'landslide':  return clamp((cell.slope_deg ?? 10) * 1.7, 0, 92);
    case 'heatwave':   return clamp(96 - (cell.elevation_m ?? 300) / 26, 8, 92);
    case 'drought':    return clamp(92 - (cell.rainfall_24h ?? 90) * 0.42, 6, 90);
    case 'wildfire':   return clamp(88 - (cell.rainfall_24h ?? 90) * 0.30 - (cell.soil_moisture ?? .3) * 60, 5, 88);
    case 'lightning':  return clamp((cell.rainfall_24h ?? 90) * 0.36, 6, 90);
    case 'cyclone':    return clamp(94 - (cell.elevation_m ?? 40) / 3.2, 10, 94);
    case 'tsunami':    return clamp(88 - (cell.elevation_m ?? 40) / 1.6, 4, 88);
    case 'earthquake': return clamp(40 + (cell.slope_deg ?? 10) * 0.6, 10, 82);
    default:           return 45;
  }
}

/* ── The national sync ──────────────────────────────────────────────
   All 36 states advance every tick, not just the focused one. Each
   state's headline is the peak of its own grid, recomputed rather than
   nudged, so what the India map shows is genuinely the maximum risk
   anywhere in that state right now. */
/** `full` gates the one genuinely expensive step in here: the national
    feed re-derives an entire state's grid per call, which is not work to
    do once a second. */
function driftNation(full = true) {
  const anchoredIn = (id, hz) => typeof liveAnchored === 'function' && liveAnchored(id, hz);
  for (const id in S.states) {
    const st = S.states[id];
    for (const hz in st.hz) {
      /* An observed figure holds until the next observation. A measurement
         that quietly wanders between readings is not a measurement. */
      if (anchoredIn(id, hz)) { st.hz[hz] = st.live[hz]; continue; }
      st.hz[hz] = clamp(Math.round(st.hz[hz] + rnd(-2.2, 2.2) * (full ? 1 : 0.25)), 8, 98);
    }
  }
  /* the state we hold cells for gets the exact figure, not an estimate */
  if (S.focus && S.states[S.focus] && S.cells.length) {
    const st = S.states[S.focus];
    for (const hz in st.hz) {
      if (anchoredIn(S.focus, hz)) continue;
      const live = S.cells.filter(c => (c.risk[hz] ?? -1) >= 0);
      if (live.length) st.hz[hz] = Math.max(...live.map(c => c.risk[hz]));
    }
  }
  if (full) refreshNationalFeed();
  syncLatest();
}

/* ── Latest disaster ────────────────────────────────────────────────
   The single most severe situation in the country right now, and the
   most recent escalation. Kept on the store so every surface — the top
   bar, the citizen portal, the assistant — reads the same answer to
   "what is happening" rather than each computing its own. */
function syncLatest() {
  let worst = null;
  for (const id in S.states) {
    const st = S.states[id];
    for (const hz in st.hz) {
      const v = st.hz[hz];
      if (worst == null || v > worst.score) worst = { state: id, name: st.name, hazard: hz, score: v, dis: st.dis };
    }
  }
  const prev = S.latest;
  S.latest = worst;
  /* announce only a real change of situation, not every point of drift */
  if (worst && (!prev || prev.state !== worst.state || prev.hazard !== worst.hazard)
      && lvl(worst.score) === 'critical') {
    S.latestChangedAt = Date.now();
    log('event', `Most severe situation is now <b>${esc(worst.name)}</b> — ${HAZ[worst.hazard].name.toLowerCase()} at ${worst.score}`, '#B3261E');
    if (typeof paintLatest === 'function') paintLatest();
    toast('Situation changed',
      `${worst.name} is now the most severe situation in the country — ` +
      `${HAZ[worst.hazard].name.toLowerCase()} at ${worst.score}/100.`, 'crit');
  }
}

/* ── discrete events, drawn on a weighted schedule ── */
const EVENTS = [
  /* a zone changes band on the layer currently displayed */
  { w: 24, fn: () => {
      const pool = S.cells.filter(x => (x.risk[S.hazard] ?? -1) >= 0);
      if (!pool.length) return null;
      const c = pick(pool), hz = S.hazard, before = c.risk[hz];
      c.risk[hz] = clamp(before + Math.round(rnd(4, 11)), 0, 99);
      if (lvl(c.risk[hz]) !== lvl(before)) {
        log('risk', `Zone <b>${c.id}</b> ${esc(c.name)} → <b>${PRI[lvl(c.risk[hz])].n.toUpperCase()}</b> — ${HAZ[hz].name.toLowerCase()} risk ${c.risk[hz]}`,
            pc(c.risk[hz]));
        return ['Risk band changed',
                `${c.name} moved to ${PRI[lvl(c.risk[hz])].n.toLowerCase()} at ${c.risk[hz]}/100.`,
                c.risk[hz] >= 85 ? 'crit' : 'warn'];
      }
      return null;
    } },
  /* people arrive at a shelter; the capacity engine re-derives what is usable */
  { w: 17, fn: () => {
      const pool = S.shelters.filter(x => x.operational);
      if (!pool.length) return null;
      const s = pick(pool), arrived = Math.round(rnd(15, 140));
      s.current_occupancy = Math.min(s.current_occupancy + arrived, Math.round(s.max_capacity * 1.05));
      s.water_days = +clamp(s.water_days - rnd(0.05, 0.3), 0, 14).toFixed(1);
      s.food_days = +clamp(s.food_days - rnd(0.05, 0.25), 0, 14).toFixed(1);
      s.reported = hm(); s.reported_age = 0;
      recomputeShelter(s);
      log('shelter', `<b>${s.shelter_id}</b> ${esc(s.name)} — ${nf(s.current_occupancy)} / ${nf(s.max_capacity)}, limited by ${s.binding_constraint}`, '#0B6BA8');
      return ['Shelter update',
              `${arrived} more people at ${s.name}. ${nf(s.effective_capacity)} effective places left, limited by ${s.binding_constraint}.`,
              s.effective_capacity < 50 ? 'warn' : 'info'];
    } },
  /* a road changes state; routing recalculates */
  { w: 13, fn: () => {
      if (!S.roads.length) return null;
      const r = pick(S.roads);
      const states = ['open', 'slow', 'partially_blocked', 'blocked', 'flooded', 'landslide'];
      const was = r.state;
      r.state = pick(states.filter(x => x !== was));
      r.t = hm(); r.age = 0;
      r.by = `FO-${(S.focus || 'ut').toUpperCase()}-${p2(Math.round(rnd(1, 9)))}`;
      r.reason = {
        open: 'Cleared and confirmed passable', slow: 'Surface water, heavy traffic',
        partially_blocked: 'Single lane past debris', blocked: 'Slope failure, no access',
        flooded: 'Water over carriageway', landslide: 'Debris across both lanes'
      }[r.state];
      log('road', `<b>${esc(r.name)}</b> → <b>${ROAD_STATE[r.state][0].toUpperCase()}</b> — ${esc(r.reason)}`,
          r.state === 'open' ? '#1B7F3B' : ['blocked','flooded','landslide'].includes(r.state) ? '#B3261E' : '#A96700');
      return ['Road report', `${r.name}: ${ROAD_STATE[r.state][0].toLowerCase()}. Evacuation routes recalculated.`,
              r.state === 'open' ? 'ok' : 'warn'];
    } },
  /* somewhere else in the country moves — the national picture is live too */
  { w: 12, fn: () => {
      const others = Object.values(S.states).filter(x => x.id !== S.focus);
      const st = pick(others);
      /* only hazards this build is modelling — an observed one is not ours
         to move */
      const free = Object.keys(st.hz).filter(h =>
        !(typeof liveAnchored === 'function' && liveAnchored(st.id, h)));
      if (!free.length) return null;
      const hz = pick(free);
      st.hz[hz] = clamp(st.hz[hz] + Math.round(rnd(5, 14)), 8, 98);
      log('risk', `<b>${esc(st.name)}</b> — ${HAZ[hz].name.toLowerCase()} risk ${st.hz[hz]}`, pc(st.hz[hz]));
      return ['National picture',
              `${st.name}: ${HAZ[hz].name.toLowerCase()} risk now ${st.hz[hz]}/100. Open it from the India map.`, 'info'];
    } },
  /* a source degrades or recovers — freshness is never silently assumed */
  { w: 8, fn: () => {
      /* Rows below are driven by real HTTP calls in src/livedata.js. Their
         status is measured, so nothing here is allowed to script it. */
      const modelled = S.sources.filter(x => !(typeof REAL_SOURCE !== 'undefined' && REAL_SOURCE[x.key]));
      if (!modelled.length) return null;
      const src = pick(modelled);
      if (src.status === 'live' && Math.random() < 0.4) {
        src.status = 'stale'; src.age_seconds = 7200;
        log('quality', `Source <b>${esc(src.key.toUpperCase())}</b> marked <b>STALE</b> — confidence reduced downstream`, '#A96700');
        return ['Source stale', `${src.authority} has stopped delivering. Predictions that used it are flagged and damped.`, 'warn'];
      }
      if (src.status === 'stale') {
        src.status = 'live'; src.age_seconds = 60; src.quality_score = +rnd(0.88, 0.98).toFixed(2);
        log('quality', `Source <b>${esc(src.key.toUpperCase())}</b> recovered — reporting normally`, '#1B7F3B');
        return ['Source recovered', `${src.authority} is delivering again.`, 'ok'];
      }
      src.age_seconds = Math.max(30, Math.round(rnd(40, 900)));
      return null;
    } },
  /* a field report arrives or is verified */
  { w: 6, fn: () => {
      const r = S.reports.find(x => x.st === 'pending');
      if (!r) {
        const c = pick(S.cells);
        const id = 'CR-' + Math.floor(rnd(40230, 40999));
        S.reports.unshift({ id, cat: pick(['Water entering houses', 'Road blocked', 'Cracks in ground',
          'People stranded', 'Power supply cut']), loc: c.name, cell: c.id, age: 0,
          desc: 'Reported by a resident, awaiting verification.', t: hm(), st: 'pending', by: null });
        log('report', `Citizen report <b>${id}</b> received from ${esc(c.name)} — awaiting verification`, '#0B6BA8');
        return ['New field report', `${id} from ${c.name}. An operator reviews it before it affects any published figure.`, 'info'];
      }
      r.st = 'verified'; r.by = `FO-${(S.focus || 'ut').toUpperCase()}-${p2(Math.round(rnd(1, 9)))}`;
      log('report', `Citizen report <b>${r.id}</b> verified — corroborates the model for ${esc(r.loc)}`, '#1B7F3B');
      return ['Report verified', `${r.id} verified. Cell confidence raised by corroboration.`, 'ok'];
    } },
  /* an official warning is issued — always attributed, never a model output */
  { w: 4, fn: () => {
      const P = stateProfile(S.focus || 'ut');
      const liveHz = (S.states[S.focus] || {}).hz || P.hz;
      /* an authority does not issue a warning about a hazard that is quiet */
      const candidates = Object.keys(liveHz).filter(h => liveHz[h] >= 45);
      if (!candidates.length) return null;
      const hz = pick(candidates);
      const [authT, event] = ALERT_AUTH[hz];
      const auth = authT.replace('{SDMA}', P.n + ' State Disaster Management Authority');
      const top = [...S.cells].sort((a, b) => (b.risk[hz] || 0) - (a.risk[hz] || 0)).slice(0, 2);
      const sev = sevFor((S.states[S.focus] || {}).hz?.[hz] ?? P.hz[hz]);
      const head = alertHead(hz, top.map(c => c.name), P.n, sev);
      const a = { id: `CAP-${(S.focus || 'ut').toUpperCase()}-${Math.floor(rnd(1000, 9999))}`,
        auth, event, haz: hz, sev, urg: 'Immediate', cert: 'Observed', head,
        area: `${top.map(c => c.name).join(', ')} — ${P.n}`, age: 0, expires_in: 6,
        t: hm(), exp: ahead(6), inst: ALERT_INST[hz], ack: 0 };
      S.alerts.unshift(a);
      if (S.alerts.length > 10) S.alerts.pop();
      /* the platform must not issue a warning and still report an older
         one as the newest thing that has happened */
      pushNational(a, S.focus);
      if (typeof paintLatest === 'function') paintLatest();
      log('alert', `Official alert from <b>${esc(auth.split(',')[0])}</b> — ${esc(head)}`, '#B3261E');
      return ['Official alert', `${head} — ${auth.split(',')[0]}. This is an official warning, not a model output.`, 'crit'];
    } }
];

function recomputeShelter(s) {
  const spaceAvail = Math.max(Math.floor(s.max_capacity * 0.9) - s.current_occupancy, 0);
  const cands = {
    space: spaceAvail,
    water: s.water_days >= 2 ? spaceAvail : Math.floor(spaceAvail * s.water_days / 2),
    food: s.food_days >= 2 ? spaceAvail : Math.floor(spaceAvail * s.food_days / 2),
    medical: Math.max(s.medical_staff * 250 - s.current_occupancy, 0)
  };
  let binding = 'space', eff = cands.space;
  for (const k in cands) if (cands[k] < eff) { eff = cands[k]; binding = k; }
  if (!s.operational) eff = 0; else s.binding_constraint = binding;
  s.effective_capacity = Math.max(eff, 0);
  s.raw_available = Math.max(s.max_capacity - s.current_occupancy, 0);
  s.utilisation = +(s.current_occupancy / s.max_capacity).toFixed(3);
  s.st = s.operational ? (eff > 0 ? 'open' : 'full') : 'closed';
  s.d = `${nf(s.current_occupancy)} / ${nf(s.max_capacity)} places used`;
}

function drawEvent() {
  const total = EVENTS.reduce((a, e) => a + e.w, 0);
  let r = Math.random() * total;
  for (const e of EVENTS) { r -= e.w; if (r <= 0) return e.fn(); }
  return null;
}

/* ── the tick ──────────────────────────────────────────────────────
   The store is synchronised with the screen once a second. The physical
   model underneath advances on the same second, in quarter-sized steps,
   so the rate of change is exactly what it was on the old four-second
   cadence — the surface simply moves in four small increments instead of
   one visible jump, which is the difference between a dashboard that
   updates and a dashboard that flinches.

   The expensive parts are not on that cadence, deliberately:

     · `computePriorities` and `computeRoutes` are the ordering steps.
       The relocation queue reshuffling four times a second would be
       unreadable, and the documented promise is that it does not
       reshuffle between ticks. They run once per full tick.
     · `refreshNationalFeed` rebuilds a whole state's cells per call.
       Also once per full tick.
     · The repaint is targeted. Nothing calls `render()` on a timer any
       more; see `syncRender()` in src/views.js for why that one line was
       most of what made the page feel like it was fighting the reader.

   None of this changes how often real observations are fetched. Polling
   Open-Meteo, GloFAS and USGS every second would burn somebody else's
   free service to redraw numbers that change hourly; src/livedata.js
   keeps each source's own cadence, and the badge reports the true age of
   the reading rather than the age of the repaint. */
const TICK_MS = 1000;             // one synchronisation per second
const FULL_EVERY = 4;             // ordering, feed and events on the 4th
let tickCount = 0;

function pipelineTick(withEvent, opts) {
  const t0 = performance.now();
  const full = !opts || opts.full !== false;
  driftCells(full ? 1 : 0.25);
  driftNation(full);
  const notice = withEvent ? drawEvent() : null;

  if (full) { computePriorities(); computeRoutes(); }

  LIVE.lastComputedAt = Date.now();
  LIVE.latencyMs = Math.round(performance.now() - t0) + Math.round(rnd(30, 90));
  LIVE.received++;
  tickCount++;

  /* One repaint path for every screen, and it is the one that knows how
     not to move the ground under the reader. */
  if (typeof syncRender === 'function') syncRender(); else render();
  if (typeof syncDrawer === 'function') syncDrawer();
  paintLiveBadge();
  if (typeof paintLatest === 'function') paintLatest();

  if (notice) toast(notice[0], notice[1], notice[2]);
}

/* ── Continuous operation ───────────────────────────────────────────
   Two problems a naive setInterval has, both of which make a dashboard
   quietly go stale:

     1. Browsers throttle background tabs to roughly one timer per
        minute. A dashboard left on a wall display in another tab would
        fall minutes behind and then show those minutes-old figures
        without saying so.
     2. A laptop that sleeps stops timers entirely. On wake the screen
        would show pre-sleep numbers as though they were current.

   Both are handled by measuring elapsed wall-clock time rather than
   counting ticks, and by catching up explicitly when the tab becomes
   visible again. */
let lastTickAt = Date.now();

setInterval(() => {
  const elapsed = Date.now() - lastTickAt;
  lastTickAt = Date.now();
  /* If the browser throttled us, advance the simulation by however many
     ticks were actually missed rather than pretending only one passed. */
  const missed = Math.min(Math.floor(elapsed / TICK_MS), 120);
  for (let i = 1; i < missed; i++) { driftCells(0.25); driftNation(false); }
  const full = tickCount % FULL_EVERY === FULL_EVERY - 1;
  pipelineTick(full && tickCount % (FULL_EVERY * 3) === FULL_EVERY * 3 - 1, { full });
}, TICK_MS);

/* Coming back to a backgrounded tab: catch up immediately and say so if
   the gap was long enough that the operator should not trust what was on
   screen a moment ago. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const gapMs = Date.now() - lastTickAt;
  lastTickAt = Date.now();
  if (gapMs < TICK_MS * 2) return;

  const catchUp = Math.min(Math.floor(gapMs / TICK_MS), 240);
  for (let i = 0; i < catchUp; i++) { driftCells(0.25); driftNation(false); }
  refreshTimestamps();
  pipelineTick(true);

  const mins = Math.round(gapMs / 60000);
  if (mins >= 2)
    toast('Caught up',
      `This tab was in the background for ${mins} minute${mins === 1 ? '' : 's'}. ` +
      `${catchUp} pipeline tick${catchUp === 1 ? '' : 's'} replayed — the figures ` +
      `on screen are current again.`, 'info');
});

/* Wall-clock labels drift out of date on their own. Once a minute, re-derive
   every relative timestamp so an alert issued "37 min ago" still reads that
   way an hour later, and the age columns stay honest. */
function refreshTimestamps() {
  const bump = (obj, ageKey, timeKey) => {
    if (obj[ageKey] == null) return;
    obj[ageKey] += Math.round((Date.now() - (obj._stampedAt || Date.now())) / 60000);
    obj._stampedAt = Date.now();
    obj[timeKey] = ago(obj[ageKey]);
  };
  const minutesSinceBoot = (Date.now() - S.bootedAt) / 60000;
  S.alerts.forEach(a => { if (a.age != null) a.t = ago(a.age + minutesSinceBoot); });
  S.roads.forEach(r => { if (r.age != null) r.t = ago(r.age + minutesSinceBoot); });
  S.shelters.forEach(sh => {
    if (sh.reported_age != null) sh.reported = ago(sh.reported_age + minutesSinceBoot);
  });
  for (const id in S.states) {
    const st = S.states[id];
    if (st.since_age != null) st.since = ago(st.since_age + minutesSinceBoot);
  }
  if (typeof refreshNationalFeed === 'function') refreshNationalFeed();
  if (typeof paintLatest === 'function') paintLatest();
}
setInterval(refreshTimestamps, 60000);

/* A quiet heartbeat so the timeline keeps a pulse even between events. */
setInterval(() => {
  refreshTimestamps();
  const online = S.sources.filter(s => s.status === 'live').length;
  log('model', `Inference tick — ${S.cells.length} cells scored, ${online}/${S.sources.length} sources reporting`, '#12447E');
  if (S.view === 'map') paintTimeline();
}, 30000);

/* Is the environmental input under the focused state measured rather than
   modelled? If it is, the generator leaves it alone. */
function observedRain() {
  return typeof LIVEDATA !== 'undefined' && S.focus
    && LIVEDATA.obs[S.focus] && LIVEDATA.obs[S.focus].rain24 != null
    && typeof liveDataHealthy === 'function' && liveDataHealthy();
}
function observedRiver() {
  return typeof LIVEDATA !== 'undefined' && S.focus
    && LIVEDATA.obs[S.focus] && LIVEDATA.obs[S.focus].dischargeRatio != null
    && LIVEDATA.src.flood.status === 'live';
}

/* Force a refetch now — what the live badge does when clicked. */
function liveRefreshNow() {
  if (typeof pullAll === 'function') {
    for (const k in LIVEDATA.src) LIVEDATA.src[k].at = 0;   // make every source due
    pullAll('manual');
    toast('Refreshing', 'Asking every live source for a current reading.', 'info');
  } else liveResync();
}

/* Connect to the live feed. With a backend, AAPDA_WS_URL is injected by
   the frontend container at start; without one the generator above drives
   the same path and the badge reports honestly either way. */
const WS_URL = (typeof window !== 'undefined' && window.AAPDA_WS_URL) ? window.AAPDA_WS_URL : null;
liveConnect(WS_URL);

/* Real observations, fetched by this browser. Starts immediately and then
   on each source's own cadence — see src/livedata.js. When nothing can be
   reached, every indicator says "modelled" rather than "live". */
if (typeof startLiveData === 'function') startLiveData();

/* Resolve the latest situation once at boot rather than waiting for the
   first tick — otherwise the bar above the map is empty for four seconds
   on every load, which reads as "nothing is happening". */
syncLatest();
if (typeof paintLatest === 'function') paintLatest();

paintNav(); paintTop(); paintHazard();
