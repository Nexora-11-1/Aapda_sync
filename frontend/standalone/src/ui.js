/* ══════════════════════════════════════════════════════════════════
   UI — accessibility, guided mode, map navigation, the latest situation

   Everything in this file exists because a control-room screen is read
   by people under pressure, on whatever hardware the district has, and
   sometimes by people who have never seen it before.
   ══════════════════════════════════════════════════════════════════ */

/* ── Text size ──────────────────────────────────────────────────────
   Government portals in India carry A− / A / A+ as a standard
   accessibility control. Ours scales the root font size, which every
   dimension in the stylesheet is expressed against, so the whole
   interface grows rather than only the body copy. The choice persists,
   because someone who needs larger text needs it every time. */
const FONT_STEPS = [0.88, 0.94, 1, 1.09, 1.2];
let fontIdx = 2;

function applyFont() {
  document.documentElement.style.fontSize = (FONT_STEPS[fontIdx] * 16).toFixed(2) + 'px';
  document.querySelectorAll('.fsz').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.step === String(fontIdx)));
  });
  try { localStorage.setItem('aapda.font', String(fontIdx)); } catch (e) { /* private mode */ }
}

function fontStep(dir) {
  const was = fontIdx;
  fontIdx = dir === 0 ? 2 : Math.max(0, Math.min(FONT_STEPS.length - 1, fontIdx + dir));
  applyFont();
  const pct = Math.round(FONT_STEPS[fontIdx] * 100);
  say(`Text size ${pct} percent`);
  if (fontIdx === was && dir !== 0)
    toast('Text size', dir > 0 ? 'Already at the largest size.' : 'Already at the smallest size.', 'info');
  else if (typeof paintMap === 'function' && S.view === 'map') setTimeout(paintMap, 30);
}

(function restoreFont() {
  try {
    const v = localStorage.getItem('aapda.font');
    if (v != null && FONT_STEPS[+v] != null) fontIdx = +v;
  } catch (e) { /* storage unavailable — the default is fine */ }
  applyFont();
})();

/* ── Skip to content ────────────────────────────────────────────────
   A skip link that does not move focus is decoration. This one moves
   focus to the main region and scrolls it into view, which is what a
   keyboard or screen-reader user is asking for. */
function skipToContent() {
  const m = $('main');
  if (!m) return;
  m.setAttribute('tabindex', '-1');
  m.focus({ preventScroll: false });
  m.scrollIntoView({ block: 'start' });
  say('Main content');
  return false;
}

/* Screen-reader announcements go to the live region. */
function say(msg) { const l = $('live'); if (l) l.textContent = msg; }

function toggleSR() {
  document.body.classList.toggle('sr-mode');
  const on = document.body.classList.contains('sr-mode');
  say(on ? 'Screen reader mode on' : 'Screen reader mode off');
  toast('Screen reader mode', on
    ? 'Focus outlines are always visible, decorative animation is stopped, and every map cell is reachable by keyboard.'
    : 'Returned to the standard presentation.', 'info');
}

/* ══════════════════════════════════════════════════════════════════
   GUIDED MODE

   A toggle that explains what each part of the screen is for and what
   to do with it. Two audiences with genuinely different needs: an
   operator wants to know what a number licenses them to decide, and a
   member of the public wants to know what to do.
   ══════════════════════════════════════════════════════════════════ */
let guideOn = false;

