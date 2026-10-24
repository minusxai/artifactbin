import test from 'node:test';import assert from 'node:assert/strict';
import {nativeDigest} from './selection.ts';
import {runNativePipeline} from './pipeline.ts';
import type {NativePipelinePorts,NativePipelineRequest} from './pipeline-contracts.ts';
import {NATIVE_COMPONENT_TARGET} from './component-map.ts';
const request=(head:string):NativePipelineRequest=>({manifest:'manifest',manifestSha256:'manifest-pin',head,output:'out/'+head,receiptRoot:'receipts',legacyRoot:'legacy',componentRoot:'components',componentRevision:NATIVE_COMPONENT_TARGET,compilerSourceSha256:'f'.repeat(64),revisionScope:'latest',coreUrl:'/af/v1/core.js',stage:'assemble'});
function ports():NativePipelinePorts{
 return {readRevision:async r=>{const document={kind:'graph',schema:3,claimedIds:{},nodes:{$root:{parent:null,parts:[''],children:[],ast:null}}};const original={id:r.head,version:4,document,meta:{}};return {key:{sourceNamespace:'fixture',sourceId:r.head,version:4},rowSha256:nativeDigest(original),documentSha256:nativeDigest(document),original,matchingArchives:[]};},compiler:{fingerprint:async()=> 'f'.repeat(64),extract:async()=>({nodes:[],flow:{imports:[],values:[],queries:[],mutations:[]}})},styles:async c=>({sourceSha256:c.analysis.sourceSha256,analysisSha256:c.analysis.analysisSha256,compilerSha256:'b'.repeat(64),sourceFiles:[{path:'style.ts',sha256:'a'.repeat(64)}],sheets:[],htmlAttributes:{},storyAttributes:{},inlineStyles:[]}),assets:async()=>[],modules:async()=>({modules:[],files:[]})};
}
test('two different manifest heads produce isolated source-bound assemblies through the same pipeline',async()=>{
 const p=ports();const a=await runNativePipeline(request('first'),p),b=await runNativePipeline(request('second'),p);
 assert.equal(a.status,'assembled',JSON.stringify(a.blockers));assert.equal(b.status,'assembled');assert.equal(a.assembly?.key.sourceId,'first');assert.equal(b.assembly?.key.sourceId,'second');assert.notEqual(a.assembly?.sha256,b.assembly?.sha256);assert.deepEqual(a.assembly?.programs,[]);
});
test('source substitution and compiler drift stop before publication',async()=>{
 const p=ports(),read=p.readRevision;p.readRevision=r=>read({...r,head:'substituted'});
 await assert.rejects(runNativePipeline(request('first'),p),/source/);
 const drift=ports();drift.compiler.fingerprint=async()=> 'changed';await assert.rejects(runNativePipeline(request('first'),drift),/compiler_changed/);
});
test('shared resource absence remains a blocker and no import/camera port runs',async()=>{
 const p=ports(),style=p.styles;p.styles=async c=>({...await style(c),presentationUrls:['ref:missing']});let imports=0;
 p.host={importAndPrepare:async()=>{imports++;throw Error('unexpected');},captureAndCompare:async()=>{throw Error('unexpected');}};
 const result=await runNativePipeline({...request('first'),stage:'import',authorityRecipePath:'reviewed'},p);
 assert.equal(result.status,'blocked');assert.ok(result.blockers.some(b=>b.code==='resource-missing'));assert.equal(imports,0);
});
test('import and paired capture receive exact assembled source and reject unrelated host receipts',async()=>{
 const p=ports();let received='';p.host={importAndPrepare:async c=>{received=c.revision.key.sourceId;return {key:c.revision.key,assemblySha256:c.assembly.sha256,stage:'imported',historyProjectionSha256:'h'.repeat(64),preparedStorePath:'store',pilotInputPath:'input',canonicalPath:'canonical',recoveryPath:'recovery',bundleDirectory:'bundle'};},captureAndCompare:async c=>({key:c.revision.key,assemblySha256:c.assembly.sha256,status:'verified',comparisonPath:'comparison',comparisonSha256:'c'.repeat(64),baselineEvidencePath:'baseline',candidateEvidencePath:'candidate'})};
 const result=await runNativePipeline({...request('first'),stage:'capture',authorityRecipePath:'reviewed'},p);assert.equal(received,'first');assert.equal(result.status,'verified');
 const original=p.host.importAndPrepare;p.host.importAndPrepare=async c=>({...await original(c),assemblySha256:'different'});await assert.rejects(runNativePipeline({...request('first'),stage:'import',authorityRecipePath:'reviewed'},p),/host_binding/);
});
test('source SignIn emits exact platform delegation rather than dropping embedded auth semantics',async()=>{
 const p=ports(),load=p.readRevision;p.readRevision=async r=>{const revision=await load(r);const document={kind:'graph',schema:3,claimedIds:{},nodes:{$root:{parent:null,parts:['',''],children:['signin'],ast:null},signin:{parent:'$root',parts:['<SignIn/>'],children:[],ast:{kind:'jsx',roots:[{type:'element',isComponent:true,tag:'SignIn'}]}}}};const original={...revision.original,document};return {...revision,original,rowSha256:nativeDigest(original),documentSha256:nativeDigest(document)};};
 p.compiler.extract=async()=>({nodes:[{type:'element',graphKey:'signin',tag:'SignIn',isComponent:true,selfClosing:true,start:0,end:9,attributes:[],children:[]}],flow:{imports:[],values:[],queries:[],mutations:[]}});
 const result=await runNativePipeline(request('auth'),p);assert.equal(result.status,'assembled',JSON.stringify(result.blockers));assert.equal(result.assembly?.input.authDelegations?.length,1);assert.equal(result.assembly?.input.authDelegations?.[0]?.destination,'platform-topbar-sign-in');
});
