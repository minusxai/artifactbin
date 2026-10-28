import {test} from 'vitest';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {startPreview} from '../../services/app/skills/artifactbin/scripts/preview.mjs';

test('private preview serves relative files, refuses writes, escapes and foreign hosts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'preview-'));let session;
 try {
  const root=join(dir,'site');await mkdir(join(root,'nested'),{recursive:true});
  await writeFile(join(root,'index.html'),'<script src="nested/app.js"></script>');
  await writeFile(join(root,'nested/app.js'),'fetch("./data.json")');await writeFile(join(root,'nested/data.json'),'[1]');
  await writeFile(join(dir,'secret'),'secret');await symlink(join(dir,'secret'),join(root,'escape'));await writeFile(join(root,'.env'),'secret');
  session=await startPreview({root,port:0});
  const page=await fetch(session.url);assert.equal(page.status,200);assert.match(await page.text(),/nested\/app.js/);
  assert.equal((await (await fetch(session.url+'__af_preview/source?path=%2F')).json()).html,'<script src="nested/app.js"></script>');
  assert.equal((await fetch(session.url+'__af_preview/source?path=%2F..%2Fsecret.html')).status,400);
  const csp=page.headers.get('content-security-policy');assert.match(csp,/connect-src 'self'/);assert.match(csp,/form-action 'none'/);assert.match(csp,/frame-src 'none'/);
  assert.equal(await (await fetch(session.url+'nested/data.json')).text(),'[1]');
  assert.equal((await fetch(session.url+'nested/app.js',{method:'HEAD'})).headers.get('content-type'),'text/javascript; charset=utf-8');
  assert.equal(await (await fetch(session.url,{method:'HEAD'})).text(),'');
  for(const path of ['escape','.env','%2e%2e%2fsecret','nested/','missing'])assert.equal((await fetch(session.url+path)).status,404,path);
  assert.equal((await fetch(session.url,{method:'POST',body:'x'})).status,405);
  assert.equal(await new Promise((done,reject)=>{request(session.url,{headers:{host:'evil.example'}},r=>{r.resume();done(r.statusCode);}).on('error',reject).end();}),403);
 } finally {await session?.close();await rm(dir,{recursive:true,force:true});}
});

test('disk revisions include dependencies, atomic saves and deletions without modifying source',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'preview-revisions-'));let session;
 try {
  await writeFile(join(dir,'index.html'),'<h1>Original</h1>');await writeFile(join(dir,'data.json'),'[1]');
  session=await startPreview({root:dir,revisionIntervalMs:0});
  const revision=async()=> (await (await fetch(session.url+'__af_preview/revision')).json()).revision;
  const first=await revision();
  const html=await (await fetch(session.url)).text();assert.match(html,/File changed/);assert.match(html,/Reload/);
  await writeFile(join(dir,'data.json'),'[2]');const dependency=await revision();assert.notEqual(dependency,first);
  const {rename,unlink,readFile}=await import('node:fs/promises');
  await writeFile(join(dir,'next.html'),'<h1>Atomic</h1>');await rename(join(dir,'next.html'),join(dir,'index.html'));
  const atomic=await revision();assert.notEqual(atomic,dependency);
  await Promise.all([writeFile(join(dir,'a.json'),'1'),writeFile(join(dir,'b.json'),'2')]);assert.notEqual(await revision(),atomic);
  const beforeDelete=await revision();await unlink(join(dir,'data.json'));assert.notEqual(await revision(),beforeDelete);
  assert.equal(await readFile(join(dir,'index.html'),'utf8'),'<h1>Atomic</h1>');
  assert.equal((await fetch(session.url+'data.json')).status,404);
  // Reconnecting clients obtain the current revision without a retained server subscription.
  assert.equal(await revision(),await revision());
 }finally{await session?.close();await rm(dir,{recursive:true,force:true});}
});

