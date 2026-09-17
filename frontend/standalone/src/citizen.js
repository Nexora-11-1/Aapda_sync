/* ══════════════════════════════════════════════════════════════════
   CITIZEN PORTAL — public view

   Rules this view obeys:
     · Only official warnings are called warnings, and always with the
       issuing authority attached.
     · Model output appears as "AI risk assessment" and never as an
       instruction to act.
     · Nothing operational is exposed — no priority ranking, no
       individual capacity constraints, no routing internals.
   ══════════════════════════════════════════════════════════════════ */

function czGo(v) { S.cz = v; render(); }

/** Where the public view is currently looking. */
const scopeName = () => (S.states[S.focus] || S.states.ut).district;

/* ── Where the public map opens ──────────────────────────────────────
   On the state the reader is in, not on the whole country. A national
   view is the right default for a control room deciding where to send
   people; it is the wrong one for someone who wants to know whether the
   water is coming up their own road. The whole of India is one button
   away, and the map says which it is showing. */
function czWholeIndia() {
  S.mapFocus = null;
  flyTo(IN_VB.slice());
  paintMap(); paintZoom();
  say('Showing the whole of India');
}
function czMyState() {
  const id = S.focus || 'ut';
  S.mapFocus = id;
  flyTo(stateVB(id));
  paintMap(); paintZoom();
  say('Showing ' + S.states[id].name);
}

