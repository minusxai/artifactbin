import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,cp,rm,mkdir,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {loadWorkspace} from '../src/workspace';
import {localIdentities} from '../src/identities';
import {startPreview} from '../src/preview/session';
import {registerLocalFiles,localWorkspaceState,LOCAL_WORKSPACE_SCOPE,stageLocalFiles,recoverLocalFiles,saveLocalFile} from '../src/local-workspace';
import {digest} from '../src/files';
import {localHistoryHead} from '../src/local-history';

test('fresh preview and add use portable identities without discovery or credentials',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-workspace-'));
 try{
  await writeFile(join(root,'report.jsx'),'<p id="text">Draft</p>');
  await writeFile(join(root,'rows.csv'),'amount\n10\n20\n');
  let previewed=false;const output:string[]=[];
  const context={cwd:root,home:join(root,'empty-home'),env:{},stdout:(v:string)=>output.push(v),stderr:()=>{},fetch:async()=>assert.fail('local commands must not fetch')};
  assert.equal(await runCli(['add','rows.csv','--json'],context),0,output.join(''));
  const workspace=await loadWorkspace(root,context.home),map=await localIdentities(workspace);
  assert.equal(Object.values(map).includes('rows.csv'),true);
  assert.equal(await runCli(['preview','report.jsx','--json'],{...context,preview:async()=>{previewed=true;return 0;}}),0,output.join(''));
  assert.equal(previewed,true);assert.match(await readFile(join(root,'report.jsx'),'utf8'),/id: [A-Za-z0-9]{6}/);
  assert.equal((await loadWorkspace(root,context.home)).tracking,null,'local registration does not bind a remote account');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('copying a workspace preserves reference IDs, comments and nested discovery with fresh CLI state',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'portable-workspace-'));let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  const root=join(parent,'original');await mkdir(root);await writeFile(join(root,'report.jsx'),'<p id="text">Draft</p>');await writeFile(join(root,'rows.csv'),'amount\n10\n');
  await registerLocalFiles(await loadWorkspace(root,join(parent,'home')),['report.jsx','rows.csv']);
  const before=await localIdentities(await loadWorkspace(root,join(parent,'home')));
  session=await startPreview({root,files:['report.jsx'],home:join(parent,'home')});
  const response=await fetch(session.url+'/comments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file:'report.jsx',node:'text',name:'Sam',text:'Keep this discussion'})});assert.equal(response.status,200);
  await session.close();session=undefined;
  const copied=join(parent,'copied');await cp(root,copied,{recursive:true});await mkdir(join(copied,'nested'));
  const fresh=await loadWorkspace(join(copied,'nested'),join(parent,'fresh-home'));
  assert.equal(fresh.root,await realpath(copied));assert.deepEqual(await localIdentities(fresh),before);
  session=await startPreview({root:copied,files:['report.jsx'],home:join(parent,'fresh-home')});
  assert.equal((await(await fetch(session.url+'/comments')).json())[0].text,'Keep this discussion');
 }finally{await session?.close();await rm(parent,{recursive:true,force:true});}
});

test('portable journal recovers after transfer and refuses external edits without dropping staged bytes',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'portable-journal-'));
 try{
  const root=join(parent,'original');await mkdir(root);await writeFile(join(root,'report.jsx'),'<p>Base</p>');
  await registerLocalFiles(await loadWorkspace(root,join(parent,'home')),['report.jsx']);
  const before=await readFile(join(root,'report.jsx'));const after=Buffer.from('<p>Recovered</p>');
  await stageLocalFiles(root,[{path:'report.jsx',before:digest(before),data:after}]);
  const copied=join(parent,'copied');await cp(root,copied,{recursive:true});
  await recoverLocalFiles(copied);assert.equal(await readFile(join(copied,'report.jsx'),'utf8'),after.toString());
  await writeFile(join(root,'report.jsx'),'<p>External</p>');
  await assert.rejects(recoverLocalFiles(root),/changed after staging/);
  assert.equal(await readFile(join(root,'report.jsx'),'utf8'),'<p>External</p>');
  assert.equal((await localWorkspaceState(root)).list(LOCAL_WORKSPACE_SCOPE,'staged-file').length,1);
 }finally{await rm(parent,{recursive:true,force:true});}
});

