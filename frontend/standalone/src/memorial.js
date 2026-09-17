/* ══════════════════════════════════════════════════════════════════
   MEMORIAL & RELIEF — the public half of the platform

   Two screens that are not about prediction at all.

   `What we learned` is a record of disasters India has lived through,
   what each one cost, and the change it forced. Preparedness advice is
   ignored in the abstract and remembered when it has a face; almost
   every institution in this platform's own architecture — NDMA, the
   tsunami warning centre, the Odisha evacuation protocol — exists
   because of a specific event on this list.

   `Help the affected` routes contributions to verified official relief
   funds. It deliberately does not take a payment. A page that collects
   card or UPI details is the exact shape of the fraud that circulates
   after every Indian disaster, and a platform that teaches people to
   trust that shape has done harm that outlasts the emergency. What it
   does instead is name the authentic channel, show how to verify it,
   and hand the person to the fund's own site.
   ══════════════════════════════════════════════════════════════════ */

/* ── The record ─────────────────────────────────────────────────────
   Figures are the widely reported official ranges. Where the toll is
   contested or was never finally settled, it says so rather than
   picking the number that reads best. */
const PAST_EVENTS = [
  { id: 'latur', name: 'Latur–Killari Earthquake', year: 1993, date: '30 September 1993',
    place: 'Marathwada, Maharashtra', hazard: 'earthquake', scene: 'quake', atm: 'predawn',
    what: 'An M6.2 earthquake struck a region that the seismic zoning of the time treated as stable. It hit at 3.56 in the morning, and heavy stone-and-mud roofs collapsed onto people asleep beneath them.',
    toll: 'Around 9,700 people died and 52 villages were destroyed.',
    lesson: 'Low recorded seismicity is not the same as low seismic risk. India\'s seismic zoning maps were revised and the vulnerability of unreinforced heavy-roof masonry moved to the centre of rural building policy.',
    change: 'Seismic zoning revised · masonry retrofit programmes' },

  { id: 'odisha99', name: 'Odisha Super Cyclone', year: 1999, date: '29 October 1999',
    place: 'Coastal Odisha', hazard: 'cyclone', scene: 'cyclone', atm: 'storm',
    what: 'A super cyclone made landfall near Paradip with winds around 260 km/h and a storm surge that pushed several kilometres inland. Warnings existed; the means to move people out of the way did not.',
    toll: 'Around 9,900 people died, most of them in the surge rather than the wind.',
    lesson: 'Storm surge, not wind, is what kills in a cyclone — and evacuation is the only intervention that reliably works against it.',
    change: 'Odisha State Disaster Management Authority · the cyclone shelter network' },

  { id: 'tsunami04', name: 'Indian Ocean Tsunami', year: 2004, date: '26 December 2004',
    place: 'Tamil Nadu, Andaman & Nicobar, Kerala, Andhra, Puducherry', hazard: 'tsunami', scene: 'sea', atm: 'dawn',
    what: 'An M9.1 rupture off Sumatra sent waves across the Indian Ocean. They reached the Tamil Nadu coast in about two hours and the Andamans in minutes. There was no warning system in the Indian Ocean at all, and no one on the shore knew what the receding sea meant.',
    toll: 'More than 10,700 people died in India, with thousands more never accounted for.',
    lesson: 'A hazard nobody is watching for arrives without warning however predictable it was. Detection, and a public that recognises the sign, are separate problems and both must be solved.',
    change: 'INCOIS Indian Tsunami Early Warning Centre, operational 2007' },

  { id: 'mumbai05', name: 'Mumbai Deluge', year: 2005, date: '26 July 2005',
    place: 'Mumbai and Konkan, Maharashtra', hazard: 'flood', scene: 'urban', atm: 'monsoon',
    what: 'Santacruz recorded 944 mm of rain in 24 hours. The city\'s drainage, built for a fraction of that, backed up against a high tide; trains stopped, and hundreds of thousands of people were stranded overnight in the water.',
    toll: 'Around 1,000 people died across Maharashtra.',
    lesson: 'Urban flood risk is a drainage and land-use problem before it is a rainfall problem. Reclaimed wetland and a built-over river do not stop being a floodplain.',
    change: 'BRIMSTOWAD drainage overhaul · the Disaster Management Act, 2005 and the NDMA' },

  { id: 'kedar13', name: 'Kedarnath Flood', year: 2013, date: '16–17 June 2013',
    place: 'Chamoli, Rudraprayag and Uttarkashi, Uttarakhand', hazard: 'flood', scene: 'himalaya', atm: 'monsoon',
    what: 'Days of extreme rain, then the Chorabari lake burst above Kedarnath. A wall of water and boulders came down the Mandakini in minutes, through a valley crowded with pilgrims at the height of the season.',
    toll: 'Around 5,700 people were declared presumed dead. Many were never found.',
    lesson: 'In a Himalayan valley the warning time is minutes, not hours, and construction in the river bed removes what little there was. This is the event this platform\'s MVP district is built around.',
    change: 'Doppler radar in the hills · limits on riverbed construction · route-level pilgrim tracking' },

  { id: 'hw15', name: 'The 2015 Heatwave', year: 2015, date: 'May–June 2015',
    place: 'Andhra Pradesh, Telangana and across north India', hazard: 'heatwave', scene: 'heat', atm: 'blanched',
    what: 'Temperatures held above 45 °C for weeks. The dead were overwhelmingly outdoor labourers, the elderly and the homeless — people who could not stop working or could not get out of the sun.',
    toll: 'Around 2,400 deaths were recorded, and the true figure is very likely higher.',
    lesson: 'Heat kills quietly, one person at a time, and is under-counted everywhere. It responds to unglamorous measures: shifted working hours, water points, cooling rooms, and someone checking on the elderly.',
    change: 'Heat Action Plans, modelled on Ahmedabad\'s, adopted across states' },

  { id: 'chennai15', name: 'Chennai Floods', year: 2015, date: 'November–December 2015',
    place: 'Chennai and northern Tamil Nadu', hazard: 'flood', scene: 'delta', atm: 'overcast',
    what: 'An exceptionally strong northeast monsoon filled the reservoirs, and a large release into the Adyar met a city built across its own floodplain. Whole neighbourhoods went under for days.',
    toll: 'Around 470 people died and millions were displaced.',
    lesson: 'Reservoir release decisions are disaster decisions. Releasing late and all at once converts a managed flood into an unmanaged one.',
    change: 'Reservoir operating rules revised · wetland restoration and encroachment removal' },

  { id: 'kerala18', name: 'Kerala Floods', year: 2018, date: 'August 2018',
    place: 'Across Kerala, worst in Idukki, Wayanad and Alappuzha', hazard: 'flood', scene: 'ghats', atm: 'overcast',
    what: 'Rainfall ran far above normal for the month and dams across the state opened together. The state\'s fishing fleet took their boats inland and pulled people off roofs for days before the national teams could reach many of them.',
    toll: 'Around 480 people died and more than a million people passed through relief camps.',
    lesson: 'The first responders are always the neighbours. A plan that does not have a place for organised community rescue is a plan that ignores who actually does the rescuing.',
    change: 'Coordinated dam operation rules · fishermen formally integrated into state rescue plans' },

  { id: 'josh23', name: 'Joshimath Subsidence', year: 2023, date: 'January 2023',
    place: 'Joshimath, Chamoli, Uttarakhand', hazard: 'landslide', scene: 'subsidence', atm: 'cold',
    what: 'Cracks opened across a whole town built on old landslide debris. No single moment, no flood, no shaking — the ground simply moved, over weeks, and hundreds of buildings became unsafe.',
    toll: 'No lives were lost. Over 800 buildings were damaged and families were moved out of a town their families had lived in for generations.',
    lesson: 'Not every disaster arrives. Some accumulate, and the slow ones are the hardest to declare, because there is never an obvious day on which to act.',
    change: 'Carrying-capacity studies for Himalayan towns · subsidence monitoring' },

  { id: 'wayanad24', name: 'Wayanad Landslides', year: 2024, date: '30 July 2024',
    place: 'Chooralmala and Mundakkai, Wayanad, Kerala', hazard: 'landslide', scene: 'scar', atm: 'cold',
    what: 'After extreme rain on already saturated slopes, debris flows came down through two settlements before dawn, while people were asleep.',
    toll: 'More than 400 people died and many were never recovered.',
    lesson: 'Antecedent soil moisture matters as much as the rain falling now. A slope that has taken four days of rain fails on a fifth day that would otherwise have been survivable — which is precisely why this platform tracks 72-hour rainfall and soil moisture, not just today\'s.',
    change: 'Landslide early warning for the Western Ghats · settlement-level slope hazard mapping' }
];

