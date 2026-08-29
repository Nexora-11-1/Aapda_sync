/* ============================================================================
   AapdaSync — record.js
   ---------------------------------------------------------------------------
   THE RECORD. Unlike everything else in this prototype, the events below are
   REAL and the figures are cited. They are here because each one is the reason
   a specific mechanism in AapdaSync exists — the design is an argument, and
   this is its evidence.

   Figures are as reported by the cited source. Where sources disagree (they
   often do, especially on mortality) the disagreement is shown rather than
   resolved, because a single confident number would be the dishonest choice.

   IMAGES. Every card carries a full-bleed photograph, supplied with this build,
   downscaled and inlined as a data URI in src/photos-bundled.js so it is present
   in the folder build, the single-file build and the hosted page alike.

   THEIR PROVENANCE IS NOT VERIFIED, and several plainly are not the event on
   their card — the Bhopal frame is the derelict plant photographed years later,
   and the Bhuj frame shows collapsed reinforced concrete where Bhuj destroyed
   mostly low-rise masonry. Rather than label them as the event and hope, each
   carries a caption saying what it actually shows, on screen at all times. The
   record cards are the one place in this prototype where the data is real and
   cited; a mislabelled photograph there costs more than a missing one.

   The image a card shows is the first of five sources that loads:
     1. A file you dropped on the card in the running app — kept in the browser.
     2. The bundled photograph, above. Always loads; it is a data URI.
     3. assets/photos/<id>.jpg in the unpacked build. See its README.txt.
     4. A verified NASA public-domain frame, where the record names one. Needs a
        network, so it is skipped on file:// and in the hosted build.
     5. The bundled illustration in src/scenes.js.
   Step 1 is yours and takes your credit on hover. Steps 2, 4 and 5 keep a
   permanent caption naming what the image actually is.

   Nothing here depicts casualties.
   ========================================================================== */

'use strict';

