import {nativeReceiptDigest} from './receipt-digest.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeDigest } from './selection.ts';
import { selectLatestHead, verifyReceipt, prepareLatestBatch } from './latest-batch-prepare.ts';
const row = {id:'example',version:7,document:{kind:'graph'}};
const bytes = Buffer.from(JSON.stringify({heads:[row],versions:[{...row,version:1}]}));
const head = {key:{sourceNamespace:'fixture',sourceId:'example',version:7},sourceRowSha256:nativeDigest(row),sourceFile:{path:'unused',bytes:bytes.length,sha256:''},ownerPlanRef:{sha256:'plan',sourceUserId:'human',targetUserId:'mapped',sourceTokenId:null,targetTokenId:null},unresolvedReferences:[]};
test('latest selection never admits archived versions and permits mapped human without source token', async()=>{
 const {createHash}=await import('node:crypto'); head.sourceFile.sha256=createHash('sha256').update(bytes).digest('hex');
 const selected=selectLatestHead(head,bytes,'plan'); assert.equal(selected.key.version,7); assert.deepEqual(selected.matchingArchives,[]);
});
test('source bytes, row identity and plan drift fail closed',()=>{
 assert.throws(()=>selectLatestHead(head,Buffer.from('changed'),'plan'),/file_digest/);
 assert.throws(()=>selectLatestHead({...head,key:{...head.key,version:8}},bytes,'plan'),/head/);
 assert.throws(()=>selectLatestHead(head,bytes,'other'),/owner_plan/);
});
test('immutable receipt alteration is rejected',()=>{
 const payload={a:1}; const receipt={...payload,sha256:nativeDigest(payload)};
 assert.equal(verifyReceipt(receipt),receipt.sha256);
 assert.throws(()=>verifyReceipt({...receipt,a:2}),/receipt_digest/);
});

