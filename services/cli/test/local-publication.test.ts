import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,cp,realpath,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publishLocalWorkspace} from '../src/local-publication';
import {registerLocalFiles,localWorkspaceState,LOCAL_WORKSPACE_SCOPE} from '../src/local-workspace';
import {HttpClient} from '../src/http';
import {stateFor} from '../src/state-access';
import {digest} from '../src/files';
import {configDir,withPrivateStateHome} from '../src/config';
import type {Workspace} from '../src/workspace';
import {createDocumentGraph,graphSource} from '../../app/lib/story/graph/document-graph';
import {applyGraphPatch} from '../../app/lib/story/graph/document-graph-patch';

async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'afbin-publication-')));const home=join(root,'home'),cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 const workspace:Workspace={root:cwd,cwd,home,tracking:null};
 await writeFile(join(cwd,'doc.jsx'),'---\nid: loc001\n---\n<div id="root"><a id="link" href="/a/loc002">Child</a><img id="image" src="ref:loc003" /></div>');
 await writeFile(join(cwd,'child.jsx'),'---\nid: loc002\n---\n<p id="text">One</p>');await writeFile(join(cwd,'rows.json'),'[{"link":"ref:loc002"}]');
 await registerLocalFiles(workspace,['doc.jsx','child.jsx']);
 const portable=await localWorkspaceState(cwd);portable.put(LOCAL_WORKSPACE_SCOPE,'draft-identity','rows.json',{id:'loc003'});
 const heads=new Map<string,any>(),keys=new Map<string,any>();const calls:Array<{path:string;method:string;body:any}>=[];let lose=false,conflict=false;
 const request:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname,method=init?.method??'GET',body=JSON.parse(String(init?.body??'{}'));calls.push({path,method,body});
  const headers={'X-Artifactbin-Account':'usr_one'};
  if(path==='/api/artifacts/reservations')return Response.json({ids:Array.from({length:100},(_,i)=>`r${String(i).padStart(5,'0')}`)},{headers});
  if(path==='/api/artifacts'&&method==='POST'){
   const key=new Headers(init?.headers).get('Idempotency-Key')!;if(keys.has(key))return Response.json(keys.get(key),{headers});
   const id=body.reserved_id;const markup=body.markup?.replace('<p>','<p id="auto">');const head={id,version:1,edit_id:'edit1',state:digest(id+'1'),format:markup?'markup':'dataset',...(markup?{markup,document:createDocumentGraph(markup,1)}:{columns:[]}),title:null,theme:null,template:null,visibility:'unlisted',link_role:'viewer',parent_id:null};heads.set(id,head);keys.set(key,head);if(lose){lose=false;throw Error('lost reply');}return Response.json(head,{headers});
  }
  const id=path.split('/')[3],head=heads.get(id);
  if(method==='GET')return Response.json(head,{headers});
  if(path.endsWith('/edits')){
   if(conflict)return Response.json({error:'doc_changed',detail:'Changed',current:head},{status:409,headers});
   const document=applyGraphPatch(head.document,head.version,body.document_update.patch);assert.ok(document);const next={...head,version:head.version+1,edit_id:'edit2',state:digest(id+'2'),markup:graphSource(document),document};heads.set(id,next);return Response.json(next,{headers});
  }
  throw Error(`Unexpected ${method} ${path}`);
 };
 const client=new HttpClient({connection:{server:'https://example.com',token:'mxmx_test_publication'},home,account:'usr_one',fetch:request});
 return{root,workspace,client,heads,calls,setLost:()=>{lose=true;},setConflict:()=>{conflict=true;},cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('local publication maps nested document and row references while retaining source, reuses identities, and survives workspace moves',async()=>{
 const f=await fixture();try{
  const before=await readFile(join(f.workspace.root,'doc.jsx'));
  await publishLocalWorkspace(f.workspace,['doc.jsx'],f.client,{});
  assert.deepEqual(await readFile(join(f.workspace.root,'doc.jsx')),before);assert.equal(f.heads.size,3);
  const document=[...f.heads.values()].find(head=>head.markup?.includes('Child'));assert.match(document.markup,/\/a\/r\d{5}/);assert.match(document.markup,/ref:r\d{5}/);assert.doesNotMatch(document.markup,/loc00/);
  const rows=f.calls.find(call=>call.body.dataset);assert.ok(rows);assert.match(JSON.stringify(rows.body.dataset),/ref:r\d{5}/);
  const count=f.calls.length;await publishLocalWorkspace(f.workspace,['doc.jsx'],f.client,{});assert.equal(f.calls.length,count);
  const moved=join(f.root,'moved');await cp(f.workspace.root,moved,{recursive:true});await writeFile(join(moved,'child.jsx'),(await readFile(join(moved,'child.jsx'),'utf8')).replace('One','Two'));
  const freshHome=join(f.root,'fresh-home');await mkdir(freshHome);
  await publishLocalWorkspace({...f.workspace,home:freshHome,root:moved,cwd:moved},['doc.jsx'],f.client,{});assert.equal(f.heads.size,3);assert.ok([...f.heads.values()].some(head=>head.markup?.includes('Two')));
 }finally{await f.cleanup();}
});
test('lost reply recovery publishes newer local edits without duplicating creates or changing original identities',async()=>{
 const f=await fixture();try{
  f.setLost();await assert.rejects(publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{}));assert.equal(f.heads.size,1);
  await writeFile(join(f.workspace.root,'child.jsx'),(await readFile(join(f.workspace.root,'child.jsx'),'utf8')).replace('One','Two'));
  await publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{});assert.equal(f.heads.size,1);assert.match([...f.heads.values()][0].markup,/Two/);assert.match(await readFile(join(f.workspace.root,'child.jsx'),'utf8'),/id: loc002/);
 }finally{await f.cleanup();}
});
test('dry-run makes no network or filesystem writes; a bound publication rejects another account before writes',async()=>{
 const f=await fixture();try{
  const result=await publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{dryRun:true});assert.ok(result);assert.equal(f.calls.length,0);await assert.rejects(readFile(join(f.workspace.root,'.artifactbin/publications')));
  await publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{});const count=f.calls.length;f.client.account='usr_other';await assert.rejects(publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{}),/account/i);assert.equal(f.calls.length,count);
 }finally{await f.cleanup();}
});

