/**
 * TRUSTED-ISSUER SIGN-IN, THE IDENTITY WRITES (the token is verified first, ../identity/trusted-issuers): in ONE
 * transaction, the person bound to (issuer, subject), the group bound to (issuer, group handle) and the membership.
 *
 *  - The person is found by its Better Auth `account` row (`providerId` = `trusted:<issuer>`, `accountId` = subject),
 *    never by username (renameable). A new one gets Better Auth's `user` row (the synthetic, non-deliverable address
 *    the caller names, verified, since a session authenticates only a verified address), that account row, the
 *    identity `users` row (handle = subject, welcome already done: the person never sees `/welcome`) and the handle's
 *    reservation. A subject whose handle or address someone else already holds is refused.
 *  - The group is found by handle. A new one records the issuer and the tenancy (`groups.trusted_issuer`,
 *    `groups.tenancy_id`, exposed by the identity view) and never changes them; an existing group another issuer (or
 *    nobody's issuer) created, or one with a different tenancy, is refused. Under the configured parent group when there
 *    is one (missing parent: refused, never created as a root), so it inherits what readers attach to that parent.
 *  - The person is a direct `member` of the group (no admin: nobody administers an issuer's group from here), and of no
 *    other group of that issuer: each sign-in leaves exactly the membership its token names.
 * One advisory lock serializes these sign-ins, so a double-submitted form never meets its own half-created rows.
 */
import {isValidHandle} from '@artifactbin/contracts/handles';
import type {Queryable} from '@artifactbin/contracts/db';
import type {TransactionalQueryable} from '@artifactbin/contracts/identity-module';
import {reserveHandle} from './accounts';
import {identityTables,internalId,isUniqueViolation} from './tables';

export interface TrustedSignInInput {
  issuer: string;
  subject: string;
  group: string;
  tenancyId: string;
  name?: string;
  /** The parent group's handle or id, when the issuer's groups live under one. */
  parentGroup?: string;
  /** The person's synthetic address (never delivered to). */
  email: string;
}
type TrustedSignInRefusal = 'subject_conflict' | 'group_conflict' | 'tenancy_mismatch' | 'parent_group_missing' | 'invalid_claims';
export type TrustedSignInResult =
  | {ok: true; userId: string; email: string; groupId: string; created: {user: boolean; group: boolean}}
  | {ok: false; refusal: TrustedSignInRefusal};

class Refused extends Error { constructor(public refusal: TrustedSignInRefusal) { super(refusal); } }

const trustedProviderId = (issuer: string): string => `trusted:${issuer}`;

export async function trustedSignIn(db: TransactionalQueryable, input: TrustedSignInInput, authSchema = 'auth'): Promise<TrustedSignInResult> {
  if (!isValidHandle(input.subject) || !isValidHandle(input.group) || input.subject === input.group) return {ok: false, refusal: 'invalid_claims'};
  const t = identityTables(authSchema), better = (table: string) => `${authSchema}."${table}"`;
  try {
    return await db.transaction(async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('artifactbin.identity.trusted-sign-in'))");
      const person = await ensurePerson(tx, input, t, better);
      const group = await ensureGroup(tx, input, person.userId, t);
      await tx.query(`INSERT INTO ${t.group_members}(group_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT (group_id,user_id) DO NOTHING`, [group.groupId, person.userId]);
      // The issuer decides which of its groups the person may act in NOW: drop their other memberships in this issuer's
      // groups, so access the issuer has since withdrawn (another tenant) never lingers here.
      await tx.query(`DELETE FROM ${t.group_members} m USING ${t.groups} g WHERE m.group_id=g.id AND m.user_id=$1 AND g.trusted_issuer=$2 AND m.group_id<>$3`, [person.userId, input.issuer, group.groupId]);
      return {ok: true as const, userId: person.userId, email: person.email, groupId: group.groupId, created: {user: person.created, group: group.created}};
    });
  } catch (error) {
    if (error instanceof Refused) return {ok: false, refusal: error.refusal};
    throw error;
  }
}

type Tables = ReturnType<typeof identityTables>;

