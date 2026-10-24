import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeDigest} from './selection.ts';
import {adaptNativeAuthorProgram,verifyNativeAuthorProgram,NATIVE_BOOKSHELF_STATE_RUNTIME} from './author-programs.ts';
import {createHash} from 'node:crypto';
import type {NativeTypedAnalysis,RetainedJsxNode} from './analyze-contracts.ts';
import type {NativeAuthorProgramInput} from './author-program-contracts.ts';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function fixture(script='(()=>{const books=[{id:"1",title:"Alpha",author:"Writer",status:"read",rating:5,group:"one"}];})();'):NativeAuthorProgramInput{
 const node:RetainedJsxNode={type:'element',tag:'script',isComponent:false,selfClosing:false,graphKey:'script',start:0,end:1,attributes:[],children:[{type:'expression',graphKey:'script-body',start:0,end:1,source:script,value:{static:true,json:script}}]};
 const analysis:NativeTypedAnalysis={key:{sourceNamespace:'synthetic',sourceId:'local',version:1},documentSha256:'a'.repeat(64),sourceSha256:'b'.repeat(64),analysisSha256:'c'.repeat(64),compilerSourceSha256:'d'.repeat(64),nodes:[node],flow:{imports:[],queries:[],mutations:[],values:['search','filter','surprise','empty','visible_1','open_1','group_one'].map(name=>({name,type:name==='search'||name==='filter'?'string':'boolean',default:name==='search'?'':name==='filter'?'all':false,start:0,end:1}))},sourceSpans:[]};
 const identity={key:analysis.key,bindings:['script','script-body'].map((sourceNode,index)=>({sourceNode,sourceStart:0,sourceEnd:1,sourceSha256:analysis.sourceSha256,analysisSha256:analysis.analysisSha256,proofSha256:'e'.repeat(64),afId:`af-${index}`,kind:index?'expression' as const:'element' as const,owner:'root'})),reservedIdentities:[],proofSha256:'f'.repeat(64)};
 return {analysis,identity,admission:{key:analysis.key,sourceSha256:analysis.sourceSha256,analysisSha256:analysis.analysisSha256,compilerSourceSha256:analysis.compilerSourceSha256,sourceNode:'script',nodeSha256:nativeDigest(node),scriptSha256:hash(script),profile:'bookshelf-local-state',filter:'search-and-status'}};
}
test('source-bound state adaptation emits Apollo and rejects any changed source or output',()=>{
 const input=fixture(),receipt=adaptNativeAuthorProgram(input);assert.match(receipt.authorJs,/@afbin\/apollo/);assert.doesNotMatch(receipt.authorJs,/solid-js|from ['"]page|mx\.params|eval\(/);assert.equal(verifyNativeAuthorProgram({analysis:input.analysis,node:input.analysis.nodes[0]!,receipt}),true);
 assert.equal(verifyNativeAuthorProgram({analysis:input.analysis,node:input.analysis.nodes[0]!,receipt:{...receipt,authorJs:receipt.authorJs+'changed'}}),false);
 const changed=structuredClone(input);changed.analysis.sourceSha256='f'.repeat(64);assert.throws(()=>adaptNativeAuthorProgram(changed),/association/);
 const spoof=fixture('(()=>{const books=fetch("private");})();');assert.throws(()=>adaptNativeAuthorProgram(spoof),/literal/);
});
function stateHarness(){let state:any={search:'',filter:'all',surprise:false,empty:false,visible_1:true,visible_2:true,group_one:true,group_two:true,open_1:false,open_2:false},watch:any,stopped=false,randomCalls=0;const writes:any[]=[];
 const client={watchQuery:()=>({subscribe:(next:any)=>{watch=next;next({data:{...state}});return {unsubscribe:()=>{stopped=true;}};}}),updateQuery:async(_query:any,update:any)=>{const next=update(state);if(next!==state){state=next;writes.push({...state});watch({data:{...state}});}return state;}};
 const installBookshelfState=vm.runInNewContext(`(${NATIVE_BOOKSHELF_STATE_RUNTIME})`);
 const dispose=installBookshelfState(client,(strings:any)=>strings[0],{fields:Object.keys(state),filter:'search-and-status',groups:['one','two'],books:[{id:'1',title:'Alpha',author:'First',status:'read',rating:5,group:'one'},{id:'2',title:'Beta',author:'Second',status:'to-read',rating:0,group:'two'}]},()=>{randomCalls++;return 0;});
 return {set:async(patch:any)=>{state={...state,...patch};watch({data:{...state}});await new Promise(r=>setImmediate(r));},state:()=>state,writes,dispose,stopped:()=>stopped,randomCalls:()=>randomCalls};
}
test('Apollo local state preserves search/status/groups/empty and surprise selection without recursive writes',async()=>{
 const h=stateHarness();await h.set({search:'Second'});assert.equal(h.state().visible_1,false);assert.equal(h.state().visible_2,true);assert.equal(h.state().group_one,false);await h.set({filter:'favorites'});assert.equal(h.state().empty,true);await h.set({search:'',filter:'read',surprise:true});assert.equal(h.state().surprise,false);assert.equal(h.state().open_1,true);assert.equal(h.state().open_2,false);assert.equal(h.randomCalls(),1);assert.ok(h.writes.length<8);h.dispose();assert.equal(h.stopped(),true);const before=h.writes.length;await h.set({search:'absent'});assert.equal(h.writes.length,before);
});
test('ordinary DOM scripts retain exact code and never gain injected state globals',()=>{const input=fixture('(()=>{document.getElementById("search").addEventListener("input",()=>{});})();');input.admission.profile='ordinary-dom-script';const receipt=adaptNativeAuthorProgram(input);assert.match(receipt.authorJs,/document.getElementById/);assert.equal(receipt.identities.length,2);assert.match(receipt.html,/data-af-id="af-0"/);});

test('ordinary srcdoc preserves isolated HTML, exact script, attributes and source identities',()=>{
 const input=fixture('(()=>{document.body.dataset.ready="yes";})();');const script=input.analysis.nodes[0]!;
 const frame:RetainedJsxNode={type:'element',tag:'Iframe',isComponent:true,selfClosing:false,graphKey:'frame',start:0,end:1,attributes:[{name:'title',value:{static:true,json:'Synthetic frame'},start:0,end:1},{name:'height',value:{static:true,json:760},start:0,end:1}],children:[script]};
 input.analysis.nodes=[frame];input.identity.bindings.push({...input.identity.bindings[0]!,sourceNode:'frame',afId:'af-frame'});input.admission={...input.admission,sourceNode:'frame',nodeSha256:nativeDigest(frame),profile:'ordinary-srcdoc'};
 const receipt=adaptNativeAuthorProgram(input);assert.match(receipt.html,/<iframe data-af-id="af-frame"/);assert.match(receipt.html,/height="760"/);assert.match(receipt.html,/sandbox="allow-scripts allow-popups"/);assert.match(receipt.html,/document.body.dataset.ready=/);assert.equal(receipt.identities.length,3);assert.equal(receipt.authorJs,'');
 assert.throws(()=>adaptNativeAuthorProgram({...input,admission:{...input.admission,scriptSha256:'0'.repeat(64)}}),/association/);
});
