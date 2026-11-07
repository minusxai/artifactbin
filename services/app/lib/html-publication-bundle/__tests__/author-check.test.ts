import {expect,it} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import type {BrowserSessionResult} from '@artifactbin/contracts';

it('prepares a conditional project update with retained mappings and a fresh immutable write key',async()=>{
 const {prepareBundleUpdate}=await import('../../../skills/artifactbin/scripts/toolbox-publication-bundle.mjs');
 const root=await mkdtemp(join(tmpdir(),'author-update-'));
 try{
  await writeFile(join(root,'index.html'),'<link rel="stylesheet" href="./theme.css"><h1>Changed</h1>');
  await writeFile(join(root,'theme.css'),'body{color:red}');
  const mappings={'theme.css':{kind:'asset' as const,id:'ASSET1',revision:'3',state:'resource-state',sha256:'old-digest'}};
  const options={root,entry:'index.html',server:'https://example.test',head:{id:'PAGE12',version:4,state:'page-state'},mappings};
  const saved=await prepareBundleUpdate(options),next=await prepareBundleUpdate(options);
  expect(saved).toMatchObject({method:'PUT',artifactId:'PAGE12',body:{expectedVersion:4,expectedState:'page-state',publicationBundle:{mappings}}});
  expect(saved.idempotencyKey).not.toBe(next.idempotencyKey);expect(saved.body).not.toHaveProperty('visibility');
  expect(saved.body.publicationBundle.files[0].path).toBe('theme.css');
  await expect(prepareBundleUpdate({...options,head:{id:'PAGE12',version:0,state:''}})).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});

it('provides help without reading project files or credentials',()=>{
 for(const script of ['publish','serve','check'])expect(execFileSync(process.execPath,[new URL('../../../skills/artifactbin/scripts/'+script+'.mjs',import.meta.url).pathname,'--help'],{encoding:'utf8'})).toContain('Usage:');
});

it('builds bounded smoke checks and refuses remote URLs in the private preview mode',async()=>{
 const {checkTarget,checkScript,summarizeCheck}=await import('../../../skills/artifactbin/scripts/check.mjs');
 expect(checkTarget('http://127.0.0.1:7474/')).toMatchObject({mode:'local'});
 for(const url of ['https://example.test/','http://127.0.0.1.evil.test/','file:///etc/passwd','http://user:secret@localhost/'])expect(()=>checkTarget(url)).toThrow();
 expect(checkTarget('PAGE12')).toMatchObject({mode:'hosted',target:'/a/PAGE12'});
 expect(checkScript({target:'/a/PAGE12',viewports:[{width:390,height:844}],steps:'return {verified: true};'})).toContain('return {verified: true}');
 const result=summarizeCheck([{pageErrors:['intentional error'],consoleErrors:[],httpErrors:[],failedRequests:[],telemetry:[],text:'Fixture',overflow:{viewport:390,content:900,fits:false}}]);
 expect(result.smokePassed).toBe(false);expect(result.unverified).toEqual(expect.arrayContaining(['visual appearance','task behavior','persistence','permissions']));
 expect(summarizeCheck([{pageErrors:[],consoleErrors:[],httpErrors:[],failedRequests:[],telemetry:[],text:'Ready',overflow:{viewport:390,content:390,fits:true}}]).smokePassed).toBe(true);
});

it('keeps hosted execution receipts, reports partial failure, and closes the session',async()=>{
 const {checkHosted}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const requests:any[]=[];
 const run=await checkHosted({target:'/a/PAGE12',viewports:[{width:390,height:844}],server:'https://example.test',token:'test-token',viewer:'guest'},async(_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));requests.push(body);
  if(body.op==='close')return Response.json({session_id:body.session_id,status:'closed'});
  if(body.op==='script')throw Error('response lost');
  return Response.json({session_id:body.session_id,execution_id:body.execution_id,status:'completed',result:{pageErrors:[],consoleErrors:[],failedRequests:[],httpErrors:[],telemetry:[],text:'Ready',overflow:{viewport:390,content:390,fits:true}}});
 });
 expect(requests.map(request=>request.op)).toEqual(['script','status','close']);
 expect(requests[1].execution_id).toBe(requests[0].execution_id);expect(requests[0].viewer).toBe('guest');expect(run.smokePassed).toBe(true);
 expect(JSON.stringify(requests)).not.toContain('test-token');
});

