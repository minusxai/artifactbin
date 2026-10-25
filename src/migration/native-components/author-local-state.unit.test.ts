import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {adaptNativeAuthorLocalSource,NATIVE_AUTHOR_LOCAL_RUNTIME} from './author-local-state.ts';
import type {NativeTypedAnalysis} from './analyze-contracts.ts';
import type {NativeAuthorLocalPort} from './author-local-state-contracts.ts';
const analysis=(type='string')=>({flow:{values:[{name:'selected',kind:'scalar',type,default:''}]}} as unknown as NativeTypedAnalysis);
const source="(()=>{const box=document.getElementById('chips');const read=()=>mx.params.get('selected')||'';box.onclick=()=>{mx.params.set('selected',read()+'x');};mx.params.subscribe(()=>{box.textContent=read();});})();";
const ticks=async()=>{for(let n=0;n<8;n++)await Promise.resolve();};
function harness(){
 let data={selected:'',other:17},listener:((r:unknown)=>void)|undefined,unsubscribed=0;
 const writes:Array<{fn:(d:typeof data)=>typeof data;resolve:()=>void;reject:(e:Error)=>void}>=[];
 const client={watchQuery:()=>({subscribe:(next:typeof listener)=>{listener=next;next?.({data});return{unsubscribe(){unsubscribed++;}};}}),updateQuery:(_q:unknown,fn:(d:typeof data)=>typeof data)=>new Promise<void>((resolve,reject)=>writes.push({fn,resolve,reject}))};
 const errors:string[]=[];
 const install=vm.runInNewContext('('+NATIVE_AUTHOR_LOCAL_RUNTIME+')') as (client:unknown,gql:unknown,plan:unknown,onError:(e:Error)=>void)=>NativeAuthorLocalPort;
 const port=install(client,(parts:string[])=>parts[0],{fields:[{name:'selected',type:'string',nullable:false,default:''}]},e=>errors.push(e.message));
 return {port,errors,writes,get data(){return data;},get unsubscribed(){return unsubscribed;},external(selected:string){data={...data,selected};listener?.({data});},finish(){const w=writes.shift()!;data=w.fn(data);listener?.({data});w.resolve();},fail(){writes.shift()!.reject(Error('storage failed'));}};
}
test('source adapter preserves ordinary DOM, scopes all local dependencies, rejects runtime/import/type escapes',()=>{
 const out=adaptNativeAuthorLocalSource(source,analysis(),'localPort');assert.equal(out.plan.fields[0]?.name,'selected');assert.ok(out.source.includes("localPort.get('selected')"));assert.ok(!out.source.includes('mx.params'));
 for(const bad of [source+';mx.params.other();',source+';mx.other();',source.replace("get('selected')","get(field)"),"import {signal} from 'page';"+source,source+';const legacy=mx;'])assert.throws(()=>adaptNativeAuthorLocalSource(bad,analysis(),'localPort'));
 assert.throws(()=>adaptNativeAuthorLocalSource(source,analysis('table'),'localPort'));
 assert.throws(()=>adaptNativeAuthorLocalSource(source,analysis(),'not-valid!'));
});
test('rapid local clicks read their own pending writes, commit in order and preserve unrelated fields',async()=>{
 const h=harness();h.port.set('selected','a');assert.equal(h.port.get('selected'),'a');h.port.set('selected',String(h.port.get('selected'))+'b');assert.equal(h.port.get('selected'),'ab');assert.equal(h.writes.length,1);
 h.finish();await ticks();assert.equal(h.port.get('selected'),'ab');h.finish();await ticks();assert.deepEqual({...h.data},{selected:'ab',other:17});
 h.external('outside');assert.equal(h.port.get('selected'),'outside');assert.throws(()=>h.port.set('selected',3));assert.throws(()=>h.port.set('other','x'));h.port.dispose();assert.equal(h.unsubscribed,1);
});
test('failed writes restore confirmed state, notify listeners independently, and disposal fences queued callbacks',async()=>{
 const h=harness();let calls=0;h.port.subscribe(()=>{throw Error('subscriber');});h.port.subscribe(()=>calls++);h.port.set('selected','draft');assert.ok(calls>0);h.fail();await ticks();assert.equal(h.port.get('selected'),'');assert.ok(h.errors.includes('storage failed'));
 h.port.set('selected','late');const before=calls;h.port.dispose();h.finish();await ticks();assert.equal(calls,before);assert.throws(()=>h.port.set('selected','after'));assert.equal(h.unsubscribed,1);
});
test('adapted delegated DOM chip behavior uses live local state without any injected page global',async()=>{
 const h=harness(),box={textContent:'',onclick:undefined as undefined|(()=>void)};const out=adaptNativeAuthorLocalSource(source,analysis(),'localPort');vm.runInNewContext(out.source,{localPort:h.port,document:{getElementById:()=>box}});box.onclick!();box.onclick!();assert.equal(box.textContent,'xx');h.finish();await ticks();h.finish();await ticks();h.external('external');assert.equal(box.textContent,'external');h.port.dispose();
});

test('literal page signal imports retain getters/setters and ordinary timer cleanup without Solid',async()=>{
 const script="import {signal as value} from 'page';const [read,write]=value('$selected');const sync=()=>write(read()+'x');sync();const timer=setInterval(sync,20000);addEventListener('pagehide',()=>clearInterval(timer));";
 const out=adaptNativeAuthorLocalSource(script,analysis(),'nativeLocal');assert.equal(out.runtime,'page-signal');assert.doesNotMatch(out.source,/from 'page'/);const h=harness();let timer:(()=>void)|undefined,hide:()=>void=()=>{};
 vm.runInNewContext(out.source,{nativeLocal:h.port,setInterval:(f:()=>void,ms:number)=>{assert.equal(ms,20000);timer=f;return 7;},clearInterval:(id:number)=>{assert.equal(id,7);timer=undefined;},addEventListener:(name:string,f:()=>void)=>{assert.equal(name,'pagehide');hide=f;}});assert.equal(h.port.get('selected'),'x');h.finish();await ticks();timer!();assert.equal(h.port.get('selected'),'xx');h.finish();await ticks();hide();assert.equal(timer,undefined);h.port.dispose();
 for(const bad of ["import {signal} from 'page';const escaped=signal;", "import {signal} from 'page';const x=signal('$selected');", "import {signal,query} from 'page';const [x,y]=signal('$selected');"] )assert.throws(()=>adaptNativeAuthorLocalSource(bad,analysis(),'nativeLocal'));
});
