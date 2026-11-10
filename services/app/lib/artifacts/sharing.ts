import {groupQuota,recordGroupMutation,GroupError,getGroupRole,subtreeMemberIds} from '../groups';
import { ownerScope,editorScope, type ArtifactRow } from '@/lib/artifact-access';
import { notifyArtifactSql } from './table';
import type { AccessActor } from '@/lib/accounts';
import { getArtifactFor } from './rows';
import { writeShares } from './store';
import { artifactQuery } from './document';
import { ALLOW_PUBLIC_VISIBILITY, getDb, actorSubject, emit } from '../platform';
import { type DatasetAccess, type GroupShare, type GroupShareRole, type ShareEntry, type ShareRole, type SharingPatch, type Visibility } from '@artifactbin/contracts';

// ── Sharing (the private tier's ACL surface) ─────────────────────────────────

export interface SharingState {
  visibility: Visibility;
  /** Deployment policy: public listing is an operator opt-in. */
  canPublic: boolean;
  /** What the link grants — the general-access role beside the general-access tier. */
  linkRole: ShareRole;
  /** The named people, by email, with their role — sorted by email. */
  shares: ShareEntry[];
  groupShares?:GroupShare[];
  /** Datasets: the write ACL, and the documents that would stop working if it were closed. */
  access?: DatasetAccess;
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
export async function getSharingFor(actor: AccessActor, id: string): Promise<SharingState | null> {
  const db = await getDb();
  const row = await getArtifactFor(actor, id);
  if (!row) return null;
  const shares = await db.query<ShareEntry>(
    'SELECT email, role FROM artifact_shares WHERE artifact_id = $1 ORDER BY email',
    [id],
  );
  return {
    visibility: row.visibility,
    canPublic: ALLOW_PUBLIC_VISIBILITY,
    linkRole: (row.link_role ?? 'viewer') as ShareRole,
    shares: shares.rows,
    groupShares:(await db.query<GroupShare>("SELECT jsonb_build_object('id',g.id,'handle',g.handle,'name',g.name,'description',g.description,'role',m.role) AS group,s.role FROM artifact_group_shares s JOIN groups g ON g.id=s.group_id LEFT JOIN group_members m ON m.group_id=g.id AND m.user_id=$2 WHERE s.artifact_id=$1 AND g.deleted_at IS NULL ORDER BY g.handle",[id,actor.userId])).rows,
    canPrivate: !!(row.user_id||row.group_id),
    ...(row.format === 'dataset'
      ? { access: row.access, writtenBy: [] }
      : {}),
  };
}

/**
 * Editor-access update of an artifact's ACL. `shares` is FULL-REPLACE (the UI
 * always sends the whole list — idempotent, no add/remove protocol). Emails
 * are normalized to lowercase and collapsed — the LAST role given for an
 * address wins; the route validates shape and role names upstream.
 */
export async function updateSharingFor(actor: AccessActor, id: string, patch: SharingPatch): Promise<SharingState | null> {
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
      await tx.query(`UPDATE artifacts SET access = $2 WHERE id = $1 AND format = 'dataset'`, [id, patch.access]);
    }
    // Visibility, link role and access are fenced by the sharing revision (lib/artifacts state), so a change moves it.
    const before = owned.rows[0];
    if (patch.visibility && patch.visibility !== before.visibility || patch.linkRole && patch.linkRole !== (before.link_role ?? 'viewer') || patch.access && before.format === 'dataset' && patch.access !== before.access) {
      await tx.query('UPDATE artifacts SET sharing_revision=$2 WHERE id=$1', [id, (before.sharing_revision ?? 0) + 1]);
    }
    if(patch.shares!==undefined)await writeShares(tx,id,patch.shares,before.sharing_revision??0);
    // Dataset subscribers must re-read capabilities even when rows/version
    // have not changed. The existing data wakeup already refreshes queries.
    await tx.query(`SELECT ${notifyArtifactSql('id', 'edit_id')} FROM artifacts WHERE id = $1`, [id]);
    const row = owned.rows[0];
    const shares = await tx.query<ShareEntry>('SELECT email, role FROM artifact_shares WHERE artifact_id=$1 ORDER BY email',[id]);
    return {
      visibility: patch.visibility ?? row.visibility,
      canPublic: ALLOW_PUBLIC_VISIBILITY,
      linkRole: patch.linkRole ?? row.link_role ?? 'viewer',
      shares: shares.rows,
      canPrivate: !!(row.user_id||row.group_id),
      ...(row.format === 'dataset' ? {access:patch.access ?? row.access} : {}),
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

/** Separate group ACL: full-replace email edits never erase these rows. Governance, not shared edit access. */
export async function setArtifactGroupShare(actor:AccessActor,id:string,groupId:string,role:GroupShareRole|null):Promise<{changed:boolean}|null>{
 if(!actor.userId) return null;
 if(role!==null&&!['viewer','commenter','editor'].includes(role))throw new GroupError('invalid_role');
 const db=await getDb();
 return db.transaction(async tx=>{
  // The global lock order (lib/artifact-access locks.ts): the artifact, then its group share, then the groups (the
  // target membership and the governing one), so a page write's guard and this edit never wait on each other.
  const observed=(await tx.query<{group_id:string|null}>('SELECT group_id FROM artifacts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE NOWAIT',[id])).rows[0];
  if(!observed)return null;
  const previous=(await tx.query<{role:string}>('SELECT role FROM artifact_group_shares WHERE artifact_id=$1 AND group_id=$2 FOR UPDATE',[id,groupId])).rows[0]?.role??null;
  const groups=[...new Set([groupId,...(observed.group_id?[observed.group_id]:[])])].sort();
  const locked=await tx.query('SELECT id FROM groups WHERE id=ANY($1::text[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE NOWAIT',[groups]);
  if(locked.rows.length!==groups.length||!await getGroupRole(actor.userId,groupId,tx))throw new GroupError('share_refused',403);
  const scope=ownerScope(actor);
  const row=(await tx.query<ArtifactRow>(`SELECT * FROM artifacts WHERE id=$1 AND ${scope.where('$2')}`,[id,scope.val])).rows[0];
  if(!row)return null;
  if(previous===role)return {changed:false};
  await groupQuota(tx,actor.userId!,'share');
  if(role===null)await tx.query('DELETE FROM artifact_group_shares WHERE artifact_id=$1 AND group_id=$2',[id,groupId]);
  else await tx.query('INSERT INTO artifact_group_shares(artifact_id,group_id,role,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(artifact_id,group_id) DO UPDATE SET role=EXCLUDED.role',[id,groupId,role,actor.userId]);
  await tx.query('UPDATE artifacts SET sharing_revision=sharing_revision+1 WHERE id=$1',[id]);
  await tx.query(`SELECT ${notifyArtifactSql('id','edit_id')} FROM artifacts WHERE id=$1`,[id]);
  // The share's audience: direct members of the group and of every subgroup (lib/groups hierarchy).
  const members=await subtreeMemberIds(tx,groupId);
  await recordGroupMutation(tx,actor.userId!,groupId,role===null?'unshared':'shared',{artifact_id:id,previous_role:previous,role},members,actor);
  return {changed:true};
 }).catch(error=>{if(error&&typeof error==='object'&&'code' in error&&error.code==='55P03')throw new GroupError('share_refused',409);throw error;});
}
