import type { NativeGraphAnalysis, NativeRevisionKey } from './contracts.ts';
import type { NativeTypedAnalysis } from './analyze-contracts.ts';
export interface NativeLowerIdentityBinding {
  sourceNode: string;
  sourceStart: number;
  sourceEnd: number;
  sourceSha256: string;
  afId: string;
  analysisSha256: string;
  proofSha256: string;
}
/** Graph identity owns the annotation; authored DOM ids remain a separate namespace. */
export interface NativeIdentityTemplate extends NativeLowerIdentityBinding {
 sourceStart: number; sourceEnd: number;
 kind: 'element' | 'text' | 'expression' | 'condition' | 'loop';
 owner: string;
 authoredDomId?: string;
}
export interface NativeIdentityRevisionInput { graph: NativeGraphAnalysis; typed: NativeTypedAnalysis }
export interface NativeIdentityRevision {
 key: NativeRevisionKey;
 bindings: NativeIdentityTemplate[];
 reservedIdentities: Array<{ afId: string; sourceNode: string }>;
 proofSha256: string;
}
export interface NativeIdentityCommentTarget {
 key: NativeRevisionKey;
 /** Target kind is mandatory: DOM id and graph key namespaces must never be guessed. */
 target: { kind: 'graph'; value: string } | { kind: 'dom'; value: string };
}
export interface NativeIdentityCommentReceipt {
 key: NativeRevisionKey; sourceNode: string; afId: string; templateKind: NativeIdentityTemplate['kind']; proofSha256: string;
}
