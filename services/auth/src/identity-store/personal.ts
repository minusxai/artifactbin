/**
 * THE PERSONAL GROUP: every person (every `users` row) is the only Admin of exactly one group of their own, its id a
 * pure function of theirs (`personalGroupId`), so a rule can name "this person" as a group without reading anything.
 * It is created with the person (./accounts) and, for people from before it, by `ensurePersonalGroups` on every boot of
 * the identity host; erased with a test user. It has no parent and no subgroup, is never joined, invited to, shared
 * with, approved for or signed in as, and moves no hierarchy revision, reserves no handle and sends no mail.
 *
 * NO READER SEES IT: the `groups`, `group_members` and `group_admins` read views leave it out (./views), so every
 * reader's rows are exactly what they were before it existed. The identity module's own writers refuse it as a group
 * that does not exist (./groups `lockGroups`), and no level is held on it for a sign-in (./rules `groupLevelHeldSql`).
 */
import type {Queryable} from '@artifactbin/contracts';
import type {IdentityTables} from './tables';

/** No ordinary group id (`grp_` + base36) or handle (contracts `HANDLE_RE`, no `~`) can be one of these. */
const PREFIX = 'pgr_';

/** The personal group of the person `userId`. */
export const personalGroupId = (userId: string): string => PREFIX + userId;

/** Over the SQL expression `groupId`: is it a personal group. One spelling for the views, the writers and the rules. */
export const isPersonalGroupSql = (groupId: string): string => `starts_with(${groupId}, '${PREFIX}')`;

/**
 * Data-modifying CTE items (no leading WITH) giving the person whose id is the SQL text expression `user` their
 * personal group and its one Admin row, when they lack them. Composed into the statement that writes the person, so
 * both commit together or not at all.
 */
export const personalGroupCtes = (t: IdentityTables, user: string): string =>
  `personal_group AS (INSERT INTO ${t.groups} (id, handle, name, created_by) VALUES ('${PREFIX}' || ${user}, '~' || ${user}, '', ${user}) ON CONFLICT DO NOTHING),
  personal_admin AS (INSERT INTO ${t.group_members} (group_id, user_id, role) VALUES ('${PREFIX}' || ${user}, ${user}, 'admin') ON CONFLICT DO NOTHING)`;

/**
 * THE MIGRATION: every person without a personal group, or without its Admin row, gets it. Set-based and idempotent:
 * it inserts only what is missing and never updates or deletes, so a repeat changes nothing, and a person written
 * meanwhile by a process from before this (no personal group) is given theirs on the next boot, or by their next
 * sign-in. It runs inside the identity boot's transaction (../identity-store `ensureIdentitySchema`), after the group
 * role model check. Readers see nothing of it (the views leave personal groups out).
 */
export async function ensurePersonalGroups(q: Queryable, t: IdentityTables): Promise<void> {
  await q.query(`INSERT INTO ${t.groups} (id, handle, name, created_by)
    SELECT '${PREFIX}' || u.id, '~' || u.id, '', u.id FROM ${t.users} u
     WHERE NOT EXISTS (SELECT 1 FROM ${t.groups} g WHERE g.id = '${PREFIX}' || u.id)
    ON CONFLICT DO NOTHING`);
  await q.query(`INSERT INTO ${t.group_members} (group_id, user_id, role)
    SELECT '${PREFIX}' || u.id, u.id, 'admin' FROM ${t.users} u
     WHERE NOT EXISTS (SELECT 1 FROM ${t.group_members} m WHERE m.group_id = '${PREFIX}' || u.id AND m.user_id = u.id)
    ON CONFLICT DO NOTHING`);
}
