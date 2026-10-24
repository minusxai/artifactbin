import {nativeReceiptDigest} from './receipt-digest.ts';
import {assembleNativePage} from './assemble.ts';
import type {NativeV3AssemblyReceipt} from './v3-publication-contracts.ts';
import type {LatestAssemblyAttempt} from './latest-batch-contracts.ts';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {nativeDigest} from './selection.ts';
import {analyzeNativeRevision} from './recover.ts';
import {analyzeWithRetainedCompiler} from './analyze.ts';
import {bindNativeIdentities} from './identity.ts';
import type {NativeCanonicalPage,NativeSelectedRevision} from './contracts.ts';
import type {NativeTypedCompilerPort} from './analyze-contracts.ts';
import type {LatestHeadPreparation,LatestBatchPreparation,LatestSharedVerification,LatestPreparedHead} from './latest-batch-contracts.ts';
export function verifyReceipt<T extends object & {sha256:string}>(receipt:T):string {
 const {sha256,...payload}=receipt;
 if(nativeDigest(payload)!==sha256)throw Error('native_latest_receipt_digest');
 return sha256;
}
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export function selectLatestHead(head:LatestHeadPreparation,bytes:Uint8Array,plan:string):NativeSelectedRevision {
 if(bytes.length!==head.sourceFile.bytes||hash(bytes)!==head.sourceFile.sha256)throw Error('native_latest_file_digest');
 if(head.ownerPlanRef.sha256!==plan||!head.ownerPlanRef.targetUserId||!head.ownerPlanRef.sourceUserId||(!head.ownerPlanRef.sourceTokenId&&head.ownerPlanRef.targetTokenId!==null))throw Error('native_latest_owner_plan');
 const page=JSON.parse(Buffer.from(bytes).toString('utf8')) as NativeCanonicalPage;
 const row=page.heads?.[0];
 if(!/^[A-Za-z0-9_-]+$/.test(head.key.sourceId)||page.heads?.length!==1||!row||row.version!==head.key.version||(row.id??row.artifact_id)!==head.key.sourceId||(row.id!==undefined&&row.id!==head.key.sourceId)||(row.artifact_id!==undefined&&row.artifact_id!==head.key.sourceId)||nativeDigest(row)!==head.sourceRowSha256)throw Error('native_latest_head');
 return {key:head.key,rowSha256:head.sourceRowSha256,documentSha256:nativeDigest(row.document),original:row,matchingArchives:[]};
}
export async function prepareLatestBatch(batch:LatestBatchPreparation,shared:LatestSharedVerification,pin:string,port:NativeTypedCompilerPort,read:(path:string)=>Promise<Uint8Array>=readFile):Promise<LatestPreparedHead[]> {
 verifyReceipt(batch);verifyReceipt(shared);
 if(batch.format!=='native-latest-batch-preparation-v1'||batch.stage!=='preparation-only'||batch.revisionScope!=='latest'||batch.sharedPreparation.batchMayPrepareSharedResources!==false||shared.format!=='native-latest-shared-verified-v1'||shared.sharedSha256!==batch.sharedPreparation.sha256||shared.identityPlanSha256!==batch.identityPlanSha256||!shared.batches.some(b=>b.batch===batch.batch&&b.sha256===batch.sha256&&b.heads===batch.heads.length)||new Set(batch.heads.map(h=>h.key.sourceId)).size!==batch.heads.length)throw Error('native_latest_scope');
 if(await port.fingerprint()!==pin)throw Error('native_typed_compiler_changed');
 const results:LatestPreparedHead[]=[];
 for(const head of batch.heads){
  const revision=selectLatestHead(head,await read(head.sourceFile.path),batch.identityPlanSha256);
  let evidence:unknown,status:LatestPreparedHead['status']='prepared-input';
  try {
   const graph=analyzeNativeRevision(revision);
   const typed=await analyzeWithRetainedCompiler(revision,graph,pin,{fingerprint:async()=>pin,extract:d=>port.extract(d)});
   const identities=bindNativeIdentities([{graph,typed}])[0];
   evidence={graph,typed,identities,requiredAssemblyReceipts:['modules','resources','styles','operations','reader-template','charts-if-used'],components:graph.components,flowCounts:Object.fromEntries(Object.entries(typed.flow).map(([k,v])=>[k,v.length]))};
  }catch(error){status='source-analysis-blocked';evidence={error:error instanceof Error?error.message:'native_latest_analysis_failed'};}
  results.push({key:head.key,revision,status,evidence,sourceLimitations:head.unresolvedReferences,assemblyStatus:'not-assembled'});
 }
 if(await port.fingerprint()!==pin)throw Error('native_typed_compiler_changed');
 return results;
}

/** Consume the existing full receipt contract, never invent missing capabilities. */
export function assembleLatestPreparedHead(prepared:LatestPreparedHead,receipt:NativeV3AssemblyReceipt):LatestAssemblyAttempt {
 const {sha256:receiptSha,...receiptPayload}=receipt;
 if(nativeReceiptDigest(receiptPayload)!==receiptSha)throw Error('native_latest_assembly_receipt_digest');
 if(prepared.status!=='prepared-input'||nativeDigest(receipt.key)!==nativeDigest(prepared.key)||receipt.sourceRowSha256!==prepared.revision.rowSha256)throw Error('native_latest_assembly_source');
 const evidence=prepared.evidence as {typed:unknown;identities:unknown};
 if(nativeDigest(receipt.input.analysis)!==nativeDigest(evidence.typed)||nativeDigest(receipt.input.identity)!==nativeDigest(evidence.identities))throw Error('native_latest_assembly_analysis');
 const result=assembleNativePage(receipt.input);
 const {sha256:prior,...payload}=receipt;void prior;
 const current={...payload,result};
 return {key:prepared.key,receipt:{...current,sha256:nativeReceiptDigest(current)},status:result.status==='complete'?'assembled':'assembly-blocked',verificationStatus:'not-verified'};
}
