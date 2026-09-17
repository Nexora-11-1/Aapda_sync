#!/usr/bin/env node
/* Inline every asset into one portable HTML file.
   node build.js  →  ../dist/aapdasync.html
   No dependencies. Node 18+. */
const fs = require('fs');
const path = require('path');

const here = __dirname;
const read = p => fs.readFileSync(path.join(here, p), 'utf8');

let html = read('index.html');

// stylesheet
html = html.replace(
  /<link rel="stylesheet" href="src\/styles\.css">/,
  `<style>\n${read('src/styles.css')}\n</style>`
);

// ── Photographs ─────────────────────────────────────────────────────
// Any image in assets/photos/<event-id>.{jpg,jpeg,png,webp} is inlined as a
// data URI and its slide switches from the drawn illustration to the
// photograph. A photograph with no credit in credits.json is skipped rather
// than published unattributed — the illustration is the honest fallback.
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const photoDir = path.join(here, 'assets', 'photos');
const photos = {};
let skipped = [], unverified = [], bytes = 0;
if (fs.existsSync(photoDir)) {
  let credits = {};
  const creditFile = path.join(photoDir, 'credits.json');
  if (fs.existsSync(creditFile)) {
    try { credits = (JSON.parse(fs.readFileSync(creditFile, 'utf8')).photos) || {}; }
    catch (e) { console.error('credits.json is not valid JSON —', e.message); process.exit(1); }
  }
  for (const f of fs.readdirSync(photoDir)) {
    const ext = path.extname(f).toLowerCase();
    if (!MIME[ext]) continue;
    const id = path.basename(f, ext);
    const c = credits[id];
    if (!c || !c.credit || !c.licence) { skipped.push(id); continue; }
    const buf = fs.readFileSync(path.join(photoDir, f));
    bytes += buf.length;
    if (c.verified === false) unverified.push(id);
    /* w/h let the markup reserve the exact box before the image decodes, so a
       photograph never pushes the page down as it arrives; `tone` is painted
       into that reserved box so it does not flash from empty to picture. */
    photos[id] = { src: `data:${MIME[ext]};base64,${buf.toString('base64')}`,
                   credit: c.credit, licence: c.licence, source: c.source || '',
                   verified: c.verified !== false,
                   w: c.w || null, h: c.h || null, tone: c.tone || '#12202E' };
  }
}
const photoCount = Object.keys(photos).length;

// scripts, in the order index.html declares them — load order matters
const scripts = [
  'assets/india-states.js', 'src/catalogue.js', 'src/states.js', 'src/data.js', 'src/livedata.js', 'src/auth.js',
  'src/live.js', 'assets/world.js', 'src/geo.js', 'src/map.js', 'src/views.js', 'src/actions.js', 'src/citizen.js',
  'src/ui.js', 'src/rag.js', 'src/boot.js',
];   // memorial.js is inlined separately, after the photo manifest
for (const s of scripts) {
  html = html.replace(
    new RegExp(`<script src="${s.replace(/[/.]/g, m => '\\' + m)}"></script>`),
    `<script>\n${read(s)}\n</script>`
  );
}

// hand the photographs to the gallery, before the script that reads them
html = html.replace('<script src="src/memorial.js"></script>',
  `<script>window.AAPDA_PHOTOS = ${JSON.stringify(photos)};</script>\n` +
  `<script>\n${read('src/memorial.js')}\n</script>`);

const outDir = path.join(here, '..', 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'aapdasync.html');
fs.writeFileSync(out, html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`built ${path.relative(process.cwd(), out)} — ${kb} KB`);
console.log(photoCount
  ? `  ${photoCount} photograph${photoCount === 1 ? '' : 's'} embedded from assets/photos/ — ${(bytes / 1024).toFixed(0)} KB before base64`
  : '  no photographs embedded — every slide uses its drawn illustration');
if (skipped.length)
  console.log(`  skipped (no credit or licence in credits.json): ${skipped.join(', ')}`);
if (unverified.length)
  console.log(`  attribution NOT yet verified against the source file page: ${unverified.join(', ')}\n` +
              `    — these render with a visible "attribution unverified" caption. Open each file\n` +
              `      page, correct credits.json, and set "verified": true to clear it.`);
if (/<script src=|<link rel="stylesheet" href=/.test(html)) {
  console.error('WARNING: an asset was not inlined; check the filenames above.');
  process.exit(1);
}
