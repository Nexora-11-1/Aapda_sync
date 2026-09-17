/* ══════════════════════════════════════════════════════════════════
   DRAWERS, MODALS, ACTIONS
   ══════════════════════════════════════════════════════════════════ */

function openDw(k) {
  S.dw = k; S.dwTouched = false;
  $('dwc').innerHTML = dwHTML(k);
  $('dw').classList.add('on');
  say('Panel opened');
}
function closeDw() { S.dw = null; S.dwTouched = false; $('dw').classList.remove('on'); }

/* ── Keeping a half-written form ────────────────────────────────────
   The pipeline used to regenerate the open drawer on every tick. The
   drawer is where an incident is reported and where a shelter's
   occupancy is updated, so every four seconds the platform threw away
   whatever the person was in the middle of writing — which is why an
   incident report could not be filed at all: the description was gone
   before the Submit button could be reached.

   One flag, set the first time anybody types or changes anything in
   there, and cleared when the drawer opens or closes. Once it is set the
   live loop leaves the drawer alone until the form is done with. */
document.addEventListener('input', ev => {
  if ($('dw') && $('dw').contains(ev.target)) S.dwTouched = true;
}, true);
document.addEventListener('change', ev => {
  if ($('dw') && $('dw').contains(ev.target)) S.dwTouched = true;
}, true);

/** Refresh the open drawer from the store — unless somebody is using it. */
function syncDrawer() {
  const dw = $('dw');
  if (!S.dw || !dw || !dw.classList.contains('on')) return;
  if (S.dwTouched || dw.contains(document.activeElement)) return;
  const b = dw.querySelector('.dw-b');
  const top = b ? b.scrollTop : 0;
  $('dwc').innerHTML = dwHTML(S.dw);
  const nb = dw.querySelector('.dw-b');
  if (nb) nb.scrollTop = top;
}

const dwHead = (k, t, extra = '') => `<div class="dw-h"><div class="g"><div class="dwk">${k}</div><div class="dwt">${t}</div>${extra}</div>
  <button class="ib" onclick="closeDw()" aria-label="Close"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>`;

function dwHTML(k) {
  return ({ cell: dwCell, shelter: dwShelter, alerts: dwAlerts, report: dwReportForm,
            pubstate: dwPubState })[k]?.() || '';
}

