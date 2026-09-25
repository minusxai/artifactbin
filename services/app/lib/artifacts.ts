import {artifactQuery,loadArtifactDocument,sourceStorage} from './artifact-document';
import {JOIN_RELATIONS,seedOwnerJoin} from './relation-state';
import {documentMentions} from './saved-mentions';
import { grantContext, grantsOf, grantsPermitRead, grantsPermitWrite, type GrantDocument } from './datasets/policy/grants';
import {storedMediaReferences} from './datasets/media-references';
import {claimArtifactId,reserveArtifactIds} from './artifact-identities';
import {collectRefUses} from '@/lib/story/refs';
import {hasDocumentEditorAccess,type VerifiedAccount} from './document-policy';
import {isQueryFailure} from '@artifactbin/contracts';
import {resolveUserValues} from '@/lib/story/user-values';
import type {DataflowState} from '@/lib/story/dataflow';
import {parseDatasetDefinition,serializeDatasetDefinition} from '@/lib/datasets/definition';
import {validateUserContent,validateUserWrites,userOptions,people,retainUserScope,resolveUserColumnScope} from '@/lib/datasets/user-fields';
import { SIGN_IN_REQUIRED } from '@/lib/story/sign-in-required';
import { ACCOUNT_REACH_SQL, isLinkOnlyActor, userKindOf } from '@/lib/user-kinds';
// A CYCLE, deliberately: the capability table reads `effectiveRole` from here
// and this file asks it who may act. Both sides use the other only at call
// time, and the alternative — a second place that decides what a KIND may do —
// is the thing lib/capabilities exists to prevent.
import { can, refusalFor, type CapabilityActor, type CapabilityRefusal } from '@/lib/capabilities';
import type { MutationReceipt } from './mutation-receipt';
import {sourceChanges} from './story/source-changes';
import {reserveCreation,completeCreation,type CreationOperation} from './creation-ledger';
import {artifactState} from './artifact-state';
import {channelFor} from './story/live';
import { annotationEffects, type AnnotationRecord, type AnnotationReceipt } from './story/annotation-edits';
import type { AnnotationOperation } from './editor-v2/annotation-map';
import {catalogOf} from '@/lib/datasets/catalog';
import {executeCatalog} from '@/lib/datasets/execute';
import {claimPendingDatasetSecret,resolveDatasetConnection} from '@/lib/datasets/secrets';
import {DatasetError} from '@/lib/datasets/errors';
/**
 * All artifact SQL. Every read/write is scoped by ownership — an id the caller
 * cannot reach is indistinguishable from a nonexistent one (callers answer a
 * uniform 404). Bearer callers act through a TokenActor: a token claimed by an
 * account works ACCOUNT-WIDE (user_id scope), an anonymous token reaches only
 * what it created (token_id scope).
 */
import { cache } from 'react';
import { trackEvent } from './analytics';
import { sourceWithoutAnchors } from './annotation-anchors';
import { ALLOW_PUBLIC_VISIBILITY, ARTIFACT_QUOTA_PER_TOKEN } from './config';
import { assetByteQuotaExceeded } from './asset-quota';
import { getDb, type Queryable } from './db';
import type {DatasetAccessPolicy as DatasetPolicy} from '@artifactbin/contracts';
import {defaultDatasetGrants,remapDatasetGrants,parseDatasetAccessPolicy} from '@artifactbin/utils';
import {validateDatasetPolicyForRow} from './datasets/policy/validation';
import { actorSubject, emit } from './events';
import { generateFileId } from './ids';
import { isDocumentFormat, parseContentInput, type ArtifactFormat } from './story/input';
import { canonicalizeMarkup, publishJsx, prepareJsx } from './story/jsx-tier';
import { imageRawUrl, imageRefData, pdfRawUrl } from './story/ref-data';
import { displayTitle } from './story/title';
import { assetWarningFor, importWebAsset, WebAssetRefused, type AssetWarning, type WebAssetKind } from './web-assets';
import { resolveWebFont, UnknownFontError } from './webfonts';
import { webIngestRateLimited } from './auth';
import { json } from './http';
import { loadDatasetRows } from './story/dataset-store';
import {
  applySplice, deriveSpliceByDiff, deriveSpliceFromStrings, newEditId, reconstructBaseSource,
  normalizeSplice, shiftThroughEdits, touchedSpanFor, type EditRecord, type Splice,
} from './story/splice';
import { rebaseEditBatch, resolveEditBatch, type BatchChange, type StringEdit } from './story/edit-batch';
import { nodeIndex, stampNodeIds } from './story/node-ids';
import { finalizeArtifactMetadata, readParsedArtifactMetadata } from './story/parsed-artifact-metadata';
import { parseJsx } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { datasetRefsInDataflow, initialValues, isEmptyDataflow, mutationTargets, scalarMatches, scalarParamTypes, selectedQueries, type Dataflow, type Row, type Scalar } from '@/lib/story/dataflow';
import { dryRunDataflow } from '@/lib/story/data-checks';
import { analyzeRowScopes, mutationUsesRow, mutationUsesValue } from '@/lib/story/row-scope';
import { compileStoredMutation } from '@/lib/datasets/stored-mutation';
import { canUseDataPolicy, mutationPolicy } from '@/lib/datasets/policy';
import { isMutationRefused, mutateDataset } from '@/lib/story/dataset-mutate';
import { runDataflow, type DatasetTables } from '@/lib/sql/run-dataflow';
import { queryRows } from '@/lib/datasets/query-rows';
import { runMutation } from '@/lib/sql/engine';
import { runLocalStateMutation, type LocalMutationResult } from '@/lib/story/local-state';
import { localTableOverrides } from '@/lib/story/local-tables';
import { ancestorsForMove, childrenTableFor, CHILDREN_COLUMNS, notifyParent, parentOf } from '@/lib/folders';
import type { RanDataflow, StoryIslandDataflow, StoryViewer } from '@/lib/story-runtime/contract';
import type { RefLoader, ResolvedRef } from '@/lib/story/refs';
import type { DatasetColumn } from '@/lib/story/data-tiers';
import { checkDocumentData } from '@/lib/story/data-checks';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { ANONYMOUS_CEILING, canEdit, canRead, capRole, maxRole, shareRolesAtLeast, type ArtifactRole, type ShareEntry, type ShareRole } from './share-roles';

/**
 * The read ACL. 'public' = anyone with the link may read, and owned docs list
 * on the owner's profile root (/@handle);
 * 'unlisted' = reads exactly like public but never lists anywhere;
 * 'private' = the owner plus the emails in artifact_shares. Defaults at create
 * (createArtifact): anonymous → 'public', or 'unlisted' where the deployment
 * has not opened public; user-owned → 'unlisted' for image/dataset/pdf/file
 * and 'private' otherwise.
 */
export type Visibility = 'public' | 'private' | 'unlisted';

/**
 * The WRITE ACL, on DATASETS only — the sibling of `visibility`, and the
 * whole toggle behind writable data:
 *   'read'      — the default and every dataset that predates this. Documents
 *                 may only SELECT from it; a `<Mutation>` naming it is refused
 *                 at publish, and at every call besides.
 *   'readwrite' — documents the dataset's OWNER publishes may insert, update
 *                 and delete rows through a declared `<Mutation>`, for
 *                 everyone who can read those documents.
 * Two separate questions, deliberately: `visibility` is who may READ the
 * artifact itself, this is who may CHANGE it through a document. Neither
 * implies the other — a public dataset stays read-only unless its owner says
 * otherwise, and an unlisted one can be the writable table behind a poll.
 */
export type DatasetAccess = 'read' | 'readwrite';
export const DATASET_ACCESS: readonly DatasetAccess[] = ['read', 'readwrite'];

// The share vocabulary lives in a PURE module (lib/share-roles) so the share
// menu can import it without the database; re-exported here as the one
// artifact contract every server caller already imports.
export { SHARE_ROLES, type ArtifactRole, type ShareEntry, type ShareRole } from './share-roles';

export interface ArtifactRow {
  id: string;
  token_id: string;
  /** Owner account; NULL until the creating token is claimed. */
  user_id: string | null;
  title: string | null;
  description: string | null;
  format: ArtifactFormat;
  content: string;
  source: string | null;
  meta: Record<string, unknown>;
  version: number;
  visibility: Visibility;
  /** The write ACL — datasets only; every other format carries the 'read' default and nothing reads it. */
  access: DatasetAccess;
  dataset_policy?: unknown;
  policy_revision?: number;
  sharing_revision?: number;
  /** Present only on an authorized governance snapshot, never a public summary. */
  shares?: ShareEntry[];
  /**
   * GENERAL ACCESS: what the LINK grants whoever holds the address. NULL means
   * `viewer`. Read it through `linkRoleOf`, never directly.
   */
  link_role: ShareRole | null;
  /**
   * PLACEMENT — the ids of this row's ancestors, root→parent. `[]` is the root,
   * the LAST element is the parent, the LENGTH is the level. lib/folders.ts is
   * the only module that does arithmetic on it; everything else asks that
   * module (`parentOf`, `resolveParent`, `childrenTableFor`).
   */
  ancestor_ids: string[];
  /** Head pointer of the edit protocol — unguessable, regenerated on every accepted write. */
  edit_id: string;
  /** Who made the head: the last accepted writer (an editor may differ from the owner). */
  actor_user_id: string | null;
  actor_token_id: string | null;
  created_at: string;
  updated_at: string;
  /**
   * PROVENANCE: the artifact this one was FORKED from — the immediate parent,
   * never a chain. NULL is "authored here". Written once at creation and never
   * updated: a fork's own life (versions, comments, shares) is its own from the
   * first save.
   */
  forked_from: string | null;
  /**
   * THE TRASH STAMP: NULL = live, a timestamp = deleted (lib/trash). It is on
   * the ROW type rather than only in the SQL because the gate is composed into
   * the row-loading seam and callers must not think to filter — the field is
   * here so lib/trash can read it, and it is dropped at the wire boundary,
   * where it could only ever echo null.
   */
  deleted_at: string | null;
}

/** Who is looking, as far as the serving paths know. Null = no session. */
export type Viewer = (VerifiedAccount & { userId: string; email: string | null }) | null;

/**
 * The ONE read-access decision, made by every public serving path before any
 * bytes leave. Fail closed: an unresolvable session is just a null viewer.
 */
export async function canReadArtifact(
  row: Pick<ArtifactRow, 'id' | 'visibility' | 'user_id' | 'link_role'> & Partial<Pick<ArtifactRow,'format'>>,
  viewer: Viewer,
): Promise<boolean> {
  if(row.format==='dataset'||row.format===undefined){
    const dataset=await getArtifactById(row.id);
    if(!dataset)return false;
    if(grantsOf(dataset))return grantsPermitRead(dataset,{userId:viewer?.userId??null,tokenId:null,email:viewer?.email});
  }
  // One decision, asked one way: reading is simply the bottom of the lattice.
  // A Viewer carries no token id, so bare-token ownership is not consulted
  // here — the same as before, and sound because `private` requires an account
  // to anchor its ACL (getSharingFor's canPrivate), so a token-owned document
  // is never private.
  return canRead(await effectiveRole({ ...row, token_id: '' }, { ...viewer, userId: viewer?.userId ?? null, tokenId: null }));
}

/** Any credential the serving paths resolve, as the ids and address effectiveRole needs. */
export interface RoleActor extends VerifiedAccount {
  userId: string | null;
  tokenId: string | null;
  /**
   * The address the session carries, when it carries one. Only ever consulted
   * for a share that is still UNRESOLVED — the moment one matches it is stamped
   * with the user id and matched by that forever after. Email is an attribute,
   * never an identity key.
   */
  email?: string | null;
}

/** Does this actor OWN the row — pure, the account by user_id, a bare token by token_id. */
export function ownsArtifact(row: Pick<ArtifactRow, 'user_id' | 'token_id'>, actor: RoleActor): boolean {
  if (actor.userId && row.user_id) return row.user_id === actor.userId;
  return !!actor.tokenId && row.token_id === actor.tokenId;
}

/**
 * The role this actor holds WITHOUT the link — ownership, or a share naming
 * them personally. The other half of `effectiveRole`, and it is separate
 * because one question in the product needs it alone: a LISTING.
 *
 * `unlisted` means "reads like public, listed nowhere", so a listing may not
 * be built from "may this viewer read it" — the link is exactly what an
 * unlisted row grants and exactly what a listing must not honour
 * (lib/folders childrenTableFor). Holding the address is not a relationship
 * to the row; ownership and an invitation are.
 *
 * Ownership short-circuits, so the share lookup is a query the owner's every
 * request would otherwise pay for.
 */
export async function roleWithoutLink(
  row: Pick<ArtifactRow, 'id' | 'user_id' | 'token_id'> & Partial<Pick<ArtifactRow,'format'>>,
  actor: RoleActor,
): Promise<ArtifactRole> {
  if (ownsArtifact(row, actor)) return 'owner';
  // A NAMED share can never reach a guest or a test user: neither has an email
  // for an invitation to be addressed to, and neither is the kind of identity
  // an account invites. They reach a stranger's document through the LINK or
  // not at all (lib/user-kinds).
  if (await isLinkOnlyActor(actor.userId)) return 'none';
  if (row.format === 'markup' && hasDocumentEditorAccess(actor)) return 'editor';
  return namedRoleFor(row, actor);
}

/**
 * THE ONE ACCESS DECISION — what this actor may do with this row, as a single
 * value on the lattice (lib/share-roles). Read-access is `canRead` of it, the
 * page chrome is `canEdit`/`canAnnotate` of it, and the reader/owner serving
 * split is a comparison against it.
 *
 * It is the MAX of the three independent ways a role can arrive:
 *   - ownership       — the account, or the bare token that created it;
 *   - a named share   — artifact_shares, by resolved user id or unresolved email;
 *   - the LINK        — what a stranger holding the address gets.
 */
export async function effectiveRole(
  row: Pick<ArtifactRow, 'id' | 'user_id' | 'token_id' | 'visibility' | 'link_role'> & Partial<Pick<ArtifactRow,'format'>>,
  actor: RoleActor,
): Promise<ArtifactRole> {
  const held = await roleWithoutLink(row, actor);
  if (held === 'owner') return 'owner';
  // THE ANONYMOUS CEILING applies to the LINK only, never to a named share:
  // being invited by address is itself an account-shaped act, while holding a
  // URL is not. Without an account there is nothing to attribute a write to.
  const byLink = actor.userId && await reachesAsAccount(row, actor) ? linkRoleOf(row) : capRole(linkRoleOf(row), ANONYMOUS_CEILING);
  return maxRole(byLink, held);
}

/**
 * Does the LINK grant this actor its full role, or only the anonymous ceiling?
 *
 * An ACCOUNT: yes. A guest: never — holding a URL is not an account-shaped act.
 * A TEST USER: only inside the sandbox, toward an artifact another test user
 * owns, which is what makes it a full user in there and a guest out here
 * (lib/user-kinds, the same rule the SQL scopes read).
 */
async function reachesAsAccount(row: Pick<ArtifactRow, 'user_id'>, actor: RoleActor): Promise<boolean> {
  const kind = await userKindOf(actor.userId);
  if (kind === null || kind === 'account') return true;
  if (kind !== 'testuser') return false;
  return await userKindOf(row.user_id) === 'testuser';
}

/**
 * What the LINK alone grants — everyone who holds the address and nothing else.
 *
 * TWO independent facts, and `visibility` gates the column above it: visibility
 * answers REACH (may the address get you in at all), `link_role` answers what
 * you may DO once it has. So a `private` document grants nothing no matter what
 * the column holds — which is what lets the setting be REMEMBERED across a trip
 * through `private` rather than silently reset.
 *
 * NULL reads as `viewer`.
 */
export function linkRoleOf(row: Pick<ArtifactRow, 'visibility' | 'link_role'>): ArtifactRole {
  if (row.visibility === 'private') return 'none';
  return row.link_role ?? 'viewer';
}

/**
 * What the SHARE LIST grants this actor. An anonymous token has no address and
 * no account, so it can never be named — it returns `none` without a query.
 *
 * The predicate is the union of the two the old pair used: a share matches by
 * its RESOLVED user id first, and by email only while still unresolved —
 * either the address this session carries, or the account's own, so an agent
 * arriving with a token (and therefore no session address) still reaches what
 * its person was invited to.
 */
async function namedRoleFor(
  row: Pick<ArtifactRow, 'id'>,
  actor: RoleActor,
): Promise<ArtifactRole> {
  if (!actor.userId) return 'none';
  const db = await getDb();
  await resolveSharesFor(db, row.id, actor.userId);
  const r = await db.query<{ role: ShareRole }>(
    `SELECT s.role FROM artifact_shares s
     WHERE s.artifact_id = $1 AND (
       s.user_id = $2
       OR (s.user_id IS NULL AND (s.email = $3 OR s.email = (SELECT email FROM users WHERE id = $2)))
     )`,
    [row.id, actor.userId, actor.email?.toLowerCase().trim() ?? ''],
  );
  return maxRole(...r.rows.map((x) => x.role as ArtifactRole));
}

// `link_role` is deliberately absent: SUMMARY_COLS does not select it, and a
// listing is an index rather than a bulk read. The general-access role is read
// through the sharing surface, where it is edited.
export type ArtifactSummary = Omit<ArtifactRow, 'content' | 'source' | 'token_id' | 'user_id' | 'actor_user_id' | 'actor_token_id' | 'link_role' | 'forked_from' | 'deleted_at'>;

/** The stored representation of one artifact state (built by parseContentInput). */
export interface ArtifactInput {
  title?: string | null;
  description?: string | null;
  format: ArtifactFormat;
  content: string;
  source: string | null;
  meta: Record<string, unknown>;
  /** Absent on replace = keep the current value. */
  visibility?: Visibility;
  /** Absent on replace = keep the current value. Datasets only (routes refuse it elsewhere). */
  access?: DatasetAccess;
  /**
   * PLACEMENT, already resolved. The WIRE speaks `parent_id` (an agent holds a
   * folder's id and nothing else); the array is what the parent's own row
   * answers, through lib/folders `resolveParent` — which reads a row, and so
   * runs only AFTER the ownership scope has resolved the row being written.
   * Absent on replace = leave it where it is.
   */
  ancestor_ids?: string[];
  link_role?: ShareRole;
}

const SUMMARY_COLS = 'id, title, description, format, meta, version, visibility, access, ancestor_ids, created_at, updated_at';

// ── Per-token quota ──────────────────────────────────────────────────────────

let quotaOverride: number | null = null;
/** Tests inject the cap here instead of mutating process.env (config is read once at import). */
export function setArtifactQuotaForTests(cap: number | null): void {
  quotaOverride = cap;
}

/**
 * True when the token is at its artifact cap (0 ⇒ unlimited). Creation-time
 * only — edits never block.
 *
 * `creating` is how many rows the caller is about to make, which is 1 for every
 * ordinary create and more for the ONE call that makes several at once: a fork
 * of an app creates the page PLUS a copy of each dataset it writes, and a cap
 * that only saw the page would let the quota be walked past a dataset at a time.
 */
export async function artifactQuotaExceeded(tokenId: string, creating = 1): Promise<boolean> {
  const cap = quotaOverride ?? ARTIFACT_QUOTA_PER_TOKEN;
  if (!cap) return false;
  const db = await getDb();
  /*
   * EVERY ROW, deleted or not — the one deliberate reader past the trash gate
   * outside lib/trash, and the only quota rule that survives having no purge.
   * Nothing is ever erased, so a deleted document still occupies its row, its
   * versions, its edit log and its bytes forever; counting live rows alone
   * would make delete-and-recreate an unlimited cap with an extra call in it.
   * The trade is stated in the docs rather than hidden: deleting does not free
   * you to publish another one.
   */
  const r = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM artifacts WHERE token_id = $1', [tokenId]);
  return (r.rows[0]?.n ?? 0) + creating > cap;
}

