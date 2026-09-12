import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assetInput,planDependencies,substituteDependencies} from '../src/dependencies';
import {assetFormatOf} from '../../app/lib/story/file-types';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
import {digest} from '../src/files';
test('srcSet uploads each local image once and preserves its descriptors during reference substitution',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-srcset-'));
 try{
  await writeFile(join(root,'small.png'),'small');await writeFile(join(root,'large.png'),'large');
  const source='<img src="./small.png" srcSet="./small.png 1x, ./large.png 2x" />';
  const plan=await planDependencies(source,'doc.jsx',root);assert.equal(plan.length,2);
  const result=substituteDependencies(source,plan,{'small.png':'abc123','large.png':'def456'});
  assert.match(result,/src="ref:abc123"/);assert.match(result,/srcSet="ref:abc123 1x, ref:def456 2x"/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('restores available local dependency paths in srcSet without rewriting literal text attributes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-restore-paths-'));
 try{
  await writeFile(join(root,'small.png'),'small');
  const module=await import('../src/dependencies');
  const restore=(module as unknown as {restoreDependencyPaths:(source:string,paths:Record<string,string>,path:string,root:string)=>Promise<string>}).restoreDependencyPaths;
  assert.equal(typeof restore,'function');
  const result=await restore('<img title="ref:abc123" srcSet="ref:abc123 1x, ref:def456 2x" />',{abc123:'./small.png',def456:'./missing.png'},'doc.jsx',root);
  assert.match(result,/title="ref:abc123"/);assert.match(result,/srcSet=".\/small.png 1x, ref:def456 2x"/);
 }finally{await rm(root,{recursive:true,force:true});}
});

// ---- Seeded by the orchestrator for workstream W3 (cli-dedupe). ----

/**
 * A server that owns uploaded bytes by sha256: preflight reports `existing` for a hash it already
 * stores, and every accepted image upload teaches it one more hash. Nothing binds a port.
 */
function dedupeServer(owned:Map<string,string>){
 const stats={preflights:0,images:0,datasets:0,documents:0,edits:0};
 const requests:Array<{path:string;method:string;body:any;raw:string}>=[];
 let next=0;let doc:any=null;
 const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'X-Artifactbin-Account':'usr_one'}});
 const stub:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname,raw=String(init?.body??'{}'),method=init?.method??'GET';
  const body=JSON.parse(raw);requests.push({path,method,body,raw});
  if(path==='/api/artifacts/preflight'){
   stats.preflights++;
   return reply({valid:true,dependencies:(body.dependencies??[]).map((dependency:any)=>'sha256' in dependency
    ?{id:dependency.id,format:'image',existing:owned.get(dependency.sha256)??null}
    :{id:dependency.id,format:'dataset',existing:null})});
  }
  if(path==='/api/artifacts'&&method==='POST'){
   if(typeof body.image==='string'){stats.images++;const id=`img00${++next}`;owned.set(digest(Buffer.from(body.image.split(',')[1],'base64')),id);return reply({id,format:'image',version:1,edit_id:`e-${id}`,state:digest(id)},201);}
   if(body.dataset!==undefined){stats.datasets++;const id=`data00${++next}`;return reply({id,format:'dataset',version:1,edit_id:`e-${id}`,state:digest(id)},201);}
   stats.documents++;doc={id:'doc001',format:'markup',markup:body.markup,version:1,edit_id:'edit1',state:digest('doc1')};return reply(doc,201);
  }
  if(path==='/api/artifacts/doc001/edits'){stats.edits++;doc={...doc,markup:body.source,version:doc.version+1,edit_id:`edit${doc.version+1}`,state:digest(`doc${doc.version+1}`)};return reply(doc);}
  if(method==='GET'&&doc)return reply(doc);
  throw new Error(`Unexpected ${method} ${path}`);
 };
 return{fetch:stub,stats,requests,find:(match:(entry:{path:string;method:string})=>boolean)=>requests.find(match)};
}
const invoke=async(cwd:string,home:string,stub:typeof fetch,args:string[])=>{
 const out:string[]=[];
 const code=await runCli([...args,'--json'],{cwd,home,interactive:false,fetch:stub,stdout:s=>out.push(s),stderr:()=>{}});
 return{code,result:JSON.parse(out.join(''))};
};

test('the declared dependency format matches the create body assetInput would send',()=>{
 for(const [filename,format] of [['photo.png','image'],['logo.svg','image'],['scan.pdf','pdf'],['clip.mp4','file'],['art.avif','file']] as const){
  assert.equal(assetFormatOf(filename),format);
  assert.equal(Object.keys(assetInput(filename,Buffer.from('bytes')))[0],format);
 }
 assert.equal(assetFormatOf('archive.bz2'),null);
 assert.equal(assetFormatOf('PHOTO.PNG'),'image');
});

