import {prepareBindings,deliverBound,finalizeBindings} from '../src/publication-binding';
import {observeDelivery} from '../src/delivery-observer';
import {pull} from '../src/pull';
import {localStatus} from '../src/local';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,cp,realpath,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publishLocalWorkspace} from '../src/local-publication';
import {registerLocalFiles,localWorkspaceState,LOCAL_WORKSPACE_SCOPE,stageLocalFiles,recoverLocalFiles} from '../src/local-workspace';
import {HttpClient} from '../src/http';
import {stateFor} from '../src/state-access';
import {digest} from '../src/files';
import {configDir,withPrivateStateHome} from '../src/config';
import {loadWorkspace,saveTracking,writeTracking,type Workspace} from '../src/workspace';
import {snapshotDocument} from '../src/local';
import {writeDocument} from '../src/document';
import {createDocumentGraph,graphSource,applyGraphPatch,parseJsx} from '../../app/lib/cli-toolkit';
import {encodeDocumentNodes} from '../../app/lib/document/document-node-codec';
/** The tree an older server stored for a fork's create (no graph): what the CLI must still upgrade through a read. */
const legacyTree=(source:string)=>{const parsed=parseJsx(source);if(!parsed.ok)throw new Error(parsed.error);return encodeDocumentNodes(parsed.nodes);};
import {startPreview} from '../src/preview/session';
import {localIdentities} from '../src/identities';
import {localInputReferences} from '../src/preview/local-inputs';

