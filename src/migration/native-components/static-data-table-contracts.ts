import type{NativeTypedAnalysis}from'./analyze-contracts.ts';
import type{NativeOperationCompilation,NativeOperationBlocker,NativeVisualizationSourceBinding}from'./operations-contracts.ts';
/** Separate from chart and query admission: a single exact literal table targets one DataTable. */
export interface NativeStaticDataTableProof {kind:'static-data-table-source-v1';sourceSha256:string;analysisSha256:string;typedAnalysisSha256:string;compilerSourceSha256:string;targetSourceNode:string;targetNodeSha256:string;binding:Extract<NativeVisualizationSourceBinding,{kind:'static-table-value'}>;compiledTableSha256:string;sha256:string}
export interface NativeStaticDataTableInput {analysis:NativeTypedAnalysis;compilation:NativeOperationCompilation}
export interface NativeStaticDataTableResult {proofs:readonly NativeStaticDataTableProof[];blockers:readonly NativeOperationBlocker[]}

/** Runtime-only projection marker is derived after source proof verification. */
export interface NativeStaticDataTableProjection {staticDataTableSource:'static-data-table-source-v1'}
