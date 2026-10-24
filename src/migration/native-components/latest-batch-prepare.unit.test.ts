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
