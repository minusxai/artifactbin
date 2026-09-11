import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compare} from '../src/comparison';
import {loadWorkspace} from '../src/workspace';
import {HttpClient} from '../src/http';
import {digest} from '../src/files';
import {writeDocument} from '../src/document';
test('historical diff caches fetched immutable content without changing the accepted base or working file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-history-cache-'));
 try {
  const snapshot={id:'abc123',version:2,edit_id:'edit2',state:digest('state2'),format:'markup',markup:'<p id="p001">Current</p>'};
  const local=writeDocument({metadata:{id:'abc123',edit_id:'edit2',head_version:2,state:snapshot.state},body:snapshot.markup});
  const lock={schema:1,server:'https://example.com',account:'user',root,files:{'doc.jsx':{id:'abc123',url:'https://example.com/a/abc123',base:digest(JSON.stringify(snapshot)),file:digest(local),baseline:Buffer.from(local).toString('base64'),snapshot}}};
  await writeFile(join(root,'doc.jsx'),local);await writeFile(join(root,'afbin.lock'),JSON.stringify(lock));let calls=0;
  const client=new HttpClient({connection:{server:'https://example.com',token:'test'},fetch:async()=>{calls++;return Response.json({id:'abc123',version:1,format:'markup',source:'<p id="p001">Previous</p>',markup:'<p id="p001">Previous</p>',meta:{}});}});
  const first=await compare(await loadWorkspace(root),'doc.jsx@1','https://example.com',false,client);
  assert.match(first.diffs[0].diff,/Previous/);assert.equal(calls,1);
  const cached=await loadWorkspace(root);assert.deepEqual(cached.lock!.files['doc.jsx'].snapshot,snapshot);
  const second=await compare(cached,'doc.jsx@1','https://example.com',false);
  assert.deepEqual(second,first);assert.equal(calls,1);assert.equal(await readFile(join(root,'doc.jsx'),'utf8'),local);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('historical binary diff reuses cached bytes without another content request',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-binary-history-'));
 try {
  const snapshot={id:'abc123',version:2,edit_id:'edit2',state:digest('state2'),format:'image'};
  const local=Buffer.from([0,1,2]);const lock={schema:1,server:'https://example.com',account:'user',root,files:{'image.png':{id:'abc123',url:'https://example.com/a/abc123',base:digest(JSON.stringify(snapshot)),file:digest(local),baseline:local.toString('base64'),snapshot}}};
  await writeFile(join(root,'image.png'),local);await writeFile(join(root,'afbin.lock'),JSON.stringify(lock));let calls=0;
  const client=new HttpClient({connection:{server:'https://example.com',token:'test'},fetch:async input=>{calls++;return String(input).includes('/content?')?new Response(Buffer.from([4,5,6])):Response.json({id:'abc123',version:1,format:'image',meta:{}});}});
  const first=await compare(await loadWorkspace(root),'image.png@1','https://example.com',false,client);
  assert.equal(calls,2);assert.match(first.diffs[0].diff,/differs/);
  const second=await compare(await loadWorkspace(root),'image.png@1','https://example.com',false);
  assert.deepEqual(second,first);assert.equal(calls,2);assert.deepEqual(await readFile(join(root,'image.png')),local);
 }finally{await rm(root,{recursive:true,force:true});}
});