const GUIDE = {
  gov: {
    map: ['The India risk map',
      'Colour is the risk of the hazard selected above, for the whole country. Click any state to open its 5×5 operational grid; click a zone to see why it scored what it scored. The number in each zone is the risk score — a hatched zone means no model output, which is not the same as safe.'],
    cells: ['Hazard cells',
      'Every zone in the state you have open, with its score, confidence and the physical ground behind it. Sort by confidence to find where the model is guessing. A low-confidence high score is a reason to send someone to look, not a reason to act blind.'],
    predictions: ['Predictions',
      'Forecast risk over the next hours, with the model that produced it named. These are AI estimates for planning. They are never warnings — warnings appear under Official Alerts with the authority that issued them.'],
    alerts: ['Official alerts',
      'Warnings issued by IMD, CWC, INCOIS, NCS and the State Authorities, carried verbatim with the issuing authority attached. These take precedence over anything the model says. Acknowledging one records that your control room has seen it.'],
    exposure: ['Population exposure',
      'How many people are inside the hazard footprint, computed as a spatial overlay against height-above-drainage and slope. It is deliberately not probability × total population — that number is always wrong and always too large.'],
    priority: ['Relocation priority',
      'The order to move people in, with every factor that produced the rank shown and summing exactly to the score. If you disagree with a rank, the contributions tell you which factor to argue with.'],
    shelters: ['Shelters and capacity',
      'Usable places, not rated capacity. A hall rated 5 000 with no water has no usable places, and the screen names which constraint binds — so you know whether to send a tanker or open another building.'],
    evacuation: ['Evacuation routes',
      'Shortest safe path from each zone to an assigned shelter, over the road network as it is right now. A road reported blocked drops out of the graph immediately and the routes recompute.'],
    roads: ['Road status',
      'What field officers and SDRF have reported. Marking a road blocked changes the evacuation plan within a tick, so report as soon as you know.'],
    reports: ['Field reports',
      'What people on the ground are sending in. Nothing here affects a published figure until an operator verifies it — an unverified report raises no scores and moves no rankings.'],
    hazards: ['Hazards and data sources',
      'All nine disasters, the source feeding each one, and what that source can and cannot see. Read the fidelity line: a live source is not automatically a precise one.'],
    sources: ['Data sources',
      'Every feed, when it last delivered, and what stops working if it goes quiet. A stale source reduces the confidence of predictions that used it rather than being silently dropped.'],
    model: ['Model monitoring',
      'Calibration and discrimination for each active model, and the gate a new version must pass before it can replace the running one. Confidence figures are only meaningful while calibration holds.'],
    security: ['Security and access',
      'Who is signed in, what they may do, and every authentication event. An audit log that nobody can read is a log that nobody checks.'],
    assistant: ['The assistant',
      'It answers from the platform\'s own records and cites which record each sentence came from. When nothing on the platform answers your question it says so rather than inventing one.']
  },
  citizen: {
    home: ['This page',
      'The warnings in force where you are, the risk on the map, and the shelters that have space right now. Warnings from the authorities are marked as such; the coloured map is a computer estimate that helps you plan.'],
    alerts: ['Warnings',
      'Every official warning in force, with the department that issued it and what it tells you to do. If a warning and this website ever disagree, follow the warning.'],
    shelters: ['Shelters',
      'Places that are open and how much room they actually have — counting water, food and medical staff, not only floor space. Take your identity papers, medicines and a phone charger.'],
    prepare: ['What to do',
      'What to do before, during and after each kind of disaster, in the order it matters. Read the section for the hazard that is active where you are.'],
    memorial: ['What we learned',
      'Disasters India has lived through, what happened, and the change each one forced. Preparedness is easier to take seriously when it has a face.'],
    relief: ['Help the affected',
      'How to give money, goods or time so it reaches people who are cut off — and how to check that what you are giving to is real before you give.'],
    assistant: ['Ask a question',
      'Ask in your own words. The answer comes from this platform\'s records and shows you where it came from, and it will tell you when it does not know.']
  }
};

function toggleGuide() {
  guideOn = !guideOn;
  document.body.classList.toggle('guide-on', guideOn);
  try { localStorage.setItem('aapda.guide', guideOn ? '1' : '0'); } catch (e) { /* ignore */ }
  render();
  say(guideOn ? 'Guided mode on' : 'Guided mode off');
  if (guideOn) toast('Guided mode on',
    'Each screen now explains what it is for and what to do with it. Hover anything with a dotted underline for the term behind it.', 'info');
}

(function restoreGuide() {
  try { guideOn = localStorage.getItem('aapda.guide') === '1'; } catch (e) { /* ignore */ }
  if (guideOn) document.body.classList.add('guide-on');
})();

/** The explainer strip a screen renders when guided mode is on. */
function guideStrip(view) {
  if (!guideOn) return '';
  const g = (GUIDE[S.role === 'gov' ? 'gov' : 'citizen'] || {})[view];
  if (!g) return '';
  return `<div class="guide" role="note">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>
    <div><b>${esc(g[0])}</b><span>${esc(g[1])}</span></div>
    <button class="gx" onclick="toggleGuide()" title="Turn guided mode off" aria-label="Turn guided mode off">✕</button>
  </div>`;
}

