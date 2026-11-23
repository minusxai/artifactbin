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
 *    created manually or by another issuer is refused. The verified path is resolved under the configured ceiling.
 *    An existing group must still have the signed direct parent.
 *  - Each listed group gains a direct Member seat unless the person already holds a role there. Other seats and
 *    roles are retained. Empty lists cannot start a session. Company root enrollment remains a separate setting.
 * One advisory lock serializes these sign-ins, so a double-submitted form never meets its own half-created rows.
 */
import {hashToken} from '@artifactbin/utils';
import {isValidHandle} from '@artifactbin/contracts/handles';
import type {Queryable} from '@artifactbin/contracts/db';
import type {TransactionalQueryable} from '@artifactbin/contracts/identity-module';
import {trustedEmailOf,type TrustedClaims,type TrustedGroup} from '../identity/trusted-issuers';
import {companySignInRoot} from './company-group';
import {accountMethods,reserveHandle,writeDisplayName} from './accounts';
import {identityTables,internalId,isUniqueViolation} from './tables';

interface TrustedPerson {
  issuer: string;
  jti: string;
  exp: number;
  subject: string;
  email: string;
  name?: string;
  previousHandle?: string;
  joinCompanyRoot?: boolean;
  parentGroup: string;
}
type TrustedSignInInput = TrustedPerson & Pick<TrustedClaims,'groups'|'activeGroup'>;
type TrustedSignInRefusal = 'no_authorized_groups' | 'replayed_token' | 'subject_conflict' | 'group_conflict' | 'deployment_admission_required' | 'parent_group_missing' | 'invalid_claims';
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
  const {groups,activeGroup} = input;
  if (!groups.length) return {ok:false,refusal:'no_authorized_groups'};
  const subjectOk = isEmail ? address !== null : isValidHandle(input.subject);
  if (!subjectOk || groups.some(g => !isValidHandle(g.handle) || g.handle === input.subject || g.handle === input.previousHandle) ||
    (input.previousHandle !== undefined && (!address || !isValidHandle(input.previousHandle)))) return {ok:false, refusal:'invalid_claims'};
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
      let active: {groupId:string; created:boolean} | undefined;
      for (const claim of groups) {
        const group = await ensureGroup(tx,input,claim,person.userId,t);
        if (claim.name !== undefined) await tx.query(`UPDATE ${t.groups} SET name=$2 WHERE id=$1 AND name IS DISTINCT FROM $2`,[group.groupId,claim.name]);
        if (claim.handle === activeGroup) active=group;
        await tx.query(`INSERT INTO ${t.group_members}(group_id,user_id,role)
          VALUES($1,$2,'member') ON CONFLICT(group_id,user_id) DO NOTHING`,[group.groupId,person.userId]);
      }
      if (!active) throw new Refused('invalid_claims');
      if (admit && !await admit(person, tx)) throw new Refused('deployment_admission_required');
      if (rootId) await tx.query(`INSERT INTO ${t.group_members}(group_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT (group_id,user_id) DO NOTHING`, [rootId, person.userId]);
      await tx.query(`UPDATE ${t.users} SET trusted_sign_in_group=$2,trusted_sign_in_at=now(),
        trusted_root_granted=COALESCE($3,trusted_root_granted) WHERE id=$1`, [person.userId, active.groupId, rootId]);
      if (input.name !== undefined && (emailPerson ? emailPerson.canFillName : person.email === input.email)) await writeDisplayName(tx, t, authSchema, person.userId, input.name);
      return {ok: true as const, userId: person.userId, email: person.email, groupId: active.groupId, created: {user: person.created, group: active.created}};
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

async function ensurePerson(tx: Queryable, input: TrustedPerson, t: Tables, better: (table: string) => string) {
  try { return await findOrCreateHandlePerson(tx, input, t, better); }
  catch (error) {
    if (isUniqueViolation(error)) throw new Refused('subject_conflict');
    throw error;
  }
}

