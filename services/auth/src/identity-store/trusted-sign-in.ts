/**
 * TRUSTED-ISSUER SIGN-IN, THE IDENTITY WRITES (the token is verified first, ../identity/trusted-issuers): in ONE
 * transaction, the person the subject names, the group bound to (issuer, group handle) and the membership.
 *
 *  - An email subject names the person with that address (trimmed, lowercased), whoever made them: the same account
 *    an email sign-in reaches, from this issuer, another issuer or a sign-in of their own. A new one gets what an email
 *    sign-in gives it: Better Auth's verified `user` row and the identity `users` row under one id, and a handle from
 *    the address (`ensureUsername`, after the transaction). The welcome page stays done for a new person only; an
 *    existing person keeps their handle, welcome state and chosen name. A supplied name fills an empty email profile. A reserved `.invalid` address is refused (the synthetic addresses below).
 *  - Any other subject is a handle the issuer owns. The person is found by handle, authenticated by its Better Auth `account` row (`providerId`
 *    = `trusted:<issuer>`, `accountId` = subject). A new one gets Better Auth's `user`
 *    row (the synthetic, non-deliverable address the caller names, verified, since a session authenticates only a
 *    verified address), that account row, the identity `users` row (handle = subject, welcome already done: the person
 *    never sees `/welcome`) and the handle's reservation. A subject whose handle or address someone else already holds
 *    is refused. A signed previous_handle explicitly links the bound synthetic address to one email subject.
 *  - The group is found by handle. A new one records the issuer and the tenancy (`groups.trusted_issuer`,
 *    `groups.tenancy_id`, exposed by the identity view) and refreshes its tenancy at each admitted sign-in. An existing group
 *    created manually or by another issuer is refused. Under the configured parent group when there
 *    is one, including on an installation with several roots. A missing configured parent is refused. With no
 *    configured parent, a company group goes under the top ancestor of the deployment default.
 *  - The person is a direct `member` of the group (no admin: nobody administers an issuer's group from here), and of no
 *    other group of that issuer: each sign-in leaves exactly the membership its token names. Another issuer's groups
 *    and plain groups are retained. With company root membership enabled the person also joins the default group's live root, even
 *    when the selected group sits under a different root. An existing stronger root role is retained.
 * One advisory lock serializes these sign-ins, so a double-submitted form never meets its own half-created rows.
 */
import {hashToken} from '@artifactbin/utils';
import {isValidHandle} from '@artifactbin/contracts/handles';
import type {Queryable} from '@artifactbin/contracts/db';
import type {TransactionalQueryable} from '@artifactbin/contracts/identity-module';
import {trustedEmailOf} from '../identity/trusted-issuers';
import {companySignInRoot} from './company-group';
import {accountMethods,reserveHandle,writeDisplayName} from './accounts';
import {identityTables,internalId,isUniqueViolation} from './tables';

