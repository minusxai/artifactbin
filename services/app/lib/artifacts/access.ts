import { getArtifactById } from './store';
import type { StoredDocument } from '../story/document/index';
import { grantsOf, grantsPermitRead, grantsPermitWrite, type GrantDocument } from '../datasets/policy/grants';
import { hasDocumentEditorAccess, type VerifiedAccount } from './document-policy';
import { ACCOUNT_REACH_SQL, isLinkOnlyActor, userKindOf } from '@/lib/accounts/user-kinds';
import { catalogOf } from '@/lib/datasets/catalog';
import { getDb, type Queryable } from '../platform/db';
import { type ArtifactFormat } from '../story/document/input';
import { canUseDataPolicy } from '@/lib/datasets/policy';
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

export interface ArtifactRow {
  document?:StoredDocument|null;
  open_annotations?:number;
  /**
   * Not a column: set only on a SERVED row (lib/migrate/sqlite/stored
   * inCurrentSyntax) written for the previous query engine and not
   * convertible without a person. Its dataflow is {@link unrunnableDataflow}.
   */
  previousEngine?: true;
  id: string;
  token_id: string;
  /** Owner account; NULL until the creating token is claimed. */
  user_id: string | null;
  title: string | null;
  description: string | null;
  format: ArtifactFormat;
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
export const SHARE_PREDICATE = (roles: readonly string[], param: string) =>
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

export const ownerScope = (actor: TokenActor): Scope => live(ownerPredicate(actor));

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

// ── Writable datasets ────────────────────────────────────────────────────────


/** Why a write may not happen. Each names the fix; none is an existence oracle. */
export type WriteRefusal = 'not_a_dataset' | 'dataset_read_only';

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
export const writerFor = (doc: Pick<ArtifactRow, 'token_id' | 'user_id'>): TokenActor => ({ tokenId: doc.token_id, userId: doc.user_id });
