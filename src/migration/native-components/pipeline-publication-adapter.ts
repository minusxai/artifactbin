import {createHash} from 'node:crypto';
import type {NativeCanonicalReceipt,NativeSelectedRevision} from './contracts.ts';
import type {NativePipelinePublicationConfiguration,NativePipelinePublicationCallback} from './pipeline-publication-adapter-contracts.ts';
import {nativeDigest,selectNativeRevisions} from './selection.ts';
import {decodeNativePublicationBytes,encodeNativePublicationBytes,prepareNativePublication} from './pipeline-publication.ts';
import {canonicalMigrationValue} from '../verification-values.ts';
import {createNativeV3PublicationHost,preflightNativeV3Publication} from './v3-publication-projection.ts';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** Reuse the original approved selection and its explicitly reviewed overlay; never select newly found pages. */
export async function selectNativePipelinePublicationPage(config:Pick<NativePipelinePublicationConfiguration,'selectionManifest'|'approvedSelectionManifestSha256'|'refreshManifest'|'approvedRefreshManifestSha256'>,canonical:Uint8Array,revision:NativeSelectedRevision){
 const manifestBytes=decodeNativePublicationBytes(config.selectionManifest);
 if(sha(manifestBytes)!==config.approvedSelectionManifestSha256)throw Error('native_pipeline_publication_manifest');
 const manifest=JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
 const original=manifest.receipts?.filter((r:NativeCanonicalReceipt)=>r.id===revision.key.sourceId);
 if(original?.length!==1)throw Error('native_pipeline_publication_selection');
 let receipt:NativeCanonicalReceipt=original[0];
 if(config.refreshManifest){
  const bytes=decodeNativePublicationBytes(config.refreshManifest);
  if(sha(bytes)!==config.approvedRefreshManifestSha256)throw Error('native_pipeline_publication_refresh_manifest');
  const overlay=JSON.parse(Buffer.from(bytes).toString('utf8'));
  if(overlay.revisionScope!=='latest'||overlay.selectionUnchanged!==true||overlay.priorManifestSha256!==config.approvedSelectionManifestSha256||overlay.receipts.some((r:NativeCanonicalReceipt)=>!manifest.receipts.some((old:NativeCanonicalReceipt)=>old.id===r.id)))throw Error('native_pipeline_publication_refresh_selection');
  const matches=overlay.receipts.filter((r:NativeCanonicalReceipt)=>r.id===revision.key.sourceId);
  if(matches.length>1)throw Error('native_pipeline_publication_refresh_duplicate');
  if(matches.length){const refreshed=matches[0];if(nativeDigest(refreshed.priorReceipt)!==nativeDigest(receipt))throw Error('native_pipeline_publication_refresh_prior');
   const raw=JSON.parse(Buffer.from(canonical).toString('utf8'));
   if(!Array.isArray(raw.versions)||raw.versions.length!==0)throw Error('native_pipeline_publication_refresh_history');
   receipt={...refreshed,path:'page.json',distinctRevisions:1,archivedRows:0};
  }
 }
 const selected=await selectNativeRevisions({sourceNamespace:revision.key.sourceNamespace,sourceIds:[revision.key.sourceId],expectedHeads:1,expectedRevisions:receipt.distinctRevisions,manifestBytes:Buffer.from(JSON.stringify({receipts:[receipt],failures:[]})),readFile:async()=>canonical});
 const page=selected.pages[0]!;const head=page.revisions.find(r=>r.key.version===page.headVersion);
 if(!head||head.rowSha256!==revision.rowSha256||head.documentSha256!==revision.documentSha256||nativeDigest(head.key)!==nativeDigest(revision.key))throw Error('native_pipeline_publication_source_binding');
 return {...page,revisions:[head]};
}
/** Supplies the actual product bootstrap callback for every head through one captured configuration. */
export function createNativePipelinePublication(config:NativePipelinePublicationConfiguration):NativePipelinePublicationCallback {
 const captured=structuredClone(config);
 return async invocation=>{
  const {context,reviewedRecipe,files}=invocation;
  if(reviewedRecipe.assemblySha256!==context.assembly.sha256||nativeDigest(context.assembly.key)!==nativeDigest(context.revision.key)||nativeDigest(reviewedRecipe.authority)!==nativeDigest(captured.shared.schemas))throw Error('native_pipeline_publication_authority_binding');
  if(context.revision.key.sourceNamespace!==captured.shared.identity.plan.sourceNamespace)throw Error('native_pipeline_publication_namespace');
  const page=await selectNativePipelinePublicationPage(captured,files.sourceHead,context.revision);
  const result=await prepareNativePublication({selection:{sourceNamespace:context.revision.key.sourceNamespace,manifestSha256:captured.approvedSelectionManifestSha256,page},assemblies:[context.assembly],relations:encodeNativePublicationBytes(files.comments),shared:structuredClone(captured.shared),exportedAt:captured.exportedAt,coreUrl:captured.coreUrl},{prepare:async(assemblies,planned)=>{
   const access=preflightNativeV3Publication({revisionScope:'latest',selection:{sourceNamespace:context.revision.key.sourceNamespace,manifestSha256:captured.approvedSelectionManifestSha256,page},planned,plannedSha256:createHash('sha256').update(canonicalMigrationValue(planned)).digest('hex'),maps:captured.shared.maps,targets:captured.shared.targets,targetIdentitySha256:nativeDigest(captured.shared.targets),assemblies}).access;
   const staged=await invocation.prepareRuntime(assemblies,{pageId:planned.pageId,visibility:access.visibility,shares:access.shares});
   return createNativeV3PublicationHost({...invocation.publicationModules,prepareBundle:staged.prepareBundle});
  }});
  return result.recipe;
 };
}
