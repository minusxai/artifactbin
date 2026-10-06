import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rebindWorkspace} from '../src/workspace-rebind';
import {withLocalLock,registerLocalFiles,localWorkspaceState,LOCAL_WORKSPACE_SCOPE} from '../src/local-workspace';
import {stateFor} from '../src/state-access';
import {saveTracking,loadWorkspace,type Workspace} from '../src/workspace';
import {HttpClient} from '../src/http';
import {digest} from '../src/files';
import {withPrivateStateHome,saveConnection,observedCredentialAccount} from '../src/config';
import {publishLocalWorkspace} from '../src/local-publication';
import {parseCommand} from '../src/commands';
async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'afbin-rebind-'))),home=join(root,'home'),cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 const workspace:Workspace={home,root:cwd,cwd,tracking:null};await writeFile(join(cwd,'draft.jsx'),'---\nid: loc001\n---\n<p id="text">Local</p>');await registerLocalFiles(workspace,['draft.jsx']);
 await saveTracking(workspace,{server:'https://example.com',account:'usr_old'});
 const calls:Array<{method:string;pin:string|null}>=[];let adoption=false;
 const client=new HttpClient({connection:{server:'https://example.com',token:'mxmx_test_rebind'},home,account:'usr_old',fetch:async(_input,init)=>{
  const pin=new Headers(init?.headers).get('X-Artifactbin-Account');calls.push({method:init?.method??'GET',pin});
  if(pin==='usr_old'&&!adoption)return Response.json({error:'account_mismatch',expected_account:pin,actual_account:'usr_new'},{status:409});
  return Response.json({artifacts:[]},{headers:{'X-Artifactbin-Account':pin??'usr_new'}});
 }});
 return{root,home,workspace,client,calls,setAdoption:()=>{adoption=true;},cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('workspace rebind requires explicit current-account intent',()=>{
 assert.throws(()=>parseCommand(['workspace','rebind']),/current/);
 assert.throws(()=>parseCommand(['workspace','rebind','--account','other']),/current/);
 assert.equal(parseCommand(['workspace','rebind','--account','current']).command,'workspace');
});
test('rebind verifies unpinned credentials and old pin, changes only local ownership, and preserves draft bytes',async()=>{
 const f=await fixture();try{
  const before=await readFile(join(f.workspace.root,'draft.jsx'));
  const dry=await rebindWorkspace(f.workspace,f.client,{dryRun:true});assert.equal(dry.status,'would_rebind');assert.equal((await loadWorkspace(f.workspace.root,f.home)).tracking?.account,'usr_old');
  const result=await rebindWorkspace(f.workspace,f.client);assert.equal(result.status,'rebound');assert.equal((await loadWorkspace(f.workspace.root,f.home)).tracking?.account,'usr_new');
  assert.deepEqual(await readFile(join(f.workspace.root,'draft.jsx')),before);assert.ok(f.calls.every(call=>call.method==='GET'));assert.deepEqual(f.calls.slice(0,2).map(call=>call.pin),[null,'usr_old']);
  const portable=await localWorkspaceState(f.workspace.root);assert.equal(portable.get<{account:string}>(LOCAL_WORKSPACE_SCOPE,'workspace',LOCAL_WORKSPACE_SCOPE)?.value.account,'usr_new');assert.equal(portable.get<{id:string}>(LOCAL_WORKSPACE_SCOPE,'draft-identity','draft.jsx')?.value.id,'loc001');
 }finally{await f.cleanup();}
});
test('adopted guest alias keeps historical pin, mappings and reservation namespaces',async()=>{
 const f=await fixture();try{
  f.setAdoption();const store=await stateFor(f.home);store.put('home','identity-pool',JSON.stringify(['https://example.com','usr_old']),{ids:['r00001']});
  const result=await rebindWorkspace(f.workspace,f.client);assert.equal(result.status,'compatible_account');assert.equal((await loadWorkspace(f.workspace.root,f.home)).tracking?.account,'usr_old');assert.ok(store.get('home','identity-pool',JSON.stringify(['https://example.com','usr_old'])));
 }finally{await f.cleanup();}
});
test('rebind refuses every pending kind in home, portable and publication stores before changing pins',async()=>{
 for(const location of ['home','portable','publication'])for(const kind of ['pending-request','pending-operation','staged-file','identity-move'] as const){
  const f=await fixture();try{
   const publication=join(f.workspace.root,'.artifactbin','publications',digest('https://example.com').slice(0,24)),privateHome=join(publication,'private'),stageRoot=join(publication,'files');await mkdir(stageRoot,{recursive:true});
   await writeFile(join(publication,'manifest.json'),JSON.stringify({format:1,server:'https://example.com',account:'usr_old',root:stageRoot,ids:{loc001:'r00001'},inputs:{'draft.jsx':{localId:'loc001',bytes:(await readFile(join(f.workspace.root,'draft.jsx'))).toString('base64'),hash:'unused'}}}));
   if(location==='home')(await stateFor(f.home)).put(f.workspace.root,kind,'current',{pending:true});
   if(location==='portable')(await localWorkspaceState(f.workspace.root)).put(LOCAL_WORKSPACE_SCOPE,kind,'current',{pending:true});
   if(location==='publication')await withPrivateStateHome(privateHome,join(privateHome,'.artifactbin'),async()=>(await stateFor(privateHome)).put(stageRoot,kind,'current',{pending:true}));
   await assert.rejects(rebindWorkspace(f.workspace,f.client),/pending/);assert.equal(f.calls.length,0);assert.equal((await loadWorkspace(f.workspace.root,f.home)).tracking?.account,'usr_old');
  }finally{await f.cleanup();}
 }
});
test('old local-draft publication mappings become explicit refusal metadata, never fresh creates',async()=>{
 const f=await fixture();try{
  const publication=join(f.workspace.root,'.artifactbin','publications',digest('https://example.com').slice(0,24)),stageRoot=join(publication,'files');await mkdir(stageRoot,{recursive:true});
  await writeFile(join(publication,'manifest.json'),JSON.stringify({format:1,server:'https://example.com',account:'usr_old',root:stageRoot,ids:{loc001:'r00001'},inputs:{'draft.jsx':{localId:'loc001',bytes:(await readFile(join(f.workspace.root,'draft.jsx'))).toString('base64'),hash:'unused'}}}));
  await rebindWorkspace(f.workspace,f.client);f.calls.length=0;
  await assert.rejects(publishLocalWorkspace(await loadWorkspace(f.workspace.root,f.home),['draft.jsx'],f.client),/r00001/);assert.equal(f.calls.length,0);
 }finally{await f.cleanup();}
});
test('a credential account is last-observed evidence and expires with replacement credentials',async()=>{
 const f=await fixture();try{
  f.client.account=undefined;await f.client.request('/artifacts?limit=1');assert.equal((await observedCredentialAccount(f.client.connection,f.home))?.account,'usr_new');
  await saveConnection({...f.client.connection,token:'mxmx_test_replacement'},f.home);assert.equal(await observedCredentialAccount({...f.client.connection,token:'mxmx_test_replacement'},f.home),null);
 }finally{await f.cleanup();}
});
test('legacy mismatch response still retains 409 and supplies explicit rebind advice',async()=>{
 const client=new HttpClient({connection:{server:'https://example.com',token:'mxmx_test_legacy'},account:'usr_old',fetch:async()=>Response.json({error:'account_mismatch'},{status:409})});
 await assert.rejects(client.request('/artifacts?limit=1'),(error:any)=>error.code==='workspace_account_mismatch'&&error.exitCode===3&&error.details.http_status===409&&error.details.expected_account==='usr_old'&&/auth --email/.test(error.fix)&&/workspace rebind/.test(error.fix));
});
test('interrupted rebind rolls forward every pin/archive boundary and resumes safely after a workspace move',async()=>{
 for(const phase of ['intent','publication','home','portable'])for(const move of [false,true]){
  const f=await fixture();try{
   const publication=join(f.workspace.root,'.artifactbin','publications',digest('https://example.com').slice(0,24)),stageRoot=join(publication,'files');await mkdir(stageRoot,{recursive:true});
   await writeFile(join(publication,'manifest.json'),JSON.stringify({format:1,server:'https://example.com',account:'usr_old',root:stageRoot,ids:{loc001:'r00001'},inputs:{'draft.jsx':{localId:'loc001',bytes:(await readFile(join(f.workspace.root,'draft.jsx'))).toString('base64'),hash:'unused'}}}));
   await assert.rejects(rebindWorkspace(f.workspace,f.client,{onProgress:at=>{if(at===phase)throw Error('simulated interruption');}}),/interruption/);
   let workspace=f.workspace;
   if(move){
    const moved=join(f.root,'moved'),freshHome=join(f.root,'fresh-home');await cp(f.workspace.root,moved,{recursive:true});await mkdir(freshHome);workspace={...f.workspace,root:moved,cwd:moved,home:freshHome};
   }
   const original=await readFile(join(workspace.root,'draft.jsx'));const result=await rebindWorkspace(workspace,f.client);assert.equal(result.status,'rebound');assert.equal((await loadWorkspace(workspace.root,workspace.home)).tracking?.account,'usr_new');assert.deepEqual(await readFile(join(workspace.root,'draft.jsx')),original);
   const copy=JSON.parse(await readFile(join(workspace.root,'.artifactbin','publications',digest('https://example.com').slice(0,24),'manifest.json'),'utf8'));assert.equal(copy.account,'usr_new');assert.deepEqual(copy.ids,{});
   const portable=await localWorkspaceState(workspace.root);assert.equal(portable.get(LOCAL_WORKSPACE_SCOPE,'archive','workspace-rebind/current'),null);assert.equal(portable.get<{target:string}>(LOCAL_WORKSPACE_SCOPE,'archive','rebind-target/'+digest('https://example.com').slice(0,24)+'/draft.jsx')?.value.target,'r00001');
   if(move)assert.ok((await localWorkspaceState(f.workspace.root)).get(LOCAL_WORKSPACE_SCOPE,'archive','workspace-rebind/current'),'resume must not mutate the old tree');
  }finally{await f.cleanup();}
 }
});

test('account rebind cannot migrate a workspace origin even with explicit server selection',async()=>{
 const f=await fixture();try{
  const client=new HttpClient({connection:{server:'https://elsewhere.test',token:'mxmx_test_elsewhere'},home:f.home,fetch:async()=>{throw Error('origin refusal must precede HTTP');}});
  await assert.rejects(rebindWorkspace(f.workspace,client),(error:any)=>error.code==='wrong_server');assert.equal((await loadWorkspace(f.workspace.root,f.home)).tracking?.server,'https://example.com');
 }finally{await f.cleanup();}
});


test('a competing rebind waits for the common publication/pull lock in the same process',async()=>{
 const f=await fixture();let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;}),barrier=new Promise<void>(resolve=>{release=resolve;});
 try{const held=withLocalLock(f.workspace.root,async()=>{entered();await barrier;});await ready;const rebind=rebindWorkspace(f.workspace,f.client);await new Promise(resolve=>setTimeout(resolve,30));try{assert.equal(f.calls.length,0,'rebind must not probe or mutate while another operation owns the common lock');}finally{release();}await held;await rebind;assert.equal((await loadWorkspace(f.workspace.root,f.home)).tracking?.account,'usr_new');}
 finally{release();await f.cleanup();}
});
