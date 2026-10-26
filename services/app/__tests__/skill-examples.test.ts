/** Publish the actual installed native examples; resolver execution has separate real-runner coverage. */
import {describe,expect,it,vi} from 'vitest';
import {skillTree} from '@/lib/skills';
import {skillPackageFiles} from '@/lib/skills/package';
import {GET as skillArchive} from '@/app/skills/artifactbin.zip/route';
import {mkdtemp,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {POST as publish} from '@/app/api/artifacts/route';
import {GET as read,PUT as update} from '@/app/api/artifacts/[id]/route';
import {GET as listComments,POST as addComment} from '@/app/api/artifacts/[id]/annotations/route';
import {POST as replyComment,PATCH as editComment} from '@/app/api/artifacts/[id]/annotations/[annId]/route';
import {request,useAppHarness,mintAccountToken} from './harness';
vi.mock('@/lib/page-operations',async original=>({...await original<typeof import('@/lib/page-operations')>(),compilePageBackend:async(source:string)=>{
 const typeDefs=/export const typeDefs\s*=\s*`([\s\S]*?)`/.exec(source)?.[1];if(!typeDefs)throw Error('Missing example schema');return{typeDefs,compiled:source};
}}));
useAppHarness();const files=()=>skillPackageFiles(skillTree(),'http://localhost:3000');
describe('installed native author examples',()=>{
 it('publishes report HTML with canonical data-af identities',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'native-skill-example-'));
  try{
   const zip=path.join(dir,'skill.zip');await writeFile(zip,new Uint8Array(await (await skillArchive(new Request('http://localhost/skills/artifactbin.zip'))).arrayBuffer()));execFileSync('unzip',['-q',zip,'-d',dir]);
   const installed=path.join(dir,'artifactbin'),{prepareBundle}=await import(pathToFileURL(path.join(installed,'scripts/publication-bundle.mjs')).href);
   // The API test project caps uploaded files at 10 KB; the installed-skill tests cover the full portable font graph.
   const source=await readFile(path.join(installed,'examples/report.html'),'utf8');const saved=await prepareBundle({root:installed,entry:'examples/report.html',entryHtml:source.replace(/<link[^>]*data-af="design-system"[^>]*>/,'<link data-af="design-system" rel="stylesheet" href="https://styles.example/theme.css">'),server:'http://localhost:3000'});
   const owner=await mintAccountToken('sample-report');const response=await publish(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':saved.idempotencyKey},json:saved.body}));expect(response.status,await response.clone().text()).toBe(201);const page=await response.json();expect(page.format).toBe('html');expect(page.html).toContain('data-af-id=');
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('publishes the CSV separately and binds its real identity in the dashboard bundle',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'native-skill-dashboard-'));
  try{
   const zip=path.join(dir,'skill.zip');await writeFile(zip,new Uint8Array(await (await skillArchive(new Request('http://localhost/skills/artifactbin.zip'))).arrayBuffer()));execFileSync('unzip',['-q',zip,'-d',dir]);
   const installed=path.join(dir,'artifactbin'),{prepareBundle}=await import(pathToFileURL(path.join(installed,'scripts/publication-bundle.mjs')).href);
   const owner=await mintAccountToken('sample-dashboard'),kit=files();const dataset=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:kit['examples/repairs.csv']}}));expect(dataset.status).toBe(201);const data=await dataset.json();
   const source=await readFile(path.join(installed,'examples/csv-dashboard.html'),'utf8'),saved=await prepareBundle({root:installed,entry:'examples/csv-dashboard.html',entryHtml:source.replaceAll('DATASET_ID',data.id).replace(/<link[^>]*data-af="design-system"[^>]*>/,'<link data-af="design-system" rel="stylesheet" href="https://styles.example/theme.css">'),server:'http://localhost:3000'});
   const response=await publish(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':saved.idempotencyKey},json:saved.body}));expect(response.status,await response.clone().text()).toBe(201);const page=await response.json();expect(page.html).toContain('ref:'+data.id);expect(page.html).not.toContain('DATASET_ID');
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('creates and conditionally updates a project through installed helpers with durable dependency receipts',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'native-skill-update-'));
  try{
   const zip=path.join(dir,'skill.zip');await writeFile(zip,new Uint8Array(await (await skillArchive(new Request('http://localhost/skills/artifactbin.zip'))).arrayBuffer()));execFileSync('unzip',['-q',zip,'-d',dir]);
   const installed=path.join(dir,'artifactbin');
   const {prepareBundle,prepareBundleUpdate,sendBundleFile}=await import(pathToFileURL(path.join(installed,'scripts/publication-bundle.mjs')).href);
   const owner=await mintAccountToken('sample-project-update'),server='http://localhost:3000',env={ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:owner.token};
   const fetcher:typeof fetch=async(input,init)=>{
    const url=new URL(String(input)),id=url.pathname.split('/').at(-1)!;
    const req=request(url.pathname,{method:init?.method,token:owner.token,headers:{'Idempotency-Key':new Headers(init?.headers).get('Idempotency-Key')!},json:JSON.parse(String(init?.body))});
    return init?.method==='PUT'?update(req,{params:Promise.resolve({id})}):publish(req);
   };
   const source='<link rel="stylesheet" href="./theme.css"><h1 data-af-id="project-heading">One</h1>';
   await writeFile(path.join(installed,'index.html'),source);await writeFile(path.join(installed,'theme.css'),'body{color:red}');
   const first=await prepareBundle({root:installed,entry:'index.html',server}),createFile=path.join(dir,'create.json');
   await writeFile(createFile,JSON.stringify(first));const created=await sendBundleFile(createFile,env,fetcher);
   expect((await sendBundleFile(createFile,env,fetcher)).id).toBe(created.id);
   const baseline=await (await read(request('/api/artifacts/'+created.id,{token:owner.token}),{params:Promise.resolve({id:created.id})})).json();
   const previous=JSON.parse(await readFile(createFile+'.receipt.json','utf8'));
   await writeFile(path.join(installed,'index.html'),source.replace('One','Two'));await writeFile(path.join(installed,'theme.css'),'body{color:blue}');
   const next=await prepareBundleUpdate({root:installed,entry:'index.html',server,head:baseline,mappings:previous.mappings}),updateFile=path.join(dir,'update.json');
   await writeFile(updateFile,JSON.stringify(next));const changed=await sendBundleFile(updateFile,env,fetcher);
   expect(changed.id).toBe(created.id);expect(changed.version).toBe(baseline.version+1);
   expect(changed.dependencyReceipts[0]).toMatchObject({id:created.dependencyReceipts[0].id,revision:'2'});
   expect(changed.html).toContain('data-af-id="project-heading"');
   expect((await sendBundleFile(updateFile,env,fetcher)).version).toBe(changed.version);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('runs the installed canonical read/edit/publish and immutable resume workflow',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'author-toolbox-installed-'));
  try{
   const zip=path.join(dir,'skill.zip');await writeFile(zip,new Uint8Array(await (await skillArchive(new Request('http://localhost/skills/artifactbin.zip'))).arrayBuffer()));execFileSync('unzip',['-q',zip,'-d',dir]);
   const installed=path.join(dir,'artifactbin'),project=path.join(installed,'project');await (await import('node:fs/promises')).mkdir(project);
   const {publishCommand}=await import(pathToFileURL(path.join(installed,'scripts/toolbox-publish.mjs')).href),{readCommand}=await import(pathToFileURL(path.join(installed,'scripts/read.mjs')).href),{commentCommand}=await import(pathToFileURL(path.join(installed,'scripts/comment.mjs')).href);
   const owner=await mintAccountToken('toolbox-canonical'),server='http://localhost:3000';let loseResponse=false;
   const options={env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:owner.token,ARTIFACTBIN_HOME:path.join(dir,'private')},fetcher:async(input:any,init:any)=>{
    const url=new URL(String(input)),id=url.pathname.split('/').at(-1)!,method=init?.method??'GET';
    const req=request(url.pathname,{method,token:owner.token,headers:{'Idempotency-Key':new Headers(init?.headers).get('Idempotency-Key')??''},...(init?.body?{json:JSON.parse(String(init.body))}:{})});
    const segments=url.pathname.split('/'),pageId=segments[3];
    const response=segments[4]==='annotations'?(segments[5]?await (method==='PATCH'?editComment:replyComment)(req,{params:Promise.resolve({id:pageId,annId:segments[5]})}):await (method==='GET'?listComments:addComment)(req,{params:Promise.resolve({id:pageId})})):method==='GET'?await read(req,{params:Promise.resolve({id})}):method==='PUT'?await update(req,{params:Promise.resolve({id})}):await publish(req);
    if(loseResponse&&method==='PUT'){loseResponse=false;throw Error('connection lost after commit');}return response;
   }};
   const source=path.join(project,'index.html');await writeFile(source,'<link rel="stylesheet" href="./theme.css"><h1>One</h1>');await writeFile(path.join(project,'theme.css'),'body{color:red}');
   const first=await publishCommand({values:{server},positionals:[source]},options);expect(first.version).toBe(1);
   // An unchanged input becomes the canonical pair in place; no sibling copies.
   expect(first.updatedInPlace).toBe(true);expect(first.source).toBe(await realpath(source));expect(first.baseline).toBe(first.source+'.af.json');
   const canonical=await readFile(first.source,'utf8'),baseline=JSON.parse(await readFile(first.baseline,'utf8'));expect(canonical).toContain('href="./theme.css"');expect(baseline.dependencyReceipts).toHaveLength(1);
   const nodeId=/data-af-id="([^"]+)"[^>]*>One/.exec(canonical)?.[1];expect(nodeId).toBeTruthy();
   const anchor=path.join(dir,'anchor.json'),bodyFile=path.join(dir,'comment.txt');await writeFile(anchor,JSON.stringify({kind:'html-node',v:1,revision:'1',nodeId,quote:'One'}));await writeFile(bodyFile,'Review this heading');
   const comment=await commentCommand({sub:'add',values:{server,anchor,'body-file':bodyFile},positionals:[first.id]},options);
   const comments=await commentCommand({sub:'list',values:{server,status:'all'},positionals:[first.id]},options);expect(comments.annotations).toHaveLength(1);
   const thread=comments.annotations[0];await writeFile(bodyFile,'Checked the source');
   const replied=await commentCommand({sub:'reply',values:{server,thread:thread.id,'expected-revision':String(thread.revision),'body-file':bodyFile,resolve:true},positionals:[first.id]},options);expect(replied.thread.status).toBe('resolved');
   expect((await commentCommand({sub:'reply',values:{server,resume:replied.journal},positionals:[]},options)).thread.revision).toBe(replied.thread.revision);
   expect(comment.journal).toBeTruthy();
   await writeFile(first.source,canonical.replace('>One<','>Two<'));await writeFile(path.join(project,'theme.css'),'body{color:blue}');
   const journal=path.join(dir,'update-request.json');loseResponse=true;
   await expect(publishCommand({values:{server,request:journal},positionals:[first.source]},options)).rejects.toMatchObject({code:'outcome_unknown'});
   await writeFile(first.source,canonical.replace('>One<','>Unsaved later edit<'));
   const changed=await publishCommand({values:{server,resume:journal},positionals:[]},options);expect(changed.id).toBe(first.id);expect(changed.version).toBe(2);
   expect(changed.updatedInPlace).toBeUndefined();expect(changed.source).not.toBe(first.source);expect(changed.note).toContain('input changed');
   expect(await readFile(changed.source,'utf8')).toContain('>Two<');expect(await readFile(first.source,'utf8')).toContain('Unsaved later edit');
   expect(JSON.parse(await readFile(changed.baseline,'utf8')).dependencyReceipts[0]).toMatchObject({id:baseline.dependencyReceipts[0].id,revision:'2'});
   await expect(publishCommand({values:{server},positionals:[first.source]},options)).rejects.toMatchObject({exit:4});
   const downloaded=await readCommand({values:{server,output:path.join(project,'read.html')},positionals:[first.id]},options);expect(JSON.parse(await readFile(downloaded.baseline,'utf8')).dependencyReceipts).toHaveLength(1);
   // Repeated edit → publish cycles keep one file and advance its companion.
   const pairSource=await realpath(downloaded.source);
   for(const [text,version] of [['Three',3],['Four',4]] as const){
    await writeFile(downloaded.source,(await readFile(downloaded.source,'utf8')).replace(/>(Two|Three)</,`>${text}<`));
    const next=await publishCommand({values:{server},positionals:[downloaded.source]},options);
    expect(next).toMatchObject({version,updatedInPlace:true,source:pairSource,baseline:pairSource+'.af.json'});
    expect(JSON.parse(await readFile(downloaded.baseline,'utf8')).version).toBe(version);
   }
   await (await import('node:fs/promises')).unlink(downloaded.baseline);
   await expect(publishCommand({values:{server},positionals:[downloaded.source]},options)).rejects.toMatchObject({code:'baseline_missing'});
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('publishes the shared app with its declared backend source atomically',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'native-skill-app-'));
  try{
  const zip=path.join(dir,'skill.zip');await writeFile(zip,new Uint8Array(await (await skillArchive(new Request('http://localhost/skills/artifactbin.zip'))).arrayBuffer()));execFileSync('unzip',['-q',zip,'-d',dir]);
  const installed=path.join(dir,'artifactbin'),{prepareBundle}=await import(pathToFileURL(path.join(installed,'scripts/publication-bundle.mjs')).href),owner=await mintAccountToken('sample-app');
  const source=await readFile(path.join(installed,'examples/shared-app.html'),'utf8'),saved=await prepareBundle({root:installed,entry:'examples/shared-app.html',entryHtml:source.replace(/<link[^>]*data-af="design-system"[^>]*>/,'<link data-af="design-system" rel="stylesheet" href="https://styles.example/theme.css">'),server:'http://localhost:3000'});const response=await publish(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':saved.idempotencyKey},json:{...saved.body,backendSources:{garden:await readFile(path.join(installed,'examples/garden.ts'),'utf8')}}}));expect(response.status,await response.clone().text()).toBe(201);const page=await response.json();
  const head=await read(request(`/api/artifacts/${page.id}`,{token:owner.token}),{params:Promise.resolve({id:page.id})});expect(head.status).toBe(200);expect((await head.json()).html).toContain('data-af-name="garden"');
  }finally{await rm(dir,{recursive:true,force:true});}
 });
});
