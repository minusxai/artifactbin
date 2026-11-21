/**
 * TRUSTED-ISSUER SIGN-IN, THE IDENTITY WRITES (the token is verified first, ../identity/trusted-issuers): in ONE
 * transaction, the person the subject names, the group bound to (issuer, group handle) and the membership.
 *
 *  - An email subject names the person with that address (trimmed, lowercased), whoever made them: the same account
 *    an email sign-in reaches, from this issuer, another issuer or a sign-in of their own. A new one gets what an email
 *    sign-in gives it: Better Auth's verified `user` row and the identity `users` row under one id, and a handle from
 *    the address (`ensureUsername`, after the transaction). The welcome page stays done for a new person only; an
 *    existing person keeps their handle and welcome state. A reserved `.invalid` address is refused (the synthetic addresses below).
 *  - Any other subject is a handle the issuer owns. The person is found by its Better Auth `account` row (`providerId`
 *    = `trusted:<issuer>`, `accountId` = subject), never by username (renameable). A new one gets Better Auth's `user`
 *    row (the synthetic, non-deliverable address the caller names, verified, since a session authenticates only a
 *    verified address), that account row, the identity `users` row (handle = subject, welcome already done: the person
 *    never sees `/welcome`) and the handle's reservation. A subject whose handle or address someone else already holds
 *    is refused. Handles never contain `@`, so the two kinds never meet.
 *  - The group is found by handle. A new one records the issuer and the tenancy (`groups.trusted_issuer`,
 *    `groups.tenancy_id`, exposed by the identity view) and refreshes its tenancy at each admitted sign-in. An existing group
 *    created manually or by another issuer is refused. Under the configured parent group when there
 *    is one, including on an installation with several roots. A missing configured parent is refused. With no
 *    configured parent, a company group goes under the top ancestor of the deployment default.
 *  - The person is a direct `member` of the group (no admin: nobody administers an issuer's group from here), and of no
 *    other group of that issuer: each sign-in leaves exactly the membership its token names. Another issuer's groups
 *    and plain groups are not touched, so one email person may sit in a group of each issuer.
 * One advisory lock serializes these sign-ins, so a double-submitted form never meets its own half-created rows.
 */
import {isValidHandle} from '@artifactbin/contracts/handles';
import type {Queryable} from '@artifactbin/contracts/db';
import type {TransactionalQueryable} from '@artifactbin/contracts/identity-module';
import {companyGroupState} from './company-group';
import {chainOf, liveGroup} from './group-access';
import {accountMethods,reserveHandle} from './accounts';
import {identityTables,internalId,isUniqueViolation} from './tables';

export interface TrustedSignInInput {
  issuer: string;
  subject: string;
  group: string;
  tenancyId: string;
  name?: string;
  groupName?: string;
  /** The parent group's handle or id, when the issuer's groups live under one. */
  parentGroup?: string;
  /** A handle subject's synthetic address (never delivered to); unused for an email subject. */
  email: string;
}
type TrustedSignInRefusal = 'subject_conflict' | 'group_conflict' | 'deployment_admission_required' | 'parent_group_missing' | 'invalid_claims';
export type TrustedSignInResult =
  | {ok: true; userId: string; email: string; groupId: string; created: {user: boolean; group: boolean}}
  | {ok: false; refusal: TrustedSignInRefusal};

class Refused extends Error { constructor(public refusal: TrustedSignInRefusal) { super(refusal); } }

const trustedProviderId = (issuer: string): string => `trusted:${issuer}`;