async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'afbin-publication-')));const home=join(root,'home'),cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 const workspace:Workspace={root:cwd,cwd,home,tracking:null};
 await writeFile(join(cwd,'doc.jsx'),'---\nid: loc001\n---\n<div id="root"><a id="link" href="/a/loc002">Child</a><img id="image" src="ref:loc003" /></div>');
 await writeFile(join(cwd,'child.jsx'),'---\nid: loc002\n---\n<p id="text">One</p>');await writeFile(join(cwd,'rows.json'),'[{"link":"ref:loc002"}]');
 await registerLocalFiles(workspace,['doc.jsx','child.jsx']);
 const portable=await localWorkspaceState(cwd);portable.put(LOCAL_WORKSPACE_SCOPE,'draft-identity','rows.json',{id:'loc003'});
 const heads=new Map<string,any>(),versions=new Map<string,any>(),keys=new Map<string,any>();const calls:Array<{path:string;method:string;body:any}>=[];let rejectCreate=false,rejectEdit=false,lose=false,conflict=false,readEffect:(()=>Promise<void>)|undefined;
 const request:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname,method=init?.method??'GET',body=JSON.parse(String(init?.body??'{}'));calls.push({path,method,body});
  const headers={'X-Artifactbin-Account':'usr_one'};
  if(path==='/api/artifacts/reservations')return Response.json({ids:Array.from({length:100},(_,i)=>`r${String(i).padStart(5,'0')}`)},{headers});
  if(path==='/api/artifacts'&&method==='POST'){
   if(rejectCreate){rejectCreate=false;return Response.json({error:'invalid_sql',details:['Bad query']},{status:400,headers});}
   const key=new Headers(init?.headers).get('Idempotency-Key')!;if(keys.has(key))return Response.json(keys.get(key),{headers});
   const id=body.reserved_id;const markup=body.markup?.replace('<p>','<p id="auto">');const head={id,version:1,edit_id:'edit1',state:digest(id+'1'),format:markup?'markup':body.image?'image':'dataset',...(body.image?{markup:null}:{}),...(markup?{markup,document:body.forked_from?legacyTree(markup):createDocumentGraph(markup,1)}:{columns:[]}),title:null,theme:null,template:null,visibility:'unlisted',link_role:'viewer',parent_id:null};heads.set(id,head);keys.set(key,head);if(lose){lose=false;throw Error('lost reply');}return Response.json(head,{headers});
  }
  const id=path.split('/')[3],head=heads.get(id);
  if(method==='GET'&&path.endsWith('/content'))return Response.json([{name:'One',count:1}],{headers});
  if(method==='GET'&&path.includes('/versions/')){const archived=versions.get(id+':'+path.split('/').at(-1));return Response.json(archived??{error:'not_found'},{status:archived?200:404,headers});}
  if(method==='GET'){await readEffect?.();if(head?.markup&&head.document?.kind!=='graph')head.document=createDocumentGraph(head.markup,head.version);return Response.json(head,{headers});}
  if(path.endsWith('/prepare'))return Response.json({}, {headers});
  if(method==='PATCH'){const next={...head,...body,version:head.version+1,edit_id:'edit2',state:digest(id+'2')};heads.set(id,next);return Response.json(next,{headers});}
  if(path.endsWith('/edits')){
   if(rejectEdit){rejectEdit=false;return Response.json({error:'invalid_sql',details:['1st ORDER BY term does not match any column in the result set']},{status:400,headers});}
   if(conflict)return Response.json({error:'doc_changed',detail:'Changed',current:head},{status:409,headers});
   const document=applyGraphPatch(head.document,head.version,body.document_update.patch);assert.ok(document);const next={...head,version:head.version+1,edit_id:'edit2',state:digest(id+'2'),markup:graphSource(document),document};heads.set(id,next);if(lose){lose=false;throw Error('lost reply');}return Response.json(next,{headers});
  }
  throw Error(`Unexpected ${method} ${path}`);
 };
 const client=new HttpClient({connection:{server:'https://example.com',token:'mxmx_test_publication'},home,account:'usr_one',fetch:request});
 return{root,workspace,client,heads,versions,calls,setRejectCreate:()=>{rejectCreate=true;},setRejectEdit:()=>{rejectEdit=true;},setReadEffect:(effect:()=>Promise<void>)=>{readEffect=effect;},setLost:()=>{lose=true;},setConflict:(value=true)=>{conflict=value;},cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('a pulled identity in a marked workspace updates its original and finalizes the authoring baseline',async()=>{
 const f=await fixture();try{
  const markup='<p id="text">One</p>',head={id:'old001',version:1,edit_id:'edit1',state:digest('old0011'),format:'markup',markup,document:createDocumentGraph(markup,1),title:null,theme:null,template:null,visibility:'unlisted' as const,link_role:'viewer' as const,parent_id:null,capabilities:{edit:true}};
  f.heads.set(head.id,head);
  const accepted=Buffer.from(writeDocument(snapshotDocument(head)));
  await saveTracking(f.workspace,{server:f.client.connection.server,account:'usr_one',set:{'child.jsx':{id:head.id,file:digest(accepted),url:'https://example.com/a/old001',snapshot:head}}});
  await writeFile(join(f.workspace.root,'child.jsx'),accepted.toString().replace('One','Updated'));
  await publishLocalWorkspace(await loadWorkspace(f.workspace.cwd,f.workspace.home),['child.jsx'],f.client,{});
  assert.equal(f.heads.size,1,'must not create a duplicate');
  assert.match(f.heads.get(head.id).markup,/Updated/);
  assert.ok(!f.calls.some(call=>call.path==='/api/artifacts/reservations'||call.method==='POST'&&call.path==='/api/artifacts'));
  const current=await loadWorkspace(f.workspace.cwd,f.workspace.home),bytes=await readFile(join(f.workspace.root,'child.jsx'));
  assert.equal(current.tracking?.files['child.jsx']?.snapshot.version,2);
  assert.equal(current.tracking?.files['child.jsx']?.file,digest(bytes));
  const count=f.calls.length;await publishLocalWorkspace(current,['child.jsx'],f.client,{});assert.equal(f.calls.length,count);
 }finally{await f.cleanup();}
});
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
  await publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{});const count=f.calls.length;let checks=0;
  const other=new HttpClient({connection:f.client.connection,home:f.workspace.home,account:'usr_other',fetch:async(input,init)=>{
   checks++;assert.equal(new URL(String(input)).pathname,'/api/artifacts');assert.equal(init?.method,'GET');assert.equal(new Headers(init?.headers).get('X-Artifactbin-Account'),'usr_one');
   return Response.json({error:'account_mismatch'},{status:409});
  }});
  await assert.rejects(publishLocalWorkspace(f.workspace,['child.jsx'],other,{}),/account/i);assert.equal(checks,1);assert.equal(other.account,'usr_other');assert.equal(f.calls.length,count);
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
  const yaml='type: dataset\nsource: rows.json\nid: loc004\ntitle: "Literal ref:loc002"\ndescription: "Literal /a/loc002"\n';await writeFile(join(f.workspace.root,'data.yaml'),yaml);await registerLocalFiles(f.workspace,['data.yaml']);
  await publishLocalWorkspace(f.workspace,['data.yaml'],f.client,{});
  assert.equal(f.heads.size,2);assert.equal(await readFile(join(f.workspace.root,'data.yaml'),'utf8'),yaml);assert.match(await readFile(join(f.workspace.root,'rows.json'),'utf8'),/loc002/);
  const dataset=f.calls.find(call=>call.body.dataset);assert.ok(dataset);assert.equal(dataset.body.title,'Literal ref:loc002');assert.equal(dataset.body.description,'Literal /a/loc002');assert.match(JSON.stringify(dataset.body.dataset),/ref:r\d{5}/);assert.doesNotMatch(JSON.stringify(dataset.body.dataset),/loc00/);
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

