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
 if(page.heads?.length!==1||!row||row.version!==head.key.version||(row.id??row.artifact_id)!==head.key.sourceId||nativeDigest(row)!==head.sourceRowSha256)throw Error('native_latest_head');
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