export interface TrustedSignInInput {
  issuer: string;
  jti: string;
  exp: number;
  subject: string;
  group: string;
  tenancyId: string;
  /** Company root membership setting of the verifying host. */
  joinCompanyRoot?: boolean;
  name?: string;
  groupName?: string;
  parentGroups?: string[];
  previousHandle?: string;
  /** The parent group's handle or id, when the issuer's groups live under one. */
  parentGroup?: string;
  /** A handle subject's synthetic address (never delivered to); unused for an email subject. */
  email: string;
}
type TrustedSignInRefusal = 'replayed_token' | 'subject_conflict' | 'group_conflict' | 'deployment_admission_required' | 'parent_group_missing' | 'invalid_claims';
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
  if (!subjectOk || !isValidHandle(input.group) || (input.previousHandle !== undefined && (!address || !isValidHandle(input.previousHandle) || input.previousHandle === input.group))) return {ok: false, refusal: 'invalid_claims'};
  const t = identityTables(authSchema), better = (table: string) => `${authSchema}."${table}"`;
  try {
    const result = await db.transaction(async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('artifactbin.identity.trusted-sign-in'))");
      // A verifier's in-memory replay check cannot see an admission by another process.
      const receipt = hashToken(JSON.stringify([input.issuer,input.jti]));
      await tx.query(`DELETE FROM ${better('credentials')} WHERE kind='trusted_sign_in' AND expires_at<=clock_timestamp()`);
      const spent = await tx.query(`INSERT INTO ${better('credentials')}(kind,credential_hash,expires_at)
        SELECT 'trusted_sign_in',$1,to_timestamp($2) WHERE to_timestamp($2)>clock_timestamp()
        ON CONFLICT DO NOTHING RETURNING 1`, [receipt,input.exp]);
      if (!spent.rows.length) throw new Refused('replayed_token');
      const createdByHandle = address && input.previousHandle
        ? await transitionHandle(tx, t, better, input, input.previousHandle, address)
        : false;
      const emailPerson = address ? await ensureEmailPerson(tx, address, t, better) : null;
      if (emailPerson && createdByHandle) { emailPerson.created = true; emailPerson.canFillName = true; }
      const person = emailPerson ?? await ensurePerson(tx, input, t, better);
      const company = await companySignInRoot(tx, t.groups, appSchema);
      if (company && (await tx.query(`SELECT 1 FROM ${t.users} WHERE id=$1 AND deployment_admission_revoked`, [person.userId])).rows.length)
        throw new Refused('deployment_admission_required');
      if (input.joinCompanyRoot && company && !company.rootId) throw new Refused('parent_group_missing');
      const rootId = input.joinCompanyRoot ? company?.rootId ?? null : null;
      const group = await ensureGroup(tx, input, person.userId, t, rootId, appSchema);
      await tx.query(`INSERT INTO ${t.group_members}(group_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT (group_id,user_id) DO NOTHING`, [group.groupId, person.userId]);
      // The issuer decides which of its groups the person may act in NOW: drop their other memberships in this issuer's
      // groups, so access the issuer has since withdrawn (another tenant) never lingers here.
      await tx.query(`DELETE FROM ${t.group_members} m USING ${t.groups} g WHERE m.group_id=g.id AND m.user_id=$1 AND g.trusted_issuer=$2 AND m.group_id<>$3 AND m.group_id IS DISTINCT FROM $4::text`, [person.userId, input.issuer, group.groupId, company?.rootId ?? null]);
      if (admit && !await admit(person, tx)) throw new Refused('deployment_admission_required');
      if (rootId) await tx.query(`INSERT INTO ${t.group_members}(group_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT (group_id,user_id) DO NOTHING`, [rootId, person.userId]);
      await tx.query(`UPDATE ${t.users} SET trusted_sign_in_group=$2,trusted_sign_in_at=now(),
        trusted_root_granted=COALESCE($3,trusted_root_granted) WHERE id=$1`, [person.userId, group.groupId, rootId]);
      if (input.name !== undefined && (emailPerson ? emailPerson.canFillName : person.email === input.email)) await writeDisplayName(tx, t, authSchema, person.userId, input.name);
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
  try { return await findOrCreateHandlePerson(tx, input, t, better); }
  catch (error) {
    if (isUniqueViolation(error)) throw new Refused('subject_conflict');
    throw error;
  }
}

async function findOrCreateHandlePerson(tx: Queryable, input: TrustedSignInInput, t: Tables, better: (table: string) => string) {
  const provider = trustedProviderId(input.issuer);
  const owner = (await tx.query<{id:string; email:string; bound:boolean}>(`
    SELECT u.id,u.email,EXISTS(SELECT 1 FROM ${better('account')} a
      WHERE a."userId"=u.id AND a."providerId"=$2 AND a."accountId"=$1) AS bound
    FROM ${t.users} u WHERE u.username=$1 FOR UPDATE`, [input.subject,provider])).rows[0];
  if (owner) {
    if (!owner.bound) throw new Refused('subject_conflict');
    return {userId:owner.id,email:owner.email,created:false};
  }
  // Before host handles were fixed the person could release this name. Recover only their original binding.
  const legacy = (await tx.query<{id:string; email:string; provider:string}>(`
    SELECT u.id,u.email,a."providerId" AS provider FROM ${better('account')} a JOIN ${t.users} u ON u.id=a."userId"
    WHERE a."accountId"=$1 AND a."providerId" LIKE 'trusted:%' FOR UPDATE OF u`, [input.subject])).rows;
  if (legacy.length) {
    const person = legacy[0]!;
    if (legacy.length !== 1 || person.provider !== provider) throw new Refused('subject_conflict');
    await reserveHandle(t,tx,input.subject,'user',person.id);
    await tx.query(`UPDATE ${t.users} SET username=$2 WHERE id=$1`,[person.id,input.subject]);
    return {userId:person.id,email:person.email,created:false};
  }
  // Nobody else may hold the handle or the address: the subject names this issuer's person, never an existing one.
  const heldAddress = (await tx.query(`SELECT 1 FROM ${better('user')} WHERE email=$1 UNION ALL SELECT 1 FROM ${t.users} WHERE email=$1`, [input.email])).rows.length > 0;
  if (heldAddress) throw new Refused('subject_conflict');
  const userId = 'usr_' + internalId(), name = input.subject;
  await reserveHandle(t, tx, input.subject, 'user', userId);
  await tx.query(`INSERT INTO ${better('user')}(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())`, [userId, name, input.email]);
  await tx.query(`INSERT INTO ${better('account')}(id,"accountId","providerId","userId","createdAt","updatedAt") VALUES($1,$2,$3,$4,now(),now())`, ['acc_' + internalId(), input.subject, provider, userId]);
  await tx.query(`INSERT INTO ${t.users}(id,email,name,username,welcome_pending) VALUES($1,$2,$3,$4,false)`, [userId, input.email, name, input.subject]);
  return {userId, email: input.email, created: true};
}