test('publication rewrites semantic resource addresses while preserving literal prose and descriptive JSON',async()=>{
 const f=await fixture();try{
  const source="---\nid: loc001\ntitle: \"Literal ref:loc003\"\n---\n<Helmet><Import name=\"rows\" src=\"ref:loc003\" /><Query name=\"q\" source=\"ref:loc003\">{`select 'ref:loc003' as description`}</Query></Helmet><div id=\"root\"><p id=\"literal\">Literal ref:loc003 and /a/loc002 stay here.</p><a id=\"link\" href=\"/a/loc002\">Child</a><img id=\"image\" src=\"ref:loc003\" /></div>";
  await writeFile(join(f.workspace.root,'doc.jsx'),source);await writeFile(join(f.workspace.root,'rows.json'),'[{"link":"ref:loc002","description":"Literal ref:loc002 stays here","nested":{"note":"See /a/loc002 in the instructions"}}]');
  await publishLocalWorkspace(f.workspace,['doc.jsx'],f.client,{});
  const doc=[...f.heads.values()].find(head=>head.markup?.includes('Literal'));assert.ok(doc);assert.match(doc.markup,/Literal ref:loc003 and \/a\/loc002 stay here/);assert.match(doc.markup,/select 'ref:loc003' as description/);assert.match(doc.markup,/href="\/a\/r\d{5}"/);assert.match(doc.markup,/src="ref:r\d{5}"/);assert.match(doc.markup,/source="ref:r\d{5}"/);
  const rows=f.calls.find(call=>call.body.dataset)!.body.dataset;assert.match(rows[0].link,/^ref:r\d{5}$/);assert.equal(rows[0].description,'Literal ref:loc002 stays here');assert.equal(rows[0].nested.note,'See /a/loc002 in the instructions');assert.equal(await readFile(join(f.workspace.root,'doc.jsx'),'utf8'),source);
 }finally{await f.cleanup();}
});

test('an imported baseline may publish when the remote version advanced without changing the edited dependency',async()=>{
 const f=await fixture();try{
  const source='<p id="text">One</p>',document=createDocumentGraph(source,1);
  const head={id:'old001',version:2,edit_id:'edit2',state:digest('old0012'),format:'markup',markup:source,document,title:'Remote metadata changed',theme:null,template:null,visibility:'unlisted',link_role:'viewer',parent_id:null,capabilities:{edit:true}};
  f.heads.set(head.id,head);f.versions.set(head.id+':1',{artifact_id:head.id,version:1,format:'markup',markup:source,document,title:null,meta:{}});
  (await localWorkspaceState(f.workspace.root)).put(LOCAL_WORKSPACE_SCOPE,'archive','import-baseline/child.jsx',{artifactId:head.id,origin:'https://example.com',base:{version:1,editId:'edit1',source},source:source.replace('One','Imported')});
  await writeFile(join(f.workspace.root,'child.jsx'),(await readFile(join(f.workspace.root,'child.jsx'),'utf8')).replace('One','Imported'));
  await publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{});
  assert.equal(f.heads.size,1);assert.match(f.heads.get('old001').markup,/Imported/);
  assert.equal(f.heads.get('old001').title,'Remote metadata changed');
  assert.ok(f.calls.some(call=>call.path==='/api/artifacts/old001/edits'));
  assert.ok(!f.calls.some(call=>call.path==='/api/artifacts'||call.path==='/api/artifacts/reservations'));
 }finally{await f.cleanup();}
});

