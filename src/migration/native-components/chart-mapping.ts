import type {NativeMapCharts,NativeChartMapping} from './chart-contracts.ts';
import type {NativeTypedAnalysis,RetainedJsxNode,NativeJson} from './analyze-contracts.ts';
import {nativeDigest} from './selection.ts';
const allowed=new Set(['id','title','data','viz','height','class','className','style']);
/** Source: retained islands/kit/data.tsx Chart + data/story/question-height.ts.
 * This stage preserves recipes; the actual retained pure render pipeline owns
 * layout/theme enrichment and compilation, using separately shipped engines. */
export const mapNativeCharts:NativeMapCharts=analysis=>{
 const mappings:NativeChartMapping[]=[],blockers:{sourceNode:string;code:string}[]=[];
 const walk=(node:RetainedJsxNode,inGridItem:boolean,inTemplate:boolean)=>{
  if(node.type!=='element')return;
  if(node.tag==='Chart'||node.tag==='Question'){
   const start=blockers.length,props:Record<string,NativeJson>={};
   const block=(code:string)=>blockers.push({sourceNode:node.graphKey,code});
   if(inTemplate)block('chart-template-instance-runtime-required');
   for(const attr of node.attributes){if(!allowed.has(attr.name)&&!/^data-[a-z0-9_-]+$/.test(attr.name)&&!/^aria-[a-z-]+$/.test(attr.name))block('chart-attribute-unsupported');if(!attr.value.static)block('chart-dynamic-recipe');else if(Object.hasOwn(props,attr.name))block('chart-duplicate-attribute');else props[attr.name]=attr.value.json;}
   if(node.children.length)block('chart-authored-children');
   const viz=props.viz&&typeof props.viz==='object'&&!Array.isArray(props.viz)?props.viz as Record<string,NativeJson>:{};
   const kind=viz.kind??'table';if(kind!=='table'&&kind!=='vega-lite')block('chart-kind-unsupported');
   if(kind==='vega-lite'&&(!viz.spec||typeof viz.spec!=='object'||Array.isArray(viz.spec)))block('chart-spec-unsupported');
   if(kind==='vega-lite'){const inspect=(value:NativeJson)=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(inspect);return;}if(Object.hasOwn(value,'data')){const data=value.data;if(data&&typeof data==='object'&&!Array.isArray(data)&&('url'in data||'values'in data))block('chart-embedded-data-unsupported');}if(Object.hasOwn(value,'datasets'))block('chart-embedded-data-unsupported');Object.values(value).forEach(inspect);};inspect(viz.spec!);}
   const source=typeof props.data==='string'?props.data:'';let data:NativeChartMapping['data']|undefined;
   if(/^\$[A-Za-z_]\w*$/.test(source))data={kind:'table',name:source.slice(1)};else if(/^ref:[^\s]+$/.test(source))data={kind:'ref',name:source.slice(4)};else block('chart-data-binding-unsupported');
   for(const name of ['title','id','class','className'])if(props[name]!==undefined&&typeof props[name]!=='string')block('chart-property-unsupported');
   const n=typeof props.height==='number'?props.height:typeof props.height==='string'?parseFloat(props.height):NaN;
   if(start===blockers.length&&data){const payload={sourceNode:node.graphKey,nodeSha256:nativeDigest(node),sourceSha256:analysis.sourceSha256,analysisSha256:analysis.analysisSha256,kind:kind as 'table'|'vega-lite',data,props,height:Number.isFinite(n)?Math.max(n,340):430,inGridItem};mappings.push({...payload,sha256:nativeDigest(payload)});}
  }
  node.children.forEach(child=>walk(child,inGridItem||node.tag==='GridItem',inTemplate||node.tag==='For'||!!node.control&&!(typeof node.control==='object'&&!Array.isArray(node.control)&&node.control.kind==='fragment')));
 };analysis.nodes.forEach(node=>walk(node,false,false));return {mappings,blockers};
};
export function verifyNativeChartMapping(analysis:NativeTypedAnalysis,mapping:NativeChartMapping):boolean{
 const expected=mapNativeCharts(analysis).mappings.filter(m=>m.sourceNode===mapping.sourceNode);return expected.length===1&&nativeDigest(expected[0])===nativeDigest(mapping);
}
