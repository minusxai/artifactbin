/**
 * ACCOUNTS, HANDLES AND TOKENS: the identity store's writes to `users`, `handle_reservations` and `tokens`.
 *
 * The app's row per person follows the actor's claims (`syncProfile`): created on first sight with the welcome page
 * pending, its email kept current, a handle assigned (`localpart_xxxx`, renameable). Handles are one namespace with
 * groups' (`reserveHandle`): a reservation is a tombstone, so a released or deleted name is never handed to someone
 * else silently. Tokens are prefix + 256 random bits, only the sha256 stored, soft revoked (`deleted_at`).
 */
import {displayName} from '@artifactbin/contracts/account-resource';
import crypto from 'node:crypto';
import {IdentityError, type IdentityService, type IdentityUserRow, type MintedIdentityToken, type TransactionalQueryable} from '@artifactbin/contracts/identity-module';
import {MAX_TOKEN_TTL_MS, MIN_TOKEN_TTL_MS, isValidHandle} from '@artifactbin/contracts/handles';
import type {Queryable} from '@artifactbin/contracts/db';
import {internalId,isUniqueViolation,tokenId,type IdentityTables} from './tables';
import {groupLevelHeldSql,serviceGrantStandsSql} from './rules';

/** The longest a service's group sign-in lives: a day, whatever it asks; unasked, DEFAULT_TOKEN_TTL_MS. */
export const SERVICE_GROUP_SIGN_IN_MAX_TTL_MS = 24 * 60 * 60 * 1000;
/** One approval a service may present (`GROUP_SIGN_IN_GRANTS_PATH`): the group, its handle and name, the level. */
export interface ServiceGroupSignInGrant { id: string; group_id: string; group_handle: string; group_name: string; role: 'member' | 'editor'; approved_at: string }

const USER_COLS = 'id, email, kind, parent_user_id, expires_at, name, username, image_key, welcome_pending, created_at';
const TOKEN_PREFIX = 'mx_';
const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');
const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** The auto-assigned base: the sanitized email local part (never the domain), at most 20 characters. */
export function usernameFromEmail(email: string): string {
  const base = (email.split('@')[0] ?? '').toLowerCase().replace(/\+.*$/, '').replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '').slice(0, 20).replace(/^_+|_+$/g, '');
  return base || 'user';
}
function randomSuffix(): string {
  let out = '';
  for (const byte of crypto.randomBytes(8)) if (out.length < 4 && byte < 252) out += SUFFIX_ALPHABET[byte % 36];
  return out.length === 4 ? out : randomSuffix();
}

/** Claim `handle` for a user or group inside the caller's transaction; a handle held by anyone else is 23505. */
export async function reserveHandle(t: IdentityTables, tx: Queryable, handle: string, kind: 'user' | 'group', id: string): Promise<void> {
  // Backfill a legacy account handle before any new claim: existing names always win.
  await tx.query(`INSERT INTO ${t.handle_reservations}(handle,kind,subject_id) SELECT username,'user',id FROM ${t.users} WHERE username=$1 ON CONFLICT DO NOTHING`, [handle]);
  await tx.query(`DELETE FROM ${t.handle_reservations} WHERE kind=$1 AND subject_id=$2 AND handle<>$3`, [kind, id, handle]);
  const existing = (await tx.query<{kind: string; subject_id: string}>(`SELECT kind,subject_id FROM ${t.handle_reservations} WHERE handle=$1`, [handle])).rows[0];
  if (existing && (existing.kind !== kind || existing.subject_id !== id)) throw Object.assign(new Error('Handle is taken'), {code: '23505'});
  const claimed = await tx.query(`INSERT INTO ${t.handle_reservations} AS r (handle,kind,subject_id) VALUES($1,$2,$3) ON CONFLICT(handle) DO UPDATE SET handle=EXCLUDED.handle
    WHERE r.kind=EXCLUDED.kind AND r.subject_id=EXCLUDED.subject_id RETURNING handle`, [handle, kind, id]);
  if (!claimed.rows.length) throw Object.assign(new Error('Handle is taken'), {code: '23505'});
}