/* ── cell detail: the screen that answers "why" ── */
function dwCell() {
  const c = cellById(S.cellSel); if (!c) return '';
  const hz = S.hazard, risk = c.risk[hz], P = PRI[lvl(risk)];
  const z = zoneById(c.cell_id);
  const conf = c.confidence[hz];
  const pts = c.hist.map((h, i) => `${i / (c.hist.length - 1) * 370 + 5},${72 - Math.max(h[hz], 0) / 100 * 62}`).join(' L');
  const nearest = S.routes.filter(r => r.origin_id === c.id && !r.unassigned);

  const feat = hz === 'flood'
    ? [['Rainfall 24 h', c.rainfall_24h, 'mm'], ['Rainfall 72 h', c.rainfall_72h, 'mm'],
       ['River / danger level', c.river_ratio, ''], ['Soil moisture', c.soil_moisture, ''],
       ['Height above drainage', c.hand_m, 'm'], ['Elevation', c.elevation_m, 'm']]
    : [['Rainfall 24 h', c.rainfall_24h, 'mm'], ['Rainfall 72 h', c.rainfall_72h, 'mm'],
       ['Slope', c.slope_deg, '°'], ['Soil moisture', c.soil_moisture, ''],
       ['Elevation', c.elevation_m, 'm'], ['Height above drainage', c.hand_m, 'm']];

  return dwHead(`H3 Cell · Chamoli District`,
    `Zone ${esc(c.id)} · ${esc(c.name)} ${pill(P.n, P.cls)}`,
    `<div class="m" style="font-size:11.5px;color:var(--t3);margin-top:4px">${esc(c.cell_id)}</div>`) +
  `<div class="dw-b">
    <div class="attr" style="margin-bottom:13px">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
      <span><b>AI-based risk prediction — not an official warning.</b> A high-risk cell does not mean every point inside it is affected.</span></div>

    ${c.degraded.length ? `<div class="note"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <span><b>Degraded input.</b> ${c.degraded.map(d => d.toUpperCase()).join(', ')} is not delivering. River level is missing, so this prediction rests on rainfall and terrain alone and its confidence is reduced accordingly.</span></div>` : ''}

    <div class="sec"><div class="kv">
      <div><div class="k">${esc(HAZ[hz].name)} risk</div><div class="v" style="color:${P.c}">${risk < 0 ? '—' : risk}<span style="font-size:11px;color:var(--t3)">/100</span></div></div>
      <div><div class="k">Probability</div><div class="v m">${c.probability[hz] == null ? '—' : c.probability[hz].toFixed(2)}</div></div>
      <div><div class="k">Confidence</div><div class="v" style="font-size:13px">${risk < 0 ? '—' : confMeter(conf)}</div></div>
      <div><div class="k">Population</div><div class="v m" style="font-size:13.5px">${nf(c.pop)}</div></div>
      ${z ? `<div><div class="k">Priority rank</div><div class="v" style="color:${PRI[z.band].c}">#${z.rank}</div></div>
             <div><div class="k">Time to impact</div><div class="v m" style="font-size:13.5px">${z.time_to_impact_h == null ? '—' : z.time_to_impact_h <= 0 ? 'now' : z.time_to_impact_h + ' h'}</div></div>` : ''}
    </div></div>

    <div class="sec"><div class="sl">Risk trend <span class="m" style="text-transform:none;letter-spacing:0">last 3 hours</span></div>
      <svg viewBox="0 0 380 78" preserveAspectRatio="none" style="width:100%;height:76px;background:var(--card);border:1px solid var(--bd);border-radius:9px">
        <line x1="0" y1="21.6" x2="380" y2="21.6" stroke="#EDF1F6"/>
        <line x1="0" y1="46.4" x2="380" y2="46.4" stroke="#EDF1F6"/>
        <path d="M${pts}" fill="none" stroke="${P.c}" stroke-width="1.8" stroke-linejoin="round"/>
        <circle cx="375" cy="${72 - Math.max(risk, 0) / 100 * 62}" r="3.4" fill="${P.c}"/></svg>
      <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;color:var(--t3)" class="m">
        ${c.hist.map(h => `<span>${h.t} · ${Math.max(h[hz], 0)}</span>`).join('')}</div></div>

    <div class="sec"><div class="sl">Features the model saw</div>
      <div class="kv">${feat.map(([k, v, u]) => `<div><div class="k">${k}</div>
        <div class="v m" style="font-size:13px;color:${v == null ? 'var(--warn)' : 'var(--t1)'}">${v == null ? 'no data' : v + (u ? ' ' + u : '')}</div></div>`).join('')}</div>
      <div style="font-size:11px;color:var(--t3);line-height:15px;margin-top:7px">A missing feature is imputed to the training median and flagged — never to zero. Zero slope is a claim about the world; a missing slope is an absence of information.</div></div>

    ${z ? `<div class="sec"><div class="sl">Exposure <span class="m" style="text-transform:none;letter-spacing:0">§11 framework</span></div>
      <div class="blk">
        <div class="br"><span class="l">Inside the hazard footprint</span><span class="v">${nf(z.people_to_move)}</span></div>
        <div class="bar"><i style="width:${Math.round(z.footprint.frac * 100)}%;background:var(--high)"></i></div>
        <div class="bsc"><span>0</span><span>${Math.round(z.footprint.frac * 100)}% of the cell · ${esc(z.footprint.why)}</span><span>${nf(c.pop)}</span></div>
      </div>
      <div class="blk" style="margin-bottom:0">
        <div class="br"><span class="l">Expected exposed</span><span class="v" style="color:var(--crit)">${nf(z.expected_exposed)}</span></div>
        <div style="font-size:11px;color:var(--t3);line-height:15px">${nf(z.people_to_move)} in footprint × ${c.probability[hz].toFixed(2)} probability. An expected value over the people inside the footprint — not a headcount of people who will be affected.</div>
      </div></div>

    <div class="sec"><div class="sl">Priority contributions <span class="m" style="text-transform:none;letter-spacing:0">sums to ${z.priority_score.toFixed(3)}</span></div>
      <div class="terms">
        ${Object.entries(z.terms).map(([k, t]) => `<div class="term">
          <span class="l">${WLABEL[k]}</span>
          <span class="bx"><i style="width:${Math.round(t.contribution / Math.max(...Object.values(z.terms).map(x => x.contribution)) * 100)}%"></i></span>
          <span class="v">${t.contribution.toFixed(3)}</span></div>`).join('')}
      </div></div>` : ''}

    ${nearest.length ? `<div class="sec"><div class="sl">Assigned shelters</div>
      ${nearest.map(r => {
        const sh = shelterById(r.shelter_id);
        return `<div class="row" onclick="S.shelterSel='${esc(r.shelter_id)}';openDw('shelter')">
          <div class="ri" style="background:var(--pris)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#12447E" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${IC.shelters}</svg></div>
          <div class="g"><div class="n">${esc(r.shelter_name)}</div>
            <div class="s">${nf(r.people)} people · ${r.distance_km} km · ${r.travel_min} min</div></div>
          ${r.before_impact === false ? pill('Late', 'p-crit') : pill('OK', 'p-low')}</div>`;
      }).join('')}</div>` : ''}

    <div class="sec"><div class="sl">Cell timeline</div><div class="hist">
      ${S.timeline.filter(e => e.x.includes(c.name)).slice(0, 5).map((e, i) =>
        `<div class="hi ${i === 0 ? 'h' : ''}"><div class="t">${e.t}</div><div class="x">${e.x}</div></div>`).join('')
        || '<div style="font-size:12px;color:var(--t3)">No events recorded for this cell yet.</div>'}
    </div></div>
  </div>
  <div class="dw-f">
    <button class="b g f" onclick="go('evacuation')">Evacuation plan</button>
    <button class="b p f" onclick="toast('Escalated','Cell ${esc(c.name)} flagged to the district control room. Written to the audit log with your operator ID.','ok');closeDw()">Escalate</button></div>`;
}