/* Terms an operator or a resident may not know, explained on hover and
   on focus. Used through `term()` in the views. */
const TERMS = {
  'H3': 'A hexagonal grid that covers the earth at fixed sizes. Resolution 7 is about 5 km² per cell — small enough to act on, large enough to have data for.',
  'HAND': 'Height Above Nearest Drainage — how far above the nearest stream or river a place sits. It is what separates a house that floods from one 12 m up the slope.',
  'effective capacity': 'How many more people a shelter can actually take, counting water, food, sanitation and medical staff — not just floor area.',
  'binding constraint': 'The single resource that runs out first. It tells you what to send.',
  'confidence': 'How much the model trusts its own number, computed separately from the risk itself. A high risk at low confidence means go and look.',
  'calibration': 'Whether a stated 70% actually happens about 70% of the time. Without it a confidence figure is decoration.',
  'CAP': 'Common Alerting Protocol — the international format Indian authorities publish warnings in, carrying severity, urgency, certainty and area.',
  'degraded input': 'A source this figure depended on is unavailable, so the figure was produced with less than it should have had, and its confidence was reduced to say so.',
  'step-up': 'Re-entering your password before a change that other people will see.',
  'stale': 'The source has not delivered inside its expected window. The platform marks it rather than showing its last value as though it were current.'
};
const term = (t, label) => `<span class="gloss" tabindex="0" data-term="${esc(t)}" title="${esc(TERMS[t] || '')}">${esc(label || t)}</span>`;

/* ══════════════════════════════════════════════════════════════════
   MAP NAVIGATION — zoom, pan, reset

   The viewBox is the camera. Zooming scales it about a point; panning
   translates it; reset returns to the country. Everything is clamped so
   the map cannot be lost off-screen.

   ── The interaction contract ────────────────────────────────────────
   Four gestures, deliberately hard to confuse with one another, because
   the failure this section exists to fix is a reader trying to scroll
   past the map and being taken on a tour of the Deccan instead.

     scroll the page   wheel or trackpad over the map with no modifier.
                       The map does not move. It says how to zoom, once,
                       and gets out of the way.
     zoom the map      Ctrl or ⌘ with the wheel, the zoom buttons,
                       + / − / 0 with the map focused, a double-click,
                       or a two-finger pinch on a touch screen.
     pan the map       press and drag with a mouse past a small
                       threshold, or the arrow keys when focused.
     scroll on touch   one finger always scrolls the page. Panning the
                       map with one finger would make the dashboard
                       unreadable on a phone, so it is not offered;
                       two fingers pinch and drag together.

   Everything below is tuned around one rule: a small movement produces a
   small response. Rotation and pitch are not offered at all — this is a
   flat administrative map of India and a tilted, rotated one is a way to
   lose north in an emergency, not a feature.
   ══════════════════════════════════════════════════════════════════ */
const ZOOM_MIN = 0.25, ZOOM_MAX = 14;

/* Zoom per pixel of wheel travel, as an exponent. One notch of a mouse
   wheel is ~100 px, so a notch is e^0.085 ≈ 1.089 — about a ninth of the
   distance to the next power of two, where the old handler took a fifth
   of it per event and a trackpad fires thirty of them a second. */
const WHEEL_ZOOM_RATE = 0.00085;
/* No single wheel event may be worth more than this many pixels. A
   flicked trackpad and some mice emit one enormous delta; without a
   ceiling that one event is a jump across two zoom levels. */
const WHEEL_DELTA_CAP = 55;
/* How far a pointer must travel before a press becomes a drag. Below
   this it is a click on whatever is underneath, and a hand resting on a
   mouse does not move the country. */
const PAN_THRESHOLD_PX = 4;
/* Pinch has to change the span by more than this before it counts, so
   two fingers set down a moment apart do not register as a zoom. */
const PINCH_THRESHOLD = 0.02;

function currentZoom() { return IN_VB[2] / VBto[2]; }

