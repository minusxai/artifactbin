/** Shared actual host composition. Converter projection is the only injected source adapter. */
import type {PGlite} from '@electric-sql/pglite';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {htmlCommentNodes} from '../../services/app/lib/annotations/html-anchor';
import {canonicalizeHtmlPage} from '../../services/app/lib/html-page';
import {prepareRegisteredQueryBackend,registeredPlan} from '../../services/app/lib/registered-page-queries/registry';
import {prepareRegisteredMutationBackend,registeredMutationPlan} from '../../services/app/lib/registered-page-mutations';
import {createNativeMigrationHost} from './native-migration-host.mjs';
import {prepareNativeMigrationSnapshot} from './native-migration-snapshot.mjs';
import {validatePilotInputs} from './native-migration-pilot.mjs';
import {prepareNativeProductImport,prepareNativeProductRuntime} from './native-migration-product-host';
import type {NativeMigrationBootstrapOptions} from './native-migration-bootstrap-contract';
import type {NativeHostContext,NativeHostRecipe} from './native-migration-host-contract';
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
/** Actual target validators and comment node extraction; no converter package import. */
export const nativeProductPublicationModules={commentNodeIds:(html:string)=>[...htmlCommentNodes(html).keys()],canonicalizeHtmlPage,prepareRegisteredQueryBackend,registeredPlan,prepareRegisteredMutationBackend,registeredMutationPlan};
type Prepared=Awaited<ReturnType<typeof prepareNativeProductImport>>;
type Staged=Prepared&{reviewedRecipe:NativeHostRecipe};
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
 return {...snapshot,pilotInputPath,canonicalPath,recoveryPath,cameraRecipePath};
}
/** One configured product host runs all sources through the same transaction/snapshot/camera path. */
export function createNativeProductMigrationHost(rawOptions:NativeMigrationBootstrapOptions){
 const options={...rawOptions};
 const host=createNativeMigrationHost({ports:{
  stage:async({context,recipe,files}:{context:NativeHostContext;recipe:Parameters<NativeMigrationBootstrapOptions['publication']>[0]['reviewedRecipe'];files:Parameters<NativeMigrationBootstrapOptions['publication']>[0]['files']})=>{
   const raw=await options.publication({context,reviewedRecipe:structuredClone(recipe),files,prepareRuntime:prepareNativeProductRuntime,publicationModules:nativeProductPublicationModules});
   if(raw.history.sourceNamespace!==context.revision.key.sourceNamespace||raw.history.sourceId!==context.revision.key.sourceId||raw.history.headVersion!==context.revision.key.version||!isDeepStrictEqual(raw.schemas,{appSchema:recipe.authority.appSchema,authSchema:recipe.authority.authSchema}))throw Error('native_bootstrap_publication_binding');
   await mkdir(options.objectsDirectory,{recursive:true,mode:0o700});await mkdir(raw.catalog.sinkDirectory,{recursive:true,mode:0o700});
   if(await realpath(raw.catalog.sinkDirectory)!==await realpath(options.objectsDirectory))throw Error('native_bootstrap_object_scope');
   const prepared=await prepareNativeProductImport(raw);
   return {...prepared,reviewedRecipe:structuredClone(recipe)};
  },
  transaction<T>(_authority:unknown,work:(tx:Parameters<Prepared['write']>[0])=>Promise<T>){return options.db.transaction(work);},
  importHistory:(tx:Parameters<Prepared['write']>[0],staged:Prepared)=>staged.write(tx),
  verify:(tx:Parameters<Prepared['write']>[0],staged:Prepared)=>staged.relations.verify(tx,staged.history.pageId),
  snapshot:(staged:Staged,context:NativeHostContext)=>candidateSnapshot(staged,context,options),
  captureAndCompare:options.captureAndCompare,
 }});
 return {importAndPrepare:host.importAndPrepare,captureAndCompare:(context:Parameters<NativeMigrationBootstrapOptions['captureAndCompare']>[0])=>host.captureAndCompare({...context,candidateRecipePath:(context.imported as typeof context.imported&{cameraRecipePath?:string}).cameraRecipePath??context.candidateRecipePath})};
}
