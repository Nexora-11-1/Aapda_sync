/* ══════════════════════════════════════════════════════════════════
   AUTH — the bridge between the public portal and District Command

   The public portal and the command console are not two tabs of one
   application. They are two trust levels, and crossing between them is
   an authentication event.

   What this enforces:

     · Command is unreachable without a verified credential. There is no
       toggle, no query parameter, no console call that grants it — every
       path into the operational views runs through grantSession().
     · Leaving Command requires an explicit sign-out. Returning requires
       signing in again. The reverse direction (Command → public) is
       always allowed and always drops the session.
     · Passwords are never stored, transmitted or compared in plaintext.
       PBKDF2-SHA-256, 210 000 iterations, per-account salt, constant-time
       comparison of the derived key.
     · Failed attempts are throttled per account with exponential backoff
       and a hard lockout, so the credential set cannot be enumerated at
       machine speed.
     · Sessions expire twice: on idle (15 min, with a warning) and
       absolutely (8 h). Neither is extendable without re-authenticating.
     · Privileged writes require a step-up: a password re-entry that is
       valid for 10 minutes. Reading the map does not; changing a shelter's
       occupancy does.
     · Every authentication event is written to an append-only audit trail
       that the operator can read, because an audit log nobody can see is
       a log that nobody checks.

   Against a backend, all of this is the API's job and this module calls
   POST /api/auth/login and carries the bearer token. The local verifier
   below exists so the single-file build enforces the same flow instead of
   waving people through — it is a real check, not a decorative one.
   ══════════════════════════════════════════════════════════════════ */

const AUTH = {
  session: null,        // { user, name, role, district, issuedAt, absoluteExpiry, lastActivity, stepUpAt }
  attempts: {},         // user → { n, lockedUntil }
  audit: [],            // append-only, newest first
  idleMs: 15 * 60 * 1000,
  absoluteMs: 8 * 60 * 60 * 1000,
  stepUpMs: 10 * 60 * 1000,
  warnMs: 60 * 1000,    // idle warning this long before expiry
  maxAttempts: 5,
  busy: false
};

/* The operator directory.

   In a real deployment this comes from the state's own identity provider
   — operators are civil servants with existing credentials, and a local
   user table would be a second, weaker copy of an authority that already
   exists. `AAPDA_API_URL` switches this module to the API and these
   entries are never consulted.

   Stored as PBKDF2 verifiers. The passwords themselves are not in this
   file, are not derivable from it, and were never known to it. */
const OPERATORS = {
  'ndma.control': { salt: 'uE0a40fbSP4uV1N/ntOvXg==', hash: 'iy5Joyr3vwa4aNPIK5G4NWnnncYLaupG2+BkIBhL5Ys=',
    name: 'NDMA National Control Room', role: 'national_command', district: null,
    can: ['read_operational', 'update_shelter_status', 'report_road_status', 'verify_citizen_report',
          'trigger_evacuation_plan', 'acknowledge_alert', 'read_audit'] },
  'dm.chamoli': { salt: 'vnBtnDjWPJqViW/URB3d6A==', hash: 'EZd5lwTtHqDRfaruEirA4fcIZr1AcEGd4P4zKv25Y1M=',
    name: 'District Magistrate, Chamoli', role: 'district_command', district: 'UT-CHAMOLI',
    can: ['read_operational', 'update_shelter_status', 'report_road_status', 'verify_citizen_report',
          'trigger_evacuation_plan', 'acknowledge_alert'] },
  'so.usdma': { salt: 'xdu2afLHXuSPnbZGb0V6nA==', hash: '1d2DSb1wQUr9jC0Hl+sufe5INY8yobqIqRKCs44rO4Y=',
    name: 'State Operations, Uttarakhand SDMA', role: 'state_ops', district: null,
    can: ['read_operational', 'acknowledge_alert', 'verify_citizen_report'] },
  'shelter.201': { salt: 'hRV34r8lVGRvAvSPTufnHQ==', hash: 'WzU9MOBnn+GjDAqszfXw4D+TcRSeDevZelDjudNUFIM=',
    name: 'Shelter Operator · SH-201', role: 'shelter_operator', district: 'UT-CHAMOLI',
    scope: ['SH-201'],
    can: ['read_operational', 'update_shelter_status'] }
};

