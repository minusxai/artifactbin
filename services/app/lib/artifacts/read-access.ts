import {grantsOf,grantsPermitRead} from '@/lib/artifacts/dataset-policy/grants';
import { effectiveRole } from './access';
import { type ArtifactRow } from './table';
import type { AccessActor } from '@/lib/accounts';
import { getArtifactById, getArtifactHeaderById, getArtifactIdentityById, getEditableArtifactFor, type ArtifactHeader, type ArtifactIdentity } from './rows';
import {servableDocument} from './servable';
import {canRead,canEdit,canAnnotate,type ArtifactRole} from '@artifactbin/contracts';
import {publicCatalogOf} from '../datasets/catalog';

interface ReadableArtifact<T extends ArtifactHeader> { row:T; role:ArtifactRole }
/** Share one admission policy across full content and source-free metadata reads. */
async function readableRow<T extends ArtifactHeader>(actor:AccessActor,row:T|null):Promise<ReadableArtifact<T>|null>{
 if(!row)return null;
 const role=await effectiveRole(row,actor);
 if(grantsOf(row))return await grantsPermitRead(row,actor)?{row,role:role==='none'?'viewer':role}:null;
 return canRead(role)?{row,role}:null;
}
/** Read access never implies access to the editable governance or connection definition. */
export async function readableArtifact(actor:AccessActor,id:string){
 return readableRow(actor,await getArtifactById(id));
}
/** Admission from the identity columns alone (no source, document or metadata body): a fence's re-check. Access decisions read no `meta`. */
export async function readableArtifactIdentity(actor:AccessActor,id:string):Promise<{row:ArtifactIdentity;role:ArtifactRole}|null>{
 const row=await getArtifactIdentityById(id);
 const readable=await readableRow(actor,row as unknown as (ArtifactHeader&ArtifactIdentity)|null);
 return readable&&{row:readable.row,role:readable.role};
}
/** Admission without loading a page's source or document; empty sidecar reads stay cheap. */
export async function readableArtifactHeader(actor:AccessActor,id:string){
 return readableRow(actor,await getArtifactHeaderById(id));
}

/**
 * The head a snapshot read answers with, for this reader: an editor reads the head it will edit, anyone else the head
 * as served. Either refuses a retired shape (lib/artifacts/servable). lib/annotations/wire inlines the open
 * annotations into it, then narrows it with `snapshotForReader`.
 */
export async function snapshotHeadFor(actor:AccessActor,id:string){
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
