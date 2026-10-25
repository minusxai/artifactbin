/** Native APIs through the existing archive/preview/Save and hosted/download paths.
 * Uses the caller's browser/server: no duplicate build, login session or browser launch. */
import sharp from 'sharp';
import {expect} from 'playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {connectAgent} from '../gates/lib/cli-connection.mjs';
import {documentFrame} from '../gates/lib/page-facts.mjs';
/** @param {{mermaid:string,deck:string}} libraries */
export function directVisualSource({mermaid,deck}) {
 return `<!doctype html><html><head><title>Direct library proof</title><script src="/af/v1/core.js" data-af="core"></script></head><body><div id="diagram"></div><div id="map" style="width:400px;height:240px;position:relative"></div><output id="direct-status"></output><button id="direct-update">Update direct visuals</button><button id="direct-dispose">Dispose direct visuals</button><script type="module">
 import mermaid from ${JSON.stringify(mermaid)};import {Deck,MapView,ScatterplotLayer} from ${JSON.stringify(deck)};
 mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'base',flowchart:{htmlLabels:false}});await document.fonts.ready;
 const diagram=document.querySelector('#diagram'),host=document.querySelector('#map'),status=document.querySelector('#direct-status');let revision=0,disposed=false,resolveFrame;const frame=()=>new Promise(resolve=>{resolveFrame=resolve;});
 const layer=name=>new ScatterplotLayer({id:'points',data:[{position:[0,0],name}],getPosition:d=>d.position,getRadius:100000,radiusMinPixels:16,getFillColor:name==='Initial'?[20,160,80]:[200,50,30],pickable:true});
 const initialFrame=frame();const view=new Deck({parent:host,width:host.clientWidth,height:host.clientHeight,views:new MapView(),initialViewState:{longitude:0,latitude:0,zoom:1},controller:true,layers:[layer('Initial')],onError(error){status.textContent='Render error: '+error.message;},onAfterRender(){host.dataset.viewportWidth=String(view.getViewports()[0]?.width);resolveFrame?.();resolveFrame=null;}});
 Object.defineProperty(host,'fixtureDeck',{value:view});host.dispatchEvent(new Event('direct-deck-ready'));
 const resize=new ResizeObserver(()=>view.setProps({width:host.clientWidth,height:host.clientHeight}));resize.observe(host);
 const draw=async(label)=>{const result=await mermaid.render('direct-diagram-'+revision,'flowchart LR\\n'+label+' --> Done');if(disposed)return;diagram.innerHTML=result.svg;result.bindFunctions?.(diagram);};
 await Promise.all([draw('Initial'),initialFrame]);const picked=()=>view.pickObject({x:200,y:120,radius:2})?.object?.name;status.textContent='Initial:'+picked();
 document.querySelector('#direct-update').onclick=async()=>{revision++;const nextFrame=frame();view.setProps({layers:[layer('Updated')]});await Promise.all([draw('Updated'),nextFrame]);if(!disposed)status.textContent='Updated:'+picked();};
 const dispose=()=>{disposed=true;resize.disconnect();view.finalize();diagram.replaceChildren();status.textContent='Disposed';};document.querySelector('#direct-dispose').onclick=dispose;window.addEventListener('pagehide',()=>{if(!disposed)dispose();},{once:true});
 </script><script type="module">import {Deck} from ${JSON.stringify(deck)};const host=document.querySelector('#map');const verify=()=>host.dataset.sharedModule=String(host.fixtureDeck instanceof Deck);host.addEventListener('direct-deck-ready',verify,{once:true});if(host.fixtureDeck)verify();</script></body></html>`;
}
/** @param {{browser:import('playwright').Browser,page:import('playwright').Page,root:string,session:{url:string},dir:string,origin:string,savePage:Function,mermaid:string,deck:string,skill:string}} input */
export async function exerciseDirectVisualLibraries({browser,page,root,session,dir,origin,savePage,mermaid,deck,skill}) {
 page.on('pageerror',error=>console.error('Direct library page error:',error.message.slice(0,500)));
 const verifyDirect=async(target,label)=>{
  await expect(target.locator('#direct-status')).toHaveText('Initial:Initial',{timeout:30000});assert.equal(await target.locator('#diagram svg').count(),1,label+' native Mermaid render');await expect(target.locator('#map')).toHaveAttribute('data-shared-module','true');
  const first=await target.locator('#map canvas').screenshot();await target.getByRole('button',{name:'Update direct visuals'}).click();await target.locator('#direct-status').filter({hasText:'Updated:Updated'}).waitFor();assert.ok((await target.locator('#diagram svg').textContent()).includes('Updated'));assert.notDeepEqual(await target.locator('#map canvas').screenshot(),first,label+' actual GPU output updates');
  await target.locator('#map').evaluate(el=>{el.style.width='320px';});await target.locator('#map[data-viewport-width="320"]').waitFor();assert.equal(await target.locator('#map canvas').evaluate(el=>el.getBoundingClientRect().width),320);
  await target.getByRole('button',{name:'Dispose direct visuals'}).click();await target.locator('#direct-status').filter({hasText:'Disposed'}).waitFor();assert.equal(await target.locator('#map canvas').count(),0);assert.equal(await target.locator('#diagram svg').count(),0);
 };
 const visualSource=directVisualSource({mermaid,deck});await writeFile(join(root,'direct-visuals.html'),visualSource);await page.goto(new URL('direct-visuals.html',session.url).href);await expect(page.locator('#direct-status')).toHaveText('Initial:Initial',{timeout:30000});const directSaved=await savePage(page,'direct-visuals-offline.html');await verifyDirect(page,'private preview');
 const directOffline=await browser.newContext({offline:true}),directFile=await directOffline.newPage(),directRequests=[],directErrors=[];directFile.on('request',r=>{if(/^https?:/.test(r.url()))directRequests.push(r.url());});directFile.on('pageerror',e=>directErrors.push(e.message));await directFile.goto(pathToFileURL(directSaved.file).href);await verifyDirect(directFile,'offline Save');assert.deepEqual(directRequests,[]);assert.deepEqual(directErrors,[]);await directOffline.close();
 const {token}=await connectAgent(origin);const authHeaders={Authorization:'Bearer '+token,'content-type':'application/json'};const publication=await fetch(new URL('/api/artifacts',origin),{method:'POST',headers:authHeaders,body:JSON.stringify({html:visualSource,visibility:'unlisted'})});assert.equal(publication.status,201);const published=await publication.json();const hosted=await browser.newPage(),hostedErrors=[];hosted.on('pageerror',e=>hostedErrors.push(e.message));await hosted.goto(new URL('/a/'+published.id,origin).href);await verifyDirect(await documentFrame(hosted),'hosted');assert.deepEqual(hostedErrors,[]);await hosted.close();
 const directDownload=await fetch(new URL('/a/'+published.id+'/download',origin),{headers:authHeaders});assert.equal(directDownload.status,200);const directPath=join(dir,'direct-hosted-download.html');await writeFile(directPath,await directDownload.text());const downloadedContext=await browser.newContext({offline:true}),downloadedPage=await downloadedContext.newPage(),downloadedRequests=[],downloadedErrors=[];downloadedPage.on('pageerror',e=>{downloadedErrors.push(e.message);console.error('Hosted download error:',e.message.slice(0,1000));});downloadedPage.on('console',m=>{if(m.type()==='error'){downloadedErrors.push(m.text());console.error('Hosted download console:',m.text().slice(0,1500));}});downloadedPage.on('request',r=>{if(/^https?:/.test(r.url()))downloadedRequests.push(r.url());});await downloadedPage.goto(pathToFileURL(directPath).href);await verifyDirect(downloadedPage,'hosted download offline');assert.deepEqual(downloadedRequests,[]);assert.deepEqual(downloadedErrors,[]);await downloadedContext.close();
 // Verify the exact fenced examples shipped in this archive, not copied substitutes.
 for(const name of ['diagrams','maps']) {
  const reference=await readFile(join(skill,'references',name+'.md'),'utf8');const snippet=reference.match(/```html\n([\s\S]*?)```/)?.[1];assert.ok(snippet,'installed '+name+' example');
  const source='<!doctype html><html data-af-dark="false"><head>'+(!snippet.includes('data-af="core"')?'<script src="/af/v1/core.js" data-af="core"></script>':'')+'</head><body>'+snippet+'</body></html>';
  const filename='direct-doc-'+name+'.html';await writeFile(join(root,filename),source);await page.goto(new URL(filename,session.url).href);
  const verifyExample=async(target)=>{
   const canvas=target.locator('#map canvas'),svg=target.locator('#workflow svg');
   if(name==='diagrams') {await svg.waitFor();assert.ok((await svg.textContent()).includes('Review'));}
   else {await canvas.waitFor();assert.equal(await target.locator('#map-status').isHidden(),true);await expect.poll(async()=>{const raw=await sharp(await canvas.screenshot()).ensureAlpha().raw().toBuffer();let colored=0;for(let i=0;i<raw.length;i+=4)if(raw[i+2]>raw[i]+20&&raw[i+2]>raw[i+1]+10)colored++;return colored;}).toBeGreaterThan(100);}
   const before=name==='diagrams'?await svg.getAttribute('id'):await canvas.screenshot();await target.evaluate(()=>document.documentElement.setAttribute('data-af-dark','true'));
   if(name==='diagrams') {await target.waitForFunction(id=>document.querySelector('#workflow svg')&&document.querySelector('#workflow svg').id!==id,before);assert.equal(await target.locator('#workflow-error').isHidden(),true);}
   else {await target.waitForFunction(()=>getComputedStyle(document.querySelector('#map')).backgroundColor==='rgb(23, 25, 35)');await expect.poll(async()=>{const raw=await sharp(await canvas.screenshot()).ensureAlpha().raw().toBuffer();let colored=0;for(let i=0;i<raw.length;i+=4)if(raw[i]>80&&raw[i+1]>140&&raw[i+2]>200)colored++;return colored;}).toBeGreaterThan(100);assert.notDeepEqual(await canvas.screenshot(),before);await target.locator('#map').evaluate(el=>{el.style.width='320px';});await target.waitForFunction(()=>document.querySelector('#map canvas')?.getBoundingClientRect().width===320);}
  };
  await verifyExample(page);const saved=await savePage(page,'direct-doc-'+name+'-offline.html');const context=await browser.newContext({offline:true}),local=await context.newPage(),requests=[],failures=[];local.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});local.on('pageerror',e=>failures.push(e.message));await local.goto(pathToFileURL(saved.file).href);await verifyExample(local);await context.close();assert.deepEqual(requests,[]);assert.deepEqual(failures,[]);
 }

}