/** First owning report attachment freezes unresolved memberOf scopes atomically. */
async function bindCurrentUserScopes(tx:Queryable,document:ArtifactRow):Promise<void> {
 if(document.format!=='markup')return;
 const refs=(document.meta.refs as Array<{id:string}>|undefined)??[];
 for(const ref of [...refs].sort((a,b)=>a.id.localeCompare(b.id))) {
  const dataset=(await artifactQuery<ArtifactRow>(tx,"SELECT * FROM artifacts WHERE id=$1 AND format='dataset' AND deleted_at IS NULL FOR UPDATE",[ref.id])).rows[0];
  const catalog=dataset?catalogOf(dataset):null;
  if(!dataset||!catalog||!catalog.tables.some(t=>t.columns.some(c=>c.constraints?.memberOf?.includes('current'))))continue;
  if(document.user_id ? dataset.user_id!==document.user_id : dataset.token_id!==document.token_id)throw new DatasetError('Only the dataset owner can bind memberOf current to a report',403);
  const columns=(cs:DatasetColumn[])=>resolveUserColumnScope(cs,document.id);
  const bound={...catalog,tables:catalog.tables.map(t=>({...t,columns:columns(t.columns)}))};
  let source=dataset.source;
  if(source?.trimStart().startsWith('<Dataset')) {
   const definition=parseDatasetDefinition(source);
   source=serializeDatasetDefinition({...definition,tables:definition.tables.map(t=>({...t,columns:t.columns?.map(c=>typeof c==='string'?c:columns([c])[0]!)}))});
  }
  await archiveVersion(tx,dataset);
  const meta={...dataset.meta,userScopeDocument:document.id,catalog:bound,columns:columns((dataset.meta.columns??[]) as DatasetColumn[])};
  const updated=(await artifactQuery<ArtifactRow>(tx,'UPDATE artifacts SET meta=$2,source=$3,version=version+1,edit_id=$4,updated_at=now() WHERE id=$1 RETURNING *',[dataset.id,JSON.stringify(meta),source,newEditId()])).rows[0];
  await logWholeDocumentWrite(tx,dataset,updated);
 }
}

export async function createArtifact(
  tokenId: string,
  userId: string | null,
  input: ArtifactInput,
  /**
   * What only CREATION may set, deliberately NOT fields on ArtifactInput: that
   * shape is shared with the replace path, and neither of these is a thing a
   * content write may change.
   *   forkedFrom — provenance; written once and never updated.
   *   linkRole   — GENERAL ACCESS, the role the LINK grants. Every other
   *                creation leaves it NULL (which `linkRoleOf` reads as
   *                'viewer') and the sharing surface owns it afterwards; a
   *                FORK carries the source's, exactly as it carries visibility
   *                and access — the same axis, and carrying the tier while
   *                resetting the role would be incoherent.
   *   datasetPolicy— the stored write policy, copied WITH the dataset it
   *                governs (a fork of an app copies both). Every other route to
   *                a policy is lib/datasets/policy `setDatasetPolicy`, which
   *                needs the row to exist first; a copy has no "first".
   *   tx         — run inside the caller's OPEN transaction instead of opening
   *                one. The caller then owns the post-commit effects
   *                (`afterCreated`): reaching trackEvent/notifyParent from
   *                inside a transaction would enqueue a query behind the
   *                transaction that holds PGLite's one connection.
   */
  atCreation: { reservedId?:string; forkedFrom?: string; linkRole?: ShareRole | null; operation?: CreationOperation | null; shares?:ShareEntry[]; datasetPolicy?: { policy: unknown; revision: number }; tx?: Queryable } = {},
): Promise<ArtifactRow> {
  if (input.format === 'markup' && input.source) {
    input = { ...input, source: stampNodeIds(input.source, { retireLegacyAliases: true }).source };
  }
  input = { ...input, meta: finalizeArtifactMetadata(input.format, input.source, input.meta) };
  let sourceIds: string[] = [];
  if(input.format==='markup'&&input.source) {
    sourceIds=[...nodeIndex(input.source).keys()];
  }
  // INSIDE THE CALLER'S TRANSACTION: no retry (a PK violation has already
  // poisoned it — the ids are reserved beforehand instead) and no post-commit
  // effects, which are the caller's to run once its own transaction commits.
  if (atCreation.tx) return insertArtifact(atCreation.tx, atCreation.reservedId ?? generateFileId(), tokenId, userId, input, sourceIds, atCreation);
  const db = await getDb();
  // Birthday collisions at 62^6 are routine once the table is large, so the
  // PK-violation retry is a working path, not a theoretical one.
  const ID_MINT_ATTEMPTS = 5;
  for (let attempt = 0; ; attempt++) {
    const id = atCreation.reservedId ?? generateFileId();
    try {
      const row = await db.transaction((tx) => insertArtifact(tx, id, tokenId, userId, input, sourceIds, atCreation));
      await afterCreated(row, userId);
      return row;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (!atCreation.reservedId && code === '23505' && attempt < ID_MINT_ATTEMPTS) continue;
      throw error;
    }
  }
}

/** What a creation says to the rest of the system, AFTER its transaction committed. */
async function afterCreated(row: ArtifactRow, userId: string | null): Promise<void> {
  void trackEvent('create', row.id, { userId, parentId: parentOf(row) });
  // A child arriving wakes the folder it landed in, so an open listing
  // re-runs its own query with no reload.
  await notifyParent(parentOf(row));
}

/** The creation itself: every row one artifact is born with, and nothing outside the transaction. */
async function insertArtifact(
  tx: Queryable,
  id: string,
  tokenId: string,
  userId: string | null,
  input: ArtifactInput,
  sourceIds: string[],
  atCreation: Parameters<typeof createArtifact>[3] = {},
): Promise<ArtifactRow> {
  if (atCreation.operation) await reserveCreation(tx,atCreation.operation);
  await claimArtifactId(tx,id,{tokenId,userId},!!atCreation.reservedId);
  // A FORK carries its source's rows verbatim — a snapshot the forker may read,
  // not rows the forker wrote — so a user column's "must be the logged-in user"
  // rule is not re-judged under the forker's id: that would make every app
  // whose rows name its members unforkable by anyone but the one person named.
  if (!atCreation.forkedFrom) await validateUserContent(tx,input,userId,key=>loadDatasetRows({content:"",meta:{objectKey:key}}));
  const catalog=catalogOf(input);
  if(catalog?.kind==='postgres'&&catalog.connection)await claimPendingDatasetSecret(catalog.connection,{tokenId,userId},id,tx);
  const ownerKind = await userKindOf(userId, tx);
  const guestDefault = input.visibility === undefined && ownerKind === 'guest';
  /*
   * THE SANDBOX CEILING. A test user's work never lists anywhere and is never
   * `public`: it exists to be looked at by the account that minted it and by
   * the other throwaway people in there, and it is ERASED with its owner. A
   * `public` ask is stored as `unlisted` rather than refused — the copy is
   * still reachable by link, which is what the asker wanted it for — and the
   * create reply carries the visibility it really got.
   */
  const visibility = ownerKind === 'testuser'
    ? (input.visibility === 'public' || input.visibility === undefined ? 'unlisted' : input.visibility)
    : input.visibility ??
      (!userId || guestDefault ? (ALLOW_PUBLIC_VISIBILITY ? 'public' : 'unlisted')
        : input.format === 'image' || input.format === 'dataset' || input.format === 'pdf' || input.format === 'file' ? 'unlisted' : 'private');
  const datasetPolicy = atCreation.datasetPolicy?.policy ??
    (!atCreation.forkedFrom && input.access===undefined && input.format==='dataset' && catalog?.kind!=='postgres' ? defaultDatasetGrants() : null);
  const created = await artifactQuery<ArtifactRow>(tx,
  // The genesis edit row makes the creation's edit_id resolvable like any
  // other: an agent that creates and then edits against that id is on an
  // ordinary (if empty) base, not an unknown one. Data-modifying CTEs
  // always execute, so the log row lands even though nothing reads it.
  `WITH created AS (
     INSERT INTO artifacts (id, token_id, user_id, title, description, format, content, source, meta, visibility, link_role, ancestor_ids, edit_id, access, forked_from, actor_user_id, actor_token_id, dataset_policy, policy_revision, document)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $19::jsonb IS NULL THEN $8::text ELSE NULL END, $9, $10, $11, $12, $13, $14, $15, $3, $2, $17::jsonb, $18::int, $19::jsonb) RETURNING *
   ), genesis AS (
     INSERT INTO artifact_edits (artifact_id, edit_id, splice_start, removed, inserted, span_start, span_end, actor_user_id, actor_token_id)
     SELECT id, edit_id, 0, '', COALESCE($8::text, content), 0, 0, $3, $2 FROM created
   ), reserved AS (
     INSERT INTO artifact_source_ids (artifact_id, source_id, provenance, first_version)
     SELECT $1, value #>> '{}', 'authored', 1 FROM jsonb_array_elements($16::jsonb)
   ), policy_audit AS (
     INSERT INTO dataset_policy_audit (dataset_id, revision, policy, actor_user_id, actor_token_id)
     SELECT $1, $18::int, $17::jsonb, $3, $2 WHERE $17::jsonb IS NOT NULL
   )
   SELECT * FROM created`,
  [
    id,
    tokenId,
    userId,
    input.title ?? null,
    input.description ?? null,
    input.format,
    input.content,
    input.source,
    JSON.stringify(input.meta),
    // Guest identities retain anonymous public defaults. Registered
    // accounts create private documents, except assets, born
    // unlisted: a public document reaches them at read time, and a
    // born-private ref bakes a 404 into every shared document that uses
    // it. Routes validate an explicit ask upstream. Decided above, because a
    // test user's ceiling is part of the same one decision.
    visibility,
    // NULL reads as 'viewer' (linkRoleOf), which is what every ordinary
    // creation grants whoever holds the link.
    atCreation.linkRole ?? null,
    input.ancestor_ids ?? [],
    newEditId(),
    // Read-only unless the caller asked otherwise: a dataset that could
    // be written by default would make every existing document's data
    // mutable without anyone choosing it.
    input.access ?? 'read',
    atCreation.forkedFrom ?? null,
    JSON.stringify(sourceIds),
    // A DATASET carried whole, policy included. NULL for every other
    // creation, which is also what makes the audit CTE above a no-op.
    datasetPolicy ? JSON.stringify(datasetPolicy) : null,
    atCreation.datasetPolicy?.revision ?? 0,
    sourceStorage(input.format,input.source).document,
  ],
  );
  Object.assign(created.rows[0],await writeShares(tx,id,atCreation.shares??[]));
  await bindCurrentUserScopes(tx,created.rows[0]);
  if(input.format==='markup'&&userId)await seedOwnerJoin(tx,id,userId);
  if(!atCreation.forkedFrom)await documentMentions(tx,created.rows[0],{userId,tokenId});
  if (atCreation.operation) await completeCreation(tx,atCreation.operation,created.rows[0]);
  return created.rows[0];
}

/**
 * What a forker may change about the copy AS IT IS MADE — the three fields an
 * owner reaches for first. Every value here is already validated by the
 * caller through the shared parsers (lib/artifact-wire
 * `parseVisibilityValue`/`parseFolderField`), so this door does not
 * re-decide, for instance, whether an anonymous token may go private.
 */
export interface ForkOverrides {
  title?: string;
  visibility?: Visibility;
  /** Where the COPY lands, already resolved (lib/folders resolveParent). Absent = the forker's root. */
  ancestor_ids?: string[];
}

/**
 * FORK — the same artifact under a NEW OWNER and a new id, and nothing else.
 *
 * Which parts of a document travel and which belong to the original's life is stated once, in
 * [serving and security](../../../docs/serving-and-security.md). Two things the doc cannot say:
 * object-store bytes are REFERENCED rather than re-uploaded (every key is content-addressed, so a
 * fork of a 27 MB sheet costs no bytes), and a Postgres catalog copies only when the forker owns
 * its live connection.
 *
 * A markup document is RE-PUBLISHED as the forker rather than row-copied, and that is the whole
 * point of the function: refs resolve through `refLoaderForActor(actor)`, so a document whose
 * <Mutation> writes the original owner's dataset, or which reads their private image, is refused
 * BY NAME at this door instead of publishing and failing every write at run time. The refusal
 * Response passes through verbatim.
 *
 * `overrides` are applied to the copy's stored state rather than written afterwards: a post-hoc
 * title would be a second write, rotating the `edit_id` the create reply just handed back.
 *
 * FORKING AN APP. A page that WRITES a dataset may only be published by someone who owns that
 * dataset (lib/story/refs `validateRefs`), so a fork that kept the original's `ref:` was refused
 * for everyone but its owner — an app could not be forked at all. So the fork COPIES each dataset
 * the page writes and cannot write as the forker, under the forker's account, and repoints every
 * `ref:` to the copy (`writtenDatasetForkPlan`). Datasets the page only READS keep their id: a read
 * is already permitted, and copying a live source would freeze it at the moment of the fork.
 */
export async function forkArtifact(
  actor: TokenActor,
  source: ArtifactRow,
  overrides: ForkOverrides = {},
  /**
   * WHO THE COPY BELONGS TO, when that is not the forker: an account forking
   * one of its readable artifacts `as` one of its TEST USERS (lib/testusers).
   *
   * Only ownership moves. The source is still read, the refs are still
   * re-validated and the artifact COUNT quota is still charged AS THE ACCOUNT
   * — a test user has no reach of its own to fork through and no quota of its
   * own to spend, and this door is the single way anything real gets into its
   * sandbox.
   */
  owner: TokenActor = actor,
): Promise<ForkResult | Response> {
  /*
   * WHO CREATES vs WHO OWNS. The copy is created BY the forker's token and FOR
   * the owner's account, which is how the artifact COUNT quota lands on the
   * parent: the cap is per TOKEN, a test user has no quota of its own, and rows
   * carrying the test user's token would have been free. Ownership is `user_id`
   * (ownsArtifact reads it first), so the test user owns the copy outright —
   * and erasing it takes the rows, and the parent's count, away again.
   */
  const creator: TokenActor = { tokenId: actor.tokenId, userId: owner.userId };
  /*
   * A FOLDER IS NOT FORKABLE, and the refusal lives HERE so both doors — the
   * one a person clicks and the `fork_artifact` operation — inherit it from the
   * same place. A folder's source names its OWN children table by id, so a copy
   * would faithfully list the original's children; and re-pointing it at the
   * copy would silently rewrite a document the forker never wrote.
   */
  const unforkable = forkRefusal(source);
  if (unforkable) return unforkable;
  const copying = await writtenDatasetForkPlan(actor, source, owner);
  // The page PLUS its dataset copies: one cap, counted against what this call
  // will really create rather than against the page alone.
  if (await artifactQuotaExceeded(actor.tokenId, copying.length + 1)) return json({ error: 'quota_exceeded', details: ['this token has hit its artifact COUNT quota — deleting does not free it (nothing is erased), so ask your user for another token'] }, 403);
  if (copying.length) return deepFork(actor, source, overrides, copying, creator);
  const input = await forkInput(actor, source, overrides);
  if (input instanceof Response) return input;
  const row = await createArtifact(creator.tokenId, creator.userId, input, { forkedFrom: source.id, linkRole: source.link_role, ...(source.format==='dataset'?{datasetPolicy:{policy:source.dataset_policy??null,revision:source.policy_revision??0}}:{}) });
  // Against the SOURCE: "this was forked" is a fact about the original, and the
  // forker is who did it. Never inside a transaction (PGLite deadlock).
  void trackEvent('fork', source.id, { userId: actor.userId, forkId: row.id });
  return { artifact: row, datasets: [] };
}

/**
 * WHAT CANNOT BE FORKED AT ALL, decided before anything is copied — and before
 * a DRY RUN answers, so "what would this copy?" and "copy it" refuse the same
 * things in the same words.
 *
 * A FOLDER's source names its OWN children table by id, so a copy would
 * faithfully list the original's children and re-pointing it would silently
 * rewrite a document the forker never wrote. A live POSTGRES catalog keeps its
 * credentials bound to the original, so the copy could not answer one query.
 */
export function forkRefusal(source: ArtifactRow): Response | null {
  if (source.format === 'folder') {
    return json({ error: 'not_forkable', hint: "a folder cannot be forked — create one with format: 'folder' and file documents under it with parent_id" }, 400);
  }
  return source.format === 'markup' ? null : postgresForkRefusal(source);
}

/** What one fork made: the copy, and a copied dataset per `ref:` it had to repoint. */
export interface ForkResult {
  artifact: ArtifactRow;
  /** Empty for everything but an app — `forked_from` is the ORIGINAL dataset this copy was taken from. */
  datasets: Array<{ id: string; forked_from: string }>;
}

/**
 * The datasets a fork by `actor` would COPY: every distinct dataset this page
 * declares a `<Mutation>` over that the forker could not write as it stands.
 *
 * In source order, which is the order the dry run reports and the order the
 * copies are created in. Four things are deliberately NOT planned, because each
 * one is an existing refusal that must keep its own words rather than become a
 * silent copy:
 *   - a dataset the forker already reaches through their own scope — the write
 *     is admitted exactly as it is, and re-copying it would fork their own data;
 *   - a `ref:` that does not resolve for them, or is not a dataset at all (a
 *     FOLDER's children are computed; there is nothing to copy);
 *   - a POSTGRES-backed dataset, whose credentials stay bound to the original
 *     (`postgresForkRefusal`), so the copy could not answer a single query.
 * Each falls through to `validateRefs`, which names it at the publish door.
 */
async function writtenDatasetForkPlan(actor: TokenActor, source: ArtifactRow, owner: TokenActor = actor): Promise<ArtifactRow[]> {
  if (source.format !== 'markup' || !source.source) return [];
  const uses = collectRefUses(sourceWithoutAnchors(source.source));
  if (!uses) return [];
  const plan: ArtifactRow[] = [];
  const seen = new Set<string>();
  const written=new Set(uses.filter(use=>use.write).map(use=>use.id));
  for (const use of [...uses.filter(u=>u.write),...uses.filter(u=>!u.write)]) {
    if(seen.has(use.id))continue;
    seen.add(use.id);
    const candidate=await getArtifactById(use.id);
    if(!candidate||candidate.format!=='dataset'||catalogOf(candidate)?.kind==='postgres')continue;
    const policy=grantsOf(candidate);
    if(policy){
      if(!written.has(use.id)&&await grantsPermitRead(candidate,{userId:null,tokenId:null}))continue;
      if(!(await grantsPermitRead(candidate,actor,source)))continue;
      plan.push(candidate);continue;
    }
    if(!written.has(use.id))continue;
    const own = owner.userId ? await getArtifactFor({ userId: owner.userId, tokenId: '' }, use.id) : await getArtifact(owner.tokenId, use.id);
    if (own) continue;
    const row = (owner.userId !== actor.userId ? await getArtifactFor(actor, use.id) : null) ?? await getLinkReadableArtifact(use.id);
    if (!row || row.format !== 'dataset' || catalogOf(row)?.kind === 'postgres') continue;
    plan.push(row);
  }
  return plan;
}

/** What a fork of this page would copy, for the DRY RUN — the plan, as titles. */
export async function forkDatasetPreview(actor: TokenActor, source: ArtifactRow, owner: TokenActor = actor): Promise<Array<{ id: string; title: string | null }>> {
  if (source.format === 'folder') return [];
  return (await writtenDatasetForkPlan(actor, source, owner)).map((row) => ({ id: row.id, title: row.title }));
}

/**
 * The app fork: the dataset copies and the page, in ONE transaction.
 *
 * Everything that can REFUSE happens before it opens — the ids are reserved,
 * the source is repointed and the whole document is re-validated against a
 * loader that answers for the copies as though they already existed. So the
 * transaction is inserts only, and a failure halfway leaves no orphan dataset
 * sitting in the forker's account under a page that was never created.
 */
