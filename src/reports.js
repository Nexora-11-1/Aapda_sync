/* ============================================================================
   AapdaSync — reports.js
   ---------------------------------------------------------------------------
   Citizen reporting from the public view.

   The design question here is not "how do we collect reports" — a form is a
   form. It is what a report is allowed to DO when it arrives, and the answer
   this prototype gives is: nothing, until a named operator says otherwise.

   A citizen report is an OBSERVATION, not an input. It never touches HEI, VCI,
   capacity, RUI or the assignment. Those are derived from the district record
   in data.js and stay derived from it. What a report does is enter the
   unverified queue, where an operator either confirms it — posting a VERIFY
   entry to the ledger under their own ID — or dismisses it with a reason.

   That restraint is the point. A system where anyone with a phone can move the
   numbers that decide who gets evacuated is a system with an obvious attack,
   and in a real emergency it does not even need an attacker: panic, rumour and
   double-reporting will do it. Ten people reporting the same collapsed wall is
   one wall. So reports queue, and a person is accountable for each one that
   becomes true.

   Two clocks, kept separate, because a citizen in a disaster is exactly the
   person whose phone has no signal:
     capturedAt — when they say they saw it
     receivedAt — when it reached the system
   Reports sort by capture. A report seen at 06:10 and sent at 09:40 belongs in
   the timeline at 06:10, or the sequence of an unfolding event is wrong.
   ========================================================================== */

'use strict';