async function insertToken(t: IdentityTables, q: Queryable, input: Parameters<IdentityService['mintToken']>[0]): Promise<MintedIdentityToken> {
  const ms = input.expiresInMs;
  if (ms !== null && (!Number.isFinite(ms) || ms < MIN_TOKEN_TTL_MS || ms > MAX_TOKEN_TTL_MS)) throw new IdentityError('invalid_expiry', 400);
  const id = tokenId(), token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const expiresAt = ms === null ? null : new Date(Date.now() + ms).toISOString();
  await q.query(`INSERT INTO ${t.tokens} (id, name, token_hash, user_id, expires_at, audience, scope, request_authority) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, input.name ?? null, sha256(token), input.userId ?? null, expiresAt, input.audience ?? null, input.scope ?? null, input.requestAuthority === true]);
  return {id, name: input.name ?? null, token, expiresAt};
}

/** The most run sign-ins one person holds live from one service at once (contracts `RUN_SIGN_IN_PATH`). */
const RUN_SIGN_INS_PER_SERVICE = 50;

/**
 * A RUN SIGN-IN (contracts `RUN_SIGN_IN_PATH`): an ordinary access token for `userId` at this installation's API
 * (`audience`, `scope`), issued to the configured service `service` (`tokens.issued_by`), with its parent credential
 * in an auth `run_sign_in` credential row keyed by the token's id: the bearer read's `run` fence (../identity/bearer)
 * keeps it live only while that parent is. ONE statement, so it needs no transaction: the row, its credential and
 * the cap (RUN_SIGN_INS_PER_SERVICE live ones per person and service; past it `rate_limited`) commit together.
 * The route has already verified the exchanged token, the account and the parent; this writes nothing else.
 */
export async function mintRunSignIn(t: IdentityTables, q: Queryable, authSchema: string, input: {userId: string; service: string; parent: {kind: 'token' | 'session'; id: string}; expiresInMs: number; audience: string; scope: string}): Promise<MintedIdentityToken> {
  const ms = input.expiresInMs;
  if (!Number.isFinite(ms) || ms < MIN_TOKEN_TTL_MS || ms > MAX_TOKEN_TTL_MS) throw new IdentityError('invalid_expiry', 400);
  const id = tokenId(), token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ms).toISOString(), name = `run-${input.service}`;
  const minted = await q.query<{id: string}>(`WITH capped AS (
      SELECT 1 FROM (SELECT count(*) AS live FROM ${t.tokens} WHERE user_id=$4 AND issued_by=$8 AND deleted_at IS NULL AND expires_at>now()) held WHERE held.live < $11),
    token AS (INSERT INTO ${t.tokens} (id, name, token_hash, user_id, expires_at, audience, scope, issued_by) SELECT $1, $2, $3, $4, $5, $6, $7, $8 FROM capped RETURNING id),
    credential AS (INSERT INTO ${authSchema}.credentials (kind, credential_hash, subject_id, payload, expires_at)
      SELECT 'run_sign_in', token.id, $4, jsonb_build_object('access_token_id', token.id, 'parent_kind', $9::text, 'parent_id', $10::text, 'service', $8::text), $5 FROM token RETURNING credential_hash)
    SELECT credential_hash AS id FROM credential`,
    [id, name, sha256(token), input.userId, expiresAt, input.audience, input.scope, input.service, input.parent.kind, input.parent.id, RUN_SIGN_INS_PER_SERVICE]);
  if (!minted.rows.length) throw new IdentityError('rate_limited', 429, 3600);
  return {id, name, token, expiresAt};
}

/**
 * A GROUP'S SIGN-IN (contracts identity-service `GROUP_SIGN_IN_RULE`): an access token whose principal is the group
 * `groupId` itself at `role` (`member` or `editor`), with NO person on the row (`user_id` NULL), `issued_by` the person
 * who authorised it, at this installation's API (`audience`, `scope`); the caller pairs it with a refresh family. ONE
 * statement: it is written only while that person is an `active` ordinary account (the read view `<read>.users`; never a
 * test account or test user, which could otherwise reach through it what they may not themselves) and holds at least that
 * level on the live group (./rules `groupLevelHeldSql`), so a refresh re-checks the rule by minting through here.
 * Otherwise nothing is written and `group_level_not_held` (403) answers, whatever the reason (an unknown group too).
 */
export async function mintGroupSignIn(t: IdentityTables, q: Queryable, readSchema: string, input: {issuedBy: string; groupId: string; role: 'member' | 'editor'; expiresInMs: number; audience: string; scope: string}): Promise<MintedIdentityToken> {
  const ms = input.expiresInMs;
  if (!Number.isFinite(ms) || ms < MIN_TOKEN_TTL_MS || ms > MAX_TOKEN_TTL_MS) throw new IdentityError('invalid_expiry', 400);
  if (input.role !== 'member' && input.role !== 'editor') throw new IdentityError('invalid_group_role', 400);
  if (!/^[a-z_][a-z0-9_]*$/.test(readSchema)) throw new Error('identity: the read schema is not a plain identifier');
  const id = tokenId(), token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ms).toISOString(), name = `group-${input.role}`;
  const minted = await q.query<{id: string}>(`INSERT INTO ${t.tokens} (id, name, token_hash, user_id, expires_at, audience, scope, issued_by, group_id, group_role)
    SELECT $1, $2, $3, NULL, $4, $5, $6, $7::text, $8::text, $9::text
     WHERE COALESCE((SELECT issuer.active AND issuer.kind = 'account' AND NOT issuer.test_account FROM ${readSchema}.users issuer WHERE issuer.id = $7::text), false)
       AND EXISTS (SELECT 1 FROM ${t.groups} g WHERE g.id = $8::text AND g.deleted_at IS NULL)
       AND ${groupLevelHeldSql(t, '$7::text', '$8::text', '$9::text')}
    RETURNING id`, [id, name, sha256(token), expiresAt, input.audience, input.scope, input.issuedBy, input.groupId, input.role]);
  if (!minted.rows.length) throw new IdentityError('group_level_not_held', 403);
  return {id, name, token, expiresAt};
}

/**
 * A SERVICE'S SIGN-IN AS A GROUP (contracts service-audiences `GROUP_SIGN_IN_PATH`): an access token whose principal is
 * the group an approval names, at the approval's level, with no person on the row, `issued_by` the service and
 * `grant_id` the approval, at this installation's API, with no refresh token, for at most a day
 * (SERVICE_GROUP_SIGN_IN_MAX_TTL_MS). ONE statement: written only while the approval `grantId` names `service` at the
 * origin it is configured at now (`origin`) and still stands (./rules `serviceGrantStandsSql`); otherwise nothing is
 * written and `grant_refused` (403) answers, whatever the reason. Its liveness after that is the approval's
 * (./rules `groupSignInLiveSql`) and its service's configuration (../identity/bearer).
 */
export async function mintServiceGroupSignIn(t: IdentityTables, q: Queryable, input: {grantId: string; service: string; origin: string; expiresInMs: number; audience: string; scope: string}): Promise<MintedIdentityToken & {groupId: string; role: 'member' | 'editor'}> {
  const ms = input.expiresInMs;
  if (!Number.isFinite(ms) || ms < MIN_TOKEN_TTL_MS || ms > SERVICE_GROUP_SIGN_IN_MAX_TTL_MS) throw new IdentityError('invalid_expiry', 400);
  const id = tokenId(), token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ms).toISOString(), name = `service-${input.service}`;
  const minted = await q.query<{group_id: string; group_role: 'member' | 'editor'}>(`INSERT INTO ${t.tokens} (id, name, token_hash, user_id, expires_at, audience, scope, issued_by, group_id, group_role, grant_id)
    SELECT $1, $2, $3, NULL, $4, $5, $6, g.service_id, g.group_id, g.role, g.id FROM ${t.group_sign_in_grants} g
     WHERE g.id = $7 AND g.service_id = $8 AND g.service_origin = $9 AND ${serviceGrantStandsSql('g', t)}
    RETURNING group_id, group_role`, [id, name, sha256(token), expiresAt, input.audience, input.scope, input.grantId, input.service, input.origin]);
  const row = minted.rows[0];
  if (!row) throw new IdentityError('grant_refused', 403);
  return {id, name, token, expiresAt, groupId: row.group_id, role: row.group_role};
}

/**
 * A SERVICE'S OWN APPROVALS (contracts service-audiences `GROUP_SIGN_IN_GRANTS_PATH`): every approval naming `service`
 * at the origin it is configured at now that still stands (./rules `serviceGrantStandsSql`), oldest first, with its
 * group's handle and name: exactly the approvals `mintServiceGroupSignIn` would issue under. Never another service's.
 */
export async function listServiceGroupSignInGrants(t: IdentityTables, q: Queryable, input: {service: string; origin: string}): Promise<ServiceGroupSignInGrant[]> {
  return (await q.query<ServiceGroupSignInGrant>(`SELECT g.id, g.group_id, gg.handle AS group_handle, gg.name AS group_name, g.role, g.created_at AS approved_at
    FROM ${t.group_sign_in_grants} g JOIN ${t.groups} gg ON gg.id = g.group_id
    WHERE g.service_id = $1 AND g.service_origin = $2 AND ${serviceGrantStandsSql('g', t)} ORDER BY g.created_at, g.id`, [input.service, input.origin])).rows
    .map(row => ({...row, approved_at: new Date(row.approved_at).toISOString()}));
}

type AccountMethods = Pick<IdentityService, 'syncProfile' | 'createUser' | 'ensureUsername' | 'setProfileNames' | 'setUsername' | 'setImageKey' | 'confirmWelcome' | 'setAutoAcceptMentions'
  | 'createTestUser' | 'eraseTestUser' | 'mintToken' | 'ensureWebToken' | 'findToken' | 'revokeToken' | 'touchToken' | 'setTokenHarness' | 'markRequestAuthority'>;

export async function writeDisplayName(tx: Queryable, t: IdentityTables, authSchema: string, userId: string, name: string) {
  await tx.query(`UPDATE ${t.users} SET name=$2 WHERE id=$1 AND name IS DISTINCT FROM $2`, [userId, name]);
  // An installation with only the identity store has no Better Auth table.
  if (!(await tx.query('SELECT to_regclass($1) AS relation', [authSchema + '."user"'])).rows[0]?.relation) return;
  await tx.query(`UPDATE ${authSchema}."user" SET name=$2,"updatedAt"=now() WHERE id=$1 AND name IS DISTINCT FROM $2`, [userId, name]);
}

export function accountMethods(db: TransactionalQueryable, t: IdentityTables, authSchema = 'auth'): AccountMethods {
  const userById = async (q: Queryable, id: string, lock = false) =>
    (await q.query<IdentityUserRow>(`SELECT ${USER_COLS} FROM ${t.users} WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0] ?? null;

  async function ensureUsername({userId}: {userId: string}): Promise<IdentityUserRow | null> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = randomSuffix();
      try {
        return await db.transaction(async tx => {
          const user = await userById(tx, userId, true);
          if (!user || user.username || user.kind !== 'account' || !user.email) return user;
          const handle = `${usernameFromEmail(user.email)}_${suffix}`;
          await reserveHandle(t, tx, handle, 'user', userId);
          return (await tx.query<IdentityUserRow>(`UPDATE ${t.users} SET username=$2 WHERE id=$1 AND username IS NULL RETURNING ${USER_COLS}`, [userId, handle])).rows[0] ?? user;
        });
      } catch (error) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }
    }
    throw new Error('could not assign a username');
  }

  const setProfileNames: AccountMethods['setProfileNames'] = async ({userId, name, username: requested}) => {
    const username = requested?.toLowerCase().trim();
    if (username !== undefined && !isValidHandle(username)) return {error:'invalid'};
    if (name !== undefined && !displayName(name)) return {error:'invalid_name'};
    try {
      return await db.transaction(async tx => {
        const user = await userById(tx, userId, true);
        if (!user || (name !== undefined && user.kind !== 'account')) return {error:'invalid'} as const;
        if (username !== undefined) {
          await reserveHandle(t, tx, username, 'user', userId);
          await tx.query(`UPDATE ${t.users} SET username=$2 WHERE id=$1`, [userId, username]);
        }
        if (name !== undefined) await writeDisplayName(tx, t, authSchema, userId, name.trim());
        return {ok:true} as const;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return {error:'taken'};
      throw error;
    }
  };

  return {
    async syncProfile({userId, email, testAccount}) {
      const address = email.trim().toLowerCase();
      if (!address) return {user: await userById(db, userId)};
      try {
        // A NEW person starts with the welcome page pending (and a test-domain row marked a test account); an
        // existing row keeps both and only follows the address.
        await db.query(`INSERT INTO ${t.users} AS u (id, email, welcome_pending, test_account) VALUES ($1, $2, true, $3)
          ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email WHERE u.email IS DISTINCT FROM EXCLUDED.email`, [userId, address, testAccount]);
      } catch (error) {
        const held = (await db.query<{id: string}>(`SELECT id FROM ${t.users} WHERE email = $1`, [address])).rows[0];
        if (held && held.id !== userId) throw new IdentityError('duplicate_email', 409, undefined, held.id);
        throw error;
      }
      const user = await userById(db, userId);
      return {user: user && !user.username ? await ensureUsername({userId}) : user};
    },
    async createUser({email, name}) {
      return (await db.query<IdentityUserRow>(`INSERT INTO ${t.users} (id, email, name) VALUES ($1, $2, $3) RETURNING ${USER_COLS}`,
        ['usr_' + internalId(), email.toLowerCase().trim(), name ?? null])).rows[0]!;
    },
    ensureUsername,
    setProfileNames,
    async setUsername({userId, username}) {
      const result = await setProfileNames({userId, username});
      if ('error' in result) return {error:result.error === 'taken' ? 'taken' : 'invalid'};
      return {ok:true, username:username.toLowerCase().trim()};
    },
    async setImageKey({userId, key}) {
      return db.transaction(async tx => {
        const previous = (await tx.query<{image_key: string | null}>(`SELECT image_key FROM ${t.users} WHERE id = $1 FOR UPDATE`, [userId])).rows[0]?.image_key ?? null;
        if (previous !== key && (previous || key)) await tx.query(`UPDATE ${t.users} SET image_key = $1 WHERE id = $2`, [key, userId]);
        return {previous};
      });
    },
    async confirmWelcome({userId}) { await db.query(`UPDATE ${t.users} SET welcome_pending = false WHERE id = $1`, [userId]); },
    async setAutoAcceptMentions({userId, autoAccept}) { await db.query(`UPDATE ${t.users} SET auto_accept_mentions=$2 WHERE id=$1`, [userId, autoAccept]); },
    async createTestUser({parentId, label, ttlMs, limit, tokenName}) {
      return db.transaction(async tx => {
        // The parent's row serializes its mints, so the cap counted below holds across concurrent ones.
        if (!(await tx.query(`SELECT id FROM ${t.users} WHERE id=$1 AND kind='account' FOR UPDATE`, [parentId])).rows.length) return null;
        const live = Number((await tx.query<{n: string}>(`SELECT count(*) AS n FROM ${t.users} WHERE parent_user_id = $1 AND kind = 'testuser' AND (expires_at IS NULL OR expires_at > now())`, [parentId])).rows[0]!.n);
        if (live >= limit) return null;
        const id = 'usr_' + internalId();
        const row = (await tx.query<{created_at: string; expires_at: string}>(`INSERT INTO ${t.users} (id, email, kind, parent_user_id, expires_at, name)
          VALUES ($1, NULL, 'testuser', $2, $3, $4) RETURNING created_at, expires_at`, [id, parentId, new Date(Date.now() + ttlMs).toISOString(), label])).rows[0]!;
        const token = await insertToken(t, tx, {name: tokenName, userId: id, expiresInMs: ttlMs});
        return {id, ...row, tokenId: token.id, token: token.token};
      });
    },
    async eraseTestUser({userId}) {
      return db.transaction(async tx => {
        if (!(await tx.query(`SELECT id FROM ${t.users} WHERE id = $1 AND kind = 'testuser' FOR UPDATE`, [userId])).rows.length) return false;
        await tx.query(`DELETE FROM ${t.tokens} WHERE user_id = $1`, [userId]);
        await tx.query(`DELETE FROM ${t.group_members} WHERE user_id = $1`, [userId]);
        await tx.query(`DELETE FROM ${t.handle_reservations} WHERE kind = 'user' AND subject_id = $1`, [userId]);
        await tx.query(`DELETE FROM ${t.users} WHERE id = $1`, [userId]);
        return true;
      });
    },
    mintToken: input => insertToken(t, db, input),
    async ensureWebToken({userId}) {
      return db.transaction(async tx => {
        // The account row serializes the first mint, so an account holds one 'web' token.
        await tx.query(`SELECT id FROM ${t.users} WHERE id=$1 FOR UPDATE`, [userId]);
        const existing = (await tx.query<{id: string}>(`SELECT id FROM ${t.tokens} WHERE user_id = $1 AND name = 'web' AND deleted_at IS NULL LIMIT 1`, [userId])).rows[0];
        if (existing) return {id: existing.id, minted: false};
        return {id: (await insertToken(t, tx, {name: 'web', userId, expiresInMs: null})).id, minted: true};
      });
    },
    async findToken({hash}) {
      if (!/^[0-9a-f]{64}$/.test(hash)) return null;
      const row = (await db.query<{id: string; user_id: string | null; client_harness: string | null; audience: string | null; group_id: string | null}>(
        `SELECT id, user_id, client_harness, audience, group_id FROM ${t.tokens} WHERE token_hash = $1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > now())`, [hash])).rows[0];
      return row ? {id: row.id, userId: row.user_id, clientHarness: row.client_harness, audience: row.audience, groupId: row.group_id} : null;
    },
    async revokeToken({id, userId}) {
      // A person's own token, or a group's sign-in they authorised (contracts identity-service `GROUP_SIGN_IN_RULE`).
      const row = (await db.query<{name: string | null}>(`UPDATE ${t.tokens} SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL${userId === undefined ? '' : ' AND (user_id = $2 OR (group_id IS NOT NULL AND grant_id IS NULL AND issued_by = $2))'} RETURNING name`,
        userId === undefined ? [id] : [id, userId])).rows[0];
      return row ? {name: row.name} : null;
    },
    async touchToken({id}) {
      await db.query(`UPDATE ${t.tokens} SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '60 seconds')`, [id]);
    },
    async setTokenHarness({id, harness}) { await db.query(`UPDATE ${t.tokens} SET client_harness = $2 WHERE id = $1`, [id, harness]); },
    async markRequestAuthority({prefix}) {
      if (!prefix || prefix.length > 256) throw new IdentityError('request_authority_prefix_invalid', 400);
      await db.query(`UPDATE ${t.tokens} SET request_authority=true WHERE left(name,length($1))=$1 AND request_authority=false`, [prefix]);
    },
  };
}

