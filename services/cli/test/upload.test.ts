import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseCommand} from '../src/commands';
import {cliHarness} from './harness';
import {HttpClient} from '../src/http';

test('upload accepts one file and requires an exact named document scope',()=>{
 assert.equal(parseCommand(['upload','photo.png','--in','abc123','--name','photos']).command,'upload');
 for(const args of [['upload','photo.png'],['upload','a.png','b.png','--in','abc123','--name','photos']])assert.throws(()=>parseCommand(args));
});
test('upload resolves the published import and returns its receipt without a row mutation',async()=>{
 const h=await cliHarness('afbin-upload-');
 try{
  await writeFile(join(h.root,'notes.txt'),'hello');
  assert.equal(await h.invoke(['upload','notes.txt','--in','abc123','--name','attachments','--idempotency-key','upload-1','--json'],call=>{
   if(call.method==='GET')return Response.json({id:'abc123',edit_id:'edit-1',format:'markup',markup:'<Helmet><Import name="attachments" src="ref:def456" /></Helmet><p id="p">Hi</p>'});
   assert.equal(call.path,'/api/artifacts/abc123/datasets/def456/files');
   assert.equal(call.headers['x-edit-id'],'edit-1');assert.equal(call.headers['idempotency-key'],'upload-1');
   assert.equal(call.headers['x-filename'],'notes.txt');assert.equal(call.headers['content-type'],'text/plain');
   return Response.json({ref:'dfile:ghi789',url:'/a/abc123/datasets/def456/files/ghi789',name:'notes.txt',contentType:'text/plain',size:5});
  }),0,h.out.join(''));assert.equal(h.calls.length,2);assert.equal(h.last().ref,'dfile:ghi789');
 }finally{await h.cleanup();}
});
test('raw upload retries the identical bytes and idempotency key after an uncertain response',async()=>{
 const calls:Request[]=[];const client=new HttpClient({connection:{server:'https://example.com',token:'test-token'},fetch:async(input,init)=>{
  const request=new Request(input as never,init);calls.push(request);if(calls.length===1)throw new Error('connection lost');
  return Response.json({ref:'dfile:ghi789'});
 }});
 assert.deepEqual(await client.upload('/artifacts/abc123/datasets/def456/files',Buffer.from([0,255,12]),{'Content-Type':'image/png','Idempotency-Key':'retry-1'}),{ref:'dfile:ghi789'});
 for(const request of calls){assert.deepEqual(Buffer.from(await request.arrayBuffer()),Buffer.from([0,255,12]));assert.equal(request.headers.get('Idempotency-Key'),'retry-1');assert.equal(request.headers.get('Content-Type'),'image/png');assert.equal(request.headers.get('Authorization'),'Bearer test-token');}
 assert.equal(calls.length,2);
});
test('upload refuses an unknown import and historical document before writing',async()=>{
 const h=await cliHarness('afbin-upload-refuse-');
 try{
  await writeFile(join(h.root,'notes.txt'),'hello');
  assert.notEqual(await h.invoke(['upload','notes.txt','--in','abc123','--name','missing','--json'],()=>Response.json({id:'abc123',edit_id:'e1',format:'markup',markup:'<Helmet><Import name="Attachments" src="ref:def456" /></Helmet>'})),0);
  assert.equal(h.last().error.code,'unknown_import');assert.equal(h.calls.length,1);
  assert.notEqual(await h.invoke(['upload','notes.txt','--in','abc123@1','--name','Attachments','--json']),0);assert.equal(h.last().error.code,'version_not_writable');assert.equal(h.calls.length,1);
 }finally{await h.cleanup();}
});
test('upload preserves encoded filenames, prints a concise human receipt, and relays dataset refusal',async()=>{
 const h=await cliHarness('afbin-upload-output-');
 const head={id:'abc123',edit_id:'e1',format:'markup',markup:'<Helmet><Import name="files" src="ref:def456" /></Helmet>'};
 try{
  await writeFile(join(h.root,'résumé #1.txt'),'notes');
  assert.equal(await h.invoke(['upload','résumé #1.txt','--in','abc123','--name','files'],call=>{
   if(call.method==='GET')return Response.json(head);
   assert.equal(decodeURIComponent(call.headers['x-filename']),'résumé #1.txt');
   return Response.json({ref:'dfile:ghi789',url:'/a/abc123/datasets/def456/files/ghi789',name:'résumé #1.txt',contentType:'text/plain',size:5});
  }),0);assert.equal(h.out.at(-1),'dfile:ghi789 /a/abc123/datasets/def456/files/ghi789\n');
  assert.notEqual(await h.invoke(['upload','résumé #1.txt','--in','abc123','--name','files','--json'],call=>call.method==='GET'?Response.json(head):Response.json({error:'dataset_write_forbidden',message:'No write grant.'},{status:403})),0);
  assert.equal(h.last().error.code,'dataset_write_forbidden');assert.equal(h.calls.filter(call=>call.method==='POST').length,2);
 }finally{await h.cleanup();}
});
test('an exhausted uncertain upload names a reusable recovery key',async()=>{
 const h=await cliHarness('afbin-upload-unknown-');
 try{
  await writeFile(join(h.root,'notes.txt'),'hello');
  assert.notEqual(await h.invoke(['upload','notes.txt','--in','abc123','--name','files','--json'],call=>{
   if(call.method==='GET')return Response.json({id:'abc123',edit_id:'e1',format:'markup',markup:'<Helmet><Import name="files" src="ref:def456" /></Helmet>'});
   throw new Error('lost response');
  }),0);
  const writes=h.calls.filter(call=>call.method==='POST');assert.equal(writes.length,3);
  assert.equal(new Set(writes.map(call=>call.headers['idempotency-key'])).size,1);
  assert.equal(h.last().error.code,'outcome_unknown');assert.ok(h.last().error.fix.includes(writes[0].headers['idempotency-key']));
 }finally{await h.cleanup();}
});

test('upload refuses malformed references and receipt metadata with a stable recovery key',async()=>{
 const h=await cliHarness('afbin-upload-receipt-');
 const receipt={ref:'dfile:ghi789',url:'/a/abc123/datasets/def456/files/ghi789',name:'notes.txt',contentType:'text/plain',size:5};
 try{
  await writeFile(join(h.root,'notes.txt'),'hello');
  for(const invalid of [
   {ref:'ref:ghi789'}, {ref:'dfile:UPPER'}, {ref:'dfile:ghi789/extra'},
   {url:'javascript:alert(1)'}, {url:'https://unrelated.example/a/abc123/datasets/def456/files/ghi789'},
   {url:'/a/abc123/datasets/def456/files/different'}, {url:receipt.url+'?token=secret'},
   {name:''}, {contentType:''}, {replayed:'yes'}, {size:1.5}, {size:-1}, {size:Number.MAX_SAFE_INTEGER+1},
  ]){
   assert.notEqual(await h.invoke(['upload','notes.txt','--in','abc123','--name','files','--idempotency-key','receipt-1','--json'],call=>call.method==='GET'?Response.json({id:'abc123',edit_id:'e1',format:'markup',markup:'<Helmet><Import name="files" src="ref:def456" /></Helmet>'}):Response.json({...receipt,...invalid})),0,JSON.stringify(invalid));
   assert.equal(h.last().error.code,'invalid_response');assert.match(h.last().error.fix,/--idempotency-key receipt-1/);
  }
 }finally{await h.cleanup();}
});
