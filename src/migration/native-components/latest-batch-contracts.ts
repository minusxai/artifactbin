import type { NativeRevisionKey, NativeSelectedRevision } from './contracts.ts';
export interface LatestHeadPreparation {
 key: NativeRevisionKey; sourceRowSha256: string;
 sourceFile: {path: string; sha256: string; bytes: number};
 ownerPlanRef: {sha256: string; sourceUserId: string; targetUserId: string; sourceTokenId: string | null; targetTokenId: string | null};
 unresolvedReferences: readonly unknown[];
}
export interface LatestBatchPreparation {
 format: 'native-latest-batch-preparation-v1'; stage: 'preparation-only'; revisionScope: 'latest';
 batch: number; batchCount: number; approvalManifestSha256: string; identityPlanSha256: string;
 sharedPreparation: {path: string; sha256: string; batchMayPrepareSharedResources: false};
 heads: readonly LatestHeadPreparation[]; sha256: string;
}
export interface LatestSharedVerification {
 format: 'native-latest-shared-verified-v1'; stage: 'preparation-only';
 indexSha256: string; sharedSha256: string; identityPlanSha256: string;
 batches: readonly {batch: number; sha256: string; heads: number}[];
 verifiedObjects: number; sha256: string;
}
export interface LatestPreparedHead {
 key: NativeRevisionKey; revision: NativeSelectedRevision;
 status: 'prepared-input' | 'source-analysis-blocked';
 evidence: unknown; sourceLimitations: readonly unknown[];
 assemblyStatus: 'not-assembled';
}

export interface LatestAssemblyAttempt {
 key: NativeRevisionKey;
 receipt: import('./v3-publication-contracts.ts').NativeV3AssemblyReceipt;
 status: 'assembled' | 'assembly-blocked';
 /** A complete assembly still requires publication, authority and paired UI evidence. */
 verificationStatus: 'not-verified';
}
/** Previously prepared inputs are reusable only under exact source and compiler pins. */
export type LatestPreparedReuse = (head: LatestHeadPreparation) => Promise<(LatestPreparedHead & {sha256:string}) | undefined>;
