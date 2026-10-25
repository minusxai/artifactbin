import type {NativePipelineRequest,NativePipelineHostContext,NativePipelineResult,NativePipelineImport} from './pipeline-contracts.ts';
import type {NativePipelineAdapterPorts,NativePipelineLifecycle} from './pipeline-adapter-contracts.ts';
import type {NativeV3HistoryImport} from './v3-publication-contracts.ts';
export interface NativePipelineBatchRequest {format:'native-pipeline-batch-v1';revisionScope:'latest';outputDirectory:string;captureOutputDirectory:string;requests:readonly NativePipelineRequest[]}
export interface NativePipelineUnsnapshotted {
 stage:'imported-unsnapshotted';key:NativePipelineHostContext['revision']['key'];assemblySha256:string;historyProjectionSha256:string;
 history:NativeV3HistoryImport;identityPlan:{sha256:string;targets:{users:Readonly<Record<string,{userId:string;email:string|null}>>}};datasetIds:readonly string[];
 reviewedRecipe:{sourceRevision:string;targetRevision:string;inputs:{sourceHead:{path:string;sha256:string}}};
 importResult?:unknown;identityPreparation?:unknown;identityPreparationPath?:string;
}
export interface NativePipelineBatchHead {request:NativePipelineRequest;context:NativePipelineHostContext;result:NativePipelineResult;imported:NativePipelineUnsnapshotted}
export interface NativePipelineBatchSnapshot {storeContentSha256:string;heads:readonly NativePipelineImport[];snapshotPath:string}
export interface NativePipelineBatchPorts extends NativePipelineAdapterPorts {
 reserve?(request:NativePipelineBatchRequest):Promise<void>;
 revision(request:NativePipelineRequest):Promise<NativePipelineHostContext['revision']>;
 authority?(request:NativePipelineRequest,context:NativePipelineHostContext,configuration:Parameters<NonNullable<NativePipelineAdapterPorts['materialize']>>[2],publication:Parameters<NonNullable<NativePipelineAdapterPorts['materialize']>>[3],objectsDirectory:string):Promise<NativePipelineHostContext>;
 convert(request:NativePipelineRequest):Promise<NativePipelineResult>;
 snapshot(input:{request:NativePipelineBatchRequest;lifecycle:NativePipelineLifecycle;heads:readonly NativePipelineBatchHead[];targetRoot:string}):Promise<NativePipelineBatchSnapshot>;
}
export interface NativePipelineBatchResult {format:'native-pipeline-batch-result-v1';revisionScope:'latest';status:'imported';heads:readonly NativePipelineBatchHead[];snapshot:NativePipelineBatchSnapshot}