async function findOrCreateHandlePerson(tx: Queryable, input: TrustedPerson, t: Tables, better: (table: string) => string) {
  const provider = trustedProviderId(input.issuer);
  const owner = (await tx.query<{id:string; email:string; bound:boolean}>(`
    SELECT u.id,u.email,EXISTS(SELECT 1 FROM ${better('account')} a
      WHERE a."userId"=u.id AND a."providerId"=$2 AND a."accountId"=$1) AS bound
    FROM ${t.users} u WHERE u.username=$1 FOR UPDATE`, [input.subject,provider])).rows[0];
  if (owner) {
    if (!owner.bound) throw new Refused('subject_conflict');
    return {userId:owner.id,email:owner.email,created:false};
  }
  // A person who first authenticated by email keeps their own public username. This issuer's reserved alias
  // authenticates the same verified person even when a later token names only the stable handle.
  const alias = (await tx.query<{id:string;email:string}>(`SELECT u.id,u.email FROM ${t.handle_reservations} r
    JOIN ${t.users} u ON u.id=r.subject_id AND u.kind='account'
    JOIN ${better('user')} auth ON auth.id=u.id AND auth.email=u.email AND auth."emailVerified"
    WHERE r.handle=$1 AND r.kind=$2 FOR UPDATE OF u,auth`,[input.subject,provider])).rows[0];
  if (alias) return {userId:alias.id,email:alias.email,created:false};
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

/** When OTP came first, reserve the free external handle as an alias without changing the person's public handle.
 * The handle PK and unique (kind,subject_id) index allow exactly one person per handle and one alias per issuer/person.
 * Existing handle identities always follow the original migration path, including its collision checks.
 */
async function bindVerifiedEmailAlias(tx: Queryable, t: Tables, better: (table:string)=>string, issuer:string, handle:string, address:string) {
  const provider = trustedProviderId(issuer);
  const bound = await tx.query(`SELECT 1 FROM ${better('account')} WHERE "accountId"=$1 AND "providerId" LIKE 'trusted:%'`,[handle]);
  if (bound.rows.length) return false;
  // Lock projections in the same order as a profile edit. A new email, or one never verified, cannot bind an alias.
  await tx.query(`SELECT id FROM ${t.users} WHERE email=$1 FOR UPDATE`,[address]);
  const auth = (await tx.query<{id:string}>(`SELECT id FROM ${better('user')} WHERE email=$1 AND "emailVerified" FOR UPDATE`,[address])).rows[0];
  if (!auth) return false;
  const synthetic = trustedEmailOf(issuer,handle);
  const occupied = await tx.query(`SELECT 1 FROM ${t.users} WHERE username=$1 OR email=$4
    UNION ALL SELECT 1 FROM ${t.groups} WHERE handle=$1
    UNION ALL SELECT 1 FROM ${better('user')} WHERE email=$4
    UNION ALL SELECT 1 FROM ${better('account')} WHERE "userId"=$2 AND "providerId"=$3`,[handle,auth.id,provider,synthetic]);
  if (occupied.rows.length) throw new Refused('subject_conflict');
  await tx.query(`INSERT INTO ${t.handle_reservations}(handle,kind,subject_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[handle,provider,auth.id]);
  const same = await tx.query(`SELECT 1 FROM ${t.handle_reservations} WHERE handle=$1 AND kind=$2 AND subject_id=$3`,[handle,provider,auth.id]);
  if (!same.rows.length) throw new Refused('subject_conflict');
  return true;
}

/** Resolve the issuer's stable handle, creating it on first use. Email conflicts roll back that creation too. */
async function transitionHandle(tx: Queryable, t: Tables, better: (table:string)=>string, input: TrustedPerson, handle:string, address:string) {
  if (await bindVerifiedEmailAlias(tx,t,better,input.issuer,handle,address)) return false;
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

/** Read the live ancestry under the same hierarchy lock that serializes group moves. */
async function signedParent(tx: Queryable, t: Tables, path: string[], ceiling: string) {
  if (!ceiling || !path.length) throw new Refused('group_conflict');
  await tx.query(`INSERT INTO ${t.group_hierarchy}(id,revision) VALUES('installation',0) ON CONFLICT DO NOTHING`);
  await tx.query(`SELECT id FROM ${t.group_hierarchy} WHERE id='installation' FOR UPDATE`);
  const bounds = (await tx.query<{id:string}>(`SELECT id FROM ${t.groups}
    WHERE (id=$1 OR handle=$1) AND deleted_at IS NULL`, [ceiling])).rows;
  if (bounds.length !== 1) throw new Refused('parent_group_missing');
  const chain = (await tx.query<{id:string;handle:string}>(`WITH RECURSIVE ancestors AS (
    SELECT id,handle,parent_id,0 AS depth FROM ${t.groups} WHERE handle=$1 AND deleted_at IS NULL
    UNION ALL SELECT g.id,g.handle,g.parent_id,a.depth+1 FROM ancestors a
    JOIN ${t.groups} g ON g.id=a.parent_id WHERE g.deleted_at IS NULL AND a.depth<10000
  ) SELECT id,handle FROM ancestors ORDER BY depth`, [path.at(-1)])).rows;
  const top = chain.findIndex(group => group.id === bounds[0]!.id);
  if (top < path.length-1 || path.some((handle,i) => handle !== chain[path.length-1-i]?.handle)) throw new Refused('group_conflict');
  return chain[0]!.id;
}

async function ensureGroup(tx: Queryable, input: TrustedPerson, claim: TrustedGroup, userId: string, t: Tables) {
  const parentId = await signedParent(tx,t,claim.parentHandles,input.parentGroup);
  const existing = (await tx.query<{id: string; parent_id:string|null; deleted_at: string | null; trusted_issuer: string | null; tenancy_id: string | null}>(
    `SELECT id,parent_id,deleted_at,trusted_issuer,tenancy_id FROM ${t.groups} WHERE handle=$1 FOR UPDATE`, [claim.handle])).rows[0];
  if (existing) {
    if (existing.deleted_at || existing.trusted_issuer !== input.issuer || existing.parent_id !== parentId) throw new Refused('group_conflict');
    if (existing.tenancy_id !== claim.tenancyId) {
      await tx.query(`UPDATE ${t.groups} SET tenancy_id=$2 WHERE id=$1`, [existing.id, claim.tenancyId]);
      await tx.query(`INSERT INTO ${t.host_tenancy_changes}(group_id,issuer,person_id,previous_tenancy_id,tenancy_id)
        VALUES($1,$2,$3,$4,$5)`, [existing.id, existing.trusted_issuer, userId, existing.tenancy_id, claim.tenancyId]);
    }
    return {groupId: existing.id, created: false};
  }
  // A new group is a topology change: the hierarchy revision moves first, as for every create.
  await tx.query(`INSERT INTO ${t.group_hierarchy} AS h (id,revision) VALUES('installation',1) ON CONFLICT (id) DO UPDATE SET revision=h.revision+1`);
  const groupId = 'grp_' + internalId();
  try { await reserveHandle(t, tx, claim.handle, 'group', groupId); } catch (error) { if (isUniqueViolation(error)) throw new Refused('group_conflict'); throw error; }
  await tx.query(`INSERT INTO ${t.groups}(id,handle,name,description,created_by,parent_id,trusted_issuer,tenancy_id) VALUES($1,$2,$2,'',$3,$4,$5,$6)`,
    [groupId, claim.handle, userId, parentId, input.issuer, claim.tenancyId]);
  return {groupId, created: true};
}