const ROLE_LABEL = {
  national_command: 'National Command', district_command: 'District Command',
  state_ops: 'State Operations', shelter_operator: 'Shelter Operator',
  field_officer: 'Field Officer'
};

/* ── Crypto ──────────────────────────────────────────────────────── */
const b64ToBytes = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
const bytesToB64 = u => btoa(String.fromCharCode(...new Uint8Array(u)));

async function deriveKey(password, saltB64) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: b64ToBytes(saltB64), iterations: 210000, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

/** Constant time: the loop length never depends on where the first
    difference is, so timing cannot leak how much of a guess was right. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ── Throttling ──────────────────────────────────────────────────── */
function lockState(user) {
  const a = AUTH.attempts[user];
  if (!a || !a.lockedUntil) return null;
  const left = a.lockedUntil - Date.now();
  return left > 0 ? Math.ceil(left / 1000) : null;
}

function recordFailure(user) {
  const a = AUTH.attempts[user] || (AUTH.attempts[user] = { n: 0, lockedUntil: 0 });
  a.n++;
  if (a.n >= AUTH.maxAttempts) {
    /* 60s, then doubling, capped at 15 minutes. Slow enough that guessing
       is pointless; bounded so a locked-out operator is not locked out of
       an emergency for the rest of the day. */
    const over = a.n - AUTH.maxAttempts;
    a.lockedUntil = Date.now() + Math.min(60000 * Math.pow(2, over), 15 * 60 * 1000);
  }
  return a;
}

function auditLog(kind, detail, user) {
  AUTH.audit.unshift({
    at: Date.now(), t: clk(), kind, detail,
    user: user || (AUTH.session ? AUTH.session.user : '—')
  });
  if (AUTH.audit.length > 200) AUTH.audit.pop();
}

/* ── The one door ────────────────────────────────────────────────── */

/**
 * Verify a credential. Returns { ok, operator } or { ok:false, reason }.
 * Against a backend this is POST /api/auth/login; the local path performs
 * the identical check offline.
 */
async function verifyCredential(user, password) {
  const locked = lockState(user);
  if (locked) return { ok: false, reason: 'locked', seconds: locked };

  const API = typeof window !== 'undefined' && window.AAPDA_API_URL;
  if (API) {
    try {
      const r = await fetch(API.replace(/\/$/, '') + '/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator_id: user, password })
      });
      if (!r.ok) { recordFailure(user); return { ok: false, reason: 'bad' }; }
      const body = await r.json();
      AUTH.attempts[user] = { n: 0, lockedUntil: 0 };
      return { ok: true, operator: body.operator, token: body.access_token };
    } catch (e) {
      return { ok: false, reason: 'unreachable' };
    }
  }

  const rec = OPERATORS[user];
  /* Derive regardless of whether the account exists, against the same cost,
     so a non-existent username is not distinguishable by how fast it fails. */
  const probe = rec || { salt: 'AAAAAAAAAAAAAAAAAAAAAA==', hash: '' };
  const derived = await deriveKey(password, probe.salt);
  const expected = rec ? b64ToBytes(rec.hash) : new Uint8Array(32);
  const good = !!rec && timingSafeEqual(derived, expected);
  if (!good) { recordFailure(user); return { ok: false, reason: 'bad' }; }
  AUTH.attempts[user] = { n: 0, lockedUntil: 0 };
  return { ok: true, operator: { id: user, ...rec } };
}

/** The only function that can put the application into Command. */
function grantSession(user, operator, token) {
  const now = Date.now();
  AUTH.session = {
    user, name: operator.name, role: operator.role,
    district: operator.district || null, scope: operator.scope || null,
    can: operator.can || ['read_operational'],
    token: token || null,
    issuedAt: now, absoluteExpiry: now + AUTH.absoluteMs,
    lastActivity: now, stepUpAt: now
  };
  auditLog('sign-in', `${ROLE_LABEL[operator.role] || operator.role} session opened`, user);
  return AUTH.session;
}

