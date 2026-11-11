/**
 * ACCOUNTS, HANDLES AND TOKENS: the identity store's writes to `users`, `handle_reservations` and `tokens`.
 *
 * The app's row per person follows the actor's claims (`syncProfile`): created on first sight with the welcome page
 * pending, its email kept current, a handle assigned (`localpart_xxxx`, renameable). Handles are one namespace with
 * groups' (`reserveHandle`): a reservation is a tombstone, so a released or deleted name is never handed to someone
 * else silently. Tokens are prefix + 256 random bits, only the sha256 stored, soft revoked (`deleted_at`).
 */
import crypto from 'node:crypto';
import {IdentityError,MAX_TOKEN_TTL_MS,MIN_TOKEN_TTL_MS,isValidHandle,type IdentityService,type IdentityUserRow,type MintedIdentityToken,type Queryable,type TransactionalQueryable} from '@artifactbin/contracts';
import {internalId,isUniqueViolation,tokenId,type IdentityTables} from './tables';

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

type AccountMethods = Pick<IdentityService, 'syncProfile' | 'createUser' | 'ensureUsername' | 'setUsername' | 'setImageKey' | 'confirmWelcome' | 'setAutoAcceptMentions'
  | 'createTestUser' | 'eraseTestUser' | 'mintToken' | 'ensureWebToken' | 'revokeToken' | 'touchToken' | 'setTokenHarness' | 'markRequestAuthority'>;

export function accountMethods(db: TransactionalQueryable, t: IdentityTables): AccountMethods {
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
    async setUsername({userId, username: requested}) {
      const username = requested.toLowerCase().trim();
      if (!isValidHandle(username)) return {error: 'invalid'};
      try {
        return await db.transaction(async tx => {
          if (!await userById(tx, userId, true)) return {error: 'invalid'} as const;
          await reserveHandle(t, tx, username, 'user', userId);
          await tx.query(`UPDATE ${t.users} SET username=$2 WHERE id=$1`, [userId, username]);
          return {ok: true, username} as const;
        });
      } catch (error) {
        if (isUniqueViolation(error)) return {error: 'taken'};
        throw error;
      }
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
    async revokeToken({id, userId}) {
      const row = (await db.query<{name: string | null}>(`UPDATE ${t.tokens} SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL${userId === undefined ? '' : ' AND user_id = $2'} RETURNING name`,
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

