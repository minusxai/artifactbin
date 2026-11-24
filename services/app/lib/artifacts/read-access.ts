/**
 * READER ADMISSION: the one read decision every serving path makes (`canReadArtifact`), the door's admission over it
 * (`admitRead`: an export key or the creating token, then the rule), the readable row with the reader's role, the
 * snapshot a reader is answered with, and the route gate for a capability. Decided by the access rule
 * (@/lib/artifact-access) over the rows this module reads.
 */
import { can, refusalFor, effectiveRole, type AccessFacts, type ArtifactRow } from '@/lib/artifact-access';
import type { Capability } from '@artifactbin/contracts/testusers';
import type { Reply } from '@/lib/http';
import type { AccessActor } from '@/lib/accounts';
import { getArtifactById, getArtifactHeaderById, getEditableArtifactFor, type ArtifactHeader } from './rows';
import { readPageIdentity, type ArtifactIdentity } from './current-page';
import {servableDocument} from './servable';
import { holdsCreatingToken } from '@/lib/artifact-access';
import {liveConnectionOf,publicCatalogOf} from '@/lib/datasets';
import {datasetExportable,datasetReadAccess,datasetRole} from '@/lib/dataset-permissions';
import {canRead, canEdit, canAnnotate, type ArtifactRole} from '@artifactbin/contracts/sharing';

type ReadSubject = Pick<ArtifactRow, 'id' | 'visibility' | 'user_id' | 'link_role'>
  & Partial<Pick<ArtifactRow, 'format' | 'group_id' | 'token_id' | 'meta' | 'dataset_policy' | 'policy_revision'>>;

/** A live dataset's sharing admits its connection summary. Stored datasets require a select rule. */
async function datasetAdmits(row: Parameters<typeof datasetReadAccess>[0], reader: AccessActor): Promise<boolean> {
  return liveConnectionOf(row.meta)
    ? (await datasetRole(row, reader)) !== null
    : (await datasetReadAccess(row, reader)).allowed;
}

/**
 * The ONE read-access decision, made by every public serving path before any
 * bytes leave. Fail closed: an unresolvable session is just a null viewer.
 */
export async function canReadArtifact(
  row: ReadSubject,
  actor: AccessActor,
  /** Where the decision reads groups, kinds and shares (lib/artifact-access access facts): live by default. */
  facts?: AccessFacts,
): Promise<boolean> {
  // Bare-token ownership is not consulted here — sound because `private` requires an account to anchor its
  // ACL (getSharingFor's canPrivate), so a token-owned document is never private. The reader is the account.
  const reader: AccessActor = { ...actor, tokenId: null };
  if (row.format === 'dataset' || row.format === undefined) {
    // The account rule ignores the creating token. A projection without
    // dataset metadata or policy still needs a header to decide.
    const dataset = row.format === 'dataset' && row.meta !== undefined && row.dataset_policy !== undefined
      ? { ...row, format: row.format, meta: row.meta, token_id: null }
      : await getArtifactHeaderById(row.id);
    if (!dataset) return false;
    if (dataset.format === 'dataset') return datasetAdmits(dataset, reader);
  }
  // One decision, asked one way: reading is simply the bottom of the lattice.
  return canRead(await effectiveRole({ ...row, token_id: '' }, reader, facts));
}

/**
 * THE DOOR'S READ ADMISSION, which every door serving a document's bytes asks: a signed export key for this row
 * (`exporting`, verified by the caller), the token that created the row, or the access rule (`canReadArtifact`).
 * `need: 'export'` asks a dataset for a role that sees it whole, since its image renders every row.
 */
export async function admitRead(
  row: ReadSubject & Pick<ArtifactRow, 'token_id'>,
  actor: AccessActor,
  options: { facts?: AccessFacts; exporting?: boolean; need?: 'read' | 'export' } = {},
): Promise<boolean> {
  if (options.exporting || holdsCreatingToken(row, actor)) return true;
  if (options.need === 'export' && row.format === 'dataset') return datasetExportable(await datasetReadAccess(row as Parameters<typeof datasetReadAccess>[0], actor));
  return canReadArtifact(row, actor, options.facts);
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
export async function capabilityGuard(actor: AccessActor, capability: Capability, artifactId: string): Promise<Reply | null> {
  const row = await getArtifactById(artifactId);
  if (!row || !(await can(actor, 'read', row))) return null;
  return (await can(actor, capability, row)) ? null : refusalFor(actor, artifactId);
}


interface ReadableArtifact<T extends ArtifactHeader> { row:T; role:ArtifactRole }
/** Share one admission policy across full content and source-free metadata reads. */
async function readableRow<T extends ArtifactHeader>(actor:AccessActor,row:T|null):Promise<ReadableArtifact<T>|null>{
 if(!row)return null;
 const role=await effectiveRole(row,actor);
 if(row.format==='dataset')return (await datasetAdmits(row,actor))?{row,role:role==='none'?'viewer':role}:null;
 return canRead(role)?{row,role}:null;
}
interface ReadOptions {
  /** The account rule ignores creating tokens. Byte doors may admit them. */
  admission: 'account' | 'door';
  /** Some doors serve only these formats. Check that before consulting their policies. */
  formats?: readonly ArtifactRow['format'][];
}

/** Read access never implies access to the editable governance or connection definition. */
export function readableArtifact(actor: AccessActor, id: string): Promise<ReadableArtifact<ArtifactRow> | null>;
export function readableArtifact(actor: AccessActor, id: string, options: ReadOptions): Promise<{ row: ArtifactRow } | null>;
export async function readableArtifact(actor: AccessActor, id: string, options?: ReadOptions) {
  const row = await getArtifactById(id);
  if (!options) return readableRow(actor, row);
  if (!row || (options.formats && !options.formats.includes(row.format))) return null;
  const admitted = options.admission === 'account' ? await canReadArtifact(row, actor) : await admitRead(row, actor);
  return admitted ? { row } : null;
}
/** Admit a source-free identity read, with the live revision for the cached shell. */
export async function readableArtifactIdentity(actor:AccessActor,id:string):Promise<{row:ArtifactIdentity;role:ArtifactRole;live:number}|null>{
 const found=await readPageIdentity(id);
 if(!found)return null;
 const readable=await readableRow(actor,found.row as ArtifactHeader&ArtifactIdentity);
 return readable&&{...found,role:readable.role};
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
  for(const field of ['shares','dataset_policy','policy_revision','sharing_revision','actor_user_id','actor_token_id','actor_group_id','content_publisher_user_id'])delete wire[field];
  if(row.format==='dataset'){
   wire.markup=null;
   wire.meta={catalog:publicCatalogOf(row)};
  }
 }
 return {...wire,capabilities:{comment_receipts:true,mutation_receipts:true,read:true,edit:editable,comment:canAnnotate(role),sharing:editable,delete:role==='owner',restore:role==='owner'}};
}