async function bindOriginal(f:Awaited<ReturnType<typeof fixture>>,path='child.jsx'){
 const markup='<p id="text">One</p>',head={id:'old001',version:1,edit_id:'edit1',state:digest('old0011'),format:'markup',markup,document:createDocumentGraph(markup,1),title:null,theme:null,template:null,visibility:'unlisted' as const,link_role:'viewer' as const,parent_id:null,capabilities:{edit:true}};
 f.heads.set(head.id,head);const bytes=Buffer.from(writeDocument(snapshotDocument(head)));
 await saveTracking(f.workspace,{server:f.client.connection.server,account:'usr_one',set:{[path]:{id:head.id,file:digest(bytes),url:'https://example.com/a/'+head.id,snapshot:head}}});await writeFile(join(f.workspace.root,path),bytes);return head;
}
test('copied complete published fences update their original without requiring a draft registration',async()=>{
 const f=await fixture();try{
  const head=await bindOriginal(f);await saveTracking(f.workspace,{server:f.client.connection.server,account:'usr_one',remove:['child.jsx']});await writeFile(join(f.workspace.root,'copy.jsx'),writeDocument(snapshotDocument(head)).replace('One','Copied'));
  await publishLocalWorkspace(f.workspace,['copy.jsx'],f.client);assert.equal(f.heads.size,1);assert.match(f.heads.get(head.id).markup,/Copied/);assert.ok(!f.calls.some(call=>call.path.includes('reservations')));
 }finally{await f.cleanup();}
});
test('stale, partial and read-only copied fences refuse the entire mixed selection before reservation or writes',async()=>{
 for(const mode of ['stale','partial','viewer']){
  const f=await fixture();try{
   const head=await bindOriginal(f);if(mode==='viewer')head.capabilities.edit=false;
   let bytes=writeDocument(snapshotDocument(head)).replace('One','Copied');if(mode==='stale')bytes=bytes.replace('head_version: 1','head_version: 2');if(mode==='partial')bytes=bytes.replace(/edit_id:.*\n/,'');
   await writeFile(join(f.workspace.root,'copy.jsx'),bytes);
   await assert.rejects(publishLocalWorkspace(f.workspace,['child.jsx','copy.jsx'],f.client));assert.ok(f.calls.every(call=>call.method==='GET'));assert.equal(f.heads.size,1);
  }finally{await f.cleanup();}
 }
});
test('automatic registration does not make a copied ID-only fence a trusted local draft',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.workspace.root,'copy.jsx'),'---\nid: old001\n---\n<p id="text">Copied</p>');await registerLocalFiles(f.workspace,['copy.jsx'],{intent:'automatic'});
  await assert.rejects(publishLocalWorkspace(f.workspace,['copy.jsx'],f.client),/unregistered identity/);assert.equal(f.calls.length,0);
 }finally{await f.cleanup();}
});
test('bound conflict appears on original status; explicit pull clears projection and a later edit updates the original',async()=>{
 const f=await fixture();try{
  const head=await bindOriginal(f);await publishLocalWorkspace(await loadWorkspace(f.workspace.root,f.workspace.home),['child.jsx'],f.client);
  await writeFile(join(f.workspace.root,'child.jsx'),(await readFile(join(f.workspace.root,'child.jsx'),'utf8')).replace('One','Proposal'));f.setConflict();
  await assert.rejects(publishLocalWorkspace(await loadWorkspace(f.workspace.root,f.workspace.home),['child.jsx'],f.client),/doc_changed/);
  assert.equal((await localStatus(await loadWorkspace(f.workspace.root,f.workspace.home))).files.find(file=>file.path==='child.jsx')?.status,'conflicted');
  f.setConflict(false);await pull(await loadWorkspace(f.workspace.root,f.workspace.home),['child.jsx'],f.client,{force:true});
  await writeFile(join(f.workspace.root,'child.jsx'),(await readFile(join(f.workspace.root,'child.jsx'),'utf8')).replace('One','Resolved'));
  await publishLocalWorkspace(await loadWorkspace(f.workspace.root,f.workspace.home),['child.jsx'],f.client);assert.match(f.heads.get(head.id).markup,/Resolved/);assert.equal(f.heads.size,1);
 }finally{await f.cleanup();}
});
test('lost successful bound response plus newer typing recovers the edit and retains identity',async()=>{
 const f=await fixture();try{
  const head=await bindOriginal(f);await writeFile(join(f.workspace.root,'child.jsx'),(await readFile(join(f.workspace.root,'child.jsx'),'utf8')).replace('One','First'));f.setLost();
  await assert.rejects(publishLocalWorkspace(await loadWorkspace(f.workspace.root,f.workspace.home),['child.jsx'],f.client),/confirmed response/);
  await writeFile(join(f.workspace.root,'child.jsx'),(await readFile(join(f.workspace.root,'child.jsx'),'utf8')).replace('First','Second'));
  await publishLocalWorkspace(await loadWorkspace(f.workspace.root,f.workspace.home),['child.jsx'],f.client);assert.equal(f.heads.size,1);assert.match(f.heads.get(head.id).markup,/Second/);assert.equal(f.calls.filter(call=>call.method==='POST'&&call.path.endsWith('/edits')).length,2);assert.ok(!f.calls.some(call=>call.path.includes('reservations')));
 }finally{await f.cleanup();}
});
test('a bound parent retains discovery of its offline child after canonical references acquire remote IDs',async()=>{
 const f=await fixture();try{
  const head=await bindOriginal(f,'doc.jsx');head.markup='<a id="link" href="/a/loc002">Child</a>';head.document=createDocumentGraph(head.markup,1);const bytes=Buffer.from(writeDocument(snapshotDocument(head)));
  await saveTracking(f.workspace,{server:f.client.connection.server,account:'usr_one',set:{'doc.jsx':{id:head.id,file:digest(bytes),url:'https://example.com/a/'+head.id,snapshot:head}}});await writeFile(join(f.workspace.root,'doc.jsx'),bytes);
  await publishLocalWorkspace(await loadWorkspace(f.workspace.root,f.workspace.home),['doc.jsx'],f.client);
  assert.equal(f.heads.size,2);assert.match(await readFile(join(f.workspace.root,'doc.jsx'),'utf8'),/href="\/a\/r\d{5}"/);
  await writeFile(join(f.workspace.root,'child.jsx'),(await readFile(join(f.workspace.root,'child.jsx'),'utf8')).replace('One','Child edited'));
  await publishLocalWorkspace(await loadWorkspace(f.workspace.root,f.workspace.home),['doc.jsx'],f.client);
  assert.equal(f.heads.size,2);assert.ok([...f.heads.values()].some(head=>head.markup?.includes('Child edited')));
 }finally{await f.cleanup();}
});
test('a copied untracked fence survives a lost successful edit response and newer typing',async()=>{
 const f=await fixture();try{
  const head=await bindOriginal(f);await saveTracking(f.workspace,{server:f.client.connection.server,account:'usr_one',remove:['child.jsx']});await writeFile(join(f.workspace.root,'copy.jsx'),writeDocument(snapshotDocument(head)).replace('One','First'));f.setLost();
  await assert.rejects(publishLocalWorkspace(await loadWorkspace(f.workspace.root,f.workspace.home),['copy.jsx'],f.client),/confirmed response/);
  await writeFile(join(f.workspace.root,'copy.jsx'),(await readFile(join(f.workspace.root,'copy.jsx'),'utf8')).replace('First','Second'));
  await publishLocalWorkspace(await loadWorkspace(f.workspace.root,f.workspace.home),['copy.jsx'],f.client);assert.equal(f.heads.size,1);assert.match(f.heads.get(head.id).markup,/Second/);assert.ok(!f.calls.some(call=>call.path.includes('reservations')));
 }finally{await f.cleanup();}
});
test('confirmed original finalization is replayable after each store boundary, including fresh-home transfer',async()=>{
 for(const phase of ['portable','home']){
  const f=await fixture();try{
   const head=await bindOriginal(f),workspace=await loadWorkspace(f.workspace.root,f.workspace.home);
   const frozen=Buffer.from(writeDocument(snapshotDocument(head)).replace('One','Accepted'));await writeFile(join(workspace.root,'child.jsx'),frozen);
   const manifest={format:1 as const,server:f.client.connection.server,account:'usr_one',root:join(f.root,'projection'),ids:{old001:'old001'},inputs:{'child.jsx':{localId:'old001',bytes:frozen.toString('base64'),hash:digest(frozen)}}};
   const bindings=await prepareBindings(workspace,['child.jsx'],{ 'child.jsx':'old001'},manifest,f.client);
   const acceptedHead={...head,version:2,edit_id:'edit2',state:digest('accepted'),markup:head.markup.replace('One','Accepted')},accepted=Buffer.from(writeDocument(snapshotDocument(acceptedHead))),entry={id:head.id,url:'https://example.com/a/'+head.id,snapshot:acceptedHead,file:digest(accepted)};
   await deliverBound(workspace,bindings,manifest,()=>observeDelivery('child.jsx',entry,accepted));
   await assert.rejects(finalizeBindings(workspace,{onProgress:at=>{if(at===phase)throw Error('simulated finalization interruption');}}),/interruption/);
   const moved=join(f.root,'moved'),home=join(f.root,'new-home');await cp(workspace.root,moved,{recursive:true});await mkdir(home);
   const transferred={...workspace,root:moved,cwd:moved,home};await finalizeBindings(transferred);const current=await loadWorkspace(moved,home);assert.equal(current.tracking!.files['child.jsx']!.snapshot.version,2);assert.deepEqual(await readFile(join(moved,'child.jsx')),accepted);
   assert.equal((await localStatus(current)).files.find(file=>file.path==='child.jsx')?.status,'unchanged');assert.equal((await localWorkspaceState(moved)).list(LOCAL_WORKSPACE_SCOPE,'archive').filter(row=>row.key.startsWith('publication-finalize/')).length,0);
  }finally{await f.cleanup();}
 }
});
test('in-flight binary author edits remain byte-exact through confirmed finalization',async()=>{
 const f=await fixture();try{
  const path='asset.bin',frozen=Buffer.from([255,1,128]),latest=Buffer.from([255,2,128,0]);await writeFile(join(f.workspace.root,path),frozen);
  const head={id:'old001',version:2,edit_id:'edit2',state:digest('binary'),format:'file'},entry={id:head.id,url:'https://example.com/a/'+head.id,snapshot:head,file:digest(frozen)};
  const manifest={format:1 as const,server:f.client.connection.server,account:'usr_one',root:join(f.root,'projection'),ids:{old001:'old001'},inputs:{[path]:{localId:'old001',bytes:frozen.toString('base64'),hash:digest(frozen)}}};
  await deliverBound(f.workspace,[{path,localId:'old001',tracked:entry,bytes:frozen}],manifest,async()=>{await writeFile(join(f.workspace.root,path),latest);await observeDelivery(path,entry,frozen);});
  await finalizeBindings(f.workspace);assert.deepEqual(await readFile(join(f.workspace.root,path)),latest);assert.equal((await loadWorkspace(f.workspace.root,f.workspace.home)).tracking!.files[path]!.file,digest(frozen));
 }finally{await f.cleanup();}
});
test('pull tracking journal travels before home synchronization and detects unrelated store divergence',async()=>{
 const f=await fixture();try{
  const head=await bindOriginal(f),workspace=await loadWorkspace(f.workspace.root,f.workspace.home),snapshot={...head,version:2,edit_id:'edit2',state:digest('pulled2')},bytes=Buffer.from(writeDocument(snapshotDocument(snapshot))),entry={id:head.id,url:'https://example.com/a/'+head.id,snapshot,file:digest(bytes)};
  const portable=await localWorkspaceState(workspace.root);
  await stageLocalFiles(workspace.root,[{path:'child.jsx',before:digest(await readFile(join(workspace.root,'child.jsx'))),data:bytes}],store=>{writeTracking(store,LOCAL_WORKSPACE_SCOPE,{server:f.client.connection.server,account:'usr_one',set:{'child.jsx':entry}});store.put(LOCAL_WORKSPACE_SCOPE,'archive','tracking-to-home/current',{server:f.client.connection.server,account:'usr_one'});});
  const moved=join(f.root,'moved'),home=join(f.root,'new-home');await cp(workspace.root,moved,{recursive:true});await mkdir(home);await recoverLocalFiles(moved);
  const current=await loadWorkspace(moved,home);assert.equal(current.tracking!.files['child.jsx']!.snapshot.version,2);assert.deepEqual(await readFile(join(moved,'child.jsx')),bytes);
  portable.delete(LOCAL_WORKSPACE_SCOPE,'archive','tracking-to-home/current');await assert.rejects(loadWorkspace(workspace.root,workspace.home),/disagree/);
 }finally{await f.cleanup();}
});

