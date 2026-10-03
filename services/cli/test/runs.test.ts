import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {cliHarness} from './harness';
import {parseCommand} from '../src/commands';
import {helpDocument,briefDocument} from '../src/teaching';

test('runs start authenticates, carries JSON input, and retries with the same request identity',async()=>{
 const h=await cliHarness('afbin-runs-');
 try{
  await writeFile(join(h.root,'input.json'),JSON.stringify({region:'east'}));
  let calls=0;
  const respond=(call:import('./harness').RecordedCall)=>{
   assert.equal(call.path,'/api/artifacts/abc123/runs');assert.equal(call.method,'POST');
   assert.equal(call.headers.authorization,'Bearer test-token');
   assert.deepEqual(call.body,{requestId:'weekly-1',input:{region:'east'}});
   if(++calls===1)throw new Error('connection lost after admission');
   return Response.json({runId:'run_123'},{status:202});
  };
  const args=['runs','start','abc123','--input','input.json','--request','weekly-1','--json'];
  assert.notEqual(await h.invoke(args,respond),0);
  assert.equal(await h.invoke(args,respond),0);assert.equal(h.last().runId,'run_123');
 }finally{await h.cleanup();}
});
test('runs reads output/receipt and replay cursors, and cancels through the authenticated client',async()=>{
 const h=await cliHarness('afbin-run-read-');
 try{
  for(const [args,path,method,answer] of [
   [['status','run_123'],'/api/runs/run_123','GET',{runId:'run_123',status:'completed',output:{count:2},receipt:{durationMs:4}}],
   [['events','run_123','--after','5','--limit','2'],'/api/runs/run_123/events?after=5&limit=2','GET',{events:[],nextSequence:5,hasMore:false}],
   [['cancel','run_123'],'/api/runs/run_123/cancel','POST',{ok:true}],
  ] as const){
   assert.equal(await h.invoke(['runs',...args,'--json'],call=>{assert.equal(call.path,path);assert.equal(call.method,method);return Response.json(answer);}),0);
   assert.deepEqual(h.last(),answer);
  }
  assert.notEqual(await h.invoke(['runs','status','run_other','--json'],()=>Response.json({error:'not_found'},{status:404})),0);
 }finally{await h.cleanup();}
});
test('run flags refuse ambiguous submissions and invalid cursors before authentication',()=>{
 for(const args of [ ['start','abc123'], ['start','abc123','--request',''],['status','run_1','--request','x'],['events','run_1','--after','-1'],['cancel','../evil'],['wat','run_1'] ])assert.throws(()=>parseCommand(['runs',...args]));
});
test('Lambda teaching is discoverable and teaches current bindings and receipt semantics',()=>{
 assert.match(briefDocument(),/lambdas/);
 const text=helpDocument('lambdas');
 for(const expected of ['export default async function','from \'page\'','await monthly.ready','monthly()','afbin runs start','--request','receipt','document'])assert.ok(text.includes(expected),expected);
});
test('runs resolves file and URL identities, refuses foreign/versioned refs and malformed input',async()=>{
 const h=await cliHarness('afbin-run-refs-');
 try{
  await writeFile(join(h.root,'hello.jsx'),'---\nid: abc123\n---\n<main />');
  for(const ref of ['hello.jsx','https://example.com/a/abc123']){
   assert.equal(await h.invoke(['runs','start',ref,'--request','same','--json'],call=>{assert.equal(call.path,'/api/artifacts/abc123/runs');assert.deepEqual(call.body,{requestId:'same',input:null});return Response.json({runId:'run_123'});}),0);
  }
  const before=h.calls.length;
  for(const ref of ['abc123@2','https://evil.example/a/abc123'])assert.notEqual(await h.invoke(['runs','start',ref,'--request','same','--json']),0);
  await writeFile(join(h.root,'broken.json'),'{broken');
  assert.notEqual(await h.invoke(['runs','start','abc123','--request','same','--input','broken.json','--json']),0);
  assert.equal(h.last().error.code,'invalid_input');assert.equal(h.calls.length,before);
  assert.equal(await h.invoke(['runs','start','abc123','--request','same','--json'],()=>Response.json({error:'idempotency_conflict'},{status:409})),3);
 }finally{await h.cleanup();}
});
