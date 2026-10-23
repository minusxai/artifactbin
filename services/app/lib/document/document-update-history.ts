/** Compact preimages are for exact history reconstruction. User undo is a new
 * client-prepared operation against current dependency revisions. */
import {applyGraphPatch} from './document-graph-patch';
import type {DocumentGraph,DocumentGraphNode,GraphFacet,GraphPatch} from '@artifactbin/contracts';
export interface DocumentOperationHistory {
 kind:'operations';version:number;forward:GraphPatch;replacement?:DocumentGraph|null;beforeDocument?:DocumentGraph|null;
 beforeNodes:Record<string,DocumentGraphNode>;
 beforeRevisions:Record<string,Pick<DocumentGraphNode,GraphFacet>>;
 beforeBytes:number;
}

/** Replay the persisted operation, including replacement's revision and lifetime
 * identity rules. This is also the executable reference model for SQL tests. */
export function documentAfterOperation(before:DocumentGraph,edit:DocumentOperationHistory):DocumentGraph {
 if(!edit.replacement){
  const after=applyGraphPatch(before,edit.version-1,edit.forward);
  if(!after)throw new Error('History operation does not apply to its predecessor');
  return after;
 }
 const after=structuredClone(edit.replacement);
 for(const node of Object.values(after.nodes)){
  node.selfVersion=edit.version;node.childrenVersion=edit.version;node.subtreeVersion=edit.version;
 }
 after.claimedIds={...before.claimedIds,...Object.fromEntries(Object.keys(after.claimedIds).map(id=>[id,edit.version]))};
 return after;
}