it('checks each viewport in its own fresh session, concurrently, and reports them in viewport order',async()=>{
 const {checkHosted}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const requests:any[]=[];let running=0,peak=0;
 const run=await checkHosted({target:'/a/PAGE12',viewports:[{width:1280,height:800},{width:390,height:844}],server:'https://example.test',token:'test-token'},async(_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));requests.push(body);
  if(body.op==='close')return Response.json({session_id:body.session_id,status:'closed'});
  running++;peak=Math.max(peak,running);await new Promise(resolve=>setTimeout(resolve,20));running--;
  const width=JSON.parse(body.code.match(/"viewport":(\{[^}]*\})/)[1]).width;
  return Response.json({session_id:body.session_id,execution_id:body.execution_id,status:'completed',result:{viewport:{width},pageErrors:[],consoleErrors:[],failedRequests:[],httpErrors:[],telemetry:[],text:'Ready',overflow:{viewport:width,content:width,fits:true}}});
 });
 const scripts=requests.filter(request=>request.op==='script');
 expect(scripts).toHaveLength(2);expect(scripts.every(request=>request.create)).toBe(true);
 expect(new Set(scripts.map(request=>request.session_id)).size).toBe(2);
 expect(requests.filter(request=>request.op==='close').map(request=>request.session_id).sort()).toEqual(scripts.map(request=>request.session_id).sort());
 expect(peak).toBe(2);expect(run.checks.map((check:any)=>check.viewport.width)).toEqual([1280,390]);
});

