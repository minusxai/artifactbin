import type { NativeTypedAnalysis, RetainedJsxNode } from './analyze-contracts.ts';
import type { NativeIdentityRevision } from './identity-contracts.ts';
import type {NativeObserverPreviewPlan} from './observer-preview-contracts.ts';
import type { NativeAssemblyPresentation } from './assemble-contracts.ts';
/** Offline host-selected adaptation, bound to exact recovered input; never a public page argument. */
export interface NativeAuthorProgramAdmission {
 key:NativeTypedAnalysis['key']; sourceSha256:string; analysisSha256:string; compilerSourceSha256:string;
 sourceNode:string; nodeSha256:string; scriptSha256:string;
 preview?:NativeObserverPreviewPlan;
 profile:'ordinary-dom-script'|'bookshelf-local-state'|'ordinary-srcdoc'|'native-query-observer'|'native-query-preview'|'source-file-viewer'|'local-state-dom'|'dom-reactive';
 /** The exact source recipe: earlier versions include status/favorites filtering. */
 filter:'search'|'search-and-status';
}
export interface NativeAuthorProgramReceipt {
 admission:NativeAuthorProgramAdmission;
 /** Pure ordinary HTML replacing this one source node; children retain their identities. */
 html:string; authorJs:string;
 identities:readonly {sourceNode:string;afId:string;kind:'element'|'text'|'nonvisual'}[];
 sha256:string;
}
export interface NativeAuthorProgramInput {
 analysis:NativeTypedAnalysis; identity:NativeIdentityRevision; admission:NativeAuthorProgramAdmission;
 presentation?:NativeAssemblyPresentation;
 urls?:readonly {source:string;target:string;sha256:string}[];
}
export interface NativeBookshelfStatePlan {
 fields:readonly string[]; filter:'search'|'search-and-status';
 books:readonly {id:string;title:string;author:string;status:string;rating:number;group:string}[];
 groups:readonly string[];
}
export interface NativeAuthorProgramVerification {analysis:NativeTypedAnalysis;node:RetainedJsxNode;receipt:NativeAuthorProgramReceipt}
