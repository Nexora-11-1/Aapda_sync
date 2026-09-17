import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1680, height: 980 } });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(new URL('../../dist/aapdasync.html', import.meta.url).href);
await p.waitForTimeout(600);
await p.click('.role:nth-child(1)');
await p.waitForTimeout(1400);
const fit = await p.evaluate(()=>{
  const host=document.querySelector('.czmap .cm'), svg=host.querySelector('svg');
  const hr=host.getBoundingClientRect(), sr=svg.getBoundingClientRect();
  const vb=svg.getAttribute('viewBox').split(' ').map(Number);
  return { host:[Math.round(hr.width),Math.round(hr.height)],
           svg:[Math.round(sr.width),Math.round(sr.height)],
           overflow: Math.round(sr.height-hr.height),
           vbAspect:+(vb[2]/vb[3]).toFixed(3), hostAspect:+(hr.width/hr.height).toFixed(3),
           focus:S.mapFocus, zoom:+currentZoom().toFixed(2) };
});
console.log('citizen map  :', JSON.stringify(fit));
console.log('fills its box:', fit.overflow===0 && Math.abs(fit.vbAspect-fit.hostAspect)<0.01);
await p.screenshot({path:'/tmp/zf-state.png'});
// buttons
await p.evaluate(()=>czWholeIndia()); await p.waitForTimeout(900);
console.log('whole india  : zoom', await p.evaluate(()=>+currentZoom().toFixed(2)));
await p.screenshot({path:'/tmp/zf-india.png'});
await p.evaluate(()=>czMyState()); await p.waitForTimeout(900);
console.log('my state     : zoom', await p.evaluate(()=>+currentZoom().toFixed(2)));
// zoom cluster in the citizen view
const z0 = await p.evaluate(()=>+currentZoom().toFixed(2));
await p.evaluate(()=>zoomIn()); await p.waitForTimeout(700);
const z1 = await p.evaluate(()=>+currentZoom().toFixed(2));
await p.evaluate(()=>{zoomOut();zoomOut();}); await p.waitForTimeout(700);
const z2 = await p.evaluate(()=>+currentZoom().toFixed(2));
console.log('zoom in/out  :', z0, '→', z1, '→', z2, z1>z0 && z2<z1 ? 'OK' : 'BROKEN');
console.log('level label  :', await p.evaluate(()=>document.querySelector('.czmap .zlvl').textContent));
// command map still correct
await p.evaluate(()=>{S.role='citizen';S.cz='home';render();});
await p.waitForTimeout(400);
console.log('errors:', errs.length, errs.slice(0,3));
await b.close();