test('publication conflict preserves both source and staging proposal and refuses silent retry',async()=>{
 const f=await fixture();try{
  await publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{});
  const proposal=(await readFile(join(f.workspace.root,'child.jsx'),'utf8')).replace('One','Two');await writeFile(join(f.workspace.root,'child.jsx'),proposal);f.setConflict();
  await assert.rejects(publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{}),/doc_changed/);
  assert.equal(await readFile(join(f.workspace.root,'child.jsx'),'utf8'),proposal);assert.match([...f.heads.values()][0].markup,/One/);
  const count=f.calls.length;await assert.rejects(publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{}),/unresolved conflict/);assert.equal(f.calls.length,count);
 }finally{await f.cleanup();}
});
test('portable state rebasing refuses an occupied destination without losing either scope',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'afbin-state-rebase-')));try{
  const state=await stateFor(root);state.put('/old','workspace','/old',{server:'https://example.com',account:'usr_one'});state.put('/old','pending-request','current',{example:true},{data:Buffer.from('pending')});
  state.put('/occupied','workspace','/occupied',{sentinel:true});assert.throws(()=>state.rebaseScope('/old','/occupied'),/already exists/);assert.ok(state.get('/old','pending-request','current'));assert.ok(state.get('/occupied','workspace','/occupied'));
  state.rebaseScope('/old','/new');assert.equal(state.get('/old','workspace','/old'),null);assert.ok(state.get('/new','workspace','/new'));assert.equal(state.get('/new','pending-request','current')!.data!.toString(),'pending');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('private publication state overrides ambient CLI home without redirecting external credential homes',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'afbin-private-state-')));try{
  const external=join(root,'external'),privateHome=join(root,'private'),privateDirectory=join(root,'private-state');
  const env={ARTIFACTBIN_HOME:external};
  await withPrivateStateHome(privateHome,privateDirectory,async()=>{
   assert.equal(configDir(privateHome,env),privateDirectory);assert.equal(configDir(root,env),external);
   const state=await stateFor(privateHome,env);assert.equal(state.path,join(privateDirectory,'state.sqlite'));state.put('copy','archive','proof',{safe:true});
   await new Promise<void>(resolve=>setTimeout(resolve,1));assert.equal(configDir(privateHome,env),privateDirectory);
  });
  assert.equal(configDir(privateHome,env),external);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('server-normalized source remains publishable after local edits without writing remote fences to originals',async()=>{
 const f=await fixture();try{
  const first='---\nid: loc002\n---\n<p>One</p>';await writeFile(join(f.workspace.root,'child.jsx'),first);
  await publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{});assert.match([...f.heads.values()][0].markup,/id="auto"/);assert.equal(await readFile(join(f.workspace.root,'child.jsx'),'utf8'),first);
  await writeFile(join(f.workspace.root,'child.jsx'),first.replace('One','Two'));await publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{});
  assert.match([...f.heads.values()][0].markup,/id="[A-Za-z0-9]{4}"/);assert.match([...f.heads.values()][0].markup,/Two/);assert.doesNotMatch(await readFile(join(f.workspace.root,'child.jsx'),'utf8'),/auto/);
 }finally{await f.cleanup();}
});