async function deepFork(actor: TokenActor, source: ArtifactRow, overrides: ForkOverrides, copying: ArtifactRow[], owner: TokenActor = actor): Promise<ForkResult | Response> {
  // Reserved for whoever will OWN the copies: `claimArtifactId` consumes a
  // reservation only for the actor creating the row, so reserving as the forker
  // and inserting as its test user would refuse its own fork.
  const ids = await reserveArtifactIds(owner, copying.length+1);
  const documentId=ids[copying.length]!;
  const policyRewrite={[source.id]:documentId};
  const copies = copying.map((row, index) => ({ row, id: ids[index]! }));
  const rewrite = new Map(copies.map((copy) => [copy.row.id, copy.id]));
  const planned = new Map(copies.map((copy) => [copy.id, copy.row]));
  const loader = refLoaderForActor(actor);
  const input = await forkInput(actor, source, overrides, {
    source: repointRefs(sourceWithoutAnchors(source.source ?? ''), rewrite),
    // A planned copy resolves as the forker's OWN dataset, with the original's
    // columns, access and policy — which is what it will be a moment from now.
    loadRef: async (id) => {
      const original = planned.get(id);
      return original ? { ...rowToResolvedRef(original, true), id } : loader(id);
    },
  });
  if (input instanceof Response) return input;
  const visibility = input.visibility ?? source.visibility;
  let created: { artifact: ArtifactRow; datasets: ArtifactRow[] };
  try {
    created = await (await getDb()).transaction(async (tx) => {
    await tx.query('SELECT id FROM artifacts WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[[source.id,...copies.map(c=>c.row.id)]]);
    const currentSource=(await artifactQuery<ArtifactRow>(tx,'SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL',[source.id])).rows[0];
    if(!currentSource||currentSource.edit_id!==source.edit_id)throw new DatasetError('The source changed; retry the fork',409);
    for(const copy of copies){
      if(!grantsOf(copy.row))continue;
      const current=(await artifactQuery<ArtifactRow>(tx,'SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL',[copy.row.id])).rows[0];
      if(!current||current.edit_id!==copy.row.edit_id||current.policy_revision!==copy.row.policy_revision||!await grantsPermitRead(current,actor,currentSource,tx))throw new DatasetError('A dataset changed or is no longer readable; retry the fork',409);
    }
    const datasets: ArtifactRow[] = [];
    for (const copy of copies) {
      datasets.push(await createArtifact(owner.tokenId, owner.userId, {
        title: copy.row.title,
        description: copy.row.description,
        format: 'dataset',
        // The same content and the same object key: dataset bytes are
        // content-addressed, so a copy of a million rows re-uploads nothing.
        content: copy.row.content,
        source: copy.row.source,
        meta: copy.row.meta,
        // The copy is as reachable as the page that writes it — no more.
        visibility: copy.row.visibility==='private'?'private':visibility,
        access: copy.row.access,
      }, {
        tx,
        reservedId: copy.id,
        forkedFrom: copy.row.id,
        linkRole: copy.row.link_role,
        // The write policy travels WITH the dataset: a copy whose policy had to
        // be set afterwards would be, for that moment, a writable dataset with
        // no rules, and the fork would need a second call to be usable at all.
        ...(copy.row.dataset_policy ? { datasetPolicy: { policy: grantsOf(copy.row)?remapDatasetGrants(grantsOf(copy.row)!,policyRewrite):copy.row.dataset_policy, revision: copy.row.policy_revision ?? 0 } } : {}),
      }));
    }
    return { artifact: await createArtifact(owner.tokenId, owner.userId, input, { tx, reservedId:documentId, forkedFrom: source.id, linkRole: source.link_role }), datasets };
    });
  } catch (error) {
    // A dataset rule refusing a copy is the forker's answer, never a 500.
    if (error instanceof DatasetError) return json({ error: 'dataset_error', details: [error.message] }, error.status);
    throw error;
  }
  // After the commit, never inside it (PGLite deadlock).
  for (const row of [...created.datasets, created.artifact]) await afterCreated(row, owner.userId);
  void trackEvent('fork', source.id, { userId: actor.userId, forkId: created.artifact.id });
  return { artifact: created.artifact, datasets: created.datasets.map((row) => ({ id: row.id, forked_from: row.forked_from! })) };
}

/**
 * EVERY `ref:<id>` occurrence of a copied dataset, repointed at its copy — one
 * pass, so a `<Query>` reading the same dataset the `<Mutation>` writes, a
 * `<Value source>` and any position added later all move together. A page that
 * kept one old id would read the original's rows and write its own copy.
 */
function repointRefs(source: string, rewrite: Map<string, string>): string {
  return source.replace(/ref:([A-Za-z0-9]{6,12})/g, (whole, id: string) => (rewrite.has(id) ? `ref:${rewrite.get(id)}` : whole));
}

/** The copy's stored state, as the forker would have published it. */
async function forkInput(
  actor: TokenActor,
  source: ArtifactRow,
  overrides: ForkOverrides,
  /** An APP fork: the repointed source and the loader that answers for its planned dataset copies. */
  deep?: { source: string; loadRef: RefLoader },
): Promise<ArtifactInput | Response> {
  // Everything the copy keeps that is not the content itself, with the
  // forker's overrides winning. `link_role` is carried too, but through
  // createArtifact's creation-only argument rather than here: it is not part
  // of ArtifactInput, which the replace path shares. With no placement
  // override, the copy lands at the forker's ROOT — the only place they could
  // have filed it without naming a folder of their own.
  const carried = {
    title: overrides.title ?? source.title,
    description: source.description,
    visibility: overrides.visibility ?? source.visibility,
    access: source.access,
    ...(overrides.ancestor_ids !== undefined ? { ancestor_ids: overrides.ancestor_ids } : {}),
  };
  if (source.format !== 'markup') {
    const refusal=postgresForkRefusal(source);
    if(refusal)return refusal;
    return { ...carried, format: source.format, content: source.content, source: source.source, meta: source.meta };
  }
  const meta = source.meta as { theme?: string; template?: string; colorMode?: 'light' | 'dark' | null };
  // Publish the LIVE vocabulary, exactly as the wire echo does: a stored
  // retired theme would otherwise make an old document unforkable for a reason
  // nobody could act on.
  const design = resolveStoredStoryDesign(meta.theme, meta.colorMode ?? null);
  const parsed = await parseContentInput({
    markup: deep?.source ?? sourceWithoutAnchors(source.source ?? ''),
    theme: design.theme,
    template: meta.template ?? null,
    colorMode: design.colorMode,
  }, {
    loadRef: deep?.loadRef ?? refLoaderForActor(actor),
    importAsset: assetImporterFor(actor.tokenId, actor.userId),
    resolveFont: fontResolver(),
    overByteQuota: byteQuotaFor(actor.tokenId),
  });
  if (parsed instanceof Response) return parsed;
  const { derivedTitle: _derived, ...stored } = parsed;
  return { ...carried, ...stored };
}

/** A live remote catalog cannot copy its dataset-bound secret to a new id. */
function postgresForkRefusal(source:ArtifactRow):Response|null {
  if(source.format!=='dataset')return null;
  const catalog=catalogOf(source);
  if(catalog?.kind!=='postgres')return null;
  return json({error:'not_forkable',hint:'Postgres credentials remain bound to the original dataset'},403);
}

async function getArtifact(tokenId: string, id: string): Promise<ArtifactRow | null> {
  const db = await getDb();
  return loadArtifactDocument<ArtifactRow>(db,`SELECT * FROM artifacts WHERE id = $1 AND token_id = $2 AND ${LIVE_ARTIFACT_SQL}`, [id, tokenId]);
}

async function getArtifactByUser(userId: string, id: string): Promise<ArtifactRow | null> {
  const db = await getDb();
  return loadArtifactDocument<ArtifactRow>(db,`SELECT * FROM artifacts WHERE id = $1 AND user_id = $2 AND ${LIVE_ARTIFACT_SQL}`, [id, userId]);
}

async function listArtifactsScoped(scope: Scope): Promise<ArtifactSummary[]> {
  const db = await getDb();
  const r = await db.query<ArtifactSummary>(
    `SELECT ${SUMMARY_COLS} FROM artifacts WHERE ${scope.where('$1')} ORDER BY updated_at DESC LIMIT 100`,
    [scope.val],
  );
  return r.rows;
}

/**
 * Unscoped read for the public serving paths (/a/<id> and its sub-routes).
 * The id is an ADDRESS, not a credential — whether this viewer may see the
 * row is the caller's decision (the visibility ACL), made before serving.
 *
 * Request-memoized (React cache), so a page that resolves the same row twice in
 * one render pays the lookup once. Outside a React render (route handlers,
 * tests) cache() is a pass-through, so it can never serve a stale row.
 */
export const getArtifactById = cache(async (id: string): Promise<ArtifactRow | null> => {
  const db = await getDb();
  return loadArtifactDocument<ArtifactRow>(db,`SELECT * FROM artifacts WHERE id = $1 AND ${LIVE_ARTIFACT_SQL}`, [id]);
});

interface VersionSummary {
  version: number;
  title: string | null;
  description: string | null;
  format: string;
  /** The handle of the account that produced this state; null for a token or an unnamed account. */
  by: string | null;
  created_at: string;
}

/** Archive the head as it stands — its author rides along, so history can say who. */
async function archiveVersion(tx: Queryable, current: ArtifactRow): Promise<void> {
  await tx.query(
    `INSERT INTO artifact_versions (artifact_id, version, title, description, format, content, source, meta, actor_user_id, actor_token_id, document)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $11::jsonb IS NULL THEN $7::text ELSE NULL END, $8, $9, $10, $11::jsonb)`,
    [current.id, current.version, current.title, current.description, current.format, current.content, current.source, JSON.stringify(current.meta), current.actor_user_id, current.actor_token_id,sourceStorage(current.format,current.source).document],
  );
}

/** The two actor columns a write stamps, in the order every statement binds them. */
const actorStamp = (actor: TokenActor): [string | null, string | null] => [actor.userId, actor.tokenId || null];

/**
 * WHO a statement over `artifacts` runs as: a predicate on the row, bound to
 * ONE parameter (`where('$2')` names the placeholder the caller puts `val`
 * in). Two constructors, and every scoped statement names which it holds:
 *
 *  - ownerScope  — the owner: user_id for an account, token_id for a bare
 *                  token. Delete, sharing, folder, dataset access, listing.
 *  - editorScope — the owner OR an account named `editor` in artifact_shares,
 *                  matched through users.email so a collaborator's CLAIMED
 *                  tokens edit too. Reach, edits, PUT, revert, versions.
 *
 * The predicate runs INSIDE the same WHERE as the id, so a miss is the uniform
 * 404 either way — there is no existence oracle in the difference. Both carry
 * the trash gate below, which is why a deleted row is that same 404 without a
 * single one of these statements mentioning it.
 */
export type Scope = { where: (param: string) => string; val: string };

/**
 * THE TRASH GATE — `deleted_at IS NULL`, and the ONE place the predicate is
 * written down. A delete does not remove the row (lib/trash), so every read
 * has to say so; saying it thirty times is thirty chances to forget once, and
 * the one that forgets serves a document its owner deleted.
 *
 * So it is composed IN HERE, into the Scope constructors below and into the
 * unscoped row reads, and callers never add it: `getArtifactFor`,
 * `applyEditFor`, the listing, the versions, the sharing surface and every
 * serving path inherit it by asking the seam they already ask. The readers
 * that do NOT come through the seam — the account listings (lib/users), the
 * hierarchy (lib/folders), the quotas (lib/asset-quota) — import this name, so
 * `git grep LIVE_ARTIFACT_SQL` is the whole audit.
 *
 * lib/trash is the ONE module that reads past it, through `ownerPredicate`
 * below: the trash listing and restore are the readers of trashed rows, and
 * they are the reason the rows are still there.
 */
export const LIVE_ARTIFACT_SQL = 'deleted_at IS NULL';

/** The same predicate with the trash gate composed in — every Scope carries it. */
const live = (scope: Scope): Scope => ({ where: (p) => `${LIVE_ARTIFACT_SQL} AND (${scope.where(p)})`, val: scope.val });

/**
 * An account holding one of `roles` on the row the enclosing statement is on.
 * A share is matched by its RESOLVED user id first, and by email only while
 * it is still unresolved (user_id NULL) — so a share follows the account
 * through an email change, and an old invite to an address the person no
 * longer has stops matching (share-resolution.test.ts).
 */
const SHARE_PREDICATE = (roles: readonly string[], param: string) =>
  `EXISTS (SELECT 1 FROM artifact_shares s
           WHERE s.artifact_id = artifacts.id AND s.role IN (${roles.map((r) => `'${r}'`).join(', ')})
             AND (s.user_id = ${param} OR (s.user_id IS NULL AND s.email = (SELECT email FROM users WHERE id = ${param}))))`;

/**
 * Stamp `user_id` on every still-unresolved share that matches this user's
 * current email — the moment of RESOLUTION. Idempotent; a no-op once stamped.
 */
async function resolveSharesFor(db: Queryable, artifactId: string, userId: string): Promise<void> {
  await db.query(
    `UPDATE artifact_shares SET user_id = $2 WHERE artifact_id = $1 AND user_id IS NULL AND email = (SELECT email FROM users WHERE id = $2)`,
    [artifactId, userId],
  );
}

/**
 * WHO owns the row, WITHOUT the trash gate — for lib/trash alone, which reads
 * trashed rows on purpose (the listing, restore). Every other
 * caller wants `ownerScope`, which is this with the gate composed in.
 */
export const ownerPredicate = ({ tokenId, userId }: TokenActor): Scope =>
  userId ? { where: (p) => `user_id = ${p}`, val: userId } : { where: (p) => `token_id = ${p}`, val: tokenId };

const ownerScope = (actor: TokenActor): Scope => live(ownerPredicate(actor));

/**
 * The LINK half of the lattice, in SQL. Only ever composed into a scope that
 * has already narrowed to an actor with an ACCOUNT (scopeAtLeast below), which
 * is where the anonymous ceiling is enforced for statements — the mirror of
 * what effectiveRole does for reads.
 *
 * COALESCE reads a NULL `link_role` as `viewer`.
 */
const LINK_PREDICATE = (min: ArtifactRole) =>
  `(artifacts.visibility <> 'private' AND COALESCE(artifacts.link_role, 'viewer') IN (${shareRolesAtLeast(min).map((r) => `'${r}'`).join(', ')}))`;

/**
 * The SQL MIRROR of the lattice: the owner, an account holding any share role
 * that reaches `min`, or the LINK. One generator rather than a hand-written
 * predicate per door, so "which roles may edit" is answered in the same place
 * for the statement and for the page (lib/share-roles shareRolesAtLeast).
 *
 * An anonymous token has no account to be named through, so it narrows to
 * bare ownership.
 */
const scopeAtLeast = (actor: TokenActor, min: ArtifactRole): Scope =>
  actor.userId
    ? live({ where: (p) => `(user_id = ${p} OR (${ACCOUNT_REACH_SQL(p)} AND (${SHARE_PREDICATE(shareRolesAtLeast(min), p)} OR ${LINK_PREDICATE(min)}${hasDocumentEditorAccess(actor) ? " OR artifacts.format = 'markup'" : ''})))`, val: actor.userId })
    : ownerScope(actor);

export const editorScope = (actor: TokenActor): Scope => scopeAtLeast(actor, 'editor');

/**
 * The scope the annotation sidecar reaches a document through: the owner, an
 * editor, or a COMMENTER (lib/annotations).
 *
 * A document two people may WRITE should not be a document only one may
 * DISCUSS, and a commenter is someone invited to discuss it and nothing else.
 * Deleting a thread reaches the document through this same scope and is then
 * narrowed again (deleteAnnotationFor): the owner may remove any thread, a
 * named editor only one they wrote.
 */
export const annotationScope = (actor: TokenActor): Scope => scopeAtLeast(actor, 'commenter');

const SHARES_PROJECTION="COALESCE((SELECT jsonb_agg(jsonb_build_object('email',s.email,'role',s.role) ORDER BY s.email) FROM artifact_shares s WHERE s.artifact_id=artifacts.id),'[]'::jsonb) AS shares";
async function writeShares(tx:Queryable,id:string,shares:ShareEntry[]):Promise<{shares:ShareEntry[];sharing_revision:number}>{
 const normalized=[...new Map(shares.map(entry=>[entry.email.trim().toLowerCase(),entry.role])).entries()].sort(([a],[b])=>a.localeCompare(b)).map(([email,role])=>({email,role}));
 const current=(await tx.query<ShareEntry>('SELECT email,role FROM artifact_shares WHERE artifact_id=$1 ORDER BY email',[id])).rows;
 if(JSON.stringify(current)!==JSON.stringify(normalized)){
  // Retained invitations keep their resolved account identity, even after an
  // email change. Recreating them would transfer access to a reused address.
  await tx.query('DELETE FROM artifact_shares WHERE artifact_id=$1 AND NOT (email=ANY($2::text[]))',[id,normalized.map(entry=>entry.email)]);
  for(const entry of normalized)await tx.query('INSERT INTO artifact_shares (artifact_id,email,role) VALUES ($1,$2,$3) ON CONFLICT (artifact_id,email) DO UPDATE SET role=EXCLUDED.role',[id,entry.email,entry.role]);
  await tx.query('UPDATE artifacts SET sharing_revision=sharing_revision+1 WHERE id=$1',[id]);
 }
 const row=(await tx.query<{sharing_revision:number}>('SELECT sharing_revision FROM artifacts WHERE id=$1',[id])).rows[0];
 return {shares:normalized,sharing_revision:row.sharing_revision};
}
async function getArtifactScoped(scope: Scope, id: string): Promise<ArtifactRow | null> {
  const db = await getDb();
  return loadArtifactDocument<ArtifactRow>(db,`SELECT artifacts.*, ${SHARES_PROJECTION} FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val]);
}

/**
 * Whole-document writes (PUT, revert) join the edit protocol rather than
 * sitting outside it: they mint a fresh `edit_id`, log one splice covering the
 * entire old document for restoration/migration. Ordinary markup replacement
 * records its actual node-scoped changes so unrelated stale edits can rebase.
 * Both paths wake live readers.
 * Callers must already hold the row inside `tx`.
 */
async function logWholeDocumentWrite(tx: Queryable, before: ArtifactRow, after: ArtifactRow, nodeScoped=false): Promise<void> {
  const oldText = before.source ?? before.content;
  const newText = after.source ?? after.content;
  const changes=nodeScoped&&before.format==='markup'&&after.format==='markup'?sourceChanges(oldText,newText):null;
  if(changes&&!changes.length)changes.push({splice:{start:0,removed:'',inserted:''},span:{start:0,end:0}});
  await tx.query(
    `INSERT INTO artifact_edits (artifact_id, edit_id, splice_start, removed, inserted, span_start, span_end, actor_user_id, actor_token_id, changes)
     VALUES ($1, $2, 0, $3, $4, 0, $5, $6, $7, $8::jsonb)`,
    [after.id, after.edit_id, oldText, newText, oldText.length, after.actor_user_id, after.actor_token_id, changes?JSON.stringify(changes):null],
  );
  // Lowercased to match channelFor (lib/story/live.ts) — see the note there.
  await tx.query('SELECT pg_notify($1, $2)', [`artifact_${after.id.toLowerCase()}`, after.edit_id]);
}

/**
 * Commit an already-published markup source while the caller holds the
 * artifact row lock. Migration and ordinary whole-document paths share this
 * single reservation/history boundary; events are emitted by the caller only
 * after its surrounding transaction commits.
 */
export async function commitNormalizedMarkup(
  tx: Queryable,
  actor: TokenActor | null,
  current: ArtifactRow,
  normalized: { source: string; content: string; meta: Record<string, unknown>; ids: readonly string[]; aliases?: readonly { legacyKey: string; nodeId: string; path: string }[]; title?: string | null; description?: string | null; format?: ArtifactFormat },
): Promise<ArtifactRow> {
  normalized = { ...normalized, meta: finalizeArtifactMetadata(normalized.format ?? current.format, normalized.source, normalized.meta) };
  await archiveVersion(tx, current);
  const editId = newEditId();
  const result = await artifactQuery<ArtifactRow>(tx,
    `UPDATE artifacts SET source=CASE WHEN $12::jsonb IS NULL THEN $2::text ELSE NULL END, document=$12::jsonb, content=$3, meta=$4::jsonb, title=$9, description=$10, format=$11, version=version+1, edit_id=$5,
       actor_user_id=$6, actor_token_id=$7, updated_at=now() WHERE id=$1 AND edit_id=$8 RETURNING *`,
    [current.id, normalized.source, normalized.content, JSON.stringify(normalized.meta), editId, ...(actor ? actorStamp(actor) : [null, null]), current.edit_id, normalized.title === undefined ? current.title : normalized.title, normalized.description === undefined ? current.description : normalized.description, normalized.format ?? current.format,sourceStorage(normalized.format ?? current.format,normalized.source).document],
  );
  const updated = result.rows[0];
  if (!updated) throw new Error('artifact changed after identity preparation');
  await tx.query(
    `INSERT INTO artifact_source_ids (artifact_id, source_id, provenance, first_version)
     SELECT $1, value #>> '{}', 'migration', $2 FROM jsonb_array_elements($3::jsonb)
     ON CONFLICT DO NOTHING`,
    [current.id, updated.version, JSON.stringify(normalized.ids)],
  );
  await tx.query('UPDATE artifact_source_ids SET retired_version=NULL WHERE artifact_id=$1 AND source_id=ANY($2::text[])',[current.id,normalized.ids]);
  await tx.query('UPDATE artifact_source_ids SET retired_version=$2 WHERE artifact_id=$1 AND retired_version IS NULL AND NOT(source_id=ANY($3::text[]))',[current.id,updated.version,normalized.ids]);
  await tx.query(`WITH added AS (
    INSERT INTO artifact_node_aliases(artifact_id,legacy_key,source_id,source_path,created_version)
    SELECT $1,x->>'legacyKey',x->>'nodeId',x->>'path',$3 FROM jsonb_array_elements($2::jsonb) x
    ON CONFLICT DO NOTHING RETURNING legacy_key,source_id)
    UPDATE annotations a SET anchor_key=x.source_id FROM added x
    WHERE a.artifact_id=$1 AND a.anchor_key=x.legacy_key`,
    [current.id, JSON.stringify(normalized.aliases ?? []),updated.version]);
  await bindCurrentUserScopes(tx,updated);
  await logWholeDocumentWrite(tx, current, updated);
  return updated;
}

/** Artifact-aware publish preparation shared with the administrative migration. */
export async function publishMarkupForArtifact(
  current: ArtifactRow,
  source: string,
  metaOverride: Record<string, unknown> = current.meta,
): Promise<Response | { source: string; content: string; meta: Record<string, unknown>; ids: string[]; aliases: Array<{ legacyKey: string; nodeId: string; path: string }> }> {
  const currentMeta = metaOverride as { theme?: unknown; template?: unknown; colorMode?: unknown };
  const context = {
    loadRef: refLoaderForActor(writerFor(current)),
    importAsset: assetImporterFor(current.token_id, current.user_id),
    resolveFont: fontResolver(),
    overByteQuota: byteQuotaFor(current.token_id),
  };
  let published = await publishJsx({ theme: currentMeta.theme ?? null, template: currentMeta.template ?? null, colorMode: currentMeta.colorMode ?? null }, source, context);
  if (published instanceof Response) return published;
  const db = await getDb();
  const reserved = await db.query<{ source_id: string }>('SELECT source_id FROM artifact_source_ids WHERE artifact_id=$1', [current.id]);
  const aliases = await db.query<{ legacy_key: string; source_id: string }>('SELECT legacy_key,source_id FROM artifact_node_aliases WHERE artifact_id=$1', [current.id]);
  const identity = stampNodeIds(published.source ?? '', { previousSource: current.source, reservedIds: reserved.rows.map((row) => row.source_id), legacyAliases: new Map(aliases.rows.map(row => [row.legacy_key,row.source_id])), retireLegacyAliases: true });
  if (identity.source !== published.source) {
    published = await publishJsx({ theme: currentMeta.theme ?? null, template: currentMeta.template ?? null, colorMode: currentMeta.colorMode ?? null }, identity.source, context);
    if (published instanceof Response) return published;
  }
  return { source: published.source ?? '', content: published.content, meta: published.meta, ids: identity.ids, aliases: identity.aliases };
}

async function listVersionsScoped(scope: Scope, id: string): Promise<VersionSummary[] | null> {
  const db = await getDb();
  const owned = await db.query(`SELECT 1 FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val]);
  if (owned.rows.length === 0) return null;
  const r = await db.query<VersionSummary>(
    `SELECT v.version, v.title, v.description, v.format, u.username AS by, v.created_at
     FROM artifact_versions v LEFT JOIN users u ON u.id = v.actor_user_id
     WHERE v.artifact_id = $1 ORDER BY v.version DESC`,
    [id],
  );
  return r.rows;
}

