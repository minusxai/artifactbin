import {grantsOf,grantsPermitRead} from '../datasets/policy/grants';
import { effectiveRole, type ArtifactRow } from './access';
import type { TokenActor } from '@/lib/accounts/actors';
import { getArtifactById, getEditableArtifactFor } from './store';
import {servableDocument} from './servable';
import {canRead,canEdit,canAnnotate,type ArtifactRole} from './share-roles';
import {publicCatalogOf} from '../datasets/catalog';

/** Read access never implies access to the editable governance or connection definition. */
export async function readableArtifact(actor:TokenActor,id:string){
 const row=await getArtifactById(id);
 if(!row)return null;
 const role=await effectiveRole(row,actor);
 if(grantsOf(row))return await grantsPermitRead(row,actor)?{row,role:role==='none'?'viewer' as const:role}:null;
 return canRead(role)?{row,role}:null;
}

/**
 * The head a snapshot read answers with, for this reader: an editor reads the head it will edit, anyone else the head
 * as served. Either refuses a retired shape (lib/artifacts/servable). lib/annotations/wire inlines the open
 * annotations into it, then narrows it with `snapshotForReader`.
 */
export async function snapshotHeadFor(actor:TokenActor,id:string){
 const readable=await readableArtifact(actor,id);if(!readable)return null;
 const {row,role}=readable;const editable=canEdit(role);
 // Recheck the edit predicate in the query that reads the invitation snapshot.
 const snapshot=editable?await getEditableArtifactFor(actor,id):servableDocument(row);
 return snapshot?{row,role,snapshot}:null;
}

/** A snapshot's wire narrowed to what this reader may see, with the capabilities their role grants. */
export function snapshotForReader(wire:Record<string,unknown>,row:ArtifactRow,role:ArtifactRole){
 const editable=canEdit(role);
 if(!editable){
  for(const field of ['shares','dataset_policy','policy_revision','sharing_revision','actor_user_id','actor_token_id'])delete wire[field];
  if(row.format==='dataset'){
   wire.markup=null;
   wire.meta={catalog:publicCatalogOf(row)};
  }
 }
 return {...wire,capabilities:{comment_receipts:true,mutation_receipts:true,read:true,edit:editable,comment:canAnnotate(role),sharing:editable,delete:role==='owner',restore:role==='owner'}};
}
