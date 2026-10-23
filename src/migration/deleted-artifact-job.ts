import {createHash} from 'node:crypto';
import {canonicalMigrationValue} from './verification-values.ts';
import {prepareDeletedArtifactPlan} from './deleted-artifact-plan.ts';
import {applyDeletedArtifactPlan} from './deleted-artifact-apply.ts';
import {PostgresMigrationDestination} from './postgres.ts';
import {PostgresDatasetMetadataDestination} from './dataset-destination.ts';
import {validateDeletedDatasetBatch,verifyDeletedDatasetAuthority} from './deleted-dataset-authority.ts';
import {verifyMigrationDatasetMetadata} from './dataset-verification.ts';
import {verifyDeletedMigrationRuntime} from './page-verification.ts';
import type {DeletedArtifactJobInput,RunDeletedArtifactJob} from './deleted-artifact-job-contracts.ts';
const sha=(value:unknown)=>createHash('sha256').update(canonicalMigrationValue(value)).digest('hex');
/** Pure preconnection check; execution uses fixed production writers and verifiers. */
export function validateDeletedArtifactJob(input:Omit<DeletedArtifactJobInput,'db'|'verifyProtectedPages'>):void {
 const {plan,admission,metadata}=input;
 const authority=validateDeletedDatasetBatch(metadata);
 if(authority.sourceNamespace!==plan.sourceNamespace || admission.sourceNamespace!==plan.sourceNamespace || input.destination.sourceNamespace!==plan.sourceNamespace || plan.admissionSha256!==sha(admission))throw Error('Deleted job source binding differs');
 const prepared=prepareDeletedArtifactPlan({admission,pages:plan.pages.map(p=>p.page),protectedPageIds:new Set(authority.base.inventory.pageReceipts.map(p=>p.pageId))});
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
