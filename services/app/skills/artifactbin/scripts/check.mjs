/** Browser check contracts. Smoke evidence never implies task or visual acceptance.
 * @typedef {{width:number,height:number}} CheckViewport
 * @typedef {{pageErrors:string[],consoleErrors:string[],failedRequests:object[],httpErrors:object[],telemetry:object[],text:string,overflow:{viewport:number,content:number,fits:boolean},task?:unknown,error?:string}} CheckEvidence
 * @typedef {{target:string,viewports?:CheckViewport[],steps?:string,timeoutMs?:number}} CheckOptions
 */
import {readFile,writeFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {runTool,resolveTarget,selectedServer,makeClient,positional,enumValue,credentialRoot,ToolError,exclusive} from './toolbox-client.mjs';

/** Resolve both named ESM and CommonJS default exports before attempting a browser launch. */
export async function loadChromium(modulePath){
 let module;
 try{module=await import(modulePath?pathToFileURL(realpathSync(modulePath)).href:'playwright');}
 catch{throw new ToolError('browser_dependency_missing','Local checks could not load Playwright.',1,'Install Playwright in the isolated harness and pass its entrypoint with --playwright-module.');}
 const chromium=typeof module.chromium?.launch==='function'?module.chromium:module.default?.chromium;
 if(typeof chromium?.launch!=='function')throw new ToolError('browser_module_invalid','Selected module does not export chromium.launch.',2,'Pass a Playwright CommonJS or ESM entrypoint.');
 return chromium;
}
export function checkTarget(value){
 if(/^[A-Za-z0-9]{6,}$/.test(value))return {mode:'hosted',target:'/a/'+value};
 let url;try{url=new URL(value);}catch{throw Error('Use an artifact ID or an HTTP loopback preview URL.');}
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password)throw Error('Use an artifact ID or an HTTP loopback preview URL.');
 return {mode:'local',target:url.href,origin:url.origin};
}
/** Runs in either the server session or a fresh local browser context. No credentials. */
export async function inspectPage(page,options,task){
 const pageErrors=[],consoleErrors=[],failedRequests=[],httpErrors=[],telemetry=[];
 const classify=(value)=>{try{const url=new URL(value);return url.origin===new URL(page.url()).origin&&/^\/api\/page\/artifact\/[A-Za-z0-9]+\/view$/.test(url.pathname);}catch{return false;}};
 const record=(list,item)=>{if(list.length<100)list.push(item);};
 page.on('pageerror',error=>record(pageErrors,String(error.message)));
 page.on('console',message=>{if(message.type()==='error'){const url=message.location?.().url;if(url&&classify(url))record(telemetry,{url,error:message.text()});else record(consoleErrors,message.text());}});
 // A main-frame navigation (e.g. a step's reload) cancels requests that started before it; those aborts are not page failures.
 let navigation=0;const started=new WeakMap();
 page.on('request',request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())navigation++;started.set(request,navigation);});
 page.on('requestfailed',request=>{const item={url:request.url(),error:request.failure()?.errorText};const aborted=item.error==='net::ERR_ABORTED'&&started.get(request)<navigation;record(classify(item.url)||aborted?telemetry:failedRequests,aborted?{...item,reason:'navigation'}:item);});
 page.on('response',response=>{if(response.status()>=400){const item={url:response.url(),status:response.status()};record(classify(item.url)?telemetry:httpErrors,item);}});
 page.setDefaultTimeout(options.timeoutMs??4000);
 const evidence={viewport:options.viewport,pageErrors,consoleErrors,failedRequests,httpErrors,telemetry,text:'',overflow:null,task:null};
 try{
  await page.setViewportSize(options.viewport);
  await page.goto(options.target,{waitUntil:'domcontentloaded',timeout:4000});
  // Do not wait for networkidle: charts, telemetry and subscriptions can remain active.
  if(options.hosted)await page.mainFrame().locator('iframe[data-mx-document-frame]').waitFor({timeout:2000});
  await page.locator('body').waitFor({timeout:2000});
  if(task){
   let timer;
   try{evidence.task=await Promise.race([task(page),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Task deadline exceeded; inspect the awaited condition')),6000);})]);}
   finally{clearTimeout(timer);}
  }
 }catch(error){evidence.error=String(error.message);}
 try{
  evidence.text=(await page.locator('body').innerText({timeout:1000})).slice(0,24000);
  evidence.overflow=await page.locator('html').evaluate(html=>{
   const content=Math.max(html.scrollWidth,html.ownerDocument.body.scrollWidth);
   return {viewport:html.clientWidth,content,fits:content<=html.clientWidth+1};
  },undefined,{timeout:1000});
  // Text colour against its resolved solid background (WCAG ratio); agents without image input cannot see contrast.
  evidence.contrast=await page.locator('html').evaluate(()=>{
   const parse=v=>{const m=String(v).match(/rgba?\(([^)]+)\)/);if(!m)return null;const p=m[1].split(/[ ,/]+/).filter(Boolean).map(Number);return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};};
   const over=(top,under)=>({r:top.r*top.a+under.r*(1-top.a),g:top.g*top.a+under.g*(1-top.a),b:top.b*top.a+under.b*(1-top.a),a:1});
   const lum=c=>{const f=x=>{x/=255;return x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4;};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);};
   const background=el=>{const layers=[];for(let e=el;e;e=e.parentElement){const s=getComputedStyle(e);if(/url\(/.test(s.backgroundImage))return null;const c=parse(s.backgroundColor);if(c&&c.a>0){layers.push(c);if(c.a>=1)break;}}
    let base={r:255,g:255,b:255,a:1};for(const c of layers.reverse())base=over(c,base);return base;};
   const seen=new Set(),low=[];let checked=0;
   const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
   for(let n=walker.nextNode();n;n=walker.nextNode()){
    const el=n.parentElement;if(!el||seen.has(el)||n.textContent.trim().length<2)continue;seen.add(el);
    const s=getComputedStyle(el),rect=el.getBoundingClientRect();
    if(s.visibility!=='visible'||Number(s.opacity)===0||rect.width<2||rect.height<2||s.backgroundClip==='text')continue;
    let fg=parse(s.color);const bg=background(el);if(!fg||!bg)continue;if(fg.a<1)fg=over(fg,bg);checked++;
    const [hi,lo]=[lum(fg),lum(bg)].sort((x,y)=>y-x),ratio=Math.round((hi+0.05)/(lo+0.05)*100)/100;
    const size=parseFloat(s.fontSize),need=size>=24||(size>=18.66&&Number(s.fontWeight)>=700)?3:4.5;
    if(ratio<need)low.push({text:n.textContent.trim().slice(0,48),ratio,need,color:s.color,fontSize:Math.round(size)});
   }
   low.sort((x,y)=>x.ratio-y.ratio);
   return {checked,belowAA:low.length,unreadable:low.filter(item=>item.ratio<2).length,low:low.slice(0,100)};
  },undefined,{timeout:1500});
  // Each laid-out data-af-slide at this viewport: text cut off by the slide or a clipping box inside it, and text drawn over other text.
  evidence.slides=await page.locator('html').evaluate(()=>{
   const slides=[...document.querySelectorAll('[data-af-slide]')].filter(slide=>!slide.closest('[data-af-deck-chrome]')&&slide.getBoundingClientRect().width>1&&slide.getBoundingClientRect().height>1);
   if(!slides.length)return null;
   const clipped=[],overlaps=[];
   slides.forEach((slide,index)=>{
    const seen=new Set(),texts=[],walker=document.createTreeWalker(slide,NodeFilter.SHOW_TEXT);
    for(let n=walker.nextNode();n;n=walker.nextNode()){
     const el=n.parentElement;if(!el||seen.has(el)||n.textContent.trim().length<2||el.closest('[data-af-deck-chrome]'))continue;seen.add(el);
     const s=getComputedStyle(el),r=el.getBoundingClientRect();if(s.visibility!=='visible'||Number(s.opacity)===0||r.width<1||r.height<1)continue;
     // Visually hidden text (sr-only tables, clipped boxes) is neither clipped nor overlapping; chart libraries place SVG labels.
     let hidden=false;for(let e=el;e&&!hidden&&e!==slide.parentElement;e=e.parentElement){const es=getComputedStyle(e),er=e.getBoundingClientRect();hidden=es.clip!=='auto'||es.clipPath!=='none'||er.width<4||er.height<4;}
     if(hidden)continue;
     if(!el.closest('svg'))texts.push({el,r,text:n.textContent.trim().slice(0,48)});
     for(let box=el;box;box=box===slide?null:box.parentElement){
      const b=box.getBoundingClientRect(),style=getComputedStyle(box);
      if(box!==slide&&style.overflowX==='visible'&&style.overflowY==='visible')continue;
      const by=Math.max(b.top-r.top,r.bottom-b.bottom,b.left-r.left,r.right-b.right);
      if(by>1){clipped.push({slide:index+1,text:n.textContent.trim().slice(0,48),px:Math.round(by),by:box===slide?'slide':box.tagName.toLowerCase()+(box.className&&typeof box.className==='string'?'.'+box.className.trim().split(/\s+/)[0]:'')});break;}
     }
    }
    // HTML text drawn over other HTML text (not nested), across at least 30% of the smaller box each way; chart libraries place SVG labels.
    for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++){
     const a=texts[i],b=texts[j];if(a.el.contains(b.el)||b.el.contains(a.el))continue;
     const w=Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left),h=Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top);
     if(w>0.3*Math.min(a.r.width,b.r.width)&&h>0.3*Math.min(a.r.height,b.r.height))overlaps.push({slide:index+1,text:a.text,over:b.text});
    }
   });
   return {count:slides.length,clipped:clipped.length,items:clipped.slice(0,100),overlapping:overlaps.length,overlaps:overlaps.slice(0,100)};
  },undefined,{timeout:1500});
 }catch(error){evidence.inspectionError=String(error.message);}
 if(options.capture)try{evidence.screenshot={mime:'image/png',scope:options.hosted?'reader-viewport':'local-viewport',base64:Buffer.from(await page.screenshot({fullPage:false,timeout:1000})).toString('base64')};}catch(error){evidence.screenshotError=String(error.message);}
 // Do not let page-close cancellation events mutate evidence already collected.
 return {...evidence,pageErrors:[...pageErrors],consoleErrors:[...consoleErrors],failedRequests:[...failedRequests],httpErrors:[...httpErrors],telemetry:[...telemetry]};
}
export function checkScript({target,viewports,steps='',timeoutMs=2500,capture=false}){
 if(!viewports||viewports.length!==1)throw Error('Each hosted execution checks one viewport.');
 return `const page=await context.newPage();try{return await (${inspectPage.toString()})(page,${JSON.stringify({target,viewport:viewports[0],timeoutMs,hosted:true,capture})},${steps?`async(page)=>{${steps}\n}`:'null'});}finally{await page.close();}`;
}
/** @returns {import('../../../lib/skills/author-toolbox-contract').AuthorCheckResult} */
export function summarizeCheck(checks){
 return {smokePassed:checks.length>0&&checks.every(check=>!check.error&&!check.inspectionError&&check.overflow?.fits===true&&check.text.length>0&&!check.contrast?.unreadable&&['pageErrors','consoleErrors','failedRequests','httpErrors'].every(key=>check[key]?.length===0)),checks,
  unverified:['visual appearance','task behavior','persistence','permissions'],note:'Smoke evidence only. Inspect task results separately; text and geometry cannot establish visual acceptance.'};
}
function origin(value){const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Select a server origin.');return url.origin;}
/** One session, one execution per viewport, receipt-safe status polling and close. */
/** @param {any} options */
export async function checkHosted({target,viewports,steps='',viewer,server,token=undefined,requester=undefined,capture=false},fetcher=fetch){
 server=origin(server);if(!token&&!requester)throw Error('Supply ARTIFACTBIN_TOKEN outside page code.');
 const session_id=randomUUID(),checks=[];let accepted=false;
 async function request(body){
  if(requester)return requester(body);
  const response=await fetcher(server+'/api/browser-sessions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Origin:server},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw Error('Browser session refused (HTTP '+response.status+'): '+(result.error?.code??result.error??'unknown'));return result;
 }
 try{
  for(const viewport of viewports){
   const execution_id=randomUUID();
   const body={op:'script',session_id,execution_id,create:!accepted,code:checkScript({target,viewports:[viewport],steps,capture}),...(accepted||!viewer?{}:{viewer})};
   let run;
   try{run=await request(body);accepted=true;}
   catch(error){
    // A lost submission response may still have executed. Observe the same receipt; never replay actions.
    try{run=await request({op:'status',session_id,execution_id});accepted=run.session_id===session_id;}catch{throw error;}
   }
   if(run.session_id!==session_id||run.execution_id!==execution_id)throw Error('Mismatched browser receipt.');
   for(const deadline=Date.now()+25000;['queued','running'].includes(run.status)&&Date.now()<deadline;){
    await new Promise(resolve=>setTimeout(resolve,250));run=await request({op:'status',session_id,execution_id});
   }
   if(run.status!=='completed'){checks.push({viewport,error:run.error??run.status,session_id,execution_id,pages:run.pages});break;}
   checks.push(run.result);
  }
 }finally{if(accepted)try{await request({op:'close',session_id});}catch(error){checks.push({error:'Session cleanup failed: '+error.message});}}
 return summarizeCheck(checks);
}
export async function checkLocal({target,viewports,steps='',capture=false},chromium){
 const selected=checkTarget(target);if(selected.mode!=='local')throw Error('Local checks require a loopback preview URL.');
 // launch() creates a disposable temporary profile; never attach to an existing browser or userDataDir.
 let browser;try{browser=await chromium.launch({headless:true});}catch{throw new ToolError('browser_dependency_missing','Chromium could not start in this harness.',1,'Install the Playwright Chromium build and its OS dependencies.');}
 try{
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===selected.origin?route.continue():route.abort('blockedbyclient');});
  const checks=[];
  for(const viewport of viewports){const page=await context.newPage();try{checks.push(await inspectPage(page,{target,viewport,capture},steps?new (Object.getPrototypeOf(async function(){}).constructor)('page',steps):null));}finally{await page.close();}}
  return summarizeCheck(checks);
 }finally{await browser.close();}
}
export async function checkCommand({values,positionals},options={}){
 const input=positional(positionals),widths=values.viewport??['1280x800','390x844'];
 if(widths.length>8)throw new ToolError('viewport_limit','At most eight viewports are supported.',2);
 const viewports=widths.map(value=>{const match=/^(\d+)x(\d+)$/.exec(value);if(!match||[match[1],match[2]].some(n=>Number(n)<240||Number(n)>3840))throw new ToolError('invalid_viewport','Use WIDTHxHEIGHT with dimensions from 240 to 3840.',2);return {width:Number(match[1]),height:Number(match[2])};});
 const steps=values.steps?await readFile(values.steps,'utf8'):'';if(Buffer.byteLength(steps)>48000)throw new ToolError('steps_too_large','Task steps exceed 48 KB.',2);
 let result;
 const local=/^http:\/\//.test(input)&&!/^\/a\/[A-Za-z0-9]{6,12}\/?$/.test(new URL(input).pathname);
 if(local){
  if(values.viewer||values.server)throw new ToolError('local_identity','Loopback preview has no platform viewer/server selection.',2);
  const chromium=await loadChromium(values['playwright-module']);
  result=await checkLocal({target:checkTarget(input).target,viewports,steps,capture:true},chromium);
 }else{
  if(values['playwright-module'])throw new ToolError('hosted_browser','Hosted checks use server browser sessions.',2);
  const {server,id}=resolveTarget(input,selectedServer(values,options.env)),client=makeClient(server,options);
  const viewer=values.viewer?enumValue(values.viewer,['self','guest'],'viewer'):'self';
  result=await checkHosted({target:'/a/'+id,server,viewports,steps,capture:true,viewer:viewer==='guest'?'guest':undefined,requester:body=>client.request('/api/browser-sessions',{method:'POST',body})});
 }
 const directory=path.join(credentialRoot(options.env),'checks',randomUUID());let created=false;
 for(const check of result.checks){if(check.screenshot){if(!created){await mkdir(directory,{recursive:true,mode:0o700});created=true;}const file=path.join(directory,`${check.viewport.width}x${check.viewport.height}.png`);await exclusive(file,Buffer.from(check.screenshot.base64,'base64'));check.screenshot={path:file,mime:'image/png',scope:check.screenshot.scope,visuallyReviewed:false};}}
 if(!result.smokePassed)throw new ToolError('check_failed','Smoke or task checks failed.',1,'Inspect partial diagnostics and remaining unverified acceptance.',result);
 return result;
}
await runTool('check',import.meta.url,checkCommand);