/** Scale the viewBox about a point given in viewBox coordinates. */
function zoomAbout(factor, ax, ay, dur = 300) {
  const [x, y, w, h] = VBto;
  const cx = ax == null ? x + w / 2 : ax;
  const cy = ay == null ? y + h / 2 : ay;
  let nw = w / factor, nh = h / factor;
  const minW = IN_VB[2] / ZOOM_MAX, maxW = IN_VB[2] / ZOOM_MIN;
  if (nw < minW) { nh *= minW / nw; nw = minW; }
  if (nw > maxW) { nh *= maxW / nw; nw = maxW; }
  const nx = cx - (cx - x) * (nw / w);
  const ny = cy - (cy - y) * (nh / h);
  flyTo(clampVB([nx, ny, nw, nh]), dur);
  paintZoom();
}

/** Keep at least a third of the country in view at any zoom. */
function clampVB(vb) {
  const [x, y, w, h] = vb;
  const pad = Math.max(w, h);
  return [
    Math.max(IN_VB[0] - pad, Math.min(IN_VB[0] + IN_VB[2] + pad - w, x)),
    Math.max(IN_VB[1] - pad, Math.min(IN_VB[1] + IN_VB[3] + pad - h, y)),
    w, h
  ];
}

function zoomIn() { zoomAbout(1.35, null, null, 260); say('Zoomed in'); }
function zoomOut() { zoomAbout(1 / 1.35, null, null, 260); say('Zoomed out'); }
function zoomReset() {
  if (S.mapFocus) flyTo(stateVB(S.mapFocus)); else flyTo(IN_VB.slice());
  paintZoom(); say(S.mapFocus ? 'Fitted to the state' : 'Fitted to India');
}
function zoomAll() { mapHome(); setTimeout(paintZoom, 40); }

function paintZoom() {
  const z = currentZoom();
  document.querySelectorAll('.zlvl').forEach(el =>
    el.textContent = z < 1.05 ? '1×' : z.toFixed(1) + '×');
  document.querySelectorAll('.zoomc .zo').forEach(b => b.disabled = z <= ZOOM_MIN * 1.01);
  document.querySelectorAll('.zoomc .zi').forEach(b => b.disabled = z >= ZOOM_MAX * 0.99);
}

/** The control cluster, rendered into the map overlay. */
function zoomControls() {
  return `<div class="zoomc" role="group" aria-label="Map zoom">
    <button class="zi" onclick="zoomIn()" title="Zoom in (+)" aria-label="Zoom in">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
    <div class="zlvl" aria-live="polite">1×</div>
    <button class="zo" onclick="zoomOut()" title="Zoom out (−)" aria-label="Zoom out">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
    <button onclick="zoomReset()" title="Fit to view (0)" aria-label="Fit to view">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/></svg></button>
    <button onclick="zoomAll()" title="Back to India (Home)" aria-label="Back to the whole of India">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/></svg></button>
  </div>`;
}

/** The hint that appears once when someone wheels over the map without
    the modifier. Saying nothing would be as bad as hijacking the scroll:
    the reader would conclude the map cannot be zoomed at all. */
let hintTimer = null;
function mapHint(host, text) {
  let el = host.parentNode && host.parentNode.querySelector('.maphint');
  if (!el) {
    if (!host.parentNode) return;
    el = document.createElement('div');
    el.className = 'maphint';
    el.setAttribute('aria-hidden', 'true');
    host.parentNode.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => el.classList.remove('on'), 1500);
}

/** Convert a client point to viewBox coordinates through the viewBox that
    is actually on the element — the aspect-fitted one, not the logical
    camera. Using the logical box here is what makes a map drift sideways
    as you zoom. */
function mapPoint(host, clientX, clientY) {
  const svg = host.querySelector('svg'); if (!svg) return null;
  const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
  if (vb.length !== 4 || !vb.every(n => isFinite(n))) return null;
  const r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { svg, vb, r,
           x: vb[0] + (clientX - r.left) / r.width * vb[2],
           y: vb[1] + (clientY - r.top) / r.height * vb[3],
           scale: r.width / vb[2] };
}

/** Wheel zoom, drag pan, pinch zoom and keyboard navigation on a rendered
    map host. Idempotent: `render()` replaces the host element, and the
    flag rides on the element so a fresh one binds once and a surviving
    one is never bound twice. */
