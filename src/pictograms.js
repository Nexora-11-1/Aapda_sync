/* ============================================================================
   AapdaSync — pictograms.js
   ---------------------------------------------------------------------------
   Safety pictograms for the public "If you are told to move" card.

   WHY SYMBOLS
   A district like this one is multilingual and not uniformly literate, and the
   people who most need an evacuation instruction are the ones least likely to
   read a paragraph of it under pressure. A symbol is read before the sentence
   beside it is read, and by people who will never read the sentence at all.

   WHY THE WORDS STAY
   The symbol goes WITH the text, never instead of it. Pictograms are not
   self-evident: a person and a wave means "do not wade" to someone who already
   knows that is the rule, and means "swimming" to someone who does not.
   Stripping the sentence off a safety instruction to make the card look
   cleaner would be trading comprehension for tidiness, on the one screen where
   that trade is least defensible. Every icon is aria-hidden and the sentence
   is the accessible text.

   THE GRAMMAR is the one people have already met on road signs and in
   factories, which is the whole advantage of using it:
     DO      — green ring, symbol upright inside it.
     DO NOT  — red ring with a diagonal bar across the symbol.
   The bar is what carries the negation. Colour alone would not: red/green is
   the commonest colour-vision deficiency there is, so the ring, the bar, the
   heading and the sentence all encode the same thing four times over.

   DRAWING RULES, so 32 icons look like one set rather than thirty-two separate
   decisions: 24×24 box, ~1.9px stroke, round caps and joins, no fills, nothing
   thinner than a stroke width apart. They render inside a 42px ring, so any
   detail finer than that turns to mud — seven of these were redrawn after a
   contact sheet showed them reading as a pencil, a box, a bowl and a dagger.
   ========================================================================== */

'use strict';