/* ── Photographs, if any ────────────────────────────────────────────
   Filled by the build from assets/photos/ (see build.js). Empty means no
   photograph ships with this file and every slide renders its scene. */
const PHOTOS = (typeof window !== 'undefined' && window.AAPDA_PHOTOS) || {};

/* ── The scenes ─────────────────────────────────────────────────────
   Rendered artwork, not clip art and not photographs.

   Each is a specific place at a specific hour: the pre-dawn dark that
   Latur collapsed in, the bleached white sky of a May heatwave, the raw
   brown scar a debris flow leaves down a green Ghat slope. They are
   built from the same pieces a landscape painter uses — a graded sky,
   layered ridges that lose contrast with distance, haze, directional
   light, grain — because those are what make an image read as a place
   rather than a diagram.

   They are deliberately sober. These are events in which thousands of
   people died; the scenes show the ground and the weather, never the
   dying. No figures, no bodies, no wreckage rendered for effect. */

const ATM = {
  /* sky stops top→horizon, haze colour, light colour, light position */
  predawn:  { sky: ['#0B1524', '#1E2B3E', '#3A3B4A'], haze: '#2A3446', light: '#F0D9A8', lx: .74, ly: .30 },
  storm:    { sky: ['#141C28', '#22303F', '#3D4A57'], haze: '#2B3A48', light: '#8FA6B8', lx: .30, ly: .22 },
  dawn:     { sky: ['#1C2A46', '#5C5470', '#C98A6B'], haze: '#6E6478', light: '#FFCFA0', lx: .82, ly: .40 },
  monsoon:  { sky: ['#2C3540', '#414B57', '#5E6874'], haze: '#4A545F', light: '#B9C4CE', lx: .22, ly: .18 },
  blanched: { sky: ['#B8C2CC', '#DCD8CC', '#EFE2C4'], haze: '#D8D2C2', light: '#FFF6DC', lx: .50, ly: .16 },
  overcast: { sky: ['#4A5560', '#63707C', '#8593A0'], haze: '#6B7883', light: '#C3CED8', lx: .68, ly: .24 },
  cold:     { sky: ['#37485E', '#5C7189', '#93A6B6'], haze: '#6E8497', light: '#E4EEF6', lx: .28, ly: .20 }
};

const W = 900, H = 520;

/* ── pieces ─────────────────────────────────────────────────────── */

/** A graded sky, plus the sun or its diffusion through cloud. */
function sky(a, u) {
  return `<rect width="${W}" height="${H}" fill="url(#sky-${u})"/>
    <radialGradient id="sun-${u}" cx="${a.lx}" cy="${a.ly}" r=".55">
      <stop offset="0" stop-color="${a.light}" stop-opacity=".55"/>
      <stop offset=".35" stop-color="${a.light}" stop-opacity=".16"/>
      <stop offset="1" stop-color="${a.light}" stop-opacity="0"/>
    </radialGradient>
    <rect width="${W}" height="${H}" fill="url(#sun-${u})"/>`;
}

/** A ridge line. `seed` fixes its shape; `y` is where its crest sits;
    `k` is roughness. Distant ridges get more haze and less contrast,
    which is the whole of aerial perspective. */
function ridge(seed, y, k, fill, opacity, jag = 9) {
  let d = `M0 ${H}L0 ${y}`;
  let h = 0;
  for (let x = 0; x <= W; x += W / jag) {
    h = Math.sin((x / W) * 7 + seed) * k + Math.sin((x / W) * 17 + seed * 2.3) * k * .45;
    d += `L${x.toFixed(0)} ${(y + h).toFixed(0)}`;
  }
  return `<path d="${d}L${W} ${H}Z" fill="${fill}" fill-opacity="${opacity}"/>`;
}

/** Distance haze sitting in front of a layer. */
function haze(a, y, depth, op) {
  return `<rect x="0" y="${y}" width="${W}" height="${depth}" fill="${a.haze}" fill-opacity="${op}"/>`;
}

/** Rain, angled and varied — sheets rather than a uniform hatch. */
function rain(n, op, angle = 7) {
  let o = '';
  for (let i = 0; i < n; i++) {
    const x = (i * 137.5) % W, y = (i * 71.3) % H, len = 20 + (i % 5) * 11;
    o += `<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x - angle).toFixed(0)}" y2="${(y + len).toFixed(0)}"
      stroke="#E8F0F6" stroke-opacity="${(op * (0.35 + (i % 4) * 0.22)).toFixed(2)}" stroke-width="${i % 6 ? 1 : 1.7}" stroke-linecap="round"/>`;
  }
  return o;
}

/** Water: a body with a graded surface and a light reflection band. */
function water(y, c1, c2, a, u) {
  let o = `<rect x="0" y="${y}" width="${W}" height="${H - y}" fill="${c1}"/>
    <rect x="0" y="${y}" width="${W}" height="${H - y}" fill="url(#wgrad-${u})"/>`;
  for (let i = 0; i < 22; i++) {
    const yy = y + 6 + i * ((H - y) / 22), w = 40 + (i * 53) % 260, x = (i * 197) % W;
    o += `<rect x="${x}" y="${yy.toFixed(0)}" width="${w}" height="${1 + (i % 3)}" rx="1"
      fill="${a.light}" fill-opacity="${(0.05 + (i % 4) * 0.035).toFixed(3)}"/>`;
  }
  return o;
}

/** A row of buildings — irregular heights, a few lit windows. */
function buildings(y, count, minH, maxH, fill, lit, seed = 0) {
  let o = '';
  const bw = W / count;
  for (let i = 0; i < count; i++) {
    const r = Math.abs(Math.sin(i * 12.9898 + seed) * 43758.5453) % 1;
    const h = minH + r * (maxH - minH), x = i * bw;
    o += `<rect x="${x.toFixed(0)}" y="${(y - h).toFixed(0)}" width="${(bw - 2).toFixed(0)}" height="${h.toFixed(0)}" fill="${fill}"/>`;
    if (lit) {
      const rows = Math.floor(h / 22), cols = Math.max(1, Math.floor(bw / 16));
      for (let ry = 0; ry < rows; ry++) for (let cx = 0; cx < cols; cx++) {
        const on = Math.abs(Math.sin((i * 7 + ry * 3 + cx * 11 + seed) * 12.9898) * 43758.5) % 1;
        if (on > 0.55) o += `<rect x="${(x + 5 + cx * 14).toFixed(0)}" y="${(y - h + 9 + ry * 22).toFixed(0)}"
          width="6" height="8" fill="${lit}" fill-opacity="${(0.35 + on * 0.5).toFixed(2)}"/>`;
      }
    }
  }
  return o;
}

/** Coconut palm — a real silhouette, not a lollipop. */
function palm(x, y, s, lean, c) {
  let fronds = '';
  for (let i = 0; i < 7; i++) {
    const a = -150 + i * 30 + lean * 14;
    const r = (a * Math.PI) / 180;
    const tx = Math.cos(r) * 34 * s, ty = Math.sin(r) * 26 * s;
    fronds += `<path d="M0 0Q${(tx * .5 - ty * .28).toFixed(1)} ${(ty * .5 + tx * .12).toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}"
      fill="none" stroke="${c}" stroke-width="${(2.6 * s).toFixed(1)}" stroke-linecap="round"/>`;
  }
  return `<g transform="translate(${x} ${y})">
    <path d="M0 0Q${(lean * 9).toFixed(1)} ${(-26 * s).toFixed(1)} ${(lean * 15).toFixed(1)} ${(-52 * s).toFixed(1)}"
      fill="none" stroke="${c}" stroke-width="${(3.4 * s).toFixed(1)}" stroke-linecap="round"/>
    <g transform="translate(${(lean * 15).toFixed(1)} ${(-52 * s).toFixed(1)})">${fronds}</g></g>`;
}

/** Film grain and a vignette — what separates a rendering from a diagram. */
const finish = u => `
  <rect width="${W}" height="${H}" filter="url(#grain-${u})" opacity=".16"/>
  <rect width="${W}" height="${H}" fill="url(#vig-${u})"/>`;