test('publication staging never inherits the enclosing author workspace',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-staging-'));
 try{
  await localWorkspaceState(root);const stage=join(root,'.artifactbin','publications','server','files');await mkdir(stage,{recursive:true});
  assert.equal((await loadWorkspace(stage,join(root,'fresh-home'))).root,await realpath(stage));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('moving a local document keeps its identity and discussion, and status discovers local files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-move-'));
 try{
  await writeFile(join(root,'report.jsx'),'<p id="text">Draft</p>');const workspace=await loadWorkspace(root,join(root,'home'));
  const ids=await registerLocalFiles(workspace,['report.jsx']);const store=await localWorkspaceState(root);
  store.put(LOCAL_WORKSPACE_SCOPE,'archive','import-baseline/report.jsx',{artifactId:'remote'});
  store.put(LOCAL_WORKSPACE_SCOPE,'preview-comment','note',{id:'note',file:'report.jsx',node:'text',name:'Sam',text:'Keep'});
  const output:string[]=[];const ctx={cwd:root,home:workspace.home,env:{},stdout:(v:string)=>output.push(v),stderr:()=>{},fetch:async()=>assert.fail('local move and status must not fetch')};
  assert.equal(await runCli(['mv','report.jsx','renamed.jsx','--json'],ctx),0,output.join(''));
  assert.equal((await localIdentities(await loadWorkspace(root,workspace.home)))[ids['report.jsx']!],'renamed.jsx');
  assert.equal(store.get<{file:string}>(LOCAL_WORKSPACE_SCOPE,'preview-comment','note')?.value.file,'renamed.jsx');
  assert.equal(store.get<{artifactId:string}>(LOCAL_WORKSPACE_SCOPE,'archive','import-baseline/renamed.jsx')?.value.artifactId,'remote');
  output.length=0;assert.equal(await runCli(['status','--json'],ctx),0);assert.match(output.join(''),/renamed.jsx/);
 }finally{await rm(root,{recursive:true,force:true});}
});

 test('portable publication dry run stays local without discovery or credentials',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-push-plan-'));
 try{
 await writeFile(join(root,'draft.jsx'),'<p id="p">Unpublished</p>');
 const out:string[]=[];const context={cwd:root,home:join(root,'home'),env:{},stdout:(s:string)=>out.push(s),stderr:()=>{},fetch:async()=>assert.fail('offline dry run must not fetch')};
 assert.equal(await runCli(['add','draft.jsx','--json'],context),0,out.join(''));out.length=0;
 assert.equal(await runCli(['push','draft.jsx','--dry-run','--json'],context),0,out.join(''));
 assert.equal(JSON.parse(out[0]!).local_only,true);assert.equal(JSON.parse(out[0]!).operations[0].status,'would_publish');
 }finally{await rm(root,{recursive:true,force:true});}
});

 test('local CLI log and move preserve saved history without server access',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-log-'));
 try{
 await writeFile(join(root,'draft.jsx'),'<p id="p">Original</p>');
 const workspace=await loadWorkspace(root,join(root,'home'));await registerLocalFiles(workspace,['draft.jsx']);
 const before=await readFile(join(root,'draft.jsx'));await saveLocalFile(root,'draft.jsx',digest(before),Buffer.from(before.toString().replace('Original','Edited')));
 const output:string[]=[];const context={cwd:root,home:workspace.home,env:{},stdout:(s:string)=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('local history must not fetch')};
 assert.equal(await runCli(['mv','draft.jsx','moved.jsx','--json'],context),0,output.join(''));output.length=0;
 assert.equal(await runCli(['log','moved.jsx','--json'],context),0,output.join(''));
 const result=JSON.parse(output[0]!);assert.equal(result.local,true);assert.equal(result.versions[0].version,1);assert.match(result.versions[0].source,/Original/);
 }finally{await rm(root,{recursive:true,force:true});}
});

 test('CLI discussion uses the portable editor store before authentication',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-cli-comment-'));let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
 await writeFile(join(root,'draft.jsx'),'<p id="p">Discuss locally</p>');
 const output:string[]=[];const context={cwd:root,home:join(root,'home'),env:{},stdout:(s:string)=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('local discussion must not fetch')};
 assert.equal(await runCli(['add','draft.jsx','--json'],context),0,output.join(''));output.length=0;
 assert.equal(await runCli(['comment','draft.jsx','--node','p','--body','Local note','--json'],context),0,output.join(''));
 const thread=JSON.parse(output[0]!);assert.equal(thread.local,true);output.length=0;
 assert.equal(await runCli(['comment','draft.jsx','--thread',thread.id,'--body','Reply','--state','resolved','--json'],context),0,output.join(''));
 assert.equal(JSON.parse(output[0]!).status,'resolved');output.length=0;
 assert.equal(await runCli(['comment','draft.jsx','--filter','state=all','--json'],context),0,output.join(''));
 assert.equal(JSON.parse(output[0]!).annotations[0].thread.length,2);
 session=await startPreview({root,files:['draft.jsx'],home:context.home});
 }finally{await session?.close();await rm(root,{recursive:true,force:true});}
});

 test('a refused move into another history leaves no pending move and preserves both files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-move-history-'));
 try{
 await writeFile(join(root,'draft.jsx'),'<p>Current</p>');await writeFile(join(root,'old.jsx'),'<p>Archived</p>');
 const workspace=await loadWorkspace(root,join(root,'home'));await registerLocalFiles(workspace,['draft.jsx','old.jsx']);
 await localHistoryHead(root,'old.jsx');await rm(join(root,'old.jsx'));
 const out:string[]=[];assert.equal(await runCli(['mv','draft.jsx','old.jsx','--json'],{cwd:root,home:workspace.home,env:{},stdout:s=>out.push(s),stderr:()=>{},fetch:async()=>assert.fail('local move must not fetch')}),2);
 assert.match(out.join(''),/history_conflict/);assert.match(await readFile(join(root,'draft.jsx'),'utf8'),/Current/);
 assert.equal((await localWorkspaceState(root)).get(LOCAL_WORKSPACE_SCOPE,'identity-move','current'),null);
 }finally{await rm(root,{recursive:true,force:true});}
});
