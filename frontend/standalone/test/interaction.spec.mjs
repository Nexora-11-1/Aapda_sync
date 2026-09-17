/* ══════════════════════════════════════════════════════════════════
   INTERACTION — how the page behaves under a hand, rather than what it
   renders. Three things this file exists to keep fixed:

     1. The live loop must not move the ground under the reader. It used
        to replace the whole of `main` every four seconds, which threw a
        scrolled page back to the top and deleted a half-written incident
        report.
     2. The map must not take the page's scroll. A wheel over it scrolls
        the page; only Ctrl and the wheel, or a deliberate drag, move the
        map, and one notch is a small step rather than a leap.
     3. The slideshow must be operable and must stay still when nobody is
        operating it.

   Run against the built file: `node build.js && node test/interaction.spec.mjs`
   ══════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
const ok = (n, v) => console.log((v === true ? '  ok  ' : ' FAIL ') + n + (v === true ? '' : ' → ' + JSON.stringify(v)));

await p.goto(new URL('../../dist/aapdasync.html', import.meta.url).href);
await p.waitForTimeout(700);
await p.click('.role:nth-child(1)');
await p.mouse.move(5, 5);                       // off the slideshow
await p.waitForTimeout(1200);

const top = () => p.evaluate(() => document.querySelector('.cz').scrollTop);
const zoom = () => p.evaluate(() => +currentZoom().toFixed(3));
const intoView = async sel => { await p.locator(sel).scrollIntoViewIfNeeded(); await p.waitForTimeout(300); };

console.log('\n── THE SLIDESHOW LOADS LAZILY ──');
ok('on first paint only the active slide and its neighbours are decoded', await p.evaluate(() =>
  [...document.querySelectorAll('.hslide img')].filter(i => i.getAttribute('src')).length === 3));
ok('the rest are held back with their source parked', await p.evaluate(() =>
  [...document.querySelectorAll('.hslide img')].filter(i => i.dataset.src).length ===
  document.querySelectorAll('.hslide').length - 3));

console.log('\n── THE LIVE LOOP KEEPS THE READER\'S PLACE ──');
await p.evaluate(() => document.querySelector('.cz').scrollTop = 900);
await p.waitForTimeout(200);
const t0 = await top();
await p.waitForTimeout(5200);                   // five pipeline seconds
ok('scroll position survives the live loop', Math.abs((await top()) - t0) < 4);
ok('the live loop still updates the figures', await p.evaluate(async () => {
  const before = document.getElementById('czmaptime').textContent;
  const r0 = JSON.stringify(Object.values(S.states).map(s => s.hz));
  await new Promise(r => setTimeout(r, 2600));
  return JSON.stringify(Object.values(S.states).map(s => s.hz)) !== r0 || before !== document.getElementById('czmaptime').textContent;
}));
ok('the landing page is not rebuilt by the loop', await p.evaluate(async () => {
  const el = document.getElementById('hero');
  await new Promise(r => setTimeout(r, 3200));
  return document.getElementById('hero') === el;
}));

console.log('\n── THE MAP DOES NOT TAKE THE PAGE\'S SCROLL ──');
await intoView('.czmap .cm');
let box = await p.locator('.czmap .cm').boundingBox();
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(150);
const z0 = await zoom(), s0 = await top();
for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 120); await p.waitForTimeout(60); }
await p.waitForTimeout(400);
ok('a plain wheel over the map does not zoom it', (await zoom()) === z0);
ok('a plain wheel over the map scrolls the page', (await top()) > s0);
ok('it says how to zoom instead of doing nothing', await p.evaluate(() => {
  const h = document.querySelector('.maphint');
  return !!h && h.classList.contains('on') && /Ctrl/.test(h.textContent);
}));

console.log('\n── ZOOM IS SLOW, CONTROLLED, PREDICTABLE ──');
await intoView('.czmap .cm');
box = await p.locator('.czmap .cm').boundingBox();
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
const s1 = await top(), z1 = await zoom();
await p.keyboard.down('Control');
await p.mouse.wheel(0, -100);
await p.waitForTimeout(320);
const z2 = await zoom();
await p.keyboard.up('Control');
ok('ctrl and the wheel zooms in', z2 > z1);
ok('one notch is under 16%, not a leap', (z2 / z1) < 1.16 ? true : +(z2 / z1).toFixed(3));
ok('zooming does not scroll the page', Math.abs((await top()) - s1) < 3);
ok('the zoom level readout follows', await p.evaluate(() =>
  /^[\d.]+×$/.test(document.querySelector('.czmap .zlvl').textContent)));

console.log('\n── PANNING NEEDS INTENT ──');
await p.evaluate(() => closeDw());
await intoView('.czmap .cm');
box = await p.locator('.czmap .cm').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
const vb0 = await p.evaluate(() => VBto.slice());
await p.mouse.move(cx, cy); await p.mouse.down();
await p.mouse.move(cx + 2, cy + 1); await p.mouse.move(cx + 1, cy + 2);
await p.mouse.up(); await p.waitForTimeout(200);
ok('a two-pixel twitch does not move the map',
  await p.evaluate(v => JSON.stringify(VBto) === JSON.stringify(v), vb0));
/* That twitch was a click, and a click on a state is meant to open it. */
ok('but it does still count as a click on what is under it',
  await p.evaluate(() => document.getElementById('dw').classList.contains('on')));