function viewCitizen() {
  const top = S.alerts[0];
  const open = S.shelters.filter(s => s.operational && s.effective_capacity > 0);
  const totalPlaces = open.reduce((a, s) => a + s.effective_capacity, 0);

  return `<div class="cz">
    <div class="tick ${top.sev === 'Extreme' ? 'x' : top.sev === 'Severe' ? 'h' : top.sev === 'Moderate' ? 'm' : 'l'}"
         id="cztick">${czTickerHTML(top)}</div>

    <nav class="cznav" aria-label="Sections">
      <div class="w">
        ${[['home', 'Home', 'M3 11 12 3l9 8M5 10v10h14V10'],
           ['alerts', 'Warnings', 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'],
           ['shelters', 'Shelters', 'M3 11 12 3l9 8M5 10v10h14V10M10 20v-6h4v6'],
           ['prepare', 'What to do', 'M9 11l3 3 6-6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'],
           ['memorial', 'What we learned', 'M3 5h18v14H3ZM8.5 10a1.5 1.5 0 1 0 0-.01M21 15l-5-5-6 6'],
           ['relief', 'Help the affected', 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8Z']
          ].map(([k, label, ic]) => `<button class="${S.cz === k ? 'on' : ''}" onclick="czGo('${k}')"
             ${S.cz === k ? 'aria-current="page"' : ''}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ic}"/></svg>
            ${label}</button>`).join('')}
      </div>
    </nav>

    <div class="latest pub" data-mode="public"></div>

    <div class="czw">
      ${S.cz === 'home' ? czHome(open, totalPlaces)
        : S.cz === 'alerts' ? czAlerts()
        : S.cz === 'shelters' ? czShelters(open)
        : S.cz === 'memorial' ? viewMemorial()
        : S.cz === 'relief' ? viewRelief()
        : czPrepare()}
    </div>

    <footer><div class="w">
      <div><b>AapdaSync</b>
        <a href="#" onclick="czGo('memorial');return false">What we learned</a>
        <a href="#" onclick="czGo('relief');return false">Help the affected</a>
        <a href="#" onclick="toggleChat();return false">Ask a question</a></div>
      <div><b>Emergency</b>
        <a href="#" onclick="return false">112 — Emergency response</a>
        <a href="#" onclick="return false">1077 — District control room</a>
        <a href="#" onclick="return false">1070 — State control room</a></div>
      <div><b>Authorities</b>
        <a href="#" onclick="return false">NDMA · SACHET</a>
        <a href="#" onclick="return false">India Meteorological Department</a>
        <a href="#" onclick="return false">${esc((S.states[S.focus]||S.states.ut).name)} SDMA</a></div>
      <div style="max-width:340px"><b>Note</b>
        <span style="display:block;line-height:18px">Risk figures on this site are AI-based estimates for planning and awareness. Official warnings are issued by the authorities named on each alert and always take precedence.</span></div>
    </div></footer>
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════
   THE HERO — photographs of what this platform is for

   A disaster portal that opens on a risk score asks a reader to care
   about a number. This opens on the thing the number is about, with the
   sentence each event forced the country to learn, and a way through to
   the full account. It is the one place on the site where a photograph
   earns the space it takes.

   What it is built to avoid, in order:

     · Layout shift. The box is sized by aspect-ratio before a single
       byte of image arrives, every `img` carries its intrinsic width and
       height, and the reserved box is painted in the photograph's own
       dominant colour so it does not flash from empty to picture.
     · Decode cost. Only the current slide and its two neighbours ever
       have a `src`. Six 1280-pixel photographs decoded at once is thirty
       megabytes of bitmap for five pictures nobody is looking at.
     · Motion for its own sake. One CSS opacity crossfade, no JavaScript
       animation loop, nothing that runs when the tab is hidden, and
       nothing at all under `prefers-reduced-motion`.
     · Stealing the page. Autoplay stops the moment anybody touches it
       and does not restart itself behind their back.
   ══════════════════════════════════════════════════════════════════ */

const HERO_MS = 6500;          // 5–7 s: long enough to read the caption
let heroIdx = 0, heroTimer = null, heroTouch = null;

/** The events that ship with a photograph big enough to fill the box.
    A 512-pixel source stretched across 1240 is a blurred rectangle, and
    a blurred rectangle is worse than the drawn illustration it replaced —
    so those stay in the gallery, where they are shown small. */
function heroEvents() {
  if (typeof PAST_EVENTS === 'undefined') return [];
  return PAST_EVENTS.filter(e => {
    const p = typeof photoFor === 'function' ? photoFor(e.id) : null;
    return p && p.src && (p.w == null || p.w >= 800);
  });
}

function heroSlideHTML(e, i, n) {
  const p = photoFor(e.id), h = HAZ[e.hazard];
  const active = i === heroIdx;
  const near = Math.min(Math.abs(i - heroIdx), n - Math.abs(i - heroIdx)) <= 1;
  const dim = p.w && p.h ? ` width="${p.w}" height="${p.h}"` : '';
  return `<figure class="hslide${active ? ' on' : ''}" data-i="${i}"
      role="group" aria-roledescription="slide" aria-label="${i + 1} of ${n}: ${esc(e.name)}, ${e.year}"
      ${active ? '' : 'aria-hidden="true"'} style="background:${esc(p.tone || '#12202E')}">
    <img ${near ? `src="${esc(p.src)}"` : `data-src="${esc(p.src)}"`}${dim}
         alt="${esc(e.name)}, ${e.year} — ${esc(e.place)}"
         decoding="async" ${active ? 'fetchpriority="high"' : 'loading="lazy"'}>
    <div class="hgrad" aria-hidden="true"></div>
    <figcaption class="hcap">
      <span class="htag" style="background:${h.c}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${h.ic}"/></svg>
        ${esc(h.name)} · ${e.year}</span>
      <h2>${esc(e.name)}</h2>
      <p class="hplace">${esc(e.place)}</p>
      <p class="hlead">${esc(e.lesson)}</p>
      <div class="hact">
        <button class="b p" onclick="heroOpen(${i})">What this one changed
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></button>
        <span class="hcred${p.verified === false ? ' unver' : ''}">
          Photograph · ${esc(p.credit)} · ${esc(p.licence)}${p.source ? ' · ' + esc(p.source) : ''}
          ${p.verified === false ? '<b>attribution unverified</b>' : ''}</span>
      </div>
    </figcaption>
  </figure>`;
}

function heroBlock() {
  const ev = heroEvents();
  if (!ev.length) return '';
  const n = ev.length;
  if (heroIdx >= n) heroIdx = 0;
  return `<section class="hero" id="hero" aria-roledescription="carousel"
      aria-label="Disasters India has lived through"
      onpointerdown="heroDown(event)" onpointerup="heroUp(event)" onpointercancel="heroUp(event)"
      onmouseenter="heroHold(true)" onmouseleave="heroHold(false)"
      onfocusin="heroHold(true)" onfocusout="heroFocusOut(event)"
      onkeydown="heroKey(event)">
    <div class="hstage" id="hstage">${ev.map((e, i) => heroSlideHTML(e, i, n)).join('')}</div>
    <button class="hnavb l" onclick="heroGo(-1)" aria-label="Previous photograph">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
    <button class="hnavb r" onclick="heroGo(1)" aria-label="Next photograph">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button>
    <div class="hbar">
      <button class="hplay playing" id="heroplay" onclick="heroToggle()"
              aria-label="Pause the slideshow" aria-pressed="true">
        <svg class="i-pause" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>
        <svg class="i-play" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7Z"/></svg></button>
      <div class="hdots" id="herodots" role="tablist" aria-label="Choose a photograph">
        ${ev.map((e, i) => `<button role="tab" onclick="heroTo(${i})"
            aria-label="${esc(e.name)}, ${e.year}" aria-selected="${i === heroIdx}"></button>`).join('')}
      </div>
      <span class="hcount m" id="herocount">${heroIdx + 1} / ${n}</span>
    </div>
    <span class="sr" aria-live="polite" id="herolive"></span>
  </section>`;
}

/** Move the slides. Only classes and one attribute change, so the
    crossfade is the browser's and nothing here runs per frame. */
function paintHero() {
  const stage = $('hstage'); if (!stage) return;
  const slides = stage.querySelectorAll('.hslide');
  const n = slides.length; if (!n) return;
  heroIdx = ((heroIdx % n) + n) % n;
  slides.forEach((el, i) => {
    const active = i === heroIdx;
    const near = Math.min(Math.abs(i - heroIdx), n - Math.abs(i - heroIdx)) <= 1;
    el.classList.toggle('on', active);
    el.setAttribute('aria-hidden', active ? 'false' : 'true');
    /* Promote the neighbours as we arrive at them: the next slide is
       decoded before it is shown, and the far ones never are. */
    const img = el.querySelector('img');
    if (img && near && !img.getAttribute('src') && img.dataset.src) {
      img.setAttribute('src', img.dataset.src);
      delete img.dataset.src;
    }
  });
  const dots = $('herodots');
  if (dots) dots.querySelectorAll('button').forEach((b, i) =>
    b.setAttribute('aria-selected', String(i === heroIdx)));
  const c = $('herocount'); if (c) c.textContent = `${heroIdx + 1} / ${n}`;
  const live = $('herolive');
  const ev = heroEvents()[heroIdx];
  if (live && ev) live.textContent = `${ev.name}, ${ev.year}. Slide ${heroIdx + 1} of ${n}.`;
}

function heroTo(i) { heroIdx = i; paintHero(); heroStop('user'); }
function heroGo(d) { heroIdx += d; paintHero(); heroStop('user'); }

/** Open the full account of the event on the current slide. */
function heroOpen(i) {
  const ev = heroEvents()[i]; if (!ev) return;
  const at = PAST_EVENTS.findIndex(e => e.id === ev.id);
  heroStop('user');
  S.cz = 'memorial'; render();
  if (at >= 0 && typeof galTo === 'function') galTo(at);
}

/* ── Autoplay ───────────────────────────────────────────────────────
   One interval, started only when the slideshow is actually on screen,
   stopped for good the moment a reader takes control of it. Hovering
   merely holds it — a hand resting over a photograph should not end the
   rotation permanently, but it should not advance under the cursor
   either. */
/* Two separate reasons the slideshow can be still, because they resume
   differently. `heroStopped` is a decision — a press on pause, a click on
   next, a dot — and it lasts until the reader presses play. `heroHeld` is
   a hand resting over the photograph or the keyboard focus sitting inside
   it, and it lifts by itself. Conflating them is how a carousel either
   advances under someone's cursor or never moves again. */
let heroStopped = false, heroHeld = false;

function heroRunning() { return !!heroTimer; }

function heroStart() {
  if (typeof REDUCED_MOTION !== 'undefined' && REDUCED_MOTION) { heroPlayBtn(false); return; }
  if (heroTimer || heroStopped || heroHeld) return;
  if (!$('hstage')) return;
  heroTimer = setInterval(() => {
    if (document.hidden) return;          // a hidden tab animates nothing
    heroIdx++; paintHero();
  }, HERO_MS);
  heroPlayBtn(true);
}

/** `reason` is 'user' for a deliberate stop, anything else for a hold. */
function heroStop(reason) {
  clearInterval(heroTimer); heroTimer = null;
  if (reason === 'user') heroStopped = true;
  heroPlayBtn(false);
}

function heroToggle() {
  if (heroTimer) { heroStop('user'); say('Slideshow paused'); }
  else { heroStopped = false; heroHeld = false; heroStart(); say('Slideshow playing'); }
}

/* Both icons live in the button and CSS decides which is visible.

   Swapping them by rewriting `innerHTML` looked harmless and was not:
   replacing the node under the cursor makes the browser drop its hover
   chain and rebuild it, which re-fires `mouseenter` on the slideshow,
   which pauses it again — so pressing play paused it, and while the loop
   was running the mousedown target was destroyed before the mouseup, so
   the button could not be clicked at all. Toggling a class touches no
   node the pointer is over, and the hover chain never moves. */
function heroPlayBtn(playing) {
  const b = $('heroplay'); if (!b) return;
  if (b.getAttribute('aria-pressed') === String(playing)) return;
  b.classList.toggle('playing', !!playing);
  b.setAttribute('aria-label', playing ? 'Pause the slideshow' : 'Play the slideshow');
  b.setAttribute('aria-pressed', String(playing));
}

/* `focusout` bubbles, so it also fires while tabbing between the
   slideshow's own controls. Only a focus that has actually left the
   component should release the hold. */
function heroFocusOut(ev) {
  const h = $('hero');
  if (h && ev.relatedTarget && h.contains(ev.relatedTarget)) return;
  heroHold(false);
}

function heroHold(on) {
  if (heroHeld === !!on) return;              // idempotent, see heroPlayBtn
  heroHeld = !!on;
  if (heroHeld) { clearInterval(heroTimer); heroTimer = null; heroPlayBtn(false); }
  else heroStart();
}

function heroDown(ev) {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  heroTouch = { x: ev.clientX, y: ev.clientY, t: Date.now() };
}
function heroUp(ev) {
  if (!heroTouch) return;
  const dx = ev.clientX - heroTouch.x, dy = ev.clientY - heroTouch.y;
  heroTouch = null;
  /* A swipe is horizontal and deliberate. Anything more vertical than
     horizontal was the reader scrolling the page past the photograph,
     and must not change the slide. */
  if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.6) heroGo(dx < 0 ? 1 : -1);
}

function heroKey(ev) {
  if (ev.key === 'ArrowLeft') { heroGo(-1); ev.preventDefault(); }
  else if (ev.key === 'ArrowRight') { heroGo(1); ev.preventDefault(); }
}

/* The ticker and the alert cards are the two things on the landing page
   that genuinely change minute to minute. They are pulled out as their
   own fragments so the live loop can update them in place, without
   replacing the element that holds the reader's scroll position. */
function czTickerHTML(top) {
  return `<div class="w">
      <span class="lab">${esc(top.sev)} · in force</span>
      <b>${esc(top.head)}</b>
      <span style="opacity:.85">${esc(top.auth)}</span>
      <span style="flex:1"></span>
      <button class="b" onclick="czGo('alerts')">All alerts</button>
    </div>`;
}

function czAlertCardsHTML() {
  return S.alerts.slice(0, 3).map(a => {
    const col = a.sev === 'Extreme' ? 'var(--crits)' : a.sev === 'Severe' ? 'var(--highs)' : 'var(--warns)';
    const stroke = a.sev === 'Extreme' ? '#B3261E' : a.sev === 'Severe' ? '#D2551A' : '#A96700';
    return `<div class="dis" onclick="czGo('alerts')">
      <div class="di" style="background:${col}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="${HAZ[a.haz].ic}"/></svg></div>
      <div style="flex:1">
        <div class="n">${esc(a.head)} ${pill(a.sev, a.sev === 'Extreme' ? 'p-crit' : a.sev === 'Severe' ? 'p-high' : 'p-med')}</div>
        <div class="x">${esc(a.inst)}</div>
        <div class="t">${esc(a.auth)} · ${a.t} IST · in force until ${a.exp}</div></div></div>`;
  }).join('');
}

function czHome(open, totalPlaces) {
  const st = S.states[S.focus] || S.states.ut;
  const stRisk = Math.max(...Object.values(st.hz));
  return `${heroBlock()}
  <div class="czg" style="margin-top:18px">
    <div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-h"><h3>Risk map · ${esc(st.district)}</h3>
          <span style="flex:1"></span>
          ${pill(PRI[lvl(stRisk)].n, PRI[lvl(stRisk)].cls)}</div>
        <div class="czmap"><div class="cm" style="position:absolute;inset:0"></div>
          <div class="ov bl"><div class="pan" style="width:180px">
            <div class="pan-h">Risk level</div>
            <div class="pan-b" style="padding:6px 11px 8px">
              ${['low', 'medium', 'high', 'critical'].map(k =>
                `<div class="lgr">${lgSvg(PRI[k])}<b>${PRI[k].n}</b></div>`).join('')}
            </div></div></div>
          <div class="ov br">${zoomControls()}
            <div class="mbtns">
              <button class="mbtn" title="Show the whole of India" onclick="czWholeIndia()" aria-label="Show the whole of India">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/></svg>
              </button>
              <button class="mbtn" title="Back to ${esc(st.name)}" onclick="czMyState()" aria-label="Back to my state">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z"/><circle cx="12" cy="10" r="2.4"/></svg>
              </button>
            </div>
          </div>
        </div>
        <div class="sl-bar">
          <span class="sl-cred"><b>AI risk assessment</b> — for planning and awareness. Official warnings are shown above and take precedence.</span>
          <span class="sl-count" id="czmaptime">${hm()} IST</span>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-h"><h3>What is happening</h3></div>
        <div id="czalerts">${czAlertCardsHTML()}</div>
      </div>

      <div class="card">
        <div class="card-h"><h3>Do and do not</h3></div>
        <div class="card-b"><div class="dd">
          <div class="ddc"><div class="ddh" style="background:var(--oks);color:var(--ok)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>Do</div>
            <ul class="ddl">
              <li>Move to higher ground, away from the riverbank.</li>
              <li>Keep identity documents and medicines with you.</li>
              <li>Charge your phone whenever power is available.</li>
              <li>Follow instructions from the district administration.</li>
              <li>Check on elderly neighbours and anyone living alone.</li></ul></div>
          <div class="ddc"><div class="ddh" style="background:var(--crits);color:var(--crit)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>Do not</div>
            <ul class="ddl">
              <li>Do not cross flowing water on foot or by vehicle.</li>
              <li>Do not stop below a cut slope on NH-7.</li>
              <li>Do not return home until the administration says so.</li>
              <li>Do not rely on rumours — check the alerts on this page.</li>
              <li>Do not touch fallen electrical lines.</li></ul></div>
        </div></div>
      </div>
    </div>

    <div>
      <div class="card don" style="margin-bottom:16px">
        <div class="card-h" style="background:transparent"><h3>Shelters open now</h3></div>
        <div class="card-b">
          <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px">
            <span style="font-size:30px;font-weight:700;line-height:1;color:var(--pri)" id="czopen">${open.length}</span>
            <span style="font-size:13px;color:var(--t2)">shelters with space</span></div>
          <div style="font-size:12.5px;color:var(--t2);margin-bottom:12px" id="czplaces">${nf(totalPlaces)} places available across ${esc(st.district)}</div>
          <button class="b p f" onclick="czGo('shelters')" style="width:100%">Find the nearest shelter</button>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-h"><h3>Emergency numbers</h3></div>
        <div class="card-b" style="padding:8px 16px 14px">
          ${[['112', 'Emergency response'], ['1077', 'District control room'],
             ['1070', `State control room, ${esc(st.name)}`], ['1078', 'NDMA control room']]
            .map(([n, d]) => `<div class="need"><div class="g"><div class="n">${d}</div></div>
              <b class="m" style="font-size:17px;color:var(--pri)">${n}</b></div>`).join('')}
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-h"><h3>Report what you see</h3></div>
        <div class="card-b">
          <div style="font-size:12.5px;color:var(--t2);line-height:18px;margin-bottom:11px">
            Blocked road, water in houses, new cracks in the ground — tell the district administration. An officer reviews every report.</div>
          <button class="b p f" onclick="openDw('report')" style="width:100%">Report an incident</button>
        </div>
      </div>

      <div class="card">
        <div class="card-h"><h3>Hazards monitored</h3></div>
        <div class="card-b"><div class="hzg">
          ${HAZ_ORDER.map(k => {
            const h = HAZ[k], on = scorable(k);
            const why = on ? 'Monitored here'
              : (h.coastal_only && !coastalNow()) ? 'Coastal — not here'
              : 'No local source';
            return `<button class="hzc${on ? '' : ' off'}" onclick="setHazard('${k}')"
                title="${esc(h.name)} — ${esc(on ? h.fidelity : why)}">
              <span class="ic2" style="background:${h.c}1A">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${h.c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${h.ic}"/></svg></span>
              <div class="n">${esc(h.name)}</div>
              <div class="s">${why}</div></button>`;
          }).join('')}
        </div></div>
      </div>
    </div>
  </div>

  <!-- The gallery is on the landing page as well as its own.
       Requiring a click to reach the thing people come back for means
       most of them never see it. -->
  ${galleryBlock(true)}`;
}

/* ── The past-disaster gallery, as a block ──────────────────────────
   One implementation, two placements: the landing page shows it under
   the live picture, and `What we learned` gives it the whole screen
   with the full account of each event beneath. */
function galleryBlock(compact) {
  return `<div class="galwrap${compact ? ' compact' : ''}">
    ${compact ? `<div class="galhead">
        <div><h2>What we learned</h2>
          <p>Disasters India has lived through, and the change each one forced.</p></div>
        <button class="b g" onclick="czGo('memorial')">Open all ten
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></button>
      </div>` : ''}
    <div class="gal" id="gal"
         onpointerdown="galDown(event)" onpointermove="galMove(event)"
         onpointerup="galUp(event)" onpointercancel="galUp(event)">
      <div class="galstg" id="galstage">${PAST_EVENTS.map((e, i) => slide(e, i)).join('')}</div>
      <button class="galnav l" onclick="galGo(-1)" aria-label="Previous">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
      <button class="galnav r" onclick="galGo(1)" aria-label="Next">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button>
    </div>
    <div class="galbar">
      <button class="galplay" id="galplay" onclick="galToggle()" aria-label="Play or pause">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7Z"/></svg></button>
      <div class="galdots" id="galdots" role="tablist">
        ${PAST_EVENTS.map((e, i) => `<button role="tab" aria-label="${esc(e.name)}" onclick="galTo(${i})"></button>`).join('')}
      </div>
      <span class="galcount m" id="galcount"></span>
    </div>
    <div class="galdet" id="galdet"></div>
  </div>`;
}

function czAlerts() {
  return `<div style="margin-top:18px">
    <div class="ph"><h2>Official alerts</h2>
      <p>Issued by Indian authorities for ${esc(scopeName())} and the surrounding area. These take precedence over anything else on this site.</p></div>
    ${S.alerts.map(a => {
      const col = a.sev === 'Extreme' ? 'var(--crit)' : a.sev === 'Severe' ? 'var(--high)' : 'var(--warn)';
      return `<div class="card" style="margin-bottom:12px;border-left:4px solid ${col}">
        <div class="card-h"><div style="flex:1">
          <h3>${esc(a.head)}</h3>
          <div style="font-size:12.5px;color:var(--t2);margin-top:3px">${esc(a.auth)}</div></div>
          ${pill(a.sev, a.sev === 'Extreme' ? 'p-crit' : a.sev === 'Severe' ? 'p-high' : 'p-med')}</div>
        <div class="card-b">
          <div class="note" style="margin-bottom:11px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
            <span><b>What to do:</b> ${esc(a.inst)}</span></div>
          <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:12.5px;color:var(--t2)">
            <span>Area · <b style="color:var(--t1)">${esc(a.area)}</b></span>
            <span>Issued · <b class="m" style="color:var(--t1)">${a.t} IST</b></span>
            <span>In force until · <b class="m" style="color:var(--t1)">${a.exp}</b></span></div>
        </div></div>`;
    }).join('')}</div>`;
}

function czShelters(open) {
  return `<div style="margin-top:18px">
    <div class="ph"><h2>Shelters</h2>
      <p>Relief camps and shelters currently open in ${esc(scopeName())}, with the space actually available.</p></div>
    <div class="tiles">
      ${tile('Open with space', open.length, 'var(--ok)', 'accepting people now')}
      ${tile('Places available', nf(open.reduce((a, s) => a + s.effective_capacity, 0)), 'var(--pri)', 'across the district')}
      ${tile('People sheltered', nf(S.shelters.reduce((a, s) => a + s.current_occupancy, 0)), 'var(--info)', 'currently in camps')}
      ${tile('Not accepting', S.shelters.length - open.length, 'var(--t3)', 'full or not usable')}
    </div>
    <div class="card">
      <div class="card-h"><h3>Open shelters</h3></div>
      ${open.map(s => `<div class="dis">
        <div class="di" style="background:var(--oks)">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#1B7F3B" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${IC.shelters}</svg></div>
        <div style="flex:1">
          <div class="n">${esc(s.name)} ${pill('Open', 'p-low')}</div>
          <div class="x">${nf(s.effective_capacity)} places available · ${nf(s.current_occupancy)} people currently sheltered</div>
          <div class="t">Updated ${s.reported} IST by the shelter operator</div></div></div>`).join('')}
    </div>
    <div class="note i" style="margin-top:14px">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
      <span>Places available reflects water, food and medical cover as well as floor space — not just how many people fit. Call <b>1077</b> before travelling a long distance to a shelter.</span></div>
  </div>`;
}

/* ── A photograph on the instructions ───────────────────────────────
   "Never walk through flowing water — 15 cm will knock you down" is a
   sentence people nod at and then wade in anyway. A photograph of a
   street in Chennai with the water at bumper height is the same sentence
   in a form that argues back. So each hazard card takes the photograph of
   the Indian event that hazard is best known by, captioned with what it
   is — never a generic stock picture, and never one that is not labelled.

   A hazard with no photograph in the build gets no strip. An empty
   decorative box would be worse than nothing. */
function hazardStrip(hazard) {
  if (typeof PAST_EVENTS === 'undefined' || typeof photoFor !== 'function') return '';
  const e = PAST_EVENTS.find(x => x.hazard === hazard && photoFor(x.id));
  if (!e) return '';
  const p = photoFor(e.id);
  return `<figure class="hzstrip" style="background:${esc(p.tone || '#12202E')}">
    <img src="${esc(p.src)}" alt="${esc(e.name)}, ${e.year} — ${esc(e.place)}"
      ${p.w && p.h ? `width="${p.w}" height="${p.h}"` : ''} loading="lazy" decoding="async">
    <figcaption>
      <b>${esc(e.name)}, ${e.year}</b>
      <span>${esc(e.place)}</span>
      <i${p.verified === false ? ' class="unver"' : ''}>${esc(p.credit)} · ${esc(p.licence)}</i>
    </figcaption>
  </figure>`;
}

function czPrepare() {
  const st = S.states[S.focus] || S.states.ut;
  /* Which hazards are actually live where the reader is, worst first. A
     page headed "what to do" that only ever describes a flood in one
     valley is useless to the other thirty-five states. */
  const active = Object.entries(st.hz).sort((a, b) => b[1] - a[1])
    .filter(([h, v]) => v >= 25).slice(0, 4);
  const evacuation = [
    ['Before you leave', ['Switch off electricity and gas at the mains.',
      'Take identity documents, medicines, a torch and a power bank.',
      'Tell a relative outside the district where you are going.',
      'Take drinking water for at least one day.']],
    ['On the way', ['Use the route the administration has announced, not a shortcut.',
      'Never walk or drive through flowing water — 15 cm will knock you down.',
      'Do not stop below a cut slope, especially after rain.',
      'Go on foot if the road is jammed; a stationary car is not shelter.']],
    ['At the shelter', ['Register at the entry desk so your family can find you.',
      'Tell the medical desk about any condition or medication.',
      'Keep children with you at all times.',
      'Use only the water provided for drinking.']],
    ['After', ['Return only when the administration confirms it is safe.',
      'Check the house for cracks and gas leaks before entering.',
      'Do not drink tap water until the supply is declared safe.',
      'Report damage to the patwari or the tehsil office.']]
  ];

  return `<div style="margin-top:18px">
    <div class="ph"><h2>What to do</h2>
      <p>For the hazards active in ${esc(st.name)} right now, worst first — then what to do
      if you are told to leave.</p></div>

    <div class="hzguide">
      ${active.map(([h, v]) => {
        const g = SAFETY_TEXT[h];
        if (!g) return '';
        const P = PRI[lvl(v)];
        return `<div class="card hgc">
          ${hazardStrip(h)}
          <div class="card-h" style="gap:10px">
            <span class="ic2" style="background:${HAZ[h].c}1A;width:30px;height:30px;border-radius:8px;display:grid;place-items:center;flex-shrink:0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${HAZ[h].c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${HAZ[h].ic}"/></svg></span>
            <h3 style="flex:1">${esc(HAZ[h].name)}</h3>
            ${pill(P.n, P.cls)}
          </div>
          <div class="card-b"><ul class="ddl" style="padding:0">
            ${g.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div></div>`;
      }).join('')}
    </div>

    <div class="ph" style="margin-top:26px"><h2>If you are told to leave</h2>
      <p>The same four steps whatever the hazard is.</p></div>
    <div class="split">
      ${evacuation.map(([t, items]) => `<div class="card" style="margin-bottom:14px">
        <div class="card-h"><h3>${t}</h3></div>
        <div class="card-b"><ul class="ddl" style="padding:0">
          ${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div></div>`).join('')}
    </div>
  </div>`;
}

/* The public safety guidance, per hazard, in the order it matters. The
   assistant retrieves prose from the same facts (rag.js) — this is the
   version a person reads on the page, and the two must not drift, so
   both are edited together when NDMA guidance changes. */
const SAFETY_TEXT = {
  flood: ['Move to higher ground before water reaches the road, not after.',
    'Never cross a flooded causeway — 60 cm of moving water will carry a car.',
    'Switch off the electricity at the mains before you leave.',
    'Boil or chlorinate all drinking water afterwards.'],
  landslide: ['New cracks, doors that suddenly stick, tilting poles and a changed stream sound all come before a slope moves.',
    'Leave at once and move sideways out of the path, not downhill along it.',
    'Never stop or park below a cut slope on a hill road.',
    'The risk stays high for days after the rain stops — the ground is still saturated.'],
  earthquake: ['Drop, cover and hold on. Get under a sturdy table, away from windows.',
    'Outside, move to open ground away from buildings, walls and power lines.',
    'Do not use lifts. Expect aftershocks.',
    'Check for gas leaks and cracks before going back inside.'],
  cyclone: ['Move to a designated cyclone shelter before the wind rises, not during the storm.',
    'Storm surge kills more people than wind — get away from the coast.',
    'Secure or bring in loose roofing sheets and anything that can fly.',
    'The calm of the eye is not the end; the wind returns from the opposite side.'],
  heatwave: ['Stay out of the sun between noon and four.',
    'Drink water often even when you are not thirsty; add ORS if you work outside.',
    'Check on elderly neighbours, infants and anyone working in the open.',
    'Confusion with hot dry skin is heat stroke — cool the person and get help immediately.'],
  lightning: ['If you can hear thunder you are already in range — go indoors.',
    'Avoid open fields, water and isolated trees, where most lightning deaths happen.',
    'Caught outside, crouch low with your feet together; do not lie flat.',
    'Wait thirty minutes after the last thunder before going back out.'],
  drought: ['Follow the district water rationing schedule.',
    'Report a failed handpump to the block office so the tanker route is updated.',
    'Drinking water comes before every other use.',
    'Register for fodder and employment support rather than selling livestock cheap.'],
  wildfire: ['Do not enter closed forest blocks.',
    'Report smoke to the range office with the location, immediately.',
    'Move at right angles to the wind, not ahead of the fire.',
    'Go downhill — fire climbs a slope faster than a person can.'],
  tsunami: ['Strong shaking near the coast is itself the warning. Do not wait for a bulletin.',
    'Move inland and uphill on foot — roads jam.',
    'The sea withdrawing far past the normal low line means a wave is coming.',
    'The first wave is often not the largest; stay away until the all-clear.']
};


/* The assistant lives in src/rag.js — it retrieves over the platform's
   own records rather than replaying a fixed script, so it stays correct
   as the situation moves. */