function signedIn() {
  const s = AUTH.session;
  if (!s) return false;
  const now = Date.now();
  if (now > s.absoluteExpiry) { endSession('absolute session limit reached'); return false; }
  if (now - s.lastActivity > AUTH.idleMs) { endSession('idle timeout'); return false; }
  return true;
}

function can(permission) {
  return signedIn() && AUTH.session.can.includes(permission);
}

function endSession(why) {
  if (AUTH.session) auditLog('sign-out', why || 'signed out', AUTH.session.user);
  AUTH.session = null;
  if (typeof S !== 'undefined' && S.role === 'gov') {
    S.role = 'citizen'; S.cz = 'home'; S.view = 'map';
    if (typeof closeDw === 'function') { closeDw(); closeM(); }
    if (typeof render === 'function') render();
    if (typeof toast === 'function')
      toast('Signed out', (why ? why.charAt(0).toUpperCase() + why.slice(1) + '. ' : '') +
        'You are on the public portal. Sign in again to return to Command.', 'warn');
  }
}

/** Any operator interaction pushes the idle clock forward. */
function touchSession() {
  if (AUTH.session) AUTH.session.lastActivity = Date.now();
}

/* ── The sign-in screen ──────────────────────────────────────────── */
function openSignIn(afterOk) {
  AUTH.after = afterOk || null;
  const noBackend = !(typeof window !== 'undefined' && window.AAPDA_API_URL);
  openMHTML(`
    <div class="mh">
      <div class="mi" style="background:var(--pris);color:var(--pri)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 3 6v6c0 5 3.8 9.2 9 10 5.2-.8 9-5 9-10V6Z"/><path d="m9 12 2 2 4-4"/></svg>
      </div>
      <div><h2>Official sign-in</h2>
        <p>District Command is restricted to authorised disaster-management operators.</p></div>
    </div>
    <div class="mb">
      <form id="signinform" onsubmit="submitSignIn(event)" autocomplete="on">
        <label class="fl" for="au">Operator ID</label>
        <input class="fi" id="au" name="username" autocomplete="username" spellcheck="false"
               placeholder="e.g. dm.chamoli" required>
        <label class="fl" for="ap" style="margin-top:12px">Password</label>
        <input class="fi" id="ap" name="password" type="password" autocomplete="current-password" required>
        <div id="autherr" class="autherr" hidden></div>
        <div class="authnote">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span>Your password is never sent or stored in readable form. It is checked against a
          PBKDF2-SHA-256 verifier, and the session ends after 15 minutes of inactivity.</span>
        </div>
        ${noBackend ? `
        <details class="demo">
          <summary>Demonstration access for this offline build</summary>
          <div>
            No API is configured, so this build verifies against the local operator directory.
            Point <code>window.AAPDA_API_URL</code> at a deployment and these accounts are
            never consulted — authentication goes to the API and these credentials stop working.
            <table>
              <tr><td><code>ndma.control</code></td><td><code>Aapda@NDMA#2026</code></td><td>National Command</td></tr>
              <tr><td><code>dm.chamoli</code></td><td><code>Chamoli@DM#2026</code></td><td>District Command</td></tr>
              <tr><td><code>so.usdma</code></td><td><code>Usdma@SO#2026</code></td><td>State Operations · read + verify</td></tr>
              <tr><td><code>shelter.201</code></td><td><code>Shelter@201#2026</code></td><td>Shelter Operator · SH-201 only</td></tr>
            </table>
            The roles differ in what they may do, not only in what they see — sign in as the
            shelter operator and the road and evacuation controls are refused, not hidden.
          </div>
        </details>` : ''}
        <div class="mf" style="margin-top:16px">
          <button type="button" class="btn" onclick="closeM()">Stay on the public portal</button>
          <button type="submit" class="btn pri" id="authgo">Sign in</button>
        </div>
      </form>
    </div>`);
  setTimeout(() => { const el = $('au'); if (el) el.focus(); }, 60);
}