interface VersionContent extends VersionSummary {
  content: string;
  source: string | null;
  meta: Record<string, unknown>;
}

/** One archived version WITH content (the editor's version viewer). */
async function getVersionScoped(scope: Scope, id: string, version: number): Promise<VersionContent | null> {
  const db = await getDb();
  const owned = await db.query(`SELECT 1 FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val]);
  if (owned.rows.length === 0) return null;
  return loadArtifactDocument<VersionContent>(db,
    `SELECT v.artifact_id, v.document, v.version, v.title, v.description, v.format, v.content, v.source, v.meta, u.username AS by, v.created_at
     FROM artifact_versions v LEFT JOIN users u ON u.id = v.actor_user_id
     WHERE v.artifact_id = $1 AND v.version = $2`,
    [id, version],
  );
}

/**
 * Asked for a version of an artifact that exists and is theirs, but which was
 * never archived. Save-less editing bumps `version` on every accepted edit
 * while snapshots COALESCE, so most version numbers are checkpoints that were
 * skipped — and answering the uniform 404 there would claim the artifact does
 * not exist. Ownership is already proved by this point, so naming the real
 * reason leaks nothing. `GET /versions` lists what can actually be restored.
 */
interface VersionNotArchived {
  notArchived: true;
  refusal?: Response;
  conflictVersion?: number;
}
export function isVersionNotArchived(r: ArtifactRow | null | VersionNotArchived): r is VersionNotArchived {
  return r !== null && 'notArchived' in r;
}

/**
 * The refusal a dataset's WRITE POLICY answers — 409, by name, never the
 * uniform 404. One spelling for every door that has to say it, because a
 * caller learning "policy_locked" once should not meet a second code for the
 * same fact on the next door.
 */
const policyLocked = (detail: string): Response => json({error:'policy_locked',detail},409);

/**
 * Revert to an archived version — as a NEW version (the current state is
 * archived first), so a revert is itself revertible and the URL never moves.
 * Null when the artifact or the requested version doesn't exist.
 */
async function revertScoped(actor: TokenActor, id: string, version: number, opts: ReplaceOpts = {}): Promise<ArtifactRow | null | VersionNotArchived> {
  const db = await getDb();
  const scope = editorScope(actor);
  const initial = (await artifactQuery<ArtifactRow>(db,`SELECT * FROM artifacts WHERE id=$1 AND ${scope.where('$2')}`, [id,scope.val])).rows[0];
  if (!initial) return null;
  // A governed dataset is not revertible: restoring an archived table would
  // drop the rows viewers have written under the policy since. The GUARD is
  // unchanged — what changed is that it now says so instead of answering the
  // uniform 404 for a dataset the caller is looking straight at.
  if (initial.dataset_policy) return {notArchived:true,refusal:policyLocked('a dataset with a write policy cannot be reverted — republish the rows you want as the owner')};
  const condition = (row: ArtifactRow): Response | null => {
    if (opts.expectedVersion !== undefined && row.version !== opts.expectedVersion) return json({error:'version_conflict',currentVersion:row.version,currentState:artifactState(row)},409);
    if (opts.expectedState !== undefined && artifactState(row) !== opts.expectedState) return json({error:'state_conflict',currentVersion:row.version,currentState:artifactState(row)},409);
    return null;
  };
  const refusal = condition(initial); if (refusal) return {notArchived:true,refusal};
  let target = (await artifactQuery<ArtifactRow>(db,'SELECT title,description,format,content,source,document,meta FROM artifact_versions WHERE artifact_id=$1 AND version=$2',[id,version])).rows[0];
  if (!target) return {notArchived:true};
  const prepared = target.format === 'markup' ? await publishMarkupForArtifact(initial,target.source??'',target.meta) : null;
  if (prepared instanceof Response) return {notArchived:true,refusal:prepared};
  // Event fires post-txn: an unawaited query from inside the callback would
  // deadlock PGLite's serialized op queue.
  const result: ArtifactRow | null | VersionNotArchived = await db.transaction(async (tx) => {
    const current = (
      await artifactQuery<ArtifactRow>(tx,`SELECT * FROM artifacts WHERE id = $1 AND ${scope.where('$2')} FOR UPDATE`, [id, scope.val])
    ).rows[0];
    if (!current) return null;
    if (current.dataset_policy) return {notArchived:true,refusal:policyLocked('a dataset with a write policy cannot be reverted — republish the rows you want as the owner')};
    const refusal = condition(current); if (refusal) return {notArchived:true,refusal};
    if(artifactState(current)!==artifactState(initial)) return {notArchived:true,conflictVersion:current.version};
    if(prepared) return commitNormalizedMarkup(tx,actor,current,{...prepared,title:target.title,description:target.description,format:target.format});
    if(target.format==='dataset'&&!catalogOf(target))return {notArchived:true,refusal:json({error:'dataset_error',details:['Historical dataset has no catalog or stored object key']},400)};
    target=retainUserScope(target,current);
    try {await validateUserContent(tx,target,actor.userId,key=>loadDatasetRows({content:"",meta:{objectKey:key}}));}catch(error){if(error instanceof DatasetError)return {notArchived:true,refusal:json({error:"dataset_error",details:[error.message]},error.status)};throw error;}
    const targetCatalog=catalogOf(target);
    if(targetCatalog?.kind==='postgres'&&targetCatalog.connection){
      try{await resolveDatasetConnection(targetCatalog.connection,undefined,current.id,tx);}
      catch(error){
        if(error instanceof DatasetError)return {notArchived:true,refusal:json({error:'dataset_error',details:[error.message]},error.status)};
        throw error;
      }
    }

    await archiveVersion(tx, current);
    const updated = await artifactQuery<ArtifactRow>(tx,
      `UPDATE artifacts
       SET title = $3, description = $4, format = $5, content = $6, source = CASE WHEN $12::jsonb IS NULL THEN $7::text ELSE NULL END, document=$12::jsonb, meta = $8, version = version + 1,
           edit_id = $9, actor_user_id = $10, actor_token_id = $11, updated_at = now()
       WHERE id = $1 AND ${scope.where('$2')} RETURNING *`,
      [id, scope.val, target.title, target.description, target.format, target.content, target.source, JSON.stringify(target.meta), newEditId(), ...actorStamp(actor),sourceStorage(target.format,target.source).document],
    );
    await logWholeDocumentWrite(tx, current, updated.rows[0]);
    if (updated.rows[0].format === 'markup' && updated.rows[0].source) {
      const ids = [...nodeIndex(updated.rows[0].source).keys()];
      await tx.query('UPDATE artifact_source_ids SET retired_version=NULL WHERE artifact_id=$1 AND source_id=ANY($2::text[])', [id, ids]);
      await tx.query('UPDATE artifact_source_ids SET retired_version=$2 WHERE artifact_id=$1 AND retired_version IS NULL AND NOT (source_id=ANY($3::text[]))', [id, updated.rows[0].version, ids]);
    }
    return updated.rows[0];
  });
  if (result && !isVersionNotArchived(result)) void trackEvent('revert', result.id, { userId: result.user_id });
  return result;
}

/**
 * Optimistic-concurrency miss: the caller's `expectedVersion` no longer names
 * the head. Distinct from `null` (unknown/foreign) — routes answer 409, not
 * 404, and report the head version so the caller can read → merge → replay.
 */
interface VersionConflict {
  reason?: 'state_conflict' | 'doc_changed';
  currentState?: string;
  conflict: true;
  currentVersion: number;
}
export function isVersionConflict(r: ArtifactRow | null | VersionConflict | Response): r is VersionConflict {
  return r !== null && 'conflict' in r;
}

export interface ReplaceOpts {
  expectedPolicyRevision?:number;
  shares?:ShareEntry[];
  annotationOps?: AnnotationOperation[];
  expectedState?: string;
  /** When set, the replace applies only if it still names the head version. */
  expectedVersion?: number;
}

/**
 * Full replace: archive the current state to artifact_versions, then overwrite
 * with version+1 (the format may change). Omitted title/description keep their
 * current values. Null when no artifact matches (unknown/foreign).
 */
async function replaceScoped(
  actor: TokenActor,
  id: string,
  input: ArtifactInput,
  opts: ReplaceOpts = {},
): Promise<ArtifactRow | null | VersionConflict | Response> {
  const db = await getDb();
  const scope = editorScope(actor);
  // Event and the parent wakeups fire post-txn — an unawaited query from
  // inside the callback would deadlock PGLite's serialized op queue.
  let moved: { from: string | null; to: string | null } | null = null;
  const result: ArtifactRow | null | VersionConflict | Response = await db.transaction(async (tx) => {
    const current = (
      await artifactQuery<ArtifactRow>(tx,`SELECT * FROM artifacts WHERE id = $1 AND ${scope.where('$2')} FOR UPDATE`, [id, scope.val])
    ).rows[0];
    if (!current) return null;
    /*
     * A GOVERNED DATASET IS THE OWNER'S TO REPUBLISH — AND NOBODY ELSE'S.
     *
     * This guard used to be `|| current.dataset_policy` on the line above, so
     * every re-push of a dataset carrying a write policy came back as the
     * uniform `not_found` — including the owner's, including one that only
     * added a column. `--policy viewers-write` is the documented way to make a
     * writable dataset, so the shorthand made the dataset permanently
     * unmaintainable and said nothing about why.
     *
     * Who: the ONE ownership rule, asked in SQL (ownerScope), never mirrored
     * in JS here. A named editor was invited to write the document, not to
     * replace the rows other people are writing under the owner's policy, and
     * they are told so BY NAME (`policy_locked`) rather than by a 404.
     */
    if (current.dataset_policy && !(await tx.query('SELECT 1 FROM artifacts WHERE id=$1 AND '+ownerScope(actor).where('$2'), [id, ownerScope(actor).val])).rows.length) {
      return policyLocked('this dataset carries a write policy; only its owner may replace its content');
    }
    if (opts.expectedState !== undefined && artifactState(current) !== opts.expectedState) return {conflict:true, reason:'state_conflict', currentVersion:current.version, currentState:artifactState(current)};
    if (opts.expectedVersion !== undefined && current.version !== opts.expectedVersion) {
      return { conflict: true, currentVersion: current.version };
    }
    input=retainUserScope(input,current);
    /*
     * The policy is re-validated against the REPLACEMENT's catalog, inside this
     * transaction, by the same function that validated it when it was set — so
     * a replacement that drops a table or a permission column is refused
     * (`policy_mismatch`, naming what is missing) instead of leaving a policy
     * pointing at columns that no longer exist. The policy row and its revision
     * are untouched by a replace: what was granted stays granted.
     */
    if (current.dataset_policy) {
      try { validateDatasetPolicyForRow({format:input.format,meta:input.meta,content:input.content}, current.dataset_policy); }
      catch (error) { return json({error:'policy_mismatch',detail:error instanceof Error?error.message:'The dataset policy does not fit this replacement.'},400); }
    }
    await validateUserContent(tx,input,actor.userId,key=>loadDatasetRows({content:"",meta:{objectKey:key}}));
    const replacementCatalog=catalogOf(input);
    if(replacementCatalog?.kind==='postgres'&&replacementCatalog.connection)await resolveDatasetConnection(replacementCatalog.connection,undefined,current.id,tx);

    const replacementIdentity = input.format === 'markup' && input.source
      ? stampNodeIds(input.source, {
          previousSource: current.source,
          reservedIds: (await tx.query<{source_id:string}>('SELECT source_id FROM artifact_source_ids WHERE artifact_id=$1',[id])).rows.map(row=>row.source_id),
          retireLegacyAliases: true,
        })
      : null;
    if(replacementIdentity) {
      const aliases=new Map<string,string>();
      for(const alias of replacementIdentity.aliases) {
        const prior=aliases.get(alias.legacyKey);
        if(prior && prior!==alias.nodeId) return {conflict:true,currentVersion:current.version};
        aliases.set(alias.legacyKey,alias.nodeId);
      }
    }

    const operations=opts.annotationOps??[];
    const annotationRows=operations.length?(await tx.query<AnnotationRecord>('SELECT id,anchor_key,range FROM annotations WHERE artifact_id=$1 AND root_id IS NULL AND deleted_at IS NULL FOR UPDATE',[id])).rows:[];
    const receipts=operations.length?(await tx.query<{annotation_changes:AnnotationReceipt[]}>(`SELECT annotation_changes FROM artifact_edits WHERE artifact_id=$1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(annotation_changes) receipt WHERE receipt->>'operationId'=ANY($2::text[]))`,[id,operations.map(op=>op.id)])).rows.flatMap(row=>row.annotation_changes??[]):[];
    if(operations.some(op=>op.kind==='undo'&&!receipts.some(receipt=>receipt.operationId===op.id&&receipt.direction==='map')))return {conflict:true,reason:'doc_changed',currentVersion:current.version};
    const effects=operations.length?annotationEffects(current.source??'',replacementIdentity?.source??input.source??'',operations,annotationRows,receipts):{updates:[],receipts:[]};
    await archiveVersion(tx, current);

    const updated = await artifactQuery<ArtifactRow>(tx,
      `UPDATE artifacts
       SET format = $3, content = $4, source = CASE WHEN $16::jsonb IS NULL THEN $5::text ELSE NULL END, document=$16::jsonb, meta = $6, title = $7, description = $8,
           visibility = COALESCE($10, visibility), ancestor_ids = COALESCE($11::text[], ancestor_ids),
           access = COALESCE($12, access), link_role = COALESCE($15, link_role),
           version = version + 1, edit_id = $9, actor_user_id = $13, actor_token_id = $14, updated_at = now()
       WHERE id = $1 AND ${scope.where('$2')} RETURNING *`,
      [
        id,
        scope.val,
        input.format,
        input.content,
        replacementIdentity?.source ?? input.source,
        JSON.stringify(finalizeArtifactMetadata(input.format, replacementIdentity?.source ?? input.source, input.meta)),
        input.title !== undefined ? input.title : current.title,
        input.description !== undefined ? input.description : current.description,
        newEditId(),
        input.visibility ?? null,
        input.ancestor_ids ?? null,
        input.access ?? null,
        ...actorStamp(actor),
        input.link_role ?? null,
        sourceStorage(input.format,replacementIdentity?.source ?? input.source).document,
      ],
    );
    // A replace may also FILE the row. When the row is a folder, its whole
    // subtree follows in the same statement the move door uses — one prefix
    // swap, inside this transaction, so a half-moved tree cannot be observed.
    if (input.ancestor_ids && current.format === 'folder') {
      const swap = ancestorsForMove(current, input.ancestor_ids);
      await tx.query(swap.sql, swap.params);
    }
    if(opts.shares!==undefined)Object.assign(updated.rows[0],await writeShares(tx,id,opts.shares));
    else updated.rows[0].shares=(await tx.query<ShareEntry>('SELECT email,role FROM artifact_shares WHERE artifact_id=$1 ORDER BY email',[id])).rows;
    await bindCurrentUserScopes(tx,updated.rows[0]);
    await documentMentions(tx,updated.rows[0],actor,current.source??'');
    await logWholeDocumentWrite(tx, current, updated.rows[0],true);
    const movedAnnotations=new Set<string>();
    for(const change of effects.updates){
      const applied=await tx.query<{id:string}>('UPDATE annotations SET anchor_key=$3,range=$4 WHERE artifact_id=$1 AND id=$2 AND anchor_key=$5 AND range IS NOT DISTINCT FROM $6 RETURNING id',[id,change.annotationId,change.after.anchor,change.after.range,change.before.anchor,change.before.range]);
      for(const row of applied.rows)movedAnnotations.add(row.id);
    }
    if(effects.receipts.length)await tx.query('UPDATE artifact_edits SET annotation_changes=$3::jsonb WHERE artifact_id=$1 AND edit_id=$2',[id,updated.rows[0].edit_id,JSON.stringify(effects.receipts.filter(receipt=>!receipt.annotationId||movedAnnotations.has(receipt.annotationId)))]);
    if (updated.rows[0].format === 'markup' && updated.rows[0].source) {
      const ids = [...nodeIndex(updated.rows[0].source).keys()];
      await tx.query(`INSERT INTO artifact_source_ids (artifact_id,source_id,provenance,first_version)
        SELECT $1,value #>> '{}','authored',$2 FROM jsonb_array_elements($3::jsonb) ON CONFLICT DO NOTHING`, [id, updated.rows[0].version, JSON.stringify(ids)]);
      await tx.query(`UPDATE artifact_source_ids SET retired_version=$2 WHERE artifact_id=$1 AND retired_version IS NULL AND NOT (source_id = ANY($3::text[]))`, [id, updated.rows[0].version, ids]);
      await tx.query('UPDATE artifact_source_ids SET retired_version=NULL WHERE artifact_id=$1 AND source_id=ANY($2::text[])',[id,ids]);
      await tx.query(`WITH added AS (
        INSERT INTO artifact_node_aliases(artifact_id,legacy_key,source_id,source_path,created_version)
        SELECT $1,x->>'legacyKey',x->>'nodeId',x->>'path',$3 FROM jsonb_array_elements($2::jsonb) x
        ON CONFLICT DO NOTHING RETURNING legacy_key,source_id)
        UPDATE annotations a SET anchor_key=x.source_id FROM added x
        WHERE a.artifact_id=$1 AND a.anchor_key=x.legacy_key`,
        [id,JSON.stringify(replacementIdentity?.aliases ?? []),updated.rows[0].version]);
    }
    moved = { from: parentOf(current), to: parentOf(updated.rows[0]) };
    return updated.rows[0];
  });
  const written = result && !isVersionConflict(result) && !(result instanceof Response) ? result : null;
  if (written) void trackEvent('update', written.id, { userId: written.user_id });
  // BOTH ends of a move wake: the folder the row left and the one it joined.
  if (moved) await wakeParents(moved);
  if (written) sayMoved(actor, written.id, moved);
  return result;
}

/**
 * The two channels a placement change wakes — the folder the row LEFT and the
 * one it JOINED — so an open listing at either end re-runs its own query.
 * Deduped, because a rename or a plain content write moves nothing and would
 * otherwise ping the same folder twice.
 */
async function wakeParents({ from, to }: { from: string | null; to: string | null }): Promise<void> {
  for (const id of new Set([from, to])) await notifyParent(id);
}