await p.evaluate(() => closeDw()); await p.waitForTimeout(250);
await p.mouse.move(cx, cy); await p.mouse.down();
for (let i = 1; i <= 8; i++) await p.mouse.move(cx - i * 12, cy);
await p.mouse.up(); await p.waitForTimeout(250);
ok('a deliberate drag does move it',
  await p.evaluate(v => JSON.stringify(VBto) !== JSON.stringify(v), vb0));
const zAfterPan = await zoom();
ok('panning did not change the zoom', Math.abs(zAfterPan - z2) < 0.01);
ok('panning did not open whatever was under the finger', await p.evaluate(() =>
  !document.getElementById('dw').classList.contains('on')));

console.log('\n── THE MAP IS OPERABLE FROM THE KEYBOARD ──');
await p.evaluate(() => document.querySelector('.czmap .cm').focus());
ok('the map takes focus', await p.evaluate(() => document.activeElement.classList.contains('cm')));
ok('it describes its own gestures', await p.evaluate(() =>
  /Control/.test(document.querySelector('.czmap .cm').getAttribute('aria-label') || '')));
const zk = await zoom();
await p.keyboard.press('+'); await p.waitForTimeout(340);
ok('plus zooms in', (await zoom()) > zk);
const vbk = await p.evaluate(() => VBto.slice());
await p.keyboard.press('ArrowRight'); await p.waitForTimeout(280);
ok('arrow keys pan', await p.evaluate(v => VBto[0] > v[0], vbk));
await p.keyboard.press('0'); await p.waitForTimeout(700);
ok('zero refits the view', (await zoom()) > 0);

console.log('\n── ONE FINGER SCROLLS, TWO FINGERS ZOOM ──');
ok('the map hands the one-finger gesture back to the browser', await p.evaluate(() =>
  getComputedStyle(document.querySelector('.czmap .cm')).touchAction === 'pan-y'));

console.log('\n── THE SLIDESHOW ──');
await p.evaluate(() => { closeDw(); document.querySelector('.cz').scrollTop = 0; });
await p.mouse.move(5, 5); await p.waitForTimeout(600);
ok('it is on the landing page without a click', await p.evaluate(() => !!document.getElementById('hero')));
ok('every slide has a real alt text', await p.evaluate(() =>
  [...document.querySelectorAll('.hslide img')].every(i => (i.getAttribute('alt') || '').length > 12)));
ok('every control is labelled', await p.evaluate(() =>
  [...document.querySelectorAll('#hero button')].every(b =>
    b.getAttribute('aria-label') || b.textContent.trim().length > 3)));
ok('every control is reachable by keyboard', await p.evaluate(() =>
  [...document.querySelectorAll('#hero button')].every(b => b.tabIndex >= 0)));
ok('the box is reserved before the image lands', await p.evaluate(() =>
  getComputedStyle(document.getElementById('hero')).aspectRatio.replace(/\s/g, '') === '21/9'));
ok('no photograph is stretched', await p.evaluate(() =>
  [...document.querySelectorAll('.hslide img')].every(i => getComputedStyle(i).objectFit === 'cover')));