function bindMapNav(host) {
  if (!host || host._navBound) return;
  host._navBound = true;

  /* The map is a control, so it takes focus and answers the keyboard. */
  if (!host.hasAttribute('tabindex')) host.setAttribute('tabindex', '0');
  host.setAttribute('role', 'application');
  host.setAttribute('aria-label',
    'Risk map of India. Hold Control and scroll to zoom, or use the arrow keys to pan ' +
    'and plus and minus to zoom. Scrolling without Control scrolls the page.');

  /* ── Wheel ────────────────────────────────────────────────────────
     Without a modifier this handler does nothing at all — no
     preventDefault, no zoom — so the browser's own scrolling runs
     untouched and the page moves at exactly the speed it does
     everywhere else. The listener stays non-passive because the
     modifier branch does need to cancel: Ctrl+wheel is the browser's
     page-zoom gesture, and letting that through would zoom the whole
     interface instead of the map. */
  host.addEventListener('wheel', ev => {
    if (!(ev.ctrlKey || ev.metaKey)) {
      /* Only speak when the gesture was plausibly aimed at the map —
         a fast flick past it on the way down the page is not a question. */
      if (Math.abs(ev.deltaY) > 4) mapHint(host, 'Hold Ctrl and scroll to zoom the map');
      return;
    }
    ev.preventDefault();
    const p = mapPoint(host, ev.clientX, ev.clientY); if (!p) return;
    /* Wheel deltas arrive in three different units depending on the
       device and the browser; normalise to pixels before they mean
       anything, then cap so one violent event cannot leap two levels. */
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
    const dy = Math.max(-WHEEL_DELTA_CAP, Math.min(WHEEL_DELTA_CAP, ev.deltaY * unit));
    if (!dy) return;
    zoomAbout(Math.exp(-dy * WHEEL_ZOOM_RATE), p.x, p.y, 130);
  }, { passive: false });

  /* ── Pointer: mouse and pen drag to pan ───────────────────────────
     Touch is excluded on purpose. One finger scrolls the page — see the
     contract above — and two fingers are handled by the pinch listener. */
  let drag = null;
  host.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 || ev.pointerType === 'touch') return;
    const p = mapPoint(host, ev.clientX, ev.clientY); if (!p) return;
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY,
             vb: VBto.slice(), scale: p.scale, live: false };
  });

  host.addEventListener('pointermove', ev => {
    if (!drag || ev.pointerId !== drag.id) return;
    const rawX = ev.clientX - drag.x, rawY = ev.clientY - drag.y;
    if (!drag.live) {
      if (Math.hypot(rawX, rawY) < PAN_THRESHOLD_PX) return;
      /* Engage from where the threshold was crossed, not from where the
         press landed — otherwise the map jumps those four pixels the
         instant it starts moving, which is the small jerk that makes a
         drag feel twitchy. */
      drag.live = true;
      drag.x = ev.clientX; drag.y = ev.clientY;
      host.classList.add('panning');
      try { host.setPointerCapture(ev.pointerId); } catch (e) { /* not supported */ }
      return;
    }
    const dx = (ev.clientX - drag.x) / drag.scale, dy = (ev.clientY - drag.y) / drag.scale;
    /* A drag is a direct manipulation: the ground stays under the cursor,
       one to one, with no easing and no inertia to carry it past where
       the hand stopped. */
    VB = VBto = clampVB([drag.vb[0] - dx, drag.vb[1] - dy, drag.vb[2], drag.vb[3]]);
    applyVB();
  });

  const endDrag = ev => {
    if (drag && ev && ev.pointerId != null) {
      try { host.releasePointerCapture(ev.pointerId); } catch (e) { /* already gone */ }
    }
    /* A pan ends with the pointer released over a state, a zone or a
       shelter, and the browser dispatches a click there. Without this the
       map opened whatever happened to be under the finger at the end of
       every drag — you could not move the map without also being taken
       somewhere. A drag that actually moved swallows exactly one click. */
    if (drag && drag.live) swallowClick = true;
    drag = null;
    host.classList.remove('panning');
  };
  host.addEventListener('pointerup', endDrag);
  host.addEventListener('pointercancel', endDrag);

  let swallowClick = false;
  host.addEventListener('click', ev => {
    if (!swallowClick) return;
    swallowClick = false;
    ev.stopPropagation();
    ev.preventDefault();
  }, true);
  /* No pointerleave handler: with pointer capture the drag legitimately
     continues outside the element, and cancelling it there was why a pan
     stopped dead whenever it reached the edge of the map. */

  /* ── Touch: two fingers pinch and pan together ────────────────────
     `touch-action: pan-y` in the stylesheet means the browser owns the
     one-finger vertical gesture and never hands it here, so the page
     scrolls on a phone exactly as it does everywhere else. This listener
     only ever cancels when two fingers are down, which is unambiguous. */
  let pinch = null;
  const span = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = t => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];

  host.addEventListener('touchstart', ev => {
    if (ev.touches.length !== 2) { pinch = null; return; }
    const t = [ev.touches[0], ev.touches[1]], m = mid(t);
    const p = mapPoint(host, m[0], m[1]); if (!p) return;
    pinch = { d: span(t), mx: m[0], my: m[1], vb: VBto.slice(), scale: p.scale };
  }, { passive: true });

  host.addEventListener('touchmove', ev => {
    if (!pinch || ev.touches.length !== 2) return;
    ev.preventDefault();                       // two fingers on the map is a zoom
    const t = [ev.touches[0], ev.touches[1]], m = mid(t), d = span(t);
    if (!pinch.d) return;
    const ratio = d / pinch.d;
    /* Pan with the midpoint first, so the pinch centre stays put, then
       apply the scale change about it. */
    const dx = (m[0] - pinch.mx) / pinch.scale, dy = (m[1] - pinch.my) / pinch.scale;
    VB = VBto = clampVB([pinch.vb[0] - dx, pinch.vb[1] - dy, pinch.vb[2], pinch.vb[3]]);
    applyVB();
    if (Math.abs(ratio - 1) > PINCH_THRESHOLD) {
      const p = mapPoint(host, m[0], m[1]);
      if (p) zoomAbout(ratio, p.x, p.y, 0);    // the fingers are the animation
      pinch = { d, mx: m[0], my: m[1], vb: VBto.slice(), scale: (p && p.scale) || pinch.scale };
    }
  }, { passive: false });

  const endPinch = () => { pinch = null; paintZoom(); };
  host.addEventListener('touchend', endPinch, { passive: true });
  host.addEventListener('touchcancel', endPinch, { passive: true });

  /* ── Double-click: a deliberate, single, moderate step in ────────── */
  host.addEventListener('dblclick', ev => {
    const p = mapPoint(host, ev.clientX, ev.clientY); if (!p) return;
    ev.preventDefault();
    zoomAbout(ev.shiftKey ? 1 / 1.6 : 1.6, p.x, p.y, 280);
    say(ev.shiftKey ? 'Zoomed out' : 'Zoomed in');
  });

  /* ── Keyboard, while the map has focus ───────────────────────────
     Arrow keys pan by a tenth of the view, which is a readable step at
     any zoom; the browser's own scrolling is only suppressed for the
     keys the map actually consumes. */
  host.addEventListener('keydown', ev => {
    const step = (k) => { const [x, y, w, h] = VBto; return k === 'x' ? w * 0.1 : h * 0.1; };
    const pan = (dx, dy) => {
      const [x, y, w, h] = VBto;
      flyTo(clampVB([x + dx, y + dy, w, h]), 180);
    };
    switch (ev.key) {
      case 'ArrowLeft':  pan(-step('x'), 0); break;
      case 'ArrowRight': pan(step('x'), 0); break;
      case 'ArrowUp':    pan(0, -step('y')); break;
      case 'ArrowDown':  pan(0, step('y')); break;
      case '+': case '=': zoomIn(); break;
      case '-': case '_': zoomOut(); break;
      case '0':          zoomReset(); break;
      default: return;
    }
    ev.preventDefault();
  });
}