test('preflight describes each local asset by sha256, size and filename and never sends its bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-dependency-hash-'));const home=join(root,'home'),cwd=join(root,'work');
 await mkdir(home);await mkdir(cwd);
 const photo=Buffer.from('photo-bytes');const rows='score\n42\n';const server=dedupeServer(new Map());
 try{
  await saveConnection({server:'https://example.com',token:'mx_test'},home);
  await writeFile(join(cwd,'photo.png'),photo);await writeFile(join(cwd,'rows.csv'),rows);
  await writeFile(join(cwd,'doc.jsx'),'<div><img src="./photo.png" /><a href="./rows.csv">Rows</a></div>\n');
  const push=await invoke(cwd,home,server.fetch,['push','doc.jsx']);assert.equal(push.code,0,JSON.stringify(push.result));
  const preflight=server.find(entry=>entry.path.endsWith('/preflight'));assert.ok(preflight);
  assert.deepEqual(preflight.body.dependencies,[
   {id:'local000001',sha256:digest(photo),size:photo.length,filename:'photo.png'},
   {id:'local000002',input:{dataset:rows}},
  ]);
  assert.ok(!preflight.raw.includes(photo.toString('base64')),'no asset bytes travel in a preflight body');
  assert.equal(server.stats.images,1);assert.equal(server.stats.datasets,1);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('an asset the server already owns is referenced without an upload; a miss is uploaded once and then reused',async()=>{
 const photo=Buffer.from('photo-bytes');const markup='<div><img src="./photo.png" />Story</div>\n';
 const seeded=await mkdtemp(join(tmpdir(),'afbin-dependency-owned-'));const missed=await mkdtemp(join(tmpdir(),'afbin-dependency-miss-'));
 const prepare=async(root:string,stub:typeof fetch)=>{
  const home=join(root,'home'),cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
  await saveConnection({server:'https://example.com',token:'mx_test'},home);
  await writeFile(join(cwd,'photo.png'),photo);await writeFile(join(cwd,'doc.jsx'),markup);
  return()=>invoke(cwd,home,stub,['push','doc.jsx']);
 };
 try{
  const owning=dedupeServer(new Map([[digest(photo),'img001']]));
  const pushOwned=await prepare(seeded,owning.fetch);
  const owned=await pushOwned();assert.equal(owned.code,0,JSON.stringify(owned.result));
  assert.equal(owning.stats.images,0,'an asset the server already owns is never uploaded');
  const create=owning.find(entry=>entry.path==='/api/artifacts'&&entry.method==='POST');assert.ok(create);
  assert.match(create.body.markup,/ref:img001/);assert.doesNotMatch(create.body.markup,/ref:local00/);
  assert.deepEqual(owned.result.operations.find((operation:any)=>operation.path==='photo.png'),{path:'photo.png',status:'reused',id:'img001'});

  const missing=dedupeServer(new Map());
  const pushMissed=await prepare(missed,missing.fetch);
  const first=await pushMissed();assert.equal(first.code,0,JSON.stringify(first.result));
  assert.equal(missing.stats.images,1,'a miss is uploaded exactly once');
  assert.equal(first.result.operations.find((operation:any)=>operation.path==='photo.png').status,'published');
  const requests=missing.length;
  const second=await pushMissed();assert.equal(second.code,0,JSON.stringify(second.result));
  assert.equal(missing.length,requests,'an unchanged document with unchanged assets makes no request at all');
  assert.equal(second.result.operations.find((operation:any)=>operation.path==='doc.jsx').status,'skipped');
  const published=missing.find(entry=>entry.path==='/api/artifacts'&&entry.body.markup);assert.ok(published);
  assert.match(published.body.markup,/ref:[A-Za-z0-9]{6,}/);assert.doesNotMatch(published.body.markup,/ref:local00/);
  assert.match(await readFile(join(missed,'work','doc.jsx'),'utf8'),/\.\/photo\.png/);
 }finally{await rm(seeded,{recursive:true,force:true});await rm(missed,{recursive:true,force:true});}
});

test('dry-run reports which assets would be reused and which would be uploaded',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-dependency-dry-'));const home=join(root,'home'),cwd=join(root,'work');
 await mkdir(home);await mkdir(cwd);
 const known=Buffer.from('known-bytes'),fresh=Buffer.from('fresh-bytes');
 const server=dedupeServer(new Map([[digest(known),'img001']]));
 try{
  await saveConnection({server:'https://example.com',token:'mx_test'},home);
  await writeFile(join(cwd,'known.png'),known);await writeFile(join(cwd,'fresh.png'),fresh);
  await writeFile(join(cwd,'doc.jsx'),'<div><img src="./known.png" /><img src="./fresh.png" /></div>\n');
  const dry=await invoke(cwd,home,server.fetch,['push','doc.jsx','--dry-run']);assert.equal(dry.code,0,JSON.stringify(dry.result));
  assert.equal(dry.result.dry_run,true);
  assert.deepEqual(dry.result.operations[0].dependencies,[
   {path:'known.png',id:'local000001',would_reuse:'img001'},
   {path:'fresh.png',id:'local000002',would_upload:true},
  ]);
  const preflight=server.find(entry=>entry.path.endsWith('/preflight'));assert.ok(preflight);
  assert.deepEqual(preflight.body.dependencies.map((dependency:any)=>[dependency.filename,dependency.size]),[['known.png',known.length],['fresh.png',fresh.length]]);
  assert.equal(server.stats.images,0);assert.equal(server.stats.documents,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
