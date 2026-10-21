import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from './session.ts';
test('history requires exact revision, never falls back to newest source', () => {
  const session = createSession({ count: 7 }, new Map([['new', '<h1>New</h1>']]), () => '', () => {});
  assert.throws(() => session.enter({sourceRevision:'old',snapshot:{count:2}}), /Missing historical source: old/);
  assert.equal(session.mode, 'live'); assert.equal(session.epoch,0);
});
test('all live publication suspended, old async work rejected after resume, own state retained', () => {
  const published: unknown[]=[];
  const input={count:7};
  const s=createSession(input,new Map([['old','<h1>Old</h1>']]),source=>source,m=>published.push(m));
  input.count=99;
  const old=s.epoch;
  assert.equal(s.publish({epoch:old,kind:'state',value:{count:8}}),true);
  const snapshot={count:2}; const doc=s.enter({sourceRevision:'old',snapshot});snapshot.count=99;
  assert.deepEqual(doc.snapshot,{count:2});assert.equal(doc.html,'<h1>Old</h1>');
  for(const kind of ['state','presence','comment','edit'] as const) assert.equal(s.publish({epoch:s.epoch,kind,value:{count:42}}),false);
  assert.equal(s.publish({epoch:old,kind:'state',value:3}),false);
  const restored=s.leave();assert.deepEqual(restored,{count:8});
  assert.equal(s.publish({epoch:old,kind:'edit',value:3}),false);
  assert.equal(s.publish({epoch:s.epoch,kind:'presence',value:3}),true);
  assert.equal(published.length,2);assert.deepEqual(s.ownState,{count:8});
});
test('assembly failure is atomic',()=>{
  const s=createSession(7,new Map([['old','bad']]),()=>{throw Error('invalid')},()=>{});
  assert.throws(()=>s.enter({sourceRevision:'old',snapshot:2}),/invalid/);assert.equal(s.mode,'live');assert.equal(s.epoch,0);assert.equal(s.ownState,7);
});
test('captured DOM is sanitized via same assembler while source revision remains mandatory',()=>{
 const seen:string[]=[];const s=createSession(7,new Map([['old','source']]),html=>{seen.push(html);return 'safe'},()=>{});
 const result=s.enter({sourceRevision:'old',snapshot:2,renderedHtml:'rendered count 2'});
 assert.equal(result.html,'safe');assert.equal(result.fidelity,'captured-dom');assert.deepEqual(seen,['rendered count 2']);
 assert.throws(()=>s.enter({sourceRevision:'missing',snapshot:2,renderedHtml:'rendered'}),/Missing historical source/);
});
test('returned mutable state cannot change session own state',()=>{
 const s=createSession({count:7},new Map(),x=>x,()=>{});
 (s.ownState as {count:number}).count=99;
 assert.deepEqual(s.ownState,{count:7});
 (s.leave() as {count:number}).count=101;assert.deepEqual(s.ownState,{count:7});
});
