/** Select the existing validator's input and the database dependencies consumed
 * by that input. This is planning data, never a publication certificate. */
import type {JsxNode} from '../jsx/types';
import {serializeJsx} from '../jsx/serialize';
import {decodeDocumentNodes} from './document-node-codec';
import {GRAPH_ROOT,graphAncestors,graphNodes,type DocumentGraph,type GraphAstNode} from './document-graph';
import {prepareGraphPatch,selectGraphKeys,type GraphFacet} from './document-graph-patch';

export interface GraphValidationScope {
 source:string;
 reads:Array<{key:string;facet:GraphFacet}>;
 selectors:string[];
 errors:string[];
}
const neighborhoods=new Set(['Helmet','Iframe']);
export function graphValidationScope(before:DocumentGraph,after:DocumentGraph):GraphValidationScope {
 const patch=prepareGraphPatch(before,after,0),full=new Set<string>(),shells=new Set<string>(),selectors=new Set<string>(),errors=new Set<string>(),reads=new Map<string,{key:string;facet:GraphFacet}>();
 const roots=graphNodes(after),nodes=new Map<string,GraphAstNode>();
 const index=(list:GraphAstNode[])=>{for(const node of list){nodes.set(node.graphKey!,node);if(node.type==='element')index(node.children);}};index(roots);
 const read=(key:string,facet:GraphFacet)=>{if(before.nodes[key])reads.set(`${key}:${facet}`,{key,facet});};
 const changed=new Set([...patch.removed,...Object.keys(patch.inserted),...Object.keys(patch.updated)]);
 const changedDeclarations=new Set<string>();
 for(const graph of [before,after])for(const key of changed)if(graph.nodes[key]){
  for(const ancestor of [key,...graphAncestors(graph,key)])for(const selector of graph.nodes[ancestor]!.selectors)if(selector.startsWith('declaration:'))changedDeclarations.add(selector.slice(12));
 }
 const pending:Array<{key:string;whole:boolean}>=[],processed=new Set<string>();
 const shell=(key:string)=>{if(shells.has(key))return;shells.add(key);read(key,'selfVersion');if(key!==GRAPH_ROOT)pending.push({key,whole:false});};
 const columnNameChanged=(key:string)=>{
  const node=nodes.get(key);if(node?.type!=='element'||node.tag!=='Column')return false;
  const stored=before.nodes[key]?.ast,prior=stored?decodeDocumentNodes(stored)[0]:undefined;
  if(prior?.type!=='element'||prior.tag!=='Column')return true;
  return JSON.stringify(prior.attributes.find(attr=>attr.name==='col')?.value)!==JSON.stringify(node.attributes.find(attr=>attr.name==='col')?.value);
 };
 const include=(key:string,whole=true)=>{
  if(key===GRAPH_ROOT)return;
  if(!after.nodes[key])return;
  // These contracts inspect relationships among children, not just each child.
  for(const ancestor of [key,...graphAncestors(after,key)]){
   const node=nodes.get(ancestor);
   if(node?.type==='element'&&(neighborhoods.has(node.tag)||node.tag==='DataTable'&&(ancestor===key||columnNameChanged(key))||node.control&&node.control.kind!=='fragment')){key=ancestor;whole=true;}
  }
  for(const ancestor of graphAncestors(after,key))shell(ancestor);
  if(!whole){shell(key);return;}
  if(full.has(key))return;
  full.add(key);read(key,'subtreeVersion');pending.push({key,whole:true});
 };
 const select=(selector:string):string[]=>{selectors.add(selector);return selectGraphKeys(after,selector);};
 const reference=(name:string)=>{for(const key of select(`declaration:${name}`))include(key);};
 const reversed=new Set<string>();
 const reverse=(name:string)=>{
  if(reversed.has(name))return;reversed.add(name);
  for(const selector of [`use:${name}`,`dependency:${name}`])for(const key of select(selector)){
   include(key);
   // A changed input can change the output shape of a query; its consumers
   // therefore participate even when the query's own source is unchanged.
   for(const fact of after.nodes[key]!.selectors)if(fact.startsWith('declaration:'))reverse(fact.slice(12));
  }
 };
 for(const [key,write] of Object.entries(patch.updated))include(key,write.self);
 for(const key of Object.keys(patch.inserted))include(key);
 for(const key of patch.removed){
  for(const ancestor of graphAncestors(before,key))if(after.nodes[ancestor]){include(ancestor,false);break;}
  for(const selector of before.nodes[key]!.selectors){
   if(selector.startsWith('use:'))reference(selector.slice(4));
   if(selector.startsWith('declaration:'))reverse(selector.slice(12));
  }
 }
 for(const name of changedDeclarations)reverse(name);
 while(pending.length){
  const entry=pending.pop()!;
  const visit=(at:string,descend:boolean)=>{
   const marker=`${at}:${descend}`;if(processed.has(marker))return;processed.add(marker);
   const record=after.nodes[at]!;
   for(const selector of record.selectors){
    if(selector.startsWith('id:')){
     if(select(selector).length>1)errors.add(`Duplicate authored node identity: ${selector.slice(3)}`);
    }else if(selector.startsWith('use:'))reference(selector.slice(4));
    else if(selector.startsWith('dependency:'))reference(selector.slice(11));
    else if(selector==='tag:Helmet'){
     for(const helmet of select(selector))if(helmet!==at)include(helmet);
    }else if(selector.startsWith('declaration:')){
     const name=selector.slice(12);
     for(const declaration of select(selector))if(declaration!==at)include(declaration);
     const node=nodes.get(at);
     if(changedDeclarations.has(name)||node?.type==='element'&&node.tag==='Mutation')reverse(name);
    }
   }
   if(descend)for(const child of record.children)visit(child,true);
  };visit(entry.key,entry.whole);
 }
 const project=(list:GraphAstNode[]):JsxNode[]=>list.flatMap(node=>{
  const key=node.graphKey!;
  if(full.has(key))return [node];
  if(!shells.has(key))return [];
  return node.type==='element'?[{...node,children:project(node.children)}]:[node];
 });
 return {source:serializeJsx(project(roots)),reads:[...reads.values()],selectors:[...selectors].sort(),errors:[...errors]};
}