test('a manual identity change during authenticated preflight refuses before any reservation or artifact write',async()=>{
 const f=await fixture();try{
  await bindOriginal(f);const file=join(f.workspace.root,'child.jsx');await writeFile(file,(await readFile(file,'utf8')).replace('One','Proposal'));
  f.setReadEffect(async()=>{await writeFile(file,(await readFile(file,'utf8')).replace('id: old001','id: other1'));});
  await assert.rejects(publishLocalWorkspace(await loadWorkspace(f.workspace.root,f.workspace.home),['child.jsx'],f.client),/identity/i);assert.ok(f.calls.every(call=>call.method==='GET'));assert.match(await readFile(file,'utf8'),/id: other1/);
 }finally{await f.cleanup();}
});

test('a different published fence typed during delivery is preserved with confirmed recovery evidence',async()=>{
 const f=await fixture();try{
  const head=await bindOriginal(f),workspace=await loadWorkspace(f.workspace.root,f.workspace.home),frozen=Buffer.from(writeDocument(snapshotDocument(head)).replace('One','Accepted'));
  await writeFile(join(workspace.root,'child.jsx'),frozen);
  const manifest={format:1 as const,server:f.client.connection.server,account:'usr_one',root:join(f.root,'projection'),ids:{old001:'old001'},inputs:{'child.jsx':{localId:'old001',bytes:frozen.toString('base64'),hash:digest(frozen)}}};
  const bindings=await prepareBindings(workspace,['child.jsx'],{'child.jsx':'old001'},manifest,f.client),next={...head,version:2,edit_id:'edit2',state:digest('accepted'),markup:head.markup.replace('One','Accepted')},accepted=Buffer.from(writeDocument(snapshotDocument(next))),entry={id:head.id,url:'https://example.com/a/'+head.id,snapshot:next,file:digest(accepted)},other=Buffer.from(frozen.toString().replace('id: old001','id: other1'));
  await deliverBound(workspace,bindings,manifest,async()=>{await writeFile(join(workspace.root,'child.jsx'),other);await observeDelivery('child.jsx',entry,accepted);});f.calls.length=0;
  await assert.rejects(finalizeBindings(workspace),/changed identity/);assert.deepEqual(await readFile(join(workspace.root,'child.jsx')),other);assert.ok((await localWorkspaceState(workspace.root)).list(LOCAL_WORKSPACE_SCOPE,'archive').some(row=>row.key.startsWith('publication-finalize/')));assert.equal(f.calls.length,0);
  await writeFile(join(workspace.root,'child.jsx'),frozen);await finalizeBindings(workspace);assert.deepEqual(await readFile(join(workspace.root,'child.jsx')),accepted);assert.equal(f.calls.length,0);
 }finally{await f.cleanup();}
});

