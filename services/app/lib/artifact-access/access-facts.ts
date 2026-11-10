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
import { getGroupRole } from '@/lib/groups';
import { userKindOf } from '@/lib/user-kinds';
import { getDb } from '@/lib/platform';
import type { AccessActor } from '@/lib/accounts';

export interface AccessFacts {
  /** The actor's role in a live group, or null (always null without an account). */
  groupShareRole(artifactId:string):Promise<ArtifactRole>;
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
const sessionEmail = (actor: AccessActor) => actor.email?.toLowerCase().trim() ?? '';

/** One statement per fact asked, on `query` (or the shared database when omitted). */
export function liveAccessFacts(actor: AccessActor, query?: Queryable): AccessFacts {
  const db = async () => query ?? await getDb();
  return {
    async groupShareRole(artifactId){
      if(!actor.userId)return 'none';
      const rows=await (await db()).query<{role:ArtifactRole}>("SELECT s.role FROM artifact_group_shares s JOIN group_members m ON m.group_id=s.group_id JOIN groups g ON g.id=m.group_id JOIN users u ON u.id=m.user_id WHERE s.artifact_id=$1 AND m.user_id=$2 AND g.deleted_at IS NULL AND u.kind='account'",[artifactId,actor.userId]);
      return maxRole(...rows.rows.map(row=>row.role));
    },
    groupRole: (groupId) => getGroupRole(actor.userId, groupId, query),
    userKind: (userId) => userKindOf(userId, query),
    async sharedWith(artifactId) {
      return !!(await (await db()).query(SHARED_WITH_SQL, [artifactId, actor.userId])).rows.length;
    },
    async namedRole(artifactId) {
      const q = await db();
      // The shares naming this actor, read first. `unresolved` marks an invitation still addressed only by the
      // account's own email: those are stamped with the account's id — the moment of RESOLUTION — and only then,
      // so a role read that finds every share already resolved (nearly all of them) writes nothing.
      const r = await q.query<{ role: ArtifactRole; unresolved: boolean }>(
        `SELECT s.role, (s.user_id IS NULL AND s.email = (SELECT email FROM users WHERE id = $2)) AS unresolved FROM artifact_shares s
         WHERE s.artifact_id = $1 AND (
           s.user_id = $2
           OR (s.user_id IS NULL AND (s.email = $3 OR s.email = (SELECT email FROM users WHERE id = $2)))
         )`,
        [artifactId, actor.userId, sessionEmail(actor)],
      );
      if (r.rows.some((x) => x.unresolved)) await q.query(RESOLVE_SHARES_SQL('= $1'), [artifactId, actor.userId]);
      return maxRole(...r.rows.map((x) => x.role));
    },
    async editorGroupIds() {
      if (!actor.userId) return [];
      return (await (await db()).query<{ group_id: string }>(EDITOR_GROUPS_SQL, [actor.userId])).rows.map((r) => r.group_id);
    },
  };
}

/**
 * FACTS FOR A DECISION INSIDE A WRITE'S TRANSACTION (a commit's re-decision, a page write's guard). Two differences
 * from `liveAccessFacts`, both so a decision can never be stale and never contend:
 *  - READ-ONLY: an unresolved invitation is matched by the account's email but never stamped here (the UPDATE
 *    would upgrade this transaction's share lock and deadlock two readers of one page); ordinary reads stamp it.
 *  - LOCKED ON READ: each fact locks the rows it reads, FOR SHARE, so nothing it decided on can change before the
 *    commit, AND the parent row an absent fact's writer would lock: rules match one role exactly, so an INSERT can
 *    narrow a role as well as widen it (a new membership or named share can turn signed_in into viewer). Named
 *    shares and group shares are inserted under their artifact's row lock, which the write holds (./locks);
 *    memberships under their group's row lock, which `groupRole`/`groupShareRole` take for every group that could
 *    change the role, joined or not. The artifacts themselves are locked first, in the global order (./locks).
 */
export function transactionAccessFacts(actor: AccessActor, tx: Queryable): AccessFacts {
  const account = async () => actor.userId ? (await tx.query<{ email: string | null; kind: string | null }>('SELECT email, kind FROM users WHERE id=$1 FOR SHARE', [actor.userId])).rows[0] ?? null : null;
  // As liveAccessFacts: `sharedWith` matches the account's id or (unresolved) its email; `namedRole` the session's too.
  const shares = async (artifactId: string, session: boolean) => {
    const email = (await account())?.email ?? null;
    return (await tx.query<{ role: ArtifactRole }>(
      `SELECT s.role FROM artifact_shares s WHERE s.artifact_id = $1 AND (s.user_id = $2 OR (s.user_id IS NULL AND (s.email = $3 OR s.email = $4))) FOR SHARE OF s`,
      [artifactId, actor.userId, session ? sessionEmail(actor) : email, email],
    )).rows;
  };
  return {
    async groupShareRole(artifactId) {
      if (!actor.userId) return 'none';
      // ABSENCE TOO: a membership the actor does not hold yet can narrow its role (rules match one role exactly:
      // joining a group with a viewer share turns signed_in into viewer). Membership writers insert under the group's
      // row lock (lib/groups, lib/deployment), so every group this artifact's group shares name is locked FOR SHARE
      // first, joined or not, and a join waits for this commit. The shares themselves are inserted under the
      // artifact's row lock, which the write already holds.
      await tx.query('SELECT 1 FROM artifact_group_shares WHERE artifact_id=$1 FOR SHARE', [artifactId]);
      await tx.query('SELECT id FROM groups WHERE id IN (SELECT group_id FROM artifact_group_shares WHERE artifact_id=$1) ORDER BY id COLLATE "C" FOR SHARE', [artifactId]);
      const rows = await tx.query<{ role: ArtifactRole }>("SELECT s.role FROM artifact_group_shares s JOIN group_members m ON m.group_id=s.group_id JOIN groups g ON g.id=m.group_id JOIN users u ON u.id=m.user_id WHERE s.artifact_id=$1 AND m.user_id=$2 AND g.deleted_at IS NULL AND u.kind='account' FOR SHARE OF s, m, g, u", [artifactId, actor.userId]);
      return maxRole(...rows.rows.map((row) => row.role));
    },
    async groupRole(groupId) {
      if (!actor.userId) return null;
      // The owning group, joined or not: a new membership would change the role (viewer, or editor → owner).
      await tx.query('SELECT id FROM groups WHERE id=$1 FOR SHARE', [groupId]);
      return (await tx.query<{ role: GroupRole }>('SELECT m.role FROM group_members m JOIN groups g ON g.id=m.group_id WHERE m.group_id=$1 AND m.user_id=$2 AND g.deleted_at IS NULL FOR SHARE OF m, g', [groupId, actor.userId])).rows[0]?.role ?? null;
    },
    async userKind(userId) {
      if (!userId) return null;
      return (await tx.query<{ kind: UserKind }>('SELECT kind FROM users WHERE id=$1 FOR SHARE', [userId])).rows[0]?.kind ?? null;
    },
    async sharedWith(artifactId) { return (await shares(artifactId, false)).length > 0; },
    async namedRole(artifactId) { return maxRole(...(await shares(artifactId, true)).map((x) => x.role)); },
    async editorGroupIds() {
      if (!actor.userId) return [];
      return (await tx.query<{ group_id: string }>(EDITOR_GROUPS_SQL, [actor.userId])).rows.map((r) => r.group_id);
    },
  };
}

/**
 * THE PAGE VIEW'S FACTS, asked once each per request: a page view decides the same row more than once — admission
 * (lib/artifacts canReadArtifact, in server/app documentPreparation and lib/document-serving artifact-page) and the
 * chrome's role (effectiveRole) — and each decision would ask the actor's kind, named shares and group shares again.
 * The memo holds each fact's PROMISE (decisions run concurrently), for this request and this actor only; the next
 * request asks the database again, so a share revoked between two requests is refused on the second. Only page-view
 * reads use it: a request that writes shares or memberships decides on live facts.
 */
const pageViewFacts = new WeakMap<Request, Map<string, AccessFacts>>();
export function requestAccessFacts(request: Request, actor: AccessActor): AccessFacts {
  // Every fact reads the actor's account id and session address, and nothing else of it.
  const key = `${actor.userId ?? ''}\u0000${sessionEmail(actor)}`;
  let byActor = pageViewFacts.get(request);
  if (!byActor) pageViewFacts.set(request, byActor = new Map());
  let facts = byActor.get(key);
  if (!facts) byActor.set(key, facts = memoAccessFacts(liveAccessFacts(actor)));
  return facts;
}

/**
 * The facts asked once each, for one decision's span (a request's page view above, a dataset GraphQL request's one
 * authorization): each fact's PROMISE is held, a failed read is asked again. A check that must see revocations made
 * since (a final fence, a commit under lock) never reads through one it did not create itself.
 */
export function memoAccessFacts(facts: AccessFacts): AccessFacts {
  const memo = new Map<string, Promise<unknown>>();
  const once = <T>(name: string, arg: string | null | undefined, ask: () => Promise<T>): Promise<T> => {
    const key = `${name}\u0000${arg ?? ''}`;
    let found = memo.get(key) as Promise<T> | undefined;
    if (!found) {
      memo.set(key, found = ask());
      // A failed read is not remembered: the next decision asks again.
      found.catch(() => memo.delete(key));
    }
    return found;
  };
  return {
    groupShareRole: (artifactId) => once('groupShareRole', artifactId, () => facts.groupShareRole(artifactId)),
    groupRole: (groupId) => once('groupRole', groupId, () => facts.groupRole(groupId)),
    userKind: (userId) => once('userKind', userId, () => facts.userKind(userId)),
    sharedWith: (artifactId) => once('sharedWith', artifactId, () => facts.sharedWith(artifactId)),
    namedRole: (artifactId) => once('namedRole', artifactId, () => facts.namedRole(artifactId)),
    editorGroupIds: () => once('editorGroupIds', null, () => facts.editorGroupIds()),
  };
}

export interface PreloadedAccessFacts extends AccessFacts {
  /** Apply the share resolutions the decisions asked for (one statement, or none). */
  settle(): Promise<void>;
}

interface ShareFact { artifact_id: string; user_id: string | null; email: string; role: ArtifactRole }

/**
 * The facts for deciding `rows` for `actor`, in at most five statements however many rows there
 * are. A fact about anything outside `rows` falls back to the live query, so a decision is never
 * answered from a partial preload.
 */
export async function preloadAccessFacts(db: Queryable, actor: AccessActor, rows: ReadonlyArray<{ id: string; user_id: string | null }>): Promise<PreloadedAccessFacts> {
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
  const groupShares=new Map<string,ArtifactRole>();
  if(actor.userId&&ids.length)for(const share of (await db.query<{artifact_id:string;role:ArtifactRole}>("SELECT s.artifact_id,s.role FROM artifact_group_shares s JOIN group_members m ON m.group_id=s.group_id JOIN groups g ON g.id=m.group_id JOIN users u ON u.id=m.user_id WHERE s.artifact_id=ANY($1::text[]) AND m.user_id=$2 AND g.deleted_at IS NULL AND u.kind='account'",[ids,actor.userId])).rows)groupShares.set(share.artifact_id,maxRole(groupShares.get(share.artifact_id)??'none',share.role));
  const accountEmail = actor.userId ? users.get(actor.userId)?.email ?? null : null;
  const namesAccount = (share: ShareFact) => share.user_id === actor.userId || (share.user_id === null && accountEmail !== null && share.email === accountEmail);
  const resolving = new Set<string>();
  let editorGroups: Promise<string[]> | undefined;
  return {
    async groupShareRole(id){return preloaded.has(id)?groupShares.get(id)??'none':live.groupShareRole(id);},
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