/* ── the ten places ─────────────────────────────────────────────── */
const SCENES = {

  /* Latur, 3.56 a.m. Flat Deccan farmland, heavy stone-and-mud roofs. */
  quake: (a, u) => `${sky(a, u)}
    ${ridge(1.2, 286, 12, '#1A2432', .85, 8)}
    ${haze(a, 278, 30, .32)}
    ${ridge(3.7, 326, 7, '#131B27', .95, 6)}
    <!-- the black-soil plain, in bands so it has ground rather than a floor -->
    <rect x="0" y="356" width="${W}" height="${H - 356}" fill="#242830"/>
    <path d="M0 392q160 -14 320 2t300 -10 280 8V${H}H0Z" fill="#20242B"/>
    <path d="M0 440q180 -12 360 4t260 -8 280 6V${H}H0Z" fill="#1B1F26"/>
    <rect x="0" y="356" width="${W}" height="${H - 356}" fill="url(#ground-${u})"/>
    <!-- field boundaries running to the horizon -->
    ${[0, 1, 2, 3, 4].map(i =>
      `<path d="M${-60 + i * 230} ${H}L${300 + i * 70} 360" stroke="#31343C" stroke-opacity=".5" stroke-width="1.6"/>`).join('')}
    <!-- houses: single-storey, heavy roofs, several no longer standing square -->
    ${[[74, 404, 1, -8], [186, 396, .82, 5], [300, 414, 1.12, -11], [418, 400, .9, 3],
       [548, 420, 1.05, -6], [672, 402, .86, 9], [806, 416, .95, -4]].map(([x, y, s2, rot]) =>
      `<g transform="translate(${x} ${y}) rotate(${rot})">
        <rect x="${-34 * s2}" y="${-25 * s2}" width="${68 * s2}" height="${25 * s2}" fill="#2E2C2E"/>
        <path d="M${-41 * s2} ${-25 * s2}L0 ${-43 * s2}L${41 * s2} ${-25 * s2}Z" fill="#17181C"/>
        <path d="M${-41 * s2} ${-25 * s2}L${41 * s2} ${-25 * s2}" stroke="#0C0D10" stroke-width="${2 * s2}"/>
        <rect x="${-7 * s2}" y="${-15 * s2}" width="${11 * s2}" height="${15 * s2}" fill="#0B0D11"/>
        <ellipse cx="0" cy="${2 * s2}" rx="${46 * s2}" ry="${6 * s2}" fill="#0E1014" fill-opacity=".5"/></g>`).join('')}
    <!-- dust still in the air an hour later, catching the one lamp -->
    <ellipse cx="300" cy="386" rx="180" ry="42" fill="#6E6552" fill-opacity=".2"/>
    <ellipse cx="560" cy="398" rx="140" ry="30" fill="#6E6552" fill-opacity=".14"/>
    <circle cx="742" cy="392" r="3.4" fill="#FFD489"/>
    <circle cx="742" cy="392" r="15" fill="#FFD489" fill-opacity=".14"/>
    <circle cx="742" cy="392" r="34" fill="#FFD489" fill-opacity=".05"/>
    ${finish(u)}`,

  /* Coastal Odisha under a super cyclone — surge, not wind, is the killer. */
  cyclone: (a, u) => `${sky(a, u)}
    <g opacity=".85">
      ${[0, 1, 2, 3, 4, 5].map(i => {
        const r = 78 + i * 52;
        return `<ellipse cx="330" cy="150" rx="${r}" ry="${r * .42}" fill="none"
          stroke="#5F7285" stroke-opacity="${(0.30 - i * 0.038).toFixed(2)}" stroke-width="${(20 - i * 2.4).toFixed(1)}"
          transform="rotate(${-16 + i * 7} 330 150)"/>`;
      }).join('')}
      <ellipse cx="330" cy="150" rx="34" ry="15" fill="#0E1620" fill-opacity=".55"/>
    </g>
    ${haze(a, 210, 90, .34)}
    ${ridge(2.1, 300, 5, '#1D2B36', .9, 5)}
    ${water(320, '#1A2A34', '#243C48', a, u)}
    ${[[70, 336, .9, 1.5], [150, 330, .7, 1.8], [780, 340, 1, 1.6], [850, 332, .8, 1.9]]
      .map(([x, y, s, l]) => palm(x, y, s, l, '#101A22')).join('')}
    ${[[300, 352], [420, 366], [540, 358], [640, 372]].map(([x, y], i) =>
      `<g transform="translate(${x} ${y})" opacity=".8">
        <path d="M-26 0h52l-6-13h-40Z" fill="#182530"/>
        <path d="M-30 -13 0 -25 30 -13Z" fill="#0F1A23"/></g>`).join('')}
    ${rain(150, .5, 26)}
    ${finish(u)}`,

  /* 26 December 2004. Morning. The sea goes out, then comes back. */
  sea: (a, u) => `${sky(a, u)}
    ${haze(a, 176, 76, .26)}
    <path d="M0 256h${W}v${H - 256}H0Z" fill="#14384A"/>
    <path d="M0 256h${W}v${H - 256}H0Z" fill="url(#wgrad-${u})"/>
    <path d="M0 288q120 -12 236 4t210 -8 226 12 228 -10" fill="none" stroke="#8FB6C6" stroke-opacity=".22" stroke-width="2"/>

    <!-- the swell: a long shoulder that steepens and curls at the left -->
    <path d="M0 344C60 344 96 256 176 232 262 206 322 268 400 292 486 318 560 300 640 306 730 312 812 330 900 322V${H}H0Z"
      fill="#0D5570"/>
    <path d="M0 358C64 356 104 282 180 260 264 236 320 292 398 314 482 338 556 322 636 328 728 334 814 350 900 342V${H}H0Z"
      fill="#0A425A" fill-opacity=".95"/>
    <!-- the lip, curling forward, with the sun behind it -->
    <path d="M176 232C238 214 286 240 312 276 274 244 226 240 190 266 168 282 158 308 158 330 148 296 150 254 176 232Z"
      fill="#EAF3F8" fill-opacity=".72"/>
    <path d="M186 250C232 236 268 256 288 282 258 260 222 258 196 278 182 290 176 306 176 322 168 296 168 264 186 250Z"
      fill="#BFD9E6" fill-opacity=".5"/>
    <!-- spray off the crest -->
    ${[[196, 226, 5], [222, 214, 4], [252, 216, 3.4], [280, 226, 2.8], [166, 244, 3.6], [308, 240, 2.4]]
      .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#F2F8FB" fill-opacity=".45"/>`).join('')}
    <!-- foam where the swell has already run in -->
    <path d="M0 394q120 -18 244 2t222 -12 208 16 226 -8" fill="none" stroke="#E8F3F8" stroke-opacity=".42" stroke-width="4" stroke-linecap="round"/>
    <path d="M0 412q140 -12 268 6t214 -8 200 12 218 -6" fill="none" stroke="#E8F3F8" stroke-opacity=".24" stroke-width="2.6"/>

    <rect x="0" y="440" width="${W}" height="${H - 440}" fill="#96876B"/>
    <rect x="0" y="440" width="${W}" height="${H - 440}" fill="url(#ground-${u})"/>
    ${[[96, 486, 1.0, -1.3], [232, 476, .8, -1.7], [716, 482, .9, 1.4], [852, 470, .72, 1.8]]
      .map(([x, y, s2, l]) => palm(x, y, s2, l, '#20301F')).join('')}
    <g transform="translate(452 480) rotate(-27)">
      <path d="M-54 0q54 21 108 0-15 16-54 16T-54 0Z" fill="#26323A"/>
      <path d="M-6 -2v-34" stroke="#26323A" stroke-width="3.2"/></g>
    <g transform="translate(614 498) rotate(16)">
      <path d="M-40 0q40 16 80 0-11 12-40 12T-40 0Z" fill="#2E3A43"/></g>
    ${finish(u)}`,

  /* 26 July 2005. 944 mm in a day, meeting a high tide. */
  urban: (a, u) => `${sky(a, u)}
    ${haze(a, 150, 110, .30)}
    ${buildings(300, 22, 60, 190, '#26313C', null, 3)}
    ${haze(a, 250, 62, .34)}
    ${buildings(342, 15, 80, 230, '#1B242E', '#F2C572', 9)}
    ${water(342, '#1E2A33', '#2E3F4B', a, u)}
    ${[[120, 356], [300, 366], [520, 360], [700, 370]].map(([x, y]) =>
      `<g transform="translate(${x} ${y})" opacity=".9">
        <rect x="-30" y="-16" width="60" height="16" rx="3" fill="#141C24"/>
        <rect x="-20" y="-25" width="40" height="10" rx="2" fill="#141C24"/></g>`).join('')}
    <g opacity=".5">${[160, 340, 560, 740].map(x =>
      `<ellipse cx="${x}" cy="392" rx="72" ry="8" fill="#F2C572" fill-opacity=".22"/>`).join('')}</g>
    ${rain(200, .55, 9)}
    ${finish(u)}`,

  /* The Mandakini valley, June 2013. Steep walls, no warning time. */
  himalaya: (a, u) => `${sky(a, u)}
    <!-- the far wall: real ridges, not triangles — a crest line that
         rises and falls the way a range actually does -->
    <path d="M0 236 58 178 92 206 132 132 176 172 214 116 258 158 300 96 348 148 392 110 436 166
             480 122 520 176 566 130 610 186 656 140 700 194 748 152 792 200 840 162 900 208V${H}H0Z"
      fill="#4C5D74" fill-opacity=".62"/>
    <path d="M258 158 300 96 348 148 320 152 300 128 282 152Z" fill="#EEF3F8" fill-opacity=".8"/>
    <path d="M132 132 176 172 152 174 138 152Z" fill="#EEF3F8" fill-opacity=".62"/>
    <path d="M480 122 520 176 496 178 484 148Z" fill="#EEF3F8" fill-opacity=".58"/>
    ${haze(a, 160, 108, .42)}
    <path d="M0 272 64 226 118 274 178 220 238 280 296 228 358 288 420 236 482 292 546 240
             608 296 672 244 734 300 796 250 860 302 900 276V${H}H0Z" fill="#334458"/>
    <path d="M0 332 74 296 148 344 224 300 300 350 378 306 456 356 534 310 612 358 690 314
             768 360 846 318 900 344V${H}H0Z" fill="#26364A"/>
    ${haze(a, 306, 54, .20)}
    <!-- the valley floor, and the river taking it -->
    <path d="M0 400q100 -28 210 -6t200 -24 190 32 300 -18V${H}H0Z" fill="#3E3122"/>
    <path d="M0 418q110 -24 220 -2t200 -20 190 28 290 -14V${H}H0Z" fill="#7A5F38"/>
    <path d="M0 436q120 -18 240 2t210 -14 200 20 250 -8V${H}H0Z" fill="#9A7A48" fill-opacity=".9"/>
    ${[0, 1, 2, 3].map(i =>
      `<path d="M0 ${446 + i * 16}q130 -14 258 2t212 -12 200 18 230 -8" fill="none"
        stroke="#C0A068" stroke-opacity="${(0.30 - i * 0.05).toFixed(2)}" stroke-width="${2.4 - i * 0.4}"/>`).join('')}
    ${[[124, 460, 10], [268, 484, 15], [402, 456, 8], [524, 492, 18], [664, 464, 11], [800, 486, 13], [860, 456, 8]]
      .map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="${r * 1.55}" ry="${r}" fill="#241C12" fill-opacity=".85"/>`).join('')}
    <!-- a shrine on the far bank, the scale of the valley against it -->
    <g transform="translate(706 332)" opacity=".92">
      <path d="M-15 0h30v-24l-15-17-15 17Z" fill="#1E2530"/>
      <path d="M0 -47v-13" stroke="#1E2530" stroke-width="2.8" stroke-linecap="round"/>
      <ellipse cx="0" cy="2" rx="24" ry="4" fill="#141A22" fill-opacity=".5"/></g>
    ${rain(85, .28, 5)}
    ${finish(u)}`,

  /* May 2015. Weeks above 45 °C. The sky goes white, not blue. */
  heat: (a, u) => `${sky(a, u)}
    <circle cx="${W * .5}" cy="${H * .17}" r="46" fill="#FFF8E2" fill-opacity=".95"/>
    <circle cx="${W * .5}" cy="${H * .17}" r="92" fill="#FFF0C4" fill-opacity=".28"/>
    <circle cx="${W * .5}" cy="${H * .17}" r="150" fill="#FFEDBC" fill-opacity=".13"/>
    ${haze(a, 250, 80, .5)}
    <path d="M0 316h900v${H - 316}H0Z" fill="#C6A971"/>
    <path d="M0 316h900v${H - 316}H0Z" fill="url(#ground-${u})"/>
    <g opacity=".5">${[330, 348, 366, 386].map((y, i) =>
      `<path d="M0 ${y}q60 -${3 + i} 120 0t120 0 120 0 120 0 120 0 120 0 120 0" fill="none"
        stroke="#FFF6DC" stroke-opacity=".45" stroke-width="${1.6 - i * .25}"/>`).join('')}</g>
    ${[[70, 470], [190, 452], [300, 486], [440, 460], [560, 492], [700, 466], [820, 480]]
      .map(([x, y], i) => `<path d="M${x} ${y}l${18 + i * 4} ${-6 - i}l${14} ${9}"
        fill="none" stroke="#8E7448" stroke-opacity=".55" stroke-width="1.6"/>`).join('')}
    <g transform="translate(742 318)">
      <path d="M0 0v-58" stroke="#4E4128" stroke-width="5" stroke-linecap="round"/>
      <path d="M0 -58q-32 -10 -46 8M0 -58q34 -12 48 6M0 -46q-26 -4 -38 12M0 -46q28 -6 40 10"
        fill="none" stroke="#4E4128" stroke-width="3.4" stroke-linecap="round"/>
      <ellipse cx="6" cy="4" rx="40" ry="7" fill="#7A6440" fill-opacity=".38"/></g>
    <ellipse cx="180" cy="326" rx="120" ry="7" fill="#FFFDF2" fill-opacity=".28"/>
    ${finish(u)}`,

  /* Chennai, December 2015. A city across its own floodplain. */
  delta: (a, u) => `${sky(a, u)}
    ${haze(a, 170, 90, .32)}
    ${buildings(292, 18, 40, 120, '#3A454F', null, 5)}
    ${haze(a, 250, 50, .30)}
    ${buildings(330, 11, 54, 150, '#2A353F', '#E8C98A', 2)}
    ${water(336, '#2A3A3A', '#3D5450', a, u)}
    <g opacity=".85">${[[150, 372], [330, 390], [560, 380], [742, 396]].map(([x, y]) =>
      `<g transform="translate(${x} ${y})">
        <path d="M-34 0q34 13 68 0-9 12-34 12T-34 0Z" fill="#1B252B"/>
        <path d="M0 -2v-20" stroke="#1B252B" stroke-width="2.4"/>
        <ellipse cx="0" cy="14" rx="44" ry="4" fill="#0F171B" fill-opacity=".3"/></g>`).join('')}</g>
    ${[[80, 348], [250, 344], [470, 350], [660, 346], [840, 352]].map(([x, y]) =>
      `<g transform="translate(${x} ${y})">
        <rect x="-12" y="-30" width="24" height="30" fill="#1E2A30" fill-opacity=".9"/>
        <path d="M-16 -30 0 -42 16 -30Z" fill="#151F25"/></g>`).join('')}
    ${rain(120, .38, 8)}
    ${finish(u)}`,

  /* The Ghats in flood, August 2018 — and in failure, July 2024. */
  ghats: (a, u) => `${sky(a, u)}
    <path d="M0 200q86 -104 182 -52t166 -40 176 56 200 -46 176 60V${H}H0Z" fill="#3E5C46" fill-opacity=".8"/>
    ${haze(a, 168, 92, .38)}
    <path d="M0 252q106 -80 218 -28t180 -44 190 58 312 -28V${H}H0Z" fill="#33513C"/>
    <path d="M0 300q120 -56 246 -12t200 -34 200 44 254 -20V${H}H0Z" fill="#264034"/>
    ${[[70, 318, .8, -1], [176, 310, .65, -1.4], [690, 322, .9, 1.2], [812, 312, .7, .9]]
      .map(([x, y, s2, l]) => palm(x, y, s2, l, '#16261C')).join('')}
    ${water(330, '#4C4A32', '#6B6440', a, u)}
    <path d="M0 356q140 -14 268 4t220 -12 200 16 212 -8" fill="none" stroke="#A08F5E" stroke-opacity=".35" stroke-width="2.5"/>
    ${[[150, 386], [430, 404], [700, 392]].map(([x, y]) =>
      `<g transform="translate(${x} ${y})">
        <path d="M-38 0q38 14 76 0-10 12-38 12T-38 0Z" fill="#1C2620"/>
        <path d="M0 -2v-22" stroke="#1C2620" stroke-width="2.6"/>
        <path d="M-46 6q46 10 92 0" fill="none" stroke="#CBBF92" stroke-opacity=".4" stroke-width="2"/></g>`).join('')}
    ${[[90, 352], [300, 348], [560, 356], [790, 350]].map(([x, y]) =>
      `<g transform="translate(${x} ${y})">
        <rect x="-15" y="-24" width="30" height="24" fill="#2A3830" fill-opacity=".92"/>
        <path d="M-20 -24 0 -38 20 -24Z" fill="#1D2A23"/></g>`).join('')}
    ${rain(110, .32, 6)}
    ${finish(u)}`,

  /* Wayanad, before dawn. A slope that had taken four days of rain, and
     the raw scar a debris flow leaves through standing forest. */
  scar: (a, u) => `${sky(a, u)}
    <path d="M0 186q90 -100 190 -46t170 -42 180 58 200 -44 160 62V${H}H0Z" fill="#3A5642" fill-opacity=".8"/>
    ${haze(a, 156, 92, .38)}
    <path d="M0 238q110 -76 224 -22t184 -44 194 58 298 -24V${H}H0Z" fill="#2E4A36"/>
    <path d="M0 300q124 -56 252 -8t204 -34 204 44 240 -16V${H}H0Z" fill="#22392C"/>
    <path d="M0 372q130 -40 262 -6t206 -26 200 34 232 -14V${H}H0Z" fill="#1A2E23"/>

    <!-- the failure: narrow at the crown, fanning out below, drawn over
         every green layer because that is what a debris flow does to them -->
    <path d="M470 206 L494 206 L560 380 L640 ${H} L286 ${H} L404 380 Z" fill="#4E3A22"/>
    <path d="M474 214 L490 214 L546 380 L612 ${H} L318 ${H} L418 380 Z" fill="#8A6B41"/>
    <path d="M478 224 L487 224 L532 380 L584 ${H} L350 ${H} L432 380 Z" fill="#AD8A55" fill-opacity=".85"/>
    <!-- lateral scarps: the fresh edges where the ground tore -->
    <path d="M470 206 L404 380 L286 ${H}" fill="none" stroke="#3A2A18" stroke-width="3" stroke-opacity=".8"/>
    <path d="M494 206 L560 380 L640 ${H}" fill="none" stroke="#3A2A18" stroke-width="3" stroke-opacity=".8"/>
    <!-- flow lines down the fan -->
    ${[0, 1, 2, 3, 4].map(i => {
      const t = -0.6 + i * 0.3;
      return `<path d="M${(482 + t * 8).toFixed(0)} 230 Q${(482 + t * 60).toFixed(0)} 370 ${(482 + t * 150).toFixed(0)} ${H}"
        fill="none" stroke="#6E5330" stroke-opacity=".5" stroke-width="2"/>`;
    }).join('')}
    <!-- boulders carried down and dropped on the fan -->
    ${[[400, 456, 10], [468, 490, 15], [534, 462, 9], [356, 502, 12], [590, 498, 13], [500, 424, 7]]
      .map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="${r * 1.55}" ry="${r}" fill="#2C2216" fill-opacity=".85"/>`).join('')}
    <!-- the crown, where it detached -->
    <path d="M466 206q14 -18 32 -2-16 -4 -32 2Z" fill="#D6E0E4" fill-opacity=".35"/>
    <!-- forest still standing on either side -->
    ${[[110, 340, .8, -1], [196, 356, .7, -1.3], [700, 346, .85, 1.1], [820, 336, .68, .8]]
      .map(([x, y, s2, l]) => palm(x, y, s2, l, '#14231A')).join('')}
    ${rain(70, .24, 5)}
    ${finish(u)}`,

  /* Joshimath, January 2023. Nothing arrives. The ground simply moves. */
  subsidence: (a, u) => `${sky(a, u)}
    <!-- the wall above the town, in real light -->
    <path d="M0 190 62 124 108 158 158 90 208 140 262 78 316 132 372 96 424 148 480 104
             534 156 590 112 646 164 704 120 760 172 818 128 900 178V${H}H0Z"
      fill="#5E7186" fill-opacity=".55"/>
    <path d="M262 78 316 132 288 136 268 108Z" fill="#F4F8FB" fill-opacity=".88"/>
    <path d="M158 90 208 140 180 142 164 116Z" fill="#F4F8FB" fill-opacity=".72"/>
    <path d="M480 104 534 156 506 158 488 130Z" fill="#F4F8FB" fill-opacity=".62"/>
    ${haze(a, 132, 108, .40)}
    <path d="M0 250 90 202 190 258 290 206 396 264 500 212 604 268 710 216 812 270 900 236V${H}H0Z" fill="#48607A"/>
    <path d="M0 316 110 274 240 330 370 280 500 336 630 286 760 340 900 300V${H}H0Z" fill="#374C64"/>

    <!-- the town, built on old landslide debris, terraced down the slope.
         Depth comes from size and height, not from a row. -->
    ${[[112, 372, .70], [214, 356, .60], [318, 388, .80], [176, 414, .92], [286, 432, 1.0],
       [402, 366, .66], [462, 404, .86], [396, 452, 1.08], [548, 380, .72], [596, 424, .94],
       [520, 462, 1.12], [672, 372, .64], [736, 408, .84], [664, 456, 1.04], [826, 392, .74],
       [846, 442, .98]].map(([x, y, s2], i) => {
      const tilt = [3, -2, 5, -4, 2, -3, 6, -5, 1, -2, 4, -3, 2, -6, 3, -2][i];
      return `<g transform="translate(${x} ${y}) rotate(${tilt})">
        <ellipse cx="0" cy="${3 * s2}" rx="${34 * s2}" ry="${5 * s2}" fill="#1C2836" fill-opacity=".45"/>
        <rect x="${-24 * s2}" y="${-32 * s2}" width="${48 * s2}" height="${32 * s2}" fill="#D9E1E9"/>
        <rect x="${-24 * s2}" y="${-32 * s2}" width="${48 * s2}" height="${32 * s2}" fill="url(#ground-${u})" fill-opacity=".5"/>
        <path d="M${-29 * s2} ${-32 * s2}L0 ${-49 * s2}L${29 * s2} ${-32 * s2}Z" fill="#8E553A"/>
        <rect x="${-15 * s2}" y="${-25 * s2}" width="${9 * s2}" height="${11 * s2}" fill="#2A3948"/>
        <rect x="${5 * s2}" y="${-25 * s2}" width="${9 * s2}" height="${11 * s2}" fill="#2A3948"/>
        <path d="M${-24 * s2} ${-28 * s2}l${13 * s2} ${9 * s2}l${-7 * s2} ${7 * s2}l${15 * s2} ${11 * s2}"
          fill="none" stroke="#7C6152" stroke-width="${1.5 * s2}" stroke-opacity=".95"/>
        <path d="M${9 * s2} ${-32 * s2}l${-5 * s2} ${13 * s2}l${8 * s2} ${9 * s2}"
          fill="none" stroke="#7C6152" stroke-width="${1.2 * s2}" stroke-opacity=".8"/></g>`;
    }).join('')}

    <!-- the fissure: it runs through the town, not below it -->
    <path d="M0 404 74 396 132 418 208 400 262 424 336 402 398 430 470 406 540 434 618 408
             690 438 764 412 838 440 900 420" fill="none" stroke="#101823" stroke-width="7"
      stroke-opacity=".9" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M0 404 74 396 132 418 208 400 262 424 336 402 398 430 470 406 540 434 618 408
             690 438 764 412 838 440 900 420" fill="none" stroke="#7E6A54" stroke-width="2.2"
      stroke-opacity=".65" stroke-linejoin="round"/>
    <!-- and the branches that opened off it -->
    <path d="M132 418 118 476 96 ${H}M336 402 352 470 334 ${H}M540 434 556 486 542 ${H}M764 412 748 474 762 ${H}"
      fill="none" stroke="#101823" stroke-width="3.6" stroke-opacity=".7"/>
    ${finish(u)}`
};

/* Kerala 2018 and Wayanad 2024 are both Western Ghats rain, and they are
   not the same disaster: one is water standing across a landscape, the
   other is a slope that failed. They get their own scenes. */

function sceneSVG(ev) {
  const a = ATM[ev.atm] || ATM.overcast;
  const f = SCENES[ev.scene] || SCENES.himalaya;
  /* Ten of these sit in the DOM at once. SVG defs live in one document-wide
     id space, so a shared id means every scene resolves to the first one's
     gradient — which is how all ten ended up wearing Latur's night sky. */
  const u = ev.id;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img"
    aria-label="Rendered scene of the ${esc(ev.name)}, ${ev.year} — an illustration, not a photograph">
    <defs>
      <linearGradient id="sky-${u}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${a.sky[0]}"/>
        <stop offset=".55" stop-color="${a.sky[1]}"/>
        <stop offset="1" stop-color="${a.sky[2]}"/>
      </linearGradient>
      <linearGradient id="wgrad-${u}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${a.light}" stop-opacity=".22"/>
        <stop offset="1" stop-color="#000" stop-opacity=".28"/>
      </linearGradient>
      <linearGradient id="ground-${u}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${a.light}" stop-opacity=".14"/>
        <stop offset="1" stop-color="#000" stop-opacity=".34"/>
      </linearGradient>
      <radialGradient id="vig-${u}" cx=".5" cy=".46" r=".78">
        <stop offset=".55" stop-color="#000" stop-opacity="0"/>
        <stop offset="1" stop-color="#000" stop-opacity=".42"/>
      </radialGradient>
      <filter id="grain-${u}" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" seed="${ev.year % 97}"/>
        <feColorMatrix type="saturate" values="0"/>
      </filter>
    </defs>
    ${f(a, u)}
  </svg>`;
}