/* ══════════════════════════════════════════════════════════════════
   THE LATEST SITUATION
   One line, always current, always the same answer everywhere: what is
   the most severe thing happening in India right now, and how old is
   that assessment.
   ══════════════════════════════════════════════════════════════════ */
function paintLatest() {
  const hosts = document.querySelectorAll('.latest');
  if (!hosts.length) return;
  const L = S.latest;
  const newest = (S.national || [])[0];
  for (const el of hosts) {
    el.innerHTML = el.dataset.mode === 'public'
      ? latestPublicHTML(L, newest)
      : latestOpsHTML(L, newest);
  }
}

/** Operations framing: the worst situation, and the newest warning.

    On the map this is the headline — it is what the screen is about. On
    every other screen it is context, and a filled red block above the
    page title competes with the title for the same job. Same information,
    quieter voice. */
function latestOpsHTML(L, newest) {
  if (!L) return '';
  const st = S.states[L.state], P = PRI[lvl(L.score)];
  const headline = S.view === 'map';
  return `
    <button class="lt-main${headline ? '' : ' quiet'}" onclick="pickState('${L.state}')" title="Open ${esc(L.name)}">
      <span class="lt-tag" style="${headline ? `background:${P.c}` : `color:${P.c};background:${P.c}1A`}">Most severe now</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${HAZ[L.hazard].c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${HAZ[L.hazard].ic}"/></svg>
      <b>${esc(L.name)}</b>
      <span class="lt-d">${esc(HAZ[L.hazard].name)} · ${esc(st ? st.dis : '')}</span>
      <span class="lt-s" style="color:${P.c}">${L.score}</span>
    </button>
    ${newest ? `<button class="lt-new" onclick="pickState('${newest.state}')" title="${esc(newest.head || '')}">
      <span class="dot lv"></span>Newest warning · <b>${esc(newest.stateName)}</b>
      <span class="lt-d">${esc(newest.event)}</span>
      <span class="m lt-a">${agoText(newest.age)}</span></button>` : ''}`;
}

