import type {NativeTypedAnalysis,RetainedJsxNode} from './analyze-contracts.ts';
import type {NativeAuthorProgramAdmission} from './author-program-contracts.ts';
import {resourceSha256} from './resources.ts';
import {admitNativeObserverPreviewProfile} from './observer-preview-profile.ts';
import {admitNativeSourceFileViewerProfile} from './source-file-viewer-profile.ts';
type Selection=Pick<NativeAuthorProgramAdmission,'key'|'sourceNode'|'profile'|'filter'|'scriptSha256'>;
function select(analysis:NativeTypedAnalysis,kind:'preview'|'file'):readonly Selection[]{
 const nodes:RetainedJsxNode[]=[];const visit=(items:readonly RetainedJsxNode[])=>{for(const node of items){nodes.push(node);if(node.type==='element')visit(node.children);}};visit(analysis.nodes);
 return nodes.flatMap(node=>{if(node.type!=='element'||node.tag!=='script'||node.attributes.length)return [];let text='';for(const child of node.children){if(child.type==='text')text+=child.value;else if(child.type==='expression'&&child.value.static&&typeof child.value.json==='string')text+=child.value.json;else return [];}
  const scriptSha256=resourceSha256(text);try{if(kind==='preview')admitNativeObserverPreviewProfile(analysis,node,scriptSha256);else admitNativeSourceFileViewerProfile(analysis,node,scriptSha256);}catch{return [];}
  return [{key:{...analysis.key},sourceNode:node.graphKey,profile:kind==='preview'?'native-query-preview' as const:'source-file-viewer' as const,filter:'search' as const,scriptSha256}];
 });
}
/** Batch-prep only: every body hash and retained binding fact is checked, no per-page ID list. */
export const selectNativePreviewAuthorProfiles=(analysis:NativeTypedAnalysis)=>select(analysis,'preview');
export const selectNativeFileViewerAuthorProfiles=(analysis:NativeTypedAnalysis)=>select(analysis,'file');
