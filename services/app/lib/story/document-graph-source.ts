/** The source editor's identity boundary. Authored IDs survive moves; anonymous
 * nodes are matched only within an identified parent. Ambiguous matches become
 * replacements, which conservatively consume the old subtree on commit. */
import type {JsxNode} from '../jsx/types';
import {parseJsx} from '../jsx/parse';
import {serializeJsx} from '../jsx/serialize';
import {createDocumentGraph,graphNodes,type DocumentGraph,type GraphAstNode} from './document-graph';

const authoredId=(node:JsxNode):string|undefined=>{
 if(node.type!=='element'||node.control)return;
 const value=node.attributes.find(attribute=>attribute.name==='id')?.value;
 return value?.static&&typeof value.json==='string'?value.json:undefined;
};
const compatible=(a:JsxNode,b:JsxNode)=>a.type===b.type&&(a.type!=='element'||b.type==='element'&&a.tag===b.tag&&JSON.stringify(a.control)===JSON.stringify(b.control));
const walk=(nodes:GraphAstNode[],visit:(node:GraphAstNode)=>void)=>{
 for(const node of nodes){visit(node);if(node.type==='element')walk(node.children,visit);}
};
export function graphFromSource(before:DocumentGraph,source:string,version:number):DocumentGraph {
 const parsed=parseJsx(source);if(!parsed.ok)throw new Error(parsed.error);
 const oldRoots=graphNodes(before),oldIds=new Map<string,GraphAstNode>(),newIds=new Set<string>(),used=new Set<string>();
 walk(oldRoots,node=>{const id=authoredId(node);if(id){if(oldIds.has(id))throw new Error('Duplicate authored node identity');oldIds.set(id,node);}});
 walk(parsed.nodes,node=>{const id=authoredId(node);if(id){if(newIds.has(id))throw new Error('Duplicate authored node identity');newIds.add(id);}});
 const match=(fresh:GraphAstNode[],old:GraphAstNode[])=>{
  const pairs=new Map<GraphAstNode,GraphAstNode>();
  const bind=(node:GraphAstNode,prior:GraphAstNode|undefined)=>{
   if(!prior?.graphKey||used.has(prior.graphKey)||!compatible(node,prior))return;
   node.graphKey=prior.graphKey;used.add(prior.graphKey);pairs.set(node,prior);
  };
  // Assign explicit identities first, including nodes moved from another parent.
  for(const node of fresh){const id=authoredId(node);if(id)bind(node,oldIds.get(id));}
  // Unique exact subtrees anchor insertions/deletions without shifting identity.
  const oldSources=new Map<string,GraphAstNode[]>(),newCounts=new Map<string,number>();
  for(const node of old)if(!authoredId(node)&&node.graphKey&&!used.has(node.graphKey)){
   const source=serializeJsx([node]);oldSources.set(source,[...(oldSources.get(source)??[]),node]);
  }
  for(const node of fresh)if(!authoredId(node)){
   const source=serializeJsx([node]);newCounts.set(source,(newCounts.get(source)??0)+1);
  }
  for(const node of fresh)if(!authoredId(node)){
   const source=serializeJsx([node]),candidates=oldSources.get(source);
   if(candidates?.length===1&&newCounts.get(source)===1)bind(node,candidates[0]);
  }
  // A single remaining anonymous node of a compatible kind is a local edit.
  const remainingOld=old.filter(node=>!authoredId(node)&&node.graphKey&&!used.has(node.graphKey));
  const remainingNew=fresh.filter(node=>!authoredId(node)&&!pairs.has(node));
  if(remainingOld.length===1&&remainingNew.length===1)bind(remainingNew[0]!,remainingOld[0]);
  for(const node of fresh)if(node.type==='element'){
   const prior=pairs.get(node);
   match(node.children,prior?.type==='element'?prior.children:[]);
  }
 };
 match(parsed.nodes,oldRoots);
 return createDocumentGraph(parsed.nodes,version);
}