/* ── shelter detail ── */
function dwShelter() {
  const s = shelterById(S.shelterSel); if (!s) return '';
  const usedPct = Math.round(s.utilisation * 100);
  const cons = [
    ['Space', Math.max(Math.floor(s.max_capacity * 0.9) - s.current_occupancy, 0), '3.5 m² per person, filled to 90%'],
    ['Water', s.water_days >= 2 ? Math.max(Math.floor(s.max_capacity * 0.9) - s.current_occupancy, 0) : Math.floor(Math.max(Math.floor(s.max_capacity * 0.9) - s.current_occupancy, 0) * s.water_days / 2), `${s.water_days.toFixed(1)} days remaining · 15 L per person per day`],
    ['Food', s.food_days >= 2 ? Math.max(Math.floor(s.max_capacity * 0.9) - s.current_occupancy, 0) : Math.floor(Math.max(Math.floor(s.max_capacity * 0.9) - s.current_occupancy, 0) * s.food_days / 2), `${s.food_days.toFixed(1)} days remaining`],
    ['Medical', Math.max(s.medical_staff * 250 - s.current_occupancy, 0), `${s.medical_staff} trained responder(s) · 1 per 250 people`]
  ];
  const minV = Math.min(...cons.map(c => c[1]));

  return dwHead('Shelter · Carrying Capacity',
    `${esc(s.name)} ${pill(s.operational ? (s.effective_capacity ? 'Usable' : 'Full') : 'Not usable', s.operational ? (s.effective_capacity ? 'p-low' : 'p-med') : 'p-off')}`,
    `<div class="m" style="font-size:12px;color:var(--t3);margin-top:4px">${esc(s.shelter_id)} · reported ${s.reported} IST</div>`) +
  `<div class="dw-b">
    ${!s.operational ? `<div class="note c"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
      <span><b>Not usable — ${esc(s.binding_constraint)}.</b> ${s.hazard_risk >= 60 ? `This shelter sits in a cell scoring ${s.hazard_risk}/100. The nearest shelter to a flooding village is frequently the one on the same floodplain.` : 'The evacuation optimiser excludes it from allocation.'}</span></div>`
    : s.state === 'standby' ? `<div class="note"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
      <span><b>On standby.</b> Not yet activated — effective capacity is halved until an operator confirms activation.</span></div>` : ''}

    <div class="sec"><div class="kv">
      <div><div class="k">Occupancy</div><div class="v m" style="font-size:14px">${nf(s.current_occupancy)} / ${nf(s.max_capacity)}</div></div>
      <div><div class="k">Utilisation</div><div class="v" style="color:${usedPct > 85 ? 'var(--crit)' : 'var(--t1)'}">${usedPct}%</div></div>
      <div><div class="k">Physically free</div><div class="v m" style="font-size:14px">${nf(s.raw_available)}</div></div>
      <div><div class="k">Effective places</div><div class="v m" style="font-size:14px;color:${s.effective_capacity ? 'var(--ok)' : 'var(--crit)'}">${nf(s.effective_capacity)}</div></div>
    </div></div>

    <div class="sec"><div class="sl">Which constraint binds</div>
      ${cons.map(([label, v, note]) => `<div class="blk" style="${v === minV ? 'border-color:var(--high);background:var(--highs)' : ''}">
        <div class="br"><span class="l">${label}${v === minV ? ' &middot; <b style="color:var(--high)">binding</b>' : ''}</span><span class="v" style="color:${v === minV ? 'var(--high)' : 'var(--t1)'}">${nf(v)}</span></div>
        <div class="bar"><i style="width:${Math.min(v / Math.max(...cons.map(c => c[1]), 1) * 100, 100)}%;background:${v === minV ? 'var(--high)' : 'var(--pri)'}"></i></div>
        <div class="bsc"><span>0</span><span>${note}</span><span></span></div></div>`).join('')}
      <div style="font-size:11.5px;color:var(--t2);line-height:16px;margin-top:4px">
        ${s.effective_capacity < s.raw_available
          ? `<b>${esc(s.binding_constraint)}</b> limits this shelter to ${nf(s.effective_capacity)} places though ${nf(s.raw_available)} are physically free. Sending a water tanker releases more places than opening another hall.`
          : 'Space is the binding constraint — every other resource has headroom.'}</div></div>

    <div class="sec"><div class="sl">Operator update</div>
      <div class="g2"><div class="fg"><label>Current occupancy</label>
        <input class="inp" id="occ" type="number" value="${s.current_occupancy}" min="0"></div>
        <div class="fg"><label>Water · days remaining</label>
        <input class="inp" id="wd" type="number" step="0.5" value="${s.water_days}" min="0"></div></div>
      <div class="g2"><div class="fg"><label>Food · days remaining</label>
        <input class="inp" id="fd" type="number" step="0.5" value="${s.food_days}" min="0"></div>
        <div class="fg"><label>Medical staff present</label>
        <input class="inp" id="md" type="number" value="${s.medical_staff}" min="0"></div></div>
      <div style="font-size:11px;color:var(--t3);line-height:15px">Updates are append-only and written to the audit log with your operator ID. They propagate to the capacity engine, the evacuation optimiser and every dashboard within one tick.</div>
    </div>
  </div>
  <div class="dw-f">
    <button class="b g f" onclick="closeDw()">Cancel</button>
    <button class="b p f" onclick="saveShelter('${esc(s.shelter_id)}')">Submit update</button></div>`;
}

