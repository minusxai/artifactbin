import type {NativeOperationPreparationResult} from './operation-preparation-contracts.ts';
import type {NativeSelectedRevision,NativeGraphAnalysis} from './contracts.ts';
import type {NativeTypedAnalysis,NativeTypedCompilerPort} from './analyze-contracts.ts';
import type {NativeIdentityRevision} from './identity-contracts.ts';
import type {NativeAssemblyInput,NativeAssemblyFile} from './assemble-contracts.ts';
import type {NativeV3AssemblyReceipt,NativeV3ProgramReceipt} from './v3-publication-contracts.ts';
import type {NativeChartMapping,NativeChartAdapter} from './chart-contracts.ts';
import type {NativeAuthorProgramAdmission} from './author-program-contracts.ts';
export interface NativePipelineRequest {
 manifest:string; manifestSha256:string; head:string; output:string; receiptRoot:string;
 legacyRoot:string; componentRoot:string; componentRevision:string; compilerSourceSha256:string;
 revisionScope:'latest'; coreUrl:string; stage:'assemble'|'import'|'capture';
 authorityRecipePath?:string; baselineRecipePath?:string; candidateRecipePath?:string;
}
export interface NativePipelineContext {
 request:NativePipelineRequest; revision:NativeSelectedRevision; graph:NativeGraphAnalysis;
 analysis:NativeTypedAnalysis; identity:NativeIdentityRevision;
 chartMappings:readonly NativeChartMapping[];chartAdapter?:NativeChartAdapter;
}
export interface NativePipelineOperations {
 input:Pick<NativeAssemblyInput,'backends'|'queries'|'mutations'|'viewer'|'people'|'operationCoverage'>;
 programs:readonly NativeV3ProgramReceipt[];
 blockers:readonly {sourceNode:string;code:string}[];
 preparation?:NativeOperationPreparationResult;
}
export interface NativePipelineImport {
 key:NativeSelectedRevision['key'];assemblySha256:string;stage:'imported';historyProjectionSha256:string;
 preparedStorePath:string;pilotInputPath:string;canonicalPath:string;recoveryPath:string;bundleDirectory:string;
}
export interface NativePipelineComparison {
 key:NativeSelectedRevision['key'];assemblySha256:string;status:'verified'|'difference'|'environment-blocked';
 comparisonPath:string;comparisonSha256:string;baselineEvidencePath:string;candidateEvidencePath:string;
}
export interface NativePipelineHostContext {
 revision:NativeSelectedRevision;assembly:NativeV3AssemblyReceipt;receiptRoot:string;outputDirectory:string;
 authorityRecipePath:string;baselineRecipePath?:string;candidateRecipePath?:string;
}
export interface NativePipelineHost {
 importAndPrepare(context:NativePipelineHostContext):Promise<NativePipelineImport>;
 captureAndCompare(context:NativePipelineHostContext & {imported:NativePipelineImport}):Promise<NativePipelineComparison>;
}
export interface NativePipelinePorts {
 readRevision(request:NativePipelineRequest):Promise<NativeSelectedRevision>;
 compiler:NativeTypedCompilerPort;
 navigation?(context:NativePipelineContext):Promise<import("./resource-navigation-contracts.ts").NativeNavigationPolicy>;
 markdown?(context:NativePipelineContext):Promise<readonly import("./markdown-contracts.ts").NativeMarkdownReceipt[]>;
 styles(context:NativePipelineContext):Promise<NativePipelineStyleSnapshot>;
 assets(sources:readonly string[],context:NativePipelineContext):Promise<readonly NativePipelineAsset[]>;
 modules(tags:readonly string[],context:NativePipelineContext):Promise<{modules:NonNullable<NativeAssemblyInput['modules']>;files:readonly NativeAssemblyFile[]}>;
 charts?(context:NativePipelineContext):Promise<{adapter:NativeChartAdapter;files:readonly NativeAssemblyFile[]}>;
 operations?(context:NativePipelineContext):Promise<NativePipelineOperations>;
 authorProfiles?(context:NativePipelineContext):Promise<readonly Pick<NativeAuthorProgramAdmission,'sourceNode'|'profile'|'filter'|'scriptSha256'>[]>;
 host?:NativePipelineHost;
}
export interface NativePipelineResult {
 key:NativeSelectedRevision['key'];sourceRowSha256:string;
 status:'blocked'|'assembled'|'imported'|'verified'|'difference'|'environment-blocked';
 blockers:readonly {sourceNode:string;code:string}[];
 graph:NativeGraphAnalysis;analysis:NativeTypedAnalysis;identity:NativeIdentityRevision;
 style?:NativePipelineStyleSnapshot;assembly?:NativeV3AssemblyReceipt;operationPreparation?:NativeOperationPreparationResult;
 imported?:NativePipelineImport;comparison?:NativePipelineComparison;
}
export interface NativePipelineFileReference {path:string;sha256:string}
/** Explicit shared receipt inventory; authored pages never receive these filesystem paths. */
export interface NativePipelineReceiptIndex {
 navigation?:{sourceOrigin:string;targetOrigin:string;identityPlan:NativePipelineFileReference;approvedPlanSha256:string;imports:readonly {sourceId:string;targetId:string;receipt:NativePipelineFileReference}[]};
 format:'native-conversion-inputs-v1';componentRevision:string;
 sharedPreparation?:NativePipelineFileReference & {verified:NativePipelineFileReference;sourceRoot:string};
 assets:readonly (NativePipelineFileReference & {sources:readonly string[];extension:string;provenanceSha256:string})[];
 refRows?:readonly (NativePipelineFileReference & {sourceIds:readonly string[]})[];
 sha256:string;
 chart?:{libraries:{vega:string;vegaLite:string;dataTable:string};files:readonly (NativePipelineFileReference & {bundlePath:string})[]};
 operations?:readonly (NativePipelineFileReference & {key:NativeSelectedRevision['key']})[];
 operationPreparation?:{catalogIndex:NativePipelineFileReference;identityPlan:NativePipelineFileReference;externalCatalogs?:NativePipelineFileReference;targetOrigin:string;probeClockIso:string};
 authorProfiles?:readonly {key:NativeSelectedRevision['key'];sourceNode:string;profile:NativeAuthorProgramAdmission['profile'];filter:NativeAuthorProgramAdmission['filter'];scriptSha256:string}[];
}

export interface NativePipelineStyleSnapshot {
 sourceSha256:string;analysisSha256:string;compilerSha256:string;
 sourceFiles:readonly {path:string;sha256:string}[];sheets:readonly {attr:string;css:string}[];
 htmlAttributes:Record<string,string>;storyAttributes:Record<string,string>;
 inlineStyles:readonly {sourceNode:string;css:string}[];presentationUrls?:readonly string[];
 resourcePatches?:readonly {sourceNode:string;attributes:Record<string,string>}[];
}
export interface NativePipelineAsset {sources:readonly string[];bytes:Uint8Array;sha256:string;extension:string;provenanceSha256:string}

type NativePipelineFlowRecipe=Omit<import('./operation-producer-contracts.ts').NativeSerializedFlowInput,'document'|'analysis'>;
export interface NativePipelineOperationRecipe extends NativePipelineFlowRecipe {
 key:NativeSelectedRevision['key'];targetPageId:string;targetOrigin:string;
 datasets:readonly import('./operations-contracts.ts').NativeCatalogOperationBinding[];
 statements?:readonly {sqlSha256:string;kind:'insert'|'update'|'delete'}[];
 people?:import('./person-contracts.ts').NativeBindingPeople;
}
