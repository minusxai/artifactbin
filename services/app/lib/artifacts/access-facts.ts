/**
 * WHAT THE ACCESS DECISIONS READ, apart from the row itself: the actor's group roles, user kinds,
 * named shares and editor groups. `effectiveRole` and `readThrough` decide from these facts and
 * nothing else, so the same decision runs over either source:
 *
 *  - `liveAccessFacts` asks the database one fact at a time, lazily — the default, and right for a
 *    single row, where ownership short-circuits most lookups.
 *  - `preloadAccessFacts` reads them for a whole set of rows in a fixed number of statements, for
 *    readers deciding many rows at once (the notification inbox). Share resolution, the one write a
 *    role read performs, is deferred to `settle()` and applied in one statement.
 */
import { maxRole, type ArtifactRole, type GroupRole, type Queryable, type UserKind } from '@artifactbin/contracts';
import { getGroupRole } from '../groups';
import { userKindOf } from '../user-kinds';
import { getDb } from '../platform/db';
import type { RoleActor } from '@/lib/accounts';

export interface AccessFacts {
  /** The actor's role in a live group, or null (always null without an account). */
  groupRole(groupId: string): Promise<GroupRole | null>;
  /** What a user is; null for no id or no row. */
  userKind(userId: string | null | undefined): Promise<UserKind | null>;
  /** Does a share name the actor's account here — by resolved id, or by its account email while unresolved? */
  sharedWith(artifactId: string): Promise<boolean>;
  /**
   * The best role the share list names the actor with (resolved id, or while unresolved the session's or
   * the account's email), after stamping unresolved invitations to the account's email with its id.
   */
  namedRole(artifactId: string): Promise<ArtifactRole>;
  /** Live groups the actor edits, locked FOR SHARE when read inside a transaction. */
  editorGroupIds(): Promise<string[]>;
}

const SHARED_WITH_SQL = 'SELECT 1 FROM artifact_shares s WHERE s.artifact_id=$1 AND (s.user_id=$2 OR(s.user_id IS NULL AND s.email=(SELECT email FROM users WHERE id=$2)))';
const RESOLVE_SHARES_SQL = (artifacts: string) => `UPDATE artifact_shares SET user_id = $2 WHERE artifact_id ${artifacts} AND user_id IS NULL AND email = (SELECT email FROM users WHERE id = $2)`;
const EDITOR_GROUPS_SQL = "SELECT gm.group_id FROM group_members gm JOIN groups g ON g.id=gm.group_id WHERE gm.user_id=$1 AND gm.role='editor' AND g.deleted_at IS NULL FOR SHARE OF gm,g";
/** The address an unresolved share may still match from this session (empty when it carries none). */
const sessionEmail = (actor: RoleActor) => actor.email?.toLowerCase().trim() ?? '';

/** One statement per fact asked, on `query` (or the shared database when omitted). */
export function liveAccessFacts(actor: RoleActor, query?: Queryable): AccessFacts {
  const db = async () => query ?? await getDb();
  return {
    groupRole: (groupId) => getGroupRole(actor.userId, groupId, query),
    userKind: (userId) => userKindOf(userId, query),
    async sharedWith(artifactId) {
      return !!(await (await db()).query(SHARED_WITH_SQL, [artifactId, actor.userId])).rows.length;
    },
    async namedRole(artifactId) {
      const q = await db();
      // Stamp `user_id` on every still-unresolved share matching this account's current email — the
      // moment of RESOLUTION. Idempotent; a no-op once stamped.
      await q.query(RESOLVE_SHARES_SQL('= $1'), [artifactId, actor.userId]);
      const r = await q.query<{ role: ArtifactRole }>(
        `SELECT s.role FROM artifact_shares s
         WHERE s.artifact_id = $1 AND (
           s.user_id = $2
           OR (s.user_id IS NULL AND (s.email = $3 OR s.email = (SELECT email FROM users WHERE id = $2)))
         )`,
        [artifactId, actor.userId, sessionEmail(actor)],
      );
      return maxRole(...r.rows.map((x) => x.role));
    },
    async editorGroupIds() {
      if (!actor.userId) return [];
      return (await (await db()).query<{ group_id: string }>(EDITOR_GROUPS_SQL, [actor.userId])).rows.map((r) => r.group_id);
    },
  };
}

