import type {NativeTypedAnalysis} from './analyze-contracts.ts';
import type {NativeOperationCompilation,NativeCatalogOperationBinding,NativeOperationAdmission} from './operations-contracts.ts';
import type {NativeAssemblyInput} from './assemble-contracts.ts';
import type {NativeV3ProgramReceipt} from './v3-publication-contracts.ts';
export interface NativeOperationProducerHost {
 query(namespace:string,program:Extract<NativeV3ProgramReceipt,{kind:'query'}>['program'],name:string):NativeAssemblyInput['queries'][number];
 mutation(namespace:string,program:Extract<NativeV3ProgramReceipt,{kind:'mutation'}>['program']):NativeAssemblyInput['mutations'][number];
 viewer(namespace:string):NonNullable<NativeAssemblyInput['viewer']>;
 /** Invoke actual target schema preparation and registered-plan roundtrip. Throw on mismatch. No writes. */
 verify(receipt:NativeV3ProgramReceipt):void;
}
export interface NativeOperationProducerInput {
 analysis:NativeTypedAnalysis; compilation:NativeOperationCompilation; historical:boolean;
 targetPageId:string; targetOrigin:string;
 /** Verified immutable catalog/policy receipts, not source-request claims. */
 datasets:readonly NativeCatalogOperationBinding[];
 statements:readonly {sqlSha256:string;kind:'insert'|'delete'}[];
 visualizationAdmissions?:readonly NativeOperationAdmission[];
 host:NativeOperationProducerHost;
}
export type NativeOperationProducerResult=Pick<NativeAssemblyInput,'backends'|'queries'|'mutations'|'viewer'|'operationCoverage'>&{programs:readonly NativeV3ProgramReceipt[];blockers:readonly {sourceNode:string;code:string}[]};
/** Actual retained APIs are injected; cached metadata/probes must be verified by the caller. */
export interface NativeFlowCompilerHost {
 fingerprint():Promise<{compilerSourceSha256:string;sqlEngineSha256:string}>;
 extract(document:unknown):{flow:unknown;body:unknown};
 prepare(flow:unknown,resolve:(ref:string)=>Promise<unknown>):Promise<unknown>;
 compile(flow:unknown,context:unknown,body:unknown):{ok:true;compiled:Omit<NativeOperationCompilation,'sourceSha256'|'compilerSourceSha256'|'sqlEngineSha256'>}|{ok:false;errors:unknown};
}
export interface NativeFlowStatementFact {sqlSha256:string;kind:string;functions:readonly string[]}
export type NativeFlowCompilationResult=NativeOperationCompilation & {statementFacts?:readonly NativeFlowStatementFact[]};
export interface NativeFlowCompileInput {
 document:unknown;analysis:NativeTypedAnalysis;sqlEngineSha256:string;
 /** Exact ref resolver backed by independently verified schema and query probe receipts. */
 resolveCatalog(ref:string):Promise<unknown>;
 host:NativeFlowCompilerHost;
}
export interface NativeRetainedFlowHostOptions {
 legacyRoot:string;
 /** Must hash actual compiler and SQL engine trees; checked around every compile. */
 fingerprint:NativeFlowCompilerHost['fingerprint'];
 /** SQLite authorizer facts for immutable SQL; absent facts refuse compilation. */
 queryFunctions?(sql:string):readonly string[] | undefined;
}
export interface NativeCachedCatalogReceipt {
 sourceRef:string;catalog:{kind:string;tables:unknown[]};
 probes:readonly {sql:string;params:unknown;types:unknown;columns:unknown[];paramNames:string[];truncated:boolean}[];
 /** Digest of {sourceRef,catalog,probes}, independently verified during capture. */
 sha256:string;
}
export interface NativeSerializedFlowInput {
 document:unknown;analysis:NativeTypedAnalysis;sqlEngineSha256:string;
 /** Explicit captured schema-probe clock, not the eventual runtime query clock. */
 probeClockIso:string;
 catalogs:readonly NativeCachedCatalogReceipt[];
 queryFunctions:readonly {sqlSha256:string;functions:readonly string[]}[];
}
