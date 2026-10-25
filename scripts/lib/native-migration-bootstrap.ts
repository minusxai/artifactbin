/** Shared actual host composition. Converter projection is the only injected source adapter. */
import type {PGlite} from '@electric-sql/pglite';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {prepareNativeAncillaryFolders,type NativeAncillaryFolderRecipe,type NativePreparedAncillaryFolders} from '../../services/app/lib/native-ancillary-folders';
import {identityForUser} from '../../services/app/lib/accounts';
import {LOCAL_OBJECT_DIR,S3_URL} from '../../services/app/lib/platform/config';
import {authorizeNativeIdentityTransaction,writeNativeIdentities} from '../../services/app/lib/native-identity-import';
import type {NativeIdentityImport} from '../../services/app/lib/native-identity-import/contracts';
import {htmlCommentNodes} from '../../services/app/lib/annotations/html-anchor';
import {canonicalizeHtmlPage} from '../../services/app/lib/html-page';
import {prepareRegisteredQueryBackend,registeredPlan} from '../../services/app/lib/registered-page-queries/registry';
import {prepareRegisteredMutationBackend,registeredMutationPlan} from '../../services/app/lib/registered-page-mutations';
import {createNativeMigrationHost,readNativeMigrationHostInputs} from './native-migration-host.mjs';
import {prepareNativeMigrationSnapshot} from './native-migration-snapshot.mjs';
import {validatePilotInputs} from './native-migration-pilot.mjs';
import {prepareNativeProductImport,prepareNativeProductRuntime} from './native-migration-product-host';
import type {NativeMigrationBootstrapOptions,NativeMigrationImportOnlyResult} from './native-migration-bootstrap-contract';
import type {NativeHostContext,NativeHostRecipe} from './native-migration-host-contract';
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
/** Actual target validators and comment node extraction; no converter package import. */
export const nativeProductPublicationModules={commentNodeIds:(html:string)=>[...htmlCommentNodes(html).keys()],canonicalizeHtmlPage,prepareRegisteredQueryBackend,registeredPlan,prepareRegisteredMutationBackend,registeredMutationPlan};
type Prepared=Awaited<ReturnType<typeof prepareNativeProductImport>>;
type Staged=Prepared&{reviewedRecipe:NativeHostRecipe;identityPreparationPath:string;ancillary?:NativePreparedAncillaryFolders;identityPreparation:{transaction:'separate-prerequisite';identityPlanSha256:string;identities:Awaited<ReturnType<typeof writeNativeIdentities>>}};
async function candidateSnapshot(prepared:Staged,context:NativeHostContext,options:NativeMigrationBootstrapOptions){
 if(!context.candidateRecipePath)throw Error('native_bootstrap_camera_recipe_required');
 const camera=JSON.parse(await readFile(context.candidateRecipePath,'utf8'));
 if(camera.format!=='native-migration-camera-recipe-v1')throw Error('native_bootstrap_camera_recipe');
 const template=JSON.parse(await readFile(camera.paths.input,'utf8'));
 const [canonical,recovery]=await Promise.all([readFile(camera.paths.canonical),readFile(camera.paths.recovery)]);
 validatePilotInputs(template,canonical,recovery);
 if(sha(canonical)!==prepared.reviewedRecipe.inputs.sourceHead.sha256||template.candidateRevision!==prepared.reviewedRecipe.targetRevision||template.originalRevision!==prepared.reviewedRecipe.sourceRevision)throw Error('native_bootstrap_camera_source');
 if(!isDeepStrictEqual(template.key,context.assembly.key)||template.implementation!=='html'||!template.probe)throw Error('native_bootstrap_camera_source');
 if(!template.probe.path||path.isAbsolute(template.probe.path)||template.probe.path.split('/').some((part:string)=>!part||part==='.'||part==='..'))throw Error('native_bootstrap_probe_path');
 const probeRoot=await realpath(camera.paths.bundle),probePath=await realpath(path.resolve(probeRoot,template.probe.path));
 if(!probePath.startsWith(probeRoot+path.sep))throw Error('native_bootstrap_probe_path');
 const probe=await readFile(probePath);if(sha(probe)!==template.probe.sha256)throw Error('native_bootstrap_probe_digest');
 const raw=options.db.raw();if(raw.kind!=='pglite')throw Error('native_bootstrap_disposable_pglite_required');
 const identities=prepared.history.owner,identityPlan=prepared.identityPlan;
 const emails=[...new Set(Object.values(identityPlan.targets.users).filter(target=>target.userId===identities.userId).map(target=>target.email))];
 if(emails.length!==1||typeof emails[0]!=='string')throw Error('native_bootstrap_owner_email');
 const dump=await (raw.instance as PGlite).dumpDataDir('none');
 const reader={pageId:prepared.history.pageId,version:prepared.history.headVersion,accountEmail:emails[0],datasetIds:prepared.datasetIds,identityPlanSha256:identityPlan.sha256};
 const snapshot=await prepareNativeMigrationSnapshot({history:prepared.history,databaseDump:new Uint8Array(await dump.arrayBuffer()),reader,assembly:context.assembly,objectsDirectory:options.objectsDirectory,outputDirectory:path.join(context.outputDirectory,'snapshot'),fixtureAuthSecret:options.fixtureAuthSecret});
 const canonicalPath=path.join(context.outputDirectory,'canonical.json'),recoveryPath=path.join(context.outputDirectory,'recovery.json'),pilotInputPath=path.join(context.outputDirectory,'pilot-input.json'),cameraRecipePath=path.join(context.outputDirectory,'candidate-camera.json');
 await writeFile(canonicalPath,canonical,{flag:'wx',mode:0o600});await writeFile(recoveryPath,recovery,{flag:'wx',mode:0o600});
 const target=path.join(snapshot.bundleDirectory,template.probe.path);await mkdir(path.dirname(target),{recursive:true,mode:0o700});await writeFile(target,probe,{flag:'wx',mode:0o600});
 const input={...template,preparedStore:snapshot.preparedStore,bundleFiles:[...snapshot.bundleFiles,template.probe]};
 await writeFile(pilotInputPath,JSON.stringify(input),{flag:'wx',mode:0o600});
 await writeFile(cameraRecipePath,JSON.stringify({...camera,paths:{input:pilotInputPath,canonical:canonicalPath,recovery:recoveryPath,bundle:snapshot.bundleDirectory,output:path.join(context.outputDirectory,'candidate-capture')}}),{flag:'wx',mode:0o600});
 return {...snapshot,pilotInputPath,canonicalPath,recoveryPath,cameraRecipePath,identityPreparation:prepared.identityPreparation,identityPreparationPath:prepared.identityPreparationPath};
}
/** One configured product host runs all sources through the same transaction/snapshot/camera path. */
export function createNativeProductMigrationHost(rawOptions:NativeMigrationBootstrapOptions){
 const options={...rawOptions};
 if(options.db.raw().kind!=='pglite'||S3_URL||path.resolve(options.objectsDirectory)!==path.resolve(LOCAL_OBJECT_DIR))throw Error('native_bootstrap_disposable_local_scope_required');
 const ports={
  stage:async({context,recipe,files}:{context:NativeHostContext;recipe:Parameters<NativeMigrationBootstrapOptions['publication']>[0]['reviewedRecipe'];files:Parameters<NativeMigrationBootstrapOptions['publication']>[0]['files']})=>{
   const capability=JSON.parse(Buffer.from(files.authSchemaCapability).toString('utf8'));
   const schemas={appSchema:recipe.authority.appSchema,authSchema:recipe.authority.authSchema};
   const disposable=capability.runtime?.mode==='disposable-scoped-tokens';
   if(!isDeepStrictEqual(capability.schemas,schemas)||!capability.runtime?.actor||typeof capability.runtime.actor.userId!=='string'||!capability.runtime.actor.userId||(disposable?(!options.runtimeActors||Object.keys(capability.runtime.actor).some(key=>key!=='userId')):(capability.runtime.mode!==undefined||typeof capability.runtime.actor.tokenId!=='string'||!capability.runtime.actor.tokenId||Object.keys(capability.runtime.actor).some(key=>!['userId','tokenId'].includes(key)))))throw Error('native_bootstrap_runtime_authority');
   const origin=new URL(capability.runtime.origin);if(!['http:','https:'].includes(origin.protocol)||!['localhost','127.0.0.1','lvh.me','app.lvh.me'].includes(origin.hostname)&&!origin.hostname.endsWith('.lvh.me')||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('native_bootstrap_runtime_origin');
   const identity=JSON.parse(Buffer.from(files.identity).toString('utf8')) as NativeIdentityImport;
   if(identity.plan?.sourceNamespace!==context.revision.key.sourceNamespace)throw Error('native_bootstrap_identity_binding');
   const source=JSON.parse(Buffer.from(files.sourceHead).toString('utf8'));const heads=source.heads?.filter((row:{id:string;version:number})=>row.id===context.revision.key.sourceId&&row.version===context.revision.key.version);
   if(heads?.length!==1||identity.plan.targets.users[heads[0].user_id]?.userId!==capability.runtime.actor.userId)throw Error('native_bootstrap_runtime_source_authority');
   const ancillaryInput=files.ancillaryFolders?JSON.parse(Buffer.from(files.ancillaryFolders).toString('utf8')) as NativeAncillaryFolderRecipe:undefined;
   const ancillary=ancillaryInput?prepareNativeAncillaryFolders(ancillaryInput,identity.plan,ancillaryInput.identityGroups??{}):undefined;
   const prerequisite=await options.db.transaction(async tx=>{const imported=await writeNativeIdentities(tx,identity,await authorizeNativeIdentityTransaction(tx,schemas));
    const actor=disposable?await options.runtimeActors!.provision(tx,capability.runtime.actor.userId):capability.runtime.actor;
    const owner=(await tx.query<{user_id:string}>('SELECT user_id FROM tokens WHERE id=$1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>now())',[actor.tokenId])).rows[0];
    if(actor.userId!==capability.runtime.actor.userId||owner?.user_id!==actor.userId)throw Error('native_bootstrap_runtime_actor');
    const folders=ancillary?await ancillary.apply(tx):undefined;await ancillary?.verify(tx);return {identities:imported,folders,actor};});
   const runtimeActor=identityForUser(prerequisite.actor.userId,prerequisite.actor.tokenId);
   const prepareRuntime:Parameters<NativeMigrationBootstrapOptions['publication']>[0]['prepareRuntime']=(assemblies,preparedOptions)=>{if('actor' in preparedOptions||'origin' in preparedOptions)throw Error('native_bootstrap_runtime_override');return prepareNativeProductRuntime(assemblies,{...preparedOptions,actor:runtimeActor,origin:origin.origin});};
   const identityPreparation={format:'native-migration-identity-preparation-v1',production:false,transaction:'separate-prerequisite' as const,identityPlanSha256:identity.plan.sha256,identities:prerequisite.identities,...(prerequisite.folders?{ancillaryFolders:{sourceSha256:ancillary!.sourceSha256,...prerequisite.folders}}:{})};
   await mkdir(context.outputDirectory,{recursive:true,mode:0o700});const identityPreparationPath=path.join(context.outputDirectory,'identity-preparation.json');await writeFile(identityPreparationPath,JSON.stringify(identityPreparation),{flag:'wx',mode:0o600});
   const raw=await options.publication({context,reviewedRecipe:structuredClone(recipe),files,prepareRuntime,publicationModules:nativeProductPublicationModules});
   if(ancillaryInput&&!isDeepStrictEqual(raw.identityGroups??{},ancillaryInput.identityGroups??{})||raw.ancillaryFolders!==undefined&&!isDeepStrictEqual(raw.ancillaryFolders,ancillaryInput))throw Error('native_bootstrap_ancillary_binding');
   if(!isDeepStrictEqual(raw.identity,identity))throw Error('native_bootstrap_identity_binding');
   if(raw.history.sourceNamespace!==context.revision.key.sourceNamespace||raw.history.sourceId!==context.revision.key.sourceId||raw.history.headVersion!==context.revision.key.version||!isDeepStrictEqual(raw.schemas,{appSchema:recipe.authority.appSchema,authSchema:recipe.authority.authSchema}))throw Error('native_bootstrap_publication_binding');
   await mkdir(options.objectsDirectory,{recursive:true,mode:0o700});await mkdir(raw.catalog.sinkDirectory,{recursive:true,mode:0o700});
   if(await realpath(raw.catalog.sinkDirectory)!==await realpath(options.objectsDirectory))throw Error('native_bootstrap_object_scope');
   const prepared=await prepareNativeProductImport(raw);
   return {...prepared,reviewedRecipe:structuredClone(recipe),identityPreparation,identityPreparationPath,ancillary};
  },
  transaction<T>(_authority:unknown,work:(tx:Parameters<Prepared['write']>[0])=>Promise<T>){return options.db.transaction(work);},
  importHistory:(tx:Parameters<Prepared['write']>[0],staged:Prepared)=>staged.write(tx),
  verify:async(tx:Parameters<Prepared['write']>[0],staged:Staged)=>{await staged.relations.verify(tx,staged.history.pageId);await staged.ancillary?.verify(tx);},
  snapshot:(staged:Staged,context:NativeHostContext)=>candidateSnapshot(staged,context,options),
  captureAndCompare:options.captureAndCompare,
 };
 const host=createNativeMigrationHost({ports});
 const importOnly=async(context:NativeHostContext):Promise<NativeMigrationImportOnlyResult>=>{
  const input=await readNativeMigrationHostInputs(context),staged=await ports.stage(input);
  const result=await ports.transaction(input.recipe.authority,async tx=>{const imported=await ports.importHistory(tx,staged);await ports.verify(tx,staged);return imported;});
  return {stage:'imported-unsnapshotted',key:input.recipe.key,assemblySha256:input.recipe.assemblySha256,historyProjectionSha256:result.historyProjectionSha256,importResult:result,history:structuredClone(staged.history),identityPlan:structuredClone(staged.identityPlan),datasetIds:[...staged.datasetIds],reviewedRecipe:structuredClone(staged.reviewedRecipe),identityPreparation:structuredClone(staged.identityPreparation),identityPreparationPath:staged.identityPreparationPath};
 };
 return {importOnly,importAndPrepare:host.importAndPrepare,captureAndCompare:(context:Parameters<NativeMigrationBootstrapOptions['captureAndCompare']>[0])=>host.captureAndCompare({...context,candidateRecipePath:(context.imported as typeof context.imported&{cameraRecipePath?:string}).cameraRecipePath??context.candidateRecipePath})};
}
