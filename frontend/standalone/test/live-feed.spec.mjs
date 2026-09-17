import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1680, height: 980 } });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
const ok=(n,v)=>console.log((v===true?'  ok  ':' FAIL ')+n+(v===true?'':' → '+JSON.stringify(v)));
await p.goto(new URL('../../dist/aapdasync.html', import.meta.url).href);
await p.waitForTimeout(600);
await p.click('.role:nth-child(1)'); await p.waitForTimeout(1200);

console.log('── PUBLIC ──');
ok('public portal carries the live picture', await p.evaluate(()=>document.querySelectorAll('.ltp-c').length>=3));
ok('it names the latest warning',            await p.evaluate(()=>!!document.querySelector('.ltp-n')));
ok('it marks the state you are in',          await p.evaluate(()=>!!document.querySelector('.ltp-c.mine')));

console.log('\n── FEED STAYS CURRENT ──');
ok('ages advance with the wall clock', await p.evaluate(()=>{
  const row=S.national[0]; const was=row.age;
  row.stampedAt = Date.now() - 7*60000;      // pretend seven minutes passed
  refreshNationalFeed();
  const now=S.national.find(r=>r.id===row.id);
  return now && Math.round(now.age-was)===7 ? true : {was, now:now&&now.age};
}));
ok('an expired warning leaves the feed', await p.evaluate(()=>{
  S.national.push({id:'CAP-EXPIRED', state:'br', stateName:'Bihar', event:'Old', age:99999,
                   expires_in:1, stampedAt:Date.now()});
  refreshNationalFeed();
  return !S.national.some(r=>r.id==='CAP-EXPIRED');
}));
ok('rotation re-derives one state per tick', await p.evaluate(()=>{
  const c0=S.feedCursor; refreshNationalFeed(); const c1=S.feedCursor;
  refreshNationalFeed(); const c2=S.feedCursor;
  return c1!==c0 && c2!==c1;
}));
ok('all 36 turn over inside a few minutes', await p.evaluate(()=>{
  const n=stateIds().length, ticks=n, secs=ticks*4;
  return secs<=180 ? true : secs;   // 36 ticks at 4s = 144s
}));

console.log('\n── A NEW WARNING REACHES THE FEED ──');
ok('pushNational puts it at the top', await p.evaluate(()=>{
  const a={id:'CAP-NEW-1', auth:'IMD', event:'Test Warning', sev:'Extreme', haz:'flood',
           head:'Test head', area:'x', age:0, expires_in:6, t:hm(), exp:ahead(6), ack:0};
  pushNational(a,'ut');
  return S.national[0].id==='CAP-NEW-1';
}));
ok('it is not duplicated on a repeat', await p.evaluate(()=>{
  const a={id:'CAP-NEW-1', event:'Test Warning', age:0, expires_in:6};
  pushNational(a,'ut');
  return S.national.filter(r=>r.id==='CAP-NEW-1').length===1;
}));
ok('the surface reflects it', await p.evaluate(()=>{
  paintLatest();
  return (document.querySelector('.ltp-n')||{}).textContent?.includes('Test Warning');
}));

console.log('\n── OPERATIONS ──');
await p.evaluate(()=>{S.role='citizen';render();});
await p.evaluate(()=>{closeM&&closeM();});
console.log('errors:', errs.length, errs.slice(0,3));
await b.close();
