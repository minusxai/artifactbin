/** Data transformations and their exact read facets. Publication admission adds
 * policy dependencies to this plan; only the admitted wrapper may reach SQL.
 */
import {GRAPH_ROOT,graphAncestors,type DocumentGraph,type DocumentGraphNode} from './document-graph';
import {applyDocumentPatch,prepareDocumentPatch,type DocumentPatch} from './document-patch';
import {MAX_DOCUMENT_BYTES,type GraphPatch,type GraphRead,type GraphFacet} from '@artifactbin/contracts';
export type { GraphPatch, GraphFacet } from '@artifactbin/contracts';

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
    const children=!equal(node.children,next.children);
    // Adding child slots alone changes parts' arity, not this node's own
    // spelling. Normalizing migrated source does change its own read facet.
    const spelling=!equal(node.parts,next.parts)&&(!children||node.parts.join('')!==next.parts.join(''));
    const self=!equal(node.ast,next.ast)||spelling||!equal(node.selectors,next.selectors)||!equal(node.refs,next.refs)||node.prose!==next.prose||node.parent!==next.parent;
    if(!self&&!children)continue;
    const value:Partial<DocumentGraphNode>={parts:next.parts,partUnits:next.partUnits,bytes:next.bytes,units:next.units};
    if(self){Object.assign(value,{ast:next.ast,parent:next.parent,selectors:next.selectors,refs:next.refs,prose:next.prose});read(key,'subtreeVersion');}
    if(children){value.children=next.children;read(key,'childrenVersion');read(key,'selfVersion');}
    const ownBefore=Object.fromEntries(Object.keys(value).map(field=>[field,node[field as keyof DocumentGraphNode]]));
    const primitives=prepareDocumentPatch(ownBefore,value);
    // Dense edits may replace individual own fields, never revision/aggregate
    // fields belonging to concurrent descendants of this node.
    const patches=primitives.flatMap((primitive):DocumentPatch[]=>primitive.path.length?[primitive]:Object.entries(value).map(([field,value])=>({kind:'set',path:[field],value})));
    updated[key]={patches,self,children};touched.add(key);ancestors(before,key);ancestors(after,key);
  }
  for(const [key,node] of Object.entries(after.nodes))if(!before.nodes[key]){
    inserted[key]=structuredClone(node);touched.add(key);ancestors(after,key);
  }
  if(options.whole)read(GRAPH_ROOT,'subtreeVersion');
  for(const dependency of options.reads??[])read(dependency.key,dependency.facet);
  const activeIds=(graph:DocumentGraph)=>new Set(Object.values(graph.nodes).flatMap(node=>node.selectors.filter(selector=>selector.startsWith('id:')).map(selector=>selector.slice(3))));
  const beforeIds=activeIds(before),claims=[...activeIds(after)].filter(id=>!beforeIds.has(id)).map(id=>({id,version:Object.hasOwn(before.claimedIds,id)?before.claimedIds[id]!:null}));
  const select=graphKeySelector(before);
  const selections=[...new Set(options.selectors??[])].map(selector=>({selector,keys:select(selector)}));
  return {baseVersion,claims,reads:[...reads.values()],selections,inserted,removed,updated,touched:[...touched].filter(key=>!!after.nodes[key]),byteDelta:after.bytes-before.bytes,unitDeltas:Object.fromEntries(Object.entries(after.nodes).filter(([key,node])=>before.nodes[key]&&before.nodes[key]!.subtreeUnits!==node.subtreeUnits).map(([key,node])=>[key,node.subtreeUnits-before.nodes[key]!.subtreeUnits]))};
}

export const selectGraphKeys=(graph:DocumentGraph,selector:string):string[]=>Object.entries(graph.nodes).filter(([,node])=>node.selectors.includes(selector)).map(([key])=>key).sort();
/** `selectGraphKeys` for many selectors over one unchanging graph: indexed once, so planning a change that touches
 * every node (a document gaining its ids) is linear, not a scan of the whole graph per changed node. */
export function graphKeySelector(graph:DocumentGraph):(selector:string)=>string[] {
 let index:Map<string,string[]>|null=null;
 return selector=>{
  if(!index){
   index=new Map();
   for(const [key,node] of Object.entries(graph.nodes))for(const fact of new Set(node.selectors)){const keys=index.get(fact);if(keys)keys.push(key);else index.set(fact,[key]);}
   for(const keys of index.values())keys.sort();
  }
  return [...(index.get(selector)??[])];
 };
}

/** Reference model. This performs no revalidation or replanning: current values
 * outside the operation's write set are retained exactly, including revisions. */
export function applyGraphPatch(current:DocumentGraph,version:number,patch:GraphPatch):DocumentGraph|null {
  if(version<patch.baseVersion||version-patch.baseVersion>200)return null;
  if(patch.claims.some(({id,version})=>(Object.hasOwn(current.claimedIds,id)?current.claimedIds[id]:null)!==version))return null;
  if(patch.selections.some(read=>!equal(selectGraphKeys(current,read.selector),read.keys)))return null;
  if(patch.reads.some(read=>current.nodes[read.key]?.[read.facet]!==read.version))return null;
  if(Object.keys(patch.inserted).some(key=>Object.hasOwn(current.nodes,key)))return null;
  const bytes=current.bytes+patch.byteDelta;
  if(bytes<0||bytes>MAX_DOCUMENT_BYTES)return null;
  return advanceGraph(structuredClone(current),version,patch);
}

/**
 * The write half of `applyGraphPatch`, for a patch already admitted at exactly this version (the server answered
 * it): no checks, and only the nodes the patch writes are copied, so advancing a large graph by one typed change
 * costs the change, not the graph. The result shares every untouched node with `current`; neither may be mutated.
 */
export function advanceGraph(current:DocumentGraph,version:number,patch:GraphPatch):DocumentGraph|null {
  const nodes:DocumentGraph['nodes']={...current.nodes},claimedIds:DocumentGraph['claimedIds']={...current.claimedIds},revision=version+1,own=new Set<string>();
  const writable=(key:string):DocumentGraphNode|null=>{
    // Own node keys only: an inherited name such as __proto__ is never a node, and never written through.
    if(key==='__proto__'||!Object.hasOwn(nodes,key))return null;
    const node=nodes[key];if(!node)return null;
    if(!own.has(key)){nodes[key]=structuredClone(node);own.add(key);}
    return nodes[key]!;
  };
  for(const key of patch.removed)delete nodes[key];
  for(const [key,node] of Object.entries(patch.inserted)){nodes[key]={...structuredClone(node),selfVersion:revision,childrenVersion:revision,subtreeVersion:revision};own.add(key);}
  for(const [key,write] of Object.entries(patch.updated)){
    const node=writable(key);if(!node)return null;
    Object.assign(node,applyDocumentPatch(node,write.patches));
    if(write.self)node.selfVersion=revision;
    if(write.children)node.childrenVersion=revision;
  }
  for(const key of patch.touched){const node=writable(key);if(!node)return null;node.subtreeVersion=revision;}
  for(const [key,delta] of Object.entries(patch.unitDeltas)){const node=writable(key);if(!node)return null;node.subtreeUnits+=delta;}
  for(const {id} of patch.claims)Object.defineProperty(claimedIds,id,{value:revision,enumerable:true,writable:true,configurable:true});
  return {...current,nodes,claimedIds,bytes:current.bytes+patch.byteDelta};
}
