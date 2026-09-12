import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,stat,rm,rename,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadWorkspace,inspectWorkspace} from '../src/workspace';
import {digest} from '../src/files';

test('workspace reads use the nearest lock and never create state or scan untracked files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-workspace-'));
 try{
  await writeFile(join(root,'untracked.jsx'),'<p>ignored</p>');
  const empty=await loadWorkspace(root);assert.deepEqual(await inspectWorkspace(empty),[]);
  await assert.rejects(stat(join(root,'.artifactbin')),{code:'ENOENT'});
  await mkdir(join(root,'nested'));
  const bytes='---\nid: abc123\n---\n<p>hello</p>';
  await writeFile(join(root,'doc.jsx'),bytes);
  await writeFile(join(root,'afbin.lock'),JSON.stringify({schema:1,server:'https://example.com',account:'usr_one',root:'workspace_one',files:{'doc.jsx':{baseline:Buffer.from(bytes).toString('base64'),id:'abc123',base:digest(bytes),file:digest(bytes),url:'https://example.com/a/abc123',snapshot:{id:'abc123',version:1,edit_id:'editone',state:'a'.repeat(64),markup:'<p>hello</p>'}}}}));
  const workspace=await loadWorkspace(join(root,'nested'));
  const status=await inspectWorkspace(workspace);assert.equal(status.length,1);assert.equal(status[0].status,'unchanged');
  await writeFile(join(root,'doc.jsx'),bytes+'\n<p>changed</p>');assert.equal((await inspectWorkspace(workspace))[0].status,'modified');
  await writeFile(join(root,'copy.jsx'),bytes);
  await assert.rejects(inspectWorkspace(workspace,['../copy.jsx']),/duplicate_identity/);
  await rename(join(root,'doc.jsx'),join(root,'renamed.jsx'));
  const renamed=await inspectWorkspace(workspace,['../renamed.jsx']);assert.equal(renamed[0].renamedFrom,'doc.jsx');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('an interrupted first mutation anchors workspace discovery before the first lock exists',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pending-root-'));
 try{
  await mkdir(join(root,'nested'));await mkdir(join(root,'.artifactbin'));
  await writeFile(join(root,'.artifactbin','pending-request.json'),'{}');
  const workspace=await loadWorkspace(join(root,'nested'));
  assert.equal(workspace.root,await realpath(root));assert.equal(workspace.lock,null);
 }finally{await rm(root,{recursive:true,force:true});}
});

// ---- Seeded by the orchestrator for workstream W2a (cli-state). Turn each into a passing, non-todo test. ----
test('push writes no afbin.lock and no .artifactbin directory; tracking lives in the state store with a hash, not bytes',{todo:true},async()=>{
 const {mkdtemp,mkdir,writeFile,readdir}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {runCli}=await import('../src/dispatch');const {saveConnection}=await import('../src/config');const {State}=await import('../src/state');const {digest}=await import('../src/files');
 const root=await mkdtemp(join(tmpdir(),'afbin-state-ws-'));const home=join(root,'home');const cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 const fetchStub:typeof fetch=async(input,init)=>{const path=new URL(String(input)).pathname;const body=JSON.parse(String(init?.body??'{}'));
  if(path==='/api/artifacts')return Response.json({id:'abc123',version:1,edit_id:'e1',state:digest('s1'),markup:body.markup,format:'markup',visibility:'unlisted',url:'https://example.com/a/abc123'},{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
  throw new Error(`Unexpected ${init?.method} ${path}`);};
 await saveConnection({server:'https://example.com',token:'mx_test'},home);await writeFile(join(cwd,'doc.jsx'),'<p>One</p>');
 const out:string[]=[];assert.equal(await runCli(['push','doc.jsx','--json'],{cwd,home,interactive:false,fetch:fetchStub,stdout:x=>out.push(x),stderr:()=>{}}),0,out.join(''));
 assert.deepEqual((await readdir(cwd)).sort(),['doc.jsx'],'nothing but the user file lives in the workspace');
 const state=await State.open(home);
 try{
  const {realpath}=await import('node:fs/promises');const scope=await realpath(cwd);
  assert.deepEqual(state.get(scope,'workspace',scope)?.value,{server:'https://example.com',account:'usr_one'});
  const tracked=state.get<Record<string,unknown>>(scope,'tracked','doc.jsx')?.value;
  assert.ok(tracked);assert.equal(tracked.id,'abc123');assert.match(String(tracked.file),/^[a-f0-9]{64}$/);
  assert.equal('baseline' in tracked,false);assert.equal('base' in tracked,false);
  assert.equal(JSON.stringify(tracked).includes('base64'),false);
 }finally{state.close();}
 const status:string[]=[];assert.equal(await runCli(['status','--json'],{cwd,home,interactive:false,fetch:async()=>{throw new Error('offline');},stdout:x=>status.push(x),stderr:()=>{}}),0);
 assert.equal(JSON.parse(status.join('')).files[0].status,'unchanged');
});
test('a tracked binary asset records only its sha256 and status detects a changed image without any stored copy',{todo:true},async()=>{
 // Publish image.png as a standalone file, assert the tracked record has `file` (sha256) and a snapshot without content,
 // then overwrite image.png and assert `afbin status` reports 'modified' offline.
 assert.fail('implement');
});
test('workspace discovery is the nearest registered ancestor, else cwd, with no marker file anywhere',{todo:true},async()=>{
 // Register /root via a push in /root, then run status from /root/docs (root resolves to /root), from /elsewhere (root is itself,
 // no tracking), and after a second push from /root/docs/sub (registered child wins over the parent).
 assert.fail('implement');
});
test('an interrupted multi-file write is replayed from staged-file records and refuses a file the user changed meanwhile',{todo:true},async()=>{
 // Stage two files in one transaction, simulate a crash before the disk write, run any command: both land. Then stage again,
 // edit one target on disk, and assert recovery refuses that file and leaves it untouched, exactly as journal.test.ts guards today.
 assert.fail('implement');
});