test('compiler drift discards batch results and unsupported source stays explicit',async()=>{
 const {createHash}=await import('node:crypto');head.sourceFile.sha256=createHash('sha256').update(bytes).digest('hex');
 const payload={format:'native-latest-batch-preparation-v1' as const,stage:'preparation-only' as const,revisionScope:'latest' as const,batch:1,batchCount:6,approvalManifestSha256:'approved',identityPlanSha256:'plan',sharedPreparation:{path:'unused',sha256:'shared',batchMayPrepareSharedResources:false as const},heads:[head]};
 const batch={...payload,sha256:nativeDigest(payload)};
 const sharedPayload={format:'native-latest-shared-verified-v1' as const,stage:'preparation-only' as const,indexSha256:'index',sharedSha256:'shared',identityPlanSha256:'plan',batches:[{batch:1,sha256:batch.sha256,heads:1}],verifiedObjects:1};
 const shared={...sharedPayload,sha256:nativeDigest(sharedPayload)};
 let reads=0;
 const port={fingerprint:async()=> 'pin',extract:async()=>{throw Error('must_not_compile_invalid_graph');}};
 const results=await prepareLatestBatch(batch,shared,'pin',port,async()=>{reads++;return bytes;});
 assert.equal(reads,1);assert.equal(results[0]?.status,'source-analysis-blocked');assert.equal(results[0]?.assemblyStatus,'not-assembled');
 let checks=0;
 await assert.rejects(prepareLatestBatch(batch,shared,'pin',{...port,fingerprint:async()=>++checks===1?'pin':'changed'},async()=>bytes),/compiler_changed/);
 await assert.rejects(prepareLatestBatch({...batch,heads:[head,head]},shared,'pin',port,async()=>bytes),/receipt_digest/);
});
test('existing source-specific receipt drives real assembly and never claims UI verification',async()=>{
 const {assembleLatestPreparedHead}=await import('./latest-batch-prepare.ts');
 const {bindNativeIdentities}=await import('./identity.ts');
 const {NATIVE_COMPONENT_TARGET}=await import('./component-map.ts');
 const key=head.key;
 const graph={key,documentSha256:'d'.repeat(64),sourceSha256:'e'.repeat(64),source:'',identities:[{sourceNode:'$root',parent:null,children:[],sourceStart:0,sourceEnd:0,astSha256:'a',nodeSha256:'b'}],claimedIds:{},components:{},recovery:{kind:'exact' as const,repairedNodes:0}};
 const typed={key,documentSha256:graph.documentSha256,sourceSha256:graph.sourceSha256,analysisSha256:nativeDigest(graph),compilerSourceSha256:'f'.repeat(64),nodes:[],flow:{imports:[],values:[],queries:[],mutations:[]},sourceSpans:[{sourceNode:'$root',sourceStart:0,sourceEnd:0}]};
 const identity=bindNativeIdentities([{graph,typed}])[0]!;
 const input={analysis:typed,identity,targetRevision:NATIVE_COMPONENT_TARGET,coreUrl:'/af/v1/core.js',backends:[],queries:[],mutations:[]};
 const payload={key,sourceRowSha256:head.sourceRowSha256,input,result:{status:'blocked' as const,html:null,bindingTargets:[],blockers:[]},programs:[]};
 const receipt={...payload,sha256:nativeReceiptDigest(payload)};
 const prepared={key,revision:selectLatestHead(head,bytes,'plan'),status:'prepared-input' as const,evidence:{typed,identities:identity},sourceLimitations:[],assemblyStatus:'not-assembled' as const};
 const attempt=assembleLatestPreparedHead(prepared,receipt);
 assert.equal(attempt.status,'assembled');assert.equal(attempt.receipt.result.status,'complete');assert.equal(attempt.verificationStatus,'not-verified');
 const stale={...payload,sourceRowSha256:'different'};
 assert.throws(()=>assembleLatestPreparedHead(prepared,{...stale,sha256:nativeReceiptDigest(stale)}),/assembly_source/);
 const forged={...payload,input:{...input,analysis:{...typed,sourceSha256:'changed'}}};
 assert.throws(()=>assembleLatestPreparedHead(prepared,{...forged,sha256:nativeReceiptDigest(forged)}),/assembly_analysis/);
});
test('conflicting source IDs fail even when primary row ID and hashes match',async()=>{
 const {createHash}=await import('node:crypto');
 const conflicting={...row,artifact_id:'other'};const data=Buffer.from(JSON.stringify({heads:[conflicting],versions:[]}));
 const entry={...head,sourceRowSha256:nativeDigest(conflicting),sourceFile:{...head.sourceFile,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')}};
 assert.throws(()=>selectLatestHead(entry,data,'plan'),/head/);
});
test('exact pinned prepared inputs avoid a second compiler extraction; altered reuse fails closed',async()=>{
 const {createHash}=await import('node:crypto');const {analyzeNativeRevision}=await import('./recover.ts');const {bindNativeIdentities}=await import('./identity.ts');
 const original={id:'example',version:7,document:{kind:'graph',schema:3,claimedIds:{},nodes:{$root:{parent:null,parts:[''],children:[],ast:null}}}};
 const data=Buffer.from(JSON.stringify({heads:[original],versions:[]}));
 const entry={...head,sourceRowSha256:nativeDigest(original),sourceFile:{...head.sourceFile,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')}};
 const revision=selectLatestHead(entry,data,'plan'),graph=analyzeNativeRevision(revision);
 const typed={key:entry.key,documentSha256:graph.documentSha256,sourceSha256:graph.sourceSha256,analysisSha256:nativeDigest(graph),compilerSourceSha256:'pin',nodes:[],flow:{imports:[],values:[],queries:[],mutations:[]},sourceSpans:graph.identities.map(n=>({sourceNode:n.sourceNode,sourceStart:n.sourceStart,sourceEnd:n.sourceEnd}))};
 const identities=bindNativeIdentities([{graph,typed}])[0];const payload={key:entry.key,revision,status:'prepared-input' as const,evidence:{graph,typed,identities},sourceLimitations:[],assemblyStatus:'not-assembled' as const};const reused={...payload,sha256:nativeDigest(payload)};
 const b={format:'native-latest-batch-preparation-v1' as const,stage:'preparation-only' as const,revisionScope:'latest' as const,batch:1,batchCount:6,approvalManifestSha256:'approval',identityPlanSha256:'plan',sharedPreparation:{path:'unused',sha256:'shared',batchMayPrepareSharedResources:false as const},heads:[entry]};const batch={...b,sha256:nativeDigest(b)};
 const s={format:'native-latest-shared-verified-v1' as const,stage:'preparation-only' as const,indexSha256:'index',sharedSha256:'shared',identityPlanSha256:'plan',batches:[{batch:1,sha256:batch.sha256,heads:1}],verifiedObjects:1};const shared={...s,sha256:nativeDigest(s)};
 const port={fingerprint:async()=> 'pin',extract:async()=>{throw Error('duplicate_compilation');}};
 const result=await prepareLatestBatch(batch,shared,'pin',port,async()=>data,async()=>reused);
 assert.equal(result[0]?.status,'prepared-input');
 await assert.rejects(prepareLatestBatch(batch,shared,'pin',port,async()=>data,async()=>({...reused,key:{...reused.key,version:6}})),/receipt_digest/);
});
