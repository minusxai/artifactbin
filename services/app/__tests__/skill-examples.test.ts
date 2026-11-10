/** Publish the actual installed native examples; resolver execution has separate real-runner coverage. */
import {describe,expect,it,vi} from 'vitest';
import {GET as skillArchive} from '@/app/skills/artifactbin.zip/route';
import {mkdtemp,readFile,writeFile,rm,realpath,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {POST as publish} from '@/app/api/artifacts/route';
import {GET as read,PUT as update} from '@/app/api/artifacts/[id]/route';
import {GET as readPolicy} from '@/app/api/artifacts/[id]/policy/route';
import {GET as listComments,POST as addComment} from '@/app/api/artifacts/[id]/annotations/route';
import {POST as replyComment,PATCH as editComment} from '@/app/api/artifacts/[id]/annotations/[annId]/route';
import {request,useAppHarness,mintAccountToken} from './harness';
// The compiler without a runner: a function file's surface as publish reads it from the source, or an older file's SDL.
vi.mock('@/lib/page-operations',async original=>{const real=await original<typeof import('@/lib/page-operations')>();return {...real,compilePageBackend:async(source:string)=>{
 const typeDefs=/export const typeDefs\s*=\s*`([\s\S]*?)`/.exec(source)?.[1];if(typeDefs)return{typeDefs,compiled:source};
 const {functions,schedule}=await real.functionFileSurface(source);return{typeDefs:'',functions,...(schedule?{schedule}:{}),compiled:source,test:Object.hasOwn(functions,'test')};
}};});
// The suite caps a file at 10 KB (suite-env) so size tests trip cheaply; the dashboard's renderer
// (examples/csv-dashboard.mjs) is a real-sized bundle dependency, so these publish under the product default.
vi.mock('@/lib/platform/config',async importOriginal=>({...await importOriginal<typeof import('@/lib/platform/config')>(),MAX_FILE_BYTES:50_000_000}));
useAppHarness();
/** No flow ever leaves a file beside the source. */
const noCompanions=async(dir:string)=>expect((await readdir(dir,{recursive:true})).filter(name=>String(name).endsWith('.af.json'))).toEqual([]);
describe('installed native author examples',()=>{
 it('publishes report HTML with canonical data-af identities',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'native-skill-example-'));
  try{
   const zip=path.join(dir,'skill.zip');await writeFile(zip,new Uint8Array(await (await skillArchive(new Request('http://localhost/skills/artifactbin.zip'))).arrayBuffer()));execFileSync('unzip',['-q',zip,'-d',dir]);
   const installed=path.join(dir,'artifactbin'),{prepareBundle}=await import(pathToFileURL(path.join(installed,'scripts/toolbox-publication-bundle.mjs')).href);
   // The API test project caps uploaded files at 10 KB; the installed-skill tests cover the full portable font graph.
   const source=await readFile(path.join(installed,'examples/report.html'),'utf8');const saved=await prepareBundle({root:installed,entry:'examples/report.html',entryHtml:source.replace(/<link[^>]*data-af="design-system"[^>]*>/,'<link data-af="design-system" rel="stylesheet" href="https://styles.example/theme.css">'),server:'http://localhost:3000'});
   const owner=await mintAccountToken('sample-report');const response=await publish(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':saved.idempotencyKey},json:saved.body}));expect(response.status,await response.clone().text()).toBe(201);const page=await response.json();expect(page.format).toBe('html');expect(page.html).toContain('data-af-id=');
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('publishes a dashboard whose CSVs are linked by path: one dataset per file, named by it, updated in place when it changes',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'native-skill-dashboard-'));
  try{
   const zip=path.join(dir,'skill.zip');await writeFile(zip,new Uint8Array(await (await skillArchive(new Request('http://localhost/skills/artifactbin.zip'))).arrayBuffer()));execFileSync('unzip',['-q',zip,'-d',dir]);
   const installed=path.join(dir,'artifactbin'),project=path.join(dir,'project');await (await import('node:fs/promises')).mkdir(project);
   const {publishCommand}=await import(pathToFileURL(path.join(installed,'scripts/toolbox-publish.mjs')).href);
   const owner=await mintAccountToken('sample-dashboard'),server='http://localhost:3000';
   const options={log:()=>{},env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:owner.token,ARTIFACTBIN_HOME:path.join(dir,'private')},fetcher:async(input:any,init:any)=>{
    const url=new URL(String(input)),id=url.pathname.split('/').at(-1)!,method=init?.method??'GET';
    const req=request(url.pathname,{method,token:owner.token,headers:{'Idempotency-Key':new Headers(init?.headers).get('Idempotency-Key')??''},...(init?.body?{json:JSON.parse(String(init.body))}:{})});
    return method==='GET'?await read(req,{params:Promise.resolve({id})}):method==='PUT'?await update(req,{params:Promise.resolve({id})}):await publish(req);
   }};
   const get=async(id:string)=>(await read(request('/api/artifacts/'+id,{token:owner.token}),{params:Promise.resolve({id})})).json();
   // The starter as new-page writes it: the CSV beside it, linked by its path; a header-only CSV is an empty table.
   const source=path.join(project,'index.html'),csv=execFileSync(process.execPath,[path.join(installed,'examples/gen-deliveries.mjs')],{stdio:['ignore','pipe','ignore']}).toString();
   await writeFile(path.join(project,'deliveries.csv'),csv);await writeFile(path.join(project,'notes.csv'),'note,created_by\n');
   const starter=(await readFile(path.join(installed,'examples/csv-dashboard.html'),'utf8')).replace(/<link[^>]*data-af="design-system"[^>]*>/,'<link data-af="design-system" rel="stylesheet" href="https://styles.example/theme.css">');
   expect(starter).toContain('data-af-name="deliveries" href="./deliveries.csv"');
   await writeFile(path.join(project,'csv-dashboard.mjs'),await readFile(path.join(installed,'examples/csv-dashboard.mjs')));
   const {starterTexts}=await import(pathToFileURL(path.join(installed,'scripts/toolbox-publish-guard.mjs')).href);
   const filled=[...starterTexts()].reduce((text:string,placeholder:string)=>text.replaceAll(placeholder,placeholder.slice(1,-1)),starter);
   await writeFile(source,filled.replace('</head>','<link rel="af-dataset" data-af-name="notes" href="./notes.csv">\n</head>'));
   const first=await publishCommand({values:{server,create:true},positionals:[source]},options);
   const page=await get(first.id),byPath=Object.fromEntries(page.dependencyReceipts.map((r:any)=>[r.path,r]));
   expect(byPath['deliveries.csv']).toMatchObject({kind:'dataset',revision:'1'});expect(byPath['notes.csv']).toMatchObject({kind:'dataset',revision:'1'});
   expect(page.html).toContain('ref:'+byPath['deliveries.csv'].id);
   // Each dataset is named by its file: the GraphQL root its page links it by, and its title.
   for(const [file,name] of [['deliveries.csv','deliveries'],['notes.csv','notes']]){
    const id=byPath[file].id,dataset=await get(id);expect(dataset.title).toBe(file);
    const policy=await (await readPolicy(request(`/api/artifacts/${id}/policy`,{token:owner.token}),{params:Promise.resolve({id})})).json();
    expect(policy.policy.tables[0].configuration).toEqual({custom_name:name});
   }
   expect((await get(byPath['notes.csv'].id)).columns.map((c:any)=>c.name)).toEqual(['note','created_by']);
   // The author's file keeps the path, so a changed CSV updates that same dataset; nothing is duplicated.
   expect(await readFile(source,'utf8')).toContain('href="./deliveries.csv"');
   await writeFile(path.join(project,'deliveries.csv'),csv.split('\n').slice(0,4).join('\n')+'\n');
   const second=await publishCommand({values:{server},positionals:[source]},options);expect(second).toMatchObject({id:first.id,version:2});
   const after=Object.fromEntries((await get(first.id)).dependencyReceipts.map((r:any)=>[r.path,r]));
   expect(after['deliveries.csv']).toMatchObject({id:byPath['deliveries.csv'].id,revision:'2'});expect(after['notes.csv']).toEqual(byPath['notes.csv']);
   expect((await get(byPath['deliveries.csv'].id)).rowCount).toBe(3);
   // Unchanged, the next publish reuses both as recorded.
   await publishCommand({values:{server},positionals:[source]},options);
   expect((await get(first.id)).dependencyReceipts.find((r:any)=>r.path==='deliveries.csv')).toMatchObject({revision:'2'});
   await noCompanions(project);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('creates and conditionally updates a project through installed helpers with durable dependency receipts',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'native-skill-update-'));
  try{
   const zip=path.join(dir,'skill.zip');await writeFile(zip,new Uint8Array(await (await skillArchive(new Request('http://localhost/skills/artifactbin.zip'))).arrayBuffer()));execFileSync('unzip',['-q',zip,'-d',dir]);
   const installed=path.join(dir,'artifactbin');
   const {prepareBundle,prepareBundleUpdate}=await import(pathToFileURL(path.join(installed,'scripts/toolbox-publication-bundle.mjs')).href);
   const owner=await mintAccountToken('sample-project-update'),server='http://localhost:3000';
   // A prepared request sent as is, with its own idempotency key.
   const send=async(saved:{method:string;artifactId?:string;idempotencyKey:string;body:unknown})=>{
    const req=request('/api/artifacts'+(saved.method==='PUT'?'/'+saved.artifactId:''),{method:saved.method,token:owner.token,headers:{'Idempotency-Key':saved.idempotencyKey},json:saved.body});
    const response=saved.method==='PUT'?await update(req,{params:Promise.resolve({id:saved.artifactId!})}):await publish(req);
    expect(response.ok,await response.clone().text()).toBe(true);return response.json();
   };
   const mappingsOf=(receipt:{dependencyReceipts?:{path:string}[]})=>Object.fromEntries((receipt.dependencyReceipts??[]).map(({path,...mapping})=>[path,mapping]));
   const source='<link rel="stylesheet" href="./theme.css"><h1 data-af-id="project-heading">One</h1>';
   await writeFile(path.join(installed,'index.html'),source);await writeFile(path.join(installed,'theme.css'),'body{color:red}');
   const first=await prepareBundle({root:installed,entry:'index.html',server});const created=await send(first);
   expect((await send(first)).id).toBe(created.id);
   const baseline=await (await read(request('/api/artifacts/'+created.id,{token:owner.token}),{params:Promise.resolve({id:created.id})})).json();
   const previous={mappings:mappingsOf(created)};
   await writeFile(path.join(installed,'index.html'),source.replace('One','Two'));await writeFile(path.join(installed,'theme.css'),'body{color:blue}');
   const next=await prepareBundleUpdate({root:installed,entry:'index.html',server,head:baseline,mappings:previous.mappings});const changed=await send(next);
   expect(changed.id).toBe(created.id);expect(changed.version).toBe(baseline.version+1);
   expect(changed.dependencyReceipts[0]).toMatchObject({id:created.dependencyReceipts[0].id,revision:'2'});
   expect(changed.html).toContain('data-af-id="project-heading"');
   expect((await send(next)).version).toBe(changed.version);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('runs the installed canonical read/edit/publish and immutable resume workflow',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'author-toolbox-installed-'));
  try{
   const zip=path.join(dir,'skill.zip');await writeFile(zip,new Uint8Array(await (await skillArchive(new Request('http://localhost/skills/artifactbin.zip'))).arrayBuffer()));execFileSync('unzip',['-q',zip,'-d',dir]);
   const installed=path.join(dir,'artifactbin'),project=path.join(installed,'project');await (await import('node:fs/promises')).mkdir(project);
   const {sourceIdentity,stripMarker}=await import(pathToFileURL(path.join(installed,'scripts/toolbox-source.mjs')).href);
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
   const first=await publishCommand({values:{server,create:true},positionals:[source]},options);expect(first.version).toBe(1);
   // An unchanged input becomes the canonical source in place, carrying its marker; nothing beside it.
   expect(first.updatedInPlace).toBe(true);expect(first.source).toBe(await realpath(source));expect(first).not.toHaveProperty('baseline');
   const receiptsOf=async(id:string)=>(await (await read(request('/api/artifacts/'+id,{token:owner.token}),{params:Promise.resolve({id})})).json()).dependencyReceipts;
   // The ids publish added are announced, so exact-text edits against the old text are not attempted blind.
   expect(first.rewritten).toMatch(/^index\.html was rewritten with \d+ data-af-id attributes: re-read it before editing; match on short anchors, not whole lines\.$/);
   // A page publish ends on the next step: reply to the user and keep the comment watch running.
   const timeout="Nothing may hold back your reply: it is every link the user asked for, in the form they asked for (a page's public view is its receipt's user_page_url), plus what they asked. Claude Code: start the watch, one per page, with the Bash tool's run_in_background first, then send your reply as your last message and end your turn; you are woken when it prints. Other harnesses: say your reply to the user, then call the watch in the foreground with its default wait and a shell timeout of at least 300000 ms; several pages share that one call (node scripts/comment.mjs watch A --next & node scripts/comment.mjs watch B --next & wait). Its first call after you publish, edit or comment returns at once, to send a reply not sent yet. Then it returns as soon as someone comments, and on its own within 4 minutes: handle what it printed and run it again until it says to stop watching. Watching follows every task, however short the reply.";
   const next=`Next: when the request is done, reply to the user and run the comment watch, even when the reply is only the link. ${timeout}\n  node scripts/comment.mjs watch ${first.id} --next`;
   expect(first.next).toBe(next);
   const canonical=await readFile(first.source,'utf8'),receipts=await receiptsOf(first.id);expect(canonical).toContain('href="./theme.css"');expect(receipts).toHaveLength(1);
   const nodeId=/data-af-id="([^"]+)"[^>]*>One/.exec(canonical)?.[1];expect(nodeId).toBeTruthy();
   const anchor=path.join(dir,'anchor.json'),bodyFile=path.join(dir,'comment.txt');await writeFile(anchor,JSON.stringify({kind:'html-node',v:1,revision:'1',nodeId,quote:'One'}));await writeFile(bodyFile,'Review this heading');
   const comment=await commentCommand({sub:'add',values:{server,anchor,'body-file':bodyFile},positionals:[first.id]},options);
   const comments=await commentCommand({sub:'list',values:{server,status:'all'},positionals:[first.id]},options);expect(comments.annotations).toHaveLength(1);
   const thread=comments.annotations[0];await writeFile(bodyFile,'Checked the source');
   const replied=await commentCommand({sub:'reply',values:{server,thread:thread.id,'expected-revision':String(thread.revision),'body-file':bodyFile,resolve:true},positionals:[first.id]},options);expect(replied.thread.status).toBe('resolved');expect(replied.next).toBe(`Next: when the request is done, reply to the user and run the comment watch, even when the reply is only the link. ${timeout}\n  node scripts/comment.mjs watch ${first.id} --next`);expect(comment.next).toBe(replied.next);
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
   expect((await receiptsOf(first.id))[0]).toMatchObject({id:receipts[0].id,revision:'2'});
   // The kept input's marker saw version 1: publishing it would overwrite version 2, so it is refused.
   await expect(publishCommand({values:{server},positionals:[first.source]},options)).rejects.toMatchObject({code:'version_conflict',exit:4});
   const downloaded=await readCommand({values:{server,output:path.join(project,'read.html')},positionals:[first.id]},options);
   // Repeated edit → publish cycles keep one file and advance its marker.
   const pairSource=await realpath(downloaded.source);
   for(const [text,version] of [['Three',3],['Four',4]] as const){
    await writeFile(downloaded.source,(await readFile(downloaded.source,'utf8')).replace(/>(Two|Three)</,`>${text}<`));
    const next=await publishCommand({values:{server},positionals:[downloaded.source]},options);
    expect(next).toMatchObject({version,updatedInPlace:true,source:pairSource});
    expect(sourceIdentity(await readFile(downloaded.source,'utf8')).version).toBe(version);
   }
   // Rewritten whole, the file loses its marker: publish refuses rather than make a second page.
   await writeFile(downloaded.source,stripMarker(await readFile(downloaded.source,'utf8')));
   await expect(publishCommand({values:{server},positionals:[downloaded.source]},options)).rejects.toMatchObject({code:'unmarked_source',recovery:expect.stringContaining('node scripts/publish.mjs read.html --artifact ID')});
   // The named recovery works against the real server: the current head is the baseline (H7).
   const recovered=await publishCommand({values:{server,artifact:first.id},positionals:[downloaded.source]},options);
   expect(recovered).toMatchObject({id:first.id,version:5,updatedInPlace:true});
   // Only markup carries page identity: a new page whose script selects [data-af-id="..."] publishes as new.
   const scripted=path.join(project,'scripted.html');await writeFile(scripted,'<h1>New</h1><script type="module">document.querySelector(`[data-af-id="row-1"]`)</script>');
   expect((await publishCommand({values:{server,create:true},positionals:[scripted]},options)).version).toBe(1);
   await noCompanions(dir);
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
   const dataset=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:execFileSync(process.execPath,[path.join(installed,'examples/gen-transactions.mjs')]).toString()}}));expect(dataset.status).toBe(201);const datasetId=(await dataset.json()).id;
   // A filled-in starter: publish refuses its [bracketed] placeholders (H4), so the copy writes real text in their place.
   const {starterTexts}=await import(pathToFileURL(path.join(installed,'scripts/toolbox-publish-guard.mjs')).href);
   const filled=[...starterTexts()].reduce((text:string,placeholder:string)=>text.replaceAll(placeholder,placeholder.slice(1,-1)),await readFile(path.join(installed,'examples/tracker.html'),'utf8'));
   const html=filled.replaceAll('DATASET_ID',datasetId).replaceAll('TARGETS_ID',datasetId).replace(/<link[^>]*data-af="design-system"[^>]*>/,'<link data-af="design-system" rel="stylesheet" href="https://styles.example/theme.css">');
   const source=path.join(project,'index.html'),backend=path.join(project,'tracker.ts');await writeFile(source,html);await writeFile(backend,await readFile(path.join(installed,'examples/tracker.ts'),'utf8'));
   const first=await publishCommand({values:{server,create:true},positionals:[source]},options);expect(first.updatedInPlace).toBe(true);
    // Copied example headers are fine to keep: publish no longer warns about them.
    expect(first.headers).toBeUndefined();
   // The canonical page binds the backend by name only; the author's working copy keeps its local source path.
   expect(await readFile(source,'utf8')).toMatch(/<link href="\.\/tracker\.ts"[^>]*rel="af-resolver"/);
   await writeFile(backend,(await readFile(backend,'utf8'))+'\n// edited after first publish\n');
   sent.length=0;const second=await publishCommand({values:{server},positionals:[source]},options);expect(second.version).toBe(2);
   const put=sent.find(body=>body.expectedVersion===1);expect(put.publicationBundle.files.map((file:any)=>file.path)).toContain('tracker.ts');
   expect(Buffer.from(put.publicationBundle.files.find((file:any)=>file.path==='tracker.ts').base64,'base64').toString('utf8')).toContain('edited after first publish');
   // A reader's copy has no local backend source and keeps the published backend.
   const copy=await readCommand({values:{server,output:path.join(project,'copy.html')},positionals:[first.id]},options);expect(await readFile(copy.source,'utf8')).not.toMatch(/href="\.\/tracker\.ts"/);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('publishes the tracker with its declared backend source atomically',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'native-skill-app-'));
  try{
  const zip=path.join(dir,'skill.zip');await writeFile(zip,new Uint8Array(await (await skillArchive(new Request('http://localhost/skills/artifactbin.zip'))).arrayBuffer()));execFileSync('unzip',['-q',zip,'-d',dir]);
  const installed=path.join(dir,'artifactbin'),{prepareBundle}=await import(pathToFileURL(path.join(installed,'scripts/toolbox-publication-bundle.mjs')).href),owner=await mintAccountToken('sample-app');
  const dataset=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:execFileSync(process.execPath,[path.join(installed,'examples/gen-transactions.mjs')]).toString()}}));expect(dataset.status).toBe(201);const datasetId=(await dataset.json()).id;
  const source=await readFile(path.join(installed,'examples/tracker.html'),'utf8'),saved=await prepareBundle({root:installed,entry:'examples/tracker.html',entryHtml:source.replaceAll('DATASET_ID',datasetId).replaceAll('TARGETS_ID',datasetId).replace(/<link[^>]*data-af="design-system"[^>]*>/,'<link data-af="design-system" rel="stylesheet" href="https://styles.example/theme.css">'),server:'http://localhost:3000'});const response=await publish(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':saved.idempotencyKey},json:{...saved.body,resolverSources:{tracker:await readFile(path.join(installed,'examples/tracker.ts'),'utf8')}}}));expect(response.status,await response.clone().text()).toBe(201);const page=await response.json();
  const head=await read(request(`/api/artifacts/${page.id}`,{token:owner.token}),{params:Promise.resolve({id:page.id})});expect(head.status).toBe(200);expect((await head.json()).html).toContain('data-af-name="tracker"');
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
   const draft=`<!doctype html>\n<html>\n<head><title>Plan</title></head>\n<body>\n${body}<script defer src="/af/core.js"></script>\n</body>\n</html>\n`;
   // Refusals stop before anything is sent or written.
   await writeFile(source,draft.replace('</ul>','</ul><img src="./missing.png">'));
   await expect(publishCommand({values:{server,create:true},positionals:[source]},options)).rejects.toMatchObject({code:'autofix_refused',exit:2});
   expect(logs.at(-1)).toMatch(/^autofix: .*nothing published or written/);expect(logs.at(-1)).toMatch(/index\.html:\d+:\d+ local file not found/);
   await writeFile(source,draft);
   await expect(publishCommand({values:{server,strict:true,create:true},positionals:[source]},options)).rejects.toMatchObject({code:'autofix_strict'});
   expect(await readFile(source,'utf8')).toBe(draft);
   const first=await publishCommand({values:{server,create:true},positionals:[source]},options);
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