test('binary publication ignores a native snapshot null markup when synchronizing local comments',async()=>{
 const f=await fixture();try{
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeklEQVR4nO3PUQkAIBTAwBfCiEY0oCH8OITBAtxm7fN1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYBsljBD1B9RXYAAAAASUVORK5CYII=','base64');
  await writeFile(join(f.workspace.root,'picture.png'),bytes);
  await registerLocalFiles(f.workspace,['picture.png']);
  const result=await publishLocalWorkspace(f.workspace,['picture.png'],f.client,{});
  assert.equal(result.operations[0]?.status,'published');
  assert.deepEqual(await readFile(join(f.workspace.root,'picture.png')),bytes);
  assert.ok(f.calls.some(call=>call.body.image==='data:image/png;base64,'+bytes.toString('base64')));
  const count=f.calls.length;
  await publishLocalWorkspace(f.workspace,['picture.png'],f.client,{});
  assert.equal(f.calls.length,count,'retry needs neither another upload nor a markup parse');
 }finally{await f.cleanup();}
});

test('a rejected first create accepts a corrected local proposal without duplicate or normalization conflict',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.workspace.root,'child.jsx'),'---\nid: loc002\n---\n<p>One</p>');
  f.setRejectCreate();await assert.rejects(publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{}),/invalid_sql/);
  const corrected=(await readFile(join(f.workspace.root,'child.jsx'),'utf8')).replace('One','Corrected');
  await writeFile(join(f.workspace.root,'child.jsx'),corrected);
  await publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{});
  assert.equal(f.heads.size,1);assert.match([...f.heads.values()][0].markup,/Corrected/);
  assert.equal(await readFile(join(f.workspace.root,'child.jsx'),'utf8'),corrected);
 }finally{await f.cleanup();}
});
test('a published QA fork upgrades its legacy create snapshot through an authenticated read before ordinary editing',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.workspace.root,'child.jsx'),'---\nid: loc002\nforked_from: old001\n---\n<p id="text">One</p>');
  await publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{});
  const head=[...f.heads.values()][0];assert.equal(head.document.kind,'jsx','fork creates retain the legacy representation until read');
  const before=f.calls.length;
  await writeFile(join(f.workspace.root,'child.jsx'),(await readFile(join(f.workspace.root,'child.jsx'),'utf8')).replace('One','Corrected QA'));
  await publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{});
  assert.equal(f.heads.size,1);assert.match(f.heads.get(head.id).markup,/Corrected QA/);
  assert.deepEqual(f.calls.slice(before).map(call=>({path:call.path,method:call.method})),[{path:'/api/artifacts/'+head.id,method:'GET'},{path:'/api/artifacts/'+head.id+'/edits',method:'POST'}]);
 }finally{await f.cleanup();}
});
test('upgrading a fork snapshot cannot adopt a concurrent writer as the local authoring baseline',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.workspace.root,'child.jsx'),'---\nid: loc002\nforked_from: old001\n---\n<p id="text">One</p>');
  await publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{});
  const head=[...f.heads.values()][0];head.markup='<p id="text">Concurrent</p>';head.document=legacyTree(head.markup);head.version=2;head.edit_id='edit-other';head.state=digest('concurrent');
  const proposal=(await readFile(join(f.workspace.root,'child.jsx'),'utf8')).replace('One','Local');await writeFile(join(f.workspace.root,'child.jsx'),proposal);
  const before=f.calls.length;
  await assert.rejects(publishLocalWorkspace(f.workspace,['child.jsx'],f.client,{}),{code:'state_conflict'});
  assert.ok(f.calls.slice(before).every(call=>call.method==='GET'));assert.match(head.markup,/Concurrent/);
  assert.equal(await readFile(join(f.workspace.root,'child.jsx'),'utf8'),proposal);
 }finally{await f.cleanup();}
});
test('a pulled report can correct a rejected compound-query proposal without publication normalization conflict',async()=>{
 const f=await fixture();try{
  const head=await bindOriginal(f);
  const invalid='---\nid: '+head.id+'\nedit_id: '+head.edit_id+'\nhead_version: 1\nstate: '+head.state+'\n---\n<Helmet><Query name="pivot">{`SELECT team, sum(cups) AS total FROM coffee.rows GROUP BY team UNION ALL SELECT \'All teams\', sum(cups) FROM coffee.rows ORDER BY (team = \'All teams\'), total DESC`}</Query></Helmet><section id="report"><p id="text">Q2 coffee</p></section>';
  await writeFile(join(f.workspace.root,'child.jsx'),invalid);f.setRejectEdit();
  await assert.rejects(publishLocalWorkspace(await loadWorkspace(f.workspace.root,f.workspace.home),['child.jsx'],f.client,{}),/invalid_sql/);
  assert.equal(await readFile(join(f.workspace.root,'child.jsx'),'utf8'),invalid);
  const corrected=invalid.replace('SELECT team, sum(cups) AS total FROM coffee.rows GROUP BY team UNION ALL SELECT \'All teams\', sum(cups) FROM coffee.rows ORDER BY (team = \'All teams\'), total DESC','SELECT team, total FROM (SELECT team, sum(cups) AS total, 0 AS sortkey FROM coffee.rows GROUP BY team UNION ALL SELECT \'All teams\', sum(cups), 1 FROM coffee.rows) ORDER BY sortkey, total DESC');
  await writeFile(join(f.workspace.root,'child.jsx'),corrected);
  await publishLocalWorkspace(await loadWorkspace(f.workspace.root,f.workspace.home),['child.jsx'],f.client,{});
  assert.equal(f.heads.size,1);assert.match(f.heads.get(head.id).markup,/ORDER BY sortkey/);
  assert.ok(!f.calls.some(call=>call.path==='/api/artifacts'&&call.method==='POST'));
 }finally{await f.cleanup();}
});
test('pulling a published offline dataset as YAML transfers its hidden publication identity before later edits',async()=>{
 const f=await fixture();try{
  await publishLocalWorkspace(f.workspace,['rows.json'],f.client,{});
  const dataset=[...f.heads.values()].find(head=>head.format==='dataset');assert.ok(dataset);dataset.capabilities={edit:true};
  const original=await readFile(join(f.workspace.root,'rows.json'));
  await pull(await loadWorkspace(f.workspace.root,f.workspace.home),[dataset.id],f.client,{output:'data.yaml'});
  const proposal=(await readFile(join(f.workspace.root,'data.yaml'),'utf8')).replace('title: null','title: Corrected dataset');
  await writeFile(join(f.workspace.root,'data.yaml'),proposal);
  const count=f.heads.size;
  await publishLocalWorkspace(await loadWorkspace(f.workspace.root,f.workspace.home),['data.yaml'],f.client,{});
  assert.equal(f.heads.size,count);assert.equal(f.heads.get(dataset.id).title,'Corrected dataset');
  assert.deepEqual(await readFile(join(f.workspace.root,'rows.json')),original);
  const tracked=(await loadWorkspace(f.workspace.root,f.workspace.home)).tracking!.files;
  assert.equal(tracked['data.yaml'].id,dataset.id);assert.equal(tracked['data.yaml'].snapshot.version,2);
  assert.equal(Object.values(tracked).filter(entry=>entry.id===dataset.id).length,1);
  assert.equal((await localInputReferences(await loadWorkspace(f.workspace.root,f.workspace.home)))[dataset.id],'data.yaml','a pulled identity outranks its former publication alias');
 }finally{await f.cleanup();}
});
test('unbound local readers refuse an ambiguous published reference across origins',async()=>{
 const f=await fixture();try{
  await publishLocalWorkspace(f.workspace,['rows.json'],f.client,{});
  const dataset=[...f.heads.values()].find(value=>value.format==='dataset');assert.ok(dataset);
  const copy=join(f.workspace.root,'.artifactbin','publications',digest('https://other.example').slice(0,24));await mkdir(copy,{recursive:true});
  await writeFile(join(copy,'manifest.json'),JSON.stringify({format:1,server:'https://other.example',account:'usr_one',root:join(copy,'files'),inputs:{},ids:{loc002:dataset.id}}));
  await assert.rejects(localInputReferences(f.workspace),{code:'ambiguous_reference'});
  assert.equal((await localInputReferences(f.workspace,f.client.connection.server))[dataset.id],'rows.json');
 }finally{await f.cleanup();}
});
test('a local capture reads its offline dataset after the bound parent acquires published reference IDs',async()=>{
 const f=await fixture();let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  await writeFile(join(f.workspace.root,'rows.json'),'[{"cups":10},{"cups":20}]');
  const head=await bindOriginal(f,'doc.jsx');
  const proposed=writeDocument({...snapshotDocument(head),body:'<Helmet><Import name="coffee" src="ref:loc003" /><Query name="total">{`select sum(cups) as cups from coffee.rows`}</Query></Helmet><p id="text">Coffee report</p>'});
  await writeFile(join(f.workspace.root,'doc.jsx'),proposed);
  await publishLocalWorkspace(await loadWorkspace(f.workspace.root,f.workspace.home),['doc.jsx'],f.client,{});
  const current=await loadWorkspace(f.workspace.root,f.workspace.home),bytes=await readFile(join(f.workspace.root,'doc.jsx'),'utf8');assert.match(bytes,/ref:r\d{5}/);
  const dataset=[...f.heads.values()].find(value=>value.format==='dataset');assert.ok(dataset);
  assert.equal((await localIdentities(current))[dataset.id],undefined,'discovery aliases must not become owned identities');
  assert.equal((await localInputReferences(current,'https://other.example'))[dataset.id],undefined,'a different publication origin cannot supply the alias');
  const before=f.calls.length;
  session=await startPreview({root:current.root,home:current.home,files:['doc.jsx'],localFiles:await localIdentities(current),capture:true});
  await session.document('doc.jsx');
  const response=await fetch(session.url+'/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file:'doc.jsx',values:{}})});
  assert.equal(response.status,200);const result=await response.json();assert.deepEqual(result.tables.total.rows,[{cups:30}]);
  assert.equal(session.failure(),undefined);assert.equal(f.calls.length,before,'capture must use local rows without an authenticated remote fallback');
  assert.equal(await readFile(join(f.workspace.root,'doc.jsx'),'utf8'),bytes);assert.equal(f.heads.size,2);
 }finally{await session?.close();await f.cleanup();}
});

test('a bound author can edit normalized repeated nodes without rematching obsolete un-IDed input',async()=>{
 const f=await fixture();try{
  const head=await bindOriginal(f),file=join(f.workspace.root,'child.jsx');
  await writeFile(file,writeDocument({...snapshotDocument(head),body:'<section><p>Same</p><p>Same</p></section>'}));
  await publishLocalWorkspace(await loadWorkspace(f.workspace.root,f.workspace.home),['child.jsx'],f.client,{});
  const accepted=await readFile(file,'utf8');assert.match(accepted,/id="[A-Za-z0-9]{4}"/);
  await writeFile(file,accepted.replace('Same','Changed'));
  await publishLocalWorkspace(await loadWorkspace(f.workspace.root,f.workspace.home),['child.jsx'],f.client,{});
  assert.equal(f.heads.size,1);assert.match(f.heads.get(head.id).markup,/Changed/);assert.match(f.heads.get(head.id).markup,/Same/);
 }finally{await f.cleanup();}
});
