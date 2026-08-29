/* ============================================================================
   AapdaSync — photos.js
   ---------------------------------------------------------------------------
   Photograph import for the record carousel.

   The build could not fetch photographs of these six events. Ground-level
   imagery of Bhopal, Kedarnath, Kerala and Chamoli is almost entirely press
   photography and is copyrighted; the freely-licensed material lives on
   Wikimedia Commons, which was not reachable from the build environment. So
   rather than ship image URLs that could not be verified, or satellite frames
   standing in for events they do not show, the app takes photographs from you.

   Drop a file on a card. It is downscaled in the browser, stored locally, and
   used immediately. Nothing is uploaded anywhere — this is a static page.

   Attribution is captured at the same moment as the image, on purpose. A
   credit box that appears later is a credit box that stays empty.
   ========================================================================== */

'use strict';

var PHOTOS = (function () {

  var KEY = 'aapdasync.photos.v1';
  var mem = {};                 // always authoritative; storage is a cache
  var storageOK = true;

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) mem = JSON.parse(raw) || {};
    } catch (e) {
      /* Private windows, blocked site data, file:// quirks. Not fatal: the
         session still works, the photographs just do not survive a reload. */
      storageOK = false;
    }
    return mem;
  }

  function persist() {
    if (!storageOK) return false;
    try {
      localStorage.setItem(KEY, JSON.stringify(mem));
      return true;
    } catch (e) {
      /* Almost always the ~5 MB quota. Keep the image in memory and say so,
         rather than silently dropping what the user just added. */
      storageOK = false;
      return false;
    }
  }

  function get(id) { return mem[id] || null; }
  function all() { return mem; }
  function count() { return Object.keys(mem).length; }

  function setCredit(id, credit) {
    if (!mem[id]) return false;
    mem[id].credit = credit || '';
    persist();
    return true;
  }

  function remove(id) {
    delete mem[id];
    persist();
    return true;
  }

  function clear() { mem = {}; persist(); }

  /* Downscale before storing. A 6 MP phone photo as a data URI is ~8 MB and
     would blow the storage quota on the second image; at 1400 px wide and
     quality 0.82 a landscape frame lands around 250 KB, which leaves room for
     all six. The carousel never renders larger than about 840 px anyway. */
  var MAX_W = 1400, QUALITY = 0.82;

  function ingest(id, file, cb) {
    if (!file || !/^image\//.test(file.type)) {
      cb({ ok: false, msg: 'That is not an image file.' });
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { cb({ ok: false, msg: 'The file could not be read.' }); };
    reader.onload = function (ev) {
      var img = new Image();
      img.onerror = function () { cb({ ok: false, msg: 'That file is not a readable image.' }); };
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { cb({ ok: false, msg: 'That image has no dimensions.' }); return; }
        var scale = Math.min(1, MAX_W / w);
        var cw = Math.round(w * scale), ch = Math.round(h * scale);
        var cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
        var ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, cw, ch);
        var out;
        try { out = cv.toDataURL('image/jpeg', QUALITY); }
        catch (e) { cb({ ok: false, msg: 'The image could not be re-encoded.' }); return; }

        mem[id] = {
          src: out,
          credit: (mem[id] && mem[id].credit) || '',
          name: file.name,
          w: cw, h: ch,
          bytes: Math.round(out.length * 0.75),
          at: new Date().toISOString()
        };
        var saved = persist();
        cb({
          ok: true, id: id, w: cw, h: ch,
          bytes: mem[id].bytes, persisted: saved,
          msg: saved
            ? 'Stored. It will still be here after a reload.'
            : 'Loaded for this session only — browser storage is full or unavailable, so it will not survive a reload.'
        });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* Total footprint, so the import panel can warn before the quota bites. */
  function bytes() {
    var t = 0;
    Object.keys(mem).forEach(function (k) { t += mem[k].bytes || 0; });
    return t;
  }

  load();

  return {
    get: get, all: all, count: count, bytes: bytes,
    ingest: ingest, remove: remove, clear: clear, setCredit: setCredit,
    load: load, get storageOK() { return storageOK; }
  };
})();
