import type {SourceComparisonInput,SourceRelationship,SourceRelationshipState} from './source-relationship-contract';
const DIGEST=/^[a-f0-9]{64}$/i;
function validate(input:SourceComparisonInput):void {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('invalid_source_comparison');
 for(const key of ['baseDigest','localDigest','remoteDigest'] as const){
 const value=input[key];if(value!==undefined&&(typeof value!=='string'||!DIGEST.test(value)))throw new Error('invalid_source_comparison');
 }
 for(const key of ['baseRevision','remoteRevision'] as const){
 const value=input[key];if(value!==undefined&&(typeof value!=='string'||!value.trim()||value.length>128||/[\p{Cc}]/u.test(value)))throw new Error('invalid_source_comparison');
 }
 if((input.remoteDigest===undefined)!==(input.remoteRevision===undefined))throw new Error('invalid_source_comparison');
}
/** Pure evidence comparison. Capabilities describe safe explicit actions; nothing writes or fetches. */
export function compareSource(input:SourceComparisonInput):SourceRelationship {
 validate(input);
 const base=input.baseDigest?.toLowerCase(),local=input.localDigest?.toLowerCase(),remote=input.remoteDigest?.toLowerCase();
 const knownBase=base!==undefined&&input.baseRevision!==undefined;
 let state:SourceRelationshipState;
 if(remote===undefined)state='network-unknown';
 else if(local===undefined)state='local-unverified';
 else if(!knownBase)state='unknown-base';
 else if(local===remote)state=local===base?'match':'converged';
 else if(local===base)state='behind';
 else if(remote===base)state='local-edits';
 else state='diverged';
 return {
 state,
 evidence:{base:knownBase?'known':'missing',local:local===undefined?'unverified':'verified',remote:remote===undefined?'unavailable':'known'},
 remoteRevisionAdvanced:input.baseRevision!==undefined&&input.remoteRevision!==undefined?input.baseRevision!==input.remoteRevision:null,
 localMatchesRemote:local!==undefined&&remote!==undefined?local===remote:null,
 actions:{
 canPull:state==='behind',
 canPublish:state==='local-edits',
 canAdoptRemoteBase:state==='match'||state==='converged',
 requiresMerge:state==='diverged',
 expectedRemoteRevision:input.remoteRevision??null,
 },
 };
}