/**
 * The MOVE, said once, by whichever of the two placement doors ran it — the
 * PATCH that only files a row, and the replace that files it while writing it.
 *
 * Guarded on the ends being DIFFERENT, because a plain content write computes
 * the same pair and would otherwise say a move on every save. Fire-and-forget
 * and outside the transaction, like every other emit here (lib/events).
 */
function sayMoved(actor: TokenActor, id: string, moved: { from: string | null; to: string | null } | null): void {
  if (!moved || moved.from === moved.to) return;
  void emit(actorSubject(actor), 'moved', { kind: 'artifact', id }, { from_parent_id: moved.from, to_parent_id: moved.to });
}

// ── The concurrent-edit protocol ─────────────────────────────────────────────

/**
 * One edit against a claimed base version. Agents send the Edit-tool diff;
 * the WYSIWYG sends its whole re-serialized source (the splice is derived by
 * prefix/suffix diff — sound because stored source is canonical).
 */
export interface EditInput {
  annotationOps?: AnnotationOperation[];
  baseEditId: string;
  /** The content change, if this edit has one. */
  change?: { oldString: string; newString: string } | { newSource: string } | { edits: StringEdit[] };
  /**
   * Document-level attributes. Deliberately NOT node-scoped: a title or theme
   * belongs to the whole document, has no span to conflict on, and (for theme)
   * recompiles the stylesheet — so these apply to head and never reject, which
   * is what lets the editor persist a theme flip while an agent is writing.
   */
  meta?: { title?: string | null; theme?: string | null; colorMode?: 'light' | 'dark' | null };
}

/**
 * The resolution outcomes. `null` keeps the
 * uniform-404 contract: unknown and foreign ids are indistinguishable.
 * Candidate markup that fails validation returns the publish pipeline's 400
 * Response unchanged (same shape as parseContentInput).
 */
export type EditOutcome =
  /** `warnings`: external URLs the candidate named that would not import (lib/web-assets). */
  | { applied: true; row: ArtifactRow; warnings?: AssetWarning[] }
  | { applied: false; reason: 'stale_edit_id' | 'doc_changed'; head: { editId: string; source: string; version: number } }
  | { applied: false; reason: 'bad_diff'; detail: 'no_match' | 'multiple_matches' | 'identical' | 'empty_batch' | 'too_many_edits' | 'too_large'; editIndex?: number }
  | { applied: false; reason: 'not_editable' }; // data tiers are values, not documents

/**
 * Save-less editing writes constantly, so `artifact_versions` snapshots
 * coalesce: the first edit after this much quiet archives the pre-edit state,
 * everything inside the burst rides on it. The decision is made in SQL (a NOT
 * EXISTS over the edit log) so it costs no extra round trip.
 */
const EDIT_SNAPSHOT_WINDOW_MS = 120_000;

/** How many times a lost CAS race is retried before we give up and report the conflict. */
const EDIT_CAS_RETRIES = 3;

/**
 * How far behind head a base may be and still be resolved. Reconstructing a
 * base means inverse-applying every edit after it, so an unbounded lag is
 * unbounded work — and a caller that far behind is better served re-reading
 * than rebasing. Refusing is safe: `stale_edit_id` carries head, which is
 * exactly what they need. This is also what makes the log prunable.
 */
export const MAX_STALE_EDITS = 200;

/** The log rows written after `baseEditId`, oldest→newest; null when that id is unknown here. */
async function interveningEdits(q: Queryable, artifactId: string, baseEditId: string): Promise<EditRecord[] | null> {
  const r = await q.query<{
    seq: string; edit_id: string; splice_start: number; removed: string; inserted: string; span_start: number; span_end: number; changes: BatchChange[] | string | null;
  }>(
    `SELECT seq, edit_id, splice_start, removed, inserted, span_start, span_end, changes FROM artifact_edits
     WHERE artifact_id = $1 AND seq > (SELECT seq FROM artifact_edits WHERE artifact_id = $1 AND edit_id = $2)
     ORDER BY seq`,
    [artifactId, baseEditId],
  );
  // The subselect yields NULL for an unknown base, and `seq > NULL` matches
  // nothing — indistinguishable from "no intervening edits", so confirm the
  // base actually exists before trusting an empty list.
  if (r.rows.length === 0) {
    const known = await q.query('SELECT 1 FROM artifact_edits WHERE artifact_id = $1 AND edit_id = $2', [artifactId, baseEditId]);
    if (known.rows.length === 0) return null;
  }
  return r.rows.flatMap((row) => {
    const parsed = typeof row.changes === 'string' ? JSON.parse(row.changes) as BatchChange[] : row.changes;
    const changes = parsed?.length ? [...parsed].reverse() : [{
      splice: { start: row.splice_start, removed: row.removed, inserted: row.inserted },
      span: { start: row.span_start, end: row.span_end },
    }];
    return changes.map((change) => ({ seq: Number(row.seq), editId: row.edit_id, ...change }));
  });
}

const headOf = (row: ArtifactRow) => ({ editId: row.edit_id, source: row.source ?? '', version: row.version });

/**
 * Resolve one edit: fast path = single guarded CTE (UPDATE + archive + log
 * INSERT + NOTIFY) when the base is head; slow path = shift through
 * intervening log rows, apply iff node-disjoint. Fail closed everywhere: a CAS
 * miss retries (bounded), a shift that lands on text ≠ `removed` rejects as
 * doc_changed. The logged splice is always the delta between STORED versions
 * (post-sanitize), never the caller's literal diff, so reconstruction from any
 * still-logged base is exact.
 */
