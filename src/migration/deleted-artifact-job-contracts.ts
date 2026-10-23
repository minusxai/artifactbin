import type {SqlReader,MigrationMaps} from './contracts.ts';
import type {DeletedArtifactAdmission,DeletedArtifactPlan,DeletedArtifactApplyResult} from './deleted-artifact-contracts.ts';
import type {DatasetMigrationBatch} from './dataset-destination-contracts.ts';
import type {DestinationOptions} from './postgres-contracts.ts';
import type {PlannedPage} from './contracts.ts';

/** A reference to one immutable, persisted JSON plan entry. */
export interface DeletedArtifactReplayPageRef {
 legacyId:string;
 pageId:string;
 bytes:number;
 sha256:string;
}

/** Small complete manifest for plans whose page bodies must stay out of memory. */
export interface DeletedArtifactReplayManifest {
 kind:'deleted-artifact-replay-plan-v1';
 sourceNamespace:string;
 archiveDigest:string;
 admissionSha256:string;
 metadataBinding?:{batchSha256:string;pageVersions:readonly {pageId:string;version:number}[]};
 pageCount:number;
 revisionCount:number;
 canonicalPlanSha256:string;
 pages:readonly DeletedArtifactReplayPageRef[];
}

/** Replayable byte source. Bytes use serializeDeletedArtifactReplayPage's lossless JSON codec. */
export interface DeletedArtifactReplayPageSource {
 read(reference:DeletedArtifactReplayPageRef):Promise<Uint8Array>;
}

export interface DeletedArtifactReplayPageEntry {page:PlannedPage;digest:string}
export interface ValidatedDeletedArtifactReplay {
 manifest:DeletedArtifactReplayManifest;
 publications:readonly Omit<import('./inactive-publication-contracts.ts').DeletedMigrationPublicationContext,'schema'>[];
 pages():AsyncGenerator<DeletedArtifactReplayPageEntry>;
}
export interface DeletedArtifactReplayPreflightBinding {
 manifestSha256:string;
 admissionSha256:string;
 metadataBatchSha256:string;
 mapsSha256:string;
 destinationSha256:string;
 sourceQueryRegistrationsSha256:string;
 pageSource:DeletedArtifactReplayPageSource;
}
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
