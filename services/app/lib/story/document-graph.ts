/** Canonical document data, addressed independently of sibling positions.
 * This module knows serialization and tree integrity, never publication policy.
 * Source fragments are server-derived; they are not a second JSX interpreter.
 */
import {randomUUID} from 'node:crypto';
import type {DocumentPath} from '@artifactbin/contracts';
import type {JsxNode} from '../jsx/types';
import {parseJsx} from '../jsx/parse';
import {serializeJsx} from '../jsx/serialize';
import {graphSelectors} from './document-graph-selectors';
import {collectRefUses} from './refs';
import {inertProse,PROSE_HTML_PARENTS} from './document-prose';
import {encodeDocumentNodes,decodeDocumentNodes,type StoredTree} from './document-node-codec';

export const GRAPH_ROOT='$root';
export const GRAPH_POLICY='validated-graph-v3';
export type GraphAstNode=JsxNode & {graphKey?:string};
export interface DocumentGraphNode {
  ast:StoredTree|null;
  selectors:string[];
  refs:Array<{id:string;kind:string}>;
  parent:string|null;
  children:string[];
  /** Parts surround children: parts[0], child[0], parts[1], … */
  parts:string[];
  bytes:number;
  units:number;
  partUnits:number[];
  subtreeUnits:number;
  prose:boolean;
  selfVersion:number;
  childrenVersion:number;
  subtreeVersion:number;
}
export interface DocumentGraph {
  schema:3;
  kind:'graph';
  policy:string;
  nodes:Record<string,DocumentGraphNode>;
  claimedIds:Record<string,number>;
  bytes:number;
}

function ownParts(node:JsxNode):string[] {
  if(node.type!=='element'||!node.children.length)return [serializeJsx([node])];
  const nonce=randomUUID(),markers=node.children.map((_,i)=>`Graph${nonce}Child${i}End`);
  const source=serializeJsx([{...node,children:markers.map(value=>({type:'text' as const,value,start:0,end:0}))}]);
  const parts:string[]=[];
  let offset=0;
  const rendered=node.control?.kind==='and'?markers.slice(0,1):markers;
  for(const marker of rendered){
    const at=source.indexOf(marker,offset);
    if(at<offset||source.indexOf(marker,at+marker.length)!==-1)throw new Error('Invalid child serialization boundary');
    parts.push(source.slice(offset,at));offset=at+marker.length;
  }
  parts.push(source.slice(offset));
  if(node.control?.kind==='and')parts.push('');
  return parts;
}

export function createDocumentGraph(source:string|JsxNode[],version:number):DocumentGraph {
  const parsed=typeof source==='string'?parseJsx(source):{ok:true as const,nodes:source};
  if(!parsed.ok)throw new Error(parsed.error);
  const nodes:Record<string,DocumentGraphNode>={};
  const visit=(node:GraphAstNode,parent:string,context:{implicit?:boolean;isolated?:boolean;helmet?:boolean;parentTag?:string}={}):string=>{
    const {implicit=false,isolated=false,helmet=false,parentTag=''}=context;
    if(implicit&&(node.type!=='element'||node.control?.kind!=='fragment'||node.children.length))throw new Error('An AND expression has no editable false branch');
    const key=node.graphKey??randomUUID();
    if(key===GRAPH_ROOT||Object.hasOwn(nodes,key))throw new Error('Duplicate internal node identity');
    const {graphKey:discarded,...plain}=node;
    void discarded;
    const parts=implicit?['']:ownParts(node),own=plain.type==='element'?{...plain,children:[]}:plain;
    const referenceNode=node.type==='element'&&['Query','Mutation'].includes(node.tag)?node:own;
    const refs=isolated||node.type!=='element'||node.control?[]:(collectRefUses(serializeJsx([referenceNode]))??[]).map(({id,kind})=>({id,kind}));
    const record:DocumentGraphNode={ast:encodeDocumentNodes([own]),selectors:isolated?[]:graphSelectors(node),refs,parent,children:[],parts,bytes:Buffer.byteLength(parts.join('')),units:parts.reduce((sum,p)=>sum+p.length,0),partUnits:parts.map(part=>part.length),subtreeUnits:0,prose:node.type==='text'&&!isolated&&!helmet&&PROSE_HTML_PARENTS.has(parentTag)&&inertProse(node.value),selfVersion:version,childrenVersion:version,subtreeVersion:version};
    nodes[key]=record;
    if(node.type==='element')record.children=node.children.map((child,index)=>visit(child,key,{implicit:node.control?.kind==='and'&&index===1,isolated:isolated||node.tag==='Iframe',helmet:helmet||node.tag==='Helmet',parentTag:node.tag}));
    record.subtreeUnits=record.units+record.children.reduce((sum,child)=>sum+nodes[child]!.subtreeUnits,0);
    return key;
  };
  const children=parsed.nodes.map(node=>visit(node,GRAPH_ROOT));
  nodes[GRAPH_ROOT]={ast:null,selectors:[],refs:[],parent:null,children,parts:children.map(()=>'' ).concat(''),bytes:0,units:0,partUnits:children.map(()=>0).concat(0),subtreeUnits:children.reduce((sum,child)=>sum+nodes[child]!.subtreeUnits,0),prose:false,selfVersion:version,childrenVersion:version,subtreeVersion:version};
  return {schema:3,kind:'graph',policy:GRAPH_POLICY,nodes,claimedIds:Object.fromEntries(Object.values(nodes).flatMap(node=>node.selectors.filter(selector=>selector.startsWith('id:')).map(selector=>[selector.slice(3),version]))),bytes:Object.values(nodes).reduce((sum,n)=>sum+n.bytes,0)};
}

