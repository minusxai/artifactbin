import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {adaptNativeDomReactiveSource,NATIVE_DOM_REACTIVE_RUNTIME,NATIVE_DOM_REACTIVE_APOLLO} from './dom-reactive-author.ts';

const source=`import {createSignal,createEffect,onMount,onCleanup} from 'solid-js';const [read,set]=createSignal({screen:'cart'},{name:'checkout'});const button=document.getElementById('next');button.addEventListener('click',()=>set(previous=>({...previous,screen:'payment'})));createEffect(()=>{document.title=read().screen;});onMount(()=>onCleanup(()=>document.title='closed'));`;
test('adapts only named module-level reactive bindings and ordinary DOM, retaining authored source operations',()=>{
 const result=adaptNativeDomReactiveSource(source,'port');assert.deepEqual(result.namedSignals,['checkout']);assert.equal(result.signalCount,1);assert.match(result.source,/port.createSignal/);assert.match(result.source,/port.listen\(button,/);assert.doesNotMatch(result.source,/solid-js/);
 for(const bad of [source.replace(",{name:'checkout'}",''),source.replace("'checkout'",'name'),source.replace("from 'solid-js'","from 'other'"),source+'fetch("/private")',source+'const escaped=createSignal;',source.replace('createEffect,','createMemo,'),source+'export {read};',source+'eval("x")',source.replace('createSignal({screen:', 'createSignal({screen:')+'function hidden(){return createSignal(0,{name:"hidden"});}'])assert.throws(()=>adaptNativeDomReactiveSource(bad,'port'));
});
function harness(saved?:unknown){
 let data:any=saved===undefined?{}:{saved:{value:saved}},observer:any,active=true;const writes:any[]=[];
 const client={watchQuery:()=>({subscribe(fn:any){observer=fn;fn({data});return {unsubscribe(){active=false;}};}}),async updateQuery(_options:any,fn:any){data=fn(data);writes.push(structuredClone(data));observer({data});}};
 const state=vm.runInNewContext(`(${NATIVE_DOM_REACTIVE_APOLLO})`)(client,(parts:any)=>parts[0],{named:[{name:'checkout',field:'saved'}]});
 const runtime=vm.runInNewContext(`(${NATIVE_DOM_REACTIVE_RUNTIME})`)(state);
 return {runtime,writes,restore(value:unknown){data={saved:{value}};observer({data});},snapshot:()=>structuredClone(data),active:()=>active};
}
test('named JSON signal hydrates/restores Apollo snapshots, applies updater synchronously and tracks equality',async()=>{
 const h=harness({screen:'declined'});let read:any,set:any;const seen:string[]=[];
 h.runtime.run(()=>{[read,set]=h.runtime.createSignal({screen:'cart'},{name:'checkout'});h.runtime.createEffect(()=>seen.push(read().screen));assert.deepEqual(seen,[]);});
 assert.deepEqual(seen,['declined']);const same=read();assert.equal(set(same),same);assert.equal(seen.length,1);set((previous:any)=>({...previous,screen:'payment'}));assert.equal(read().screen,'payment');assert.deepEqual(seen,['declined','payment']);await new Promise(resolve=>setImmediate(resolve));assert.equal(h.snapshot().saved.value.screen,'payment');
 h.restore({screen:'done'});assert.deepEqual(seen,['declined','payment','done']);const reopened=harness(h.snapshot().saved.value);let restored:any;reopened.runtime.run(()=>{[restored]=reopened.runtime.createSignal({screen:'cart'},{name:'checkout'});});assert.equal(restored().screen,'done');h.runtime.dispose();assert.equal(h.active(),false);
});
test('lifecycle callbacks preserve deferred effect/mount order and remove listeners/cleanups exactly once',()=>{
 const h=harness(),button=new EventTarget(),order:string[]=[];let clicks=0;
 h.runtime.run(()=>{order.push('body');h.runtime.createEffect(()=>order.push('effect'));h.runtime.onMount(()=>{order.push('mount');h.runtime.onCleanup(()=>order.push('cleanup'));});h.runtime.listen(button,'click',()=>clicks++);order.push('end');});
 assert.deepEqual(order,['body','end','effect','mount']);button.dispatchEvent(new Event('click'));assert.equal(clicks,1);h.runtime.dispose();h.runtime.dispose();button.dispatchEvent(new Event('click'));assert.equal(clicks,1);assert.deepEqual(order,['body','end','effect','mount','cleanup']);
});
test('effect cleanup precedes rerun and unnamed viewer state is refused before any persistence',()=>{
 const h=harness();let set:any;const order:string[]=[];
 h.runtime.run(()=>{const [read,write]=h.runtime.createSignal(0,{name:'checkout'});set=write;h.runtime.createEffect(()=>{const value=read();order.push('run'+value);h.runtime.onCleanup(()=>order.push('clean'+value));});});set(1);assert.deepEqual(order,['run0','clean0','run1']);h.runtime.dispose();assert.deepEqual(order,['run0','clean0','run1','clean1']);
 const unnamed=harness();assert.throws(()=>unnamed.runtime.run(()=>unnamed.runtime.createSignal({screen:'cart'})),/named/);assert.equal(unnamed.writes.length,0);
});

test('named state uses the real Apollo JSON contract, survives snapshot reopen and stays isolated per viewer',async()=>{
 const {createClient,createLocalStore,gql}=await import('../../apollo/client.ts');const state=createLocalStore(),client=createClient({state,backends:[]});
 const install=vm.runInThisContext(`(${NATIVE_DOM_REACTIVE_APOLLO})`),make=vm.runInThisContext(`(${NATIVE_DOM_REACTIVE_RUNTIME})`);
 const runtime=make(install(client,gql,{named:[{name:'checkout',field:'saved'}]}));let set:any,read:any;
 runtime.run(()=>{[read,set]=runtime.createSignal({screen:'cart',declineNext:true},{name:'checkout'});});set((before:any)=>({...before,screen:'payment'}));set((before:any)=>({...before,declineNext:false}));
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(state.read(),{saved:{value:{screen:'payment',declineNext:false}}});assert.equal(read().screen,'payment');runtime.dispose();
 const snapshot=JSON.parse(JSON.stringify(state.read())),reopenedClient=createClient({state:createLocalStore(snapshot),backends:[]}),reopened=make(install(reopenedClient,gql,{named:[{name:'checkout',field:'saved'}]}));let reopenedRead:any;reopened.run(()=>{[reopenedRead]=reopened.createSignal({screen:'cart',declineNext:true},{name:'checkout'});});assert.equal(reopenedRead().screen,'payment');
 const otherState=createLocalStore(),otherClient=createClient({state:otherState,backends:[]}),other=make(install(otherClient,gql,{named:[{name:'checkout',field:'saved'}]}));let otherRead:any;other.run(()=>{[otherRead]=other.createSignal({screen:'cart',declineNext:true},{name:'checkout'});});assert.equal(otherRead().screen,'cart');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(Object.keys(otherState.read()),['saved']);reopened.dispose();other.dispose();client.dispose();reopenedClient.dispose();otherClient.dispose();
});

test('partial mount failure cleans owned subscriptions/listeners and does not suppress the original error',()=>{
 const h=harness(),host=new EventTarget();let calls=0;const original=new Error('authored mount');assert.throws(()=>h.runtime.run(()=>{h.runtime.createSignal(0,{name:'checkout'});h.runtime.listen(host,'click',()=>calls++);h.runtime.onCleanup(()=>calls++);throw original;}),error=>error===original);host.dispatchEvent(new Event('click'));assert.equal(calls,1);assert.equal(h.active(),false);
});
test('equality controls and rapid updates retain final named value without restoring an older pending write',async()=>{
 const h=harness();let set:any,read:any,runs=0;h.runtime.run(()=>{[read,set]=h.runtime.createSignal(0,{name:'checkout',equals:false});h.runtime.createEffect(()=>{read();runs++;});});set(0);set((value:number)=>value+1);set((value:number)=>value+1);assert.equal(read(),2);assert.equal(runs,4);await new Promise(resolve=>setImmediate(resolve));assert.equal(h.snapshot().saved.value,2);
});
test('unreviewed or page-bound programs never acquire DOM reactive admission',async()=>{
 const {selectNativeDomReactiveProfiles,admitNativeDomReactiveProfile}=await import('./dom-reactive-author-profile.ts');const node:any={type:'element',tag:'script',attributes:[],children:[{type:'text',value:source}],graphKey:'script'};const analysis:any={key:{sourceNamespace:'synthetic',sourceId:'page',version:1},nodes:[node],flow:{imports:[],values:[],queries:[],mutations:[]}};assert.deepEqual(selectNativeDomReactiveProfiles(analysis),[]);assert.throws(()=>admitNativeDomReactiveProfile(analysis,node,'f'.repeat(64)),/Unreviewed/);
});
