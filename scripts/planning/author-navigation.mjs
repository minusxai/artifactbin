// Self-contained adversarial browser experiment; all targets are loopback.
// node scripts/planning/author-navigation.mjs [chromium|firefox|webkit]
import {createServer} from 'node:http';
import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
const engines={chromium,firefox,webkit};
const selected=process.argv[2] ?? 'chromium';
assert(engines[selected]);
const hits=[];
const sink=createServer((req,res)=>{hits.push(req.url);res.end('navigation target');});
await new Promise(resolve=>sink.listen(0,'127.0.0.1',resolve));
const target=`http://127.0.0.1:${sink.address().port}`;
const strict="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
const literal=value=>JSON.stringify(value).replaceAll('<','\\u003c');
const child=code=>`<!doctype html><head><meta http-equiv="Content-Security-Policy" content="${strict}"></head><body><script>${code}</script>`;
const cases=new Map();
const host=createServer((req,res)=>{
  const fixture=cases.get(req.url);
  if(!fixture){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type','text/html');
  res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'unsafe-inline'; frame-src ${fixture.parentFrames}`);
  const inner=child(`top.postMessage('author-start','*');${fixture.code}`);
  const realm=fixture.wrapper ? child(`const f=document.createElement('iframe');f.sandbox='allow-scripts';f.srcdoc=${literal(inner)};document.body.append(f);`) : inner;
  res.end(`<!doctype html><body><script>window.started=false;addEventListener('message',e=>{if(e.data==='author-start')window.started=true;});const f=document.createElement('iframe');f.sandbox='allow-scripts';f.srcdoc=${literal(realm)};document.body.append(f);</script>`);
});
await new Promise(resolve=>host.listen(0,'127.0.0.1',resolve));
const browser=await engines[selected].launch();
try {
  const results=[];
  for(const method of ['location','replace','link','meta','top','parent','popup','form','nested','remove-csp-fetch','document-write-fetch','data-navigation','blob-navigation','fresh-realm-fetch','gesture-self','gesture-top','gesture-parent','gesture-popup']) for(const shape of ['allowed-trusted-host','denied-destination','strict-wrapper']) {
    const key='/'+method+'-'+shape;
    const url=target+key;
    const u=literal(url);
    const attempts={
      location:`location.href=${u}`,
      replace:`location.replace(${u})`,
      link:`const a=document.createElement('a');a.href=${u};document.body.append(a);a.click();`,
      meta:`const m=document.createElement('meta');m.httpEquiv='refresh';m.content='0;url='+${u};document.head.append(m);`,
      top:`top.location=${u}`,
      parent:`parent.location=${u}`,
      popup:`window.open(${u})`,
      form:`const f=document.createElement('form');f.action=${u};document.body.append(f);f.submit();`,
      nested:`const f=document.createElement('iframe');f.src=${u};document.body.append(f);`,
      'remove-csp-fetch':`document.querySelector('meta[http-equiv]').remove();fetch(${u}).catch(()=>{});`,
      'document-write-fetch':`document.open();document.write('<body>replacement');document.close();fetch(${u}).catch(()=>{});`,
      'data-navigation':`location.href='data:text/html,'+encodeURIComponent(${literal('<script>fetch('+u+').catch(()=>{})</script>')});`,
      'blob-navigation':`location.href=URL.createObjectURL(new Blob([${literal('<script>fetch('+u+').catch(()=>{})</script>')}],{type:'text/html'}));`,
      'fresh-realm-fetch':`const f=document.createElement('iframe');f.srcdoc=${literal('<script>fetch('+u+').catch(()=>{})</script>')};document.body.append(f);`,
    };
    const gesture=method.startsWith('gesture-');
    const action=method.slice(8);
    const gestureCode=action==='self'?attempts.location:attempts[action];
    const code=gesture?`const b=document.createElement('button');b.textContent='Attempt';b.onclick=()=>{${gestureCode}};document.body.append(b);`:attempts[method];
    cases.set(key,{parentFrames:shape==='denied-destination'?"'none'":target,wrapper:shape==='strict-wrapper',code});
    const page=await browser.newPage();
    await page.goto(`http://127.0.0.1:${host.address().port}${key}`);
    await page.waitForFunction(()=>window.started);
    if(gesture) await page.frames().at(-1).getByRole('button',{name:'Attempt',exact:true}).click();
    await page.waitForTimeout(500);
    const networkHits=hits.filter(hit=>hit===key).length;
    const expected=shape==='allowed-trusted-host' && ['location','replace','link','meta','gesture-self'].includes(method) ? 1 : 0;
    assert.equal(networkHits,expected,`${selected} ${key}: request boundary`);
    results.push({method,shape,authorExecuted:true,networkHits,frames:page.frames().map(frame=>frame.url())});
    await page.close();
  }
  console.log(JSON.stringify({engine:selected,results},null,2));
} finally {
  await browser.close();
  await Promise.all([new Promise(resolve=>host.close(resolve)),new Promise(resolve=>sink.close(resolve))]);
}
