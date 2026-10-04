import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,cp,rm,mkdir,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {loadWorkspace} from '../src/workspace';
import {localIdentities} from '../src/identities';
import {startPreview} from '../src/preview/session';
import {registerLocalFiles,localWorkspaceState,LOCAL_WORKSPACE_SCOPE,stageLocalFiles,recoverLocalFiles} from '../src/local-workspace';
import {digest} from '../src/files';

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
