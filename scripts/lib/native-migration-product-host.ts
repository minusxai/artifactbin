/** Actual product staging and atomic identity/catalog/comment/membership publication.
 * No account seed, grant, empty relation substitute or renderer replacement lives here. */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {prepareNativeRuntimeBundle} from '../../services/app/lib/native-runtime-bridge';
import type {NativeRuntimeAssembly,NativeRuntimePreparationOptions} from '../../services/app/lib/native-runtime-bridge/contracts';
import {writeNativeHistory} from '../../services/app/lib/native-history-import';
import {prepareNativeHistoryRelations} from '../../services/app/lib/native-history-import/relations';
import {prepareNativeArtifactRelations} from '../../services/app/lib/native-history-import/artifact-relations';
import {canonicalNativeObjectSource} from '../../services/app/lib/native-history-import/catalog-source';
import {createNativeLocalObjectSink} from '../../services/app/lib/native-history-import/catalog-staging';
import {stageNativeCatalog} from '../../services/app/lib/native-history-import/catalog-objects';
import {nativeCatalogDigest} from '../../services/app/lib/native-history-import/catalog-digest';
import {authorizeNativeIdentityTransaction,writeNativeIdentities} from '../../services/app/lib/native-identity-import';
import type {NativeProductImportRecipe,NativeSerializedProductImportRecipe,NativeProductImportDb} from './native-migration-product-host-contract';
/** Snapshot input before awaits; branded authorities are reconstructed from reviewed raw evidence. */
export async function prepareNativeProductImport(raw:NativeProductImportRecipe|NativeSerializedProductImportRecipe){
 const recipe=structuredClone(raw) as NativeProductImportRecipe;
 for(const field of ['capture','selectionManifest','canonicalSource','headWitness','refreshManifest'] as const){
  const value=raw.membership.source[field];if(value===undefined)continue;
  if(value instanceof Uint8Array){recipe.membership.source[field]=new Uint8Array(value);continue;}
  if(value.encoding!=='base64'||typeof value.data!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256))throw Error('native_product_host_source_encoding');
  const decoded=Buffer.from(value.data,'base64');if(decoded.toString('base64')!==value.data||createHash('sha256').update(decoded).digest('hex')!==value.sha256)throw Error('native_product_host_source_digest');
  recipe.membership.source[field]=decoded;
 }
 const captured=recipe,{history,identity,catalog}=captured;
 if(recipe.revisionScope!=='latest'||history.revisions.length!==1||history.revisions[0]?.page.version!==history.headVersion||catalog.projection.revisionScope!=='latest')throw Error('native_product_host_latest_required');
 if(!isDeepStrictEqual(recipe.relations.history,history)||!isDeepStrictEqual(recipe.membership.identityPlan,identity.plan)||recipe.membership.history.projectionSha256!==history.projectionSha256||identity.plan.sourceNamespace!==history.sourceNamespace||catalog.projection.sourceNamespace!==history.sourceNamespace||catalog.projection.selectionSha256!==history.selectionSha256||catalog.projection.identityPlanSha256!==identity.plan.sha256)throw Error('native_product_host_binding');
 const expectedIdentities={users:Object.fromEntries(Object.entries(identity.plan.targets.users).map(([id,target])=>[id,target.userId])),tokens:Object.fromEntries(Object.entries(identity.plan.targets.tokens).map(([id,target])=>[id,target.tokenId])),groups:recipe.identityGroups??{},artifacts:identity.plan.artifactIds??{}};
 if(!isDeepStrictEqual(catalog.projection.identities,expectedIdentities))throw Error('native_product_host_identity_binding');
 const membership=prepareNativeArtifactRelations(recipe.membership);
 const annotations=prepareNativeHistoryRelations(recipe.relations,membership);
 const source=await canonicalNativeObjectSource(catalog.root,catalog.ledgerPath,catalog.receipts);
 const sink=await createNativeLocalObjectSink(catalog.sinkDirectory);
 const stagedCatalog=await stageNativeCatalog(catalog.projection,source.source,sink);
 const relations={sourceSha256:nativeCatalogDigest({annotations:annotations.sourceSha256,catalog:stagedCatalog.sourceSha256}),headMetadata:annotations.headMetadata,
  apply:async(tx:Parameters<typeof writeNativeHistory>[0],id:string)=>{await annotations.apply(tx,id);await stagedCatalog.apply(tx,id);},
  verify:async(tx:Parameters<typeof writeNativeHistory>[0],id:string)=>{await annotations.verify(tx,id);await stagedCatalog.verify(tx,id);}};
 history.relationSha256=relations.sourceSha256;
 const write=async(tx:Parameters<typeof writeNativeHistory>[0])=>{
   const authority=await authorizeNativeIdentityTransaction(tx,recipe.schemas);
   const identities=await writeNativeIdentities(tx,identity,authority);
   const disposition=await writeNativeHistory(tx,history,relations);
   return {disposition,identities,historyProjectionSha256:history.projectionSha256,relationsSha256:relations.sourceSha256};
 };
 return {history,relations,catalog:stagedCatalog,identityPlan:identity.plan,datasetIds:catalog.projection.datasets.map(dataset=>dataset.targetId),write,async import(db:NativeProductImportDb){return db.transaction(write);}};
}

/** Stage real runtime assets before the converter's synchronous history projection.
 * The returned lookup accepts only the exact assembly and destination staged here. */
export async function prepareNativeProductRuntime(assemblies:readonly NativeRuntimeAssembly[],options:NativeRuntimePreparationOptions){
 if(assemblies.length!==1)throw Error('native_product_host_latest_required');
 const assembly=structuredClone(assemblies[0]!),scope=structuredClone(options);
 const staged=await prepareNativeRuntimeBundle(assembly,scope);
 return {staged:[staged],prepareBundle(selected:NativeRuntimeAssembly,pageId:string){
  if(pageId!==scope.pageId||staged.pageId!==pageId||staged.assemblySha256!==selected.sha256||staged.sourceHtmlSha256!==selected.result.htmlSha256||!isDeepStrictEqual(staged.key,selected.key)||!isDeepStrictEqual(staged.fileDigests,selected.result.files?.map(({path,sha256})=>({path,sha256}))))throw Error('native_product_host_runtime_binding');
  return staged;
 }};
}