test('oversized projects and files fail with actionable size errors',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'preview-limit-'));let session;
 try {
  const {open}=await import('node:fs/promises');const file=await open(join(dir,'large.bin'),'w');await file.truncate(33*1024*1024);await file.close();
  session=await startPreview({root:dir,revisionIntervalMs:0});
  const response=await fetch(session.url+'__af_preview/revision');assert.equal(response.status,413);assert.match((await response.json()).error,/limit|MiB/);
  const asset=await fetch(session.url+'large.bin');assert.equal(asset.status,413);assert.match(await asset.text(),/exceeds/);
 }finally{await session?.close();await rm(dir,{recursive:true,force:true});}
});

test('revision scans share concurrent work and obey an injected cache clock',async()=>{
 const {createRevisionSource}=await import('../../services/app/skills/artifactbin/scripts/preview-changes.mjs');
 let now=0,calls=0,release;const source=createRevisionSource('/unused',{now:()=>now,scan:()=>{calls++;return new Promise(done=>{release=done;});}});
 const a=source.current(),b=source.current();await Promise.resolve();assert.equal(calls,1);release('first');assert.deepEqual(await Promise.all([a,b]),['first','first']);
 assert.equal(await source.current(),'first');assert.equal(calls,1);
 now=1001;const c=source.current();await Promise.resolve();assert.equal(calls,2);release('second');assert.equal(await c,'second');
});

