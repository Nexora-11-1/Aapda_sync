/* Photographs: what ships, the credit rule that gates it, and the
   browser drop-in path that has to obey the same rule. */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1680, height: 980 } });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
const ok=(n,v)=>console.log((v===true?'  ok  ':' FAIL ')+n+(v===true?'':' → '+JSON.stringify(v)));
await p.goto(new URL('../../dist/aapdasync.html', import.meta.url).href);
await p.waitForTimeout(600);
await p.click('.role:nth-child(1)'); await p.mouse.move(5,5); await p.waitForTimeout(900);
await p.evaluate(()=>{S.cz='memorial';render();}); await p.waitForTimeout(900);

console.log('\n── WHAT SHIPS ──');
const shipped = await p.evaluate(()=>Object.keys(PHOTOS));
console.log('  photographs embedded:', shipped.join(', ') || '(none)');
ok('every shipped photograph has a credit and a licence', await p.evaluate(()=>
  Object.values(PHOTOS).every(x => x.credit && x.licence)));
ok('every shipped photograph carries its pixel size, so the box is reserved',
  await p.evaluate(()=>Object.values(PHOTOS).every(x => x.w > 0 && x.h > 0)));
ok('nothing is shipped for an event that is not in the record', await p.evaluate(()=>
  Object.keys(PHOTOS).every(id => PAST_EVENTS.some(e => e.id === id))));

console.log('\n── THE CAPTION NEVER LIES ──');
ok('a slide with a photograph names its credit, one without says it is drawn',
  await p.evaluate(()=>[...document.querySelectorAll('.gsl')].every(sl => {
    const cap = sl.querySelector('.slcap').textContent.trim();
    return sl.querySelector('.slmedia img')
      ? /^Photograph · .+ · .+/.test(cap)
      : cap === 'Illustration, not a photograph';
  })));
ok('an unverified attribution is marked on the slide', await p.evaluate(()=>{
  const unver = Object.entries(PHOTOS).filter(([,x]) => x.verified === false).map(([id]) => id);
  if (!unver.length) return true;
  return unver.every(id => {
    const i = PAST_EVENTS.findIndex(e => e.id === id);
    const cap = document.querySelector(`.gsl[data-i="${i}"] .slcap`);
    return cap && cap.classList.contains('unver') && /unverified/i.test(cap.textContent);
  });
}));
ok('the note under the gallery counts what is actually there', await p.evaluate(()=>{
  const n = Object.keys(PHOTOS).length;
  const t = document.querySelector('.illnote').textContent;
  return n ? t.includes(`${n} of these ${PAST_EVENTS.length} slides`)
           : /No photographs are shipped/.test(t);
}));

console.log('\n── LAYOUT DOES NOT SHIFT ──');
ok('every photograph declares its intrinsic size', await p.evaluate(()=>
  [...document.querySelectorAll('.gsl .slmedia img')].every(i => i.getAttribute('width') && i.getAttribute('height'))));
ok('the media box has a fixed aspect ratio', await p.evaluate(()=>
  getComputedStyle(document.querySelector('.slmedia')).aspectRatio.replace(/\s/g,'') === '600/340'));
ok('no photograph is distorted', await p.evaluate(()=>
  [...document.querySelectorAll('.gsl .slmedia img')].every(i => getComputedStyle(i).objectFit === 'cover')));

console.log('\n── THE BROWSER DROP-IN PATH ──');
ok('each slide offers to take a photograph', await p.evaluate(()=>
  document.querySelectorAll('.slphoto').length===10));
/* Use an event that ships no photograph, so the local path is tested on
   its own rather than layered over a build-time one. */
const drawnId = await p.evaluate(()=>(PAST_EVENTS.find(e=>!PHOTOS[e.id])||PAST_EVENTS[0]).id);
const drawnIdx = await p.evaluate(id=>PAST_EVENTS.findIndex(e=>e.id===id), drawnId);
await p.evaluate(id=>openPhotoDialog(id), drawnId);
await p.waitForTimeout(400);
ok('the dialog opens', await p.evaluate(()=>!!document.getElementById('pdrop')));
await p.setInputFiles('#pfile',new URL('./fixtures/testphoto.png', import.meta.url).pathname);
await p.waitForTimeout(900);
ok('the image previews after resizing', await p.evaluate(()=>!!document.querySelector('#ppreview img')));

await p.click('#psave'); await p.waitForTimeout(500);
ok('it refuses to publish without a credit', await p.evaluate(id=>
  !localPhotos[id] && !!document.getElementById('pdrop'), drawnId));
await p.fill('#pcred','Test Photographer'); await p.fill('#plic','CC BY-SA 4.0'); await p.fill('#psrc','Wikimedia Commons');
await p.click('#psave'); await p.waitForTimeout(900);

ok('the slide now shows the photograph', await p.evaluate(i=>{
  const cap=document.querySelector(`.gsl[data-i="${i}"] .slcap`).textContent;
  const img=document.querySelector(`.gsl[data-i="${i}"] .slmedia img`);
  return !!img && cap.includes('Test Photographer') && cap.includes('CC BY-SA 4.0');
}, drawnIdx));
ok('it survives a reload', await (async()=>{
  await p.reload(); await p.waitForTimeout(900);
  await p.evaluate(()=>{document.getElementById('gate').style.display='none';S.role='citizen';S.cz='memorial';render();});
  await p.waitForTimeout(1200);
  return p.evaluate(i=>!!document.querySelector(`.gsl[data-i="${i}"] .slmedia img`), drawnIdx);
})());
ok('export writes the build manifest', await p.evaluate(id=>{
  exportCredits();
  const t=document.querySelector('textarea.code');
  if(!t) return false;
  const j=JSON.parse(t.value);
  return j.photos[id].credit==='Test Photographer';
}, drawnId));
await p.evaluate(()=>closeM());
await p.evaluate(()=>{S.cz='memorial';render();}); await p.waitForTimeout(700);
await p.screenshot({path:'/tmp/p-gallery.png'});
ok('removing it restores the illustration', await p.evaluate(async(i)=>{
  await removePhoto(PAST_EVENTS[i].id);
  return !document.querySelector(`.gsl[data-i="${i}"] .slmedia img`);
}, drawnIdx));
/* A build-time photograph must not be removable from one browser. */
const built = await p.evaluate(()=>Object.keys(PHOTOS)[0]);
if (built) ok('a build-time photograph is not removed by the local path', await p.evaluate(async id=>{
  await removePhoto(id);
  const i = PAST_EVENTS.findIndex(e=>e.id===id);
  return !!document.querySelector(`.gsl[data-i="${i}"] .slmedia img`);
}, built));
console.log('errors:', errs.length, errs.slice(0,3));
await b.close();
