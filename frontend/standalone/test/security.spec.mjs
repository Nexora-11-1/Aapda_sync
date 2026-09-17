/* Injection probe.
   Taints every field a feed, an operator or a member of the public can
   put a string into, then renders every screen and every drawer and
   asserts nothing executes. It found the real ones: `toast()` put its
   arguments into innerHTML unescaped — and toast carries state notes,
   shelter names, photo credits and whatever was typed into the operator
   field — plus thirty-odd unescaped interpolations across the command
   screens and `pill()`, which renders a shelter's binding constraint. */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const PAYLOAD = `"><img src=x onerror=window.__xss('HIT')>`;
let failed = 0;
const VIEWS = ['map','cells','predictions','alerts','exposure','priority','shelters',
               'evacuation','roads','reports','hazards','sources','model','security'];

for (const v of VIEWS) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const fired = [];
  await p.exposeFunction('__xss', () => fired.push(1));
  await p.goto(new URL('../../dist/aapdasync.html', import.meta.url).href);
  await p.waitForTimeout(500);
  await p.click('.role:nth-child(1)'); await p.waitForTimeout(800);
  await p.evaluate(() => { AUTH.session = { user:'x', name:'x', role:'national_command',
    can:['read_operational','update_shelter_status','report_road_status','verify_citizen_report',
         'trigger_evacuation_plan','acknowledge_alert','read_audit'],
    district:null, issuedAt:Date.now(), absoluteExpiry:Date.now()+3.6e6,
    lastActivity:Date.now(), stepUpAt:Date.now() }; S.role='gov'; });
  // taint everything a feed could deliver
  await p.evaluate(pl => {
    S.cells.forEach(c => { c.name = pl; c.short = pl; c.cell_id = pl; });
    S.shelters.forEach(s => { s.name = pl; s.shelter_id = pl; s.binding_constraint = pl; });
    S.roads.forEach(r => { r.name = pl; r.reason = pl; r.by = pl; });
    S.alerts.forEach(a => { a.head = pl; a.auth = pl; a.inst = pl; a.area = pl; a.event = pl; a.id = pl; });
    S.reports.forEach(r => { r.desc = pl; r.loc = pl; r.cat = pl; r.by = pl; r.id = pl; });
    S.sources.forEach(s => { s.authority = pl; s.mode = pl; });
    S.models.forEach(m => { m.model_version = pl; m.algorithm = pl; });
    Object.values(S.states).forEach(st => { st.name = pl; st.note = pl; st.dis = pl; st.district = pl; });
    computePriorities(); computeRoutes();
  }, PAYLOAD);
  await p.evaluate(v => go(v), v);
  await p.waitForTimeout(700);
  // open every drawer/modal too
  await p.evaluate(() => { try { S.cellSel = S.cells[0].cell_id; openDw('cell'); } catch {} });
  await p.waitForTimeout(400);
  await p.evaluate(() => { try { S.shelterSel = S.shelters[0].shelter_id; openDw('shelter'); } catch {} });
  await p.waitForTimeout(400);
  await p.evaluate(() => { try { openDw('alerts'); } catch {} });
  await p.waitForTimeout(400);
  if (fired.length) failed++;
  console.log((fired.length ? ' XSS  ' : '  ok  ') + v);
  await p.close();
}
await b.close();
console.log(failed ? `\n${failed} screens executed the payload` : '\nno payload executed on any screen');
process.exit(failed ? 1 : 0);