function saveShelter(id) {
  /* An operator write. It changes what every other dashboard and the
     public shelter list will show, so it goes through the privilege gate
     and is scope-checked: a shelter operator may update their own shelter
     and no one else's (§7). */
  requirePrivilege('update_shelter_status', `Updating ${id}`, () => {
    const sc = AUTH.session.scope;
    if (sc && !sc.includes(id)) {
      auditLog('denied', `attempted to update ${id}, outside assigned scope`);
      toast('Outside your scope',
        `You are assigned to ${sc.join(', ')}. The update to ${id} was refused and logged.`, 'warn');
      return;
    }
    doSaveShelter(id);
    auditLog('write', `shelter ${id} updated`);
  });
}

function doSaveShelter(id) {
  const s = shelterById(id); if (!s) return;
  const before = s.effective_capacity;
  s.current_occupancy = Math.max(0, +$('occ').value || 0);
  s.water_days = Math.max(0, +$('wd').value || 0);
  s.food_days = Math.max(0, +$('fd').value || 0);
  s.medical_staff = Math.max(0, +$('md').value || 0);
  s.reported = hm();

  const spaceAvail = Math.max(Math.floor(s.max_capacity * 0.9) - s.current_occupancy, 0);
  const cands = {
    space: spaceAvail,
    water: s.water_days >= 2 ? spaceAvail : Math.floor(spaceAvail * s.water_days / 2),
    food: s.food_days >= 2 ? spaceAvail : Math.floor(spaceAvail * s.food_days / 2),
    medical: Math.max(s.medical_staff * 250 - s.current_occupancy, 0)
  };
  let binding = 'space', eff = cands.space;
  for (const k in cands) if (cands[k] < eff) { eff = cands[k]; binding = k; }
  if (!s.operational) { eff = 0; }
  s.effective_capacity = Math.max(eff, 0);
  s.binding_constraint = s.operational ? binding : s.binding_constraint;
  s.utilisation = +(s.current_occupancy / s.max_capacity).toFixed(3);
  s.raw_available = Math.max(s.max_capacity - s.current_occupancy, 0);

  computeRoutes();
  const delta = s.effective_capacity - before;
  log('shelter', `<b>${esc(s.shelter_id)}</b> updated by operator — ${nf(s.current_occupancy)} / ${nf(s.max_capacity)}, limited by ${esc(s.binding_constraint)}`, '#0B6BA8');
  toast('Shelter updated',
    `${esc(s.name)}: ${nf(s.effective_capacity)} effective places, limited by ${esc(s.binding_constraint)}. ` +
    `${delta === 0 ? 'Evacuation plan unchanged.' : delta > 0 ? `${nf(delta)} places released — evacuation plan recalculated.` : `${nf(-delta)} places lost — evacuation plan recalculated.`}`,
    delta < 0 ? 'warn' : 'ok');
  closeDw(); render();
}

