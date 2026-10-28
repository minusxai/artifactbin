import {createHash} from 'node:crypto';
import type {NativeTypedAnalysis,RetainedJsxNode} from './analyze-contracts.ts';
import type {NativeAuthorProgramAdmission} from './author-program-contracts.ts';
import {adaptNativeDomReactiveSource} from './dom-reactive-author.ts';
import type {NativeDomReactivePlan} from './dom-reactive-author-contracts.ts';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
/** Exact reviewed bodies, with no artifact IDs, datasets or identity authority embedded. */
const recipes:Readonly<Record<string,{named:readonly string[];ids:readonly string[]}>>={
 'dabb62ad4f478f8cc120818e00b1c8d886c00aa36feba1d08f69815aa49d5953':{named:[],ids:['bug-table-body','filter-shown-count','filter-empty','status-count-merged','status-count-active','status-count-discussion','status-count-deferred','status-count-not-started','filter-count-all','filter-count-active','filter-count-merged','filter-count-discussion','filter-count-deferred','filter-count-not-started']},
 '7edae753287322fc95cf232a656dcfb6414bb22e5cfed94b0388c475d8c7a59b':{named:['checkout'],ids:['to-payment','pay','pay-again','pay-apay','dec-apay','back-cart','back-cart-2','restart','sim-decline','sim-success','screen-cart','screen-payment','screen-declined','screen-done','url']},
};
const flatten=(nodes:readonly RetainedJsxNode[]):RetainedJsxNode[]=>nodes.flatMap(node=>[node,...node.type==='element'?flatten(node.children):[]]);
export function nativeDomReactiveText(node:RetainedJsxNode):string {
 if(node.type!=='element'||node.tag!=='script'||node.attributes.length)throw Error('Unsupported DOM reactive script');
 return node.children.map(child=>child.type==='text'?child.value:child.type==='expression'&&child.value.static&&typeof child.value.json==='string'?child.value.json:(()=>{throw Error('Nonliteral DOM reactive script');})()).join('');
}
export function admitNativeDomReactiveProfile(analysis:NativeTypedAnalysis,node:RetainedJsxNode,sha256:string):NativeDomReactivePlan {
 const source=nativeDomReactiveText(node),recipe=recipes[sha256];if(!recipe||hash(source)!==sha256)throw Error('Unreviewed DOM reactive source');
 if(Object.values(analysis.flow).some(items=>Array.isArray(items)&&items.length))throw Error('DOM reactive source must not invent page bindings');
 const nodes=flatten(analysis.nodes);for(const id of recipe.ids)if(nodes.filter(n=>n.type==='element'&&n.attributes.some(attr=>attr.name==='id'&&attr.value.static&&attr.value.json===id)).length!==1)throw Error('DOM reactive prerequisite missing');
 const adapted=adaptNativeDomReactiveSource(source,'__nativeDomReactiveProfile');if(JSON.stringify(adapted.namedSignals)!==JSON.stringify(recipe.named))throw Error('DOM reactive named binding changed');
 return {named:recipe.named.map(name=>({name,field:'afAuthor_'+hash(node.graphKey).slice(0,16)+'_'+name}))};
}
type Selection=Pick<NativeAuthorProgramAdmission,'key'|'sourceNode'|'profile'|'filter'|'scriptSha256'>;
export function selectNativeDomReactiveProfiles(analysis:NativeTypedAnalysis):readonly Selection[]{
 return flatten(analysis.nodes).flatMap(node=>{try{const scriptSha256=hash(nativeDomReactiveText(node));admitNativeDomReactiveProfile(analysis,node,scriptSha256);return [{key:{...analysis.key},sourceNode:node.graphKey,profile:'dom-reactive' as const,filter:'search' as const,scriptSha256}];}catch{return [];}});
}
