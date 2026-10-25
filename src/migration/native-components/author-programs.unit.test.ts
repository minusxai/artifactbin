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

test('source-bound read-only query script uses native observer state and cleans its DOM listener',()=>{
 const script=`import {signal,query} from 'page';import {createEffect} from 'solid-js';const [days]=signal('$days');const rows=query('$rows');const button=document.querySelector('#button');const status=document.querySelector('#status');const update=()=>{status.textContent=String(days())+':'+rows().length+':'+rows.loading()+':'+rows.error();};createEffect(update);button.addEventListener('click',update);`;
 const input=fixture(script);input.analysis.flow.values=[{name:'days',type:'number',default:7,start:0,end:1}];input.analysis.flow.queries=[{name:'rows',start:0,end:1}];input.admission.profile='native-query-observer';
 const receipt=adaptNativeAuthorProgram(input);assert.equal(verifyNativeAuthorProgram({analysis:input.analysis,node:input.analysis.nodes[0]!,receipt}),true);assert.equal(receipt.identities.length,2);assert.doesNotMatch(receipt.authorJs,/from 'page'|from 'solid-js'|watchQuery/);assert.match(receipt.authorJs,/#button/);assert.match(receipt.authorJs,/#status/);
 const listeners=new Map(),status={textContent:''},button={addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)};let next:(value:any)=>void=()=>{},stopped=false;
 vm.runInNewContext(receipt.authorJs,{dispose:{observe:(callback:any)=>{next=callback;callback({active:true,values:{days:7},queries:{rows:{rows:null,loading:true,error:null}}});return()=>{stopped=true;};}},document:{querySelector:(selector:string)=>selector==='#button'?button:status}});
 assert.equal(status.textContent,'7:0:true:null');next({active:true,values:{days:1},queries:{rows:{rows:[{n:2}],loading:false,error:null}}});assert.equal(status.textContent,'1:1:false:null');next({active:true,values:{days:1},queries:{rows:{rows:null,loading:false,error:'Query unavailable'}}});assert.equal(status.textContent,'1:0:false:Query unavailable');
 next({active:false,values:{},queries:{}});assert.equal(stopped,true);assert.equal(listeners.size,0);const before=status.textContent;next({active:true,values:{days:3},queries:{}});assert.equal(status.textContent,before);
 const {sha256,...body}=receipt;const changed={...body,authorJs:body.authorJs+'changed'};assert.equal(verifyNativeAuthorProgram({analysis:input.analysis,node:input.analysis.nodes[0]!,receipt:{...changed,sha256:nativeDigest(changed)}}),false);
});

test('preview author profile binds child capability to exact identity and resource receipts',()=>{
 const source=`import {signal,query} from 'page';import {createEffect} from 'solid-js';const page=query('$page');const host=document.querySelector('#preview');let blobs=[];createEffect(()=>{blobs.forEach(url=>URL.revokeObjectURL(url));blobs=[];const rows=page();if(!rows.length){host.textContent='';return;}const code=rows[0].script;const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));blobs.push(url);const frame=document.createElement('iframe');frame.srcdoc='<p>Preview</p>';host.textContent='';host.appendChild(frame);});`;
 const input=fixture(source);input.analysis.flow.values=[];input.analysis.flow.queries=[{name:'page',start:0,end:1}];input.admission.profile='native-query-preview';input.admission.preview={sourceNodeId:'af-0',resources:[]};
 const receipt=adaptNativeAuthorProgram(input);assert.equal(verifyNativeAuthorProgram({analysis:input.analysis,node:input.analysis.nodes[0]!,receipt}),true);assert.match(receipt.authorJs,/sandbox/);assert.doesNotMatch(receipt.authorJs,/new Blob\(/);assert.throws(()=>adaptNativeAuthorProgram({...input,admission:{...input.admission,preview:{sourceNodeId:'other',resources:[]}}}),/association/);assert.throws(()=>adaptNativeAuthorProgram({...input,admission:{...input.admission,preview:{sourceNodeId:'af-0',resources:[{source:'ref:a',target:'/assets/a',sha256:'a'.repeat(64)}]}}}),/association/);
 const frames:any[]=[],revoked:string[]=[],host={textContent:'',appendChild:()=>{}};let next:any,count=0;
 const document={baseURI:'https://runner.invalid/document',querySelector:()=>host,createElement:(tag:string)=>{assert.equal(tag,'iframe');const frame={setAttribute:()=>{},srcdoc:'',removed:false,remove(){this.removed=true;}};frames.push(frame);return frame;}};
 const URL={createObjectURL:()=>`blob:owned-${++count}`,revokeObjectURL:(url:string)=>revoked.push(url)};
 vm.runInNewContext(receipt.authorJs,{document,URL,Blob,dispose:{observe:(callback:any)=>{next=callback;return()=>{};}}});
 next({active:true,values:{},queries:{page:{rows:[{script:'one'}],loading:false,error:null}}});assert.equal(frames.length,1);assert.match(frames[0].srcdoc,/Preview/);
 next({active:true,values:{},queries:{page:{rows:[{script:'two'}],loading:false,error:null}}});assert.equal(frames[0].removed,true);assert.deepEqual(revoked,['blob:owned-1']);
 next({active:false,values:{},queries:{}});assert.equal(frames[1].removed,true);assert.deepEqual(revoked,['blob:owned-1','blob:owned-2']);const before=frames.length;next({active:true,values:{},queries:{page:{rows:[{script:'late'}]}}});assert.equal(frames.length,before);
});


test('local DOM author receipt binds literal viewer state and rejects altered output or declarations',()=>{
 const source="import {signal} from 'page';const [read,set]=signal('$chosen');document.body.textContent=read();set('updated');";
 const input=fixture(source);input.analysis.flow.values=[{kind:'scalar',name:'chosen',type:'string',default:'',start:0,end:1}];input.admission.profile='local-state-dom';
 const receipt=adaptNativeAuthorProgram(input);assert.match(receipt.authorJs,/@afbin\/apollo/);assert.doesNotMatch(receipt.authorJs,/mx\.params/);assert.equal(verifyNativeAuthorProgram({analysis:input.analysis,node:input.analysis.nodes[0]!,receipt}),true);assert.deepEqual(receipt.identities,input.identity.bindings.map(({sourceNode,afId},index)=>({sourceNode,afId,kind:index?'nonvisual':'element'})));
 const {sha256,...body}=receipt,changed={...body,authorJs:body.authorJs+';document.body.textContent="changed";'};assert.equal(verifyNativeAuthorProgram({analysis:input.analysis,node:input.analysis.nodes[0]!,receipt:{...changed,sha256:nativeDigest(changed)}}),false);
 input.analysis.flow.values[0]!.type='table';assert.throws(()=>adaptNativeAuthorProgram(input),/local declaration/);
});