/** Resolve the issuer's stable handle, creating it on first use. Email conflicts roll back that creation too. */
async function transitionHandle(tx: Queryable, t: Tables, better: (table:string)=>string, input: TrustedSignInInput, handle:string, address:string) {
  const synthetic = trustedEmailOf(input.issuer,handle);
  const person = await ensurePerson(tx,{...input,subject:handle,email:synthetic},t,better);
  if (person.email !== synthetic && person.email !== address) throw new Refused('subject_conflict');
  const auth = (await tx.query<{email:string}>(`SELECT auth.email FROM ${better('user')} auth
    JOIN ${better('account')} binding ON binding."userId"=auth.id
    WHERE auth.id=$1 AND binding."providerId"=$2 AND binding."accountId"=$3 FOR UPDATE OF auth,binding`,
    [person.userId,trustedProviderId(input.issuer),handle])).rows[0];
  if (auth?.email !== person.email) throw new Refused('subject_conflict');
  const occupied = await tx.query(`SELECT 1 FROM ${t.users} WHERE lower(email)=$1 AND id<>$2
    UNION ALL SELECT 1 FROM ${better('user')} WHERE lower(email)=$1 AND id<>$2`,[address,person.userId]);
  if (occupied.rows.length) throw new Refused('subject_conflict');
  if (person.email === address) return false;
  try {
    await tx.query(`UPDATE ${t.users} SET email=$2 WHERE id=$1`,[person.userId,address]);
    await tx.query(`UPDATE ${better('user')} SET email=$2,"emailVerified"=true,"updatedAt"=now() WHERE id=$1`,[person.userId,address]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new Refused('subject_conflict');
    throw error;
  }
  return person.created;
}

/**
 * The person with this address: Better Auth's `user` row and the identity `users` row share one id, so whichever
 * exists names the person and the missing one is written with that id. Rows naming two different people, or an
 * address held by something other than an account, are refused.
 */
async function ensureEmailPerson(tx: Queryable, address: string, t: Tables, better: (table: string) => string) {
  // Take the same row locks, in the same order, as a personal profile edit. Either projection can predate the other.
  const app = (await tx.query<{id: string; kind: string; name: string | null}>(`SELECT id,kind,name FROM ${t.users} WHERE email=$1 FOR UPDATE`, [address])).rows[0];
  const auth = (await tx.query<{id: string; name: string}>(`SELECT id,name FROM ${better('user')} WHERE email=$1 FOR UPDATE`, [address])).rows[0];
  if ((auth && app && auth.id !== app.id) || (app && app.kind !== 'account')) throw new Refused('subject_conflict');
  const userId = auth?.id ?? app?.id ?? 'usr_' + internalId();
  if (!auth) await tx.query(`INSERT INTO ${better('user')}(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$3,$2,true,now(),now())`, [userId, address, app?.name ?? '']);
  if (!app) await tx.query(`INSERT INTO ${t.users}(id,email,name,welcome_pending) VALUES($1,$2,$3,false)`, [userId, address, auth?.name || null]);
  return {userId, email: address, created: !auth && !app, canFillName: !app?.name?.trim() && !auth?.name.trim()};
}

async function requiredCompanyRoot(tx: Queryable, t: Tables, appSchema?: string) {
  const company = await companySignInRoot(tx, t.groups, appSchema);
  if (company && !company.rootId) throw new Refused('parent_group_missing');
  return company?.rootId ?? null;
}

/** Read the live ancestry under the same hierarchy lock that serializes group moves. */
async function signedParent(tx: Queryable, t: Tables, path: string[], ceiling?: string) {
  if (!ceiling || !path.length) throw new Refused('group_conflict');
  await tx.query(`INSERT INTO ${t.group_hierarchy}(id,revision) VALUES('installation',0) ON CONFLICT DO NOTHING`);
  await tx.query(`SELECT id FROM ${t.group_hierarchy} WHERE id='installation' FOR UPDATE`);
  const bounds = (await tx.query<{id:string}>(`SELECT id FROM ${t.groups}
    WHERE (id=$1 OR handle=$1) AND deleted_at IS NULL`, [ceiling])).rows;
  if (bounds.length !== 1) throw new Refused('group_conflict');
  const chain = (await tx.query<{id:string;handle:string}>(`WITH RECURSIVE ancestors AS (
    SELECT id,handle,parent_id,0 AS depth FROM ${t.groups} WHERE handle=$1 AND deleted_at IS NULL
    UNION ALL SELECT g.id,g.handle,g.parent_id,a.depth+1 FROM ancestors a
    JOIN ${t.groups} g ON g.id=a.parent_id WHERE g.deleted_at IS NULL AND a.depth<10000
  ) SELECT id,handle FROM ancestors ORDER BY depth`, [path.at(-1)])).rows;
  const top = chain.findIndex(group => group.id === bounds[0]!.id);
  if (top < path.length-1 || path.some((handle,i) => handle !== chain[path.length-1-i]?.handle)) throw new Refused('group_conflict');
  return chain[0]!.id;
}

async function ensureGroup(tx: Queryable, input: TrustedSignInInput, userId: string, t: Tables, rootId: string | null, appSchema?: string) {
  const requestedParent = input.parentGroups ? await signedParent(tx,t,input.parentGroups,input.parentGroup) : null;
  const existing = (await tx.query<{id: string; parent_id:string|null; deleted_at: string | null; trusted_issuer: string | null; tenancy_id: string | null}>(
    `SELECT id,parent_id,deleted_at,trusted_issuer,tenancy_id FROM ${t.groups} WHERE handle=$1 FOR UPDATE`, [input.group])).rows[0];
  if (existing) {
    if (existing.deleted_at || existing.trusted_issuer !== input.issuer || (requestedParent && existing.parent_id !== requestedParent)) throw new Refused('group_conflict');
    if (existing.tenancy_id !== input.tenancyId) {
      await tx.query(`UPDATE ${t.groups} SET tenancy_id=$2 WHERE id=$1`, [existing.id, input.tenancyId]);
      await tx.query(`INSERT INTO ${t.host_tenancy_changes}(group_id,issuer,person_id,previous_tenancy_id,tenancy_id)
        VALUES($1,$2,$3,$4,$5)`, [existing.id, existing.trusted_issuer, userId, existing.tenancy_id, input.tenancyId]);
    }
    return {groupId: existing.id, created: false};
  }
  // A new group is a topology change: the hierarchy revision moves first, as for every create.
  await tx.query(`INSERT INTO ${t.group_hierarchy} AS h (id,revision) VALUES('installation',1) ON CONFLICT (id) DO UPDATE SET revision=h.revision+1`);
  let parentId = requestedParent ?? rootId;
  if (!requestedParent && input.parentGroup) {
    parentId = (await tx.query<{id: string}>(`SELECT id FROM ${t.groups} WHERE (id=$1 OR handle=$1) AND deleted_at IS NULL`, [input.parentGroup])).rows[0]?.id ?? null;
    if (!parentId) throw new Refused('parent_group_missing');
  } else if (!requestedParent && !input.joinCompanyRoot) {
    parentId = await requiredCompanyRoot(tx, t, appSchema);
  }
  const groupId = 'grp_' + internalId();
  try { await reserveHandle(t, tx, input.group, 'group', groupId); } catch (error) { if (isUniqueViolation(error)) throw new Refused('group_conflict'); throw error; }
  await tx.query(`INSERT INTO ${t.groups}(id,handle,name,description,created_by,parent_id,trusted_issuer,tenancy_id) VALUES($1,$2,$2,'',$3,$4,$5,$6)`,
    [groupId, input.group, userId, parentId, input.issuer, input.tenancyId]);
  return {groupId, created: true};
}
