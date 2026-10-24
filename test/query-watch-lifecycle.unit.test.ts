import test from "node:test";
import assert from "node:assert/strict";
import { createQueryWatch } from "../src/apollo/watch-query.ts";
import { createLocalStore } from "../src/apollo/client.ts";

function fixture() {
  const store = createLocalStore({ filter: "initial" });
  let acquired = 0,
    released = 0,
    stateStops = 0,
    remoteStops = 0;
  const listeners = new Set<() => void>();
  const watch = createQueryWatch<{ filter: string; shared: unknown }>({
    state: {
      ...store,
      subscribe(listener) {
        const stop = store.subscribe(listener);
        return () => {
          stateStops++;
          stop();
        };
      },
    },
    signature: (document) => String(document.filter),
    local: (document) => ({ filter: document.filter! }),
    empty: { shared: null },
    remote: {
      acquire() {
        acquired++;
        return () => {
          released++;
        };
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          remoteStops++;
          listeners.delete(listener);
        };
      },
      fetch: async () => ({ data: { shared: { count: 1 } } }),
    },
  });
  return {
    store,
    watch,
    listeners,
    counts: () => ({ acquired, released, stateStops, remoteStops }),
  };
}

test("local publication failure closes mixed watch once without interrupting other observers", async () => {
  const f = fixture();
  const failed = f.watch.subscribe((result) => {
    if (result.data.filter === "changed") throw Error("observer failed");
  });
  const observed: unknown[] = [];
  const other = f.watch.subscribe((result) =>
    observed.push(result.data.filter),
  );
  await Promise.resolve();
  await f.store.write({
    expected: { filter: "initial" },
    next: { filter: "changed" },
  });
  assert.equal(observed.at(-1), "changed");
  assert.deepEqual(f.counts(), {
    acquired: 2,
    released: 1,
    stateStops: 1,
    remoteStops: 1,
  });
  assert.equal(f.listeners.size, 1);
  failed.unsubscribe();
  assert.equal(f.counts().released, 1);
  other.unsubscribe();
  assert.deepEqual(f.counts(), {
    acquired: 2,
    released: 2,
    stateStops: 2,
    remoteStops: 2,
  });
});

test("initial observer failure propagates after draining both subscriptions and budget", () => {
  const f = fixture();
  assert.throws(
    () =>
      f.watch.subscribe(() => {
        throw Error("initial failed");
      }),
    /initial failed/,
  );
  assert.deepEqual(f.counts(), {
    acquired: 1,
    released: 1,
    stateStops: 1,
    remoteStops: 1,
  });
  assert.equal(f.listeners.size, 0);
});

test('opt-in refresh clears sensitive remote identity synchronously and suppresses obsolete receipts',async()=>{
 const state=createLocalStore({});let notify=()=>{};const jobs:Array<(value:any)=>void>=[];const seen:any[]=[];
 const watch=createQueryWatch<{backend:unknown}>({state,signature:()=>'',local:()=>({}),empty:{backend:null},clearOnRefresh:true,remote:{acquire:()=>()=>{},subscribe:f=>{notify=f;return()=>{};},fetch:()=>new Promise(resolve=>jobs.push(resolve))}});
 const sub=watch.subscribe(result=>seen.push(result.data.backend));
 jobs.shift()!({data:{backend:{id:'first'}}});for(let i=0;i<5;i++)await Promise.resolve();assert.deepEqual(seen.at(-1),{id:'first'});
 notify();assert.equal(seen.at(-1),null);notify();assert.equal(seen.at(-1),null);
 jobs.shift()!({data:{backend:{id:'obsolete'}}});for(let i=0;i<5;i++)await Promise.resolve();assert.equal(seen.at(-1),null);
 jobs.shift()!({data:{backend:{id:null}}});for(let i=0;i<5;i++)await Promise.resolve();assert.deepEqual(seen.at(-1),{id:null});
 sub.unsubscribe();notify();assert.deepEqual(seen.at(-1),{id:null});
});

