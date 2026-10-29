/**
 * READER ADMISSION: the one read decision every serving path makes, the readable row with the reader's role, the
 * snapshot a reader is answered with, and the route gate for a capability. Decided by the access rule
 * (@/lib/artifact-access) over the rows this module reads.
 */
import { can, capabilityRefusal, effectiveRole, grantsOf, grantsPermitRead, type ArtifactRow } from '@/lib/artifact-access';
import type { Capability } from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import { getArtifactById, getArtifactHeaderById, getArtifactIdentityById, getEditableArtifactFor, type ArtifactHeader, type ArtifactIdentity } from './rows';
import {servableDocument} from './servable';
import {publicCatalogOf} from '@/lib/datasets';
import {canRead,canEdit,canAnnotate,type ArtifactRole} from '@artifactbin/contracts';

/**
 * The ONE read-access decision, made by every public serving path before any
 * bytes leave. Fail closed: an unresolvable session is just a null viewer.
 */
export async function canReadArtifact(
  row: Pick<ArtifactRow, 'id' | 'visibility' | 'user_id' | 'link_role'> & Partial<Pick<ArtifactRow,'format'|'group_id'>>,
  actor: AccessActor,
): Promise<boolean> {
  // Bare-token ownership is not consulted here — sound because `private` requires an account to anchor its
  // ACL (getSharingFor's canPrivate), so a token-owned document is never private. The reader is the account.
  const reader: AccessActor = { ...actor, tokenId: null };
  if(row.format==='dataset'||row.format===undefined){
    // A dataset's policy and visibility are columns of its header; its rows (the `source`) are never consulted here.
    const dataset=await getArtifactHeaderById(row.id);
    if(!dataset)return false;
    if(grantsOf(dataset))return grantsPermitRead(dataset,reader);
  }
  // One decision, asked one way: reading is simply the bottom of the lattice.
  return canRead(await effectiveRole({ ...row, token_id: '' }, reader));
}

/**
 * THE ROUTE-LEVEL GATE, for the doors that hold an id rather than a row: the
 * refusal to answer, or null to carry on.
 *
 * An id this actor cannot READ answers `null` on purpose — including one that
 * names nothing. "Does it exist" is the caller's own question and its own
 * uniform 404, and a capability refusal must never become the door that tells a
 * stranger an id is real: the gate speaks only to someone the artifact is
 * already visible to.
 */
export async function capabilityGuard(actor: AccessActor, capability: Capability, artifactId: string): Promise<Response | null> {
  const row = await getArtifactById(artifactId);
  if (!row || !(await can(actor, 'read', row))) return null;
  return (await can(actor, capability, row)) ? null : capabilityRefusal(actor, artifactId);
}


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