/* ── alerts drawer ── */
function dwAlerts() {
  return dwHead(`Official Alerts · ${S.alerts.length} in force`, 'Issued by Indian authorities') +
  `<div class="dw-b">
    <div class="note i"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>
      <span><b>Carried verbatim.</b> Nothing here is produced by this platform's models, and the issuing authority is never removed.</span></div>
    ${S.alerts.map(a => {
      const sc = a.sev === 'Extreme' ? 'p-crit' : a.sev === 'Severe' ? 'p-high' : 'p-med';
      const col = a.sev === 'Extreme' ? '#B3261E' : a.sev === 'Severe' ? '#D2551A' : '#A96700';
      return `<div class="row" style="align-items:flex-start" onclick="go('alerts');closeDw()">
        <div class="ri" style="background:${a.sev === 'Extreme' ? 'var(--crits)' : a.sev === 'Severe' ? 'var(--highs)' : 'var(--warns)'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2.2" stroke-linecap="round">${IC.alerts}</svg></div>
        <div class="g"><div class="n">${esc(a.head)}</div>
          <div class="s">${esc(a.auth)}</div>
          <div class="s m" style="margin-top:3px">${a.t} IST · until ${a.exp}</div></div>
        ${pill(a.sev, sc)}</div>`;
    }).join('')}
  </div>
  <div class="dw-f"><button class="b g f" onclick="closeDw()">Close</button>
    <button class="b p f" onclick="go('alerts');closeDw()">Open alert centre</button></div>`;
}

/* ══════════════════════════════════════════════════════════════════
   CITIZEN INCIDENT REPORT

   What was wrong with this form, and why each of them mattered:

     · The pipeline regenerated the drawer every four seconds, so the
       description a person was typing was deleted under them before they
       could reach Submit. The form was, in practice, unusable. Fixed
       above, by `S.dwTouched`.
     · Every report was filed against `S.cells[0]` whatever the person
       said about where they were, so the operator queue pointed at the
       wrong zone and the cell timeline never showed the report.
     · Report ids were `40230 + length`, and the simulated feed draws its
       own ids from the same range — two different reports could carry
       the same identifier, which in a moderation queue is worse than no
       identifier at all.
     · A validation failure produced a toast in the far corner of the
       screen and left no mark on the field that was wrong.

   The person's own words are the point of the form. They are carried
   verbatim into the queue, into the cell's timeline and into the
   assistant's retrieval index, and they are escaped at every point they
   are displayed — a report is untrusted text from a stranger.
   ══════════════════════════════════════════════════════════════════ */

