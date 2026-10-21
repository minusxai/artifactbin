import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, createServer, createReplica, enqueue, optimistic, reconcile, cancelPending, rotateEpoch, markDispatched } from './model.ts';
import type { Operation } from './contracts.ts';
const op = (id='a', baseVersion=0): Operation => ({id,epoch:1,schema:1,baseVersion,key:'count',value:1,expiresAt:100});
const yes={canWrite:true};
test('idempotent retry is immutable, including payload mismatch and revoked permission',()=>{
 const a=applyOperation(createServer(),op(),yes,0);
 assert.equal(a.receipt.status,'accepted');
 assert.deepEqual(applyOperation(a.server,op(),{canWrite:false},200),a);
 const mismatch=applyOperation(a.server,{...op(),value:2},yes,0);
 assert.equal(mismatch.receipt.reason,'id-reused'); assert.deepEqual(mismatch.server,a.server);
 assert.equal(a.server.effects.length,1);
});
test('terminal failures and boundary values',()=>{
 for(const [change,principal,time,reason] of [
 [{baseVersion:1},yes,0,'conflict'],[{}, {canWrite:false},0,'forbidden'],[{},yes,100,'expired'],
 [{epoch:0},yes,0,'epoch'],[{schema:2},yes,0,'schema'],[{key:'__proto__'},yes,0,'invalid'],
 [{value:NaN},yes,0,'invalid'],[{id:''},yes,0,'invalid'],[{expiresAt:Infinity},yes,0,'invalid']
 ] as const){ const result=applyOperation(createServer(),{...op(),...change} as Operation,principal,time); assert.equal(result.receipt.reason,reason); assert.equal(result.server.version,0); }
 assert.equal(applyOperation(createServer(),op(),yes,99).receipt.status,'accepted');
});
test('optimistic rollback, stale snapshot rejection, cancellation and bounded queue',()=>{
 let r=enqueue(createReplica(createServer()),op()); assert.equal(optimistic(r).data.count,1);
 r=cancelPending(r,'a'); assert.equal(optimistic(r).data.count,undefined);
 r=enqueue(r,op()); const rejected=applyOperation(createServer(),op(),{canWrite:false},0);
 r=reconcile(r,rejected.server,[rejected.receipt]); assert.equal(r.pending.length,0); assert.equal(optimistic(r).data.count,undefined);
 const accepted=applyOperation(createServer(),op(),yes,0); r=reconcile(r,accepted.server,[accepted.receipt]);
 assert.throws(()=>reconcile(r,createServer(),[]),/stale/);
 let full=createReplica(createServer()); for(let i=0;i<64;i++) full=enqueue(full,op('q'+i)); assert.throws(()=>enqueue(full,op('overflow')),/capacity/);
 assert.throws(()=>enqueue(createReplica(createServer()),{...op(),value:'x'.repeat(65537)}),/invalid/);
});
test('epoch migration fences old pending operations and receipt retention exhaustion is fail closed',()=>{
 const s=applyOperation(createServer(),op(),yes,0).server; const next=rotateEpoch(s);
 assert.equal(next.epoch,2); assert.equal(next.version,1); assert.equal(applyOperation(next,op(),yes,0).receipt.reason,'epoch');
 const r=reconcile(enqueue(createReplica(s),op('b',1)),next,[]); assert.equal(r.pending.length,0); assert.equal(r.receipts[0].reason,'epoch');
 const full=createServer(); for(let i=0;i<1000;i++) full.receipts['r'+i]={id:'r'+i,binding:'',status:'rejected',version:0};
 assert.equal(applyOperation(full,op(),yes,0).receipt.reason,'capacity'); assert.equal(full.version,0);
});
function permutations<T>(xs:T[]):T[][]{return xs.length?xs.flatMap((x,i)=>permutations(xs.filter((_,j)=>i!==j)).map(rest=>[x,...rest])):[[]];}
test('all 720 bounded delivery schedules: duplicate/reorder/lost acknowledgements/restarts converge',()=>{
 let runs=0;
 for(const schedule of permutations([0,1,2,3,4,5])){
  let s=createServer(); let a=enqueue(createReplica(s),op('a')); let b=enqueue(createReplica(s),{...op('b'),value:2});
  for(const event of schedule){
   if(event<4) { const operation=event%2?op('a'):{...op('b'),value:2}; s=applyOperation(s,operation,yes,0).server; }
   else if(event===4){s=JSON.parse(JSON.stringify(s));a=JSON.parse(JSON.stringify(a));b=JSON.parse(JSON.stringify(b));}
   else {a=reconcile(a,s,Object.values(s.receipts)); b=reconcile(b,s,Object.values(s.receipts));}
  }
  a=reconcile(a,s,Object.values(s.receipts)); b=reconcile(b,s,Object.values(s.receipts));
  assert.equal(s.version,1); assert.equal(s.effects.length,1); assert.deepEqual(a.confirmed,b.confirmed); assert.equal(a.pending.length+b.pending.length,0); runs++;
 } assert.equal(runs,720);
});
test('negative control: dropping receipt retention admits ID reuse',()=>{
 const committed=applyOperation(createServer(),op(),yes,0).server;
 const changed={...op(),baseVersion:1,value:2};
 assert.equal(applyOperation(committed,changed,yes,0).receipt.reason,'id-reused');
 const broken={...committed,receipts:{}};
 assert.equal(applyOperation(broken,changed,yes,0).server.effects.length,2);
});

