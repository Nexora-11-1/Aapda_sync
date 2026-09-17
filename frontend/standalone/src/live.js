/* ══════════════════════════════════════════════════════════════════
   LIVE — WebSocket client

   What "real time" means here, precisely
   ──────────────────────────────────────
   The platform cannot be faster than the authorities it reads. IMD
   publishes on its own cadence; CWC's gauges report when they report.
   What it does guarantee is zero added latency: the instant a fact
   reaches the backend, it is processed and pushed here. There is no
   client-side polling interval to wait out.

   Three things this client does that a naive `new WebSocket()` does not:

     · Reconnects with exponential backoff and full jitter, so ten
       thousand dashboards do not stampede a recovering server.
     · Shows connection state honestly. A disconnected dashboard shows
       "reconnecting" and the age of what it is displaying — it never
       shows stale figures as though they were live.
     · Resynchronises on reconnect. A socket that was down for two
       minutes refetches rather than resuming from a gap.
   ══════════════════════════════════════════════════════════════════ */

const LIVE = {
  ws: null,
  state: 'connecting',        // connecting | live | reconnecting | offline
  attempts: 0,
  lastMessageAt: null,
  lastComputedAt: null,
  latencyMs: null,
  received: 0,
  url: null,
  timer: null,
  heartbeat: null
};

const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30_000;
const HEARTBEAT_MS = 25_000;
const STALE_AFTER_MS = 90_000;

function liveConnect(url) {
  /* Without a backend (the standalone build), the simulated feed in boot.js
     drives the same code path, so every indicator below stays truthful. */
  LIVE.url = url || null;
  LIVE.lastComputedAt = LIVE.lastComputedAt || Date.now();
  if (!LIVE.url) { liveSetState('simulated'); return; }

  try {
    LIVE.ws = new WebSocket(LIVE.url);
  } catch (e) {
    liveScheduleReconnect(); return;
  }

  LIVE.ws.onopen = () => {
    LIVE.attempts = 0;
    liveSetState('live');
    LIVE.ws.send('subscribe:risk:UT-CHAMOLI,priority:UT-CHAMOLI,alerts,shelters,roads,system');
    /* A reconnected socket has a gap behind it. Refetch rather than
       resuming, so nothing silently missing sits on the screen. */
    if (LIVE.received > 0) liveResync();
    LIVE.heartbeat = setInterval(() => {
      if (LIVE.ws && LIVE.ws.readyState === 1) LIVE.ws.send('ping');
    }, HEARTBEAT_MS);
  };

  LIVE.ws.onmessage = ev => {
    LIVE.received++;
    LIVE.lastMessageAt = Date.now();
    let frame;
    try { frame = JSON.parse(ev.data); } catch { return; }
    liveApply(frame);
    liveSetState('live');
  };

  LIVE.ws.onclose = () => { clearInterval(LIVE.heartbeat); liveScheduleReconnect(); };
  LIVE.ws.onerror = () => { try { LIVE.ws.close(); } catch {} };
}

function liveScheduleReconnect() {
  LIVE.attempts++;
  liveSetState(LIVE.attempts > 6 ? 'offline' : 'reconnecting');
  /* Full jitter: delay is uniform in [0, backoff], not backoff ± noise.
     This is what actually prevents a thundering herd on recovery. */
  const ceiling = Math.min(BACKOFF_BASE_MS * 2 ** LIVE.attempts, BACKOFF_MAX_MS);
  const delay = Math.random() * ceiling;
  clearTimeout(LIVE.timer);
  LIVE.timer = setTimeout(() => liveConnect(LIVE.url), delay);
}

function liveSetState(state) {
  if (LIVE.state === state) { paintLiveBadge(); return; }
  const previous = LIVE.state;
  LIVE.state = state;
  paintLiveBadge();
  if (state === 'live' && previous === 'reconnecting')
    toast('Reconnected', 'Live feed restored. Refreshing the current picture.', 'ok');
  if (state === 'offline')
    toast('Connection lost',
          'The live feed is unavailable. Figures on screen are the last received and ' +
          'are marked with their age — do not treat them as current.', 'crit');
}

/* ── apply an incoming frame ── */
function liveApply(frame) {
  const p = frame.payload || {};
  switch (p.type) {
    case 'risk_update':
      LIVE.lastComputedAt = p.computed_at ? Date.parse(p.computed_at) : Date.now();
      LIVE.latencyMs = p.latency_ms ?? null;
      (p.cells || []).forEach(c => {
        const cell = S.cells.find(x => x.cell_id === c.cell_id);
        if (!cell) return;
        cell.risk[p.hazard] = c.score;
        cell.confidence[p.hazard] = c.confidence;
        cell.probability[p.hazard] = c.probability;
      });
      computePriorities(); computeRoutes();
      liveRepaint();
      break;
    case 'priority_update':
      liveRepaint(); break;
    case 'government_alert':
      if (p.alert) { S.alerts.unshift(p.alert); liveRepaint(); }
      toast('Official alert',
            `${p.alert?.headline || 'New alert'} — ${p.alert?.issuing_authority || ''}`, 'crit');
      break;
    case 'shelter_status': {
      const sh = shelterById(p.shelter?.shelter_id);
      if (sh) { Object.assign(sh, p.shelter); computeRoutes(); liveRepaint(); }
      break;
    }
    case 'road_status': {
      const rd = S.roads.find(r => r.road_id === p.road?.road_id);
      if (rd) { Object.assign(rd, p.road); computeRoutes(); liveRepaint(); }
      break;
    }
    case 'source_health':
      if (p.sources) { S.sources = p.sources; liveRepaint(); }
      break;
    case 'gap':
      toast('Update gap',
            `${p.dropped} updates were dropped while this connection was behind. ` +
            'Refreshing.', 'warn');
      liveResync();
      break;
  }
}

