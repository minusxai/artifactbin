import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageRequest,readPendingRequest,savePendingResponse,clearPendingRequest,archivePendingRequest} from '../src/pending-request';
test('freezes complete request bytes before publication and durably records the response for local recovery',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pending-'));
 try{
  const body={markup:'<p>First</p>'};
  const pending=await stageRequest(root,{server:'https://example.com',credential:'tokenhash',request:{path:'/artifacts',method:'POST',body},file:{path:'doc.jsx',bytes:Buffer.from(body.markup).toString('base64')}});
  body.markup='<p>Later</p>';
  assert.equal((await readPendingRequest(root))?.request.body.markup,'<p>First</p>');
  await assert.rejects(stageRequest(root,{...pending}),/pending/);
  await savePendingResponse(root,pending,{id:'abc123'},'usr_one');
  assert.deepEqual((await readPendingRequest(root))?.response,{id:'abc123'});
  const path=join(root,'.artifactbin/pending-request.json');const tampered=JSON.parse(await readFile(path,'utf8'));tampered.request.body.markup='changed';await writeFile(path,JSON.stringify(tampered));
  await assert.rejects(readPendingRequest(root),/checksum/);
  await clearPendingRequest(root);assert.equal(await readPendingRequest(root),null);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('rejects a corrupted saved response before it can overwrite local identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-response-'));
 try{
  const pending=await stageRequest(root,{server:'https://example.com',credential:'hash',request:{path:'/artifacts',method:'POST',body:{markup:'<p />'}},file:{path:'doc.jsx',bytes:Buffer.from('<p />').toString('base64')}});
  await savePendingResponse(root,pending,{id:'abc123'},'usr_one');
  const path=join(root,'.artifactbin/pending-request.json');const data=JSON.parse(await readFile(path,'utf8'));data.response.id='xyz789';await writeFile(path,JSON.stringify(data));
  await assert.rejects(readPendingRequest(root),/checksum/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('recovery archives refuse a different existing proposal instead of discarding it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-archive-'));
 try{
  const pending=await stageRequest(root,{server:'https://example.com',credential:'tokenhash',request:{path:'/artifacts/abc123',method:'PUT',body:{markup:'<p>first</p>'}},file:{path:'doc.jsx',bytes:Buffer.from('<p>first</p>').toString('base64')}});
  const path=await archivePendingRequest(root,pending,Buffer.from('first proposal'));
  assert.equal(await archivePendingRequest(root,pending,Buffer.from('first proposal')),path);
  await assert.rejects(archivePendingRequest(root,pending,Buffer.from('different proposal')),/archive/);
  assert.equal(Buffer.from(JSON.parse(await readFile(path,'utf8')).local,'base64').toString(),'first proposal');
  assert.ok(await readPendingRequest(root));
 }finally{await rm(root,{recursive:true,force:true});}
});