it('waits for a free browser session and names a full server instead of failing opaquely',async()=>{
 const {checkHosted}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const ok={pageErrors:[],consoleErrors:[],failedRequests:[],httpErrors:[],telemetry:[],text:'Ready',overflow:{viewport:390,content:390,fits:true}};
 // The browser service's own refusal (services/browser sessions.ts capacityRefusal, pinned in sessions.test.ts): an HTTP 200
 // receipt naming no session, status failed, the capacity code in error. A 429 carrying the code means the same.
 const refusal:BrowserSessionResult={session_id:'',status:'failed',pages:[],attachments:[],error:{code:'SESSION_ACTOR_CAPACITY',message:'One credential may hold at most 2 browser sessions at once on this server, and you hold 2.'}};
 const busy=()=>Response.json(refusal);
 let refusals=1;const ops:string[]=[];
 const run=await checkHosted({target:'/a/PAGE12',viewports:[{width:390,height:844}],server:'https://example.test',token:'test-token',busyDelayMs:5},async(_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));ops.push(body.op);
  if(body.op==='close')return Response.json({session_id:body.session_id,status:'closed'});
  if(body.op==='script'&&refusals-->0)return busy();
  return Response.json({session_id:body.session_id,execution_id:body.execution_id,status:'completed',result:ok});
 });
 expect(run.smokePassed).toBe(true);expect(ops.filter(op=>op==='script')).toHaveLength(2);expect(ops).not.toContain('status');
 // Never created, so never closed.
 expect(ops.filter(op=>op==='close')).toHaveLength(1);
 const closes:string[]=[];
 await expect(checkHosted({target:'/a/PAGE12',viewports:[{width:390,height:844}],server:'https://example.test',token:'test-token',busyDelayMs:5},async(_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{const body=JSON.parse(String(init?.body));if(body.op==='close')closes.push(body.session_id);return busy();})).rejects.toMatchObject({code:'browser_busy',message:expect.stringContaining('at most 2 browser sessions'),recovery:expect.not.stringMatching(/retry/i)});
 expect(closes).toEqual([]);
 await expect(checkHosted({target:'/a/PAGE12',viewports:[{width:390,height:844}],server:'https://example.test',token:'test-token',busyDelayMs:5},async()=>Response.json({error:refusal.error},{status:429}))).rejects.toMatchObject({code:'browser_busy'});
 // Any other refusal of a create names the server's code and message instead of a mismatched receipt.
 // A refusal to start never ran the steps: the check tries three times itself, then names the server's code; its recovery never says retry.
 let sandboxScripts=0;
 const sandbox=await checkHosted({target:'/a/PAGE12',viewports:[{width:390,height:844}],server:'https://example.test',token:'test-token',busyDelayMs:5},async()=>{sandboxScripts++;return Response.json({...refusal,error:{code:'SANDBOX_UNAVAILABLE',message:'The browser sandbox could not start.'}});}).catch((error:any)=>error);
 expect(sandbox).toMatchObject({code:'browser_session_failed',message:expect.stringContaining('(SANDBOX_UNAVAILABLE): The browser sandbox could not start.')});
 expect(sandboxScripts).toBe(3);expect(sandbox.recovery).not.toMatch(/retry/i);
 // Once it starts on a later attempt, the check simply passes.
 let starts=0;
 expect((await checkHosted({target:'/a/PAGE12',viewports:[{width:390,height:844}],server:'https://example.test',busyDelayMs:5,requester:async(body:any)=>{if(body.op==='close')return {session_id:body.session_id,status:'closed'};if(starts++<1)return {...refusal,error:{code:'SANDBOX_UNAVAILABLE',message:'x'}};return {session_id:body.session_id,execution_id:body.execution_id,status:'completed',result:ok};}})).smokePassed).toBe(true);
 // A lost submission is observed through status, never replayed.
 const lost:string[]=[];
 expect((await checkHosted({target:'/a/PAGE12',viewports:[{width:390,height:844}],server:'https://example.test',busyDelayMs:5,requester:async(body:any)=>{lost.push(body.op);
  if(body.op==='script')throw Object.assign(Error('lost'),{code:'network_unavailable'});
  if(body.op==='close')return {session_id:body.session_id,status:'closed'};
  return {session_id:body.session_id,execution_id:body.execution_id,status:'completed',result:ok};}})).smokePassed).toBe(true);
 expect(lost).toEqual(['script','status','close']);
 // check.mjs sends through the signed-in client (requester): the same refusal waits there too.
 let requesterRefusals=1;const requested:string[]=[];
 const viaClient=await checkHosted({target:'/a/PAGE12',viewports:[{width:390,height:844}],server:'https://example.test',busyDelayMs:5,requester:async(body:any)=>{requested.push(body.op);
  if(body.op==='close')return {session_id:body.session_id,status:'closed'};
  if(requesterRefusals-->0)return refusal;
  return {session_id:body.session_id,execution_id:body.execution_id,status:'completed',result:ok};}});
 expect(viaClient.smokePassed).toBe(true);expect(requested).toEqual(['script','script','close']);
 await expect(checkHosted({target:'/a/PAGE12',viewports:[{width:390,height:844}],server:'https://example.test',busyDelayMs:5,requester:async()=>refusal})).rejects.toMatchObject({code:'browser_busy'});
},20000);

it('collects errors, separates only known telemetry, and catches overflow without implying visual acceptance',async()=>{
 const {inspectPage,summarizeCheck}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const listeners:Record<string,Function>={};let taskRan=false;
 const page={url:()=>'https://example.test/a/PAGE12',on:(name:string,fn:Function)=>{listeners[name]=fn;},setDefaultTimeout:()=>{},setViewportSize:async()=>{},waitForFunction:async()=>{},goto:async()=>{
  listeners.pageerror!(Error('intentional regression'));
  for(const url of ['https://example.test/api/page/artifact/PAGE12/view','https://example.test/data.json','https://other.test/api/page/artifact/PAGE12/view'])listeners.requestfailed!({url:()=>url,failure:()=>({errorText:'failed'})});
 },locator:()=>({waitFor:async()=>{},innerText:async()=>'Fixture',evaluate:async()=>({viewport:390,content:900,fits:false})})};
 const evidence=await inspectPage(page,{target:'/a/PAGE12',viewport:{width:390,height:844}},async()=>{taskRan=true;return {assertion:'task ran'};});
 listeners.pageerror!(Error('cleanup noise'));
 expect(taskRan).toBe(true);expect(evidence.pageErrors).toEqual(['intentional regression']);expect(evidence.failedRequests).toHaveLength(2);expect(evidence.telemetry).toHaveLength(1);
 expect(summarizeCheck([evidence])).toMatchObject({smokePassed:false,unverified:expect.arrayContaining(['visual appearance','task behavior'])});
});

