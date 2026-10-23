import type {SqlReader,MigrationMaps} from './contracts.ts';
import type {DeletedArtifactAdmission,DeletedArtifactPlan,DeletedArtifactApplyResult} from './deleted-artifact-contracts.ts';
import type {DatasetMigrationBatch} from './dataset-destination-contracts.ts';
import type {DestinationOptions} from './postgres-contracts.ts';
export interface DeletedArtifactJobInput {
 db:SqlReader;
 destination:DestinationOptions;
 admission:DeletedArtifactAdmission;
 plan:DeletedArtifactPlan;
 maps:MigrationMaps;
 metadata:DatasetMigrationBatch;
 sourceQueryRegistrations?:readonly import("../datasets/source-query/contracts.ts").MigrationSourceQueryRegistration[];
 /** Independent sealed existing page state; metadata protection is additionally fixed by the factory. */
 verifyProtectedPages():Promise<void>;
}
export type RunDeletedArtifactJob=(input:DeletedArtifactJobInput)=>Promise<DeletedArtifactApplyResult>;
