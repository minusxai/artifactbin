import type {NativeHostFile,NativeHostKey} from './native-migration-host-contract';
/** A separately approved exact decision; never rewrites the strict comparison. */
export interface NativeReviewedComparisonDecision {
 format:'native-reviewed-comparison-decision-v1';accepted:true;revisionScope:'latest';
 key:NativeHostKey;assemblySha256:string;sourceRevision:string;targetRevision:string;
 sourceHeadSha256:string;compiledHtmlSha256:string;membershipSha256:string;commentsSha256:string;
 sourceCameraHtmlSha256:string;sourceCameraInput:NativeHostFile;targetCameraInput:NativeHostFile;sourceEvidence:NativeHostFile;targetEvidence:NativeHostFile;
 strictReport:NativeHostFile;strictFalseField:'passed'|'strictEqual';strictPassed:false;
 evidence:readonly {kind:'source'|'target'|'assembly'|'relations'|'behavior'|'classification';file:NativeHostFile}[];
 /** Every difference is separately enumerated by the reviewed decision. No tolerance. */
 differences:readonly {id:string;description:string;evidence:NativeHostFile}[];
 behaviorComplete:true;sourceTargetComplete:true;
}