const REPORT_CATS = ['Water entering houses', 'Road blocked', 'Cracks in ground or building',
  'Landslide or debris fall', 'People stranded', 'Shelter overcrowded',
  'Power or water supply cut', 'Something else'];

/** A fresh id that no report in the store already carries. */
function nextReportId() {
  const used = new Set(S.reports.map(r => r.id));
  let n = 40230 + S.reports.length;
  while (used.has('CR-' + n)) n++;
  return 'CR-' + n;
}

function dwReportForm() {
  const zones = S.cells.slice().sort((a, b) => a.id.localeCompare(b.id));
  const suggested = S.cellSel || (S.cells.length ? S.cells[0].cell_id : '');
  return dwHead('Report an Incident', 'Tell the district administration what you can see') +
  `<div class="dw-b">
    <div class="note i"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
      <span>If anyone is in immediate danger, call <b>112</b> or the district control room on <b>1077</b> first. This form is for situational information.</span></div>

    <div class="fg"><label for="rcat">What is happening</label>
      <select class="inp" id="rcat" onchange="reportCatChanged()">
        ${REPORT_CATS.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>

    <div class="fg" id="rotherwrap" hidden><label for="rother">Say what it is</label>
      <input class="inp" id="rother" placeholder="In your own words" maxlength="80"></div>

    <div class="fg"><label for="rzone">Nearest zone <span style="font-weight:400;color:var(--t3)">so it reaches the right desk</span></label>
      <select class="inp" id="rzone">
        ${zones.map(c => `<option value="${esc(c.cell_id)}" ${c.cell_id === suggested ? 'selected' : ''}>
          ${esc(c.id)} · ${esc(c.name)}</option>`).join('')}</select></div>

    <div class="fg"><label for="rloc">Where exactly</label>
      <input class="inp" id="rloc" placeholder="Village, ward or landmark" maxlength="90"></div>

    <div class="fg"><label for="rdesc">Describe it briefly <span class="req">required</span></label>
      <textarea class="inp" id="rdesc" rows="3" maxlength="600"
        placeholder="What you can see, and roughly how many people are affected."
        oninput="reportCount()"></textarea>
      <div class="fhint"><span id="rerr" class="ferr"></span><span class="m" id="rcount">0 / 600</span></div></div>

    <div class="fg"><label for="rphone">Phone number <span style="font-weight:400;color:var(--t3)">optional</span></label>
      <input class="inp" id="rphone" placeholder="So an officer can call back" maxlength="20"></div>

    <div style="font-size:11.5px;color:var(--t3);line-height:16px">Your report is reviewed by an operator
      before it affects any published risk figure. Verified reports raise the confidence of the
      surrounding cell. Nothing you write here is published to other members of the public.</div>

    <div class="note" style="margin-top:11px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="7" width="18" height="13" rx="3"/><path d="M12 3v4M9 17h6"/></svg>
      <span>Wanted to <b>ask</b> something rather than report it?
        <a href="#" onclick="closeDw();toggleChat();return false">Put the question to the assistant</a> —
        it answers from this platform's own records.</span></div>
  </div>
  <div class="dw-f"><button class="b g f" onclick="closeDw()">Cancel</button>
    <button class="b p f" onclick="submitReport()">Submit report</button></div>`;
}

function reportCatChanged() {
  const w = $('rotherwrap'); if (!w) return;
  w.hidden = $('rcat').value !== 'Something else';
  if (!w.hidden) $('rother').focus();
}

function reportCount() {
  const t = $('rdesc'), c = $('rcount'); if (!t || !c) return;
  c.textContent = `${t.value.length} / 600`;
  if (t.value.trim()) { $('rerr').textContent = ''; t.classList.remove('bad'); }
}

