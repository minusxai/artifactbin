import type {Queryable} from '@artifactbin/contracts';
export interface NativeAncillaryEncodedBytes {encoding:'base64';data:string;sha256:string}
export interface NativeLineageApproval {
 identityPlanSha256:string;sourceInventorySha256:string;targetInventorySha256:string;
 approvedBy:string;reason:string;sourceId:string;targetId:string;sourceRowSha256:string;
 targetArtifactCollision:false;targetReservationCollision:false;importAncestor:false;sha256:string;
}
export interface NativeLineageSelection {
 selectionSha256:string;datasetCensusSha256:string;pageSourceIdsSha256:string;datasetSourceIdsSha256:string;pageCount:393;datasetCount:190;
}
export interface NativeAncillaryFolderRecipe {
 schema:'native-reviewed-ancillary-folders-v1';sourceNamespace:string;
 parentIdentityPlanSha256:string;identityPlanSha256:string;identityGroups?:Readonly<Record<string,string>>;
 selection:NativeLineageSelection;
 source:{capture:NativeAncillaryEncodedBytes;selectionManifest:NativeAncillaryEncodedBytes;datasetCensus:NativeAncillaryEncodedBytes;sourceInventory:Record<string,unknown>;targetInventory:Record<string,unknown>};
 approvals:readonly NativeLineageApproval[];
 folders:readonly {sourceId:string;targetId:string;sourceRowSha256:string;sourceInventoryRowSha256:string;requiredBy:readonly string[];row:Record<string,unknown>;shares:readonly {email:string;role:string;userId?:string|null;createdAt?:string}[]}[];
 /** Raw evidence + exact projection receipt. It grants no database or existence authority. */
 sha256:string;
}

/** Offline operator stage only. No connection, identity creation, page or history writes. */
export interface NativePreparedAncillaryFolders {
 readonly sourceSha256:string;
 apply(tx:Queryable):Promise<{created:string[];unchanged:string[]}>;
 verify(tx:Queryable):Promise<void>;
}
