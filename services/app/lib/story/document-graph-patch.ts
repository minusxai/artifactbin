/** Data transformations and their exact read facets. Publication admission adds
 * policy dependencies to this plan; only the admitted wrapper may reach SQL.
 */
import {GRAPH_ROOT,graphAncestors,type DocumentGraph,type DocumentGraphNode} from './document-graph';
import {MAX_CONTENT_BYTES} from './input';

export type GraphFacet='selfVersion'|'childrenVersion'|'subtreeVersion';
export interface GraphRead {key:string;facet:GraphFacet;version:number}
export interface GraphNodeWrite {
  value:Partial<DocumentGraphNode>;
  self:boolean;
  children:boolean;
}
export interface GraphPatch {
  baseVersion:number;
  reads:GraphRead[];
  selections:Array<{selector:string;keys:string[]}>;
  inserted:Record<string,DocumentGraphNode>;
  removed:string[];
  updated:Record<string,GraphNodeWrite>;
  touched:string[];
  byteDelta:number;
  unitDeltas:Record<string,number>;
  claims:Array<{id:string;version:number|null}>;
}
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
const equal=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));

export function prepareGraphPatch(before:DocumentGraph,after:DocumentGraph,baseVersion:number,options:{whole?:boolean;selectors?:string[];reads?:Array<{key:string;facet:GraphFacet}>}={}):GraphPatch {
  const reads=new Map<string,GraphRead>(),inserted:GraphPatch['inserted']={},removed:string[]=[],updated:GraphPatch['updated']={},touched=new Set<string>();
  const read=(key:string,facet:GraphFacet)=>{
    const node=before.nodes[key];if(!node)throw new Error('Missing validation dependency');
    reads.set(`${key}:${facet}`,{key,facet,version:node[facet]});
  };
  const ancestors=(graph:DocumentGraph,key:string)=>{
    for(const ancestor of graphAncestors(graph,key)){
      touched.add(ancestor);
      if(before.nodes[ancestor])read(ancestor,'selfVersion');
    }
  };
  for(const [key,node] of Object.entries(before.nodes)){
    const next=after.nodes[key];
    if(!next){removed.push(key);read(key,'subtreeVersion');ancestors(before,key);continue;}
    const self=!equal(node.ast,next.ast)||!equal(node.selectors,next.selectors)||!equal(node.refs,next.refs)||node.prose!==next.prose||node.parent!==next.parent;
    const children=!equal(node.children,next.children);
    if(!self&&!children)continue;
    const value:Partial<DocumentGraphNode>={parts:next.parts,partUnits:next.partUnits,bytes:next.bytes,units:next.units};
    if(self){Object.assign(value,{ast:next.ast,parent:next.parent,selectors:next.selectors,refs:next.refs,prose:next.prose});read(key,'subtreeVersion');}
    if(children){value.children=next.children;read(key,'childrenVersion');read(key,'selfVersion');}
    updated[key]={value,self,children};touched.add(key);ancestors(before,key);ancestors(after,key);
  }
  for(const [key,node] of Object.entries(after.nodes))if(!before.nodes[key]){
    inserted[key]=structuredClone(node);touched.add(key);ancestors(after,key);
  }
  if(options.whole)read(GRAPH_ROOT,'subtreeVersion');
  for(const dependency of options.reads??[])read(dependency.key,dependency.facet);
  const activeIds=(graph:DocumentGraph)=>new Set(Object.values(graph.nodes).flatMap(node=>node.selectors.filter(selector=>selector.startsWith('id:')).map(selector=>selector.slice(3))));
  const beforeIds=activeIds(before),claims=[...activeIds(after)].filter(id=>!beforeIds.has(id)).map(id=>({id,version:Object.hasOwn(before.claimedIds,id)?before.claimedIds[id]!:null}));
  const selections=[...new Set(options.selectors??[])].map(selector=>({selector,keys:selectGraphKeys(before,selector)}));
  return {baseVersion,claims,reads:[...reads.values()],selections,inserted,removed,updated,touched:[...touched].filter(key=>!!after.nodes[key]),byteDelta:after.bytes-before.bytes,unitDeltas:Object.fromEntries(Object.entries(after.nodes).filter(([key,node])=>before.nodes[key]&&before.nodes[key]!.subtreeUnits!==node.subtreeUnits).map(([key,node])=>[key,node.subtreeUnits-before.nodes[key]!.subtreeUnits]))};
}

export const selectGraphKeys=(graph:DocumentGraph,selector:string):string[]=>Object.entries(graph.nodes).filter(([,node])=>node.selectors.includes(selector)).map(([key])=>key).sort();

/** Reference model. This performs no revalidation or replanning: current values
 * outside the operation's write set are retained exactly, including revisions. */
export function applyGraphPatch(current:DocumentGraph,version:number,patch:GraphPatch):DocumentGraph|null {
  if(version<patch.baseVersion||version-patch.baseVersion>200)return null;
  if(patch.claims.some(({id,version})=>(Object.hasOwn(current.claimedIds,id)?current.claimedIds[id]:null)!==version))return null;
  if(patch.selections.some(read=>!equal(selectGraphKeys(current,read.selector),read.keys)))return null;
  if(patch.reads.some(read=>current.nodes[read.key]?.[read.facet]!==read.version))return null;
  if(Object.keys(patch.inserted).some(key=>Object.hasOwn(current.nodes,key)))return null;
  const bytes=current.bytes+patch.byteDelta;
  if(bytes<0||bytes>MAX_CONTENT_BYTES)return null;
  const next=structuredClone(current),revision=version+1;
  for(const key of patch.removed)delete next.nodes[key];
  for(const [key,node] of Object.entries(patch.inserted))next.nodes[key]={...structuredClone(node),selfVersion:revision,childrenVersion:revision,subtreeVersion:revision};
  for(const [key,write] of Object.entries(patch.updated)){
    const node=next.nodes[key];if(!node)return null;
    Object.assign(node,structuredClone(write.value));
    if(write.self)node.selfVersion=revision;
    if(write.children)node.childrenVersion=revision;
  }
  for(const key of patch.touched){const node=next.nodes[key];if(!node)return null;node.subtreeVersion=revision;}
  for(const [key,delta] of Object.entries(patch.unitDeltas))next.nodes[key]!.subtreeUnits+=delta;
  for(const {id} of patch.claims)Object.defineProperty(next.claimedIds,id,{value:revision,enumerable:true,writable:true,configurable:true});
  next.bytes=bytes;return next;
}
