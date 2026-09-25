/** A lost reply can be acknowledged when every proposed facet is still present.
 * Compare only the operation's writes, allowing independent subsequent edits.
 * This confirms the desired outcome, not who performed an identical write. */
import {isDeepStrictEqual} from 'node:util';
import type {DocumentGraph,DocumentUpdate} from '@artifactbin/contracts';
import {applyGraphPatch} from '../../app/lib/story/document-graph-patch';
import type {Snapshot} from './workspace';
export function documentOutcomePresent(head:Snapshot,base:Snapshot|undefined,update:DocumentUpdate):boolean {
 const current=head.document as DocumentGraph|undefined,before=base?.document as DocumentGraph|undefined;
 if(current?.kind!=='graph')return false;
 const desired=update.replacement??(before?.kind==='graph'?applyGraphPatch(before,update.patch.baseVersion,update.patch):null);
 if(!desired)return false;
 const fields=(node:unknown)=>{
  if(!node||typeof node!=='object')return node;
  const {selfVersion:_self,childrenVersion:_children,subtreeVersion:_subtree,subtreeUnits:_units,...value}=node as Record<string,unknown>;
  return value;
 };
 if(update.whole){
  if(!isDeepStrictEqual(Object.keys(current.nodes).sort(),Object.keys(desired.nodes).sort()))return false;
  for(const [key,node] of Object.entries(desired.nodes))if(!isDeepStrictEqual(fields(current.nodes[key]),fields(node)))return false;
 }else{
  for(const key of update.patch.removed)if(current.nodes[key])return false;
  for(const key of [...Object.keys(update.patch.inserted),...Object.keys(update.patch.updated)])if(!isDeepStrictEqual(fields(current.nodes[key]),fields(desired.nodes[key])))return false;
 }
 for(const [key,value] of Object.entries(update.metadata??{}))if(!isDeepStrictEqual(head[key]??null,value))return false;
 for(const [key,value] of Object.entries(update.settings??{})){
  const actual=key==='parentId'?(head.ancestor_ids as string[]|undefined)?.at(-1)??null:head[key==='linkRole'?'link_role':key];
  if(!isDeepStrictEqual(actual,value))return false;
 }
 return true;
}
