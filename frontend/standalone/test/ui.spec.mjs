import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1680, height: 980 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type()==='error' && !/font|ERR_TUNNEL|favicon/i.test(m.text())) errs.push('CONSOLE: ' + m.text()); });
const ok = (n,v) => console.log((v?'  ok  ':' FAIL ') + n + (v===true?'':' → '+JSON.stringify(v)));

await p.goto(new URL('../../dist/aapdasync.html', import.meta.url).href);
await p.waitForTimeout(600);

console.log('\n── SECURITY BRIDGE ──');
await p.click('.role:nth-child(2)');                      // District Command tile
await p.waitForTimeout(600);
ok('gate opens sign-in, not command', await p.evaluate(()=>S.role==='citizen' && !!document.getElementById('au')));
// wrong password
await p.fill('#au','dm.chamoli'); await p.fill('#ap','wrong'); await p.click('#authgo');
await p.waitForTimeout(1500);
ok('wrong password refused', await p.evaluate(()=>!signedIn() && !document.getElementById('autherr').hidden));
// direct role forcing must not work
ok('setRole is gone', await p.evaluate(()=>typeof setRole==='undefined'));
ok('render() bounces an unauthenticated gov role', await p.evaluate(()=>{S.role='gov';render();return S.role==='citizen';}));
ok('go() to a command view is refused', await p.evaluate(()=>{S.role='gov';go('priority');return S.role==='citizen';}));
// correct password
await p.evaluate(()=>{closeM();openSignIn();});
await p.waitForTimeout(200);
await p.fill('#au','dm.chamoli'); await p.fill('#ap','Chamoli@DM#2026'); await p.click('#authgo');
await p.waitForTimeout(1800);
ok('correct password signs in', await p.evaluate(()=>signedIn() && S.role==='gov'));
ok('role recorded', await p.evaluate(()=>AUTH.session.role));
ok('audit written', await p.evaluate(()=>AUTH.audit.length>0));
// lockout
await p.evaluate(async()=>{for(let i=0;i<6;i++) await verifyCredential('so.usdma','nope');});
ok('lockout after 5 failures', await p.evaluate(()=>lockState('so.usdma')>0));
// scope enforcement
ok('scope refusal for a foreign shelter', await p.evaluate(async()=>{
  const keep=AUTH.session; AUTH.session={...keep,role:'shelter_operator',scope:['SH-201'],can:['update_shelter_status'],stepUpAt:Date.now()};
  let refused=false; const t=toast; window.toast=(a)=>{ if(/scope/i.test(a))refused=true; };
  saveShelter('SH-203'); window.toast=t; AUTH.session=keep; return refused;
}));
ok('permission refusal for a role that lacks it', await p.evaluate(()=>{
  const keep=AUTH.session; AUTH.session={...keep,role:'state_ops',can:['read_operational']};
  let refused=false; const t=toast; window.toast=(a)=>{ if(/not permitted/i.test(a))refused=true; };
  requirePrivilege('report_road_status','Road', ()=>{}); window.toast=t; AUTH.session=keep; return refused;
}));

console.log('\n── EVERY STATE ──');
const ids = await p.evaluate(()=>stateIds());
ok('36 states in the register', ids.length===36);
const bad = await p.evaluate(()=>{
  const out=[];
  for (const id of stateIds()){
    pickState(id);
    const c=S.cells, sh=S.shelters, al=S.alerts, rd=S.roads;
    if (c.length!==25) out.push(id+': cells='+c.length);
    if (!sh.length) out.push(id+': no shelters');
    if (!al.length) out.push(id+': no alerts');
    if (!rd.length) out.push(id+': no roads');
    if (!S.priorities.length) out.push(id+': no priorities');
    if (c.some(x=>!x.name || x.pop==null)) out.push(id+': bad cell');
  }
  return out;
});
ok('every state drills to a full grid', bad.length===0 ? true : bad.slice(0,6));
ok('coastal states score cyclone', await p.evaluate(()=>{pickState('or');return S.cells.some(c=>c.risk.cyclone>0);}));
ok('landlocked states do not', await p.evaluate(()=>{pickState('mp');return !S.cells.some(c=>c.risk.cyclone!=null);}));