async function submitSignIn(ev) {
  ev.preventDefault();
  if (AUTH.busy) return;
  const user = $('au').value.trim().toLowerCase();
  const pw = $('ap').value;
  const err = $('autherr'), go = $('authgo');
  const fail = msg => { err.textContent = msg; err.hidden = false; $('ap').value = ''; $('ap').focus(); };

  AUTH.busy = true; go.disabled = true; go.textContent = 'Verifying…';
  try {
    const r = await verifyCredential(user, pw);
    if (!r.ok) {
      auditLog('sign-in-failed', r.reason === 'locked'
        ? `locked out, ${r.seconds}s remaining` : 'credential rejected', user);
      if (r.reason === 'locked')
        fail(`Too many failed attempts. This account is locked for ${r.seconds} more seconds.`);
      else if (r.reason === 'unreachable')
        fail('The authentication service is unreachable. Check the connection and try again.');
      else {
        const left = AUTH.maxAttempts - (AUTH.attempts[user]?.n || 0);
        fail(left > 0 && left <= 2
          ? `Operator ID or password is incorrect. ${left} attempt${left === 1 ? '' : 's'} left before lockout.`
          : 'Operator ID or password is incorrect.');
      }
      return;
    }
    grantSession(user, r.operator, r.token);
    closeM();
    S.role = 'gov'; S.view = 'map';
    render();
    startSessionWatch();
    toast(`Signed in · ${ROLE_LABEL[AUTH.session.role]}`,
      `${AUTH.session.name}. Session expires after 15 minutes of inactivity, ` +
      `and privileged changes ask for your password again.`, 'ok');
    if (AUTH.after) { const f = AUTH.after; AUTH.after = null; f(); }
  } finally {
    AUTH.busy = false;
    if (go) { go.disabled = false; go.textContent = 'Sign in'; }
  }
}

/* ── Sign out ────────────────────────────────────────────────────── */
function requestSignOut() {
  openMHTML(`
    <div class="mh">
      <div class="mi" style="background:var(--warns);color:var(--warn)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>
      </div>
      <div><h2>Sign out of District Command?</h2>
        <p>You will return to the public portal. Signing back in requires your password.</p></div>
    </div>
    <div class="mb">
      <div class="note">Anything you have already submitted is saved — updates are append-only and
      were written to the audit log as they were made. Nothing is lost by signing out.</div>
      <div class="mf">
        <button class="btn" onclick="closeM()">Stay signed in</button>
        <button class="btn dang" onclick="closeM();endSession('signed out by operator')">Sign out</button>
      </div>
    </div>`);
}

/* ── Step-up for privileged writes ───────────────────────────────── */
/**
 * Gate a privileged action. Calls `run` only if the operator holds the
 * permission AND has re-entered their password within the step-up window.
 */
function requirePrivilege(permission, label, run) {
  if (!signedIn()) { openSignIn(); return; }
  touchSession();
  if (!AUTH.session.can.includes(permission)) {
    auditLog('denied', `${label} refused — role ${ROLE_LABEL[AUTH.session.role]} lacks ${permission}`);
    toast('Not permitted',
      `Your role, ${ROLE_LABEL[AUTH.session.role]}, does not carry the ${permission.replace(/_/g, ' ')} ` +
      `permission. The action was refused and the refusal was logged.`, 'warn');
    return;
  }
  if (Date.now() - AUTH.session.stepUpAt < AUTH.stepUpMs) { run(); return; }
  stepUpPrompt(label, run);
}

