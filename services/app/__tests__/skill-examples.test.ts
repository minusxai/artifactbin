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
   // Retries off: the journal/--resume path is what recovers a lost response when no automatic retry is wanted.
   await expect(publishCommand({values:{server,request:journal},positionals:[first.source]},{...options,retryDelays:[]})).rejects.toMatchObject({code:'outcome_unknown'});
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
   // Only markup carries page identity: a new page whose script selects [data-af-id="..."] publishes as new.
   const scripted=path.join(project,'scripted.html');await writeFile(scripted,'<h1>New</h1><script type="module">document.querySelector(`[data-af-id="row-1"]`)</script>');
   expect((await publishCommand({values:{server},positionals:[scripted]},options)).version).toBe(1);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('keeps a published backend href in the author source so later backend edits are sent',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'author-backend-roundtrip-'));
  try{
   const zip=path.join(dir,'skill.zip');await writeFile(zip,new Uint8Array(await (await skillArchive(new Request('http://localhost/skills/artifactbin.zip'))).arrayBuffer()));execFileSync('unzip',['-q',zip,'-d',dir]);
   const installed=path.join(dir,'artifactbin'),project=path.join(dir,'project');await (await import('node:fs/promises')).mkdir(project);
   const {publishCommand}=await import(pathToFileURL(path.join(installed,'scripts/toolbox-publish.mjs')).href),{readCommand}=await import(pathToFileURL(path.join(installed,'scripts/read.mjs')).href);
   const owner=await mintAccountToken('toolbox-backend'),server='http://localhost:3000',sent:any[]=[];
   const options={env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:owner.token,ARTIFACTBIN_HOME:path.join(dir,'private')},fetcher:async(input:any,init:any)=>{
    const url=new URL(String(input)),id=url.pathname.split('/').at(-1)!,method=init?.method??'GET',json=init?.body?JSON.parse(String(init.body)):undefined;if(json)sent.push(json);
    const req=request(url.pathname,{method,token:owner.token,headers:{'Idempotency-Key':new Headers(init?.headers).get('Idempotency-Key')??''},...(json?{json}:{})});
    return method==='GET'?await read(req,{params:Promise.resolve({id})}):method==='PUT'?await update(req,{params:Promise.resolve({id})}):await publish(req);
   }};
   const html=(await readFile(path.join(installed,'examples/shared-app.html'),'utf8')).replace(/<link[^>]*data-af="design-system"[^>]*>/,'<link data-af="design-system" rel="stylesheet" href="https://styles.example/theme.css">');
   const source=path.join(project,'index.html'),backend=path.join(project,'garden.ts');await writeFile(source,html);await writeFile(backend,await readFile(path.join(installed,'examples/garden.ts'),'utf8'));
   const first=await publishCommand({values:{server},positionals:[source]},options);expect(first.updatedInPlace).toBe(true);
   // The canonical page binds the backend by name only; the author's working copy keeps its local source path.
   expect(await readFile(source,'utf8')).toMatch(/<link href="\.\/garden\.ts"[^>]*rel="af-backend"/);
   await writeFile(backend,(await readFile(backend,'utf8'))+'\n// edited after first publish\n');
   sent.length=0;const second=await publishCommand({values:{server},positionals:[source]},options);expect(second.version).toBe(2);
   const put=sent.find(body=>body.expectedVersion===1);expect(put.publicationBundle.files.map((file:any)=>file.path)).toContain('garden.ts');
   expect(Buffer.from(put.publicationBundle.files.find((file:any)=>file.path==='garden.ts').base64,'base64').toString('utf8')).toContain('edited after first publish');
   // A reader's copy has no local backend source and keeps the published backend.
   const copy=await readCommand({values:{server,output:path.join(project,'copy.html')},positionals:[first.id]},options);expect(await readFile(copy.source,'utf8')).not.toContain('garden.ts');
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
 it('runs autofix on publish: writes fixes, refuses problems, --strict refuses fixes, and carries IDs forward on regeneration',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'author-autofix-publish-'));
  try{
   const zip=path.join(dir,'skill.zip');await writeFile(zip,new Uint8Array(await (await skillArchive(new Request('http://localhost/skills/artifactbin.zip'))).arrayBuffer()));execFileSync('unzip',['-q',zip,'-d',dir]);
   const installed=path.join(dir,'artifactbin'),project=path.join(dir,'project');await (await import('node:fs/promises')).mkdir(project);
   const {publishCommand}=await import(pathToFileURL(path.join(installed,'scripts/toolbox-publish.mjs')).href);
   const owner=await mintAccountToken('toolbox-autofix'),server='http://localhost:3000',logs:string[]=[];
   const options={log:(text:string)=>{logs.push(text);},env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:owner.token,ARTIFACTBIN_HOME:path.join(dir,'private')},fetcher:async(input:any,init:any)=>{
    const url=new URL(String(input)),id=url.pathname.split('/').at(-1)!,method=init?.method??'GET';
    const req=request(url.pathname,{method,token:owner.token,headers:{'Idempotency-Key':new Headers(init?.headers).get('Idempotency-Key')??''},...(init?.body?{json:JSON.parse(String(init.body))}:{})});
    return method==='GET'?await read(req,{params:Promise.resolve({id})}):method==='PUT'?await update(req,{params:Promise.resolve({id})}):await publish(req);
   }};
   const source=path.join(project,'index.html');
   const body='<h1>Quarterly plan</h1>\n<p>Three bets for the next quarter.</p>\n<ul><li>Ship the importer</li><li>Halve time to first chart</li></ul>\n';
   const draft=`<!doctype html>\n<html>\n<head><title>Plan</title></head>\n<body>\n${body}<script defer src="/af/v1/core.js"></script>\n</body>\n</html>\n`;
   // Refusals stop before anything is sent or written.
   await writeFile(source,draft.replace('</ul>','</ul><img src="./missing.png">'));
   await expect(publishCommand({values:{server},positionals:[source]},options)).rejects.toMatchObject({code:'autofix_refused',exit:2});
   expect(logs.at(-1)).toMatch(/^autofix: .*nothing published or written/);expect(logs.at(-1)).toMatch(/index\.html:\d+:\d+ local file not found/);
   await writeFile(source,draft);
   await expect(publishCommand({values:{server,strict:true},positionals:[source]},options)).rejects.toMatchObject({code:'autofix_strict'});
   expect(await readFile(source,'utf8')).toBe(draft);
   const first=await publishCommand({values:{server},positionals:[source]},options);
   expect(first.updatedInPlace).toBe(true);expect(first.autofix.fixes.map((fix:any)=>fix.rule)).toEqual(['core-script','charset','viewport']);
   expect(logs.at(-1)).toMatch(/^autofix: 3 fixed — also written to index\.html/);expect(logs.at(-1)).toMatch(/routine: added \d+ data-af-id/);
   const canonical=await readFile(source,'utf8');expect(canonical).toMatch(/<meta charset="utf-8"/);expect(canonical).toContain('name="viewport"');expect(canonical.match(/core\.js/g)).toHaveLength(1);
   const idOf=(html:string,text:string)=>new RegExp(`data-af-id="([^"]+)"[^>]*>${text}`).exec(html)?.[1];
   // A whole-file regeneration without IDs keeps the previous identities and reports the carry-forward.
   const regenerated=canonical.replace(/ data-af-id="[^"]+"/g,'').replace('Three bets for the next quarter.','Three bets for next quarter.').replace('</ul>','<li>Price the team plan</li></ul>');
   await writeFile(source,regenerated);
   const second=await publishCommand({values:{server},positionals:[source]},options);
   expect(second.version).toBe(2);expect(logs.at(-1)).toMatch(/^autofix: clean/);expect(logs.at(-1)).toMatch(/carried forward \d+ data-af-id from v1, 1 new/);
   const next=await readFile(source,'utf8');
   for(const text of ['Quarterly plan','Three bets','Ship the importer','Halve time'])expect(idOf(next,text),text).toBe(idOf(canonical,text));
   expect(canonical).not.toContain(`data-af-id="${idOf(next,'Price the team plan')}"`);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
});