it('captures each failed GraphQL field with its owner detail, and keeps a detail-less read for an owner re-run',async()=>{
 const {inspectPage}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const listeners:Record<string,Function>={};
 const respond=(url:string,body:unknown,sent:unknown)=>listeners.response!({url:()=>url,status:()=>200,json:async()=>body,request:()=>({postDataJSON:()=>sent})});
 const graphql='https://example.test/api/artifacts/PAGE12/graphql',failed='Backend execution failed';
 const page={url:()=>'https://example.test/a/PAGE12',on:(name:string,fn:Function)=>{listeners[name]=fn;},setDefaultTimeout:()=>{},setViewportSize:async()=>{},waitForFunction:async()=>{},
  goto:async()=>{
   listeners.console!({type:()=>'error',text:()=>'before any call'});
   respond(graphql,{data:null,errors:[{message:failed,path:['pipeline','addNote'],extensions:{code:'backend_failed',detail:'validation_failed: field insert_deal_notes_one is not on this page'}}]},{query:'mutation{pipeline{addNote}}',operation:'mutation',revision:'3'});
   respond(graphql,{data:null,errors:[{message:failed,path:['weather','forecast'],extensions:{code:'backend_failed'}}]},{query:'query Q{weather{forecast}}',variables:{city:'Pune'},operationName:'Q',revision:'3'});
   // A detail-less write is never kept for a re-run; a success and other JSON are not failures.
   respond(graphql,{data:null,errors:[{message:failed,path:['pipeline','move'],extensions:{code:'backend_failed'}}]},{query:'mutation{pipeline{move}}',revision:'3'});
   respond(graphql,{data:{ok:true}},{query:'{ok}',revision:'3'});
   respond('https://example.test/data.json',{errors:[{message:'not GraphQL'}]},null);
   listeners.console!({type:()=>'error',text:()=>failed});},
  locator:()=>({waitFor:async()=>{},innerText:async()=>'Ready',evaluate:async()=>({viewport:390,content:390,fits:true})})};
 const evidence=await inspectPage(page,{target:'/a/PAGE12',viewport:{width:390,height:844}});
 expect(evidence.graphqlErrors).toEqual([
  {field:'pipeline.addNote',message:failed,code:'backend_failed',detail:'validation_failed: field insert_deal_notes_one is not on this page',pageErrorsBefore:0,consoleErrorsBefore:1},
  {field:'weather.forecast',message:failed,code:'backend_failed',pageErrorsBefore:0,consoleErrorsBefore:1,replay:{query:'query Q{weather{forecast}}',variables:{city:'Pune'},operationName:'Q',revision:'3'}},
  {field:'pipeline.move',message:failed,code:'backend_failed',pageErrorsBefore:0,consoleErrorsBefore:1}]);
 expect(evidence.consoleErrors).toEqual(['before any call',failed]);
});

