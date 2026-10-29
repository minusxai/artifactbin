/**
 * THE GRAPH ON THE EDITOR'S WIRE. The stored graph (`createDocumentGraph`) spells every node out: its AST, its
 * source parts, its selectors, references, parent and child lists and four length counters. On a 450 KB document
 * that is 10 MB, 23 times its source, and the editor already holds the source. Nearly all of it is a pure function
 * of the source and of which node key sits where, so the wire form carries only what is not:
 *
 *  - `keys`: every node's key in document (pre-)order, the root left out. Patches and the server's guards address
 *    nodes by these, so the editor must hold the server's exact keys, never ones it invented.
 *  - `versions`: each node's three version stamps in the same order, run-length coded (most nodes were last
 *    touched by the same version).
 *  - `parts`: only the nodes whose stored source parts are not the canonical ones (a graph made with
 *    `preserveSource`: a fork, an archive, a migration keeps its authored whitespace).
 *  - `claimedIds`, `bytes` and `policy`, which no source can say (a deleted node's id stays claimed).
 *
 * The receiver parses the source, assigns the keys in order and lets `createDocumentGraph` derive the rest.
 * `packDocumentGraph` proves that inflating its answer reproduces the stored graph exactly, and answers null
 * (the caller then ships the whole graph) when it does not: this form never has to be trusted, only checked.
 */
import {GRAPH_ROOT,createDocumentGraph,type DocumentGraph,type GraphAstNode} from './document-graph';
import {parseJsx} from '../jsx';

export interface PackedDocumentGraph {
  packed:1;
  policy:string;
  bytes:number;
  claimedIds:Record<string,number>;
  /** Pre-order node keys, the root excluded. */
  keys:string[];
  /** Run-length coded `[count, self, children, subtree]` quadruples over `[root, ...keys]`. */
  versions:number[];
  /** Stored parts of the nodes whose parts the source does not rebuild. */
  parts?:Record<string,string[]>;
}

const utf8Length=(value:string)=>new TextEncoder().encode(value).length;
const sameParts=(a:string[],b:string[])=>a.length===b.length&&a.every((part,i)=>part===b[i]);

/** The graph the source alone rebuilds, carrying the given keys, every version stamp 0. */
function rebuild(source:string,keys:string[]):DocumentGraph {
  const parsed=parseJsx(source);
  if(!parsed.ok)throw new Error(parsed.error);
  let next=0;
  const assign=(nodes:GraphAstNode[])=>{
    for(const node of nodes){
      const key=keys[next++];
      if(key===undefined)throw new Error('The graph has fewer nodes than the source');
      node.graphKey=key;
      if(node.type==='element')assign(node.children);
    }
  };
  assign(parsed.nodes);
  if(next!==keys.length)throw new Error('The graph has more nodes than the source');
  return createDocumentGraph(parsed.nodes,0);
}

function inflate(base:DocumentGraph,packed:PackedDocumentGraph):DocumentGraph {
  const order=[GRAPH_ROOT,...packed.keys];
  let at=0;
  for(let run=0;run<packed.versions.length;run+=4){
    for(let n=0;n<packed.versions[run]!;n++){
      const node=base.nodes[order[at++]!];
      if(!node)throw new Error('The graph versions name a missing node');
      node.selfVersion=packed.versions[run+1]!;node.childrenVersion=packed.versions[run+2]!;node.subtreeVersion=packed.versions[run+3]!;
    }
  }
  if(at!==order.length)throw new Error('The graph versions do not cover its nodes');
  const overrides=Object.entries(packed.parts??{});
  for(const [key,parts] of overrides){
    const node=base.nodes[key];
    if(!node||node.parts.length!==parts.length)throw new Error('The graph parts name a missing node');
    node.parts=parts;node.bytes=utf8Length(parts.join(''));node.partUnits=parts.map(part=>part.length);node.units=node.partUnits.reduce((sum,n)=>sum+n,0);
  }
  // A node's subtree length sums its descendants': children come after their parent in pre-order, so walk it backwards.
  if(overrides.length)for(let i=order.length-1;i>=0;i--){
    const node=base.nodes[order[i]!]!;
    node.subtreeUnits=node.children.reduce((sum,child)=>sum+base.nodes[child]!.subtreeUnits,node.units);
  }
  return {...base,policy:packed.policy,claimedIds:packed.claimedIds,bytes:packed.bytes};
}

/** The editor's graph from its wire form and the source it came with. Throws when they do not belong together. */
export function unpackDocumentGraph(packed:PackedDocumentGraph,source:string):DocumentGraph {
  return inflate(rebuild(source,packed.keys),packed);
}

/** `undefined` members count as absent, as they do once a graph has been through JSON. */
function sameValue(a:unknown,b:unknown):boolean {
  if(a===b)return true;
  if(typeof a!=='object'||typeof b!=='object'||!a||!b)return false;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,i)=>sameValue(value,b[i]));
  const defined=(value:object)=>Object.entries(value).filter(([,member])=>member!==undefined);
  const left=defined(a),right=defined(b);
  return left.length===right.length&&left.every(([name,value])=>sameValue(value,(b as Record<string,unknown>)[name]));
}

/** The wire form of a stored graph, or null when inflating it with `source` would not give the graph back exactly. */
export function packDocumentGraph(graph:DocumentGraph,source:string):PackedDocumentGraph|null {
  try{
    const keys:string[]=[];
    const visit=(key:string)=>{keys.push(key);for(const child of graph.nodes[key]!.children)visit(child);};
    for(const child of graph.nodes[GRAPH_ROOT]!.children)visit(child);
    const base=rebuild(source,keys),order=[GRAPH_ROOT,...keys];
    const versions:number[]=[],parts:Record<string,string[]>={};
    for(const key of order){
      const node=graph.nodes[key]!;
      if(!sameParts(node.parts,base.nodes[key]!.parts))parts[key]=node.parts;
      const last=versions.length-4;
      if(last>=0&&versions[last+1]===node.selfVersion&&versions[last+2]===node.childrenVersion&&versions[last+3]===node.subtreeVersion)versions[last]!++;
      else versions.push(1,node.selfVersion,node.childrenVersion,node.subtreeVersion);
    }
    const packed:PackedDocumentGraph={packed:1,policy:graph.policy,bytes:graph.bytes,claimedIds:graph.claimedIds,keys,versions,...(Object.keys(parts).length?{parts}:{})};
    return sameValue(inflate(base,packed),graph)?packed:null;
  }catch{return null;}
}
