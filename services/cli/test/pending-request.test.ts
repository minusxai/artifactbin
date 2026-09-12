import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageRequest,readPendingRequest,savePendingResponse,clearPendingRequest,archivePendingRequest} from '../src/pending-request';
import {State} from '../src/state';

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