var RECORD = [
  {
    id: 'R-1984',
    prompt: 'Night-time industrial skyline, low-lying pale vapour drifting across a dense settlement, sodium street lighting, no people, documentary photograph, wide angle',
    photo: 'assets/photos/R-1984.jpg',
    credit: '',   /* REQUIRED if you drop a file in assets/photos/ — see its README.txt */
    year: '1984',
    date: '3 December 1984',
    name: 'Bhopal',
    place: 'Bhopal, Madhya Pradesh',
    kind: 'mah',
    kindLabel: 'Industrial — toxic release',
    headline: '≈30 t',
    headlineNote: 'of methyl isocyanate escaped in 45–60 minutes',
    facts: [
      ['Released', '≈30 tonnes of methyl isocyanate in 45–60 min, rising to ≈40 t within two hours'],
      ['Exposed', 'Over 500,000 people in the vicinity'],
      ['Deaths', '2,259 immediate (official) · 3,787 confirmed by the Madhya Pradesh government · other estimates ≈8,000 in the first weeks'],
      ['Planning', 'No action plan existed for an accident of this magnitude; local authorities had not been told the quantities or dangers of the chemicals on site'],
      ['Warning', 'The public siren was deliberately silenced shortly after it sounded, to avoid alarming the public']
    ],
    lesson: 'A settlement can be inside a plume envelope that nobody has drawn, warned by a siren somebody switched off.',
    mechanism: 'Off-site plume fraction is a hazard input per habitation, and any safe site inside the envelope is disqualified outright rather than de-rated — a shelter downwind of a release is not a shelter. Warning reach is a term in the vulnerability index, not an afterthought.',
    source: 'Wikipedia — Bhopal disaster',
    url: 'https://en.wikipedia.org/wiki/Bhopal_disaster'
  },
  {
    id: 'R-1999',
    prompt: 'Coastal storm surge pushing inland over flat farmland under a cyclone sky, palm trees bent by wind, heavy rain, no people, documentary photograph, wide angle',
    photo: 'assets/photos/R-1999.jpg',
    photoFallback: 'https://images-assets.nasa.gov/image/PIA22838/PIA22838~large.jpg',
    fallbackCredit: 'NASA/JPL-Caltech · Cyclone Fani approaching Odisha, 2019 — illustrative, not the 1999 cyclone',
    year: '1999',
    date: '29 October 1999',
    name: 'The Odisha super cyclone',
    place: 'Coastal Odisha',
    kind: 'cyclone',
    kindLabel: 'Cyclone — storm surge',
    headline: '23',
    headlineNote: 'permanent shelters existed across six districts',
    facts: [
      ['Intensity', '260 km/h winds, 912 hPa — the lowest pressure recorded in the North Indian Ocean'],
      ['Surge', '5–6 m, reaching up to 35 km inland; the Indian ministry estimated a peak of 6.7 m'],
      ['Deaths', '9,887 recorded by the Government of India; some estimates run to 30,000'],
      ['Evacuated', '≈150,000 from five coastal Odisha districts'],
      ['Shelter stock', '23 permanent shelters across six districts, run by the Indian Red Cross, which held 30,000 people']
    ],
    lesson: 'Twenty-three buildings against a surge that travelled thirty-five kilometres inland. The gap was not unknown — it was simply never computed against the population it had to hold.',
    mechanism: 'The carrying-capacity ledger exists to make exactly this arithmetic unavoidable: derived capacity against derived demand, per site, before the event rather than after it.',
    source: 'Wikipedia — 1999 Odisha cyclone',
    url: 'https://en.wikipedia.org/wiki/1999_Odisha_cyclone'
  },
  {
    id: 'R-2001',
    prompt: 'Collapsed masonry buildings in a dry Indian town after an earthquake, dust haze in low sun, rubble in the foreground, no people, documentary photograph, wide angle',
    photo: 'assets/photos/R-2001.jpg',
    credit: '',
    year: '2001',
    date: '26 January 2001, 08:46 IST',
    name: 'Bhuj',
    place: 'Kutch, Gujarat',
    kind: 'seis',
    kindLabel: 'Earthquake',
    headline: '400,000',
    headlineNote: 'buildings destroyed; 1.2 million damaged',
    facts: [
      ['Magnitude', 'M 7.6 (ISC) / 7.7 (USGS), 17.4 km deep, epicentre ≈9 km SSW of Chobari, Bhachau taluka'],
      ['Deaths', 'At least 20,023 (official)'],
      ['Injured', '166,836'],
      ['Structures', '≈400,000 buildings destroyed; over 1.2 million houses damaged or destroyed across 8,000 villages and 490 towns'],
      ['Loss', '≈$7.5 billion']
    ],
    lesson: 'Ground motion does not kill people. Buildings do — and which buildings depends on how they were built, not on where the epicentre was.',
    mechanism: 'Structural fragility is the heaviest term in the vulnerability index, computed from the kutcha / semi-pucca / pucca mix of each habitation. On the shelter side, construction resistance is applied to the seismic term only, so a retrofitted block is credited for surviving shaking and given nothing for standing in water.',
    source: 'Wikipedia — 2001 Gujarat earthquake',
    url: 'https://en.wikipedia.org/wiki/2001_Gujarat_earthquake'
  },
  {
    id: 'R-2013',
    prompt: 'Himalayan river valley in flood, brown torrent between steep pine slopes, monsoon cloud low on the ridges, no people, documentary photograph, wide angle',
    photo: 'assets/photos/R-2013.jpg',
    credit: '',
    photoFallback: 'https://images-assets.nasa.gov/image/iss072e397228/iss072e397228~large.jpg',
    fallbackCredit: 'NASA/ISS · Himalayan river system, 2024 — illustrative, not Kedarnath',
    year: '2013',
    date: '16–17 June 2013',
    name: 'Kedarnath',
    place: 'Uttarakhand',
    kind: 'flood',
    kindLabel: 'Cloudburst — flash flood',
    headline: '6,054',
    headlineNote: 'dead, over 89% of them in Uttarakhand',
    facts: [
      ['Cause', 'A mid-day cloudburst; rapid melt of the Chorabari glacier at 3,800 m breached Chorabari lake and sent the Mandakini over Kedarnath'],
      ['Deaths', '6,054, with over 89% in Uttarakhand'],
      ['Rescued', 'Over 110,000 evacuated by the armed forces; the ITBP recovered 33,009 pilgrims in 15 days; the IAF airlifted 18,424 between 17–30 June'],
      ['Warning', 'IMD had predicted heavy rain — the warnings were not given wide publicity beforehand, so thousands were caught unaware']
    ],
    lesson: 'The forecast was right and the warning existed. It did not reach the people standing in the valley, which is the same, operationally, as not having one.',
    mechanism: 'Warning reach is measured per habitation and carried into the vulnerability index. A hazard already impacting does not collapse the planning window to zero — it keeps a horizon and pins time pressure to maximum, because people still have to be moved through it.',
    source: 'Wikipedia — 2013 North India floods',
    url: 'https://en.wikipedia.org/wiki/2013_North_India_floods'
  },
  {
    id: 'R-2018',
    prompt: 'Flooded lowland village seen from above, only rooftops and treetops above brown water, overcast monsoon light, no people, documentary photograph, wide angle',
    photo: 'assets/photos/R-2018.jpg',
    credit: '',
    photoFallback: 'https://images-assets.nasa.gov/image/PIA26343/PIA26343~large.jpg',
    fallbackCredit: 'NASA/JPL-Caltech · SWOT flood mapping, 2024 — illustrative, not the 2018 floods',
    year: '2018',
    date: 'July–August 2018',
    name: 'The Kerala floods',
    place: 'All 14 districts, Kerala',
    kind: 'flood',
    kindLabel: 'Monsoon flood',
    headline: '3,274',
    headlineNote: 'relief camps opened, holding ≈1.25 million people',
    facts: [
      ['Deaths', '483–500 reported; one account gives 489 dead and 15 missing'],
      ['Displaced', '≈1 million evacuated'],
      ['Camps', 'Over 3,274 relief camps opened; the NDMA estimated ≈1.25 million people sheltered'],
      ['Extent', 'All 14 districts placed on red alert'],
      ['Dams', 'The Central Water Commission found the reservoirs neither added to nor reduced the flood — they were already at capacity. An amicus curiae report alleged that simultaneous releases during extreme rainfall aggravated the damage.']
    ],
    lesson: 'Three thousand camps were not a plan being executed. They were a plan being invented, at speed, because the registered shelter stock was nowhere near a million people.',
    mechanism: 'Capacity is derived, not claimed: the minimum of floor area, water, sanitation, the site\'s own hazard exposure, and what its approach road can deliver before impact. In the shipped simulation that turns a register of 14,800 places into 4,962 real ones — a gap you want to find on a Tuesday, not on the night.',
    source: 'Wikipedia — 2018 Kerala floods',
    url: 'https://en.wikipedia.org/wiki/2018_Kerala_floods'
  },
  {
    id: 'R-2021',
    prompt: 'High Himalayan valley below a fresh rock and ice avalanche scar, debris fan across the valley floor, cold clear light, no people, documentary photograph, wide angle',
    photo: 'assets/photos/R-2021.jpg',
    credit: '',
    photoFallback: 'https://images-assets.nasa.gov/image/iss069e003192/iss069e003192~large.jpg',
    fallbackCredit: 'NASA/ISS · High Himalaya, 2023 — illustrative, not Chamoli',
    year: '2021',
    date: '7 February 2021',
    name: 'Chamoli',
    place: 'Rishiganga / Dhauliganga, Uttarakhand',
    kind: 'slide',
    kindLabel: 'Rock-ice avalanche — debris flow',
    headline: '27 million m³',
    headlineNote: 'of rock and ice, 80% rock, detached near Ronti peak',
    facts: [
      ['Cause', 'A rock and ice avalanche of ≈27 million m³ (80% rock, 20% glacier ice) fell into the Ronti Gad tributary'],
      ['Deaths', 'Over 200 killed or missing; as of May 2021, 83 bodies and 36 body parts recovered of 204 missing'],
      ['Who', '140 of them were workers at the Tapovan hydropower site'],
      ['Assets lost', 'The Rishiganga project (13 MW) and the Tapovan Vishnugad plant were struck; the Dhauliganga dam was washed away']
    ],
    lesson: 'There was no warning window to plan inside. The people who died were where the hazard was, at the moment it arrived, and no evacuation order could have been written in the time available.',
    mechanism: 'Not every hazard is forecastable. What can be pre-computed is who is exposed and where they would go — so the relocation plan, the capacity ledger and the movement orders are all standing artefacts that exist before an event, not products of the hour after it.',
    source: 'Wikipedia — 2021 Uttarakhand flood',
    url: 'https://en.wikipedia.org/wiki/2021_Uttarakhand_flood'
  }
];

