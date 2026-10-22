import type { GroupAuthorityFacts, GroupMembershipRepository, GroupRole } from "../group-authority-contracts.ts";
import type { SqlClient, SqlDatabase } from "./sql.ts";
import { fail } from "../errors.ts";

/** Locks every current membership's group until the caller's transaction ends.
 * Revocation locks the same group exclusively, so a mutation cannot commit with
 * a grant revoked before its authorization transaction acquired the lock.
 */
export async function loadGroupAuthority(client: SqlClient, actor: string): Promise<GroupAuthorityFacts> {
  const groups = (await client.query(
    "SELECT g.owner FROM groups g JOIN group_memberships m ON m.owner=g.owner WHERE m.actor=$1 AND g.active ORDER BY g.owner FOR SHARE OF g",
    [actor],
  )).rows;
  // Re-read after locks: a revocation may have committed while we waited.
  const rows = groups.length ? (await client.query(
    "SELECT m.owner,m.role FROM group_memberships m JOIN groups g ON g.owner=m.owner WHERE m.actor=$1 AND m.owner=ANY($2::text[]) AND g.active ORDER BY m.owner",
    [actor, groups.map((row) => String(row.owner))],
  )).rows : [];
  return { actor, memberships: rows.map((row) => ({ owner: String(row.owner), role: row.role as GroupRole })) };
}
export function createGroupMembershipRepository(database: SqlDatabase): GroupMembershipRepository {
  return {
    set: (owner, actor, role) => database.transaction(async (client) => {
      if (role !== null && role !== "editor" && role !== "viewer") fail(422, "Invalid group role");
      const group = (await client.query("SELECT owner FROM groups WHERE owner=$1 FOR UPDATE", [owner])).rows[0];
      if (!group) fail(404, "Group not found");
      if (role === null) {
        await client.query("DELETE FROM group_memberships WHERE owner=$1 AND actor=$2", [owner, actor]);
      } else {
        const account = (await client.query("SELECT actor FROM accounts WHERE actor=$1 AND principal_kind='user'", [actor])).rows[0];
        if (!account) fail(422, "A group member must be a user account");
        await client.query("INSERT INTO group_memberships(owner,actor,role) VALUES($1,$2,$3) ON CONFLICT(owner,actor) DO UPDATE SET role=excluded.role", [owner, actor, role]);
      }
    }),
  };
}