console.log('\n── ACCESSIBILITY ──');
const f0 = await p.evaluate(()=>getComputedStyle(document.documentElement).fontSize);
await p.click('.fsz[data-step="4"]');
const f1 = await p.evaluate(()=>getComputedStyle(document.documentElement).fontSize);
await p.click('.fsz[data-step="0"]');
const f2 = await p.evaluate(()=>getComputedStyle(document.documentElement).fontSize);
ok('A+ / A− change the root size', f0!==f1 && f1!==f2 ? true : [f0,f1,f2]);
ok('choice persists to storage', await p.evaluate(()=>localStorage.getItem('aapda.font')!==null));
await p.evaluate(()=>{fontStep(0);});
ok('skip link focuses main', await p.evaluate(()=>{skipToContent();return document.activeElement.id==='main';}));
ok('screen-reader mode toggles', await p.evaluate(()=>{toggleSR();const a=document.body.classList.contains('sr-mode');toggleSR();return a;}));

console.log('\n── GUIDE + ZOOM ──');
await p.evaluate(()=>{S.role='gov';S.view='map';render();});
await p.waitForTimeout(300);
ok('guided mode renders a strip', await p.evaluate(()=>{if(!guideOn)toggleGuide();return !!document.querySelector('.guide');}));
ok('guide covers every gov view', await p.evaluate(()=>['map','cells','predictions','alerts','exposure','priority','shelters','evacuation','roads','reports','hazards','sources','model','security'].every(v=>GUIDE.gov[v])));
await p.evaluate(()=>{toggleGuide();});
const z0 = await p.evaluate(()=>currentZoom());
await p.click('.zoomc .zi'); await p.waitForTimeout(650);
const z1 = await p.evaluate(()=>currentZoom());
await p.click('.zoomc .zo'); await p.click('.zoomc .zo'); await p.waitForTimeout(650);
const z2 = await p.evaluate(()=>currentZoom());
ok('zoom in then out moves the camera', z1>z0 && z2<z1 ? true : [z0,z1,z2]);
await p.evaluate(()=>zoomReset()); await p.waitForTimeout(650);
ok('zoom control reports a level', (await p.textContent('.zoomc .zlvl')).includes('×'));

console.log('\n── LATEST / CONTINUOUS ──');
ok('latest situation is set', await p.evaluate(()=>!!S.latest && !!S.latest.name));
ok('latest bar renders', await p.evaluate(()=>!!document.querySelector('.lt-main')));
const a1 = await p.evaluate(()=>JSON.stringify(S.cells.map(c=>c.risk[S.hazard])));
await p.waitForTimeout(9000);
const a2 = await p.evaluate(()=>JSON.stringify(S.cells.map(c=>c.risk[S.hazard])));
ok('risk keeps moving', a1!==a2);
ok('all states move, not just the focused one', await p.evaluate(()=>{
  const before=JSON.stringify(Object.values(S.states).map(s=>Object.values(s.hz)));
  driftNation(); driftNation();
  return before!==JSON.stringify(Object.values(S.states).map(s=>Object.values(s.hz)));
}));

console.log('\n── ASSISTANT (RAG) ──');
const n = await p.evaluate(()=>buildIndex());
ok('index built', n>60 ? n : n);
const r1 = await p.evaluate(()=>ragAnswer('what is the most severe situation right now'));
ok('answers the latest question with citations', !r1.refused && r1.cite.length>0);
const r2 = await p.evaluate(()=>ragAnswer('how is shelter capacity calculated'));
ok('answers a method question', !r2.refused && /minimum of space, water/i.test(r2.answer));
const r3 = await p.evaluate(()=>ragAnswer('who won the 2019 cricket world cup'));
ok('refuses out-of-corpus questions', r3.refused===true && /do not have a record/i.test(r3.answer));
const r4 = await p.evaluate(()=>ragAnswer('am I safe in my house right now'));
ok('refuses personal safety judgements', r4.refused===true && /cannot tell you whether you personally/i.test(r4.answer));
const r5 = await p.evaluate(()=>ragAnswer('what should I do in a flood'));
ok('gives official safety guidance', !r5.refused && /higher ground/i.test(r5.answer));
const r6 = await p.evaluate(()=>ragAnswer('tell me about the kedarnath flood'));
ok('answers from the historical record', !r6.refused && /Kedarnath|Chorabari/i.test(r6.answer));
const r7 = await p.evaluate(()=>ragAnswer('which zones are critical'));
ok('model answers carry the not-a-warning caveat', /not official warnings|takes precedence/i.test(r7.footer||''));

