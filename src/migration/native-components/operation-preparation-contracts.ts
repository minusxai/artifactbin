import type {NativeSelectedRevision} from './contracts.ts';
import type {NativeTypedAnalysis} from './analyze-contracts.ts';
import type {NativeFlowCompilationResult,NativeSerializedFlowInput,NativeCachedCatalogReceipt} from './operation-producer-contracts.ts';
import type {NativePipelineOperationRecipe} from './pipeline-contracts.ts';
/** Raw approved source capture; a schema is never reconstructed from a probe inventory or target rows. */
export interface NativeOperationCatalogCapture {
 sourceId:string;version:number;headSha256:string;catalogSha256:string;policySha256:string;
 source:{bytes:Uint8Array;sha256:string};
}
export interface NativeOperationPreparationInput {
 revision:NativeSelectedRevision;analysis:NativeTypedAnalysis;
 targetOrigin:string;artifactIds:Readonly<Record<string,string>>;probeClockIso:string;
 catalogs:readonly NativeOperationCatalogCapture[];
 /** Only exact previously captured external SQL probes; this helper performs no network access. */
 externalCatalogs?:readonly NativeCachedCatalogReceipt[];
}
export interface NativeOperationPreparationPorts {
 fingerprint():Promise<{compilerSourceSha256:string;sqlEngineSha256:string}>;
 compile(input:NativeSerializedFlowInput):Promise<NativeFlowCompilationResult>;
}
export interface NativeOperationPreparationResult {
 recipe:NativePipelineOperationRecipe;
 compilation:NativeFlowCompilationResult;
 proof:{sourceRowSha256:string;analysisSha256:string;recipeSha256:string;compilationSha256:string;catalogSourceSha256:readonly {sourceId:string;sha256:string}[];sha256:string};
}
export interface NativeOperationPreparationFileReference {path:string;sha256:string}
/** Serialized private worker request. Digests are supplied by the already reviewed batch source/identity preparation. */
export interface NativeOperationPreparationFileRequest {
 legacyRoot:string;revision:NativeOperationPreparationFileReference;analysis:NativeOperationPreparationFileReference;
 catalogIndex:NativeOperationPreparationFileReference;identityPlan:NativeOperationPreparationFileReference;
 externalCatalogs?:NativeOperationPreparationFileReference;targetOrigin:string;probeClockIso:string;output:string;
}