export async function applyEditScoped(actor: TokenActor, id: string, input: EditInput, opts: { scope?: Scope; dryRun?:boolean } = {}): Promise<EditOutcome | Response | null> {
  const db = await getDb();
  const publishCandidate: typeof publishJsx = opts.dryRun ? async(fields,source,ctx={})=>{
    const prepared=await prepareJsx(fields,source,{loadRef:ctx.loadRef,normalizeMarkup:ctx.normalizeMarkup});
    return prepared instanceof Response?prepared:prepared.content;
  } : publishJsx;
  // Who may reach the row: editors by default; an annotation anchor stamp
  // (lib/annotations) widens it to commenters, whose only "edit" this is.
  const scope = opts.scope ?? editorScope(actor);

  for (let attempt = 0; ; attempt++) {
    const head = (
      await artifactQuery<ArtifactRow>(db,`SELECT artifacts.*, ${SHARES_PROJECTION} FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val])
    ).rows[0];
    if (!head) return null;
    // Documents edit; VALUES do not. A dataset/viz/image is a blob whose
    // meaning lives in its structure, so a text splice into it is meaningless.
    // A FOLDER is a document — its source is the markup we stamped, and
    // renaming one IS this protocol (the editor's Title field writes through
    // here like every other change).
    if (!isDocumentFormat(head.format)) return { applied: false, reason: 'not_editable' };

    // The document's truth is `source` (markup rows keep `content` empty).
    const headSource = head.source ?? '';

    // 1. Resolve the claimed base: head itself, or a still-logged ancestor.
    let intervening: EditRecord[] = [];
    if (input.baseEditId !== head.edit_id) {
      const found = await interveningEdits(db, id, input.baseEditId);
      // Unknown, or so far behind that rebasing is worse than re-reading —
      // both answer with head, which is all the caller needs either way.
      if (found === null || new Set(found.map((edit) => edit.seq)).size > MAX_STALE_EDITS) {
        return { applied: false, reason: 'stale_edit_id', head: headOf(head) };
      }
      intervening = found;
    }
    const baseSource = reconstructBaseSource(headSource, intervening);

    // 2. Derive the splice in the BASE's coordinates — anchoring on the version
    //    the caller actually read is what makes a stale base resolvable at all.
    //    A metadata-only edit has no splice and skips straight to the write.
    let candidate = headSource;
    let batchChanges: BatchChange[] | null = null;
    if (input.change) {
      if ('edits' in input.change) {
        const resolved = resolveEditBatch(baseSource, input.change.edits);
        if (!resolved.ok) return { applied: false, reason: 'bad_diff', detail: resolved.reason, editIndex: resolved.editIndex };
        const rebased = rebaseEditBatch(headSource, resolved.changes, intervening);
        if (!rebased.ok) return { applied: false, reason: 'doc_changed', head: headOf(head) };
        candidate = rebased.source;
        batchChanges = rebased.changes;
      } else {
      let splice: Splice;
      if ('oldString' in input.change) {
        const derived = deriveSpliceFromStrings(baseSource, input.change.oldString, input.change.newString);
        if (!derived.ok) return { applied: false, reason: 'bad_diff', detail: derived.reason };
        splice = derived.splice;
      } else {
        const derived = deriveSpliceByDiff(baseSource, canonicalizeMarkup(input.change.newSource));
        if (!derived) {
          // No text change. Fine when metadata is also being set; otherwise
          // there is nothing to do.
          if (!input.meta) return opts.dryRun?json({valid:true,dry_run:true,changed:false,markup:headSource}):{ applied: false, reason: 'bad_diff', detail: 'identical' };
          splice = { start: 0, removed: '', inserted: '' };
        } else {
          splice = derived;
        }
      }

      // 3. Place it at the best-scoped position among its equivalents, then
      //    carry it to head coords, rejecting when an intervening edit touched
      //    the same node. Without normalization a whole-document submission
      //    (every editor flush) can land inside a tag and touch everything.
      splice = normalizeSplice(baseSource, splice);
      const shifted = shiftThroughEdits(
        { splice, span: touchedSpanFor(baseSource, splice) },
        intervening,
      );
      if (!shifted.ok) return { applied: false, reason: 'doc_changed', head: headOf(head) };
      // Defence in depth: the shifted range must still name the text it claims.
      const at = headSource.slice(shifted.splice.start, shifted.splice.start + shifted.splice.removed.length);
      if (at !== shifted.splice.removed) return { applied: false, reason: 'doc_changed', head: headOf(head) };
      candidate = applySplice(headSource, shifted.splice);
      }
    } else if (!input.meta) {
      return { applied: false, reason: 'bad_diff', detail: 'identical' };
    }

    // 4. Validate/sanitize/compile the candidate — a pure function of content,
    //    so it runs with no lock held (a concurrent landing just loses the CAS).
    //    Theme/colorMode ride along because they change the compiled stylesheet.
    const meta = head.meta as { theme?: unknown; template?: unknown; colorMode?: unknown };
    let published = await publishCandidate(
      {
        theme: input.meta?.theme !== undefined ? input.meta.theme : meta.theme ?? null,
        template: meta.template ?? null,
        colorMode: input.meta?.colorMode !== undefined ? input.meta.colorMode : meta.colorMode ?? null,
      },
      candidate,
      {
        // Refs resolve as the DOCUMENT's owner, never the writer: an editor's
        // edit to a document carrying its owner's <Mutation> or private image
        // must not fail on assets the editor could never own. Same rule as
        // the importer below and runDocumentMutation.
        loadRef: refLoaderForActor(writerFor(head)),
        // An agent pasting a web image mid-edit imports like a publish would;
        // the created asset belongs to whoever the DOCUMENT belongs to.
        importAsset: assetImporterFor(head.token_id, head.user_id),
        resolveFont: fontResolver(),
        overByteQuota: byteQuotaFor(head.token_id),
      },
    );
    if (published instanceof Response) return published;
    let identity = { source: published.source ?? '', ids: [...nodeIndex(published.source ?? '').keys()], aliases: [] as Array<{ legacyKey: string; nodeId: string; path: string }> };
    if (input.change) {
      const reserved = await db.query<{ source_id: string }>('SELECT source_id FROM artifact_source_ids WHERE artifact_id = $1', [id]);
      identity = stampNodeIds(published.source ?? '', {
        previousSource: headSource,
        reservedIds: reserved.rows.map((entry) => entry.source_id),
        retireLegacyAliases: true,
      });
    }
    if (input.change && identity.source !== published.source) {
      published = await publishCandidate(
        {
          theme: input.meta?.theme !== undefined ? input.meta.theme : meta.theme ?? null,
          template: meta.template ?? null,
          colorMode: input.meta?.colorMode !== undefined ? input.meta.colorMode : meta.colorMode ?? null,
        },
        identity.source,
        { loadRef: refLoaderForActor(writerFor(head)), importAsset: assetImporterFor(head.token_id, head.user_id), resolveFont: fontResolver(), overByteQuota: byteQuotaFor(head.token_id) },
      );
      if (published instanceof Response) return published;
    }
    const aliasTargets = new Map<string, string>();
    for (const alias of identity.aliases) {
      const prior = aliasTargets.get(alias.legacyKey);
      if (prior && prior !== alias.nodeId) return json({ error: 'ambiguous_node_alias' }, 400);
      aliasTargets.set(alias.legacyKey, alias.nodeId);
    }
    const storedText = input.change ? published.source ?? '' : headSource;
    if(opts.dryRun)return json({valid:true,dry_run:true,changed:storedText!==headSource,markup:storedText,edit_id:head.edit_id,version:head.version,state:artifactState(head),commit_checks:['authorization','references','edit_base']});

    // 5. Log what actually LANDED (the sanitizer may have rewritten the text),
    //    normalized for the same reason: the logged span is what every future
    //    stale-base edit is tested against.
    const rawStored = deriveSpliceByDiff(headSource, storedText);
    if (!rawStored && !input.meta) return { applied: false, reason: 'bad_diff', detail: 'identical' };
    // A metadata-only write logs a zero-width edit: it moves the head pointer
    // and wakes watchers, but touches no node, so it conflicts with nothing.
    const storedSplice = rawStored ? normalizeSplice(headSource, rawStored) : { start: 0, removed: '', inserted: '' };
    const storedSpan = rawStored ? touchedSpanFor(headSource, storedSplice) : { start: 0, end: 0 };
    // Batch changes are already ordered in head coordinates. When publishing
    // rewrites bytes beyond those changes, the broad stored splice remains the
    // exact rollback record and is the safe grouped history fallback.
    const storedChanges = batchChanges && batchChanges.reduceRight((text, change) => applySplice(text, change.splice), headSource) === storedText
      ? batchChanges
      : null;

    const operations = input.annotationOps ?? [];
    const annotationRows = operations.length
      ? (await db.query<AnnotationRecord>(
          'SELECT id,anchor_key,range FROM annotations WHERE artifact_id=$1 AND root_id IS NULL AND deleted_at IS NULL',
          [id],
        )).rows
      : [];
    const storedReceipts = operations.length
      ? (await db.query<{ annotation_changes: AnnotationReceipt[] }>(
          `SELECT annotation_changes FROM artifact_edits WHERE artifact_id=$1 AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(annotation_changes) receipt
             WHERE receipt->>'operationId'=ANY($2::text[])
           )`,
          [id, operations.map((op) => op.id)],
        )).rows.flatMap((r) => r.annotation_changes ?? [])
      : [];
    if (operations.some((op) => op.kind === 'undo' && !storedReceipts.some((r) => r.operationId === op.id && r.direction === 'map')))
      return { applied: false, reason: 'doc_changed', head: headOf(head) };
    const sideEffects = operations.length
      ? annotationEffects(headSource, storedText, operations, annotationRows, storedReceipts)
      : { updates: [], receipts: [] };
    const freshEditId = newEditId();
    const commit = (queryable:Queryable) => artifactQuery<ArtifactRow>(queryable,
      `WITH updated AS (
         UPDATE artifacts SET content = $3, source = CASE WHEN $33::jsonb IS NULL THEN $4::text ELSE NULL END, document=$33::jsonb, meta = $5, version = version + 1,
                edit_id = $6, title = $21, actor_user_id = $22, actor_token_id = $23, updated_at = now()
         WHERE id = $1 AND ${scope.where('$2')} AND edit_id = $7 AND sharing_revision=$32
           AND meta = $14::jsonb AND title IS NOT DISTINCT FROM $9 AND description IS NOT DISTINCT FROM $10
         RETURNING *
       ), archived AS (
         INSERT INTO artifact_versions (artifact_id, version, title, description, format, content, source, meta, actor_user_id, actor_token_id, document)
         SELECT $1, $8, $9, $10, $11, $12, CASE WHEN $34::jsonb IS NULL THEN $13::text ELSE NULL END, $14::jsonb, $24, $25, $34::jsonb
         WHERE EXISTS (SELECT 1 FROM updated)
           -- Coalesce on ARCHIVING activity, not edit activity: the first edit
           -- after a quiet spell preserves the pre-edit state (including the
           -- created draft), and the rest of the burst rides on that snapshot.
           AND NOT EXISTS (
             SELECT 1 FROM artifact_versions
             WHERE artifact_id = $1 AND created_at > now() - ($15::int * interval '1 millisecond')
           )
         ON CONFLICT DO NOTHING
       ), moved_annotations AS (
         UPDATE annotations a SET anchor_key=x->'after'->>'anchor', range=x->'after'->>'range'
         FROM jsonb_array_elements($30::jsonb) x
         WHERE a.artifact_id=$1 AND a.id=x->>'annotationId' AND a.root_id IS NULL AND a.deleted_at IS NULL
           AND a.anchor_key=x->'before'->>'anchor' AND a.range IS NOT DISTINCT FROM (x->'before'->>'range')
           AND EXISTS (SELECT 1 FROM updated)
         RETURNING a.id
       ), logged AS (
         INSERT INTO artifact_edits (artifact_id, edit_id, splice_start, removed, inserted, span_start, span_end, changes, actor_user_id, actor_token_id, annotation_changes)
         SELECT id, $6, $16, $17, $18, $19, $20, $26::jsonb, $22, $23,
           (SELECT jsonb_agg(receipt) FROM jsonb_array_elements($31::jsonb) receipt WHERE receipt->>'annotationId'='' OR receipt->>'annotationId' IN (SELECT id FROM moved_annotations)) FROM updated
         RETURNING pg_notify('artifact_' || lower(artifact_id), $6)
       ), reserved_ids AS (
         INSERT INTO artifact_source_ids (artifact_id, source_id, provenance, first_version)
         SELECT $1, value #>> '{}', 'authored', $8 + 1 FROM jsonb_array_elements($27::jsonb)
         WHERE EXISTS (SELECT 1 FROM updated) ON CONFLICT DO NOTHING
       ), aliases AS (
         INSERT INTO artifact_node_aliases (artifact_id, legacy_key, source_id, source_path, created_version)
         SELECT $1, x->>'legacyKey', x->>'nodeId', x->>'path', $8 + 1 FROM jsonb_array_elements($28::jsonb) x
         WHERE EXISTS (SELECT 1 FROM updated) ON CONFLICT (artifact_id, legacy_key) DO NOTHING
         RETURNING legacy_key,source_id
       ), migrated_annotations AS (
         UPDATE annotations a SET anchor_key = x.source_id
         FROM aliases x
         WHERE a.artifact_id = $1 AND a.anchor_key = x.legacy_key AND EXISTS (SELECT 1 FROM updated)
       ), active_ids AS (
         UPDATE artifact_source_ids SET retired_version=NULL WHERE artifact_id=$1 AND source_id=ANY($29::text[])
           AND EXISTS (SELECT 1 FROM updated)
       ), retired_ids AS (
         UPDATE artifact_source_ids SET retired_version=$8+1
         WHERE artifact_id=$1 AND retired_version IS NULL AND NOT (source_id=ANY($29::text[]))
           AND EXISTS (SELECT 1 FROM updated)
       )
       SELECT u.* FROM updated u WHERE EXISTS (SELECT 1 FROM logged)`,
      [
        id, scope.val,
        published.content, storedText, JSON.stringify(finalizeArtifactMetadata('markup', storedText, published.meta)), freshEditId, head.edit_id,
        head.version, head.title, head.description, head.format, head.content, head.source, JSON.stringify(head.meta),
        EDIT_SNAPSHOT_WINDOW_MS,
        storedSplice.start, storedSplice.removed, storedSplice.inserted, storedSpan.start, storedSpan.end,
        input.meta?.title !== undefined ? input.meta.title : head.title,
        ...actorStamp(actor),
        head.actor_user_id, head.actor_token_id,
        storedChanges ? JSON.stringify(storedChanges) : null,
        JSON.stringify(identity.ids),
        JSON.stringify(identity.aliases),
        identity.ids,
        JSON.stringify(sideEffects.updates),
        JSON.stringify(sideEffects.receipts),head.sharing_revision??0,
        sourceStorage('markup',storedText).document,sourceStorage(head.format,head.source).document,
      ],
    );
    const previousRefs=new Set(((head.meta.refs??[]) as Array<{id:string}>).map(ref=>ref.id));
    const attachesReference=((published.meta.refs??[]) as Array<{id:string}>).some(ref=>!previousRefs.has(ref.id));
    // First attachment changes the dataset schema in the same transaction as the document CAS.
    const updated=attachesReference||storedText.includes('/people/')?await db.transaction(async tx=>{
      const result=await commit(tx);
      if(result.rows[0]){await bindCurrentUserScopes(tx,result.rows[0]);await documentMentions(tx,result.rows[0],actor,headSource);}
      return result;
    }):await commit(db);
    if (updated.rows[0]) {
      void trackEvent('edit', updated.rows[0].id, { userId: updated.rows[0].user_id });
      return { applied: true, row: {...updated.rows[0],shares:head.shares}, ...(published.warnings?.length ? { warnings: published.warnings } : {}) };
    }
    // Lost the CAS: someone landed between our read and our write. Re-read and
    // redo — our base is now an ordinary stale base, so the node-scope check
    // decides it. (Near-unreachable on PGLite, which serializes all ops.)
    if (attempt >= EDIT_CAS_RETRIES) {
      const now = (await artifactQuery<ArtifactRow>(db,`SELECT artifacts.*, ${SHARES_PROJECTION} FROM artifacts WHERE id = $1 AND ${scope.where('$2')}`, [id, scope.val])).rows[0];
      return now ? { applied: false, reason: 'doc_changed', head: headOf(now) } : null;
    }
  }
}

/**
 * Open (or close) a dataset for writes — metadata only, exactly like a folder
 * move: no version bump, no edit-log row, no content change. The rows are not
 * touched; only who may change them from here on. Closing is always safe for
 * the data (every mutate call re-checks), it only stops the documents that
 * write — which is why the share menu names them first.
 */
export function setAccessFor(actor: TokenActor, id: string, access: DatasetAccess): Promise<ArtifactRow | null> {
  return setAccessScoped(ownerScope(actor), id, access);
}

async function setAccessScoped(scope: Scope, id: string, access: DatasetAccess): Promise<ArtifactRow | null> {
  const db = await getDb();
  const r = await artifactQuery<ArtifactRow>(db,
    `UPDATE artifacts SET access = $3 WHERE id = $1 AND ${scope.where('$2')} AND format = 'dataset' AND ($3 <> 'readwrite' OR COALESCE(meta->'catalog'->>'kind','stored') <> 'postgres') RETURNING *, pg_notify('artifact_' || lower(id), edit_id)`,
    [id, scope.val, access],
  );
  return r.rows[0] ?? null;
}

// ── Sharing (the private tier's ACL surface) ─────────────────────────────────

export interface SharingState {
  visibility: Visibility;
  /** What the link grants — the general-access role beside the general-access tier. */
  linkRole: ShareRole;
  /** The named people, by email, with their role — sorted by email. */
  shares: ShareEntry[];
  /** Datasets: the write ACL, and the documents that would stop working if it were closed. */
  access?: DatasetAccess;
  datasetKind?: 'stored' | 'postgres';
  writtenBy?: Array<{ id: string; title: string | null; mutations: string[] }>;
  /** False for an anonymous owner: `private` has no ACL to anchor without an account. */
  canPrivate?: boolean;
}

/**
 * Editor-access read of an artifact's ACL. Null = unknown/foreign (uniform 404).
 *
 * Scoped by ACTOR, not by account: an ANONYMOUS owner has an ACL to manage
 * too, now that `access` lives here — writes anchor on the creating token, not
 * on an account. (`private` still needs one, and `canPrivate` says so, which
 * is what keeps the UI from offering a tier the door would refuse.)
 */
export async function getSharingFor(actor: TokenActor, id: string): Promise<SharingState | null> {
  const db = await getDb();
  const row = await getArtifactFor(actor, id);
  if (!row) return null;
  const shares = await db.query<ShareEntry>(
    'SELECT email, role FROM artifact_shares WHERE artifact_id = $1 ORDER BY email',
    [id],
  );
  return {
    visibility: row.visibility,
    linkRole: (row.link_role ?? 'viewer') as ShareRole,
    shares: shares.rows,
    canPrivate: !!row.user_id,
    ...(row.format === 'dataset'
      ? { access: row.access, policyVersion:grantsOf(row)?2:1, datasetKind: catalogOf(row)?.kind ?? 'stored', writtenBy: await findWritersFor(actor, id) }
      : {}),
  };
}

/** What the sharing surface may change, all optional — absent means untouched. */
export interface SharingPatch {
  visibility?: Visibility;
  shares?: ShareEntry[];
  access?: DatasetAccess;
  /** What the link grants. Stored even while `private`, where `linkRoleOf` ignores it — so flipping back to a link-readable tier restores the choice rather than silently resetting it. */
  linkRole?: ShareRole;
}

/**
 * Editor-access update of an artifact's ACL. `shares` is FULL-REPLACE (the UI
 * always sends the whole list — idempotent, no add/remove protocol). Emails
 * are normalized to lowercase and collapsed — the LAST role given for an
 * address wins; the route validates shape and role names upstream.
 */
export async function updateSharingFor(actor: TokenActor, id: string, patch: SharingPatch): Promise<SharingState | null> {
  const db = await getDb();
  const scope = editorScope(actor);
  const done = await db.transaction(async (tx) => {
    const owned = await artifactQuery<ArtifactRow>(tx,`SELECT * FROM artifacts WHERE id = $1 AND ${scope.where('$2')} FOR UPDATE`, [id, scope.val]);
    if (owned.rows.length === 0) return false;
    if (patch.visibility) {
      await tx.query(`UPDATE artifacts SET visibility = $2 WHERE id = $1 `, [id, patch.visibility]);
    }
    if (patch.linkRole) {
      await tx.query(`UPDATE artifacts SET link_role = $2 WHERE id = $1 `, [id, patch.linkRole]);
    }
    if (patch.access) {
      // Datasets only — the SQL says so rather than the caller, so a document
      // can never acquire a write ACL by way of this surface.
      await tx.query(`UPDATE artifacts SET access = $2 WHERE id = $1  AND format = 'dataset' AND ($2 <> 'readwrite' OR COALESCE(meta->'catalog'->>'kind','stored') <> 'postgres')`, [id, patch.access]);
    }
    if(patch.shares!==undefined)await writeShares(tx,id,patch.shares);
    // Dataset subscribers must re-read capabilities even when rows/version
    // have not changed. The existing data wakeup already refreshes queries.
    await tx.query(`SELECT pg_notify('artifact_' || lower(id), edit_id) FROM artifacts WHERE id = $1`, [id]);
    const row = owned.rows[0];
    const shares = await tx.query<ShareEntry>('SELECT email, role FROM artifact_shares WHERE artifact_id=$1 ORDER BY email',[id]);
    return {
      visibility: patch.visibility ?? row.visibility,
      linkRole: patch.linkRole ?? row.link_role ?? 'viewer',
      shares: shares.rows,
      canPrivate: !!row.user_id,
      ...(row.format === 'dataset' ? {access:patch.access ?? row.access,datasetKind:catalogOf(row)?.kind ?? 'stored'} : {}),
    } satisfies SharingState;
  });
  if (!done) return null;
  /*
   * AFTER the transaction, and only when the ACL actually moved. The payload
   * carries the two axes a change can name and nothing else: the share list is
   * email addresses, which never travel to the log — an operator reading
   * "sharing_changed" learns the tier, not who is on it.
   */
  await emit(actorSubject(actor), 'sharing_changed', { kind: 'artifact', id }, {
    visibility: patch.visibility ?? null,
    link_role: patch.linkRole ?? null,
  });
  return (await getSharingFor(actor, id)) ?? done;
}


export async function updateSharing(userId: string, id: string, patch: SharingPatch): Promise<SharingState | null> {
  return updateSharingFor({ tokenId: '', userId }, id, patch);
}

// ── The reference graph ──────────────────────────────────────────────────────

/**
 * A ref target ANY caller may use: link-readable, exactly the anonymous
 * viewer's cut of canReadArtifact. Assets and documents routinely land under
 * different identities (two agent sessions each on their own anonymous token;
 * an unclaimed upload referenced from an account-owned doc), and anonymous
 * assets are born public — so ownership-scoping made "publish the image, then
 * reference it" fail for no reason the user could see. PRIVATE stays invisible
 * cross-identity: the same uniform "does not resolve" as a nonexistent id,
 * never an existence oracle.
 */
async function getLinkReadableArtifact(id: string): Promise<ArtifactRow | null> {
  const row = await getArtifactById(id);
  return row && (grantsOf(row)?await grantsPermitRead(row,{userId:null,tokenId:null}):row.visibility !== 'private') ? row : null;
}

/** Resolve a `ref:<id>`: the caller's own artifacts, then anything link-readable. */
function refLoaderFor(tokenId: string): RefLoader {
  return async (id: string): Promise<ResolvedRef | null> => {
    // `owned` records WHICH branch answered: a read is happy either way, a
    // <Mutation> is admitted only for the caller's own (lib/story/refs).
    const own = await getArtifact(tokenId, id);
    const row = own ?? (await getLinkReadableArtifact(id));
    if (!row) return null;
    return rowToResolvedRef(row, !!own);
  };
}

/** Same, scoped by account (the session-authed /api/my routes) before the link-readable fallback. */
function refLoaderForUser(userId: string): RefLoader {
  return async (id: string): Promise<ResolvedRef | null> => {
    const own = await getArtifactFor({userId,tokenId:''}, id);
    const row = own ?? (await getLinkReadableArtifact(id));
    if (!row) return null;
    return rowToResolvedRef(row, !!own);
  };
}

/**
 * THE PUBLISH DOOR'S ASSET IMPORTER: one external URL → one row in the global
 * URL cache (lib/web-assets), charged to whoever the DOCUMENT belongs to.
 *
 * It answers a WARNING rather than a Response, because a URL that will not
 * import must not cost an author their document: the publish succeeds, the
 * reply names what failed and what to do, and the served `<img>` draws its alt
 * text. The hourly fetch allowance is the same one every web import pays
 * (lib/auth) — probing is the abuse shape and probes fail, so ATTEMPTS are what
 * is counted. The byte quota is charged inside `importWebAsset`, at the one
 * door that turns a URL into stored bytes.
 *
 * Nothing here creates an artifact or rewrites the source: the URL the author
 * wrote stays in the document, and only the served page points at our copy.
 */
export function assetImporterFor(tokenId: string, userId: string | null): (url: string, kind: WebAssetKind) => Promise<AssetWarning | null> {
  return async (url, kind) => {
    if (webIngestRateLimited(`ingest:${tokenId}`)) {
      return { code: 'rate_limited', url, fix: 'too many web imports this hour — try again later' };
    }
    try {
      await importWebAsset(url, { tokenId, userId }, kind);
      return null;
    } catch (error) {
      if (error instanceof WebAssetRefused) return assetWarningFor(error);
      throw error;
    }
  };
}

/**
 * The byte quota as the publish door asks it: "is this caller already over?"
 *
 * A closure over the identity, so lib/story/input can guard a tier without
 * knowing who is publishing (the shape assetImporterFor established). The
 * subject is the ACCOUNT when the token has one — a cap keyed on the token
 * alone is bypassed by minting a second one — which lib/asset-quota decides,
 * not this.
 *
 * Its ABSENCE is also what tells the byte tiers they are being previewed:
 * every other ctx member degrades to "do less", and storing the bytes IS what
 * publishing an image or a PDF is, so those two refuse by name instead of
 * quietly working for free (lib/story/input).
 */
export function byteQuotaFor(tokenId: string): () => Promise<boolean> {
  return () => assetByteQuotaExceeded(tokenId);
}

/**
 * The publish door's font resolver: a family the document names becomes faces
 * copied into our object store (lib/webfonts), once per deployment. Failure is
 * a 400 that NAMES the family — the same stance the image door takes, and for
 * the same reason: a silent fallback renders as "it worked".
 */
export function fontResolver(): (family: string) => Promise<Response | null> {
  return async (family) => {
    try {
      await resolveWebFont(family);
      return null;
    } catch (error) {
      if (error instanceof UnknownFontError) {
        return json({ error: 'unknown_font', details: [error.message] }, 400);
      }
      throw error;
    }
  };
}

// ── The bearer actor ─────────────────────────────────────────────────────────
//
// A presented token acts in ONE of the two scopes above. A token claimed by an
// account acts ACCOUNT-WIDE: any of a user's tokens may read, edit, and manage
// anything the user owns, because handing an agent a token IS handing it the
// account's documents — a second agent must be able to pick up a document the
// first one created. (Render-time ref resolution already widened this way; see
// refDataForRow.) An anonymous token reaches only what it itself created —
// there is no account to widen to, so the token-scope boundary stands.
//
// Safe because creation stamps user_id from the token and claiming backfills
// it: a user-owned token cannot have artifacts its user scope would miss.

export interface TokenActor extends VerifiedAccount {
  tokenId: string;
  userId: string | null;
}

/** The actor's REACH: what they own, and what they are named editor on. */
export function getArtifactFor(actor: TokenActor, id: string): Promise<ArtifactRow | null> {
  return getArtifactScoped(editorScope(actor), id);
}

/** What the actor OWNS — the read behind every owner-only surface (sharing, metadata, delete). */
export function getOwnedArtifactFor(actor: TokenActor, id: string): Promise<ArtifactRow | null> {
  return getArtifactScoped(ownerScope(actor), id);
}

/** Stable keyset pagination; creation timestamps never move when content is edited. */
interface ArtifactCollectionFilters {type?:'artifact'|'folder'|'dataset'|'file';visibility?:'private'|'unlisted'|'public';relationship?:'all'|'owned'|'shared';search?:string;parent_id?:string}
export async function listArtifactPageFor(actor: TokenActor, limit: number, cursor?: {created: string; id: string}, filters:ArtifactCollectionFilters={}): Promise<{rows: ArtifactSummary[]; next?: {created: string; id: string}}> {
  const owner=ownerPredicate(actor);const values:unknown[]=[owner.val,limit+1];
  const shared=actor.userId?SHARE_PREDICATE(['viewer','commenter','editor'],'$1'):'FALSE';
  const relationship=filters.relationship??'all';
  const reach=relationship==='owned'?owner.where('$1'):relationship==='shared'?`(${shared} AND NOT (${owner.where('$1')}))`:`(${owner.where('$1')} OR ${shared})`;
  const predicates=[LIVE_ARTIFACT_SQL,`(${reach})`];
  const bind=(value:unknown)=>{values.push(value);return '$'+values.length;};
  if(cursor)predicates.push(`(created_at,id)<(${bind(cursor.created)}::timestamptz,${bind(cursor.id)})`);
  if(filters.type)predicates.push(`format=ANY(${bind(filters.type==='file'?['image','pdf','file']:[filters.type==='artifact'?'markup':filters.type])}::text[])`);
  if(filters.visibility)predicates.push(`visibility=${bind(filters.visibility)}`);
  if(filters.search)predicates.push(`position(lower(${bind(filters.search)}) in lower(COALESCE(title,'')))>0`);
  if(filters.parent_id)predicates.push(`ancestor_ids[array_length(ancestor_ids,1)]=${bind(filters.parent_id)}`);
  const result=await (await getDb()).query<ArtifactSummary & {page_created:string}>(`SELECT ${SUMMARY_COLS},created_at::text AS page_created FROM artifacts WHERE ${predicates.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT $2`,values);
  const rows=result.rows.slice(0,limit),last=rows.at(-1);
  return {rows,...(result.rows.length>limit&&last?{next:{created:last.page_created,id:last.id}}:{})};
}

export function listArtifactsFor(actor: TokenActor): Promise<ArtifactSummary[]> {
  return listArtifactsScoped(ownerScope(actor));
}

export function replaceArtifactFor(actor: TokenActor, id: string, input: ArtifactInput, opts: ReplaceOpts = {}): Promise<ArtifactRow | VersionConflict | Response | null> {
  return replaceScoped(actor, id, input, opts);
}

export function applyEditFor(actor: TokenActor, id: string, input: EditInput, opts: { scope?: Scope; dryRun?:boolean } = {}): Promise<EditOutcome | Response | null> {
  return applyEditScoped(actor, id, input, opts);
}

export async function listVersionPageFor(actor: TokenActor, id: string, limit: number, before?: number, through?:number, filters:{author?:string;since?:string;until?:string}={}): Promise<{rows: VersionSummary[]; next?: number} | null> {
  const scope = editorScope(actor);
  const db = await getDb();
  // Keep authorization and the head/history snapshot in one statement.
  const result = await db.query<VersionSummary & {visible: boolean}>(`
    WITH head AS (SELECT * FROM artifacts WHERE id=$1 AND ${scope.where('$2')}),
    history AS (
      SELECT version,title,description,format,actor_user_id,updated_at AS created_at FROM head
      UNION ALL
      SELECT v.version,v.title,v.description,v.format,v.actor_user_id,v.created_at
      FROM artifact_versions v WHERE v.artifact_id=$1 AND EXISTS (SELECT 1 FROM head)
    )
    SELECT h.version,h.title,h.description,h.format,u.username AS by,h.created_at,true AS visible
    FROM history h LEFT JOIN users u ON u.id=h.actor_user_id
    WHERE ($4::bigint IS NULL OR h.version < $4) AND ($5::bigint IS NULL OR h.version <= $5)
      AND ($6::text IS NULL OR u.username = $6) AND ($7::timestamptz IS NULL OR h.created_at >= $7) AND ($8::timestamptz IS NULL OR h.created_at <= $8)
    ORDER BY h.version DESC LIMIT $3`,
    [id, scope.val, limit + 1, before ?? null,through??null,filters.author??null,filters.since??null,filters.until??null]);
  if (!result.rows.length) {
    const visible = await db.query(`SELECT 1 FROM artifacts WHERE id=$1 AND ${scope.where('$2')}`, [id, scope.val]);
    if (!visible.rows.length) return null;
  }
  const rows = result.rows.slice(0, limit).map(({visible: _visible, ...row}) => row);
  return {rows, ...(result.rows.length > limit ? {next: rows.at(-1)!.version} : {})};
}

export function listVersionsFor(actor: TokenActor, id: string): Promise<VersionSummary[] | null> {
  return listVersionsScoped(editorScope(actor), id);
}

export function getVersionFor(actor: TokenActor, id: string, version: number): Promise<VersionContent | null> {
  return getVersionScoped(editorScope(actor), id, version);
}

/**
 * The version a CAPTURE photographs, in the ROW OWNER's own scope.
 *
 * The exporter shoots the served document in a headless browser that holds no
 * session: it carries the short-lived signed key instead (lib/export-key), and
 * the version ACL for that shot already ran at the export door, on the actor
 * who asked, BEFORE the key was minted. So the render has nothing left to
 * prove with, and this resolves the version as the artifact's own owner —
 * never as the requester, and never without a scope.
 *
 * Only a caller that has verified an export key for THIS row may use it.
 */
export function versionForCapture(row: Pick<ArtifactRow, 'id' | 'user_id' | 'token_id'>, version: number): Promise<VersionContent | null> {
  return getVersionScoped(editorScope({ userId: row.user_id, tokenId: row.token_id }), row.id, version);
}

export function revertArtifactFor(actor: TokenActor, id: string, version: number, opts: ReplaceOpts = {}): Promise<ArtifactRow | null | VersionNotArchived> {
  return revertScoped(actor, id, version, opts);
}

/** What a METADATA write may change: policy ABOUT a row, never its content. */
export interface MetadataPatch {
  policy?:DatasetPolicy|null;
  shares?:ShareEntry[];
  title?: string | null;
  description?: string | null;
  visibility?: Visibility;
  access?: DatasetAccess;
  ancestor_ids?: string[];
  link_role?: ShareRole;
  theme?: string | null;
  template?: string | null;
  colorMode?: 'light' | 'dark' | null;
}

/** Metadata commits as one observed-state transaction, without a content version. */
export function setMetadataFor(actor: TokenActor, id: string, patch: MetadataPatch): Promise<ArtifactRow | null>;
export function setMetadataFor(actor: TokenActor, id: string, patch: MetadataPatch, opts: ReplaceOpts & {allowEditor?:boolean;dryRun?:boolean}): Promise<ArtifactRow | VersionConflict | null>;
export async function setMetadataFor(actor: TokenActor, id: string, patch: MetadataPatch, opts: ReplaceOpts & {allowEditor?:boolean;dryRun?:boolean} = {}): Promise<ArtifactRow | VersionConflict | null> {
  const db = await getDb();
  const scope = opts.allowEditor?editorScope(actor):ownerScope(actor);
  let moved: {from: string | null; to: string | null} | null = null;
  const result = await db.transaction<ArtifactRow | VersionConflict | null>(async tx => {
    const current = (await artifactQuery<ArtifactRow>(tx,`SELECT * FROM artifacts WHERE id=$1 AND ${scope.where('$2')} FOR UPDATE`, [id,scope.val])).rows[0];
    if (!current) return null;
    if (opts.expectedState !== undefined && artifactState(current) !== opts.expectedState) return {conflict:true,reason:'state_conflict',currentVersion:current.version,currentState:artifactState(current)};
    if (opts.expectedVersion !== undefined && current.version !== opts.expectedVersion) return {conflict:true,currentVersion:current.version};
    if(patch.policy!==undefined&&current.policy_revision!==opts.expectedPolicyRevision)return {conflict:true,reason:'state_conflict',currentVersion:current.version,currentState:artifactState(current)};
    const policy=patch.policy===undefined?undefined:validateDatasetPolicyForRow(current,patch.policy);
    if (patch.access && (current.format !== 'dataset' || (patch.access === 'readwrite' && catalogOf(current)?.kind === 'postgres'))) return null;
    const meta = {...current.meta};
    for (const key of ['theme','template','colorMode'] as const) if (patch[key] !== undefined) meta[key] = patch[key];
    if(opts.dryRun)return {...current,...patch,meta};
    const updated = (await artifactQuery<ArtifactRow>(tx,`UPDATE artifacts SET title=$3,description=$4,meta=$5::jsonb,
      visibility=$6,access=$7,ancestor_ids=$8::text[],link_role=$9,updated_at=now(),actor_user_id=$10,actor_token_id=$11
      WHERE id=$1 AND ${scope.where('$2')} RETURNING *`, [id,scope.val,
      patch.title === undefined ? current.title : patch.title?.trim() ?? null,
      patch.description === undefined ? current.description : patch.description,
      JSON.stringify(meta),patch.visibility ?? current.visibility,patch.access ?? current.access,
      patch.ancestor_ids ?? current.ancestor_ids,patch.link_role ?? current.link_role,...actorStamp(actor),
    ])).rows[0];
    if(patch.shares!==undefined)Object.assign(updated,await writeShares(tx,id,patch.shares));
    else updated.shares=(await tx.query<ShareEntry>('SELECT email,role FROM artifact_shares WHERE artifact_id=$1 ORDER BY email',[id])).rows;
    if(policy!==undefined){
     const changed=await tx.query<{dataset_policy:DatasetPolicy|null;policy_revision:number}>(`WITH changed AS (
      UPDATE artifacts SET dataset_policy=$2::jsonb,policy_revision=policy_revision+1 WHERE id=$1 RETURNING *
     ), audit AS (
      INSERT INTO dataset_policy_audit(dataset_id,revision,policy,actor_user_id,actor_token_id)
      SELECT id,policy_revision,dataset_policy,$3,$4 FROM changed
     ) SELECT dataset_policy,policy_revision FROM changed`,[id,JSON.stringify(policy),actor.userId,actor.tokenId]);
     Object.assign(updated,changed.rows[0]);
    }
    if (patch.ancestor_ids && current.format === 'folder') {
      const swap = ancestorsForMove(current,patch.ancestor_ids);
      await tx.query(swap.sql,swap.params);
    }
    if (patch.ancestor_ids) moved = {from:parentOf(current),to:parentOf(updated)};
    return updated;
  });
  if (result && !isVersionConflict(result) && !opts.dryRun) {
    if (moved) {await wakeParents(moved);sayMoved(actor,id,moved);}
    else await notifyParent(parentOf(result));
    if (patch.access || patch.visibility || patch.link_role || patch.shares || patch.policy!==undefined) await db.query('SELECT pg_notify($1,$2)',[channelFor(id),result.edit_id]);
  }
  return result;
}

export function refLoaderForActor(actor: TokenActor): RefLoader {
  return actor.userId ? refLoaderForUser(actor.userId) : refLoaderFor(actor.tokenId);
}

/** A stored policy the publish door can analyze against, or nothing at all:
 * an unreadable policy is the write door's refusal to make, not a publish's. */
function parsedDatasetPolicy(row: ArtifactRow): DatasetPolicy | undefined {
  if (!row.dataset_policy) return undefined;
  try { return parseDatasetAccessPolicy(row.dataset_policy); } catch { return undefined; }
}

function rowToResolvedRef(row: ArtifactRow, owned = false): ResolvedRef {
  const meta = (row.meta ?? {}) as { columns?: DatasetColumn[] };
  const catalog = row.format === 'dataset' ? catalogOf(row) : null;
  return {
    id: row.id,
    format: row.format,
    owned,
    ...(row.format === 'dataset' ? { columns: meta.columns ?? [], access: row.access, catalog:catalog??undefined, datasetPolicy:parsedDatasetPolicy(row), query: async(sql:string,params:Record<string,Scalar>,paramTypes?:Record<string,DatasetColumn["type"]>) => {
      if(!catalog)throw new DatasetError(`Dataset source ref:${row.id} has no catalog or stored object key`);
      return executeCatalog(catalog,sql,params,{datasetId:row.id,limit:1,refresh:true,paramTypes});
    } } : {}),
    // A folder's shape is FIXED and computed, never stored — the publish door
    // and the dry run both need it to judge a <Query> over `ref_<folderId>`.
    ...(row.format === 'folder' ? { columns: CHILDREN_COLUMNS, query: (sql: string, params: Record<string, Scalar>) => queryRows({columns: CHILDREN_COLUMNS, rows: []}, sql, params) } : {}),
    ...(row.format === 'viz' ? { recipe: JSON.parse(row.content) } : {}),
  };
}

// ── Writable datasets ────────────────────────────────────────────────────────


/** Why a write may not happen. Each names the fix; none is an existence oracle. */
type WriteRefusal = 'not_a_dataset' | 'dataset_read_only';

/** The dataset must allow writes AND the current actor must hold its editor role. */
export async function canWriteDataset(dataset: ArtifactRow, actor: RoleActor, declared: boolean | GrantDocument = false): Promise<WriteRefusal | null> {
  if (dataset.format !== 'dataset') return 'not_a_dataset';
  if(catalogOf(dataset)?.kind==='postgres')return 'dataset_read_only';
  if(grantsOf(dataset))return await grantsPermitWrite(dataset,actor,typeof declared==='object'?declared:undefined)?null:'dataset_read_only';
  // An unreachable dataset is reported as read-only, never as "not yours":
  // the caller answers a uniform 404 for anything it could not resolve, and
  // this one it could — the document names it, so its existence is not news.
  if (!canEdit(await effectiveRole(dataset, actor)) && !(declared && await canUseDataPolicy(dataset, actor))) return 'dataset_read_only';
  return dataset.access === 'readwrite' ? null : 'dataset_read_only';
}

/** The document author's identity resolves its declared data references, never a viewer's write authority. */
export const writerFor = (doc: ArtifactRow): TokenActor => ({ tokenId: doc.token_id, userId: doc.user_id });

/**
 * Run one of a stored document's declared mutations. Everything a reader
 * supplies is scalar VALUES; the SQL and the target come from the stored
 * source, so a caller can never write anything the author did not publish.
 */
type DocumentMutationOutcome =
  | { ok: true; dataset: ArtifactRow; affected: number; rowCount: number }
  | { ok: true; local: LocalMutationResult }
  | {
      ok: false;
      reason: 'policy_denied' | 'unknown_mutation' | WriteRefusal | 'dataset_full' | 'invalid_sql' | 'contended' | 'row_changed' | 'row_not_unique' | 'invalid_row';
      detail?: string;
      /** The machine-readable half of the one refusal a reader can act on (lib/story/sign-in-required). */
      code?: typeof SIGN_IN_REQUIRED;
      /**
       * The KIND was refused, not the statement: a guest or a test user that
       * may not write `$_me` at all. The door answers this verbatim — its own
       * status and its own top-level `error` — because "sign in" and "you are
       * outside your sandbox" are answers about the CALLER, not verdicts about
       * the data (lib/capabilities).
       */
      capability?: CapabilityRefusal;
    };

export async function runDocumentMutation(
  doc: ArtifactRow,
  name: string,
  values: Record<string, Scalar>,
  row?: Record<string, Scalar>,
  actor: RoleActor = {userId:null,tokenId:null},
  localTables?: Record<string, Row[]>,
  receipt?: MutationReceipt,
): Promise<DocumentMutationOutcome> {
  if (doc.format !== 'markup' || !doc.source) return { ok: false, reason: 'unknown_mutation' };
  const parsed = parseJsx(doc.source);
  if (!parsed.ok) return { ok: false, reason: 'unknown_mutation' };
  const { content, body } = splitHelmet(parsed.nodes);
  const decl = content.mutations.find((m) => m.name === name);
  if (!decl) return { ok: false, reason: 'unknown_mutation' };

  /*
   * THE GUEST IS ANSWERED FIRST — before the shape of the call is judged.
   *
   * A statement that binds `$_me` has one honest answer for a signed-out
   * caller, and it is a door (lib/story/sign-in-required). A ROW action that
   * binds it — a membership button a `<For>` draws for exactly the people who
   * have not joined — used to be told "this row mutation requires its original
   * row snapshot" instead: true, useless, and about the wrong problem, because
   * the page never drew that button for a guest and so never gave them a row to
   * send. Deciding sign-in here makes the refusal the same whatever shape the
   * press arrives in: a stale tab, an agent posting at the door directly, a row
   * snapshot or none.
   *
   * It is the same judgement `mutateDataset` makes for the calls that never
   * come through here, and the same one `mutationAccessFor` previews for the
   * button; this is only about the ORDER the three checks run in.
   */
  const me: CapabilityActor = { userId: actor.userId ?? null, tokenId: actor.tokenId ?? null };
  if (decl.params.includes('_me') && !(await can(me, 'write_as_me', doc))) {
    // ANONYMOUS keeps the answer it always had: there is no identity to refuse,
    // only a statement that needs a person, and the code is what draws the
    // door. A guest or a test user HAS an identity, and the honest answer names
    // it — the sign-in door for one, the sandbox for the other.
    return me.userId
      ? { ok: false, reason: 'policy_denied', detail: '$_me writes belong to the person signed in; this credential may not make them here', code: SIGN_IN_REQUIRED, capability: await refusalFor(me, doc.id) }
      : { ok: false, reason: 'policy_denied', detail: '$_me requires a logged-in user', code: SIGN_IN_REQUIRED };
  }

  // Resolved by the DOCUMENT's own scope — never the link-readable fallback,
  // which exists for reads. An unresolvable target reads as read-only, which
  // is what it is from here.
  const writer = writerFor(doc);
  const candidate = decl.scope === 'local' ? null : await getArtifactById(decl.target);
  const dataset = candidate && grantsOf(candidate) ? candidate : decl.scope === 'local' ? null : await getArtifactFor(writer, decl.target);
  if (decl.scope !== 'local') {
    if (!dataset) return { ok: false, reason: 'dataset_read_only' };
    if(grantsOf(dataset)){try{await grantContext(dataset,actor,{id:doc.id,editId:doc.edit_id});}catch(error){return {ok:false,reason:'policy_denied',detail:error instanceof Error?error.message:'Join this artifact to use its actions'};}}
    const refusal = await canWriteDataset(dataset, actor, {id:doc.id,editId:doc.edit_id});
    if (refusal) return { ok: false, reason: refusal };
    if (localTables !== undefined) return {ok: false, reason: 'invalid_sql', detail: 'Persistent mutations do not accept local table overrides'};
  }

  // Declared defaults ⊕ what the caller sent, restricted to declared scalars:
  // the same rule a query run follows, so a value the document never declared
  // cannot reach the statement.
  let flow: Dataflow = { values: content.values, queries: content.queries, mutations: content.mutations };
  try {flow=await resolveUserValues(flow,refLoaderForActor(writer));}catch(error){return {ok:false,reason:'invalid_sql',detail:error instanceof Error?error.message:'Invalid user binding'};}
  const bound = initialValues(flow);
  const paramTypes = scalarParamTypes(flow);
  for (const [k, v] of Object.entries(values)) {
    if (!(k in bound)) continue;
    // TYPE AT THE DOOR, as the read catalog already does. The statement is
    // planned and bound under the DECLARED type, so a value of another JS type
    // is not a statement the engine should be asked to make sense of — it is a
    // caller error, and the message names the parameter. `null` always clears.
    // An EMPTY string for a number, date, boolean or user Value is "no value" — what a cleared
    // input sends, and what `--param due=` means on a command line (coerceScalarInput reads it
    // the same way). A string Value keeps its empty string: '' is a string.
    const value = v === '' && paramTypes[k] !== 'string' ? null : v;
    if (!scalarMatches(value, paramTypes[k]!)) return { ok: false, reason: 'invalid_sql', detail: `parameter $${k} does not match its declared type` };
    bound[k] = value;
  }

  bound._me=actor.userId;
  let rowBinding: { columns: DatasetColumn[]; values: Record<string, Scalar> } | undefined;
  if (mutationUsesRow(decl.sql)) {
    if (!row) return { ok: false, reason: 'invalid_row', detail: 'this row mutation requires its original row snapshot' };
    const checked = await dryRunDataflow(flow, refLoaderForActor(writer), body);
    if (checked.kind === 'sql') return { ok: false, reason: 'invalid_row', detail: checked.details.join('; ') };
    const columns = checked.rowSchemas[name];
    if (!columns || Object.keys(row).length !== columns.length || columns.some((c) => {
      if (!Object.hasOwn(row, c.name)) return true;
      const value = row[c.name];
      return value !== null && (c.type === 'date' || c.type === 'timestamp' || c.type === 'user' ? typeof value !== 'string' : typeof value !== c.type);
    })) return { ok: false, reason: 'invalid_row', detail: 'row fields and scalar types must match the declared table result' };
    if (mutationUsesValue(decl.sql)) {
      if (!Object.hasOwn(values, '_value')) return { ok: false, reason: 'invalid_row', detail: 'cell mutations require _value' };
      // `$_value` is typed by the column its editor sits in, like a declared Value: an empty
      // string is "no value" for anything but text, and a value the column cannot hold is a
      // caller error named here, never a statement for the engine to make sense of.
      const valueType = checked.valueTypes[name];
      const cell = valueType && values._value === '' && valueType !== 'string' ? null : values._value;
      if (valueType && !scalarMatches(cell as Scalar, valueType)) return { ok: false, reason: 'invalid_row', detail: 'parameter $_value does not match the edited column\'s type' };
      bound._value = cell;
      if (valueType) paramTypes._value = valueType;
    } else if (Object.hasOwn(values, '_value')) {
      return { ok: false, reason: 'invalid_row', detail: 'this row action does not accept _value' };
    }
    rowBinding = { columns, values: row };
  } else if (row !== undefined || Object.hasOwn(values, '_value')) {
    return { ok: false, reason: 'invalid_row', detail: 'this mutation does not accept a row or _value' };
  }
  if (decl.scope === 'local') {
    try {
      // (The guest refusal that used to sit here now runs above, for every
      // scope and before the row snapshot is judged.)
      const tables = localTableOverrides(flow, localTables);
      const local = await runLocalStateMutation(flow, decl, {values: bound, tables}, {mutate:async input=>{
        const columns=input.table.columns.map(c=>c.constraints?.memberOf?{...c,constraints:{...c.constraints,memberOf:c.constraints.memberOf.map(ref=>ref==='current'?`ref:${doc.id}`:ref)}}:c);
        const out=await runMutation({...input,table:{...input.table,columns},params:{...input.params,_me:actor.userId}});
        if(!isQueryFailure(out))await validateUserWrites(await getDb(),columns,out.userWrites??[],actor.userId);
        return out;
      }}, rowBinding);
      return {ok: true, local};
    } catch (error) {
      return {ok: false, reason: 'invalid_sql', detail: error instanceof Error ? error.message : 'Local mutation failed'};
    }
  }
  const result = await mutateDataset(dataset!, actor, decl.sql, bound, { row: rowBinding, paramTypes, expectedAffected: decl.expectedAffected, source:!!decl.source, document:{id:doc.id,editId:doc.edit_id}, ...(receipt ? { receipt } : {}) });
  if (isMutationRefused(result)) return { ok: false, reason: result.reason, detail: result.detail, ...(result.code ? { code: result.code } : {}) };
  return { ok: true, dataset: result.row, affected: result.affected, rowCount: result.rowCount };
}

/**
 * The documents in the owner's scope that WRITE this dataset, with the
 * mutations they declare — what the share menu shows beside the toggle, so
 * turning writes off can say what will stop working. Same shape and scope as
 * `findDependents`, narrowed to declared writers.
 */
async function findWritersFor(actor: TokenActor, datasetId: string): Promise<Array<{ id: string; title: string | null; mutations: string[] }>> {
  const dependents = await findDependentsFor(actor, datasetId);
  const out: Array<{ id: string; title: string | null; mutations: string[] }> = [];
  for (const dep of dependents) {
    if (!dep.source) continue;
    const names = (declarationsForRow(dep)?.flow.mutations ?? []).filter((m) => m.target === datasetId).map((m) => m.name);
    if (names.length) out.push({ id: dep.id, title: dep.title, mutations: names });
  }
  return out;
}

/** Current stored dataset cells participate in the same owner-scoped deletion graph.
 * No persisted index: existing datasets and every write path are immediately covered.
 * Errors reading promised objects fail closed, rather than permitting unsafe deletion.
 */
async function findDependentsScoped(scope: Scope, refId: string): Promise<ArtifactRow[]> {
  const db = await getDb();
  const image=(await getArtifactById(refId))?.format==='image';
  const res = await artifactQuery<ArtifactRow>(db,
    `SELECT * FROM artifacts WHERE ${scope.where('$1')} AND ${image ? "format IN ('markup','dataset')" : "format = 'markup' AND meta::text LIKE $2"}`,
    image ? [scope.val] : [scope.val,`%"${refId}"%`],
  );
  const rows=res.rows as unknown as ArtifactRow[];
  const targets=new Set([refId]);
  const found=new Map<string,ArtifactRow>();
  for(const row of rows){
    if(row.format!=='dataset'||row.id===refId)continue;
    if((await storedMediaReferences(row)).has(refId)){targets.add(row.id);found.set(row.id,row);}
  }
  for(const row of rows){
    if(row.format!=='markup'||row.id===refId)continue;
    const refs=(row.meta as {refs?:Array<{id:string}>}).refs??[];
    if(refs.some(ref=>targets.has(ref.id)))found.set(row.id,row);
  }
  return [...found.values()];
}

export function findDependentsFor(actor: TokenActor, refId: string): Promise<ArtifactRow[]> {
  return findDependentsScoped(ownerScope(actor), refId);
}

/**
 * After a dataset/viz refresh: re-run reference validation for every dependent
 * against the NEW content. Warnings, never blocks: a data refresh
 * can't be stopped by a stale chart.
 */
export async function refreshWarningsFor(actor: TokenActor, updated: ArtifactRow): Promise<Array<{ id: string; title: string | null; details: string[] }>> {
  if (updated.format !== 'dataset' && updated.format !== 'viz') return [];
  const dependents = await findDependentsFor(actor, updated.id);
  if (dependents.length === 0) return [];
  const base = refLoaderForActor(actor);
  const load: RefLoader = async (id) => (id === updated.id ? rowToResolvedRef(updated) : base(id));
  const warnings: Array<{ id: string; title: string | null; details: string[] }> = [];
  for (const dep of dependents) {
    if (!dep.source) continue;
    // The SAME checks the publish door runs (refs, SQL dry run, chart bindings
    // against query columns) — so "which dependents broke" is answered by the
    // rule that admitted them.
    const checked = await checkDocumentData(dep.source, load);
    if (!checked.ok) warnings.push({ id: dep.id, title: dep.title, details: checked.details });
  }
  return warnings;
}

/**
 * The document's dataflow at render (or on a re-query): the `<Value>`/`<Query>`
 * declarations of `row.source`, run over the datasets its SQL names — each
 * resolved by the SAME ownership rule as refDataForRow (the doc's token, then
 * the owning account), so a query can read exactly what a `ref:` could and
 * nothing else. Returns null for a document that declares nothing.
 *
 * `values` overrides the declared defaults (a reader's current selections);
 * `only` restricts the run to those queries (the re-query path).
 */
export async function dataflowForRow(
  row: ArtifactRow,
  opts: DataflowRunOptions = {},
): Promise<RanDataflow | null> {
  if (!row.source) return null;
  // `viewer` absent is ANONYMOUS, deliberately — that is what the document's own
  // GET transport is, and it is the safe default for every caller that has no
  // session to hand over.
  const flow = declarationsForRow(row)?.flow;
  const members=(await (await getDb()).query<Row>(`SELECT user_id,joined_at::text FROM ${JOIN_RELATIONS} WHERE artifact_id=$1 AND status='accepted' ORDER BY joined_at,user_id`,[row.id])).rows;
  const result = flow ? await runDeclaredDataflow(flow, datasetResolverForRow(row, opts.viewer ?? null), {...opts,members}) : null;
  // A document NAMES people when a user-typed value or column reaches it, and
  // now also when it draws a <User> — which a document with no user data at all
  // may do (`<User userId="$_me" />`). The viewer's own id is added for both,
  // because the one person a page can always name is the one reading it.
  if(result&&(drawsPeople(row.source)||result.flow.values.some(v=>v.kind==='scalar'&&v.type==='user')||Object.values(result.state.tables).some(t=>t.columns.some(c=>c.type==='user')))) {
    const db=await getDb(), options:NonNullable<DataflowState['userOptions']>={}, ids=new Set<string>();
    const viewer=opts.viewer??null;
    if(viewer?.userId)ids.add(viewer.userId);
    const permitted=async(column:DatasetColumn)=>{
      const refs=column.constraints?.memberOf;
      if(!refs)return column;
      const allowed:string[]=[];
      for(const ref of refs) {
        const id=ref==='current'?row.id:ref.slice(4), scope=await getArtifactById(id);
        if(scope&&(scope.token_id===viewer?.tokenId||await canReadArtifact(scope,viewer?.userId?{userId:viewer.userId,email:viewer.email??null}:null)))allowed.push(`ref:${id}`);
      }
      return {...column,constraints:{...column.constraints,memberOf:allowed}};
    };
    const drawn=personColumnsDrawn(row.source);
    for(const [name,table] of Object.entries(result.state.tables))for(const column of table.columns) {
      if(column.type!=='user'&&!drawn.has(column.name))continue;
      if(column.type==='user')options[`${name}.${column.name}`]=await userOptions(db,await permitted(column),viewer?.userId??null);
      for(const item of table.rows)if(typeof item[column.name]==='string')ids.add(item[column.name] as string);
    }
    for(const value of result.flow.values)if(value.kind==='scalar'&&value.type==='user') {
      options[value.name]=await userOptions(db,await permitted({name:value.name,type:'user',constraints:value.constraints}),viewer?.userId??null);
      if(typeof result.state.values[value.name]==='string')ids.add(result.state.values[value.name] as string);
    }
    result.state.userOptions=options;
    result.state.people=await people(db,[...ids]);
  }
  if (result?.flow.mutations?.length) result.state.mutationAccess = await mutationAccessFor(row, result.flow, result.state, opts.viewer ?? null);
  return result;
}

/** Viewer capabilities use the same dataset ACL as execution; no authored permission expressions.
 * The preview analyzes the statement under the DECLARED param types too, so the button the page
 * draws and the write the click attempts are judged on one plan.
 *
 * A statement binding `$_me` additionally needs a PERSON, and a guest pressing
 * it would otherwise learn that from the raw refusal ("$_me requires a
 * logged-in user") after the click. That answer is decided last, on a
 * capability that is otherwise PERMITTED — "unavailable only because the viewer
 * is a guest" — so a dataset that refuses this actor for its own reasons keeps
 * saying so, and only the reader who could proceed by signing in is asked to.
 */
async function mutationAccessFor(doc: ArtifactRow, flow: Dataflow, state: DataflowState, viewer: RoleActor | null): Promise<Record<string,string|null>> {
  // ONE capability question for the whole document, asked once: may this
  // reader write as themselves here at all? A guest is answered exactly as an
  // anonymous reader is — with the code the page turns into `<SignIn>` — so the
  // button a guest sees is the door rather than a control that will refuse.
  const me: CapabilityActor = { userId: viewer?.userId ?? null, tokenId: viewer?.tokenId ?? null };
  const meRefusal = await can(me, 'write_as_me', doc) ? null : (await refusalFor(me, doc.id)).body.hint ?? SIGN_IN_REQUIRED;
  const guestOf = (m: {params: string[]}, answer: string|null): string|null =>
    answer === null && m.params.includes('_me') && meRefusal ? meRefusal : answer;
  const parsed = parseJsx(doc.source ?? '');
  const scopes = analyzeRowScopes(parsed.ok ? splitHelmet(parsed.nodes).body : []);
  const rowSchemaFor = (name: string): DatasetColumn[] | undefined => {
    const names = scopes.mutationTables[name] ?? [];
    const shapes = names.map(table => state.errors[table] ? undefined : state.tables[table]?.columns);
    const first = shapes[0];
    return first && shapes.every(shape => JSON.stringify(shape) === JSON.stringify(first)) ? first : undefined;
  };
  return Object.fromEntries(await Promise.all((flow.mutations??[]).map(async m=>{
    if(m.params.includes('_me') && meRefusal)return [m.name,meRefusal];
    if(m.scope==='local')return [m.name,guestOf(m,null)];
    const actor=viewer??{userId:null,tokenId:null};
    const candidate=await getArtifactById(m.target);
    const dataset=candidate&&grantsOf(candidate)?candidate:await getArtifactFor(writerFor(doc),m.target);
    if(dataset&&grantsOf(dataset)){
      try{await grantContext(dataset,actor,{id:doc.id,editId:doc.edit_id});}
      catch(error){return [m.name,!actor.userId?SIGN_IN_REQUIRED:error instanceof Error?error.message:'Join this artefact to use its actions'];}
    }
    if(!dataset||await canWriteDataset(dataset,actor,{id:doc.id,editId:doc.edit_id}))return [m.name,'This action requires dataset view access and a writable dataset with a matching data policy.'];
    if(!dataset.dataset_policy)return [m.name,guestOf(m,null)];
    try {
      const name=`ref_${dataset.id}`,catalog=catalogOf(dataset);
      const compiled=m.source&&catalog?compileStoredMutation(catalog,m.sql,name):null;
      const columns=compiled?.table.columns??dataset.meta.columns as DatasetColumn[];
      const policy=await mutationPolicy(dataset,actor,compiled?.table??{schema:'public',name:'rows'},{id:doc.id,editId:doc.edit_id});
      const rowColumns = mutationUsesRow(m.sql) ? rowSchemaFor(m.name) : undefined;
      if (mutationUsesRow(m.sql) && !rowColumns) return [m.name,'This action requires an available query result with a matching row schema.'];
      const valueType = rowColumns?.find(c => c.name === scopes.cellColumns[m.name])?.type;
      const out=await runMutation({table:{name,rows:[],columns},sql:compiled?.sql??m.sql,params:state.values,paramTypes:{...scalarParamTypes(flow),...(valueType?{_value:valueType}:{})},policy,policyPreview:true,
        ...(rowColumns?{row:{columns:rowColumns,values:Object.fromEntries(rowColumns.map(c=>[c.name,null]))}}:{})});
      return [m.name,guestOf(m,'error' in out?out.error:null)];
    }catch(error){return [m.name,error instanceof Error?error.message:'Dataset policy does not permit this action.'];}
  })));
}

/**
 * The document's declarations, WITHOUT running anything — the reader's path.
 *
 * Same answer as dataflowForRow minus the expensive half: no dataset is
 * loaded, no SQL is executed, nothing is inlined. The document is served at
 * once and fetches its own rows through the transport its island already
 * names. On a production dashboard this was the difference between a ~100ms
 * render and an ~8ms one, and 231 KB of a 365 KB page.
 */
export function declarationsForRow(row: Pick<ArtifactRow, 'source'> & Partial<Pick<ArtifactRow, 'meta'>>): StoryIslandDataflow | null {
  if (!row.source) return null;
  try {
    const { flow } = readParsedArtifactMetadata(row.meta, row.source);
    return isEmptyDataflow(flow) ? null : { flow };
  } catch { return null; }
}

/**
 * A document DRAWS A PERSON — a conservative hint, not a parse.
 *
 * `<User …>`, `<UserImage …>` and `<UserHandle …>` are the only spellings the
 * markup validator admits for the three person components, so a document that
 * draws one always matches; a match inside a string or a comment costs exactly
 * one indexed lookup and nothing else. It is deliberately a hint rather than a
 * parse because the answer is only used to decide whether to SPEND a query,
 * never to decide what a viewer may see.
 */
const drawsPeople = (source: string | null | undefined): boolean => /<User(?:Image|Handle)?[\s/>]/.test(source ?? '');
/**
 * The row columns a document draws a person FROM — `<User userId="$_row.person">`,
 * `<UserImage …>` or `<UserHandle …>` — whatever the query typed them as. A
 * computed column (a join's `person`, a group-by's `who`) reaches DuckDB as
 * text, so it is not a `user` column, yet every id in it is a person the page
 * will name; without this, anyone who appears only there renders "Unknown person".
 */
const personColumnsDrawn = (source: string | null | undefined): Set<string> =>
  new Set([...(source ?? '').matchAll(/<User(?:Image|Handle)?\b[^>]*\buserId=["']\$_row\.([A-Za-z_][A-Za-z0-9_]*)["']/g)].map((m) => m[1]!));

/**
 * WHO IS READING, as the document may show them (lib/story-runtime/contract
 * StoryViewer): the viewer's own account id — `$_me` — and, only for a document
 * that draws a person, their card.
 *
 * The card comes from the SAME `people` lookup a DataTable cell has always
 * used, so nothing new about anyone is exposed: one row, by id, for the person
 * who is already logged in and asking. A guest gets null and no query at all,
 * and a document that never names a person pays nothing beyond the id it
 * already had in hand.
 */
export async function viewerIdentityFor(
  row: Pick<ArtifactRow, 'source'>,
  userId: string | null | undefined,
): Promise<StoryViewer | null> {
  if (!userId) return null;
  if (!drawsPeople(row.source)) return { id: userId };
  try {
    const cards = await people(await getDb(), [userId]);
    return { id: userId, card: cards[userId] ?? null };
  } catch { return { id: userId }; }
}

interface DataflowRunOptions {
  members?:Row[];
  /** Request-owned admission, rerun before cache hits, after waits and SQL. */
  authorize?: () => Promise<void>;
  signal?: AbortSignal;
  localTables?: Record<string, Row[]>;
  /**
   * WHO IS READING. Only a folder's children table varies with it today, and
   * that is exactly the point: reach is the document owner's, the rows are the
   * viewer's. Absent = anonymous.
   */
  viewer?: RoleActor | null;
  values?: Record<string, Scalar>;
  only?: Iterable<string>;
  /** A window of one query (a table reading past the cap). */
  page?: { name: string; offset: number; limit: number; sort?: { col: string; dir: 'asc' | 'desc' } };
}

/**
 * Resolve a `ref_<id>` to the TABLE the dataflow registers, or null.
 *
 * It answers a table rather than a row because there are two kinds of table
 * now and they are reached differently: a DATASET's rows come out of the
 * object store, and a FOLDER's children are computed per VIEWER. Keeping the
 * viewer in the resolver's closure is what stops the two questions collapsing
 * — REACH (may this document read that id at all) is the document owner's,
 * while WHICH ROWS is the person reading it, and answering both with one
 * identity would hand a stranger the owner's private children.
 */
type DatasetResolver = (id: string) => Promise<RefTable | null>;

/** What a resolved ref contributes to the run: rows and their shape. */
type RefTable = { rows: Row[]; columns: DatasetColumn[]; catalog?:import('@/lib/datasets/types').DatasetCatalog };

/** A resolved ref row → its table, under the viewer whose run this is. */
async function tableForRef(r: ArtifactRow | null, viewer: RoleActor | null, document?:ArtifactRow): Promise<RefTable | null> {
  if (!r) return null;
  if (r.format === 'folder') {
    return childrenTableFor(r, { userId: viewer?.userId ?? null, email: viewer?.email ?? null, tokenId: viewer?.tokenId ?? null });
  }
  if (r.format !== 'dataset') return null; // wrong kind → the query reports the missing table
  if(grantsOf(r)&&!(await grantsPermitRead(r,viewer??{userId:null,tokenId:null},document)))return null;
  const catalog=catalogOf(r);
  if(!catalog)return null; // missing storage is unavailable data, never an empty computed source
  const m = (r.meta ?? {}) as { columns?: DatasetColumn[] };
  try {
    return { rows: await loadDatasetRows(r), columns: m.columns ?? [], catalog };
  } catch { return null; } // the query reports the missing table
}

/** A document's own scope: the token that published it, its owning account, then
 * anything link-readable — render-time must resolve whatever the publish door
 * admitted (getLinkReadableArtifact), or an accepted ref serves broken. The
 * VIEWER is separate and rides through: reach is the document's, rows are theirs. */
const datasetResolverForRow = (row: ArtifactRow, viewer: RoleActor | null): DatasetResolver => async (id) =>
  tableForRef(
    await getArtifactById(id).then(async dataset=>dataset&&grantsOf(dataset)?dataset:(await getArtifactFor(writerFor(row),id))??(await getLinkReadableArtifact(id))),
    viewer, row,
  );

/** A bearer/session actor's scope — the editor running a DRAFT's queries. Reach and viewer are the same person here. */
export const datasetResolverForActor = (actor: TokenActor): DatasetResolver => async (id) =>
  tableForRef((await getArtifactFor(actor, id)) ?? (await getLinkReadableArtifact(id)), { userId: actor.userId, tokenId: actor.tokenId });

/**
 * What a document DECLARES: its `<Value>`s, `<Query>`s and `<Mutation>`s, from
 * the source alone. Null when it declares nothing.
 *
 * Mutations ride along so the runtime can offer them (a `<Button run>` needs
 * the name and its params); they are never RUN here — a write happens on
 * demand, through /a/<id>/mutate, never at render.
 */
export function declarationsOf(source: string): Dataflow | null {
  const parsed = parseJsx(source);
  if (!parsed.ok) return null;
  const { content } = splitHelmet(parsed.nodes);
  const flow: Dataflow = { values: content.values, queries: content.queries, ...(content.mutations.length ? { mutations: content.mutations } : {}) };
  return isEmptyDataflow(flow) ? null : flow;
}

/**
 * Run the `<Value>`/`<Query>` declarations of any markup SOURCE (stored or a
 * draft) over the datasets `resolve` admits. Null when it declares nothing;
 * a dataset that does not resolve reads as a missing table in that query.
 */
export async function runDocumentDataflow(
  source: string,
  resolve: DatasetResolver,
  opts: DataflowRunOptions = {},
): Promise<RanDataflow | null> {
  const flow = declarationsOf(source);
  if (!flow) return null;
  return runDeclaredDataflow(flow, resolve, opts);
}

async function runDeclaredDataflow(flow: Dataflow, resolve: DatasetResolver, opts: DataflowRunOptions): Promise<RanDataflow> {
  // Materialize a one-shot iterable once; selection and execution share it.
  opts = { ...opts, ...(opts.only ? { only: [...opts.only] } : {}) };

  const datasets: DatasetTables = {};
  for (const id of datasetRefsInDataflow({ ...flow, queries: selectedQueries(flow, opts) ?? [] })) {
    // Unresolvable, or a kind that is not a table → the query reports the
    // missing table, which is a query error rather than a render failure.
    const table = await resolve(id);
    if (table) datasets[id] = table;
  }
  flow=await resolveUserValues(flow,async id=>datasets[id]);
  const usedSources = new Map<string, string>();
  const state = await runDataflow(flow, datasets, {members:opts.members,userId:opts.viewer?.userId??null, values: opts.values, only: opts.only, page: opts.page, localTables: opts.localTables,
    sourceInput:async id=>{
      // sourceQuery authorizes first and records this same snapshot for the
      // final access check. Only a physical stored public.rows table qualifies;
      // remote catalogs and model SQL retain their query execution boundary.
      const table=datasets[id] as RefTable | undefined;
      if(!table)return undefined;
      if(!table.catalog)return table;
      if(table.catalog.kind!=='stored')return undefined;
      const stored=table.catalog.tables.find(t=>t.schema==='public'&&t.name==='rows');
      if(stored?.legacyContent)return {rows:await loadDatasetRows({content:stored.legacyContent,meta:{}}),columns:stored.columns};
      if(!stored?.objectKey||stored.sql||stored.source||stored.modelCellId)return undefined;
      return {rows:await loadDatasetRows({content:'',meta:{objectKey:stored.objectKey}}),columns:stored.columns};
    },
    sourceQuery:async(q,values,page)=>{
      const table = datasets[q.source!] as RefTable | undefined;
      if (!table) throw new Error(`Source ref:${q.source} is unavailable`);
      const catalog = table.catalog;
      if (!catalog) {
        usedSources.set(q.source!, JSON.stringify(table));
        return queryRows(table, q.sql, values, page);
      }
      usedSources.set(q.source!, JSON.stringify(catalog));
      return executeCatalog(catalog,q.sql,values,{datasetId:q.source!,limit:page?.limit,offset:page?.offset,sort:page?.sort,signal:opts.signal,paramTypes:scalarParamTypes(flow),authorize:async()=>{
        await opts.authorize?.();
        const current=await resolve(q.source!);
        if(!current || JSON.stringify((current as RefTable).catalog)!==JSON.stringify(catalog))throw new DatasetError('Dataset source is unavailable',404);
      }});
    },
  });
  // Per-query failures are deliberately isolated by runDataflow. Admission is
  // not a query error: q1's rows must not escape if access changes while q2
  // waits. Recheck every used source, not merely the last query to finish.
  for (const [id, snapshot] of usedSources) {
    const current = await resolve(id);
    if (!current || JSON.stringify(current.catalog ?? current) !== snapshot) throw new DatasetError('Dataset source is unavailable',404);
  }
  await opts.authorize?.();
  return { flow, state };
}

/**
 * The dataset ids a document's DATA depends on — everything its queries read
 * plus everything its mutations write. What the live stream subscribes to, so
 * a write anywhere in that set wakes this document's readers
 * (app/a/[id]/events). Validated against the current source on every read,
 * because an edit can change what a document reads. Selection never narrows
 * these subscriptions, and mutation targets remain included.
 */
export function datasetsForDocument(document: string | (Pick<ArtifactRow, 'source'> & Partial<Pick<ArtifactRow, 'meta'>>) | null | undefined): string[] {
  const source = typeof document === 'string' ? document : document?.source;
  if (!source) return [];
  let flow: Dataflow | null;
  try { flow = typeof document === 'string' ? declarationsOf(source) : readParsedArtifactMetadata(document!.meta, source).flow; }
  catch { return []; }
  if (!flow) return [];
  return [...new Set([...datasetRefsInDataflow(flow), ...mutationTargets(flow)])];
}


/** Resolve an admitted asset using the document owner's normal reference scope. */
export async function referencedArtifactForRow(row: ArtifactRow, id: string): Promise<ArtifactRow | null> {
  const refs = (row.meta as { refs?: Array<{ id: string }> }).refs ?? [];
  if (!refs.some((ref) => ref.id === id)) return null;
  return (await getArtifact(row.token_id, id))
    ?? (row.user_id ? await getArtifactByUser(row.user_id, id) : null)
    ?? (await getLinkReadableArtifact(id));
}

/** Build the render-time RefDataMap for a jsx artifact: recipes → parsed
 * template, images → their /a URL. (Datasets: see dataflowForRow.) */
export async function refDataForRow(
  row: ArtifactRow,
  opts: { capture?: boolean } = {},
): Promise<import('@/lib/story/ref-data').RefDataMap> {
  const meta = row.meta as { refs?: Array<{ id: string; kind: string }> };
  const out: import('@/lib/story/ref-data').RefDataMap = {};
  // A dataset a <Query> reads is a ref (ownership, dependents) but NOT page
  // data: its rows go through the engine (dataflowForRow) and only the query's
  // RESULT reaches the document.
  for (const ref of meta.refs ?? []) {
    if (ref.kind === 'dataset') continue;
    // Resolve by the doc's token first, then — for a user-owned doc — by the
    // account, then anything link-readable. A signed-in human's docs and their
    // pasted images can sit under DIFFERENT tokens of the same user (the doc on
    // a claimed agent token, the image on the account's 'web' token), and the
    // widened publish door admits any public/unlisted asset besides — whatever
    // it admitted, this must resolve, or the accepted image renders broken.
    const r = await referencedArtifactForRow(row, ref.id);
    if (!r) continue; // deleted ref → the embed degrades to its fallback
    if (r.format === 'viz') {
      try { out[r.id] = { kind: 'viz', recipe: JSON.parse(r.content) }; } catch { /* skip */ }
    } else if (r.format === 'image') {
      out[r.id] = imageRefData(r,opts.capture);
    } else if (r.format === 'file') {
      out[r.id]={kind:'file',url:imageRawUrl(r.id,r.version)};
    } else if (r.format === 'pdf') {
      // What the CARD says: where the file is, what it is called, how big it is
      // and how long. The name is the artifact's title (the author's, or the
      // one the importer derived from the URL), never the object key.
      const pm = r.meta as { bytes?: unknown; pages?: unknown } | null;
      out[r.id] = {
        kind: 'pdf',
        url: pdfRawUrl(r.id, r.version),
        name: displayTitle(r),
        bytes: typeof pm?.bytes === 'number' ? pm.bytes : 0,
        ...(typeof pm?.pages === 'number' ? { pages: pm.pages } : {}),
      };
    }
  }
  return out;
}
