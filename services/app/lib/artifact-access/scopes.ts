/**
 * THE ACCESS RULE IN SQL, beside the row it reads: the artifacts row type, the scopes every scoped statement runs
 * under (ownership, the share roles and the link, the host's document-editor grant) and the trash gate composed
 * into each. `./access` is the same rule in JavaScript; the two are kept here together so "which roles may edit"
 * has one home for the statement and for the page.
 *
 * Known readers BELOW this module, which cannot import it by layering and keep their own SQL:
 * lib/accounts/{users,guest-owner,testusers} (account merges and cascades), lib/notifications/events
 * (recipient joins) and lib/datasets/user-fields.
 */
import { ACCOUNT_REACH_SQL } from '@/lib/user-kinds';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { groupAdminSql, groupReachSql, reachedGroupsSql } from '@/lib/groups';
import type {DocumentGraph} from '@artifactbin/contracts/document-update';
import { shareRolesAtLeast, type ArtifactRole, type DatasetAccess, type ShareEntry, type ShareRole, type Visibility } from '@artifactbin/contracts/sharing';
import type { ArtifactFormat } from '@artifactbin/contracts/artifact-format';

export interface ArtifactRow {
  document?:DocumentGraph|null;
  open_annotations?:number;
  id: string;
  token_id: string | null;
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
  /** A group's sign-in as that writer (lib/accounts `GroupPrincipal`): the group; null for a person or a token. */
  actor_group_id?: string | null;
  /** Who published the head's content, for the removed page schedules: no longer written or read. */
  content_publisher_user_id: string | null;
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
 *  - sharingScope — editorScope without the link and the document-editor
 *                  grant: who changes who reaches the row (below).
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
/**
 * A GROUP SHARE holding one of `roles` that reaches the account: a share to any live group its direct memberships
 * climb to (lib/groups hierarchy), so a share to Finance reaches a Retail member and never the other way round.
 * The mirror of ./access-facts `groupShareRole`.
 */
const GROUP_SHARE_PREDICATE=(roles:readonly string[],param:string)=>`(EXISTS (SELECT 1 FROM users gu WHERE gu.id=${param} AND gu.kind='account') AND EXISTS (SELECT 1 FROM artifact_group_shares gs WHERE gs.artifact_id=artifacts.id AND gs.role IN (${roles.map(role=>`'${role}'`).join(',')}) AND gs.group_id IN (${reachedGroupsSql(param)})))`;

export const SHARE_PREDICATE = (roles: readonly string[], param: string) =>
  `(${GROUP_SHARE_PREDICATE(roles,param)} OR EXISTS (SELECT 1 FROM artifact_shares s
           WHERE s.artifact_id = artifacts.id AND s.role IN (${roles.map((r) => `'${r}'`).join(', ')})
             AND (s.user_id = ${param} OR (s.user_id IS NULL AND s.email = (SELECT email FROM users WHERE id = ${param})))))`;

/**
 * WHO owns the row, WITHOUT the trash gate — for lib/trash alone, which reads
 * trashed rows on purpose (the listing, restore). Every other
 * caller wants `ownerScope`, which is this with the gate composed in.
 */
/**
 * A group-owned row's members. `'admin'`: an admin of the owning group, directly or through an ancestor (identity's
 * `group_admins`, lib/groups `groupAdminSql`), its owner. Without a role: the owning group's AUDIENCE, a direct member of it or of any descendant (./access-facts
 * `groupAudience`), the same subtree a share to that group reaches, and its admins, who read what they own.
 */
export const groupMemberPredicate = (user:string, role?:'admin', alias='artifacts') => role==='admin'
  ? groupAdminSql(user,`${alias}.group_id`)
  : `(${alias}.group_id IN (${reachedGroupsSql(user)}) OR ${groupAdminSql(user,`${alias}.group_id`)})`;

export const ownerPredicate = ({ tokenId, userId, groupId, principalGroup }: AccessActor): Scope =>
  // A group's sign-in owns nothing (./access `ownsArtifact`), so no owner-only statement ever matches for it.
  principalGroup ? {where:p=> `(${p}::text IS NULL AND FALSE)`,val:''} : groupId ? {where:p=>`group_id = ${p}`,val:groupId} : userId ? { where: (p) => `((group_id IS NULL AND user_id = ${p}) OR ${groupMemberPredicate(p,'admin')})`, val: userId } : { where: (p) => `group_id IS NULL AND user_id IS NULL AND token_id = ${p}`, val: tokenId ?? '' };

export const ownerScope = (actor: AccessActor): Scope => live(ownerPredicate(actor));

/** One read-access fence for policy actions: sharing remains the only audience. Placeholders are the caller's. */
export function policyReaderSql(user = '$13', token = '$14'): string {
  return `(artifacts.visibility<>'private' OR (artifacts.group_id IS NULL AND (artifacts.user_id=${user} OR (artifacts.user_id IS NULL AND artifacts.token_id=${token}))) OR ${groupMemberPredicate(user)}
   OR ${GROUP_SHARE_PREDICATE(['viewer','commenter','editor'],user)} OR EXISTS (SELECT 1 FROM artifact_shares policy_reader WHERE policy_reader.artifact_id=artifacts.id
     AND (policy_reader.user_id=${user} OR (policy_reader.user_id IS NULL AND
       policy_reader.email=(SELECT email FROM users WHERE id=${user})))))`;
}

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
 * The host's document-editor grant, in SQL: what a link could reach, for page documents only — the mirror of
 * ./access `documentEditorReaches`. It grants `editor`, which reaches every `min` it is asked
 * for, and only ever inside ACCOUNT_REACH_SQL (scopeAtLeast below).
 */
const DOCUMENT_EDITOR_PREDICATE = "(artifacts.format = 'html' AND artifacts.visibility <> 'private')";

/**
 * The SQL MIRROR of the lattice: the owner, an account holding any share role
 * that reaches `min`, or the LINK. One generator rather than a hand-written
 * predicate per door, so "which roles may edit" is answered in the same place
 * for the statement and for the page (@artifactbin/contracts shareRolesAtLeast).
 *
 * An anonymous token has no account to be named through, so it narrows to
 * bare ownership.
 */
/**
 * A GROUP'S SIGN-IN (lib/accounts `GroupPrincipal`), the mirror of ./access-facts `groupPrincipalFacts`: what a person
 * holds whose only relationship is a direct membership of the group `p` at its level. At editor level the group's own
 * pages to edit; its audience (pages the group or an ancestor owns) to read; group shares to it or an ancestor; the
 * link in full. No ownership, no named share, no document-editor grant, no other group.
 */
const groupPrincipalScope = (principal: NonNullable<AccessActor['principalGroup']>, min: ArtifactRole, link: boolean): Scope => live({
  val: principal.id,
  where: (p) => `(${principal.role === 'editor' ? `(artifacts.group_id = ${p} AND EXISTS (SELECT 1 FROM groups pg WHERE pg.id = ${p} AND pg.deleted_at IS NULL))` : 'FALSE'}
    OR ${min === 'viewer' ? `artifacts.group_id IN (${groupReachSql(p)})` : 'FALSE'}
    OR EXISTS (SELECT 1 FROM artifact_group_shares gs WHERE gs.artifact_id = artifacts.id AND gs.role IN (${shareRolesAtLeast(min).map((r) => `'${r}'`).join(', ')}) AND gs.group_id IN (${groupReachSql(p)}))
    ${link ? `OR ${LINK_PREDICATE(min)}` : ''})`,
});

const scopeAtLeast = (actor: AccessActor, min: ArtifactRole, link = true): Scope =>
  actor.principalGroup ? groupPrincipalScope(actor.principalGroup, min, link) : actor.userId
    ? live({ where: (p) => `(${ownerPredicate(actor).where(p)} OR (${ACCOUNT_REACH_SQL(p)} AND (${groupMemberPredicate(p, 'admin')} OR ${min==='viewer'?groupMemberPredicate(p):'FALSE'} OR ${SHARE_PREDICATE(shareRolesAtLeast(min), p)}${link ? ` OR ${LINK_PREDICATE(min)}` : ''}${link && actor.documentEditor ? ` OR ${DOCUMENT_EDITOR_PREDICATE}` : ''})))`, val: actor.userId })
    : ownerScope(actor);

export const editorScope = (actor: AccessActor): Scope => scopeAtLeast(actor, 'editor');

/**
 * WHO CHANGES WHO REACHES THE ROW — its visibility, link role, share list, dataset access and dataset policy: the
 * editor lattice WITHOUT the link and without the host's document-editor grant. The owner, a named editor (by share or
 * group share), a group Editor or Admin, a group's sign-in at Editor on its own group's pages; never someone who holds
 * an editor link, who would otherwise name themselves an editor for good. The mirror of ./access `managesSharing`.
 */
export const sharingScope = (actor: AccessActor): Scope => scopeAtLeast(actor, 'editor', false);

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
/** Account reactions follow read admission, independently of permission to write words. */
export const reactionScope = (actor: AccessActor): Scope => scopeAtLeast(actor, 'viewer');

export const annotationScope = (actor: AccessActor): Scope => scopeAtLeast(actor, 'commenter');

/** Group viewers may observe comment feeds without gaining annotation writes. */
export const commentMonitorScope = (actor:AccessActor):Scope => {
 const scope=annotationScope(actor);
 // A group's sign-in observes as its twin does (a direct member of its group alone): its commenter reach, and the
 // audience and group shares of its group and ancestors; holding a link at viewer level observes nothing.
 if(actor.principalGroup)return {where:p=>`(${scope.where(p)} OR (${LIVE_ARTIFACT_SQL} AND (artifacts.group_id IN (${groupReachSql(p)}) OR EXISTS (SELECT 1 FROM artifact_group_shares gs WHERE gs.artifact_id=artifacts.id AND gs.group_id IN (${groupReachSql(p)})))))`,val:scope.val};
 return actor.userId?{where:p=>`(${scope.where(p)} OR (${LIVE_ARTIFACT_SQL} AND (${groupMemberPredicate(p)} OR ${GROUP_SHARE_PREDICATE(['viewer','commenter','editor'],p)})))`,val:scope.val}:scope;
};

/** The document author's identity resolves its declared data references, never a viewer's write authority. */
export const writerFor = (doc: Pick<ArtifactRow, 'token_id' | 'user_id'> & Partial<Pick<ArtifactRow,'group_id'>>): AccessActor => ({ ...identityForUser(doc.user_id, doc.token_id), groupId: doc.group_id ?? null });
