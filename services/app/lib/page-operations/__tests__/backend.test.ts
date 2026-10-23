import {it,expect} from 'vitest';
import type {RunStart} from '@artifactbin/contracts';
import {pageBackendCapability} from '../backend';
const record={backendId:'backend1',pageId:'page1',version:'v1',source:'source',compiled:'immutable bundle',typeDefs:'type Query { x:Int }',ownerId:'owner1'};
const request:RunStart={requestId:'r1',pageBackendOperation:'mutation',userId:'owner1',artifactId:'backend1',artifactVersion:'v1',program:{source:'immutable bundle',language:'javascript'},input:{kind:'invoke',principal:{tenant:'page1',subject:null}}};
it('refuses forged admitted code before accessing a backend store',async()=>{
 let reads=0;const store={get:async()=>{reads++;return {value:null,version:0};},set:async()=>({ok:true,version:1})};
 await expect(pageBackendCapability(store,{...request,program:{source:'forged',language:'javascript'}},'artifactbin.pageBackend.store.get',{},async()=>record)).rejects.toThrow('backend_capability_forbidden');expect(reads).toBe(0);
});
it('uses the admitted immutable backend identity and preserves CAS conflicts',async()=>{
 const calls:unknown[]=[];const store={get:async()=>({value:null,version:0}),set:async(...args:unknown[])=>{calls.push(args);return {ok:false,version:4};}};
 expect(await pageBackendCapability(store,request,'artifactbin.pageBackend.store.set',{value:{n:1},expected:2,backendId:'other'},async()=>record)).toEqual({ok:false,version:4});expect(calls).toEqual([['backend1',{n:1},2,{pageId:record.pageId,version:record.version,ownerId:record.ownerId}]]);
});
it('admits only the pinned backend declaration before reading owner credentials',async()=>{
 const calls:unknown[]=[];const store={get:async()=>({value:null,version:0}),set:async()=>({ok:true,version:1})},backend={...record,secretBindings:['TOKEN']};
 const read=async(b:typeof record,name:string)=>{calls.push([b.ownerId,b.backendId,name]);return 'private-value';};
 expect(await pageBackendCapability(store,request,'artifactbin.pageBackend.secrets.get',{name:'TOKEN',ownerId:'other'},async()=>backend,undefined,read)).toBe('private-value');
 await expect(pageBackendCapability(store,request,'artifactbin.pageBackend.secrets.get',{name:'OTHER'},async()=>backend,undefined,read)).rejects.toThrow('forbidden');
 await expect(pageBackendCapability(store,{...request,userId:'other'},'artifactbin.pageBackend.secrets.get',{name:'TOKEN'},async()=>backend,undefined,read)).rejects.toThrow('forbidden');
 expect(calls).toEqual([['owner1','backend1','TOKEN']]);
});

it('denies query and missing operation authority even when arguments claim mutation',async()=>{
 let writes=0;const store={get:async()=>({value:null,version:0}),set:async()=>{writes++;return {ok:true,version:1};}};
 for(const pageBackendOperation of ['query',undefined] as const)await expect(pageBackendCapability(store,{...request,pageBackendOperation},'artifactbin.pageBackend.store.set',{value:1,expected:0,pageBackendOperation:'mutation'},async()=>record)).rejects.toThrow('backend_capability_forbidden');
 expect(writes).toBe(0);
});
