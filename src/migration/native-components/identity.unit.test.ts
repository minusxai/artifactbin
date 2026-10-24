import test from 'node:test';
import assert from 'node:assert/strict';
import { bindNativeIdentities, resolveNativeIdentityComment } from './identity.ts';
import { nativeDigest } from './selection.ts';
import type { NativeGraphAnalysis } from './contracts.ts';
import type { NativeTypedAnalysis } from './analyze-contracts.ts';
function revision(version: number, keys = ['a','b']) {
 const graph: NativeGraphAnalysis = {key:{sourceNamespace:'synthetic',sourceId:'page',version},documentSha256:'doc',sourceSha256:'source',source:'same'.repeat(keys.length),identities:[{sourceNode:'$root',parent:null,children:keys,astSha256:'ast',nodeSha256:'root',sourceStart:0,sourceEnd:keys.length*4},...keys.map((key,i)=>({sourceNode:key,parent:'$root',children:[],astSha256:'ast',nodeSha256:key,sourceStart:i*4,sourceEnd:i*4+4}))],claimedIds:{},components:{},recovery:{kind:'exact',repairedNodes:0}};
 const typed: NativeTypedAnalysis = {key:graph.key,documentSha256:'doc',sourceSha256:'source',analysisSha256:nativeDigest(graph),compilerSourceSha256:'compiler',nodes:keys.map(key=>({type:'text',value:'same',graphKey:key,start:0,end:4})),flow:{imports:[],values:[],queries:[],mutations:[]},sourceSpans:graph.identities.map(n=>({sourceNode:n.sourceNode,sourceStart:n.sourceStart,sourceEnd:n.sourceEnd}))};
 return {graph,typed};
}
test('repeated text binds by graph identity and survives moves across saved versions',()=>{
 const [first,next]=bindNativeIdentities([revision(1),revision(2,['b','a'])]);
 assert.notEqual(first!.bindings[0]!.afId,first!.bindings[1]!.afId);
 assert.equal(first!.bindings[0]!.afId,next!.bindings[1]!.afId);
 assert.equal(resolveNativeIdentityComment([first!,next!],{key:first!.key,target:{kind:'graph',value:'a'}}).afId,first!.bindings[0]!.afId);
 assert.throws(()=>resolveNativeIdentityComment([first!],{key:next!.key,target:{kind:'graph',value:'a'}}),/version/);
});
test('deleted identities remain reserved and cannot be reintroduced',()=>{
 const results=bindNativeIdentities([revision(1),revision(2,['b'])]);
 assert.equal(results[1]!.reservedIdentities.length,2);
 assert.throws(()=>bindNativeIdentities([revision(1),revision(2,['b']),revision(3)]),/reintroduced/);
});
test('rejects forged spans, duplicate graph owners and annotation collisions',()=>{
 const bad=revision(1);bad.typed.sourceSpans[1]!.sourceStart=1;
 assert.throws(()=>bindNativeIdentities([bad]),/span/);
 const duplicate=revision(1);duplicate.typed.nodes[1]!.graphKey='a';
 assert.throws(()=>bindNativeIdentities([duplicate]),/mapping/);
 const collision=revision(1);collision.typed.nodes=collision.typed.nodes.map(n=>({...n,type:'element',tag:'div',isComponent:false,selfClosing:true,children:[],attributes:[{name:'data-af-id',start:0,end:0,value:{static:true,json:'same'}}]}));
 assert.throws(()=>bindNativeIdentities([collision]),/collision/);
});
test('authored DOM ids are a distinct exact namespace and ambiguous comments fail closed',()=>{
 const input=revision(1);
 input.typed.nodes=input.typed.nodes.map(n=>({...n,type:'element',tag:'div',isComponent:false,selfClosing:true,children:[],attributes:[{name:'id',start:0,end:0,value:{static:true,json:'same'}}]}));
 const results=bindNativeIdentities([input]);
 assert.throws(()=>resolveNativeIdentityComment(results,{key:input.graph.key,target:{kind:'dom',value:'same'}}),/target/);
 assert.throws(()=>resolveNativeIdentityComment(results,{key:input.graph.key,target:{kind:'graph',value:'same'}}),/target/);
 input.typed.nodes[1]!.type==='element'&&(input.typed.nodes[1]!.attributes[0]!.value={static:true,json:'distinct'});
 const exact=bindNativeIdentities([input]);
 assert.equal(resolveNativeIdentityComment(exact,{key:input.graph.key,target:{kind:'dom',value:'distinct'}}).sourceNode,'b');
});
test('control and loop owners receive explicit templates without runtime instance guesses',()=>{
 const input=revision(1);
 input.typed.nodes=input.typed.nodes.map((n,i)=>({...n,type:'element',tag:i?'For':'div',control:i?undefined:{when:'value'},isComponent:!!i,selfClosing:true,children:[],attributes:[]}));
 const [result]=bindNativeIdentities([input]);
 assert.deepEqual(result!.bindings.map(b=>[b.kind,b.owner]),[['condition','a'],['loop','b']]);
});
