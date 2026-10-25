/** Reviewed operator only. Never activates a deployment or opens a target during dry-run. */
import {verifyReviewedComparison} from './native-reviewed-comparison.mjs';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {S3_URL} from '../../services/app/lib/platform/config';
import {objectStore} from '../../services/app/lib/object-store';
import {parseS3Url} from '../../services/app/lib/object-store/url';
import {mintToken,revokeToken,MIN_TOKEN_TTL_MS,MAX_TOKEN_TTL_MS} from '../../services/app/lib/accounts';
import {identityForUser} from '../../services/app/lib/accounts';
import {authorizeNativeIdentityTransaction,writeNativeIdentities} from '../../services/app/lib/native-identity-import';
import {prepareNativeAncillaryFolders} from '../../services/app/lib/native-ancillary-folders';
import {createNativeS3ObjectSink} from '../../services/app/lib/native-history-import/catalog-staging';
import {nativeProductPublicationModules} from './native-migration-bootstrap';
import {prepareNativeProductImport,prepareNativeProductRuntime} from './native-migration-product-host';
import {readNativeMigrationHostInputs,verifyNativeMigrationHostComparison} from './native-migration-host.mjs';
import {preparedPilotStoreDigest as digest} from './native-prepared-pilot-store.mjs';
import type {NativeProductionOptions,NativeProductionPlan,NativeProductionBatch} from './native-migration-production-contract';
import type {NativeHostContext,NativeHostPrepared,NativeHostComparison} from './native-migration-host-contract';
import type {NativeIdentityImport} from '../../services/app/lib/native-identity-import/contracts';
import type {NativeProductImportRecipe,NativeSerializedProductImportRecipe} from './native-migration-product-host-contract';
import type {NativeAncillaryFolderRecipe} from '../../services/app/lib/native-ancillary-folders/contracts';
const sha=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=(code:string):never=>{throw Error('native_production_'+code);};
const sealed=(value:{sha256:string})=>{const {sha256,...payload}=value;return hash(sha256)&&digest(payload)===sha256;};
const prefix=(value:string)=>typeof value==='string'&&!!value&&!value.startsWith('/')&&!value.endsWith('/')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const overlap=(a:string,b:string)=>a===b||a.startsWith(b+'/')||b.startsWith(a+'/')||!a||!b;
async function immutable(file:string,value:unknown){const bytes=JSON.stringify(value);try{await writeFile(file,bytes,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||await readFile(file,'utf8')!==bytes)fail('receipt_collision');}}
/** All paths in sealed manifests are relative and checked through realpath. */
export async function runNativeProductionMigration(options:NativeProductionOptions){
 try{return await executeNativeProductionMigration(options);}catch(error){const message=(error as Error)?.message;if(typeof message==='string'&&/^native[_-][a-z0-9_-]+$/.test(message))throw error;throw Error('native_production_operation_failed');}
}
async function executeNativeProductionMigration(options:NativeProductionOptions){
 const root=await realpath(options.receiptRoot);
 const bound=async<T>(ref:{path:string;sha256:string}):Promise<T>=>{if(!ref||!hash(ref.sha256)||typeof ref.path!=='string'||path.isAbsolute(ref.path))fail('input');const file=await realpath(path.resolve(root,ref.path));if(!file.startsWith(root+path.sep))fail('input_scope');const bytes=await readFile(file);if(sha(bytes)!==ref.sha256)fail('input_digest');return JSON.parse(bytes.toString()) as T;};
 const plan=JSON.parse(await readFile(options.planPath,'utf8')) as NativeProductionPlan;
 if(plan.format!=='native-production-plan-v1'||plan.revisionScope!=='latest'||!sealed(plan)||!plan.sourceNamespace)fail('plan');
 const targetScope=plan.target;
 if(plan.runtimeAuthority&&(plan.runtimeAuthority.mode!=='scoped-internal-tokens'||!Number.isFinite(plan.runtimeAuthority.ttlMs)||plan.runtimeAuthority.ttlMs<MIN_TOKEN_TTL_MS||plan.runtimeAuthority.ttlMs>MAX_TOKEN_TTL_MS))fail('token_policy');
 if(!targetScope||![targetScope.appSchema,targetScope.authSchema].every(value=>/^[a-z_][a-z0-9_]{0,62}$/.test(value))||targetScope.appSchema===targetScope.authSchema||!hash(targetScope.bucketSha256)||!hash(targetScope.originSha256)||!prefix(targetScope.objectPrefix)||!targetScope.protectedSchemas?.length||!targetScope.protectedObjects?.length||targetScope.protectedSchemas.includes(targetScope.appSchema)||targetScope.protectedSchemas.includes(targetScope.authSchema)||targetScope.protectedObjects.some(old=>old.bucketSha256===targetScope.bucketSha256&&overlap(old.prefix,targetScope.objectPrefix)))fail('target_scope');
 const [selection,census,identity,folders]=await Promise.all([bound<{receipts:{id:string}[]}>(plan.selectionManifest),bound<{datasets:{id:string}[]}>(plan.datasetCensus),bound<NativeIdentityImport>(plan.identity),plan.ancillaryFolders?bound<NativeAncillaryFolderRecipe>(plan.ancillaryFolders):undefined]);
 const ids=plan.heads?.map(head=>head.key.sourceId),selected=selection.receipts?.map(row=>row.id),datasets=census.datasets?.map(row=>row.id);
 if(ids?.length!==393||new Set(ids).size!==393||selected?.length!==393||new Set(selected).size!==393||datasets?.length!==190||new Set(datasets).size!==190||ids.some(id=>!selected.includes(id))||plan.heads.some(head=>head.key.sourceNamespace!==plan.sourceNamespace||!Number.isSafeInteger(head.key.version)||head.key.version<1||!hash(head.canonicalSha256))||identity.plan?.sourceNamespace!==plan.sourceNamespace)fail('global_scope');
 const assigned=plan.batches?.flatMap(batch=>batch.sourceIds);
 if(!plan.batches?.length||new Set(plan.batches.map(batch=>batch.id)).size!==plan.batches.length||plan.batches.some(batch=>!/^[-A-Za-z0-9_]{1,80}$/.test(batch.id)||!batch.sourceIds.length)||assigned?.length!==393||new Set(assigned).size!==393||assigned.some(id=>!ids.includes(id)))fail('batch_partition');
 const batch=JSON.parse(await readFile(options.batchPath,'utf8')) as NativeProductionBatch;
 const assignment=plan.batches.find(item=>item.id===batch.id);
 if(batch.format!=='native-production-batch-v1'||!assignment||batch.batchSourceIds?.some(id=>!assignment.sourceIds.includes(id))||!sealed(batch)||batch.planSha256!==plan.sha256||!batch.batchSourceIds?.length||new Set(batch.batchSourceIds).size!==batch.batchSourceIds.length||batch.batchSourceIds.some(id=>!ids.includes(id))||batch.heads?.length!==batch.batchSourceIds.length||new Set(batch.heads.map(head=>head.sourceId)).size!==batch.heads.length||batch.heads.some(head=>!batch.batchSourceIds.includes(head.sourceId)))fail('batch');
 // Only this disjoint selected batch needs complete gate evidence; no target is open yet.
 const admitted:{head:NativeProductionBatch['heads'][number];context:NativeHostContext;input:Awaited<ReturnType<typeof readNativeMigrationHostInputs>>;capability:{runtime:{origin:string;actor:{userId:string;tokenId:string}}}}[]=[];
 for(const head of batch.heads){
  const [encodedContext,imported,comparison]=await Promise.all([bound<NativeHostContext>(head.context),bound<NativeHostPrepared>(head.imported),bound<NativeHostComparison>(head.comparison)]);
  const context=options.decodeContext?options.decodeContext(encodedContext):encodedContext;
  const selectedHead=plan.heads.find(value=>value.key.sourceId===head.sourceId)!;
  if(!isDeepStrictEqual(context.revision.key,selectedHead.key)||!isDeepStrictEqual(context.assembly.key,selectedHead.key)||imported.stage!=='imported'||!isDeepStrictEqual(imported.key,selectedHead.key)||imported.assemblySha256!==context.assembly.sha256||!hash(imported.historyProjectionSha256)||(!head.reviewedDecision&&comparison.status!=='verified'))fail('head_scope');
  const input=await readNativeMigrationHostInputs(context);
  if(input.recipe.inputs.sourceHead.sha256!==selectedHead.canonicalSha256||!isDeepStrictEqual(input.recipe.authority&&{appSchema:input.recipe.authority.appSchema,authSchema:input.recipe.authority.authSchema},{appSchema:targetScope.appSchema,authSchema:targetScope.authSchema})||!isDeepStrictEqual(JSON.parse(Buffer.from(input.files.identity).toString()),identity))fail('head_scope');
  if(head.reviewedDecision)await verifyReviewedComparison({root,ref:head.reviewedDecision,approvedSha256:options.approvedReviewedDecisionSha256??[],context:{...context,imported},recipe:input.recipe,result:comparison});
  else await verifyNativeMigrationHostComparison({context:{...context,imported},recipe:input.recipe,result:comparison});
  const capability=JSON.parse(Buffer.from(input.files.authSchemaCapability).toString());
  if(!isDeepStrictEqual(capability.schemas,{appSchema:targetScope.appSchema,authSchema:targetScope.authSchema})||sha(capability.runtime?.origin??'')!==targetScope.originSha256)fail('runtime_scope');
  admitted.push({head,context,input,capability});
 }
 await mkdir(options.outputDirectory,{recursive:true,mode:0o700});
 const scopeSha256=digest(targetScope);
 if(options.apply!==true){const receipt={format:'native-production-dry-run-v1',planSha256:plan.sha256,batchSha256:batch.sha256,scopeSha256,globalPages:393,globalDatasets:190,batchPages:admitted.length,targetOpened:false,targetWrites:0};await immutable(path.join(options.outputDirectory,'dry-run-'+batch.sha256+'.json'),receipt);return receipt;}
 if(options.approvedPlanSha256!==plan.sha256)fail('approval_required');
 const target=await options.openTarget(plan),createdTokens:string[]=[],runtimeTokens=new Map<string,string>();
 const tokenAuthority=options.tokenAuthority??{mint:async(tx,userId,ttlMs)=>(await mintToken('native-migration',userId,tx,{expiresInMs:ttlMs})).id,revoke:async(id)=>{await revokeToken(id);}};
 try{
  if(target.db.raw().kind!=='pg'||sha(target.s3.bucket)!==targetScope.bucketSha256||target.s3.prefix!==targetScope.objectPrefix||target.runtimeStorage.bucket!==target.s3.bucket||target.runtimeStorage.prefix!==target.s3.prefix||sha(target.origin)!==targetScope.originSha256)fail('opened_target_scope');
  // Normal runtime staging uses the process singleton; never initialize an unreviewed DB here.
  const runtime=options.runtimeBinding??(global.__artifact_bin_db__&&S3_URL?{db:global.__artifact_bin_db__,storage:parseS3Url(S3_URL),backend:objectStore().backend}:undefined);
  if(!runtime||await runtime.db!==target.db||runtime.backend!=='s3'||runtime.storage.bucket!==target.s3.bucket||runtime.storage.prefix!==target.s3.prefix)fail('runtime_binding');
  const schemas={appSchema:targetScope.appSchema,authSchema:targetScope.authSchema};
  const origin=(()=>{try{return new URL(target.origin);}catch{return fail('opened_target_scope');}})();
  if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)fail('opened_target_scope');
  const preparation=await target.db.transaction(async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',['native-prerequisite:'+targetScope.appSchema+':'+identity.plan.sha256]);
   const authority=await authorizeNativeIdentityTransaction(tx,schemas);
   const preparedIdentities=!options.preparePrerequisites?await writeNativeIdentities(tx,identity,authority):undefined;
   if(plan.runtimeAuthority){for(const item of admitted){const source=JSON.parse(Buffer.from(item.input.files.sourceHead).toString()),head=source.heads?.find((row:{id:string;version:number})=>row.id===item.context.revision.key.sourceId&&row.version===item.context.revision.key.version),userId=identity.plan.targets.users[head?.user_id]?.userId;if(!userId||item.capability.runtime?.actor?.userId!==userId)fail('runtime_actor');if(!runtimeTokens.has(userId)){const id=await tokenAuthority.mint(tx,userId,plan.runtimeAuthority.ttlMs);createdTokens.push(id);runtimeTokens.set(userId,id);}}}
   if(options.preparePrerequisites)return options.preparePrerequisites(tx,identity,folders,schemas);
   const identities=preparedIdentities!,ancillary=folders?prepareNativeAncillaryFolders(folders,identity.plan,folders.identityGroups??{}):undefined;
   const applied=ancillary?await ancillary.apply(tx):undefined;await ancillary?.verify(tx);return {identities,...(applied?{ancillaryFolders:{sourceSha256:ancillary!.sourceSha256,...applied}}:{})};
  });
  // This committed prerequisite survives later failures; never claim whole-run rollback.
  const preparationPath=path.join(options.outputDirectory,'prerequisite-'+batch.sha256+'.json');let priorPreparation:Record<string,unknown>|undefined;try{priorPreparation=JSON.parse(await readFile(preparationPath,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')fail('prerequisite_receipt');}
  if(priorPreparation&&(priorPreparation.planSha256!==plan.sha256||priorPreparation.batchSha256!==batch.sha256||priorPreparation.scopeSha256!==scopeSha256))fail('prerequisite_receipt');
  if(!priorPreparation)await immutable(preparationPath,{format:'native-production-prerequisite-v1',planSha256:plan.sha256,batchSha256:batch.sha256,scopeSha256,transaction:'separate-prerequisite',preparation,...(createdTokens.length?{internalTokenIds:createdTokens}: {})});
  const sink=(options.sinkFactory??createNativeS3ObjectSink)(target.s3),receipts=[];
  for(const item of admitted){
   const {context,input,capability,head}=item,reviewedActor=capability.runtime?.actor,actor=plan.runtimeAuthority?{userId:reviewedActor?.userId,tokenId:runtimeTokens.get(reviewedActor?.userId)}:reviewedActor;
   if(!actor||Object.keys(actor).some(key=>!['userId','tokenId'].includes(key))||typeof actor.userId!=='string'||typeof actor.tokenId!=='string')fail('runtime_actor');
   const source=JSON.parse(Buffer.from(input.files.sourceHead).toString()),sourceHeads=source.heads?.filter((row:{id:string;version:number})=>row.id===context.revision.key.sourceId&&row.version===context.revision.key.version);
   if(sourceHeads?.length!==1||identity.plan.targets.users[sourceHeads[0].user_id]?.userId!==actor.userId||(await target.db.query<{user_id:string}>('SELECT user_id FROM tokens WHERE id=$1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>now())',[actor.tokenId])).rows[0]?.user_id!==actor.userId)fail('runtime_actor');
   const runtimeActor=identityForUser(actor.userId,actor.tokenId!);
   const prepareRuntime:Parameters<typeof target.publication>[0]['prepareRuntime']=(assemblies,runtimeOptions)=>prepareNativeProductRuntime(assemblies,{...runtimeOptions,actor:runtimeActor,origin:target.origin});
   const publicationPath=path.join(options.outputDirectory,'publication-'+digest(context.revision.key)+'-'+context.assembly.sha256+'-'+head.comparison.sha256+(head.reviewedDecision?'-'+head.reviewedDecision.sha256:'')+'.json');
   let publicationReceipt:{format:string;planSha256:string;assemblySha256:string;comparisonSha256:string;reviewedDecisionSha256?:string;recipe:NativeSerializedProductImportRecipe;sha256:string}|undefined;
   try{publicationReceipt=JSON.parse(await readFile(publicationPath,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')fail('publication_receipt');}
   if(publicationReceipt&&(!sealed(publicationReceipt)||publicationReceipt.format!=='native-production-publication-v1'||publicationReceipt.planSha256!==plan.sha256||publicationReceipt.assemblySha256!==context.assembly.sha256||publicationReceipt.comparisonSha256!==head.comparison.sha256||publicationReceipt.reviewedDecisionSha256!==head.reviewedDecision?.sha256))fail('publication_receipt');
   let raw:NativeProductImportRecipe|NativeSerializedProductImportRecipe;
   if(publicationReceipt)raw=publicationReceipt.recipe;
   else{
    raw=await target.publication({context,reviewedRecipe:input.recipe,files:input.files,prepareRuntime,publicationModules:nativeProductPublicationModules});
    const source=raw.membership?.source,encoded=source?Object.fromEntries(Object.entries(source).map(([key,value])=>[key,value instanceof Uint8Array?{encoding:'base64',data:Buffer.from(value).toString('base64'),sha256:sha(value)}:value])):undefined;
    const recipe={...raw,...(encoded?{membership:{...raw.membership,source:encoded}}:{})} as NativeSerializedProductImportRecipe;
    const payload={format:'native-production-publication-v1',planSha256:plan.sha256,assemblySha256:context.assembly.sha256,comparisonSha256:head.comparison.sha256,...(head.reviewedDecision?{reviewedDecisionSha256:head.reviewedDecision.sha256}:{}),recipe};
    await immutable(publicationPath,{...payload,sha256:digest(payload)});
   }

   if(folders&&!isDeepStrictEqual(raw.identityGroups??{},folders.identityGroups??{}))fail('publication_scope');
   if(!isDeepStrictEqual(raw.identity,identity)||!isDeepStrictEqual(raw.schemas,schemas)||raw.history.sourceNamespace!==plan.sourceNamespace||raw.history.sourceId!==head.sourceId||raw.history.headVersion!==context.revision.key.version||raw.history.revisions.length!==1||raw.catalog.projection.datasets.some(dataset=>!datasets.includes(dataset.sourceId)))fail('publication_scope');
   const prepared=await (options.prepareImport??prepareNativeProductImport)(raw,{catalogSink:sink});
   const file=path.join(options.outputDirectory,'head-'+digest(context.revision.key)+'-'+context.assembly.sha256+'-'+head.comparison.sha256+(head.reviewedDecision?'-'+head.reviewedDecision.sha256:'')+'.json');
   let previous:Record<string,unknown>|undefined;try{previous=JSON.parse(await readFile(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   if(previous&&(previous.planSha256!==plan.sha256||previous.scopeSha256!==scopeSha256||previous.assemblySha256!==context.assembly.sha256||previous.reviewedDecisionSha256!==head.reviewedDecision?.sha256))fail('receipt_collision');
   const result=await target.db.transaction(async tx=>{
    for(const id of [...new Set(raw.catalog.projection.datasets.map(dataset=>dataset.targetId))].sort())await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',['native-dataset:'+targetScope.appSchema+':'+id]);
    const written=await prepared.write(tx);await prepared.relations.verify(tx,prepared.history.pageId);if(folders)await prepareNativeAncillaryFolders(folders,identity.plan,folders.identityGroups??{}).verify(tx);
    if(previous&&written.disposition!=='unchanged')fail('receipt_target_diverged');return written;
   });
   const receipt=previous??{format:'native-production-head-v1',planSha256:plan.sha256,scopeSha256,key:context.revision.key,assemblySha256:context.assembly.sha256,comparisonSha256:head.comparison.sha256,...(head.reviewedDecision?{reviewedDecisionSha256:head.reviewedDecision.sha256}:{}),result};
   await immutable(file,receipt);receipts.push({path:file,sha256:sha(await readFile(file)),replayed:!!previous});
  }
  const receipt={format:'native-production-batch-result-v1',planSha256:plan.sha256,batchSha256:batch.sha256,scopeSha256,globalPages:393,globalDatasets:190,batchPages:receipts.length,receipts};
  // A new immutable summary accompanies each invocation; individual head receipts are the resume ledger.
  await immutable(path.join(options.outputDirectory,'batch-'+batch.sha256+'-'+digest(receipt)+'.json'),receipt);return receipt;
 }finally{try{const cleanup=await Promise.allSettled(createdTokens.map(id=>tokenAuthority.revoke(id)));if(createdTokens.length)await immutable(path.join(options.outputDirectory,'internal-tokens-'+digest(createdTokens)+'.json'),{format:'native-production-internal-tokens-v1',planSha256:plan.sha256,batchSha256:batch.sha256,tokens:createdTokens.map((id,index)=>({id,revoked:cleanup[index].status==='fulfilled'}))});if(cleanup.some(result=>result.status==='rejected'))fail('token_cleanup_failed');}finally{await target.close();}}
}