/** The address an email subject names, normalized; null for a subject that is not one (or a reserved `.invalid` one). */
function trustedSubjectEmail(subject: string): string | null {
  const address = subject.trim().toLowerCase(), at = address.lastIndexOf('@');
  if (at < 1 || address.length > 254 || at > 64) return null;
  const domain = address.slice(at + 1);
  if (!/^[^\s@"(),:;<>[\\\]]+$/.test(address.slice(0, at)) || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return null;
  return domain === 'invalid' || domain.endsWith('.invalid') ? null : address;
}

export async function trustedSignIn(db: TransactionalQueryable, input: TrustedSignInInput, authSchema = 'auth', appSchema?: string,
  admit?: (person: {userId: string; email: string}, tx: Queryable) => Promise<boolean>): Promise<TrustedSignInResult> {
  const isEmail = input.subject.includes('@'), address = isEmail ? trustedSubjectEmail(input.subject) : null;
  const subjectOk = isEmail ? address !== null : isValidHandle(input.subject) && input.subject !== input.group;
  if (!subjectOk || !isValidHandle(input.group)) return {ok: false, refusal: 'invalid_claims'};
  const t = identityTables(authSchema), better = (table: string) => `${authSchema}."${table}"`;
  try {
    const result = await db.transaction(async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('artifactbin.identity.trusted-sign-in'))");
      const person = address ? await ensureEmailPerson(tx, address, t, better) : await ensurePerson(tx, input, t, better);
      const group = await ensureGroup(tx, input, person.userId, t, appSchema);
      await tx.query(`INSERT INTO ${t.group_members}(group_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT (group_id,user_id) DO NOTHING`, [group.groupId, person.userId]);
      // The issuer decides which of its groups the person may act in NOW: drop their other memberships in this issuer's
      // groups, so access the issuer has since withdrawn (another tenant) never lingers here.
      await tx.query(`DELETE FROM ${t.group_members} m USING ${t.groups} g WHERE m.group_id=g.id AND m.user_id=$1 AND g.trusted_issuer=$2 AND m.group_id<>$3`, [person.userId, input.issuer, group.groupId]);
      if (admit && !await admit(person, tx)) throw new Refused('deployment_admission_required');
      if (input.name !== undefined) {
        await tx.query(`UPDATE ${t.users} SET name=$2 WHERE id=$1 AND name IS DISTINCT FROM $2`, [person.userId, input.name]);
        await tx.query(`UPDATE ${better('user')} SET name=$2,"updatedAt"=now() WHERE id=$1 AND name IS DISTINCT FROM $2`, [person.userId, input.name]);
      }
      if (input.groupName !== undefined)
        await tx.query(`UPDATE ${t.groups} SET name=$2 WHERE id=$1 AND name IS DISTINCT FROM $2`, [group.groupId, input.groupName]);
      return {ok: true as const, userId: person.userId, email: person.email, groupId: group.groupId, created: {user: person.created, group: group.created}};
    });
    // An email person gets their handle the way an email sign-in's does (its own transaction, so after this one).
    if (address) await accountMethods(db, t).ensureUsername({userId: result.userId});
    return result;
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
  if (bound) return {userId: bound.userId, email: bound.email ?? input.email, created: false};
  // Nobody else may hold the handle or the address: the subject names this issuer's person, never an existing one.
  const heldHandle = (await tx.query(`SELECT 1 FROM ${t.handle_reservations} WHERE handle=$1 UNION ALL SELECT 1 FROM ${t.users} WHERE username=$1`, [input.subject])).rows.length > 0;
  const heldAddress = (await tx.query(`SELECT 1 FROM ${better('user')} WHERE email=$1 UNION ALL SELECT 1 FROM ${t.users} WHERE email=$1`, [input.email])).rows.length > 0;
  if (heldHandle || heldAddress) throw new Refused('subject_conflict');
  const userId = 'usr_' + internalId(), name = input.subject;
  await tx.query(`INSERT INTO ${better('user')}(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())`, [userId, name, input.email]);
  await tx.query(`INSERT INTO ${better('account')}(id,"accountId","providerId","userId","createdAt","updatedAt") VALUES($1,$2,$3,$4,now(),now())`, ['acc_' + internalId(), input.subject, provider, userId]);
  await tx.query(`INSERT INTO ${t.users}(id,email,name,username,welcome_pending) VALUES($1,$2,$3,$4,false)`, [userId, input.email, name, input.subject]);
  try { await reserveHandle(t, tx, input.subject, 'user', userId); } catch (error) { if (isUniqueViolation(error)) throw new Refused('subject_conflict'); throw error; }
  return {userId, email: input.email, created: true};
}

/**
 * The person with this address: Better Auth's `user` row and the identity `users` row share one id, so whichever
 * exists names the person and the missing one is written with that id. Rows naming two different people, or an
 * address held by something other than an account, are refused.
 */
async function ensureEmailPerson(tx: Queryable, address: string, t: Tables, better: (table: string) => string) {
  const auth = (await tx.query<{id: string}>(`SELECT id FROM ${better('user')} WHERE email=$1`, [address])).rows[0];
  const app = (await tx.query<{id: string; kind: string}>(`SELECT id,kind FROM ${t.users} WHERE email=$1`, [address])).rows[0];
  if ((auth && app && auth.id !== app.id) || (app && app.kind !== 'account')) throw new Refused('subject_conflict');
  const userId = auth?.id ?? app?.id ?? 'usr_' + internalId();
  if (!auth) await tx.query(`INSERT INTO ${better('user')}(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,'',$2,true,now(),now())`, [userId, address]);
  if (!app) await tx.query(`INSERT INTO ${t.users}(id,email,welcome_pending) VALUES($1,$2,false)`, [userId, address]);
  return {userId, email: address, created: !auth && !app};
}

async function ensureGroup(tx: Queryable, input: TrustedSignInInput, userId: string, t: Tables, appSchema?: string) {
  const existing = (await tx.query<{id: string; deleted_at: string | null; trusted_issuer: string | null; tenancy_id: string | null}>(
    `SELECT id,deleted_at,trusted_issuer,tenancy_id FROM ${t.groups} WHERE handle=$1 FOR UPDATE`, [input.group])).rows[0];
  if (existing) {
    if (existing.deleted_at || existing.trusted_issuer !== input.issuer) throw new Refused('group_conflict');
    if (existing.tenancy_id !== input.tenancyId) await tx.query(`UPDATE ${t.groups} SET tenancy_id=$2 WHERE id=$1`, [existing.id, input.tenancyId]);
    return {groupId: existing.id, created: false};
  }
  // A new group is a topology change: the hierarchy revision moves first, as for every create.
  await tx.query(`INSERT INTO ${t.group_hierarchy} AS h (id,revision) VALUES('installation',1) ON CONFLICT (id) DO UPDATE SET revision=h.revision+1`);
  let parentId: string | null = null;
  if (input.parentGroup) {
    parentId = (await tx.query<{id: string}>(`SELECT id FROM ${t.groups} WHERE (id=$1 OR handle=$1) AND deleted_at IS NULL`, [input.parentGroup])).rows[0]?.id ?? null;
    if (!parentId) throw new Refused('parent_group_missing');
  }
  const company = parentId === null ? await companyGroupState(tx, appSchema) : null;
  if (company) {
    const root = company.setup_complete && company.default_group_id
      ? (await chainOf(tx, t, company.default_group_id)).at(-1) : null;
    if (!root || (await liveGroup(tx, t, root))?.parent_id !== null) throw new Refused('parent_group_missing');
    parentId = root;
  }
  const groupId = 'grp_' + internalId();
  try { await reserveHandle(t, tx, input.group, 'group', groupId); } catch (error) { if (isUniqueViolation(error)) throw new Refused('group_conflict'); throw error; }
  await tx.query(`INSERT INTO ${t.groups}(id,handle,name,description,created_by,parent_id,trusted_issuer,tenancy_id) VALUES($1,$2,$2,'',$3,$4,$5,$6)`,
    [groupId, input.group, userId, parentId, input.issuer, input.tenancyId]);
  return {groupId, created: true};
}
