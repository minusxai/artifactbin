/** Native author scripts run in the isolated page, while original platform
 * chrome owns credentials, publication and comments. Retired editor/CLI and
 * Helmet/Value/query/consent legs are replaced by native Apollo state, hostile
 * message admission, the original comment flow and a real server screenshot.
 * Linked dataset SQL admission is exercised by the native backend gate. */
import {createChecker,createSection} from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import {launchChromium} from './lib/browser.mjs';
import {pagesServer} from './lib/pages-server.mjs';
import {DOCUMENT_FRAME,documentFrame} from './lib/page-facts.mjs';
import {startDocument,becomeOwner} from '../lib/start-doc.mjs';
import {nativeHtml,nativeChoiceScript} from './lib/native-surface.mjs';
import {connectionBrowserCookie} from './lib/account-connection.mjs';
import {sleep} from './lib/sleep.mjs';
import sharp from 'sharp';
const check=createChecker('own-origin-script'),section=createSection(check);
// Owner-host configuration is required; a pages-only runner also serves public files,
// so a successful runtime fetch cannot prove it has anonymous publishing hosts enabled.
const pages=await pagesServer(process.argv[2],'own-origin-script',{env:{APP__USER_PAGES_HOST:'u.lvh.me'},drives:async()=>false}),APP=pages.app;
const browser=await launchChromium();
const owner=await startDocument(APP),auth={'Content-Type':'application/json',Authorization:`Bearer ${owner.token}`};
const api=(path,init={})=>fetch(`${APP}${path}`,{...init,headers:{...auth,...init.headers}});
const source=nativeHtml('Native origin',`<main><h1>Native origin</h1><p id="third">A paragraph to comment on.</p><button id="advance">Choose west</button><output id="choice"></output><div id="paint" style="height:180px;background:rgb(204,51,204)"></div></main>`,{
 state:{region:'east'},css:'main{padding:32px}button{min-height:44px}',
 script:nativeChoiceScript({field:'region',button:'#advance',output:'#choice',value:'west'})+`
 // A page may post arbitrary messages, but cannot manufacture the parent's
 // private admission context or obtain a platform credential.
 setInterval(()=>{for(const type of ['mx:text-edit','mx:flow-edit','mx:bridge'])parent.postMessage({type,kind:'request',id:'forged',nonce:'guessed',edit_id:'forged',html:'forged'},'*')},100);`
});
const saved=await api(`/api/artifacts/${owner.id}`,{method:'PUT',body:JSON.stringify({html:source,visibility:'private'})});
check(saved.status===200,'private native script document publishes');
const otherRes=await api('/api/artifacts',{method:'POST',body:JSON.stringify({html:nativeHtml('Other','<h1>Other private page</h1>'),visibility:'private'})});
const other=await otherRes.json();check(otherRes.status===201,'second private page publishes');
const context=await browser.newContext({viewport:{width:1200,height:900}}),page=await context.newPage();
await becomeOwner(page,APP,owner.token);
await section('private origin and credential boundary',async()=>{
 const response=await page.goto(`${APP}/a/${owner.id}`,{waitUntil:'load'});
 const appCsp=response.headers()['content-security-policy']??'';
 check(!/\bblob:|\bhttps:/.test(appCsp.split(';').find(d=>d.trim().startsWith('script-src'))??''),'platform page retains strict script policy');
 check(await page.locator(DOCUMENT_FRAME).count()===1,'original chrome owns exactly one page frame');
 const frame=await documentFrame(page);await frame.waitForFunction(()=>document.querySelector('#choice')?.textContent==='east');
 check(frame.url().startsWith(pages.origin(owner.id)),'private native HTML runs on its own page origin');
 const cookies=await context.cookies(pages.origin(owner.id));const ticket=cookies.find(cookie=>cookie.name==='afbin_pages');
 check(!!ticket&&ticket.httpOnly&&ticket.sameSite==='Lax'&&ticket.domain===new URL(pages.origin(owner.id)).hostname,'page ticket is HttpOnly, Lax and host-only');
 check((await context.cookies(pages.origin(other.id))).every(cookie=>cookie.name!=='afbin_pages'),"another page origin receives no ticket");
 const exposed=await frame.evaluate(()=>({cookies:document.cookie,storage:Object.keys(localStorage),source:document.documentElement.outerHTML}));
 check(!exposed.cookies.includes('afbin_pages')&&!exposed.source.includes(owner.token),'author scripts receive neither account bearer nor HttpOnly ticket');
 const raw=await context.request.get(pages.origin(owner.id));const policy=raw.headers()['content-security-policy']??'';
 check(raw.status()===200&&!/(^|;)\s*sandbox/.test(policy)&&policy.includes(`frame-ancestors ${APP}`),'runner policy admits only platform framing without an opaque sandbox');
 const probes=await frame.evaluate(async urls=>Promise.all(urls.map(async url=>{try{await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'include'});return 'sent'}catch{return 'blocked'}})),[`${APP}/api/my/artifacts`,`${pages.origin(other.id)}/api/artifacts/${other.id}/sql`]);
 check(probes.every(result=>result==='blocked'),'CSP blocks platform API and another page origin');
 const before=await (await api(`/api/artifacts/${owner.id}`)).json();await sleep(500);
 const after=await (await api(`/api/artifacts/${owner.id}`)).json();
 check(before.version===after.version&&after.html===before.html,'forged messages cannot spend a publication or replace HTML');
 await frame.locator('#advance').click();await frame.waitForFunction(()=>document.querySelector('#choice')?.textContent==='west');
 check(await frame.locator('#choice').innerText()==='west','native Apollo viewer state updates actual DOM');
 await page.reload({waitUntil:'load'});const reloaded=await documentFrame(page);await reloaded.waitForFunction(()=>document.querySelector('#choice')?.textContent==='west');
 check(true,'viewer-local state survives frame and platform refresh');
 const stranger=await browser.newContext();const strangerPage=await stranger.newPage();
 const denied=await strangerPage.goto(`${APP}/a/${owner.id}`,{waitUntil:'load'});
 check(denied.status()===404,'private native page stays unavailable to a stranger');await stranger.close();
});
await section('anonymous owner-host state runtime',async()=>{
 const profile=await fetch(`${APP}/api/my/profile`,{headers:{cookie:connectionBrowserCookie(APP,owner.token)}});
 const {username}=await profile.json();check(profile.status===200&&!!username,'fixture has an actual owner handle');
 const published=await api('/api/artifacts',{method:'POST',body:JSON.stringify({html:nativeHtml('Public choice','<button id="advance">Choose west</button><output id="choice"></output>',{state:{region:'east'},script:nativeChoiceScript({field:'region',button:'#advance',output:'#choice',value:'west'})+"const apollo=await import('@afbin/apollo');document.body.dataset.apollo=String(!!apollo);"}),visibility:'public'})});
 const post=await published.json();check(published.status===201&&!!post.user_page_url,'public fixture supplies its owner-host URL');
 const url=new URL(post.user_page_url);check(url.hostname===`${username.replaceAll('_','-')}.u.lvh.me`&&url.origin!==APP,'browser targets owner host rather than canonical runner');
 const guest=await browser.newContext(),publicPage=await guest.newPage();
 try{
  const modules=new Set();publicPage.on('response',response=>{if(response.status()===200&&new URL(response.url()).origin===url.origin)modules.add(new URL(response.url()).pathname);});
  const response=await publicPage.goto(url.href,{waitUntil:'load'});check(response.status()===200,'anonymous owner-host page loads');
  await publicPage.waitForFunction(()=>document.querySelector('#choice')?.textContent==='east'&&document.body.dataset.apollo==='true');
  check(['/af/state.js','/af/apollo.js','/af/reader.js'].every(path=>modules.has(path)),'owner host serves the complete state and Apollo module closure');
  await publicPage.locator('#advance').click();await publicPage.waitForFunction(()=>document.querySelector('#choice')?.textContent==='west');
  check(true,'anonymous owner-host click updates actual viewer state and DOM');
  check(await publicPage.evaluate(()=>{try{localStorage.getItem('probe');return false}catch{return true}}),'opaque owner-host sandbox denies persistent browser storage');
  await publicPage.reload({waitUntil:'load'});await publicPage.waitForFunction(()=>document.querySelector('#choice')?.textContent==='east'&&document.body.dataset.apollo==='true');
  await publicPage.locator('#advance').click();await publicPage.waitForFunction(()=>document.querySelector('#choice')?.textContent==='west');
  check((await guest.cookies()).length===0,'owner-host modules and interactions work after reload without account cookies');
  check.note('Owner-host state is memory-only under the existing opaque sandbox; persistence is verified on the isolated framed origin above.');
 }finally{await guest.close();}
});
await section('comments through original chrome',async()=>{
 const frame=await documentFrame(page),third=frame.locator('#third');
 await third.click({clickCount:3});await third.click({button:'right'});
await frame.locator('[data-mx-selection-action="annotate"]').click();
 await page.getByLabel('Annotation comment',{exact:true}).waitFor();
 check(true,'selected native text opens the original context-menu comment composer');
 const composer=page.getByLabel('Annotation comment',{exact:true});await composer.fill('Native framed comment');await page.getByLabel('Save annotation',{exact:true}).click();
 const marker=page.locator('[aria-label^="Open annotation conversation by"]').first();await marker.waitFor();
 await frame.locator('[data-af="annotation-overlay"] > div').first().waitFor();
 check(true,'saved comment highlights native paragraph');
 const rect=await third.boundingBox(),pin=await marker.boundingBox();
 check(!!rect&&!!pin&&pin.y>=rect.y-8&&pin.y<=rect.y+rect.height+8,'original comment pin lands on its native paragraph');
 const annotations=await (await api(`/api/artifacts/${owner.id}/annotations`)).json();
 check(JSON.stringify(annotations).includes('Native framed comment'),'original annotation API stores the comment');
});
await section('native script screenshot',async()=>{
 const response=await api(`/a/${owner.id}/export?format=png&refresh=1`);check(response.status===200,'owner can export private native script HTML');
 const bytes=Buffer.from(await response.arrayBuffer());const {data,info}=await sharp(bytes).raw().toBuffer({resolveWithObject:true});
 let magenta=0;for(let i=0;i<data.length;i+=info.channels)if(data[i]>180&&data[i+1]<100&&data[i+2]>180)magenta++;
 check(magenta>1000,'server screenshot photographs the actual author-painted magenta block');
});
await context.close();await browser.close();pages.stop();check.done();