async function ensurePerson(tx: Queryable, input: TrustedSignInInput, t: Tables, better: (table: string) => string) {
  const provider = trustedProviderId(input.issuer);
  const bound = (await tx.query<{userId: string; email: string | null}>(
    `SELECT a."userId", u.email FROM ${better('account')} a JOIN ${t.users} u ON u.id=a."userId" WHERE a."providerId"=$1 AND a."accountId"=$2`, [provider, input.subject])).rows[0];
  if (bound) {
    if (input.name) {
      await tx.query(`UPDATE ${better('user')} SET name=$2, "updatedAt"=now() WHERE id=$1 AND name IS DISTINCT FROM $2`, [bound.userId, input.name]);
      await tx.query(`UPDATE ${t.users} SET name=$2 WHERE id=$1 AND name IS DISTINCT FROM $2`, [bound.userId, input.name]);
    }
    return {userId: bound.userId, email: bound.email ?? input.email, created: false};
  }
  // Nobody else may hold the handle or the address: the subject names this issuer's person, never an existing one.
  const heldHandle = (await tx.query(`SELECT 1 FROM ${t.handle_reservations} WHERE handle=$1 UNION ALL SELECT 1 FROM ${t.users} WHERE username=$1`, [input.subject])).rows.length > 0;
  const heldAddress = (await tx.query(`SELECT 1 FROM ${better('user')} WHERE email=$1 UNION ALL SELECT 1 FROM ${t.users} WHERE email=$1`, [input.email])).rows.length > 0;
  if (heldHandle || heldAddress) throw new Refused('subject_conflict');
  const userId = 'usr_' + internalId(), name = input.name || input.subject;
  await tx.query(`INSERT INTO ${better('user')}(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())`, [userId, name, input.email]);
  await tx.query(`INSERT INTO ${better('account')}(id,"accountId","providerId","userId","createdAt","updatedAt") VALUES($1,$2,$3,$4,now(),now())`, ['acc_' + internalId(), input.subject, provider, userId]);
  await tx.query(`INSERT INTO ${t.users}(id,email,name,username,welcome_pending) VALUES($1,$2,$3,$4,false)`, [userId, input.email, name, input.subject]);
  try { await reserveHandle(t, tx, input.subject, 'user', userId); } catch (error) { if (isUniqueViolation(error)) throw new Refused('subject_conflict'); throw error; }
  return {userId, email: input.email, created: true};
}

async function ensureGroup(tx: Queryable, input: TrustedSignInInput, userId: string, t: Tables) {
  const existing = (await tx.query<{id: string; deleted_at: string | null; trusted_issuer: string | null; tenancy_id: string | null}>(
    `SELECT id,deleted_at,trusted_issuer,tenancy_id FROM ${t.groups} WHERE handle=$1`, [input.group])).rows[0];
  if (existing) {
    if (existing.deleted_at || existing.trusted_issuer !== input.issuer) throw new Refused('group_conflict');
    if (existing.tenancy_id !== input.tenancyId) throw new Refused('tenancy_mismatch');
    return {groupId: existing.id, created: false};
  }
  // A new group is a topology change: the hierarchy revision moves first, as for every create.
  await tx.query(`INSERT INTO ${t.group_hierarchy} AS h (id,revision) VALUES('installation',1) ON CONFLICT (id) DO UPDATE SET revision=h.revision+1`);
  let parentId: string | null = null;
  if (input.parentGroup) {
    parentId = (await tx.query<{id: string}>(`SELECT id FROM ${t.groups} WHERE (id=$1 OR handle=$1) AND deleted_at IS NULL`, [input.parentGroup])).rows[0]?.id ?? null;
    if (!parentId) throw new Refused('parent_group_missing');
  }
  const groupId = 'grp_' + internalId();
  try { await reserveHandle(t, tx, input.group, 'group', groupId); } catch (error) { if (isUniqueViolation(error)) throw new Refused('group_conflict'); throw error; }
  await tx.query(`INSERT INTO ${t.groups}(id,handle,name,description,created_by,parent_id,trusted_issuer,tenancy_id) VALUES($1,$2,$2,'',$3,$4,$5,$6)`,
    [groupId, input.group, userId, parentId, input.issuer, input.tenancyId]);
  return {groupId, created: true};
}
