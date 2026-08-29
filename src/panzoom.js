/* ============================================================================
   AapdaSync — panzoom.js
   ---------------------------------------------------------------------------
   Pan, zoom and hover inspection for any SVG that has a viewBox.

   Two decisions worth stating. First, zoom is anchored to the cursor rather
   than the centre: an operator zooms because they are already looking at
   something, and centre-anchored zoom throws that thing off screen. Second, a
   drag that moves more than a few pixels cancels the click — otherwise every
   attempt to pan the map opens a drawer for whatever happened to be under the
   finger when it went down.
   ========================================================================== */

'use strict';

var PZ = (function () {

  var st = null;          // { el, full, view, min, max, dragging, moved, tip }

  function clampView(v, full, min, max) {
    var w = Math.max(full.w * min, Math.min(full.w * max, v.w));
    var h = w * (full.h / full.w);
    var x = Math.max(full.x - w * 0.25, Math.min(full.x + full.w - w * 0.75, v.x));
    var y = Math.max(full.y - h * 0.25, Math.min(full.y + full.h - h * 0.75, v.y));
    return { x: x, y: y, w: w, h: h };
  }

  function apply() {
    if (!st || !st.el) return;
    var v = st.view;
    st.el.setAttribute('viewBox', v.x.toFixed(2) + ' ' + v.y.toFixed(2) + ' ' + v.w.toFixed(2) + ' ' + v.h.toFixed(2));
    var box = st.el.parentNode;
    if (box) {
      var pct = Math.round((st.full.w / v.w) * 100);
      var out = box.querySelector('[data-zoomlabel]');
      if (out) out.textContent = pct + '%';
      var rst = box.querySelector('[data-zoom="reset"]');
      if (rst) rst.disabled = Math.abs(v.w - st.full.w) < 0.5 && Math.abs(v.x - st.full.x) < 0.5;
    }
  }

  /* Client pixel → viewBox unit, honouring the letterboxing that
     preserveAspectRatio introduces when the box is not the map's aspect. */
  function toView(ev) {
    var r = st.el.getBoundingClientRect();
    var v = st.view;
    var scale = Math.min(r.width / v.w, r.height / v.h);
    var offX = (r.width - v.w * scale) / 2;
    var offY = (r.height - v.h * scale) / 2;
    return {
      x: v.x + (ev.clientX - r.left - offX) / scale,
      y: v.y + (ev.clientY - r.top - offY) / scale,
      scale: scale, rect: r
    };
  }

  function zoomAt(px, py, factor) {
    var v = st.view;
    var nw = v.w * factor;
    var next = clampView({ x: px - (px - v.x) * (nw / v.w), y: py - (py - v.y) * (nw / v.w), w: nw, h: v.h * factor },
      st.full, st.min, st.max);
    st.view = next; apply();
  }

  function onWheel(e) {
    if (!st) return;
    e.preventDefault();
    var p = toView(e);
    zoomAt(p.x, p.y, e.deltaY > 0 ? 1.14 : 1 / 1.14);
  }

  function onDown(e) {
    if (!st || e.button !== 0) return;
    st.dragging = true; st.moved = 0;
    st.start = toView(e);
    st.startView = { x: st.view.x, y: st.view.y, w: st.view.w, h: st.view.h };
    st.el.style.cursor = 'grabbing';
    if (st.el.setPointerCapture && e.pointerId != null) {
      try { st.el.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
    }
  }

  function onMove(e) {
    if (!st) return;
    if (st.dragging) {
      var r = st.el.getBoundingClientRect();
      var scale = Math.min(r.width / st.startView.w, r.height / st.startView.h);
      var dx = (e.clientX - (st.start.rect.left + (st.start.x - st.startView.x) * scale + (r.width - st.startView.w * scale) / 2));
      var dy = (e.clientY - (st.start.rect.top + (st.start.y - st.startView.y) * scale + (r.height - st.startView.h * scale) / 2));
      st.moved = Math.max(st.moved, Math.abs(dx) + Math.abs(dy));
      st.view = clampView({ x: st.startView.x - dx / scale, y: st.startView.y - dy / scale,
                            w: st.startView.w, h: st.startView.h }, st.full, st.min, st.max);
      apply();
      hideTip();
      return;
    }
    showTip(e);
  }

  function onUp(e) {
    if (!st) return;
    st.dragging = false;
    st.el.style.cursor = 'grab';
    if (st.moved > 5) {
      /* Swallow the click that a pan would otherwise fire. */
      var kill = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
      st.el.addEventListener('click', kill, { capture: true, once: true });
      setTimeout(function () { st.el.removeEventListener('click', kill, true); }, 60);
    }
  }

  /* ------------------------------------------------------------- tooltip */
  function tipEl() {
    if (!st || !st.el) return null;
    var box = st.el.parentNode;
    if (!box) return null;
    var t = box.querySelector('.maptip');
    if (!t) {
      t = document.createElement('div');
      t.className = 'maptip';
      t.setAttribute('role', 'tooltip');
      box.appendChild(t);
    }
    return t;
  }
  function showTip(e) {
    var target = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    var t = tipEl(); if (!t) return;
    if (!target) { t.classList.remove('on'); return; }
    t.innerHTML = target.getAttribute('data-tip');
    t.classList.add('on');
    var box = st.el.parentNode.getBoundingClientRect();
    var tw = t.offsetWidth, th = t.offsetHeight;
    var x = e.clientX - box.left + 16, y = e.clientY - box.top + 16;
    if (x + tw > box.width - 8) x = e.clientX - box.left - tw - 14;
    if (y + th > box.height - 8) y = e.clientY - box.top - th - 14;
    t.style.left = Math.max(6, x) + 'px';
    t.style.top = Math.max(6, y) + 'px';
  }
  function hideTip() { var t = tipEl(); if (t) t.classList.remove('on'); }

  /* --------------------------------------------------------------- setup */
  function attach(elId, full, opts) {
    var el = document.getElementById(elId);
    if (!el) { st = null; return; }
    opts = opts || {};
    /* The SVG node is replaced on every re-render, so state is rebuilt rather
       than preserved — except the view, which the caller may hand back in. */
    st = {
      el: el, full: full, dragging: false, moved: 0,
      view: opts.view ? { x: opts.view.x, y: opts.view.y, w: opts.view.w, h: opts.view.h }
                      : { x: full.x, y: full.y, w: full.w, h: full.h },
      min: opts.min || 0.06, max: opts.max || 1.0
    };
    el.style.cursor = 'grab';
    el.style.touchAction = 'none';
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', function () { st && (st.dragging = false); hideTip(); });
    el.addEventListener('dblclick', function (e) { e.preventDefault(); var p = toView(e); zoomAt(p.x, p.y, 1 / 1.9); });
    apply();
  }

  function zoomBy(f) {
    if (!st) return;
    var v = st.view;
    zoomAt(v.x + v.w / 2, v.y + v.h / 2, f);
  }
  function reset() {
    if (!st) return;
    st.view = { x: st.full.x, y: st.full.y, w: st.full.w, h: st.full.h };
    apply();
  }
  function focus(cx, cy, span) {
    if (!st) return;
    var w = Math.max(st.full.w * st.min, span);
    st.view = clampView({ x: cx - w / 2, y: cy - (w * st.full.h / st.full.w) / 2,
                          w: w, h: w * st.full.h / st.full.w }, st.full, st.min, st.max);
    apply();
  }
  function view() { return st ? { x: st.view.x, y: st.view.y, w: st.view.w, h: st.view.h } : null; }
  function detach() { st = null; }

  return { attach: attach, zoomBy: zoomBy, reset: reset, focus: focus, view: view, detach: detach, hideTip: hideTip };
})();