test('revision limits bound file count and aggregate bytes',async()=>{
 const {projectRevision}=await import('../../services/app/skills/artifactbin/scripts/preview-changes.mjs');
 const dir=await mkdtemp(join(tmpdir(),'preview-count-'));
 try {await writeFile(join(dir,'a'),'123');await writeFile(join(dir,'b'),'456');
  await assert.rejects(projectRevision(dir,{maxFiles:1,maxFileBytes:10,maxTotalBytes:100}),/files/);
  await assert.rejects(projectRevision(dir,{maxFiles:10,maxFileBytes:10,maxTotalBytes:5}),/limit/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

async function localFixture(options={}){
 const root=await mkdtemp(join(tmpdir(),'preview-session-'));let dirty=false;
 await writeFile(join(root,'index.html'),'<link rel="af-dataset" data-af-name="local" href="./data.json">');await writeFile(join(root,'data.json'),'[{"amount":1}]');
 const factory=async()=>({schema:{},async execute(request){if(request.query==='edit')dirty=true;return {data:{ok:true}};},status:async()=>({dirty,namespaces:dirty?['local']:[]}),export:()=>({dirty})});
 const session=await startPreview({root,revisionIntervalMs:0,...options,sessionOptions:{createDatasets:factory,...options.sessionOptions}});
 const config=async(path='')=>JSON.parse((await (await fetch(session.url+path)).text()).match(/<script[^>]*data-af="runtime"[^>]*>([\s\S]*?)<\/script>/)[1]);
 const execute=(endpoint,query='query')=>fetch(new URL(endpoint,session.url),{method:'POST',headers:{origin:new URL(session.url).origin,'content-type':'application/json'},body:JSON.stringify({query})});
 return {root,session,config,execute,async close(){await session.close();await rm(root,{recursive:true,force:true});}};
}

test('dirty sessions survive source edits, idle expiry and full-cache admission until explicit discard',async()=>{
 let now=0;const f=await localFixture({sessionOptions:{now:()=>now,ttlMs:10,maxSessions:1}});
 try {
  const config=await f.config(),endpoint=config.localPreview.endpoint;await f.execute(endpoint,'edit');now=11;
  await writeFile(join(f.root,'data.json'),'[{"amount":2}]');const retained=await f.config();assert.equal(retained.localPreview.endpoint,endpoint);
  const status=await (await fetch(new URL(endpoint+'/status',f.session.url))).json();assert.equal(status.dirty,true);assert.equal(status.conflict,true);
  await writeFile(join(f.root,'other.html'),'<link rel="af-dataset" data-af-name="local" href="./data.json">');
  const full=await fetch(f.session.url+'other.html');assert.equal(full.status,429);assert.match((await full.json()).error,/unsaved/);
  assert.equal((await fetch(new URL(endpoint+'/export/local',f.session.url))).status,200);
  const {unlink}=await import('node:fs/promises');await unlink(join(f.root,'index.html'));const missing=await fetch(f.session.url);assert.equal(missing.status,409);assert.match(await missing.text(),/edits are retained/);
  await writeFile(join(f.root,'index.html'),'<link rel="af-dataset" data-af-name="local" href="./data.json">');
  assert.equal((await fetch(new URL(endpoint+'/discard',f.session.url),{method:'POST',headers:{origin:new URL(f.session.url).origin}})).status,200);
  assert.notEqual((await f.config()).localPreview.endpoint,endpoint);
 }finally{await f.close();}
});

test('clean sessions expire and local operation/body limits are enforced',async()=>{
 let now=0;const f=await localFixture({sessionOptions:{now:()=>now,ttlMs:10}});
 try {
  let endpoint=(await f.config()).localPreview.endpoint;now=11;assert.equal((await f.execute(endpoint)).status,410);
  endpoint=(await f.config()).localPreview.endpoint;
  const large=await fetch(new URL(endpoint,f.session.url),{method:'POST',headers:{origin:new URL(f.session.url).origin,'content-type':'application/json'},body:JSON.stringify({query:'x'.repeat(65536)})});assert.equal(large.status,413);
  for(let i=1;i<512;i++)assert.equal((await f.execute(endpoint)).status,200);
  assert.equal((await f.execute(endpoint)).status,429);
 }finally{await f.close();}
});

test('local operations bound concurrency and pass a real abort signal',async()=>{
 const releases=[];let calls=0;
 const createDatasets=async()=>({schema:{},status:async()=>({dirty:false,namespaces:[]}),export:()=>({}),execute:async(request,signal)=>{
  calls++;return new Promise((done,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});if(request.query!=='timeout')releases.push(()=>done({data:{ok:true}}));});
 }});
 const f=await localFixture({operationTimeoutMs:100,sessionOptions:{createDatasets}});
 try {
  const endpoint=(await f.config()).localPreview.endpoint;
  const operations=Array.from({length:4},()=>f.execute(endpoint));
  while(calls<4)await new Promise(done=>setTimeout(done,1));
  assert.equal((await f.execute(endpoint)).status,429);for(const release of releases)release();await Promise.all(operations);
  const timeout=await f.execute(endpoint,'timeout');assert.equal(timeout.status,400);assert.match((await timeout.json()).error,/timed out/);
 }finally{await f.close();}
});


test('platform modules come only from closed /af/, /libraries/ and /af/components/ paths, fetched once from the selected server',async()=>{
 const {platformModules}=await import('../../services/app/skills/artifactbin/scripts/preview-platform.mjs');
 const {withHttpServer}=await import('../../services/test-support/src/net.ts');
 const requests=[];
 const files={'/af/core.js':'core()','/af/apollo.js':'export const apollo=1;','/af/reader.js':'export const reader=1;','/af/components/tabs.js':'import "./chunk-abc.js";','/af/components/chunk-abc.js':'export {};','/libraries/fixture-1.0.0/index.js':'export const value=1;','/af/import-map.json':JSON.stringify({imports:{'@afbin/fixture':'/libraries/fixture-1.0.0/index.js','@afbin/tabs':'/af/components/tabs.js','@afbin/evil':'https://evil.test/x.js','not-reserved':'/af/components/tabs.js'}})};
 const server=await withHttpServer((incoming,reply)=>{requests.push(incoming.url);const body=files[incoming.url];reply.writeHead(body===undefined?404:200,{'content-type':incoming.url.endsWith('.json')?'application/json':'text/javascript'});reply.end(body??'missing');});
 try{
  const platform=platformModules({origin:server.base});
  assert.equal(String(await platform.module('/af/core.js')),'core()');assert.equal(String(await platform.module('/af/v1/core.js')),'core()');
  assert.equal(String(await platform.module('/af/components/chunk-abc.js')),'export {};');
  for(const refused of ['/af/../secret.js','/af/components/nested/x.js','/libraries/fixture/index.js','/index.html','/af/styles.css'])assert.equal(await platform.module(refused),null,refused);
  assert.equal(await platform.module('/af/components/absent.js'),null);
  assert.deepEqual(await platform.importMap(),{'@afbin/fixture':'/libraries/fixture-1.0.0/index.js','@afbin/tabs':'/af/components/tabs.js'});
  const runtime=await platform.runtimeAssets();assert.equal(runtime.core,'core()');assert.equal(runtime.apolloPath,'/af/apollo.js');assert.equal(runtime.chrome,undefined);
  await platform.module('/af/core.js');assert.equal(requests.filter(url=>url==='/af/core.js').length,1);
  assert.equal(await platformModules({origin:null}).module('/af/core.js'),null);
  assert.throws(()=>platformModules({origin:'file:///tmp'}),/http\(s\)/);
 }finally{await server.close();}
});

test('private preview mounts only admitted versioned library bytes without eval permissions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'preview-libraries-'));let session;
 try {
  await writeFile(join(dir,'index.html'),'<script type="module">import * as vega from "/libraries/vega-6.3.1/index.js";</script>');
  session=await startPreview({root:dir,libraryAssets:{'/libraries/vega-6.3.1/index.js':'export const version="6.3.1";'}});
  const response=await fetch(session.url+'libraries/vega-6.3.1/index.js'); assert.equal(response.status,200); assert.equal(await response.text(),'export const version="6.3.1";');
  assert.equal((await fetch(session.url+'libraries/vega-999.0.0/index.js')).status,404); assert.doesNotMatch(response.headers.get('content-security-policy'),/'unsafe-eval'/);
 }finally{await session?.close();await rm(dir,{recursive:true,force:true});}
});

test('explicit export packs local component graphs and registered libraries without changing source',async()=>{
 const {readFile}=await import('node:fs/promises');const dir=await mkdtemp(join(tmpdir(),'preview-export-'));let session;
 try{
  const html='<script type="module">import {lazy} from "./components/main.js";lazy();</script>';
  await mkdir(join(dir,'components'));await writeFile(join(dir,'index.html'),html);
  await writeFile(join(dir,'components/main.js'),'export const lazy=()=>import("./lazy.js");');await writeFile(join(dir,'components/lazy.js'),'export {value} from "/libraries/fixture-1.0.0/index.js";');
  session=await startPreview({root:dir,libraryAssets:{'/libraries/fixture-1.0.0/index.js':'export const value=42;'}});
  const response=await fetch(session.url+'__af_preview/export-source?path=%2F');assert.equal(response.status,200);const packed=await response.json();assert.equal(packed.html,html);assert.match(packed.renderedHtml,/data:text\/javascript;base64,/);assert.match(packed.renderedHtml,/@afbin\/local-export/);assert.equal(await readFile(join(dir,'index.html'),'utf8'),html);
  for(const source of ['<script type="module">import "https://foreign.test/a.js";</script>','<script src="./missing.js"></script>','<script src="../outside.js"></script>']){await writeFile(join(dir,'index.html'),source);const failed=await fetch(session.url+'__af_preview/export-source?path=%2F');assert.equal(failed.status,422);assert.match((await failed.json()).error,/Local export failed/);assert.equal(await readFile(join(dir,'index.html'),'utf8'),source);}
  await writeFile(join(dir,'index.html'),'<script src="./link.js"></script>');await symlink(join(dir,'components/main.js'),join(dir,'link.js'));const failed=await fetch(session.url+'__af_preview/export-source?path=%2F');assert.equal(failed.status,422);assert.match((await failed.json()).error,/Symlink/);
 }finally{await session?.close();await rm(dir,{recursive:true,force:true});}
});
