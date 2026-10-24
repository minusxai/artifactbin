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