/* ============================================================================
   SCENE ART — 420 × 200 vector, drawn under everything else
   ---------------------------------------------------------------------------
   This is the base layer: flat SVG, a few hundred bytes, painted instantly so
   a card is never an empty rectangle while a larger image decodes. The rendered
   illustration in src/scenes.js covers it within a frame or two, and a real
   photograph covers that.

   It is kept rather than deleted because it is the only layer with no decode
   cost and no failure mode. If scenes.js is stripped from a build, or an image
   is still in flight on a slow connection, the card still reads as the right
   kind of event.

   TO USE REAL PHOTOGRAPHS: put a file at assets/photos/<id>.jpg, or drop one on
   the card in the running app. Fill in `credit` — an uncredited photograph on a
   public page is a licensing problem waiting to happen.
   ========================================================================== */

function sceneSVG(kind, uid) {
  var u = (uid || 'x').replace(/[^A-Za-z0-9_-]/g, '');
  var fn = SCENES[kind] || SCENES.flood;
  return '<svg viewBox="0 0 420 200" role="img" aria-hidden="true" preserveAspectRatio="xMidYMid slice">' +
    fn(u) + '<rect width="420" height="200" fill="url(#vig' + u + ')"/>' +
    '<defs><radialGradient id="vig' + u + '" cx="50%" cy="42%" r="78%">' +
    '<stop offset="55%" stop-color="#000" stop-opacity="0"/>' +
    '<stop offset="100%" stop-color="#0A1626" stop-opacity=".26"/></radialGradient></defs></svg>';
}

