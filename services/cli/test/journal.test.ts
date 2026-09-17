import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {digest} from '../src/files';
import {stageFiles,recoverFiles,stagedFiles,confinedPath} from '../src/journal';
import {State} from '../src/state';
import {stageRequest,readPendingRequest,savePendingResponse,clearPendingRequest,archivePendingRequest} from '../src/pending-request';


async function fixture(run:(home:string,root:string)=>Promise<void>) {
 const base=await mkdtemp(join(tmpdir(),'afbin-journal-'));
 const home=join(base,'home'),root=join(base,'work');
 await mkdir(home);await mkdir(root);
 try {await run(home,root);} finally {await rm(base,{recursive:true,force:true});}
}
test('rejects external symlinks and traversal, but resolves internal symlinks',()=>fixture(async(_home,root)=>{
 await writeFile(join(root,'real'),'old');
 await symlink('real',join(root,'inside'));
 assert.equal(await confinedPath(root,'inside'),await confinedPath(root,'real'));
 await symlink(tmpdir(),join(root,'outside'));
 await assert.rejects(confinedPath(root,'outside/escape'),/outside/);
 await assert.rejects(confinedPath(root,'../escape'),/outside/);
}));
test('checks all expected hashes before writing and preserves a later local edit',()=>fixture(async(home,root)=>{
 await writeFile(join(root,'one'),'old');await writeFile(join(root,'two'),'old');
 await stageFiles(home,root,[{path:'one',before:digest('old'),data:Buffer.from('new')},{path:'two',before:digest('old'),data:Buffer.from('new')}]);
 await writeFile(join(root,'two'),'user edit');
 await assert.rejects(recoverFiles(home,root),/changed/);
 assert.equal(await readFile(join(root,'one'),'utf8'),'old');
 assert.equal(await readFile(join(root,'two'),'utf8'),'user edit');
}));
for(const after of [0,1,2])test(`recovers a real process death after ${after} replacements`,()=>fixture(async(home,root)=>{
 await writeFile(join(root,'binary'),Buffer.from([0,255,1]));
 await writeFile(join(root,'skill'),'old skill');
 const changes=[{path:'binary',before:digest(Buffer.from([0,255,1])),data:Buffer.from([0,254,2]),mode:0o700},{path:'skill',before:digest('old skill'),data:Buffer.from('new skill')}];
 await stageFiles(home,root,changes);
 const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {recoverFiles} from ${JSON.stringify(new URL('../src/journal.ts',import.meta.url).href)}; await recoverFiles(${JSON.stringify(home)},${JSON.stringify(root)}, {onProgress:n=>{if(n===${after})process.kill(process.pid,'SIGKILL')}});`],{stdio:'pipe'});
 assert.equal(child.signal,'SIGKILL',child.stderr.toString());
 assert.equal(await recoverFiles(home,root),'recovered');
 assert.deepEqual(await readFile(join(root,'binary')),Buffer.from([0,254,2]));
 assert.equal(await readFile(join(root,'skill'),'utf8'),'new skill');
 assert.equal(await recoverFiles(home,root),'clean');
}));
test('staging is exclusive and corrupt payloads cannot be applied',()=>fixture(async(home,root)=>{
 await stageFiles(home,root,[{path:'doc',before:null,data:Buffer.from('new')}]);
 assert.equal(await stagedFiles(home,root),true);
 await assert.rejects(stageFiles(home,root,[{path:'other',before:null,data:Buffer.from('other')}]),/pending/);
 const state=await State.open(home);
 try{state.put(root,'staged-file','doc',{before:null,sha256:digest('new'),mode:0o600},{data:Buffer.from('tampered')});}
 finally{state.close();}
 await assert.rejects(recoverFiles(home,root),/checksum/);
 await assert.rejects(readFile(join(root,'doc')),{code:'ENOENT'});
}));
test('a staged commit puts nothing in the workspace: the records and the bytes live in the store',()=>fixture(async(home,root)=>{
 await stageFiles(home,root,[{path:'doc',before:null,data:Buffer.from('new')}]);
 assert.deepEqual(await readdir(root),[],'staging alone writes no file into the workspace');
 const state=await State.open(home);
 try{
  const record=state.get<{before:string|null;sha256:string;mode:number}>(root,'staged-file','doc');
  assert.equal(record?.value.sha256,digest('new'));
  assert.equal(record?.data?.toString(),'new');
 }finally{state.close();}
 assert.equal(await recoverFiles(home,root),'recovered');
 assert.deepEqual(await readdir(root),['doc']);
 assert.equal(await stagedFiles(home,root),false);
}));
test('staged bytes and the tracking beside them commit together, or not at all',()=>fixture(async(home,root)=>{
 const tracked={id:'abc123',file:digest('new'),url:'https://example.com/a/abc123',snapshot:{id:'abc123',version:1,edit_id:'e1',state:'a'.repeat(64)}};
 await assert.rejects(stageFiles(home,root,[{path:'doc',before:null,data:Buffer.from('new')}],state=>{
  state.put(root,'workspace',root,{server:'https://example.com',account:'usr_one'});
  state.put(root,'tracked','doc',tracked);
  throw new Error('interrupted');
 }),/interrupted/);
 const state=await State.open(home);
 try{
  assert.equal(state.list(root,'staged-file').length,0,'the rolled-back transaction left no staged bytes');
  assert.equal(state.get(root,'tracked','doc'),null,'and no tracking');
 }finally{state.close();}
}));

describe('the pending request record', () => {
  async function fixture(run:(home:string,root:string)=>Promise<void>){
   const base=await mkdtemp(join(tmpdir(),'afbin-pending-'));
   const home=join(base,'home'),root=join(base,'work');
   await mkdir(home);await mkdir(root);
   try{await run(home,root);}finally{await rm(base,{recursive:true,force:true});}
  }
  /** Corrupt the stored record the way a damaged database would, without the CLI's own writers. */
  async function tamper(home:string,root:string,change:(value:Record<string,any>)=>void){
   const state=await State.open(home);
   try{const record=state.get<Record<string,any>>(root,'pending-request','current');change(record!.value);state.put(root,'pending-request','current',record!.value);}
   finally{state.close();}
  }

  test('freezes complete request bytes before publication and durably records the response for local recovery',()=>fixture(async(home,root)=>{
   const body={markup:'<p>First</p>'};
   const pending=await stageRequest(home,root,{server:'https://example.com',credential:'tokenhash',request:{path:'/artifacts',method:'POST',body},file:{path:'doc.jsx',bytes:Buffer.from(body.markup).toString('base64')}});
   body.markup='<p>Later</p>';
   assert.equal((await readPendingRequest(home,root))?.request.body.markup,'<p>First</p>');
   await assert.rejects(stageRequest(home,root,{...pending}),/pending/);
   await savePendingResponse(home,root,pending,{id:'abc123'},'usr_one');
   assert.deepEqual((await readPendingRequest(home,root))?.response,{id:'abc123'});
   await tamper(home,root,value=>{value.request.body.markup='changed';});
   await assert.rejects(readPendingRequest(home,root),/checksum/);
   await clearPendingRequest(home,root);assert.equal(await readPendingRequest(home,root),null);
  }));
  test('rejects a corrupted saved response before it can overwrite local identity',()=>fixture(async(home,root)=>{
   const pending=await stageRequest(home,root,{server:'https://example.com',credential:'hash',request:{path:'/artifacts',method:'POST',body:{markup:'<p />'}},file:{path:'doc.jsx',bytes:Buffer.from('<p />').toString('base64')}});
   await savePendingResponse(home,root,pending,{id:'abc123'},'usr_one');
   await tamper(home,root,value=>{value.response.id='xyz789';});
   await assert.rejects(readPendingRequest(home,root),/checksum/);
  }));

  test('recovery archives refuse a different existing proposal instead of discarding it',()=>fixture(async(home,root)=>{
   const pending=await stageRequest(home,root,{server:'https://example.com',credential:'tokenhash',request:{path:'/artifacts/abc123',method:'PUT',body:{markup:'<p>first</p>'}},file:{path:'doc.jsx',bytes:Buffer.from('<p>first</p>').toString('base64')}});
   const key=await archivePendingRequest(home,root,pending,Buffer.from('first proposal'));
   assert.equal(key,`recovered-requests/${pending.key}`,'the archive is addressed by the operation key, not a file path');
   assert.equal(await archivePendingRequest(home,root,pending,Buffer.from('first proposal')),key);
   await assert.rejects(archivePendingRequest(home,root,pending,Buffer.from('different proposal')),/archive/);
   const state=await State.open(home);
   try{
    const archived=state.get<{local:string}>(root,'archive',key);
    assert.equal(Buffer.from(archived!.value.local,'base64').toString(),'first proposal');
   }finally{state.close();}
   assert.ok(await readPendingRequest(home,root));
  }));
});