it('counts the page\'s dataset reads (GraphQL and dataset cells) on load and in its steps, not other requests',async()=>{
 const {inspectPage}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const listeners:Record<string,Function>={};
 const send=(url:string)=>listeners.request!({url:()=>url,isNavigationRequest:()=>false,frame:()=>null});
 const page={url:()=>'https://example.test/a/PAGE12',on:(name:string,fn:Function)=>{listeners[name]=fn;},setDefaultTimeout:()=>{},setViewportSize:async()=>{},waitForFunction:async()=>{},
  goto:async()=>{send('https://example.test/api/artifacts/PAGE12/graphql');send('https://example.test/data.json');send('https://example.test/api/my/artifacts/PAGE12/annotations');send('https://example.test/api/artifacts/PAGE12/regions/intro/open');},
  locator:()=>({waitFor:async()=>{},innerText:async()=>'Ready',evaluate:async()=>({viewport:390,content:390,fits:true})})};
 const loaded=await inspectPage(page,{target:'/a/PAGE12',viewport:{width:390,height:844}});
 expect(loaded.datasetReads).toBe(1);
 // A read a step triggers (a lazy load after a click) counts, and so does a live dataset cell.
 const stepped=await inspectPage(page,{target:'/a/PAGE12',viewport:{width:390,height:844}},async()=>{send('https://doc.example.test/api/artifacts/PAGE12/graphql');send('https://example.test/api/artifacts/PAGE12/regions/cell%3ADATA12%3Ar1%3Aname/open');});
 expect(stepped.datasetReads).toBe(3);
});