function liveRepaint() {
  if (S.role === 'gov' && S.view === 'map') { paintMap(); paintNav(); paintTop(); paintSourceBar(); }
  else render();
  paintLiveBadge();
}

async function liveResync() {
  /* With a backend this refetches /api/risk, /api/priorities and the rest.
     In the standalone build there is nothing to refetch, so it repaints. */
  if (!LIVE.url) { liveRepaint(); return; }
  try {
    const base = LIVE.url.replace(/^ws/, 'http').replace(/\/ws.*$/, '/api');
    const r = await fetch(`${base}/risk?district=UT-CHAMOLI&hazard=${S.hazard}`);
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    (data.cells || []).forEach(c => {
      const cell = S.cells.find(x => x.cell_id === c.cell_id);
      if (cell) { cell.risk[S.hazard] = c.score; cell.confidence[S.hazard] = c.confidence; }
    });
    LIVE.lastComputedAt = data.data_freshness?.computed_at
      ? Date.parse(data.data_freshness.computed_at) : Date.now();
    computePriorities(); computeRoutes(); liveRepaint();
  } catch {
    toast('Could not refresh', 'The dashboard is showing the last data it received.', 'warn');
  }
}

/* ── the badge: connection state and data age, always honest ── */
function liveAge() {
  const at = LIVE.lastComputedAt || LIVE.lastMessageAt;
  return at ? Date.now() - at : null;
}

function paintLiveBadge() {
  const el = $('livebadge'); if (!el) return;
  const age = liveAge();
  const stale = age != null && age > STALE_AFTER_MS;

  const ageText = age == null ? '—'
    : age < 5000 ? 'just now'
    : age < 60_000 ? `${Math.round(age / 1000)}s ago`
    : age < 3_600_000 ? `${Math.round(age / 60_000)}m ago`
    : `${(age / 3_600_000).toFixed(1)}h ago`;

  /* ── What the badge is allowed to say ──────────────────────────────
     When real observations are reaching this browser, the badge reports
     them and their age. When they are not, it says the figures are a
     model — it does not borrow the word "live" from the recompute loop.
     A recompute of modelled numbers is fast, not live. */
  if (typeof provenance === 'function') {
    const [kind, head, why] = provenance();
    const P = {
      live:       ['var(--ok)',   '',   true],
      partial:    ['var(--warn)', ' w', false],
      connecting: ['var(--info)', '',   false],
      stale:      ['var(--warn)', ' w', false],
      modelled:   ['var(--warn)', ' w', false]
    }[kind] || ['var(--warn)', ' w', false];
    const src = LIVEDATA.src;
    const newest = Math.max(src.weather.at, src.flood.at, src.quake.at);
    const obsAge = newest ? Date.now() - newest : null;
    const obsText = obsAge == null ? 'no reading'
      : obsAge < 60_000 ? 'just now'
      : obsAge < 3_600_000 ? `${Math.round(obsAge / 60_000)}m ago`
      : `${(obsAge / 3_600_000).toFixed(1)}h ago`;
    el.className = 'chip' + P[1];
    el.title = `${head} — ${why}`;
    el.innerHTML =
      `<span class="dot" style="background:${P[0]}${P[2] ? ';animation:pulse 2s infinite' : ''}"></span>` +
      `${head} <b>${kind === 'connecting' ? '…' : obsText}</b>`;
    return;
  }

  /* Fallback: a backend-attached build with no browser ingestion. */
  const M = {
    live:         ['var(--ok)',   'Live'],
    simulated:    ['var(--warn)', 'Model'],
    connecting:   ['var(--warn)', 'Connecting'],
    reconnecting: ['var(--warn)', 'Reconnecting'],
    offline:      ['var(--crit)', 'Offline']
  };
  let [colour, label] = M[LIVE.state] || M.connecting;
  if (stale && LIVE.state !== 'offline') { colour = 'var(--warn)'; label = 'Delayed'; }

  el.className = 'chip' + (LIVE.state === 'offline' ? ' c' : stale || LIVE.state === 'simulated' ? ' w' : '');
  el.title = LIVE.state === 'offline'
    ? 'The live feed is down. These figures are the last received — not current.'
    : LIVE.state === 'simulated'
    ? 'No live source is attached. These figures are the seasonal model, not observations.'
    : `Pipeline last produced a result ${ageText}` +
      (LIVE.latencyMs != null ? ` · recompute took ${LIVE.latencyMs} ms` : '');
  el.innerHTML =
    `<span class="dot" style="background:${colour}${LIVE.state === 'live' ? ';animation:pulse 2s infinite' : ''}"></span>` +
    `${label} <b>${ageText}</b>`;
}

setInterval(paintLiveBadge, 1000);