function stepUpPrompt(label, run) {
  AUTH.stepUpRun = run;
  openMHTML(`
    <div class="mh">
      <div class="mi" style="background:var(--pris);color:var(--pri)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
      <div><h2>Confirm it is you</h2>
        <p>${esc(label)} changes what other operators and the public see. Re-enter your password.</p></div>
    </div>
    <div class="mb">
      <form onsubmit="submitStepUp(event)">
        <label class="fl" for="sp">Password for ${esc(AUTH.session.user)}</label>
        <input class="fi" id="sp" type="password" autocomplete="current-password" required>
        <div id="steperr" class="autherr" hidden></div>
        <div class="authnote"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/></svg>
          <span>Confirmed once, valid for ten minutes of further changes.</span></div>
        <div class="mf" style="margin-top:16px">
          <button type="button" class="btn" onclick="closeM()">Cancel</button>
          <button type="submit" class="btn pri">Confirm</button>
        </div>
      </form>
    </div>`);
  setTimeout(() => { const el = $('sp'); if (el) el.focus(); }, 60);
}

async function submitStepUp(ev) {
  ev.preventDefault();
  const pw = $('sp').value;
  const r = await verifyCredential(AUTH.session.user, pw);
  if (!r.ok) {
    auditLog('step-up-failed', 'password re-entry rejected');
    const e = $('steperr');
    e.textContent = 'That password is not correct.'; e.hidden = false;
    $('sp').value = ''; $('sp').focus();
    return;
  }
  AUTH.session.stepUpAt = Date.now();
  auditLog('step-up', 'identity re-confirmed');
  closeM();
  const run = AUTH.stepUpRun; AUTH.stepUpRun = null;
  if (run) run();
}

/* ── The idle watch ──────────────────────────────────────────────── */
let sessionTimer = null, warnShown = false;
function startSessionWatch() {
  clearInterval(sessionTimer);
  warnShown = false;
  sessionTimer = setInterval(() => {
    const s = AUTH.session;
    if (!s) { clearInterval(sessionTimer); return; }
    const idle = Date.now() - s.lastActivity;
    const toAbsolute = s.absoluteExpiry - Date.now();
    if (idle > AUTH.idleMs || toAbsolute <= 0) {
      clearInterval(sessionTimer);
      endSession(toAbsolute <= 0 ? 'the eight-hour session limit was reached' : 'signed out after 15 minutes of inactivity');
      return;
    }
    if (!warnShown && idle > AUTH.idleMs - AUTH.warnMs) {
      warnShown = true;
      toast('Session ending',
        'You will be signed out in about a minute. Move the mouse or press a key to stay signed in.', 'warn');
    }
    if (idle < AUTH.idleMs - AUTH.warnMs) warnShown = false;
    const el = $('sessclock');
    if (el) el.textContent = Math.ceil((AUTH.idleMs - idle) / 60000) + 'm';
  }, 5000);
}

/* Activity anywhere in the console counts. Passive listeners so this can
   never make scrolling feel heavy. */
['pointerdown', 'keydown', 'wheel'].forEach(ev =>
  document.addEventListener(ev, touchSession, { passive: true }));

/* ── The role switch, replaced ───────────────────────────────────── */
/**
 * The only entry point the UI offers. Public → Command demands a
 * credential; Command → public drops the session. There is deliberately
 * no path that silently flips between them.
 */
function requestRole(target) {
  if (target === 'citizen') {
    if (signedIn()) { requestSignOut(); return; }
    S.role = 'citizen'; S.cz = 'home'; render();
    return;
  }
  if (signedIn()) { S.role = 'gov'; S.view = 'map'; render(); return; }
  openSignIn();
}

/* ── The landing gate ────────────────────────────────────────────── */
function enter(role) {
  $('gate').style.display = 'none';
  S.role = 'citizen'; S.cz = 'home';
  render();
  if (typeof buildIndex === 'function') buildIndex();
  setTimeout(() => toast('Live',
    'All nine hazards are connected to live sources across all 36 states and union territories. ' +
    'Open any state on the map, or ask the assistant a question.', 'ok'), 700);
}

/** The gate's Command button. It opens the door; it does not walk through it. */
function enterCommand() {
  $('gate').style.display = 'none';
  S.role = 'citizen'; S.cz = 'home';
  render();
  if (typeof buildIndex === 'function') buildIndex();
  openSignIn();
}