export interface PreloadedAccessFacts extends AccessFacts {
  /** Apply the share resolutions the decisions asked for (one statement, or none). */
  settle(): Promise<void>;
}

interface ShareFact { artifact_id: string; user_id: string | null; email: string; role: ArtifactRole }

/**
 * The facts for deciding `rows` for `actor`, in at most four statements however many rows there
 * are. A fact about anything outside `rows` falls back to the live query, so a decision is never
 * answered from a partial preload.
 */
export async function preloadAccessFacts(db: Queryable, actor: RoleActor, rows: ReadonlyArray<{ id: string; user_id: string | null }>): Promise<PreloadedAccessFacts> {
  const live = liveAccessFacts(actor, db);
  const ids = [...new Set(rows.map((row) => row.id))], preloaded = new Set(ids);
  const userIds = new Set([actor.userId, ...rows.map((row) => row.user_id)].filter((id): id is string => !!id));
  const users = new Map<string, { kind: UserKind; email: string | null }>();
  if (userIds.size) for (const u of (await db.query<{ id: string; kind: UserKind; email: string | null }>('SELECT id,kind,email FROM users WHERE id=ANY($1::text[])', [[...userIds]])).rows) users.set(u.id, u);
  const groups = new Map<string, GroupRole>();
  const shares = new Map<string, ShareFact[]>();
  if (actor.userId) {
    for (const g of (await db.query<{ group_id: string; role: GroupRole }>('SELECT m.group_id,m.role FROM group_members m JOIN groups g ON g.id=m.group_id WHERE m.user_id=$1 AND g.deleted_at IS NULL', [actor.userId])).rows) groups.set(g.group_id, g.role);
    if (ids.length) {
      const found = await db.query<ShareFact>(
        'SELECT s.artifact_id,s.user_id,s.email,s.role FROM artifact_shares s WHERE s.artifact_id=ANY($1::text[]) AND (s.user_id=$2 OR (s.user_id IS NULL AND (s.email=$3 OR s.email=(SELECT email FROM users WHERE id=$2))))',
        [ids, actor.userId, sessionEmail(actor)],
      );
      for (const share of found.rows) shares.set(share.artifact_id, [...shares.get(share.artifact_id) ?? [], share]);
    }
  }
  const accountEmail = actor.userId ? users.get(actor.userId)?.email ?? null : null;
  const namesAccount = (share: ShareFact) => share.user_id === actor.userId || (share.user_id === null && accountEmail !== null && share.email === accountEmail);
  const resolving = new Set<string>();
  let editorGroups: Promise<string[]> | undefined;
  return {
    async groupRole(groupId) { return actor.userId ? groups.get(groupId) ?? null : null; },
    async userKind(userId) {
      if (!userId) return null;
      if (userIds.has(userId)) return users.get(userId)?.kind ?? null;
      return live.userKind(userId);
    },
    async sharedWith(artifactId) {
      if (!preloaded.has(artifactId)) return live.sharedWith(artifactId);
      return !!actor.userId && (shares.get(artifactId) ?? []).some(namesAccount);
    },
    async namedRole(artifactId) {
      if (!preloaded.has(artifactId)) return live.namedRole(artifactId);
      const named = shares.get(artifactId) ?? [];
      if (named.some((share) => share.user_id === null && accountEmail !== null && share.email === accountEmail)) resolving.add(artifactId);
      return maxRole(...named.filter((share) => namesAccount(share) || (share.user_id === null && share.email === sessionEmail(actor))).map((share) => share.role));
    },
    editorGroupIds() { return editorGroups ??= live.editorGroupIds(); },
    async settle() {
      if (resolving.size) await db.query(RESOLVE_SHARES_SQL('= ANY($1::text[])'), [[...resolving], actor.userId]);
      resolving.clear();
    },
  };
}
