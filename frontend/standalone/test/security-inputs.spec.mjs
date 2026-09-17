/* The same probe, driven through the actual input surfaces a person
   touches: the incident report form, the assistant box, the photo
   credit fields, and the sign-in operator id. */
/* Try to inject through every field a person can type into. */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
let fired = [];
await p.exposeFunction('__xss', where => fired.push(where));
const PAYLOAD = `"><img src=x onerror=window.__xss('img')><svg onload=window.__xss('svg')>`;
p.on('dialog', d => { fired.push('dialog:' + d.message); d.dismiss(); });
p.on('pageerror', e => { if (!/xss/i.test(e.message)) fired.push('ERR ' + e.message); });

await p.goto(new URL('../../dist/aapdasync.html', import.meta.url).href);
await p.waitForTimeout(600);
await p.click('.role:nth-child(1)'); await p.waitForTimeout(1000);

// 1 — citizen incident report
await p.evaluate(() => openDw('report')); await p.waitForTimeout(400);
const fields = await p.$$('#dwc input, #dwc textarea, #dwc select');
for (const f of fields) { try { await f.fill(PAYLOAD); } catch {} }
await p.evaluate(() => { const b=[...document.querySelectorAll('#dwc button')].find(x=>/submit/i.test(x.textContent)); if(b) b.click(); });
await p.waitForTimeout(900);
console.log('after report submit  :', fired.length ? fired : 'no execution');

// 2 — the assistant
await p.evaluate(() => { if (!S.chat) toggleChat(); });
await p.waitForTimeout(300);
await p.evaluate(pl => askAssistant(pl), PAYLOAD);
await p.waitForTimeout(900);
console.log('after assistant query:', fired.length ? fired : 'no execution');

// 3 — photo credit / licence / source
await p.evaluate(() => { S.cz='memorial'; render(); }); await p.waitForTimeout(700);
await p.evaluate(() => openPhotoDialog(PAST_EVENTS[0].id)); await p.waitForTimeout(400);
await p.setInputFiles('#pfile', new URL('./fixtures/testphoto.png', import.meta.url).pathname);
await p.waitForTimeout(800);
await p.fill('#pcred', PAYLOAD); await p.fill('#plic', PAYLOAD); await p.fill('#psrc', PAYLOAD);
await p.click('#psave'); await p.waitForTimeout(1000);
console.log('after photo credit   :', fired.length ? fired : 'no execution');

// 4 — sign-in operator id (goes into error copy and the audit log)
await p.evaluate(() => { endSession('t'); openSignIn(); }); await p.waitForTimeout(400);
await p.fill('#au', PAYLOAD); await p.fill('#ap', PAYLOAD);
await p.click('#authgo'); await p.waitForTimeout(2500);
console.log('after bad sign-in    :', fired.length ? fired : 'no execution');

// 5 — the audit log rendering that id
await p.evaluate(() => { AUTH.session = { user:'x', name:'x', role:'national_command', can:['read_operational'],
  district:null, issuedAt:Date.now(), absoluteExpiry:Date.now()+3.6e6, lastActivity:Date.now(), stepUpAt:Date.now() };
  S.role='gov'; S.view='security'; render(); });
await p.waitForTimeout(700);
console.log('after audit render   :', fired.length ? fired : 'no execution');

// 6 — a state name / cell name arriving from a feed
await p.evaluate(pl => { S.cells[0].name = pl; S.states.ut.note = pl; S.alerts[0].head = pl;
  S.roads[0].name = pl; S.shelters[0].name = pl; S.view='cells'; render(); go('roads'); go('shelters'); go('alerts'); }, PAYLOAD);
await p.waitForTimeout(900);
console.log('after tainted feed   :', fired.length ? fired : 'no execution');

console.log('\nRESULT:', fired.length === 0 ? 'no payload executed anywhere' : 'EXECUTION: ' + JSON.stringify(fired));
await b.close();
process.exit(fired.length ? 1 : 0);