/* Public framing: the same live picture, said the way a resident needs it.
   An operator wants the peak score; a resident wants to know which places
   are worst right now and whether one of them is theirs. */
function latestPublicHTML(L, newest) {
  const worst = Object.values(S.states)
    .map(st => ({ st, v: Math.max(...Object.values(st.hz)) }))
    .sort((a, b) => b.v - a.v).slice(0, 4);
  const mine = S.focus;
  return `
    <div class="ltp-h">
      <span class="ltp-l"><span class="dot lv"></span>Worst affected right now</span>
      <span class="ltp-s2" title="${esc(seasonLabel()[1])}">${esc(seasonLabel()[0])}</span>
      ${newest ? `<span class="ltp-n">Latest warning · <b>${esc(newest.stateName)}</b>
        — ${esc(newest.event)}, ${agoText(newest.age)}</span>` : ''}
      <span class="ltp-t m">updated ${hm()} IST</span>
    </div>
    <div class="ltp-row">
      ${worst.map(({ st, v }) => {
        const P = PRI[lvl(v)];
        return `<button class="ltp-c${st.id === mine ? ' mine' : ''}" onclick="pickState('${st.id}')">
          <span class="ltp-b" style="background:${P.c}"></span>
          <span class="ltp-n2">${esc(st.name)}${st.id === mine ? ' <i>· you are here</i>' : ''}</span>
          <span class="ltp-d">${esc(st.dis)}</span>
          <span class="ltp-s" style="color:${P.c}">${P.n}</span>
        </button>`;
      }).join('')}
    </div>`;
}

/* ══════════════════════════════════════════════════════════════════
   SECURITY & ACCESS screen
   ══════════════════════════════════════════════════════════════════ */
