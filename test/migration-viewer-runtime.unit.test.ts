import{test}from'node:test';import assert from'node:assert/strict';import{createCompiledViewer}from'../src/migration/conversion/compiled/viewer-runtime.ts';
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test('viewer gates before clear and reveals only authoritative applied guest/user receipts',async()=>{
 let next!:(v:unknown)=>void;const events:string[]=[];const adapter=createCompiledViewer({watch:f=>{next=f;return()=>{};},gate:s=>events.push(s),clear:()=>events.push('clear'),apply:async s=>{events.push(s.id===null?'guest':'user');}});
 assert.deepEqual(events,['pending','clear']);next({generation:'a'.repeat(64),id:'original'});await tick();assert.deepEqual(events.slice(-4),['pending','clear','user','ready']);
 next(undefined);assert.deepEqual(events.slice(-2),['pending','clear']);next(null);assert.deepEqual(events.slice(-2),['unavailable','clear']);assert.equal(events.at(-1),'clear');
 next({generation:'b'.repeat(64),id:null});await tick();assert.deepEqual(events.slice(-4),['pending','clear','guest','ready']);adapter.dispose();
});
test('revocation cancels an applying identity without revealing a stale or fallback guest branch',async()=>{
 let next!:(v:unknown)=>void;let complete!:()=>void;let applying:AbortSignal|undefined;const gates:string[]=[];let applies=0;
 const adapter=createCompiledViewer({watch:f=>{next=f;return()=>{};},gate:s=>gates.push(s),clear:()=>{},apply:async(_s,signal)=>{applies++;applying=signal;await new Promise<void>(r=>complete=r);}});
 next({generation:'a'.repeat(64),id:'original'});await tick();next(null);assert.equal(applying?.aborted,true);complete();await tick();assert.equal(gates.at(-1),'unavailable');assert.equal(gates.includes('ready'),false);
 for(const value of [{id:null,generation:'bad'},{id:'',generation:'a'.repeat(64)},{id:'reader',generation:'a'.repeat(64),email:'private'}])next(value);assert.equal(applies,1);
 adapter.dispose();next({generation:'b'.repeat(64),id:null});await tick();assert.equal(applies,1);
});
test('new receipt supersedes blocked prior apply and failed queries never reveal content',async()=>{
 let next!:(v:unknown)=>void;let finish!:()=>void;const gates:string[]=[];let calls=0;
 const adapter=createCompiledViewer({watch:f=>{next=f;return()=>{};},clear:()=>{},gate:s=>gates.push(s),apply:async(s)=>{calls++;if(s.id==='first')await new Promise<void>(r=>finish=r);else throw Error('query unavailable');}});
 next({generation:'a'.repeat(64),id:'first'});await tick();next({generation:'b'.repeat(64),id:null});await tick();finish();await tick();assert.equal(calls,2);assert.equal(gates.at(-1),'unavailable');assert.equal(gates.includes('ready'),false);adapter.dispose();
});
test('blocked query application retains one replacement rather than unbounded receipt jobs',async()=>{
 let next!:(v:unknown)=>void;let finish!:()=>void;let calls=0;const gate:string[]=[];
 const adapter=createCompiledViewer({watch:f=>{next=f;return()=>{};},clear:()=>{},gate:s=>gate.push(s),apply:async()=>{calls++;if(calls===1)await new Promise<void>(r=>finish=r);}});
 next({generation:'a'.repeat(64),id:'first'});await tick();for(let i=0;i<250;i++)next({generation:'b'.repeat(64),id:'replacement'});await tick();assert.equal(calls,1);finish();await tick();assert.equal(calls,2);assert.equal(gate.at(-1),'ready');adapter.dispose();
});