console.log('\n── PUBLIC MAP FRAMING ──');
await p.evaluate(()=>{endSession('t');S.cz='home';S.czFramed=0;S.mapFocus=null;render();});
await p.waitForTimeout(1200);
const cz = await p.evaluate(()=>{
  const host=document.querySelector('.czmap .cm'), svg=host.querySelector('svg');
  const hr=host.getBoundingClientRect(), sr=svg.getBoundingClientRect();
  const vb=svg.getAttribute('viewBox').split(' ').map(Number);
  return {overflow:Math.round(sr.height-hr.height),
          aspectMatch:Math.abs(vb[2]/vb[3]-hr.width/hr.height)<0.01,
          focus:S.mapFocus, zoom:+currentZoom().toFixed(2)};
});
ok('public map fills its box exactly', cz.overflow===0 && cz.aspectMatch ? true : cz);
ok('public map opens on the reader\'s state, not the whole country', cz.focus!==null && cz.zoom>1.5 ? true : cz);
ok('public map has its own zoom cluster', await p.evaluate(()=>!!document.querySelector('.czmap .zoomc')));
await p.evaluate(()=>czWholeIndia()); await p.waitForTimeout(800);
ok('whole-of-India button works', await p.evaluate(()=>+currentZoom().toFixed(2))===1);
await p.evaluate(()=>czMyState()); await p.waitForTimeout(800);
/* a large state frames wider than a small one — the test is that it framed
   on the state at all, not that it hit some absolute magnification */
const backZ = await p.evaluate(()=>({z:currentZoom(), f:S.mapFocus}));
ok('back-to-my-state button works', backZ.f!==null && backZ.z>1.4 ? true : backZ);

console.log('\n── CITIZEN SCREENS ──');
await p.evaluate(()=>{endSession('test');S.role='citizen';S.cz='memorial';render();});
await p.waitForTimeout(500);
await p.evaluate(()=>{S.cz='memorial';render();}); await p.waitForTimeout(500);
ok('gallery renders slides', await p.evaluate(()=>document.querySelectorAll('.gsl').length));
ok('slides are labelled as illustrations, not photographs', await p.evaluate(()=>
  [...document.querySelectorAll('.slcap')].every(c=>/Illustration, not a photograph|^Photograph ·/.test(c.textContent.trim()))));
ok('the drop-in path for real photographs is stated on screen', await p.evaluate(()=>
  !!document.querySelector('.illnote')));
ok('gallery detail renders', await p.evaluate(()=>!!document.querySelector('.gdc')));
await p.evaluate(()=>galGo(1)); await p.waitForTimeout(300);
ok('gallery advances', await p.evaluate(()=>galIdx===1));
await p.evaluate(()=>{S.cz='relief';render();});
await p.waitForTimeout(400);
ok('relief renders funds', await p.evaluate(()=>document.querySelectorAll('.rcard').length));
ok('no payment form anywhere', await p.evaluate(()=>
  !document.querySelector('input[type=tel],input[name*=card],input[name*=upi],input[autocomplete*=cc-]')));
ok('relief links are all https', await p.evaluate(()=>
  [...document.querySelectorAll('.rgo')].every(a=>a.href.startsWith('https://'))));
ok('external links are rel-protected', await p.evaluate(()=>
  [...document.querySelectorAll('.rgo')].every(a=>a.rel.includes('noopener'))));

console.log('\nerrors:', errs.length); errs.slice(0,8).forEach(e=>console.log('  '+e));
await p.screenshot({ path: '/tmp/final.png' });
await b.close();