it('loads named ESM and CommonJS Playwright exports and distinguishes invalid modules',async()=>{
 const {loadChromium}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const root=await mkdtemp(join(tmpdir(),'author-browser-module-'));
 try{
  for(const extension of ['mjs','cjs']){
   const file=join(root,'browser.'+extension);
   await writeFile(file,extension==='mjs'?'export const chromium={launch(){return "esm"}}':'module.exports={chromium:{launch(){return "cjs"}}}');
   expect((await loadChromium(file)).launch()).toBe(extension==='mjs'?'esm':'cjs');
  }
  const invalid=join(root,'invalid.mjs');await writeFile(invalid,'export const chromium={}');
  await expect(loadChromium(invalid)).rejects.toMatchObject({code:'browser_module_invalid'});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('keeps check diagnostics top-level on failure, without a details copy',async()=>{
 const {toolFailure}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const {ToolError}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const diagnostics={smokePassed:false,checks:[{error:'fixture'}],unverified:['visual appearance'],note:'Smoke only'};
 expect(toolFailure('check',new ToolError('check_failed','Failed',1,'Inspect',diagnostics))).toMatchObject({...diagnostics,ok:false});expect(toolFailure('check',new ToolError('check_failed','Failed',1,'Inspect',diagnostics))).not.toHaveProperty('details');
 expect(toolFailure('check',new ToolError('invalid_viewport','Invalid',2))).toMatchObject({ok:false,smokePassed:false,checks:[]});
 expect(toolFailure('read',new ToolError('refused','Refused'))).not.toHaveProperty('checks');
});
// The saved screenshot is the document's full height at the viewport's width (capped), so an agent sees below the fold
// without re-running the check at a taller viewport; a deck keeps its viewport capture.
it('captures the document at its full height, capped at 8000 px, and keeps a deck or an oversized page to its viewport',async()=>{
 const {inspectPage}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const fake=({full,bar=0,deck=false,bytes=7}:{full:number;bar?:number;deck?:boolean;bytes?:number})=>{
  const calls:unknown[]=[];let height=0;
  const shot=(target:string)=>async(options:{fullPage?:boolean})=>{calls.push({target,...options});return Buffer.alloc(options.fullPage===false?7:bytes);};
  const frame={waitFor:async()=>{},count:async()=>bar?1:0,screenshot:shot('frame')};
  const page={url:()=>'https://example.test/a/PAGE12',on:()=>{},setDefaultTimeout:()=>{},waitForFunction:async()=>{},goto:async()=>{},
   setViewportSize:async(size:{width:number;height:number})=>{calls.push({resize:size});height=size.height;},
   evaluate:async()=>[full,height-bar],mainFrame:()=>({locator:()=>frame}),
   locator:()=>({waitFor:async()=>{},innerText:async()=>'Ready',evaluate:async(fn:Function)=>fn.name==='slides'?(deck?{count:3}:null):{viewport:390,content:390,fits:true}}),
   screenshot:shot('page')};
  return {page,calls};
 };
 const run=async(spec:Parameters<typeof fake>[0],hosted:boolean)=>{const {page,calls}=fake(spec);const viewport={width:1280,height:800};const result=await inspectPage(page,{target:'/a/PAGE12',viewport,hosted,capture:true});return {calls:calls.slice(1),screenshot:(result as {screenshot?:{partial?:string}}).screenshot};};
 // A local preview: the page's own full-page capture, clipped to the viewport's width and the cap.
 expect(await run({full:20000},false)).toMatchObject({calls:[{target:'page',fullPage:true,clip:{x:0,y:0,width:1280,height:8000}}],screenshot:{scope:'local-viewport',height:8000,partial:'capped at 8000 px'}});
 const local=await run({full:2400},false);
 expect(local.calls).toMatchObject([{target:'page',fullPage:true,clip:{height:2400}}]);expect(local.screenshot).toMatchObject({height:2400});expect(local.screenshot).not.toHaveProperty('partial');
 // A hosted check grows the viewport until the reader's frame holds the whole document, then captures the frame.
 const hosted=await run({full:3000,bar:48},true);
 expect(hosted.calls).toMatchObject([{resize:{width:1280,height:3048}},{target:'frame'}]);expect(hosted.screenshot).toMatchObject({scope:'reader-viewport',height:3000});expect(hosted.screenshot).not.toHaveProperty('partial');
 // A document past the cap fills the frame to 8000 px; only growth beyond its own height marks a viewport-sized page.
 expect(await run({full:20000,bar:48},true)).toMatchObject({calls:[{resize:{width:1280,height:8048}},{target:'frame'}],screenshot:{height:8000,partial:'capped at 8000 px'}});
 // A page that fits, a deck and a capture over the session's output budget keep the viewport capture.
 for(const [spec,partial] of [[{full:600,bar:48},undefined],[{full:3000,bar:48,deck:true},undefined],[{full:3000,bar:48,bytes:6*1024*1024},/first viewport/]] as const){
  const kept=await run(spec,true);expect(kept.calls.at(-1)).toEqual({target:'page',fullPage:false,timeout:1000});expect(kept.screenshot?.partial).toEqual(partial?expect.stringMatching(partial):undefined);
 }
});

it('measures the page only after the reader loading placeholder is gone',async()=>{
 const {inspectPage}=await import('../../../skills/artifactbin/scripts/check.mjs');
 let busy=true;const order:string[]=[];
 const page={url:()=>'https://example.test/a/PAGE12',on:()=>{},setDefaultTimeout:()=>{},setViewportSize:async()=>{},goto:async()=>{},evaluate:async()=>{},
  waitForFunction:async(fn:Function)=>{const doc=(globalThis as any).document;(globalThis as any).document={querySelector:()=>busy?{}:null};try{expect(fn()).toBe(false);busy=false;expect(fn()).toBe(true);}finally{(globalThis as any).document=doc;}order.push('ready');},
  locator:()=>({waitFor:async()=>{},innerText:async()=>{order.push('text');return busy?'Loading page…':'Ready';},evaluate:async()=>({viewport:390,content:390,fits:true})})};
 const result=await inspectPage(page,{target:'/a/PAGE12',viewport:{width:390,height:844}});
 expect(result.text).toBe('Ready');expect(order.indexOf('ready')).toBeLessThan(order.indexOf('text'));
});

it('fails smoke when visible text is effectively invisible against its background',async()=>{
 const {summarizeCheck}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const base={pageErrors:[],consoleErrors:[],httpErrors:[],failedRequests:[],telemetry:[],text:'Deck',overflow:{viewport:1280,content:1280,fits:true}};
 expect(summarizeCheck([{...base,contrast:{checked:40,belowAA:3,unreadable:0,low:[]}}]).smokePassed).toBe(true);
 expect(summarizeCheck([{...base,contrast:{checked:40,belowAA:5,unreadable:2,low:[]}}]).smokePassed).toBe(false);
});