var PICTO = (function () {

  /* Path bodies only. The wrapper supplies the <svg>, the sizing and the
     stroke, so every symbol inherits one line weight and cannot drift. */
  var P = {

    /* ---- movement and ground ---- */
    'shelter-up':   '<path d="M4 21V10l8-6 8 6v11"/><path d="M12 19v-7"/><path d="M9 15l3-3 3 3"/>',
    'high-ground':  '<path d="M2 20l6-7 4 4 4-6 6 9z"/><path d="M12 3v6"/><path d="M9.5 5.5L12 3l2.5 2.5"/>',
    'traverse':     '<path d=\"M2 13l6-7 4.5 5.5L15 8l7 5\"/><path d=\"M4 19h12\"/><path d=\"M13.8 16.8L16 19l-2.2 2.2\"/>',
    'exit-house':   '<path d="M13 21H5V10l7-6 7 6v3"/><path d="M14 17h7"/><path d="M18.5 14.5L21 17l-2.5 2.5"/>',
    'assembly':     '<circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 22v-4M2 12h4M22 12h-4"/><path d="M10.5 4.5L12 6l1.5-1.5M10.5 19.5L12 18l1.5 1.5M4.5 10.5L6 12l-1.5 1.5M19.5 10.5L18 12l1.5 1.5"/>',

    /* ---- preparation ---- */
    'gobag':        '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="M12 12v5M9.5 14.5h5"/>',
    'mains-off':    '<path d="M12 3v8"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/>',
    'livestock':    '<path d=\"M3.5 10.5h9a3.5 3.5 0 0 1 3.5 3.5v2.5H3.5z\"/><path d=\"M6 16.5v4M13.5 16.5v4\"/><path d=\"M16 12.5l2.5-2h3v6h-3.5\"/><path d=\"M19 10.5V7.8\"/><path d=\"M3.5 10.5v6\"/>',
    'wet-cloth':    '<circle cx=\"11.5\" cy=\"8.5\" r=\"5.5\"/><path d=\"M6.1 9.6h10.8\"/><path d=\"M6.7 9.6V12c0 1.9 2.1 3.3 4.8 3.3s4.8-1.4 4.8-3.3V9.6\"/><path d=\"M3.4 10.6l3.3 1M19.6 10.6l-3.3 1\"/><path d=\"M21.6 18.4c0 1-.8 1.8-1.8 1.8s-1.8-.8-1.8-1.8c0-1 1.8-3.3 1.8-3.3s1.8 2.3 1.8 3.3z\"/>',
    'children':     '<circle cx="8" cy="6" r="2.4"/><path d="M8 8.4V15M5.5 21L8 15l2.5 6M5 11h6"/><circle cx="17" cy="11" r="1.8"/><path d="M17 12.8V17M15.2 21L17 17l1.8 4M15 14.5h4"/>',

    /* ---- watching and timing ---- */
    'watch':        '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>',
    'first-light':  '<path d="M2 19h20"/><path d="M7.5 15a4.5 4.5 0 0 1 9 0z"/><path d="M12 4v3M4.9 7.9l2 2M19.1 7.9l-2 2"/>',
    'wait':         '<path d="M7 3h10M7 21h10"/><path d="M9 3v3.2l3 3 3-3V3"/><path d="M9 21v-3.2l3-3 3 3V21"/>',
    'aftershock':   '<path d="M12 20V8"/><path d="M8.5 20a5 5 0 0 1 0-7M15.5 20a5 5 0 0 0 0-7"/><path d="M5.5 20a9 9 0 0 1 0-12M18.5 20a9 9 0 0 0 0-12"/>',
    'siren':        '<path d="M7 20v-6a5 5 0 0 1 10 0v6z"/><path d="M5 20h14"/><path d="M12 6V3"/><path d="M18.4 7.6l2-2M5.6 7.6l-2-2"/>',

    /* ---- keeping the way open ---- */
    'road-clear':   '<path d="M7 21L10 4M17 21L14 4"/><path d="M12 7v2.5M12 12.5v2.5M12 18v2"/>',

    /* ---- earthquake ---- */
    'drop-cover':   '<path d=\"M2 10h20\"/><path d=\"M4.5 10v9.5M19.5 10v9.5\"/><circle cx=\"12\" cy=\"13.4\" r=\"2.4\"/><path d=\"M8.5 19.6a3.5 3.5 0 0 1 7 0z\"/>',

    /* ---- prohibited: water ---- */
    'wade':         '<circle cx="12" cy="4.6" r="2.2"/><path d="M12 6.8v6"/><path d="M12 12.8l-2.5 4.2M12 12.8l2.5 4.2"/><path d="M8.5 10h7"/><path d="M2 19q2.6-2 5.2 0t5.2 0 5.2 0T22 19"/>',
    'go-back':      '<path d=\"M4 21V11l8-6 8 6v10z\"/><path d=\"M17.5 11.5H12a3 3 0 0 0 0 6h.8\"/><path d=\"M14.8 15.4l-2.2 2.1 2.2 2.1\"/>',
    'live-wire':    '<path d=\"M6 3.5v9\"/><path d=\"M3 5.5h6\"/><path d=\"M6 5.5c4.4 3 7.4 6.4 8.4 11\"/><path d=\"M17.6 12.8l-2.6 4.2h2.7l-2.1 4.2\"/><path d=\"M2 21.5h20\"/>',

    /* ---- prohibited: slope ---- */
    'slope-toe':    '<path d=\"M2 4l10 14\"/><path d=\"M2 20.5h20\"/><path d=\"M13 20.5v-5l3.5-2.7 3.5 2.7v5z\"/>',
    'debris-cross': '<path d="M2 20h20"/><path d="M5 20l2-3 2.6 3M11 20l2.4-3.6L16 20"/><circle cx="16" cy="5" r="2"/><path d="M16 7v4l-2.5 4M16 11l2.6 4M13 9h6"/>',
    'cracked':      '<path d="M4 21V10l8-6 8 6v11z"/><path d="M11 4.6L9.5 11l3.5 2-2.5 3.4 2 4.6"/>',
    'park-under':   '<path d="M2 4l12 6"/><path d="M4 18h14l-2.4-4.2H7.2z"/><path d="M4 18v2M18 18v2"/><circle cx="7.5" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>',

    /* ---- prohibited: buildings ---- */
    'lift':         '<path d="M5 3h14v18H5z"/><path d="M12 3v18"/><path d="M8.4 10L9.9 8l1.5 2M12.6 14l1.5 2 1.5-2"/>',
    'doorway':      '<path d="M6 21V4h12v17"/><path d="M3 21h18"/><circle cx="15" cy="13" r="1"/>',
    'enter-house':  '<path d="M13 21H5V10l7-6 7 6v3"/><path d="M21 17h-7"/><path d="M16.5 14.5L14 17l2.5 2.5"/>',
    'flame':        '<path d="M12 2.5c3.6 4.4 5.5 6.8 5.5 9.8a5.5 5.5 0 0 1-11 0c0-2.4 1.1-4 2.6-5.4.8 2.6 2.3 2.8 3.4 1.4.6-2-.5-3.9-.5-5.8z"/>',

    /* ---- wind and gas ---- */
    'crosswind':    '<path d="M2 8h11a2.4 2.4 0 1 0-2.4-2.4"/><path d="M2 13h14a2.4 2.4 0 1 1-2.4 2.4"/><path d="M5 19h10"/><path d="M13 17l2 2-2 2"/>',
    'run-downwind': '<path d="M2 6h9a2 2 0 1 0-2-2"/><path d="M2 10h6"/><circle cx="13" cy="6" r="2"/><path d="M12 9l-2.4 4 2.6 2 .8 5"/><path d="M12.2 15l-3 5M11 10.4l4 1.6 2.4 3"/>',
    'basement':     '<path d="M2 9h20"/><path d="M7 9v10h10V9"/><path d="M12 11v5"/><path d="M9.5 13.5L12 16l2.5-2.5"/>',
    'drive-plume':  '<path d="M2 19h11l-2.2-4H4.4z"/><circle cx="5.5" cy="19" r="1.4"/><circle cx="11" cy="19" r="1.4"/><path d="M15 12a3 3 0 0 1 .6-5.9 4 4 0 0 1 7.4 1.6A2.6 2.6 0 0 1 22 12z"/>'
  };

  /* One wrapper, so a symbol cannot be rendered without its ring — and a
     "do not" cannot be rendered without its bar. */
  function icon(key, kind, size) {
    var body = P[key] || P.watch;
    var s = size || 42;
    return '<span class="picto ' + (kind === 'no' ? 'no' : 'yes') + '" aria-hidden="true">' +
      '<svg width="' + Math.round(s * 0.60) + '" height="' + Math.round(s * 0.60) + '" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      body + '</svg></span>';
  }

  function has(key) { return Object.prototype.hasOwnProperty.call(P, key); }
  function keys() { return Object.keys(P); }

  return { icon: icon, has: has, keys: keys };
})();
