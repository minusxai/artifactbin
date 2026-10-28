import type {NativeTypedAnalysis,RetainedJsxNode} from './analyze-contracts.ts';
import type {NativeAuthorProgramAdmission} from './author-program-contracts.ts';
import {resourceSha256} from './resources.ts';
import {selectNativePreviewAuthorProfiles,selectNativeFileViewerAuthorProfiles} from './source-author-profile-selection.ts';
import {selectNativeDomReactiveProfiles} from './dom-reactive-author-profile.ts';
export type NativeAuthorProfileCandidate=Pick<NativeAuthorProgramAdmission,'sourceNode'|'profile'|'filter'|'scriptSha256'>;
/** Profiles to try, in order, for a script with no host-configured profile.
 * Exact reviewed recipes (hash + binding facts) come first, then the shape-checked general profiles.
 * Every candidate is still admitted only by adaptNativeAuthorProgram's own checks; the order only decides
 * which supporting profile wins. Ordinary DOM is last because its check type-checks the whole script. */
export function nativeAuthorProfileCandidates(analysis:NativeTypedAnalysis,node:RetainedJsxNode,text:string):readonly NativeAuthorProfileCandidate[]{
 const scriptSha256=resourceSha256(text),own=(p:{sourceNode:string})=>p.sourceNode===node.graphKey;
 const reviewed=[...selectNativePreviewAuthorProfiles(analysis),...selectNativeFileViewerAuthorProfiles(analysis),...selectNativeDomReactiveProfiles(analysis)].filter(own).map(({key:_key,...profile})=>profile);
 const general=(profile:NativeAuthorProfileCandidate['profile'],filter:NativeAuthorProfileCandidate['filter']='search')=>({sourceNode:node.graphKey,profile,filter,scriptSha256});
 return [...reviewed,general('local-state-dom'),general('native-query-observer'),general('bookshelf-local-state',analysis.flow.values.some(v=>v.name==='filter')?'search-and-status':'search'),general('ordinary-dom-script')];
}