const i0 = await p.evaluate(() => heroIdx);
ok('autoplay is running', await p.evaluate(() => !!heroTimer));
await p.waitForTimeout(7200);
ok('it advances on its own, slowly', await p.evaluate(() => heroIdx) !== i0);
await p.hover('#hero'); await p.waitForTimeout(250);
ok('a cursor over it holds it', await p.evaluate(() => !heroTimer && heroHeld));
await p.mouse.move(5, 5); await p.waitForTimeout(250);
ok('moving away resumes it', await p.evaluate(() => !!heroTimer));
await p.click('.hnavb.r'); await p.mouse.move(5, 5); await p.waitForTimeout(350);
ok('pressing next stops autoplay for good', await p.evaluate(() => !heroTimer && heroStopped));
await p.click('#heroplay'); await p.mouse.move(5, 5); await p.waitForTimeout(350);
ok('pressing play starts it again', await p.evaluate(() => !!heroTimer && !heroStopped));
await p.click('#herodots button:nth-child(3)'); await p.mouse.move(5, 5); await p.waitForTimeout(250);
ok('the indicators jump to their slide', await p.evaluate(() => heroIdx === 2));
ok('exactly one slide is shown to a screen reader', await p.evaluate(() =>
  document.querySelectorAll('.hslide.on').length === 1 &&
  document.querySelectorAll('.hslide[aria-hidden="false"]').length === 1));

console.log('\n── A HALF-WRITTEN REPORT IS NOT THROWN AWAY ──');
await p.evaluate(() => openDw('report')); await p.waitForTimeout(300);
await p.click('#rdesc');
await p.type('#rdesc', 'Water over the road by the bus stand,', { delay: 25 });
await p.waitForTimeout(2600);                          // more than two pipeline ticks
await p.type('#rdesc', ' about forty houses affected.', { delay: 25 });
await p.waitForTimeout(2600);
ok('what was typed is still there', await p.evaluate(() =>
  /bus stand/.test(document.getElementById('rdesc').value) &&
  /forty houses/.test(document.getElementById('rdesc').value)));
await p.fill('#rdesc', '');
await p.evaluate(() => { document.activeElement.blur(); submitReport(); });
await p.waitForTimeout(250);
ok('an empty description is refused at the field, not in a corner', await p.evaluate(() =>
  document.getElementById('rdesc').classList.contains('bad') &&
  document.getElementById('rerr').textContent.length > 0));
await p.selectOption('#rzone', { index: 3 });
const zone = await p.evaluate(() => document.getElementById('rzone').value);
await p.fill('#rloc', 'Near the old bridge, Ward 4');
await p.fill('#rdesc', 'The river-side railing is gone and the approach is cracked.');
const nBefore = await p.evaluate(() => S.reports.length);
await p.evaluate(() => { document.activeElement.blur(); submitReport(); });
await p.waitForTimeout(400);
ok('the report is filed', await p.evaluate(() => S.reports.length) === nBefore + 1);
ok('it carries the reader\'s own words', await p.evaluate(() => /river-side railing/.test(S.reports[0].desc)));
ok('it is filed against the zone they chose', await p.evaluate(z => S.reports[0].cell === z, zone));
ok('every report id is unique', await p.evaluate(() => new Set(S.reports.map(r => r.id)).size === S.reports.length));
ok('the assistant can retrieve it', await p.evaluate(() => {
  markRagDirty();
  const a = ragAnswer('what was reported about the river-side railing');
  return !a.refused && JSON.stringify(a.cite || []).includes('Field report');
}));

console.log('\n── NOTHING OVERFLOWS SIDEWAYS ──');
const SIZES = [[1920,1080],[1440,900],[1366,768],[1280,720],[768,1024],[430,932],[390,844]];
for (const [w, h] of SIZES) {
  await p.setViewportSize({ width: w, height: h });
  await p.waitForTimeout(500);
  const bad = [];
  for (const cz of ['home', 'alerts', 'shelters', 'prepare', 'memorial', 'relief']) {
    await p.evaluate(v => { S.cz = v; render(); }, cz);
    await p.waitForTimeout(360);
    const over = await p.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cz: (() => { const e = document.querySelector('.cz'); return e ? e.scrollWidth - e.clientWidth : 0; })()
    }));
    if (over.doc > 1 || over.cz > 1) {
      const who = await p.evaluate(() => {
        const vw = document.documentElement.clientWidth, out = [];
        document.querySelectorAll('body *').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.right > vw + 1 && r.width > 40 && !el.closest('svg'))
            out.push(el.tagName + '.' + (typeof el.className === 'string' ? el.className : '').slice(0,28) + '@' + Math.round(r.right) + 'w' + Math.round(r.width));
        });
        return out.slice(0, 6);
      });
      bad.push(cz + ':' + JSON.stringify(over) + ' ' + who.join(' | '));
    }
  }
  ok(`${w}×${h} — no horizontal overflow on any public screen`, bad.length ? bad : true);
}
await p.setViewportSize({ width: 1440, height: 900 });

console.log('\nerrors:', errs.length, errs.slice(0, 4));
await b.close();