export function graphNodeAt(graph:DocumentGraph,path:DocumentPath):string {
  let key=GRAPH_ROOT;
  for(const index of path){
    const next=graph.nodes[key]?.children[index];
    if(next===undefined)throw new Error('Node does not exist');
    key=next;
  }
  return key;
}

export function graphAncestors(graph:DocumentGraph,key:string):string[] {
  const ancestors:string[]=[],seen=new Set([key]);
  let parent=graph.nodes[key]?.parent;
  if(parent===undefined)throw new Error('Node does not exist');
  while(parent!==null){
    if(seen.has(parent)||!graph.nodes[parent])throw new Error('Invalid parent chain');
    seen.add(parent);ancestors.push(parent);parent=graph.nodes[parent]!.parent;
  }
  return ancestors;
}

export function graphNodes(graph:DocumentGraph):GraphAstNode[] {
  const active=new Set<string>();
  const visit=(key:string):GraphAstNode=>{
    const record=graph.nodes[key];
    if(!record?.ast||active.has(key))throw new Error('Invalid document graph');
    active.add(key);
    const node=decodeDocumentNodes(record.ast)[0] as GraphAstNode;
    if(!node)throw new Error('Missing node data');
    node.graphKey=key;
    if(node.type==='element')node.children=record.children.map(visit);
    active.delete(key);return node;
  };
  const root=graph.nodes[GRAPH_ROOT];if(!root)throw new Error('Missing document root');
  return root.children.map(visit);
}

export function graphSource(graph:DocumentGraph):string {
  const active=new Set<string>();
  const visit=(key:string):string=>{
    const node=graph.nodes[key];if(!node||active.has(key))throw new Error('Invalid document graph');
    active.add(key);
    if(node.children.length&&node.parts.length!==node.children.length+1)throw new Error('Invalid source boundaries');
    const result=node.parts[0]!+node.children.map((child,i)=>visit(child)+node.parts[i+1]!).join('');
    active.delete(key);return result;
  };
  return visit(GRAPH_ROOT);
}

/** Diagnostic oracle for tests and representation migrations. Operations enforce
 * the same invariants through their contracts and atomic dependency guards. */
export function graphIntegrity(graph:DocumentGraph):string[] {
  const errors:string[]=[],visited=new Set<string>(),active=new Set<string>();
  const visit=(key:string,parent:string|null)=>{
    const node=graph.nodes[key];
    if(!node){errors.push(`Missing node ${key}`);return;}
    if(active.has(key)){errors.push(`Cycle ${key}`);return;}
    if(visited.has(key)){errors.push(`Multiple parents ${key}`);return;}
    visited.add(key);active.add(key);
    if(node.parent!==parent)errors.push(`Wrong parent ${key}`);
    if(node.parts.length!==node.children.length+1)errors.push(`Wrong parts ${key}`);
    if(node.bytes!==Buffer.byteLength(node.parts.join(''))||node.units!==node.parts.join('').length)errors.push(`Wrong lengths ${key}`);
    if(JSON.stringify(node.partUnits)!==JSON.stringify(node.parts.map(part=>part.length)))errors.push(`Wrong part lengths ${key}`);
    if(node.subtreeUnits!==node.units+node.children.reduce((sum,child)=>sum+(graph.nodes[child]?.subtreeUnits??0),0))errors.push(`Wrong subtree length ${key}`);
    node.children.forEach(child=>visit(child,key));active.delete(key);
  };
  visit(GRAPH_ROOT,null);
  if(visited.size!==Object.keys(graph.nodes).length)errors.push('Unreachable nodes');
  if(Object.values(graph.nodes).reduce((sum,n)=>sum+n.bytes,0)!==graph.bytes)errors.push('Wrong document length');
  return errors;
}

/** Derived references follow document order, matching the publisher's first use. */
export function graphReferences(graph:DocumentGraph):Array<{id:string;kind:string}> {
 const result:Array<{id:string;kind:string}>=[],seen=new Set<string>();
 const visit=(key:string)=>{const node=graph.nodes[key]!;for(const ref of node.refs)if(!seen.has(ref.id)){seen.add(ref.id);result.push(ref);}node.children.forEach(visit);};
 visit(GRAPH_ROOT);return result;
}
