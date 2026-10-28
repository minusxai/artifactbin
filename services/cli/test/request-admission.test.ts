import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cliHarness} from './harness';
import {readRecord} from './tracking';

test('a definitive refused agent proposal does not block a subsequent current reply',async()=>{
 const h=await cliHarness('afbin-admission-');
 try{
  const args=['comment','abc123','--thread','ann_current','--body','First proposal','--json'];
  assert.equal(await h.invoke(args,call=>call.method==='GET'?Response.json({capabilities:{comment_receipts:true}}):Response.json({error:'managed_lifecycle',message:'Return the answer instead.',admission_refused:true},{status:403})),1);
  assert.equal(h.last().error.code,'managed_lifecycle');
  assert.equal(await readRecord(h.root,h.root,'pending-operation','current'),null);
  const posts=h.calls.filter(call=>call.method==='POST');
  assert.equal(await h.invoke(['comment','abc123','--thread','ann_current','--body','Current answer','--json'],call=>call.method==='GET'?Response.json({capabilities:{comment_receipts:true}}):Response.json({ok:true,deferred:true},{status:202})),0);
  assert.equal(h.last().deferred,true);
  assert.equal(await readRecord(h.root,h.root,'pending-operation','current'),null);
  assert.equal(h.calls.filter(call=>call.method==='POST').length,2);
  assert.notEqual(h.calls.filter(call=>call.method==='POST')[1]!.key,posts[0]!.key);
 }finally{await h.cleanup();}
});

for(const response of [{status:404,body:{error:'not_found'}},{status:403,body:{error:'forbidden'}},{status:503,body:{error:'unavailable',admission_refused:true}}])test(`unconfirmed ${response.status} refusal preserves recoverable mutation identity`,async()=>{
 const h=await cliHarness('afbin-admission-unknown-');
 try{
  const respond=()=>Response.json(response.body,{status:response.status});
  await h.invoke(['comment','abc123','--thread','ann_current','--body','First','--json'],call=>call.method==='GET'?Response.json({capabilities:{comment_receipts:true}}):respond());
  assert.ok(await readRecord(h.root,h.root,'pending-operation','current'));
  const before=h.calls.length;
  await h.invoke(['comment','abc123','--thread','ann_current','--body','Changed','--json'],respond);
  assert.equal(h.last().error.code,'pending_recovery');
  assert.equal(h.calls.length,before);
 }finally{await h.cleanup();}
});

test('a definitive private 404 rejection releases an old pending comment on retry',async()=>{
 const h=await cliHarness('afbin-admission-private-');
 try{
  const args=['comment','abc123','--thread','ann_current','--body','Denied','--json'];
  await h.invoke(args,call=>call.method==='GET'?Response.json({capabilities:{comment_receipts:true}}):Response.json({error:'not_found'},{status:404}));
  assert.ok(await readRecord(h.root,h.root,'pending-operation','current'));
  const key=h.calls.find(call=>call.method==='POST')!.key;
  await h.invoke(args,()=>Response.json({error:'not_found',admission_refused:true},{status:404}));
  assert.equal(h.last().error.code,'not_found');
  assert.equal(h.calls.filter(call=>call.method==='POST').at(-1)!.key,key);
  assert.equal(await readRecord(h.root,h.root,'pending-operation','current'),null);
  assert.equal(await h.invoke(['comment','abc123','--thread','ann_current','--body','Allowed','--json'],call=>call.method==='GET'?Response.json({capabilities:{comment_receipts:true}}):Response.json({ok:true})),0);
 }finally{await h.cleanup();}
});
