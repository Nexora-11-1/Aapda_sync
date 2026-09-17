/* The clock is an input.
   A risk surface that opens with the same figures in February and July is
   not live, it is a screenshot that animates. This asserts that the whole
   picture — scores, situation labels, alert severities, the narrative and
   the timeline — moves together with the season, and that none of them
   can drift out of step with the others. */
import { chromium } from 'playwright';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const url = new URL('../../dist/aapdasync.html', import.meta.url).href;
let fails = 0;
const ok = (n, v) => { if (v !== true) fails++; console.log((v === true ? '  ok  ' : ' FAIL ') + n + (v === true ? '' : ' → ' + JSON.stringify(v))); };

async function at(ms) {
  const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(`{ const R = Date; const F = ${ms};
    class D extends R { constructor(...a){ if(!a.length) super(F); else super(...a); } static now(){ return F; } }
    window.Date = D; }`);
  await p.goto(url);
  await p.waitForTimeout(900);
  const snap = await p.evaluate(() => ({
    season: seasonLabel()[0],
    hz: Object.fromEntries(['flood','heatwave','cyclone','wildfire','landslide']
      .map(h => [h, Math.round(Object.values(S.states).map(s => s.hz[h] ?? 0)
        .reduce((a, c) => a + c, 0) / Object.keys(S.states).length)])),
    utDis: S.states.ut.dis, utFlood: S.states.ut.hz.flood, utNote: S.states.ut.note,
    sev: S.alerts.map(a => a.sev),
    worst: Object.values(S.states).map(s => ({ n: s.name, v: Math.max(...Object.values(s.hz)) }))
      .sort((a, c) => c.v - a.v)[0].n,
    newestAge: (S.national[0] || {}).age,
    timeline: (S.timeline[0] || {}).x || ''
  }));
  await p.close();
  return { ...snap, errs };
}

const feb = await at(Date.UTC(2026, 1, 2, 22, 30));   // 03 Feb, 04:00 IST
const may = await at(Date.UTC(2026, 4, 15, 9, 30));   // 15 May, 15:00 IST
const jul = await at(Date.UTC(2026, 6, 28, 12, 30));  // 28 Jul, 18:00 IST
const nov = await at(Date.UTC(2026, 10, 12, 3, 30));  // 12 Nov, 09:00 IST

console.log('── the season is read correctly ──');
ok('February is winter', feb.season === 'Winter' ? true : feb.season);
ok('May is pre-monsoon', may.season === 'Pre-monsoon' ? true : may.season);
ok('July is the southwest monsoon', jul.season === 'Southwest monsoon' ? true : jul.season);
ok('November is post-monsoon', nov.season === 'Post-monsoon' ? true : nov.season);

console.log('── the surface moves with it ──');
ok('flood peaks in the monsoon', jul.hz.flood > may.hz.flood && may.hz.flood > feb.hz.flood
   ? true : [feb.hz.flood, may.hz.flood, jul.hz.flood]);
ok('heat peaks before the monsoon', may.hz.heatwave > jul.hz.heatwave && may.hz.heatwave > feb.hz.heatwave
   ? true : [feb.hz.heatwave, may.hz.heatwave, jul.hz.heatwave]);
ok('cyclone peaks after it', nov.hz.cyclone > jul.hz.cyclone ? true : [jul.hz.cyclone, nov.hz.cyclone]);
ok('fire season is not the monsoon', may.hz.wildfire > jul.hz.wildfire
   ? true : [may.hz.wildfire, jul.hz.wildfire]);
ok('the worst-hit state differs by season',
   new Set([feb.worst, may.worst, jul.worst, nov.worst]).size >= 3
   ? true : [feb.worst, may.worst, jul.worst, nov.worst]);

console.log('── and the words move with the figures ──');
ok('an out-of-season state is not "in flood"',
   feb.utFlood < 60 && !/Flood \+/.test(feb.utDis) ? true : [feb.utFlood, feb.utDis]);
ok('the flood narrative is not told out of season',
   !/Alaknanda above danger level/.test(feb.utNote) ? true : feb.utNote.slice(0, 60));
ok('it is told in season',
   /Alaknanda above danger level/.test(jul.utNote) ? true : jul.utNote.slice(0, 60));
ok('no Extreme warning for a quiet hazard',
   !feb.sev.includes('Extreme') ? true : feb.sev);
ok('Extreme warnings appear in the monsoon',
   jul.sev.includes('Extreme') ? true : jul.sev);
ok('a severe situation was warned about recently',
   jul.newestAge < feb.newestAge ? true : [jul.newestAge, feb.newestAge]);
ok('the timeline does not narrate an event that is not happening',
   !/escalated to/.test(feb.timeline) ? true : feb.timeline.slice(0, 70));

console.log('── and nothing throws ──');
for (const [n, r] of [['February', feb], ['May', may], ['July', jul], ['November', nov]])
  ok(`${n} renders without error`, r.errs.length === 0 ? true : r.errs.slice(0, 2));

console.log(`\n${fails === 0 ? 'the picture is the season' : fails + ' failures'}`);
await b.close();
process.exit(fails ? 1 : 0);
