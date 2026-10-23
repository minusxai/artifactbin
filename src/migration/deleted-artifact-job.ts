import {createHash} from 'node:crypto';
import {canonicalMigrationValue} from './verification-values.ts';
import {prepareDeletedArtifactPlan} from './deleted-artifact-plan.ts';
import {applyDeletedArtifactPlan,applyDeletedArtifactReplay} from './deleted-artifact-apply.ts';
import {PostgresMigrationDestination} from './postgres.ts';
import {PostgresDatasetMetadataDestination} from './dataset-destination.ts';
import {validateDeletedDatasetBatch,verifyDeletedDatasetAuthority,deletedDatasetBatchFingerprint} from './deleted-dataset-authority.ts';
import {verifyMigrationDatasetMetadata} from './dataset-verification.ts';
import {verifyDeletedMigrationRuntime} from './page-verification.ts';
import type {DeletedArtifactJobInput,RunDeletedArtifactJob,DeletedArtifactReplayManifest,DeletedArtifactReplayPageSource,ValidatedDeletedArtifactReplay,DeletedArtifactReplayPreflightBinding} from './deleted-artifact-job-contracts.ts';
import {validateDeletedArtifactReplay} from './deleted-artifact-replay.ts';
const sha=(value:unknown)=>createHash('sha256').update(canonicalMigrationValue(value)).digest('hex');
/** Pure preconnection check; execution uses fixed production writers and verifiers. */
export function validateDeletedArtifactJob(input:Omit<DeletedArtifactJobInput,'db'|'verifyProtectedPages'>):void {
 const {plan,admission,metadata}=input;
 const authority=validateDeletedDatasetBatch(metadata);
 if(authority.sourceNamespace!==plan.sourceNamespace || admission.sourceNamespace!==plan.sourceNamespace || input.destination.sourceNamespace!==plan.sourceNamespace || plan.admissionSha256!==sha(admission))throw Error('Deleted job source binding differs');
 const metadataVersions=metadata.metadata.pages.map(p=>({pageId:p.pageId,version:p.pageVersion})).sort((a,b)=>a.pageId.localeCompare(b.pageId)||a.version-b.version);
 if(plan.metadataBinding ? plan.metadataBinding.batchSha256!==deletedDatasetBatchFingerprint(metadata)||canonicalMigrationValue(plan.metadataBinding.pageVersions)!==canonicalMigrationValue(metadataVersions) : metadataVersions.length>0)throw Error("Deleted prepared metadata coverage differs");
 const metadataTuples=new Set(metadataVersions.map(p=>JSON.stringify([p.pageId,p.version])));
 for(const {page} of plan.pages){
  const requiredVersions=new Set([...(page.backends??[]).map(b=>b.pageVersion),...(page.serverQueries??[]).map(q=>q.pageVersion)]);
  if(page.original.format==="dataset")for(const revision of page.revisions)if(revision.conversion.classification!=="historical-unavailable")requiredVersions.add(revision.version);
  for(const version of requiredVersions)if(!metadataTuples.has(JSON.stringify([page.pageId,version])))throw Error("Deleted required metadata coverage missing");
 }
 const prepared=prepareDeletedArtifactPlan({admission,pages:plan.pages.map(p=>p.page),...(plan.metadataBinding?{preparedMetadata:metadata}:{}),protectedPageIds:new Set(authority.base.inventory.pageReceipts.map(p=>p.pageId))});
 if(canonicalMigrationValue(prepared)!==canonicalMigrationValue(plan))throw Error('Deleted job plan binding differs');
 const originals=new Map(plan.pages.flatMap(({page})=>page.revisions.map(r=>[JSON.stringify([page.legacyId,page.pageId,r.version]),sha(r.original)] as const)));
 for(const entry of authority.admitted) if(originals.get(JSON.stringify([entry.legacyId,entry.pageId,entry.version]))!==entry.artifactSha256)throw Error('Deleted metadata raw revision differs');
}
export const runDeletedArtifactJob:RunDeletedArtifactJob=async input=>{
 validateDeletedArtifactJob(input);
 const {db,destination,metadata,plan}=input;
 const pageDestination=new PostgresMigrationDestination(db,destination);
 const metadataDestination=new PostgresDatasetMetadataDestination(db,destination.schema,destination.ownershipOverride,input.sourceQueryRegistrations);
 return applyDeletedArtifactPlan({plan,maps:input.maps,destination:pageDestination,
  verifyProtectedState:async()=>{await verifyDeletedDatasetAuthority(db,destination.schema,metadata);await input.verifyProtectedPages();},
  importMetadata:async()=>{await metadataDestination.import(metadata);await verifyMigrationDatasetMetadata(db,destination.schema,metadata,destination.ownershipOverride,input.sourceQueryRegistrations);},
  verifyDeletedState:async()=>verifyDeletedMigrationRuntime(db,destination.schema,{maps:input.maps,origin:destination.origin,pages:(async function*(){for(const p of plan.pages)yield p.page;})()}),
 });
};

export interface DeletedArtifactReplayJobInput extends Omit<DeletedArtifactJobInput,'plan'> {
 manifest:DeletedArtifactReplayManifest;
 pageSource:DeletedArtifactReplayPageSource;
 preflight?:ValidatedDeletedArtifactReplay;
}

