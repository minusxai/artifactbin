/** Digests cover recovered authored HTML bytes, never runtime markers or modification times. */
export interface SourceComparisonInput {
 baseDigest?:string;
 baseRevision?:string;
 /** Supply only after reading actual selected file bytes or an authorized local helper. */
 localDigest?:string;
 /** Both remote fields are absent when the current remote observation is unavailable. */
 remoteDigest?:string;
 remoteRevision?:string;
}
export type SourceRelationshipState='match'|'behind'|'local-edits'|'diverged'|'converged'|'unknown-base'|'local-unverified'|'network-unknown';
export interface SourceRelationship {
 state:SourceRelationshipState;
 evidence:{base:'known'|'missing';local:'verified'|'unverified';remote:'known'|'unavailable'};
 /** Null means at least one of the two revisions was not observed. */
 remoteRevisionAdvanced:boolean|null;
 /** Observed equality is useful even when baseline provenance is missing. */
 localMatchesRemote:boolean|null;
 actions:{
 canPull:boolean;
 canPublish:boolean;
 canAdoptRemoteBase:boolean;
 requiresMerge:boolean;
 /** Every eventual write must CAS against this current remote revision, never the base revision. */
 expectedRemoteRevision:string|null;
 };
}