function viewSecurity() {
  const s = AUTH.session;
  const idleLeft = s ? Math.max(0, Math.ceil((AUTH.idleMs - (Date.now() - s.lastActivity)) / 60000)) : 0;
  const absLeft = s ? Math.max(0, Math.round((s.absoluteExpiry - Date.now()) / 60000)) : 0;
  const KIND = { 'sign-in': ['Signed in', 'p-low'], 'sign-out': ['Signed out', 'p-off'],
    'sign-in-failed': ['Rejected', 'p-crit'], 'step-up': ['Re-confirmed', 'p-low'],
    'step-up-failed': ['Re-confirm failed', 'p-crit'], denied: ['Refused', 'p-high'],
    write: ['Operator write', 'p-med'] };
  const PERMS = ['read_operational', 'acknowledge_alert', 'update_shelter_status', 'report_road_status',
                 'verify_citizen_report', 'trigger_evacuation_plan', 'read_audit'];

  return page('Security & Access',
    'Who is signed in, what that permits, and every authentication event this session.',
    `<div class="g2" style="margin-bottom:16px">
      <div class="card"><div class="card-h"><h3>Current session</h3>
        <span style="flex:1"></span>${s ? pill(ROLE_LABEL[s.role] || s.role, 'p-low') : pill('No session', 'p-off')}</div>
        <div class="card-b">${s ? `
          <div class="kvl">
            ${kvRow('Operator', esc(s.name))}
            ${kvRow('Operator ID', `<b class="m">${esc(s.user)}</b>`)}
            ${kvRow('District scope', `<b class="m">${esc(s.district || 'National')}</b>`)}
            ${s.scope ? kvRow('Asset scope', `<b class="m">${esc(s.scope.join(', '))}</b>`) : ''}
            ${kvRow('Signed in at', `<b class="m">${fmtIST(new Date(s.issuedAt), true)} IST</b>`)}
            ${kvRow('Idle sign-out in', `<b class="m" id="sessclock">${idleLeft}m</b>`)}
            ${kvRow('Absolute limit', `<b class="m">${absLeft} min left</b>`)}
            ${kvRow(term('step-up', 'Step-up') + ' valid for',
              `<b class="m">${Math.max(0, Math.ceil((AUTH.stepUpMs - (Date.now() - s.stepUpAt)) / 60000))} min</b>`)}
          </div>
          <div style="margin-top:12px"><button class="b d" onclick="requestSignOut()">Sign out</button></div>`
          : `<div class="empty"><b>No session</b><span>You are on the public portal.</span></div>`}
        </div></div>

      <div class="card"><div class="card-h"><h3>What this role may do</h3></div>
        <div class="card-b">${s ? `
          <div class="perms">${PERMS.map(pm => {
            const has = s.can.includes(pm);
            return `<div class="perm ${has ? 'y' : 'n'}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round">${
                has ? '<path d="m5 13 4 4 10-10"/>' : '<path d="M18 6 6 18M6 6l12 12"/>'}</svg>
              <span>${pm.replace(/_/g, ' ')}</span></div>`;
          }).join('')}</div>
          <div class="note i" style="margin:12px 0 0">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
            <span>A refused action is refused, not hidden. Attempting something outside your role produces a
            logged denial rather than a greyed-out button, so the boundary is visible to whoever reads the log.</span></div>`
          : `<div class="empty"><b>Sign in to see permissions</b><span>Roles differ in what they may do, not only in what they see.</span></div>`}
        </div></div>
    </div>

    <div class="sl">Authentication log<span style="text-transform:none;letter-spacing:0;font-weight:500">append-only · newest first</span></div>
    ${AUTH.audit.length ? `<div class="tbl"><table><thead><tr>
      <th style="width:92px">Time</th><th style="width:160px">Event</th><th>Detail</th><th style="width:160px">Operator</th>
    </tr></thead><tbody>${AUTH.audit.map(a => {
      const [label, cls] = KIND[a.kind] || [a.kind, 'p-off'];
      return `<tr><td class="m">${a.t}</td><td>${pill(label, cls)}</td>
        <td>${esc(a.detail)}</td><td class="m" style="color:var(--t2)">${esc(a.user)}</td></tr>`;
    }).join('')}</tbody></table></div>`
    : `<div class="tbl"><div class="empty"><b>Nothing yet</b><span>Authentication events appear here as they happen.</span></div></div>`}

    <div class="sl" style="margin-top:18px">How the bridge works</div>
    <div class="secgrid">
      ${[['One door', 'Every path into Command runs through a credential check. There is no toggle, no URL and no console call that grants it.'],
         ['Passwords never stored', 'PBKDF2-SHA-256, 210 000 iterations, per-account salt, constant-time comparison. A wrong operator ID costs the same time as a wrong password, so the account list cannot be probed.'],
         ['Throttled', 'Five attempts, then a lockout doubling from one minute to a fifteen-minute ceiling — slow enough that guessing is pointless, bounded so nobody is locked out of an emergency all day.'],
         ['Two expiries', 'Fifteen minutes idle, with a warning first, and eight hours absolute. Neither extends without signing in again.'],
         ['Step-up on writes', 'Reading the map does not ask again. Changing what other people see does — once, then valid for ten minutes.'],
         ['Scope-checked', 'A shelter operator may update their own shelter. An attempt to update another is refused and written to the log.']
        ].map(([h, b]) => `<div class="seccard"><b>${h}</b><span>${b}</span></div>`).join('')}
    </div>`);
}

const kvRow = (k, v) => `<div class="kvr"><span>${k}</span><span>${v}</span></div>`;