var REPORTS = (function () {

  var KEY = 'aapdasync.reports.v1';
  var mine = [];              // reports submitted from THIS browser
  var storageOK = true;

  /* What a citizen can pick. Deliberately short and in the words someone would
     actually use — "I can smell gas or chemicals", not "MAH off-site release".
     `kind` maps onto the same hazard keys the rest of the app uses so a report
     can be filtered beside field reports without translation. */
  var KINDS = [
    { k: 'flood',   label: 'Water rising',        hint: 'flooding, a river or drain over its bank' },
    { k: 'slide',   label: 'Ground moving',       hint: 'landslide, cracks, a slope giving way' },
    { k: 'infra',   label: 'Building damaged',    hint: 'a wall, roof or structure failing' },
    { k: 'mah',     label: 'Gas or chemical smell', hint: 'a smell, fumes, a leak' },
    { k: 'road',    label: 'Road blocked',        hint: 'debris, water or a collapse cutting a route' },
    { k: 'medical', label: 'People trapped or hurt', hint: 'someone who cannot get out or needs help' },
    { k: 'warning', label: 'Warning did not reach us', hint: 'no siren, no message, no announcement' },
    { k: 'social',  label: 'Something else',      hint: '' }
  ];

  /* When they saw it, in hours before now. Offered as choices rather than a
     time picker: someone reporting a collapsing wall is not going to operate a
     time picker, and "about an hour ago" is the honest precision anyway. */
  var WHENS = [
    { k: 'now',    label: 'Just now',        hrs: 0 },
    { k: 'hour',   label: 'Within the hour', hrs: 1 },
    { k: 'today',  label: 'Earlier today',   hrs: 6 },
    { k: 'before', label: 'Yesterday or before', hrs: 30 }
  ];

  function kinds() { return KINDS.slice(); }
  function whens() { return WHENS.slice(); }
  function kindLabel(k) {
    var m = KINDS.filter(function (x) { return x.k === k; })[0];
    return m ? m.label : 'Something else';
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) mine = JSON.parse(raw) || [];
    } catch (e) {
      /* Private window, blocked site data, file:// quirks. The session still
         works; the reports just do not survive a reload. Said out loud on the
         receipt rather than discovered later. */
      storageOK = false; mine = [];
    }
    if (!Array.isArray(mine)) mine = [];
    return mine;
  }

  function persist() {
    if (!storageOK) return false;
    try { localStorage.setItem(KEY, JSON.stringify(mine)); return true; }
    catch (e) { storageOK = false; return false; }
  }

  /* Reference the reporter can quote on the phone. CR for citizen report, so it
     is distinguishable at a glance from FR field reports in the same queue —
     an operator triaging fifty items should not have to look up who sent each
     one to know how much it has been checked. */
  function nextRef() {
    var n = 1 + mine.length;
    for (var i = 0; i < 400; i++) {
      var ref = 'CR-' + String(n + i).padStart(4, '0');
      if (!SIM.reports.some(function (r) { return r.id === ref; })) return ref;
    }
    return 'CR-' + Date.now().toString().slice(-4);
  }

  function hoursAgoLabel(hrs) {
    if (hrs <= 0) return 'now';
    return '-' + String(Math.floor(hrs)).padStart(2, '0') + ':00';
  }

  /* Validation returns every problem at once, not the first one. A form that
     reveals its objections one at a time is a form people abandon. */
  function check(f) {
    var errs = [];
    if (!f.hab) errs.push('Choose which habitation this is about.');
    if (!f.kind) errs.push('Choose what you can see.');
    if (!f.text || f.text.trim().length < 8) errs.push('Describe what you can see, in a few words at least.');
    if (f.text && f.text.length > 600) errs.push('Keep the description under 600 characters.');
    if (f.persons !== '' && f.persons != null && !(Number(f.persons) >= 0 && Number(f.persons) < 100000)) {
      errs.push('People affected must be a number, or left blank.');
    }
    if (f.contact && !/^[0-9+\-\s()]{6,20}$/.test(f.contact)) {
      errs.push('A contact number should be 6–20 digits, or left blank.');
    }
    return errs;
  }

  function submit(f) {
    var errs = check(f);
    if (errs.length) return { ok: false, errors: errs };

    var w = WHENS.filter(function (x) { return x.k === f.when; })[0] || WHENS[0];
    var now = new Date();
    var captured = new Date(now.getTime() - w.hrs * 3600 * 1000);
    var hab = (ENG.STATE.habs || []).filter(function (h) { return h.id === f.hab; })[0];
    var ref = nextRef();

    var rec = {
      id: ref,
      at: hoursAgoLabel(w.hrs),
      hab: f.hab,
      habName: hab ? hab.name : f.hab,
      text: f.text.trim(),
      by: 'Citizen (public form)',
      status: 'unverified',
      kind: f.kind,
      kindLabel: kindLabel(f.kind),
      persons: f.persons === '' || f.persons == null ? null : Number(f.persons),
      landmark: (f.landmark || '').trim(),
      contact: (f.contact || '').trim(),
      capturedAt: captured.toISOString(),
      receivedAt: now.toISOString(),
      citizen: true
    };

    /* Into the same queue the field reports live in, at the top, so it is
       visible to an operator immediately — as unverified. */
    SIM.reports.unshift(rec);
    mine.unshift({ id: ref, hab: rec.hab, habName: rec.habName, kind: rec.kind,
                   text: rec.text, receivedAt: rec.receivedAt });
    if (mine.length > 40) mine.length = 40;
    var saved = persist();

    return { ok: true, ref: ref, record: rec, persisted: saved };
  }

  /* Status is read back off SIM.reports rather than copied into `mine`, so a
     report the operator verifies updates in the citizen's own list without any
     syncing. One source of truth, two views of it. */
  function statusOf(ref) {
    var r = SIM.reports.filter(function (x) { return x.id === ref; })[0];
    return r ? r : null;
  }

  function mineList() {
    return mine.map(function (m) {
      var live = statusOf(m.id);
      return {
        id: m.id, habName: m.habName, kind: m.kind, text: m.text,
        receivedAt: m.receivedAt,
        status: live ? live.status : 'unknown',
        note: live ? (live.verifyNote || '') : '',
        by: live ? (live.verifiedBy || '') : ''
      };
    });
  }

  function count() { return mine.length; }
  function clear() { mine = []; persist(); }

  /* Sort key for any report, citizen or field. Older entries carry a relative
     `at` string like "-01:22"; new ones carry a real capturedAt. Both reduce to
     hours-before-now so one timeline can hold both. */
  function capturedHoursAgo(r) {
    if (r.capturedAt) return (Date.now() - new Date(r.capturedAt).getTime()) / 3600000;
    var m = /^-(\d+):(\d+)$/.exec(r.at || '');
    if (m) return Number(m[1]) + Number(m[2]) / 60;
    return 0;
  }

  function byCapture() {
    return SIM.reports.slice().sort(function (a, b) {
      return capturedHoursAgo(a) - capturedHoursAgo(b);
    });
  }

  load();

  return {
    kinds: kinds, whens: whens, kindLabel: kindLabel,
    check: check, submit: submit, mineList: mineList, count: count, clear: clear,
    statusOf: statusOf, byCapture: byCapture, capturedHoursAgo: capturedHoursAgo,
    get storageOK() { return storageOK; }
  };
})();