/* ── The 3D gallery ─────────────────────────────────────────────── */
let galIdx = 0, galTimer = null, galDrag = null;
/* Bumped whenever the photograph set changes. paintGallery only moves the
   slides — recreating them on every step would kill the transition and the
   carousel would jump instead of glide — so the media is rebuilt only when
   this says it is out of date. */
let photoRev = 0;

function viewMemorial() {
  return `${guideStrip('memorial')}
  <div class="memhead">
    <h2>What we learned</h2>
    <p>Disasters India has lived through, and the change each one forced. Almost every institution
    that issues the warnings on this platform exists because of an event on this list.</p>
  </div>
  ${galleryBlock(false)}
  ${illustrationNote()}`;
}

/** What this build actually ships, said accurately — which means the note
    has to be derived from the photographs rather than written once and
    left to go stale. */
function illustrationNote() {
  const withPhoto = PAST_EVENTS.filter(e => photoFor(e.id));
  const unver = withPhoto.filter(e => photoFor(e.id).verified === false);
  const drawn = PAST_EVENTS.length - withPhoto.length;
  return `<div class="illnote">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-5-5-6 6"/></svg>
    <div>${withPhoto.length
      ? `<b>${withPhoto.length} of these ${PAST_EVENTS.length} slides carry a photograph; the other
         ${drawn} are drawn illustrations and say so.</b>
         Every photograph is shown with the credit and licence recorded for it, because an
         unattributed image captioned with a real disaster's name would be a fabricated record.
         ${unver.length ? `<b>${unver.length} of them are marked <i>attribution unverified</i></b> —
           the credit has not yet been checked against the source file page. Open the page named in
           the caption, correct <code>assets/photos/credits.json</code> and set
           <code>"verified": true</code> to clear the mark.` : ''}`
      : `<b>These are drawn illustrations. No photographs are shipped with this build.</b>
         Photographs of these events belong to the people who took them, so none are bundled —
         an unattributed image captioned with a real disaster's name would be a fabricated record.`}
    Add your own: drop one on any slide with <b>Add a photo</b>, give it a credit and a licence,
    and it appears immediately. To make it permanent, put the file in
    <code>assets/photos/</code>, record it in <code>credits.json</code> and rebuild.
    <div class="illact">
      <button class="b p" onclick="openPhotoDialog(PAST_EVENTS[galIdx].id)">Add a photo to this slide</button>
      <button class="b g" onclick="exportCredits()">Export credits.json</button>
    </div></div>
  </div>`;
}

function slide(e, i) {
  const p = photoFor(e.id);
  const h = HAZ[e.hazard];
  return `<figure class="gsl" data-i="${i}" onclick="galTo(${i})">
    <div class="slmedia"${p && p.tone ? ` style="background:${esc(p.tone)}"` : ''}>
      ${p ? `<img src="${esc(p.src)}" alt="${esc(e.name)}, ${e.year} — ${esc(e.place)}"
               ${p.w && p.h ? `width="${p.w}" height="${p.h}"` : ''} loading="lazy" decoding="async">`
          : sceneSVG(e)}
      <div class="slyear m">${e.year}</div>
      <div class="slhz" style="background:${h.c}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${h.ic}"/></svg>
        ${esc(h.name)}</div>
      <figcaption class="slcap${p && p.verified === false ? ' unver' : ''}">${p
        ? `Photograph · ${esc(p.credit)} · ${esc(p.licence)}${p.source ? ' · ' + esc(p.source) : ''}` +
          (p.verified === false ? '<b>attribution unverified</b>' : '')
        : 'Illustration, not a photograph'}</figcaption>
      <button class="slphoto" title="${p ? 'Replace this photograph' : 'Add a photograph'}"
              onclick="event.stopPropagation();openPhotoDialog('${e.id}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-5-5-6 6"/></svg>
        ${p ? 'Replace' : 'Add a photo'}</button>
    </div>
    <div class="slbody">
      <b>${esc(e.name)}</b>
      <span class="slplace">${esc(e.place)}</span>
    </div>
  </figure>`;
}

function paintGallery() {
  const stage = $('galstage'); if (!stage) return;
  const n = PAST_EVENTS.length;

  /* a photograph was added or removed since these slides were built */
  if (stage.dataset.rev !== String(photoRev)) {
    stage.dataset.rev = String(photoRev);
    stage.innerHTML = PAST_EVENTS.map((e, i) => slide(e, i)).join('');
  }
  stage.querySelectorAll('.gsl').forEach((el, i) => {
    let off = i - galIdx;
    if (off > n / 2) off -= n;
    if (off < -n / 2) off += n;
    const abs = Math.abs(off);
    el.style.transform =
      `translateX(${off * 58}%) translateZ(${-abs * 190}px) rotateY(${off * -32}deg) scale(${1 - abs * 0.06})`;
    el.style.zIndex = String(50 - abs);
    el.style.opacity = abs > 3 ? '0' : String(1 - abs * 0.16);
    el.style.pointerEvents = abs > 3 ? 'none' : 'auto';
    el.classList.toggle('on', off === 0);
    el.setAttribute('aria-hidden', off === 0 ? 'false' : 'true');
  });
  const dots = $('galdots');
  if (dots) dots.querySelectorAll('button').forEach((b, i) =>
    b.setAttribute('aria-selected', String(i === galIdx)));
  const cnt = $('galcount');
  if (cnt) cnt.textContent = `${galIdx + 1} / ${n}`;

  const e = PAST_EVENTS[galIdx], h = HAZ[e.hazard];
  const d = $('galdet');
  if (d) d.innerHTML = `
    <div class="gdh">
      <span class="gdy m">${e.year}</span>
      <h3>${esc(e.name)}</h3>
      <span class="gdd">${esc(e.date)} · ${esc(e.place)}</span>
    </div>
    <div class="gdg">
      <div><div class="gdl">What happened</div><p>${esc(e.what)}</p></div>
      <div><div class="gdl">The cost</div><p class="gdt">${esc(e.toll)}</p></div>
      <div><div class="gdl">What it taught</div><p>${esc(e.lesson)}</p></div>
    </div>
    <div class="gdc" style="border-color:${h.c}33">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${h.c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      <span><b>What changed afterwards</b> — ${esc(e.change)}</span>
    </div>`;
  say(`${esc(e.name)}, ${e.year}`);
}

function galTo(i) {
  const n = PAST_EVENTS.length;
  galIdx = ((i % n) + n) % n;
  paintGallery();
}
function galGo(d) { galTo(galIdx + d); }
function galToggle() {
  const b = $('galplay');
  if (galTimer) {
    clearInterval(galTimer); galTimer = null;
    b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7Z"/></svg>';
  } else {
    galTimer = setInterval(() => galGo(1), 6000);
    b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  }
}
function galDown(ev) { galDrag = { x: ev.clientX, moved: 0 }; }
function galMove(ev) { if (galDrag) galDrag.moved = ev.clientX - galDrag.x; }
function galUp() {
  if (galDrag && Math.abs(galDrag.moved) > 40) galGo(galDrag.moved < 0 ? 1 : -1);
  galDrag = null;
}
document.addEventListener('keydown', ev => {
  if (S.role !== 'citizen' || S.cz !== 'memorial') return;
  if (ev.key === 'ArrowLeft') galGo(-1);
  if (ev.key === 'ArrowRight') galGo(1);
});

/* ══════════════════════════════════════════════════════════════════
   RELIEF — giving, without becoming the thing that steals

   Every entry routes to the fund's own official site. This platform
   takes no payment, holds no payment instrument, and shows no account
   number or UPI address of its own, because the fraud that follows an
   Indian disaster looks exactly like a page that does.
   ══════════════════════════════════════════════════════════════════ */

/* `link: null` is deliberate and load-bearing. Where a fund's official
   donation URL has not been verified for this deployment, the card says
   so and sends the person to search the state government's own site,
   rather than guessing a URL. A wrong link here costs someone money. */
const RELIEF = {
  national: [
    { name: 'Prime Minister\'s National Relief Fund (PMNRF)',
      link: 'https://pmnrf.gov.in',
      who: 'Government of India',
      what: 'Immediate relief to families of those killed and to people affected by major natural disasters. Also covers medical treatment costs for the poor.',
      tax: '100% deduction under section 80G', verified: true },
    { name: 'PM CARES Fund',
      link: 'https://www.pmcares.gov.in',
      who: 'Government of India',
      what: 'Emergency and distress relief, including support for affected populations and creation of relief infrastructure.',
      tax: '100% deduction under section 80G', verified: true },
    { name: 'Chief Minister\'s Relief Fund — the affected state',
      link: null,
      who: 'The state government where the disaster is active',
      what: 'State-level relief, usually the fastest route to the affected district. Each state runs its own fund with its own portal.',
      tax: 'Usually 100% under 80G — confirm on the state\'s own page', verified: false }
  ],
  organisations: [
    { name: 'Indian Red Cross Society', link: 'https://www.indianredcross.org',
      what: 'First aid, blood supply, relief material and ambulance services through state and district branches.', tag: 'Statutory body' },
    { name: 'Goonj', link: 'https://goonj.org',
      what: 'Material relief — clothing, family kits, rebuilding — routed through village-level work rather than handouts.', tag: 'Material relief' },
    { name: 'SEEDS India', link: 'https://www.seedsindia.org',
      what: 'Shelter, rebuilding and community risk reduction in disaster-affected districts.', tag: 'Shelter & rebuilding' },
    { name: 'HelpAge India', link: 'https://www.helpageindia.org',
      what: 'Relief targeted at elderly people, who are consistently the worst affected and the least reached.', tag: 'Elderly care' }
  ]
};

const IN_KIND = [
  ['What is almost always needed', [
    'Clean drinking water and the means to treat it',
    'Dry rations that need no cooking',
    'Tarpaulin, rope and ground sheets',
    'Sanitary pads, soap, and baby food',
    'Mosquito nets, in flood districts especially',
    'Torches, power banks and charging cables'
  ]],
  ['What usually does more harm than good', [
    'Used clothing not sorted, sized or cleaned',
    'Perishable cooked food sent long distance',
    'Medicines without a prescribing doctor at the receiving end',
    'Unannounced convoys — they block the roads rescue needs',
    'Volunteers arriving without being asked for by the district'
  ]]
];

const FRAUD_SIGNS = [
  ['A number circulating on WhatsApp',
   'Relief fraud spreads fastest through forwards. A genuine fund is on the state or central government website; a forward is not evidence of anything.'],
  ['A UPI ID that looks personal',
   'Official funds collect through institutional accounts. A VPA that resolves to an individual\'s name is not a relief fund.'],
  ['Urgency and a countdown',
   'Real relief funds do not run out in the next twenty minutes. Pressure to pay immediately is the tell.'],
  ['A near-miss domain',
   'Check the address bar. Official Indian government funds sit on gov.in or nic.in domains, not on a lookalike with an extra word.'],
  ['A request for an OTP or your card PIN',
   'No fund, bank or government office will ever ask for these. Nobody needs your OTP to accept a donation.']
];

function viewRelief() {
  const worst = S.latest;
  return `${guideStrip('relief')}
  <div class="memhead">
    <h2>Help the affected</h2>
    <p>Money, goods and time, routed to channels that are actually verified — and how to tell the
    real ones from the fraud that follows every disaster.</p>
  </div>

  <div class="notpay">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    <div><b>This page never takes your money.</b> It has no payment form, no account number and no UPI
    address of its own — because that is exactly what the fraudulent pages look like. Every link below
    goes to the fund's own official website, where you can check the address bar yourself before you pay.</div>
  </div>

  ${worst ? `<div class="reliefnow">
    <span class="rn-l">Where help is most needed right now</span>
    <b>${esc(worst.name)}</b>
    <span class="rn-d">${esc(HAZ[worst.hazard].name)} · ${esc(S.states[worst.state] ? S.states[worst.state].dis : '')}</span>
    <span class="rn-n">Give to that state's Chief Minister's Relief Fund for the fastest route to the district, or to a national fund below.</span>
  </div>` : ''}

  <h3 class="rsec">Official relief funds</h3>
  <div class="rgrid">
    ${RELIEF.national.map(f => `
      <div class="rcard${f.verified ? '' : ' unver'}">
        <div class="rch">
          <b>${esc(f.name)}</b>
          ${f.verified ? '<span class="rv">Verified link</span>' : '<span class="ru">Link not configured</span>'}
        </div>
        <span class="rwho">${esc(f.who)}</span>
        <p>${esc(f.what)}</p>
        <div class="rtax">${esc(f.tax)}</div>
        ${f.link
          ? `<a class="rgo" href="${esc(f.link)}" target="_blank" rel="noopener noreferrer">
              Give on the official site
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg></a>`
          : `<div class="rno">This deployment has not had a verified URL configured for the state fund.
             Open the affected state government's own website and find the relief fund there —
             do not follow a link from a message.</div>`}
      </div>`).join('')}
  </div>

  <h3 class="rsec">Relief organisations working on the ground</h3>
  <div class="rgrid three">
    ${RELIEF.organisations.map(o => `
      <div class="rcard sm">
        <div class="rch"><b>${esc(o.name)}</b><span class="rtag">${esc(o.tag)}</span></div>
        <p>${esc(o.what)}</p>
        <a class="rgo" href="${esc(o.link)}" target="_blank" rel="noopener noreferrer">Open their site
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg></a>
      </div>`).join('')}
  </div>
  <div class="rnote">These are long-established organisations that work in Indian disaster response. Listing
  is not endorsement by any authority — check any organisation's registration and its FCRA status before
  giving, as you would with any charity.</div>

  <h3 class="rsec">Giving goods instead of money</h3>
  <div class="kgrid">
    ${IN_KIND.map(([h, items], i) => `
      <div class="kcard ${i ? 'bad' : 'good'}">
        <b>${esc(h)}</b>
        <ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>`).join('')}
  </div>
  <div class="rnote">Money almost always helps more than goods, because it can be spent on what is
  actually short in that district this week and it does not need a truck. If you do send material,
  send what the district administration has asked for, and send it where they have asked for it.</div>

  <h3 class="rsec">Before you give — how relief fraud works</h3>
  <div class="fgrid">
    ${FRAUD_SIGNS.map(([h, b]) => `
      <div class="fcard">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--crit)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
        <div><b>${esc(h)}</b><span>${esc(b)}</span></div>
      </div>`).join('')}
  </div>

  <h3 class="rsec">Giving your time</h3>
  <div class="vgrid">
    ${[['Register before you travel',
        'Districts run volunteer registration through the DDMA. Turning up unregistered adds a person to feed and a vehicle to the road, and takes capacity away from the response.'],
       ['Aapda Mitra and Civil Defence',
        'NDMA\'s community volunteer scheme trains people in their own district, before anything happens. That training is what makes a volunteer useful on the day.'],
       ['Give blood where you live',
        'Blood cannot be moved quickly into a cut-off district. Donating in your own city keeps the national supply where transfers can draw on it.'],
       ['Help after the cameras leave',
        'Rebuilding takes years and attention lasts weeks. Support committed months after the event is worth more per rupee than support in the first week.']
      ].map(([h, b]) => `<div class="vcard"><b>${esc(h)}</b><span>${esc(b)}</span></div>`).join('')}
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════
   ADDING PHOTOGRAPHS FROM THE BROWSER

   The build-time route (assets/photos/ + credits.json + rebuild) makes a
   photograph part of the distributed file, which is what you want for a
   real deployment. It is also three steps and a toolchain, which is the
   wrong answer for someone who just wants to see their own photographs
   on these slides.

   So: drop an image on a slide, type the credit, and it renders. Stored
   in this browser via IndexedDB, resized on the way in so a 12 MP phone
   photograph does not sit in storage at full size.

   The one rule the build enforces is enforced here too — a photograph
   with no credit and licence recorded is not displayed. It is the same
   rule for the same reason, and it is not softened because this path is
   more convenient.

   `Export credits.json` writes out exactly what the build needs, so
   anything added this way can be promoted into the real build.
   ══════════════════════════════════════════════════════════════════ */

const PHOTO_DB = 'aapdasync.photos';
let localPhotos = {};          // event id → { src, credit, licence, source }

function photoStore(mode = 'readonly') {
  return new Promise((res, rej) => {
    const req = indexedDB.open(PHOTO_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id' });
    req.onsuccess = () => {
      try { res(req.result.transaction('photos', mode).objectStore('photos')); }
      catch (e) { rej(e); }
    };
    req.onerror = () => rej(req.error);
  });
}

async function loadLocalPhotos() {
  try {
    const store = await photoStore();
    const all = await new Promise((res, rej) => {
      const r = store.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    localPhotos = {};
    for (const row of all) localPhotos[row.id] = row;
    if (all.length) photoRev++;      // slides built before this must be rebuilt
  } catch (e) {
    /* private mode, or storage disabled — the build-time photos and the
       illustrations still work, so this is not an error worth shouting about */
    localPhotos = {};
  }
}

/** Build-time photographs win; anything added in this browser layers on top. */
const photoFor = id => PHOTOS[id] || localPhotos[id] || null;

/** Down-scale on the way in. A phone photograph is 4–8 MB; none of that
    resolution survives a 420 px slide, and IndexedDB is not the place to
    keep it. */
function shrink(file, maxW = 1400) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('could not read the file'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error('that file is not an image this browser can read'));
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.82));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

async function savePhoto(id, row) {
  localPhotos[id] = row;
  try {
    const store = await photoStore('readwrite');
    store.put({ id, ...row });
  } catch (e) {
    toast('Not saved for next time',
      'This browser will not let the page store files, so the photograph is showing now ' +
      'but will be gone on reload. The build-time route in assets/photos/ is unaffected.', 'warn');
  }
}

async function removePhoto(id) {
  delete localPhotos[id];
  try { (await photoStore('readwrite')).delete(id); } catch (e) { /* nothing to undo */ }
  photoRev++;
  paintGallery();
  toast('Photograph removed', 'The slide is back to its illustration.', 'info');
}

/* ── The dialog ──────────────────────────────────────────────────── */
let pendingPhoto = null;

function openPhotoDialog(id, file) {
  const ev = PAST_EVENTS.find(e => e.id === id);
  if (!ev) return;
  pendingPhoto = { id, file, src: null };
  const existing = photoFor(id);
  const fromBuild = !!PHOTOS[id];

  openMHTML(`
    <div class="mh">
      <div class="mi" style="background:var(--pris);color:var(--pri)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-5-5-6 6"/></svg>
      </div>
      <div><h2>Photograph — ${esc(ev.name)}, ${ev.year}</h2>
        <p>${esc(ev.place)}</p></div>
    </div>
    <div class="mb">
      ${fromBuild ? `<div class="note i" style="margin-bottom:12px">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
        <span>This slide already has a photograph built into the file from
        <span class="m">assets/photos/</span>. Anything you add here shows only in this browser
        and does not replace it in the build.</span></div>` : ''}

      <div class="drop" id="pdrop" onclick="document.getElementById('pfile').click()">
        <input type="file" id="pfile" accept="image/*" hidden onchange="photoChosen(this.files[0])">
        <div id="ppreview">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--t3)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M8 8l4-4 4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
          <b>Drop a photograph here, or click to choose one</b>
          <span>JPEG, PNG or WebP. It is resized to 1400 px and kept in this browser.</span>
        </div>
      </div>

      <label class="fl" style="margin-top:14px" for="pcred">Credit — who took it <span class="req">required</span></label>
      <input class="fi" id="pcred" placeholder="e.g. Indian Air Force / PIB" value="${esc((existing && existing.credit) || '')}">

      <label class="fl" style="margin-top:11px" for="plic">Licence <span class="req">required</span></label>
      <input class="fi" id="plic" placeholder="e.g. Public domain · GODL-India · CC BY-SA 4.0" value="${esc((existing && existing.licence) || '')}">

      <label class="fl" style="margin-top:11px" for="psrc">Where it came from <span style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--t3)">optional</span></label>
      <input class="fi" id="psrc" placeholder="e.g. Wikimedia Commons" value="${esc((existing && existing.source) || '')}">

      <div class="note" style="margin-top:13px">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
        <span><b>Only use an image you have the right to publish.</b> Credit and licence are
        required before the photograph is shown — the same rule the build applies — because an
        unattributed image captioned with a real disaster's name is a fabricated record.
        Public-domain government imagery (PIB, ISRO/NRSC, NDRF, NASA) and Creative Commons
        photographs on Wikimedia Commons are the usual sources.</span>
      </div>

      <div class="mf" style="margin-top:16px">
        ${localPhotos[id] ? `<button class="btn dang b d" onclick="closeM();removePhoto('${id}')">Remove</button>` : ''}
        <span style="flex:1"></span>
        <button class="b g" onclick="closeM()">Cancel</button>
        <button class="b p" id="psave" onclick="commitPhoto('${id}')">Use this photograph</button>
      </div>
    </div>`);

  const drop = $('pdrop');
  ['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => {
    ev.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => {
    ev.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', ev => {
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) photoChosen(f);
  });
  if (file) photoChosen(file);
}

async function photoChosen(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    toast('Not an image', 'Choose a JPEG, PNG or WebP file.', 'warn');
    return;
  }
  const prev = $('ppreview');
  prev.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
  try {
    const src = await shrink(file);
    pendingPhoto.src = src;
    const kb = Math.round(src.length * 0.75 / 1024);
    prev.innerHTML = `<img src="${src}" alt="preview">
      <span class="pmeta">${esc(file.name)} · ${kb} KB after resizing · click to replace</span>`;
  } catch (e) {
    prev.innerHTML = `<b style="color:var(--crit)">${esc(e.message)}</b>
      <span>Try a different file.</span>`;
  }
}

async function commitPhoto(id) {
  const credit = $('pcred').value.trim();
  const licence = $('plic').value.trim();
  const source = $('psrc').value.trim();
  const existing = localPhotos[id];
  const src = (pendingPhoto && pendingPhoto.src) || (existing && existing.src);

  if (!src) { toast('No image yet', 'Choose or drop a photograph first.', 'warn'); return; }
  if (!credit || !licence) {
    toast('Credit and licence are required',
      'A photograph of a real disaster without an attribution is a fabricated record. ' +
      'Fill in who took it and under what licence, and it will appear on the slide.', 'warn');
    ($('pcred').value.trim() ? $('plic') : $('pcred')).focus();
    return;
  }

  await savePhoto(id, { src, credit, licence, source });
  pendingPhoto = null;
  photoRev++;
  closeM();
  paintGallery();
  toast('Photograph added',
    `${PAST_EVENTS.find(e => e.id === id).name} now shows your photograph, credited to ` +
    `${credit}. Export credits.json from the gallery to make it part of the build.`, 'ok');
}

/** Write out what the build needs, so a photograph added here can be made
    permanent rather than living only in one browser. */
function exportCredits() {
  const ids = Object.keys(localPhotos);
  if (!ids.length) {
    toast('Nothing to export', 'No photographs have been added in this browser yet.', 'info');
    return;
  }
  const photos = {};
  for (const id of ids) {
    const p = localPhotos[id];
    photos[id] = { credit: p.credit, licence: p.licence, source: p.source || '' };
  }
  const blob = JSON.stringify({ photos }, null, 2);
  openMHTML(`
    <div class="mh">
      <div class="mi" style="background:var(--pris);color:var(--pri)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>
      </div>
      <div><h2>Make these part of the build</h2>
        <p>${ids.length} photograph${ids.length === 1 ? '' : 's'} added in this browser.</p></div>
    </div>
    <div class="mb">
      <ol class="steps">
        <li>Save each image into <span class="m">frontend/standalone/assets/photos/</span>,
            named after its event: ${ids.map(i => `<span class="m">${esc(i)}.jpg</span>`).join(', ')}.</li>
        <li>Replace <span class="m">assets/photos/credits.json</span> with the JSON below.</li>
        <li>Run <span class="m">node build.js</span>. The build embeds each one and prints how many it took.</li>
      </ol>
      <textarea class="fi code" readonly rows="12" onclick="this.select()">${esc(blob)}</textarea>
      <div class="note i" style="margin-top:12px">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
        <span>The build skips any image whose credit or licence is missing from that file, and
        says which it skipped — the same rule this dialog applies.</span>
      </div>
      <div class="mf" style="margin-top:14px"><button class="b p" onclick="closeM()">Done</button></div>
    </div>`);
}
