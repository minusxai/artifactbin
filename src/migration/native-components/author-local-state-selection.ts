import type {NativeTypedAnalysis,RetainedJsxNode} from './analyze-contracts.ts';
import type {NativeAuthorProgramAdmission} from './author-program-contracts.ts';
import {adaptNativeAuthorLocalSource} from './author-local-state.ts';
import {resourceSha256} from './resources.ts';
/** Select compatible ordinary DOM scripts from actual source declarations, never a page-ID list. */
export function selectNativeLocalStateAuthorProfiles(analysis:NativeTypedAnalysis):readonly Pick<NativeAuthorProgramAdmission,'key'|'sourceNode'|'profile'|'filter'|'scriptSha256'>[]{
 const result:Array<Pick<NativeAuthorProgramAdmission,'key'|'sourceNode'|'profile'|'filter'|'scriptSha256'>>=[];
 const visit=(nodes:readonly RetainedJsxNode[])=>{for(const node of nodes){if(node.type!=='element')continue;if(node.tag==='script'&&!node.attributes.length){let source='';let literal=true;for(const child of node.children){if(child.type==='text')source+=child.value;else if(child.type==='expression'&&child.value.static&&typeof child.value.json==='string')source+=child.value.json;else literal=false;}if(literal)try{if(adaptNativeAuthorLocalSource(source,analysis,'__nativeLocalSelection').runtime!=='page-signal')continue;result.push({key:{...analysis.key},sourceNode:node.graphKey,profile:'local-state-dom',filter:'search',scriptSha256:resourceSha256(source)});}catch{ /* Preserve unsupported programs for the caller's explicit blocker. */ }}visit(node.children);}};
 visit(analysis.nodes);return result;
}
