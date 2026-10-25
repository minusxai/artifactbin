/** Publish the actual installed native examples; resolver execution has separate real-runner coverage. */
import {describe,expect,it,vi} from 'vitest';
import {skillTree} from '@/lib/skills';
import {skillPackageFiles} from '@/lib/skills/package';
import {GET as skillArchive} from '@/app/skills/artifactbin.zip/route';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {POST as publish} from '@/app/api/artifacts/route';
import {GET as read,PUT as update} from '@/app/api/artifacts/[id]/route';
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
