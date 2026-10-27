import {expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

it('prepares a conditional project update with retained mappings and a fresh immutable write key',async()=>{
 const {prepareBundleUpdate,sendBundleFile}=await import('../../../skills/artifactbin/scripts/publication-bundle.mjs');
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
  const request=join(root,'request.json');await writeFile(request,JSON.stringify(saved));
  const calls:unknown[]=[];
  const fetcher=async(_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{calls.push(init);return Response.json({id:'PAGE12',version:5,dependencyReceipts:[{path:'theme.css',kind:'asset',id:'ASSET1',revision:'4',state:'new-state'}]});};
  const env={ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'test-token'};
  await sendBundleFile(request,env,fetcher);await sendBundleFile(request,env,fetcher);
  expect(calls[0]).toEqual(calls[1]);
  expect(JSON.parse(await readFile(request+'.receipt.json','utf8')).mappings['theme.css']).toMatchObject({revision:'4',state:'new-state'});
 }finally{await rm(root,{recursive:true,force:true});}
});

it('provides help without reading project files or credentials',()=>{
 for(const script of ['publication-bundle','publish','preview','check'])expect(execFileSync(process.execPath,[new URL('../../../skills/artifactbin/scripts/'+script+'.mjs',import.meta.url).pathname,'--help'],{encoding:'utf8'})).toContain('Usage:');
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

it('runs several steps files in order in each viewport session and labels each result',async()=>{
 const {checkHosted}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const requests:any[]=[];
 const run=await checkHosted({target:'/a/PAGE12',viewports:[{width:390,height:844}],steps:[{name:'read.mjs',code:'return "read"'},{name:'save.mjs',code:'return "save"'}],server:'https://example.test',token:'test-token'},async(_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));requests.push(body);
  if(body.op==='close')return Response.json({session_id:body.session_id,status:'closed'});
  return Response.json({session_id:body.session_id,execution_id:body.execution_id,status:'completed',result:{viewport:{width:390},pageErrors:[],consoleErrors:[],failedRequests:[],httpErrors:[],telemetry:[],text:'Ready',overflow:{viewport:390,content:390,fits:true},steps:true}});
 });
 const scripts=requests.filter(request=>request.op==='script');
 // One session per viewport, one execution per file, in the order given.
 expect(new Set(scripts.map(request=>request.session_id)).size).toBe(1);
 expect(new Set(scripts.map(request=>request.execution_id)).size).toBe(2);
 expect(scripts[0].code).toContain('"read"');expect(scripts[1].code).toContain('"save"');
 expect(run.checks.map((check:any)=>check.stepsFile)).toEqual(['read.mjs','save.mjs']);
 expect(requests.filter(request=>request.op==='close')).toHaveLength(1);
});

it('waits for a free browser session and names a full server instead of failing opaquely',async()=>{
 const {checkHosted}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const ok={pageErrors:[],consoleErrors:[],failedRequests:[],httpErrors:[],telemetry:[],text:'Ready',overflow:{viewport:390,content:390,fits:true}};
 const busy=()=>Response.json({error:{code:'SESSION_ACTOR_CAPACITY',message:'One credential may hold at most 2 browser sessions at once.'}},{status:429});
 let refusals=1;const ops:string[]=[];
 const run=await checkHosted({target:'/a/PAGE12',viewports:[{width:390,height:844}],server:'https://example.test',token:'test-token'},async(_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));ops.push(body.op);
  if(body.op==='close')return Response.json({session_id:body.session_id,status:'closed'});
  if(body.op==='script'&&refusals-->0)return busy();
  return Response.json({session_id:body.session_id,execution_id:body.execution_id,status:'completed',result:ok});
 });
 expect(run.smokePassed).toBe(true);expect(ops.filter(op=>op==='script')).toHaveLength(2);expect(ops).not.toContain('status');
 await expect(checkHosted({target:'/a/PAGE12',viewports:[{width:390,height:844}],server:'https://example.test',token:'test-token'},async()=>busy())).rejects.toMatchObject({code:'browser_busy',message:expect.stringContaining('at most 2 browser sessions')});
},40000);

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
it('keeps check diagnostics top-level on failure and preserves the legacy details alias',async()=>{
 const {toolFailure}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const {ToolError}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const diagnostics={smokePassed:false,checks:[{error:'fixture'}],unverified:['visual appearance'],note:'Smoke only'};
 expect(toolFailure('check',new ToolError('check_failed','Failed',1,'Inspect',diagnostics))).toMatchObject({...diagnostics,ok:false,details:diagnostics});
 expect(toolFailure('check',new ToolError('invalid_viewport','Invalid',2))).toMatchObject({ok:false,smokePassed:false,checks:[]});
 expect(toolFailure('read',new ToolError('refused','Refused'))).not.toHaveProperty('checks');
});
it('captures a bounded viewport and labels hosted shell scope without a full body capture',async()=>{
 const {inspectPage}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const captures:unknown[]=[];
 const page={url:()=> 'https://example.test/a/PAGE12',on:()=>{},setDefaultTimeout:()=>{},setViewportSize:async()=>{},waitForFunction:async()=>{},goto:async()=>{},mainFrame:()=>({locator:()=>({waitFor:async()=>{}})}),locator:()=>({waitFor:async()=>{},innerText:async()=>'Ready',evaluate:async()=>({viewport:390,content:390,fits:true})}),screenshot:async(options:unknown)=>{captures.push(options);return Buffer.from('fixture');}};
 const result=await inspectPage(page,{target:'/a/PAGE12',viewport:{width:390,height:844},hosted:true,capture:true});
 expect(captures).toEqual([{fullPage:false,timeout:1000}]);expect(result).toMatchObject({screenshot:{scope:'reader-viewport'}});
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
