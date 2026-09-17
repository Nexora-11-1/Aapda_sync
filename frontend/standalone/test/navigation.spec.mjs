/* Every screen must be reachable by clicking, at every width.
   This suite exists because the public portal shipped with its only
   navigation hidden behind `@media (max-width:1720px){.hnav{display:none}}`
   — an inherited rule that is correct for District Command, which has a
   sidebar, and left the citizen portal with no navigation at all on any
   ordinary screen. Every screen worked; none of them could be got to. */
import { chromium } from 'playwright';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const url = new URL('../../dist/aapdasync.html', import.meta.url).href;
let fails = 0;
const ok = (n, v) => { if (v !== true) fails++; console.log((v === true ? '  ok  ' : ' FAIL ') + n + (v === true ? '' : ' → ' + JSON.stringify(v))); };

const CITIZEN = ['home', 'alerts', 'shelters', 'prepare', 'memorial', 'relief'];
const COMMAND = ['map', 'cells', 'predictions', 'alerts', 'exposure', 'priority', 'shelters',
                 'evacuation', 'roads', 'reports', 'hazards', 'sources', 'model', 'security'];

for (const [w, h, tag] of [[1680, 980, 'wide'], [1280, 820, 'laptop'], [900, 780, 'small'], [420, 780, 'phone']]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(url);
  await p.waitForTimeout(600);
  await p.click('.role:nth-child(1)');
  await p.waitForTimeout(1000);

  console.log(`\n── ${tag} (${w}×${h}) · public portal ──`);
  for (const v of CITIZEN) {
    const clicked = await p.evaluate(async target => {
      const btn = [...document.querySelectorAll('.cznav button')]
        .find(x => (x.getAttribute('onclick') || '').includes(`'${target}'`));
      if (!btn) return 'no visible control';
      if (btn.getBoundingClientRect().height === 0) return 'control is not visible';
      btn.click();
      return true;
    }, v);
    await p.waitForTimeout(350);
    const landed = await p.evaluate(() => S.cz);
    ok(`${v} reachable by clicking`, clicked === true && landed === v ? true : { clicked, landed });
  }
  /* Zero clicks: the slideshow must be on the page the reader lands on.
     Reachable-in-one-click was still one click too many — this is the
     thing people came back for. */
  ok('the slideshow is on the landing page with no clicks', await (async () => {
    await p.evaluate(() => { const btn = [...document.querySelectorAll('.cznav button')]
      .find(x => (x.getAttribute('onclick') || '').includes("'home'")); btn.click(); });
    await p.waitForTimeout(700);
    return p.evaluate(() => document.querySelectorAll('.galwrap .gsl').length === 10
      && document.querySelector('.gal').getBoundingClientRect().height > 200);
  })());

  ok('the gallery renders once reached', await (async () => {
    await p.evaluate(() => { const btn = [...document.querySelectorAll('.cznav button')]
      .find(x => (x.getAttribute('onclick') || '').includes("'memorial'")); btn.click(); });
    await p.waitForTimeout(600);
    return p.evaluate(() => document.querySelectorAll('.gsl').length === 10);
  })());

  console.log(`── ${tag} · District Command ──`);
  await p.evaluate(() => { S.cz = 'home'; render(); });
  await p.evaluate(() => requestRole('gov'));
  await p.waitForTimeout(400);
  await p.fill('#au', 'ndma.control'); await p.fill('#ap', 'Aapda@NDMA#2026');
  await p.click('#authgo'); await p.waitForTimeout(2000);
  await p.evaluate(() => closeM());
  let unreachable = [];
  for (const v of COMMAND) {
    const clicked = await p.evaluate(target => {
      const btn = [...document.querySelectorAll('.nav .ni')]
        .find(x => (x.getAttribute('onclick') || '').includes(`'${target}'`));
      if (!btn || btn.getBoundingClientRect().height === 0) return false;
      btn.click(); return true;
    }, v);
    await p.waitForTimeout(250);
    const landed = await p.evaluate(() => S.view);
    if (!(clicked && landed === v)) unreachable.push(v);
  }
  ok(`all ${COMMAND.length} command screens reachable by clicking`,
     unreachable.length === 0 ? true : unreachable);
  ok('no console errors', errs.length === 0 ? true : errs.slice(0, 3));
  await p.close();
}
console.log(`\n${fails === 0 ? 'all navigation reachable' : fails + ' failures'}`);
await b.close();
process.exit(fails ? 1 : 0);