test('in-flight cancellation is not falsely acknowledged and foreign receipts cannot discard work',()=>{
 let r=markDispatched(enqueue(createReplica(createServer()),op()),'a');
 assert.throws(()=>cancelPending(r,'a'),/unknown/);
 r=reconcile(r,createServer(),[{id:'a',binding:'different',status:'accepted',version:1}]);
 assert.equal(r.pending.length,1);
});

test('rejection is terminal even after permission/clock changes; caller must issue a new ID',()=>{
 const denied=applyOperation(createServer(),op(),{canWrite:false},0);
 assert.deepEqual(applyOperation(denied.server,op(),yes,0).receipt,denied.receipt);
 const accepted=applyOperation(denied.server,op('new-id'),yes,0);assert.equal(accepted.receipt.status,'accepted');
 const expired=applyOperation(createServer(),op(),yes,101);assert.deepEqual(applyOperation(expired.server,op(),yes,0).receipt,expired.receipt);
});
test('checkpoint preserves undelivered effects and allows only new-epoch operation IDs',()=>{
 const old=applyOperation(createServer(),op(),yes,0).server;const next=rotateEpoch(old);
 assert.deepEqual(next.effects,old.effects);
 const newer=applyOperation(next,{...op(),epoch:2,baseVersion:1},yes,0);
 assert.deepEqual(newer.server.effects.map(e=>[e.epoch,e.id]),[[1,'a'],[2,'a']]);
});
test('JSON value/operation aliasing does not mutate committed or queued state',()=>{
 const value={items:[1,2]};const operation={...op(),value};const result=applyOperation(createServer(),operation,yes,0);
 const replica=enqueue(createReplica(createServer()),operation);value.items.push(3);
 assert.deepEqual(result.server.data.count,{items:[1,2]});assert.deepEqual(optimistic(replica).data.count,{items:[1,2]});
 assert.equal(applyOperation(createServer(),{...op(),value:Array(2)},yes,0).receipt.reason,'invalid');
});

test('receipt ahead of snapshot waits for coherent snapshot; malformed receipts never settle',()=>{
 const pending=enqueue(createReplica(createServer()),op()); const committed=applyOperation(createServer(),op(),yes,0);
 for(const receipt of [committed.receipt,{...committed.receipt,status:'made-up'},{...committed.receipt,version:NaN},{...committed.receipt,version:-1}]) {
   assert.equal(reconcile(pending,createServer(),[receipt as any]).pending.length,1);
 }
 assert.equal(reconcile(pending,committed.server,[committed.receipt]).pending.length,0);
});
test('descriptor-based JSON rejects getters, hidden/symbol fields and deep input without invoking accessors',()=>{
 let hits=0;const getter={get x(){hits++;return 1;}};
 const hidden=Object.defineProperty({},'x',{value:1});const symbol={[Symbol('x')]:1};
 const decorated=Object.assign([1],{extra:2});let deep:any=1;for(let i=0;i<80;i++)deep={deep};
 for(const value of [getter,hidden,symbol,decorated,deep]) assert.equal(applyOperation(createServer(),{...op(),value} as any,yes,0).receipt.reason,'invalid');
 assert.equal(hits,0);
});

test('effect-intent capacity remains bounded across epoch checkpoints',()=>{
 const server=createServer();server.effects=Array.from({length:1000},(_,i)=>({id:'e'+i,epoch:1,version:i+1}));
 const checkpoint=rotateEpoch(server);assert.equal(applyOperation(checkpoint,{...op(),epoch:2},yes,0).receipt.reason,'capacity');
});
test('client model works without Node globals and enforces UTF-8 byte limits',()=>{
 const original=globalThis.Buffer;
 try{(globalThis as any).Buffer=undefined;
 const pending=enqueue(createReplica(createServer()),op());assert.equal(optimistic(pending).data.count,1);
 assert.throws(()=>enqueue(createReplica(createServer()),{...op(),value:'🙂'.repeat(20000)}),/invalid/);
 }finally{globalThis.Buffer=original;}
});