function grad(id, stops, x1, y1, x2, y2) {
  return '<linearGradient id="' + id + '" x1="' + (x1 || 0) + '" y1="' + (y1 || 0) +
    '" x2="' + (x2 || 0) + '" y2="' + (y2 == null ? 1 : y2) + '">' +
    stops.map(function (s) { return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' +
      (s[2] != null ? ' stop-opacity="' + s[2] + '"' : '') + '/>'; }).join('') + '</linearGradient>';
}

/* A deterministic scatter — no Math.random, so a card looks the same every
   time it comes back to the front of the stack. */
function scatter(n, seed, fn) {
  var out = '', a = seed * 9301 + 49297;
  for (var i = 0; i < n; i++) {
    a = (a * 9301 + 49297) % 233280;
    var r1 = a / 233280;
    a = (a * 9301 + 49297) % 233280;
    var r2 = a / 233280;
    out += fn(r1, r2, i);
  }
  return out;
}

var SCENES = {

  /* Bhopal — a night release drifting across a sleeping settlement line. */
  mah: function (u) {
    var s = '<defs>' +
      grad('sky' + u, [[0, '#141E33'], [0.55, '#2A2F45'], [1, '#4A3B4A']]) +
      grad('plume' + u, [[0, '#B79BD6', 0.55], [1, '#B79BD6', 0]], 0, 0, 1, 0) +
      grad('gnd' + u, [[0, '#221D2B'], [1, '#12131C']]) +
      '</defs>';
    s += '<rect width="420" height="200" fill="url(#sky' + u + ')"/>';
    s += '<circle cx="352" cy="40" r="13" fill="#E8E2C8" opacity=".5"/>';
    s += scatter(34, 7, function (r1, r2) {
      return '<circle cx="' + (r1 * 420).toFixed(1) + '" cy="' + (r2 * 92).toFixed(1) + '" r="' +
        (0.5 + r2 * 0.9).toFixed(2) + '" fill="#DDE6F5" opacity="' + (0.18 + r1 * 0.42).toFixed(2) + '"/>';
    });
    // plume: overlapping ellipses drifting right and down
    for (var i = 0; i < 9; i++) {
      var px = 96 + i * 36, py = 118 - Math.sin(i * 0.55) * 12 + i * 2.4;
      s += '<ellipse cx="' + px + '" cy="' + py + '" rx="' + (30 + i * 6) + '" ry="' + (16 + i * 2.4) +
        '" fill="#B79BD6" opacity="' + (0.30 - i * 0.024).toFixed(3) + '"/>';
    }
    s += '<rect x="0" y="112" width="420" height="18" fill="url(#plume' + u + ')"/>';
    // plant
    s += '<rect x="34" y="98" width="30" height="70" fill="#0E1119"/>';
    s += '<rect x="68" y="116" width="20" height="52" fill="#141824"/>';
    s += '<rect x="92" y="106" width="12" height="62" fill="#0E1119"/>';
    s += '<path d="M46 98 C 46 74, 74 78, 80 56 C 85 38, 108 44, 118 30" stroke="#B79BD6" stroke-width="9" ' +
      'fill="none" stroke-linecap="round" opacity=".34"/>';
    s += '<circle cx="49" cy="94" r="2.6" fill="#FFCF6B"/><circle cx="78" cy="112" r="2" fill="#FFCF6B" opacity=".8"/>';
    // settlement line
    s += '<rect x="0" y="168" width="420" height="32" fill="url(#gnd' + u + ')"/>';
    s += scatter(15, 3, function (r1, r2, i) {
      var x = 122 + i * 20 + r1 * 8, h = 12 + r2 * 16;
      return '<rect x="' + x.toFixed(1) + '" y="' + (168 - h).toFixed(1) + '" width="14" height="' + h.toFixed(1) +
        '" fill="#0B0E16"/>' +
        '<rect x="' + (x + 3).toFixed(1) + '" y="' + (168 - h + 4).toFixed(1) + '" width="4" height="4" fill="#FFCF6B" opacity="' + (0.25 + r1 * 0.5).toFixed(2) + '"/>';
    });
    return s;
  },

  /* Odisha — a leaden sea driven inland past a coastline that had 23 shelters. */
  cyclone: function (u) {
    var s = '<defs>' +
      grad('sky' + u, [[0, '#3A4A5C'], [0.6, '#6B7B88'], [1, '#93A0A6']]) +
      grad('sea' + u, [[0, '#42627C'], [1, '#22384A']]) +
      grad('surge' + u, [[0, '#7C97AC'], [1, '#3D5B72']]) +
      '</defs>';
    s += '<rect width="420" height="200" fill="url(#sky' + u + ')"/>';
    // spiral bands
    s += '<g transform="translate(300,52)" opacity=".4">';
    for (var a = 0; a < 5; a++) {
      s += '<path d="M0 0 C 26 -12, 60 -6, 72 20 C 82 42, 62 60, 40 54 C 24 49, 18 34, 27 25" ' +
        'fill="none" stroke="#DCE6EC" stroke-width="4" opacity=".5" transform="rotate(' + (a * 72) + ') scale(0.9)"/>';
    }
    s += '<circle r="6" fill="#DCE6EC" opacity=".7"/></g>';
    // rain
    s += scatter(70, 11, function (r1, r2) {
      var x = r1 * 460 - 20, y = r2 * 170;
      return '<line x1="' + x.toFixed(1) + '" y1="' + y.toFixed(1) + '" x2="' + (x - 9).toFixed(1) +
        '" y2="' + (y + 16).toFixed(1) + '" stroke="#E4EDF2" stroke-width="1" opacity="' + (0.10 + r2 * 0.26).toFixed(2) + '"/>';
    });
    // sea + surge front
    s += '<path d="M0 128 C 70 122, 130 134, 210 128 C 280 122, 350 132, 420 126 L420 200 L0 200 Z" fill="url(#sea' + u + ')"/>';
    s += '<path d="M0 120 C 60 112, 118 126, 196 118 C 268 111, 344 124, 420 116 L420 132 C 344 140, 268 127, 196 134 C 118 142, 60 128, 0 136 Z" fill="url(#surge' + u + ')" opacity=".92"/>';
    s += scatter(22, 5, function (r1, r2) {
      return '<ellipse cx="' + (r1 * 420).toFixed(1) + '" cy="' + (122 + r2 * 22).toFixed(1) + '" rx="' +
        (5 + r1 * 12).toFixed(1) + '" ry="1.4" fill="#EAF1F5" opacity="' + (0.16 + r2 * 0.3).toFixed(2) + '"/>';
    });
    // palms bent by the wind
    [[54, 150], [96, 158], [372, 152]].forEach(function (p) {
      s += '<path d="M' + p[0] + ' ' + p[1] + ' C ' + (p[0] + 6) + ' ' + (p[1] - 22) + ', ' + (p[0] + 18) + ' ' + (p[1] - 30) + ', ' + (p[0] + 30) + ' ' + (p[1] - 34) + '" stroke="#22303A" stroke-width="2.6" fill="none"/>';
      for (var k = 0; k < 4; k++) {
        s += '<path d="M' + (p[0] + 30) + ' ' + (p[1] - 34) + ' q 16 ' + (-2 + k * 5) + ', 30 ' + (4 + k * 6) + '" stroke="#22303A" stroke-width="2" fill="none" opacity=".85"/>';
      }
    });
    // low settlement, and one shelter
    s += '<rect x="0" y="176" width="420" height="24" fill="#233240"/>';
    s += scatter(11, 9, function (r1, r2, i) {
      var x = 128 + i * 22 + r1 * 6, h = 9 + r2 * 9;
      return '<rect x="' + x.toFixed(1) + '" y="' + (176 - h).toFixed(1) + '" width="13" height="' + h.toFixed(1) + '" fill="#1A2530"/>';
    });
    s += '<rect x="232" y="150" width="34" height="26" fill="#DCE6EC"/><rect x="232" y="146" width="34" height="5" fill="#F4F8FA"/>';
    s += '<text x="249" y="143" font-size="8.5" text-anchor="middle" font-family="Inter,sans-serif" fill="#EAF1F5" font-weight="700">1 of 23</text>';
    return s;
  },

  /* Bhuj — a skyline where the kutcha stock has already gone. */
  seis: function (u) {
    var s = '<defs>' +
      grad('sky' + u, [[0, '#C9AE86'], [0.55, '#D9C4A2'], [1, '#E3D3B7']]) +
      grad('dust' + u, [[0, '#E7DAC2', 0.85], [1, '#E7DAC2', 0]]) +
      '</defs>';
    s += '<rect width="420" height="200" fill="url(#sky' + u + ')"/>';
    s += '<circle cx="330" cy="46" r="18" fill="#F3E6CB" opacity=".55"/>';
    // far skyline in haze
    s += scatter(16, 13, function (r1, r2, i) {
      var x = i * 27, h = 22 + r2 * 34;
      return '<rect x="' + x + '" y="' + (128 - h).toFixed(1) + '" width="20" height="' + h.toFixed(1) + '" fill="#B8A183" opacity=".55"/>';
    });
    s += '<rect x="0" y="94" width="420" height="46" fill="url(#dust' + u + ')" opacity=".7"/>';
    // near buildings: standing and collapsed
    var stand = [[26, 62], [96, 86], [200, 54], [286, 78], [372, 46]];
    var fall = [[62, 0], [150, 0], [246, 0], [332, 0]];
    stand.forEach(function (b) {
      var x = b[0], h = b[1];
      s += '<rect x="' + x + '" y="' + (150 - h) + '" width="30" height="' + h + '" fill="#4C4034"/>';
      s += '<rect x="' + x + '" y="' + (150 - h) + '" width="30" height="4" fill="#5E5142"/>';
      for (var r = 0; r < Math.floor(h / 18); r++) {
        s += '<rect x="' + (x + 6) + '" y="' + (150 - h + 9 + r * 18) + '" width="6" height="8" fill="#2A231C"/>';
        s += '<rect x="' + (x + 18) + '" y="' + (150 - h + 9 + r * 18) + '" width="6" height="8" fill="#2A231C"/>';
      }
    });
    fall.forEach(function (b, i) {
      var x = b[0];
      s += '<g transform="rotate(' + (i % 2 ? -12 : 9) + ' ' + (x + 14) + ' 150)">' +
        '<rect x="' + x + '" y="134" width="28" height="16" fill="#5A4C3D" opacity=".92"/>' +
        '<rect x="' + (x + 4) + '" y="126" width="20" height="9" fill="#6A5B49" opacity=".85"/></g>';
      s += '<path d="M' + (x - 4) + ' 150 l10 -7 l9 5 l11 -8 l10 10 Z" fill="#6E5F4C" opacity=".8"/>';
    });
    // ground and fissure
    s += '<rect x="0" y="150" width="420" height="50" fill="#7A6952"/>';
    s += '<path d="M0 162 L52 162 L68 150 L86 176 L104 154 L126 172 L146 158 L172 164 L420 164 L420 200 L0 200 Z" fill="#5E5142"/>';
    s += '<path d="M186 150 l9 20 l-13 4 l11 26" stroke="#3A3128" stroke-width="3" fill="none" stroke-linecap="round"/>';
    s += '<path d="M262 150 l-7 16 l10 5 l-8 29" stroke="#3A3128" stroke-width="2.4" fill="none" stroke-linecap="round"/>';
    return s;
  },

  /* Kedarnath / Kerala — a valley taking more water than it has room for. */
  flood: function (u) {
    var s = '<defs>' +
      grad('sky' + u, [[0, '#8FA6B8'], [0.5, '#A9BCC9'], [1, '#C6D2D8']]) +
      grad('w' + u, [[0, '#5C86A8'], [1, '#2E5473']]) +
      grad('haze' + u, [[0, '#C6D2D8', 0], [1, '#C6D2D8', 0.8]]) +
      '</defs>';
    s += '<rect width="420" height="200" fill="url(#sky' + u + ')"/>';
    // three receding mountain layers
    s += '<path d="M0 96 L58 40 L104 72 L162 26 L214 66 L272 34 L330 74 L392 44 L420 68 L420 200 L0 200 Z" fill="#7E93A5" opacity=".55"/>';
    s += '<path d="M0 116 L48 68 L96 98 L154 58 L206 92 L268 62 L326 100 L386 72 L420 96 L420 200 L0 200 Z" fill="#63798D" opacity=".7"/>';
    s += '<path d="M0 138 L44 100 L90 124 L148 92 L204 120 L262 96 L322 126 L384 104 L420 124 L420 200 L0 200 Z" fill="#4B6072"/>';
    s += '<rect x="0" y="60" width="420" height="60" fill="url(#haze' + u + ')" opacity=".45"/>';
    // rain
    s += scatter(60, 17, function (r1, r2) {
      var x = r1 * 440 - 10, y = r2 * 150;
      return '<line x1="' + x.toFixed(1) + '" y1="' + y.toFixed(1) + '" x2="' + (x - 4).toFixed(1) +
        '" y2="' + (y + 14).toFixed(1) + '" stroke="#E6EEF3" stroke-width="0.9" opacity="' + (0.10 + r2 * 0.24).toFixed(2) + '"/>';
    });
    // water plane
    s += '<path d="M0 150 C 80 145, 150 156, 226 150 C 300 144, 360 154, 420 148 L420 200 L0 200 Z" fill="url(#w' + u + ')"/>';
    s += scatter(24, 23, function (r1, r2) {
      return '<ellipse cx="' + (r1 * 420).toFixed(1) + '" cy="' + (156 + r2 * 38).toFixed(1) + '" rx="' +
        (7 + r1 * 18).toFixed(1) + '" ry="1.5" fill="#DCEAF2" opacity="' + (0.12 + r2 * 0.24).toFixed(2) + '"/>';
    });
    // submerged rooftops — only the roofs remain above the line
    [[46, 152], [104, 156], [178, 150], [252, 155], [316, 151], [382, 156]].forEach(function (p, i) {
      var w = 22 + (i % 3) * 6;
      s += '<path d="M' + (p[0] - w / 2) + ' ' + p[1] + ' L' + p[0] + ' ' + (p[1] - 13 - (i % 2) * 4) + ' L' + (p[0] + w / 2) + ' ' + p[1] + ' Z" fill="#31404C"/>';
      s += '<path d="M' + (p[0] - w / 2) + ' ' + p[1] + ' L' + (p[0] + w / 2) + ' ' + p[1] + '" stroke="#1F2C36" stroke-width="1.6"/>';
    });
    return s;
  },

  /* Chamoli — twenty-seven million cubic metres leaving the mountain. */
  slide: function (u) {
    var s = '<defs>' +
      grad('sky' + u, [[0, '#9EB4C6'], [1, '#D2DCE2']]) +
      grad('rock' + u, [[0, '#6E6156'], [1, '#3E3730']]) +
      grad('dust' + u, [[0, '#D8CFC2', 0.9], [1, '#D8CFC2', 0]]) +
      '</defs>';
    s += '<rect width="420" height="200" fill="url(#sky' + u + ')"/>';
    // peaks, snow caps
    s += '<path d="M0 150 L64 44 L118 96 L182 18 L246 82 L310 40 L370 88 L420 56 L420 200 L0 200 Z" fill="#7E8B97" opacity=".65"/>';
    s += '<path d="M182 18 L206 42 L192 48 L214 62 L246 82 L182 82 Z" fill="#EEF3F6" opacity=".9"/>';
    s += '<path d="M64 44 L84 66 L72 72 L94 96 L36 96 Z" fill="#EEF3F6" opacity=".8"/>';
    s += '<path d="M310 40 L328 62 L318 68 L336 88 L286 88 Z" fill="#EEF3F6" opacity=".75"/>';
    // near ridge
    s += '<path d="M0 172 L58 96 L118 140 L186 74 L252 132 L318 92 L380 138 L420 112 L420 200 L0 200 Z" fill="url(#rock' + u + ')"/>';
    // the detachment scar and the mass coming down
    s += '<path d="M186 74 L212 106 L176 120 L206 152 L160 168 L188 200 L120 200 L146 152 L114 132 L150 100 Z" fill="#B99C6E" opacity=".92"/>';
    s += '<path d="M172 80 C 194 86, 210 80, 224 70" stroke="#8C2F1E" stroke-width="3" fill="none" stroke-linecap="round"/>';
    s += scatter(30, 31, function (r1, r2) {
      var x = 128 + r1 * 92, y = 96 + r2 * 100;
      return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (1 + r1 * 3.4).toFixed(1) +
        '" fill="#5A4B36" opacity="' + (0.35 + r2 * 0.45).toFixed(2) + '"/>';
    });
    // dust plume rising off the track
    for (var i = 0; i < 6; i++) {
      s += '<ellipse cx="' + (152 + i * 16) + '" cy="' + (110 - i * 9) + '" rx="' + (26 + i * 7) + '" ry="' + (14 + i * 4) +
        '" fill="#D8CFC2" opacity="' + (0.30 - i * 0.04).toFixed(2) + '"/>';
    }
    s += '<rect x="100" y="60" width="220" height="90" fill="url(#dust' + u + ')" opacity=".35"/>';
    // the works at the valley floor
    s += '<rect x="286" y="164" width="46" height="20" fill="#2C333A"/>';
    s += '<rect x="336" y="172" width="26" height="12" fill="#3A424A"/>';
    s += '<path d="M0 184 C 80 180, 160 190, 250 184 C 320 179, 370 188, 420 182 L420 200 L0 200 Z" fill="#2A3A46"/>';
    return s;
  }
};