function submitReport() {
  const catSel = $('rcat').value;
  const other = $('rother') ? $('rother').value.trim() : '';
  const cat = catSel === 'Something else' && other ? other : catSel;
  const loc = $('rloc').value.trim() || 'Location not given';
  const desc = $('rdesc').value.trim();
  const phone = $('rphone').value.trim();
  const cellId = $('rzone') ? $('rzone').value : (S.cells[0] && S.cells[0].cell_id);

  if (!desc) {
    /* The error belongs next to the field that caused it. */
    $('rerr').textContent = 'Tell the operator what you can see.';
    $('rdesc').classList.add('bad');
    $('rdesc').focus();
    say('A description is required');
    return;
  }

  const cell = cellById(cellId);
  const id = nextReportId();
  S.reports.unshift({
    id, cat, loc, cell: cellId, desc, phone: phone || null,
    t: hm(), age: 0, st: 'pending', by: null, src: 'citizen'
  });

  log('report', `Citizen report <b>${esc(id)}</b> received from ${esc(cell ? cell.name : loc)} — ` +
      `${esc(cat)}, awaiting verification`, '#0B6BA8');
  /* The assistant answers from the platform's records, and this is now
     one of them. */
  if (typeof markRagDirty === 'function') markRagDirty();

  closeDw();
  toast('Report received',
    `${id} is in the moderation queue for ${cell ? cell.name : loc}. An operator reviews it before ` +
    `it affects any published figure.` + (phone ? ' An officer may call the number you gave.' : ''), 'ok');
  say('Report ' + id + ' submitted');
  /* Repaint in place: the reader stays exactly where they were on the
     page rather than being thrown back to the top of it. */
  if (typeof syncRender === 'function') syncRender(); else render();
}

/* ── public state drawer ── */
function dwPubState() {
  const st = S.states[S.mapFocus]; if (!st) return '';
  const P = PRI[lvl(st.risk)];
  const open = S.shelters.filter(s => s.operational && s.effective_capacity > 0);
  return dwHead(esc(st.name), `${esc(st.district)} ${pill(P.n, P.cls)}`) +
  `<div class="dw-b">
    <div class="note c"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
      <span><b>${esc(S.alerts[0].head)}</b> — ${esc(S.alerts[0].auth)}.</span></div>
    <div class="sec"><div class="sl">Situation</div>
      <div style="font-size:13px;color:var(--t2);line-height:20px">${esc(st.note)}</div></div>
    <div class="sec"><div class="sl">Shelters with space near you</div>
      ${open.slice(0, 5).map(s => `<div class="row">
        <div class="ri" style="background:var(--oks)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1B7F3B" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${IC.shelters}</svg></div>
        <div class="g"><div class="n">${esc(s.name)}</div><div class="s">${nf(s.effective_capacity)} places available</div></div>
        ${pill('Open', 'p-low')}</div>`).join('')}</div>
    <div class="sec"><div class="sl">What to do now</div>
      <ul style="list-style:none;padding:0;margin:0">
        ${['Move to higher ground away from the riverbank.',
           'Do not cross flowing water on foot or by vehicle.',
           'Keep away from the base of cut slopes on NH-7.',
           'Carry identity documents and any medicines you need.',
           'Call 1077 for the district control room, or 112 in an emergency.']
          .map(t => `<li style="font-size:13px;color:var(--t2);line-height:20px;padding-left:16px;position:relative;margin-bottom:5px">
            <span style="position:absolute;left:0;top:8px;width:5px;height:5px;border-radius:50%;background:var(--pri)"></span>${t}</li>`).join('')}</ul></div>
  </div>
  <div class="dw-f"><button class="b g f" onclick="closeDw()">Close</button>
    <button class="b p f" onclick="closeDw();openDw('report')">Report an incident</button></div>`;
}

/* ══════════════════════════════════════════════════════════════════
   MODALS
   ══════════════════════════════════════════════════════════════════ */
function openM(k) { $('mdlc').innerHTML = mdlHTML(k); $('scr').classList.add('on'); }
/* Open a modal from HTML the caller composed, rather than from a key. */
function openMHTML(html) {
  $('mdlc').innerHTML = `<div class="mdl">${html}</div>`;
  $('scr').classList.add('on');
  const f = $('scr').querySelector('input,button,[tabindex]');
  if (f) setTimeout(() => f.focus(), 40);
}
function closeM() { $('scr').classList.remove('on'); }