export type DeletedArtifactReplayPreflightInput=Omit<DeletedArtifactReplayJobInput,'db'|'verifyProtectedPages'|'preflight'>;
const replayPreflightBindings=new WeakMap<ValidatedDeletedArtifactReplay,DeletedArtifactReplayPreflightBinding>();

function replayBinding(input:DeletedArtifactReplayPreflightInput):DeletedArtifactReplayPreflightBinding{
 return {manifestSha256:sha(input.manifest),admissionSha256:sha(input.admission),metadataBatchSha256:deletedDatasetBatchFingerprint(input.metadata),mapsSha256:sha(input.maps),destinationSha256:sha(input.destination),sourceQueryRegistrationsSha256:sha(input.sourceQueryRegistrations??[]),pageSource:input.pageSource};
}

/** Pure async validation for callers that must refuse malformed control data before DB connection. */
export async function validateDeletedArtifactReplayJob(input:DeletedArtifactReplayPreflightInput):Promise<ValidatedDeletedArtifactReplay>{
 const {manifest,admission,metadata}=input;
 const authority=validateDeletedDatasetBatch(metadata);
 if(authority.sourceNamespace!==manifest.sourceNamespace||admission.sourceNamespace!==manifest.sourceNamespace||input.destination.sourceNamespace!==manifest.sourceNamespace||manifest.admissionSha256!==sha(admission))throw Error('Deleted job source binding differs');
 const metadataVersions=metadata.metadata.pages.map(p=>({pageId:p.pageId,version:p.pageVersion})).sort((a,b)=>a.pageId.localeCompare(b.pageId)||a.version-b.version);
 if(manifest.metadataBinding?manifest.metadataBinding.batchSha256!==deletedDatasetBatchFingerprint(metadata)||canonicalMigrationValue(manifest.metadataBinding.pageVersions)!==canonicalMigrationValue(metadataVersions):metadataVersions.length>0)throw Error('Deleted prepared metadata coverage differs');
 const metadataTuples=new Set(metadataVersions.map(p=>JSON.stringify([p.pageId,p.version])));
 const rawAuthority=new Map(authority.admitted.map(row=>[JSON.stringify([row.legacyId,row.pageId,row.version]),row.artifactSha256]));
 const seenAuthority=new Set<string>();
 const protectedPageIds=new Set(authority.base.inventory.pageReceipts.map(p=>p.pageId));
 const validated=await validateDeletedArtifactReplay({manifest,admission,source:input.pageSource,protectedPageIds,onPage:page=>{
  if(input.maps.pages[page.legacyId]!==page.pageId)throw Error('Deleted artifact plan map binding differs');
  const requiredVersions=new Set([...(page.backends??[]).map(b=>b.pageVersion),...(page.serverQueries??[]).map(q=>q.pageVersion)]);
  if(page.original.format==='dataset')for(const revision of page.revisions)if(revision.conversion.classification!=='historical-unavailable')requiredVersions.add(revision.version);
  for(const version of requiredVersions)if(!metadataTuples.has(JSON.stringify([page.pageId,version])))throw Error('Deleted required metadata coverage missing');
  for(const revision of page.revisions){
   const key=JSON.stringify([page.legacyId,page.pageId,revision.version]);
   if(rawAuthority.get(key)!==sha(revision.original))throw Error('Deleted metadata raw revision differs');
   seenAuthority.add(key);
  }
 }});
 if(seenAuthority.size!==rawAuthority.size)throw Error('Deleted metadata raw revision coverage differs');
 replayPreflightBindings.set(validated,replayBinding(input));
 return validated;
}

/** Executes a preflighted complete manifest, rechecking immutable pages before each use. */
export const runDeletedArtifactReplayJob=async(input:DeletedArtifactReplayJobInput)=>{
 const {manifest,admission,metadata}=input;
 const validated=input.preflight??await validateDeletedArtifactReplayJob(input);
 const expectedBinding=replayPreflightBindings.get(validated);
 const currentBinding=replayBinding(input);
 if(!expectedBinding||expectedBinding.pageSource!==input.pageSource||canonicalMigrationValue({...expectedBinding,pageSource:undefined})!==canonicalMigrationValue({...currentBinding,pageSource:undefined}))throw Error('Deleted replay preflight binding changed');
 const {db,destination}=input;
 const pageDestination=new PostgresMigrationDestination(db,destination);
 for await(const {page} of validated.pages())if(!pageDestination.supportsExactDeletedAccess(page))throw Error('Destination cannot preserve exact deleted artifact access');
 const metadataDestination=new PostgresDatasetMetadataDestination(input.db,input.destination.schema,input.destination.ownershipOverride,input.sourceQueryRegistrations);
 return applyDeletedArtifactReplay({validated,maps:input.maps,destination:pageDestination,
  verifyProtectedState:async()=>{await verifyDeletedDatasetAuthority(input.db,input.destination.schema,metadata);await input.verifyProtectedPages();},
  importMetadata:async()=>{await metadataDestination.import(metadata);await verifyMigrationDatasetMetadata(input.db,input.destination.schema,metadata,input.destination.ownershipOverride,input.sourceQueryRegistrations);},
  verifyDeletedState:async(_manifest,pages)=>verifyDeletedMigrationRuntime(input.db,input.destination.schema,{maps:input.maps,origin:input.destination.origin,pages}),
 });
};
