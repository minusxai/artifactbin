/**
 * THE ARTIFACTS TABLE, as statements see it: the row type, the scopes every scoped statement runs
 * under, and the trash gate. It imports nothing from this module but the editor policy, so every
 * other file (access, the row lookups, the write path) can stand on it without a cycle.
 */
import { ACCOUNT_REACH_SQL, type TokenActor } from '@/lib/accounts';
import type { StoredDocument } from '../document';
import { hasDocumentEditorAccess } from './document-policy';
import { shareRolesAtLeast, type ArtifactFormat, type ArtifactRole, type DatasetAccess, type ShareEntry, type ShareRole, type Visibility } from '@artifactbin/contracts';

export interface ArtifactRow {
  document?:StoredDocument|null;
  open_annotations?:number;
  id: string;
  token_id: string;
  /** Owner account; NULL until the creating token is claimed. */
  user_id: string | null;
  group_id?: string | null;
  creator_user_id?: string | null;
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
 * WHO owns the row, WITHOUT the trash gate — for lib/trash alone, which reads
 * trashed rows on purpose (the listing, restore). Every other
 * caller wants `ownerScope`, which is this with the gate composed in.
 */
export const groupMemberPredicate = (user:string, role?:'editor', alias='artifacts') => `EXISTS (SELECT 1 FROM group_members gm JOIN groups g ON g.id=gm.group_id WHERE gm.group_id=${alias}.group_id AND gm.user_id=${user}${role ? " AND gm.role='editor'" : ''} AND g.deleted_at IS NULL)`;

export const ownerPredicate = ({ tokenId, userId, groupId }: TokenActor): Scope =>
  groupId ? {where:p=>`group_id = ${p}`,val:groupId} : userId ? { where: (p) => `((group_id IS NULL AND user_id = ${p}) OR ${groupMemberPredicate(p,'editor')})`, val: userId } : { where: (p) => `group_id IS NULL AND user_id IS NULL AND token_id = ${p}`, val: tokenId };

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
 * for the statement and for the page (@artifactbin/contracts shareRolesAtLeast).
 *
 * An anonymous token has no account to be named through, so it narrows to
 * bare ownership.
 */
const scopeAtLeast = (actor: TokenActor, min: ArtifactRole): Scope =>
  actor.userId
    ? live({ where: (p) => `(${ownerPredicate(actor).where(p)} OR (${ACCOUNT_REACH_SQL(p)} AND (${SHARE_PREDICATE(shareRolesAtLeast(min), p)} OR ${LINK_PREDICATE(min)}${hasDocumentEditorAccess(actor) ? " OR artifacts.format = 'markup'" : ''})))`, val: actor.userId })
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

/** Group viewers may observe comment feeds without gaining annotation writes. */
export const commentMonitorScope = (actor:TokenActor):Scope => {
 const scope=annotationScope(actor);
 return actor.userId?{where:p=>`(${scope.where(p)} OR (${LIVE_ARTIFACT_SQL} AND ${groupMemberPredicate(p)}))`,val:scope.val}:scope;
};

/** The document author's identity resolves its declared data references, never a viewer's write authority. */
export const writerFor = (doc: Pick<ArtifactRow, 'token_id' | 'user_id'> & Partial<Pick<ArtifactRow,'group_id'>>): TokenActor => ({ tokenId: doc.token_id, userId: doc.user_id, groupId:doc.group_id ?? null });