test('resource YAML publishes its source as content, with dependency references mapped and no extra source artifact',async()=>{
 const f=await fixture();try{
  const yaml='type: dataset\nsource: rows.json\nid: loc004\n';await writeFile(join(f.workspace.root,'data.yaml'),yaml);await registerLocalFiles(f.workspace,['data.yaml']);
  await publishLocalWorkspace(f.workspace,['data.yaml'],f.client,{});
  assert.equal(f.heads.size,2);assert.equal(await readFile(join(f.workspace.root,'data.yaml'),'utf8'),yaml);assert.match(await readFile(join(f.workspace.root,'rows.json'),'utf8'),/loc002/);
  const dataset=f.calls.find(call=>call.body.dataset);assert.ok(dataset);assert.match(JSON.stringify(dataset.body.dataset),/ref:r\d{5}/);assert.doesNotMatch(JSON.stringify(dataset.body.dataset),/loc00/);
 }finally{await f.cleanup();}
});

test('a local file rename keeps its published identity and dependency bindings',async()=>{
 const f=await fixture();try{
  await publishLocalWorkspace(f.workspace,['doc.jsx'],f.client,{});
  const before=[...f.heads.values()].find(head=>head.markup?.includes('One')).id;
  await mkdir(join(f.workspace.root,'chapters'));await rename(join(f.workspace.root,'child.jsx'),join(f.workspace.root,'chapters/child.jsx'));await registerLocalFiles(f.workspace,['chapters/child.jsx']);
  await writeFile(join(f.workspace.root,'chapters/child.jsx'),(await readFile(join(f.workspace.root,'chapters/child.jsx'),'utf8')).replace('One','Renamed'));
  await publishLocalWorkspace(f.workspace,['doc.jsx'],f.client,{});assert.equal(f.heads.size,3);assert.match(f.heads.get(before).markup,/Renamed/);
 }finally{await f.cleanup();}
});
test('an uncertain create travels with a copied workspace and recovers using a fresh CLI home',async()=>{
 const f=await fixture();try{
  f.setLost();await assert.rejects(publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{}));const moved=join(f.root,'moved'),freshHome=join(f.root,'fresh-home');await cp(f.workspace.root,moved,{recursive:true});await mkdir(freshHome);
  await writeFile(join(moved,'child.jsx'),(await readFile(join(moved,'child.jsx'),'utf8')).replace('One','Copied'));
  await publishLocalWorkspace({...f.workspace,root:moved,cwd:moved,home:freshHome},['child.jsx'],f.client,{});assert.equal(f.heads.size,1);assert.match([...f.heads.values()][0].markup,/Copied/);assert.match(await readFile(join(moved,'child.jsx'),'utf8'),/id: loc002/);
 }finally{await f.cleanup();}
});

test('an imported remote HTML baseline binds the verified original and updates it without duplication',async()=>{
 const f=await fixture();try{
  const source='<p id="text">One</p>',head={id:'old001',version:1,edit_id:'edit1',state:digest('old0011'),format:'markup',markup:source,document:createDocumentGraph(source,1),title:null,theme:null,template:null,visibility:'unlisted',link_role:'viewer',parent_id:null,capabilities:{edit:true}};
  f.heads.set(head.id,head);const portable=await localWorkspaceState(f.workspace.root);portable.put(LOCAL_WORKSPACE_SCOPE,'archive','import-baseline/child.jsx',{artifactId:head.id,origin:'https://example.com',base:{version:1,editId:'edit1',source},source:source.replace('One','Imported')});
  await writeFile(join(f.workspace.root,'child.jsx'),(await readFile(join(f.workspace.root,'child.jsx'),'utf8')).replace('One','Imported'));
  await publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{});assert.equal(f.heads.size,1);assert.match(f.heads.get('old001').markup,/Imported/);assert.ok(!f.calls.some(call=>call.path==='/api/artifacts'||call.path==='/api/artifacts/reservations'));
  assert.match(await readFile(join(f.workspace.root,'child.jsx'),'utf8'),/id: loc002/);
  const count=f.calls.length;await publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{});assert.equal(f.calls.length,count);
 }finally{await f.cleanup();}
});
test('untrusted import origin, changed remote baseline and viewer permission cannot publish writes',async()=>{
 for(const mode of ['origin','changed','viewer']){
  const f=await fixture();try{
   const source='<p id="text">One</p>';f.heads.set('old001',{id:'old001',version:mode==='changed'?2:1,edit_id:'edit1',state:digest('old0011'),format:'markup',markup:source,capabilities:{edit:mode!=='viewer'}});
   (await localWorkspaceState(f.workspace.root)).put(LOCAL_WORKSPACE_SCOPE,'archive','import-baseline/child.jsx',{artifactId:'old001',origin:mode==='origin'?'https://other.example.com':'https://example.com',base:{version:1,editId:'edit1',source},source});
   await assert.rejects(publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{}));assert.ok(f.calls.every(call=>call.method==='GET'));assert.equal(f.heads.size,1);
  }finally{await f.cleanup();}
 }
});