function mdlHTML(k) {
  if (k === 'critical') {
    const z = S.priorities[0];
    return `<div class="mdl cr">
      <div class="mh">
        <div class="mi" style="background:var(--crits)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B3261E" stroke-width="2.2" stroke-linecap="round">${IC.alerts}</svg></div>
        <div style="flex:1">
          <div class="mt">Critical risk — ${esc(z ? z.name : 'Chamoli')}</div>
          <div class="ms">Flood risk ${z ? z.risk : 94}/100 with ${z ? nf(z.expected_exposed) : '4,100'} people expected to be exposed. Ranked first for relocation.</div></div></div>
      <div class="mb">
        <div class="attr" style="margin-bottom:12px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
          <span><b>This is a model prediction, not an official warning.</b> The official warnings in force are from IMD Dehradun and the Central Water Commission — see Official Alerts.</span></div>
        <div class="kv" style="margin-bottom:12px">
          <div><div class="k">Priority score</div><div class="v" style="color:var(--crit)">${z ? z.priority_score.toFixed(3) : '0.812'}</div></div>
          <div><div class="k">People in footprint</div><div class="v m">${z ? nf(z.people_to_move) : '4,463'}</div></div>
          <div><div class="k">Time to impact</div><div class="v m">${z && z.time_to_impact_h != null ? (z.time_to_impact_h <= 0 ? 'now' : z.time_to_impact_h + ' h') : 'now'}</div></div>
          <div><div class="k">Confidence</div><div class="v m">${z ? Math.round(z.confidence * 100) : 84}%</div></div>
        </div>
        <div class="sl">Why it ranks first</div>
        <ul style="list-style:none;padding:0;margin:0">
          ${(z ? z.reasons : ['High predicted hazard probability']).map(r =>
            `<li style="font-size:13px;color:var(--t2);line-height:20px;padding-left:16px;position:relative;margin-bottom:4px">
              <span style="position:absolute;left:0;top:8px;width:5px;height:5px;border-radius:50%;background:var(--crit)"></span>${esc(r)}</li>`).join('')}
        </ul></div>
      <div class="mf">
        <button class="b g" onclick="closeM()">Dismiss</button>
        <button class="b d" onclick="closeM();S.cellSel='${esc(z ? z.cell_id : S.cells[0].cell_id)}';openDw('cell')">Open the cell</button></div></div>`;
  }
  return '';
}

/* ══════════════════════════════════════════════════════════════════
   COMMAND PALETTE
   ══════════════════════════════════════════════════════════════════ */
const PAL = [
  ['Navigate', [['GIS Risk Map', "go('map')"], ['Hazard Cells', "go('cells')"],
                ['Relocation Priority', "go('priority')"], ['Population Exposure', "go('exposure')"],
                ['Shelters & Capacity', "go('shelters')"], ['Evacuation Routes', "go('evacuation')"],
                ['Official Alerts', "go('alerts')"], ['Road Status', "go('roads')"],
                ['Data Sources', "go('sources')"], ['Model Monitoring', "go('model')"]]],
  ['Hazard layer', [['Flood risk', "setHazard('flood')"], ['Landslide risk', "setHazard('landslide')"]]],
  ['Actions', [['Run divide-and-conquer sweep', 'runSweep()'],
               ['Focus highest-risk state', 'focusCritical()'],
               ['Zoom out to India', 'mapHome()'],
               ['Leave Command · sign out', "requestRole('citizen')"],
               ['Official sign-in · Command', "requestRole('gov')"]]]
];
function openPal() { $('pscr').classList.add('on'); $('palq').value = ''; renderPal(); setTimeout(() => $('palq').focus(), 40); }
function closePal() { $('pscr').classList.remove('on'); $('q').blur(); }
function renderPal() {
  const q = ($('palq').value || '').toLowerCase();
  $('pallist').innerHTML = PAL.map(([g, items]) => {
    const hits = items.filter(([l]) => l.toLowerCase().includes(q));
    if (!hits.length) return '';
    return `<div class="pgr">${g}</div>` + hits.map(([l, fn]) =>
      `<button class="pit" onclick="closePal();${fn}"><span class="g">${l}</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></button>`).join('');
  }).join('') || `<div class="empty"><b>No match</b><span>Nothing matches “${esc($('palq').value)}”.</span></div>`;
}

/* fontStep lives in src/ui.js and toggleChat in src/rag.js — both do
   materially more than the stubs that used to sit here. */