test('opt-in refresh failures retain empty identity and disposed requests cannot publish',async()=>{
 const state=createLocalStore({});let notify=()=>{};let resolve!:(value:any)=>void;let reject!:(error:Error)=>void;const seen:any[]=[];
 const watch=createQueryWatch<{backend:unknown}>({state,signature:()=>'',local:()=>({}),empty:{backend:null},clearOnRefresh:true,remote:{acquire:()=>()=>{},subscribe:f=>{notify=f;return()=>{};},fetch:()=>new Promise((a,b)=>{resolve=a;reject=b;})}});
 const sub=watch.subscribe(result=>seen.push(result));reject(Error('revoked'));for(let i=0;i<5;i++)await Promise.resolve();assert.equal(seen.at(-1).data.backend,null);assert.equal(seen.at(-1).errors.length,1);
 notify();assert.equal(seen.at(-1).data.backend,null);assert.equal(seen.at(-1).errors,undefined);const count=seen.length;sub.unsubscribe();resolve({data:{backend:{id:'late'}}});for(let i=0;i<5;i++)await Promise.resolve();assert.equal(seen.length,count);
});
test('clearOnRefresh has no effect on local-only query publications',async()=>{
 const state=createLocalStore({count:1});const seen:any[]=[];const sub=createQueryWatch({state,clearOnRefresh:true,signature:d=>String(d.count),local:d=>d,empty:{}}).subscribe(r=>seen.push(r.data));await state.write({expected:{count:1},next:{count:2}});assert.deepEqual(seen,[{count:1},{count:2}]);sub.unsubscribe();
});

test('backend watch explicitly separates pending clear, unavailable answer and error through coalesced refetch and disposal',async()=>{
 const state=createLocalStore({});let notify=()=>{};const jobs:Array<{resolve:(v:any)=>void;reject:(e:Error)=>void}>=[],seen:any[]=[];
 const watch=createQueryWatch({state,signature:()=>'',local:()=>({}),empty:{backend:null},clearOnRefresh:true,remote:{acquire:()=>()=>{},subscribe:f=>{notify=f;return()=>{};},fetch:()=>new Promise((resolve,reject)=>jobs.push({resolve,reject}))}});
 const tick=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
 const sub=watch.subscribe(r=>seen.push(r));assert.equal(seen.at(-1).loading,true);
 jobs.shift()!.resolve({data:{backend:{value:1}}});await tick();assert.equal(seen.at(-1).loading,false);
 notify();assert.deepEqual(seen.at(-1),{data:{backend:null},loading:true});notify();
 jobs.shift()!.resolve({data:{backend:{value:'obsolete'}}});await tick();assert.deepEqual(seen.at(-1),{data:{backend:null},loading:true});
 jobs.shift()!.resolve({data:{backend:null}});await tick();assert.deepEqual(seen.at(-1),{data:{backend:null},loading:false});
 notify();jobs.shift()!.reject(Error('revoked'));await tick();assert.equal(seen.at(-1).loading,false);assert.equal(seen.at(-1).data.backend,null);assert.deepEqual(seen.at(-1).errors,[{message:'revoked'}]);
 notify();const count=seen.length;sub.unsubscribe();jobs.shift()!.resolve({data:{backend:{value:'late'}}});await tick();assert.equal(seen.length,count);
});
test('default backend watch announces pending while retaining its prior snapshot',async()=>{
 const state=createLocalStore({});let notify=()=>{};const jobs:Array<(v:any)=>void>=[],seen:any[]=[];
 const watch=createQueryWatch({state,signature:()=>'',local:()=>({}),empty:{backend:null},remote:{acquire:()=>()=>{},subscribe:f=>{notify=f;return()=>{};},fetch:()=>new Promise(resolve=>jobs.push(resolve))}});
 const sub=watch.subscribe(r=>seen.push(r));assert.equal(seen[0].loading,true);
 jobs.shift()!({data:{backend:7}});for(let i=0;i<5;i++)await Promise.resolve();assert.equal(seen.at(-1).loading,false);
 notify();assert.deepEqual(seen.at(-1),{data:{backend:7},loading:true});sub.unsubscribe();
});
