/** Agent bearer tokens: mint, resolve, revoke, expiry, liveness and sampled usage stamps. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGuestOwner, useAppHarness } from '@/__tests__/harness';
import { DEFAULT_TOKEN_TTL_MS, MAX_TOKEN_TTL_MS, MIN_TOKEN_TTL_MS, createUser, ensureUserToken, identityForUser, listTokensByUser, mintToken, resolveToken, resolveTokenById, revokeHeldToken, revokeToken, sourcedTokenName, tokenStatus, touchToken, withAccountToken } from '@/lib/accounts';
import { LIVE_TOKEN_SQL, TOUCH_INTERVAL_MS } from '@/lib/accounts/tokens';
import { getDb } from '@/lib/platform';

const harness = useAppHarness();
afterEach(() => { vi.useRealTimers(); });

const account = (email = 'owner@example.test') => createUser({ email });
const tokenRow = async (id: string) =>
  (await (await getDb()).query<{ token_hash: string; user_id: string | null; expires_at: string | null; deleted_at: string | null; last_used_at: string | null }>(
    'SELECT token_hash, user_id, expires_at, deleted_at, last_used_at FROM tokens WHERE id = $1', [id])).rows[0]!;
/** Mint a token whose lifetime already ran out: the clock is set back past its shortest TTL. Only Date is faked. */
async function mintExpired(userId: string | null): Promise<{ id: string; token: string }> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() - MIN_TOKEN_TTL_MS - 60_000);
  try { return await mintToken('stale', userId, undefined, { expiresInMs: MIN_TOKEN_TTL_MS }); } finally { vi.useRealTimers(); }
}

describe('lifetimes', () => {
  // Pure: no rows, so the describe skips the per-test wipe.
  harness.shared(async () => undefined);
  it('default six hours, shortest one hour, longest a year, touch sampled per minute', () => {
    expect(DEFAULT_TOKEN_TTL_MS).toBe(6 * 60 * 60 * 1000);
    expect(MIN_TOKEN_TTL_MS).toBe(60 * 60 * 1000);
    expect(MAX_TOKEN_TTL_MS).toBe(365 * 24 * 60 * 60 * 1000);
    expect(TOUCH_INTERVAL_MS).toBe(60 * 1000);
    expect(DEFAULT_TOKEN_TTL_MS).toBeGreaterThanOrEqual(MIN_TOKEN_TTL_MS);
    expect(DEFAULT_TOKEN_TTL_MS).toBeLessThanOrEqual(MAX_TOKEN_TTL_MS);
  });

  it('names a machine-minted token by its source plus a short random suffix', () => {
    const a = sourcedTokenName('oauth'), b = sourcedTokenName('oauth');
    expect(a).toMatch(/^oauth-[0-9a-f]{6}$/);
    expect(a).not.toBe(b);
  });
});

describe('mint', () => {
  it('returns the plaintext once, stores only its sha256 and expires after the default TTL', async () => {
    const user = await account();
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = Date.now();
    vi.setSystemTime(now);
    const minted = await mintToken('cli', user.id);
    vi.useRealTimers();
    expect(minted.token).toMatch(/^mx_[A-Za-z0-9_-]{43}$/);
    expect(minted).toMatchObject({ name: 'cli', expiresAt: new Date(now + DEFAULT_TOKEN_TTL_MS).toISOString() });
    const row = await tokenRow(minted.id);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.token_hash).not.toContain(minted.token);
    expect(row.user_id).toBe(user.id);
    expect(new Date(row.expires_at!).getTime()).toBe(now + DEFAULT_TOKEN_TTL_MS);
    const other = await mintToken(undefined, user.id);
    expect(other.name).toBeNull();
    expect(other.token).not.toBe(minted.token);
  });

  it('accepts exactly the [MIN, MAX] range or null, and refuses anything else without writing a row', async () => {
    const user = await account();
    await expect(mintToken('min', user.id, undefined, { expiresInMs: MIN_TOKEN_TTL_MS })).resolves.toMatchObject({ name: 'min' });
    await expect(mintToken('max', user.id, undefined, { expiresInMs: MAX_TOKEN_TTL_MS })).resolves.toMatchObject({ name: 'max' });
    await expect(mintToken('forever', user.id, undefined, { expiresInMs: null })).resolves.toMatchObject({ expiresAt: null });
    for (const expiresInMs of [MIN_TOKEN_TTL_MS - 1, MAX_TOKEN_TTL_MS + 1, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(mintToken('bad', user.id, undefined, { expiresInMs }), String(expiresInMs)).rejects.toThrow(RangeError);
    }
    const names = (await (await getDb()).query<{ name: string }>('SELECT name FROM tokens ORDER BY name')).rows.map((r) => r.name);
    expect(names).toEqual(['forever', 'max', 'min']);
  });

});

describe('resolve', () => {
  it('resolves a live account token by secret and by id', async () => {
    const user = await account();
    const minted = await mintToken('cli', user.id);
    const expected = { id: minted.id, userId: user.id, clientHarness: null };
    expect(await resolveToken(minted.token)).toEqual(expected);
    expect(await resolveTokenById(minted.id)).toEqual(expected);
  });

  it('answers null for malformed, unknown and revoked tokens alike', async () => {
    const user = await account();
    const minted = await mintToken('cli', user.id);
    for (const presented of ['', 'mx_short', `xx_${'a'.repeat(43)}`, `mx_${'a'.repeat(43)}`, `${minted.token}!`]) {
      expect(await resolveToken(presented), presented).toBeNull();
    }
    expect(await resolveTokenById('tok_unknown')).toBeNull();
    expect(await revokeToken(minted.id)).toBe(true);
    expect(await resolveToken(minted.token)).toBeNull();
    expect(await resolveTokenById(minted.id)).toBeNull();
  });

  it('an expired token resolves to nothing on both paths; a non-expiring one never expires', async () => {
    const user = await account();
    const stale = await mintExpired(user.id);
    expect(await resolveToken(stale.token)).toBeNull();
    expect(await resolveTokenById(stale.id)).toBeNull();
    expect(tokenStatus(await tokenRow(stale.id))).toBe('expired');
    const web = await mintToken('web', user.id, undefined, { expiresInMs: null });
    expect(await resolveToken(web.token)).toMatchObject({ id: web.id });
  });

  it('a secret only authenticates an account: anonymous and guest tokens resolve by id but not by secret', async () => {
    const anonymous = await mintToken('anon', null);
    expect(await resolveToken(anonymous.token)).toBeNull();
    expect(await resolveTokenById(anonymous.id)).toEqual({ id: anonymous.id, userId: null, clientHarness: null });
    const guest = await createGuestOwner();
    expect(await resolveTokenById(guest.tokenId)).toMatchObject({ id: guest.tokenId, userId: guest.userId });
  });
});

describe('status', () => {
  // Pure: no rows, so the describe skips the per-test wipe.
  harness.shared(async () => undefined);
  it('derives active, expired and revoked, revoked winning; null expiry never expires', () => {
    const now = Date.UTC(2026, 0, 1);
    const at = (offset: number) => new Date(now + offset).toISOString();
    expect(tokenStatus({ deleted_at: null, expires_at: at(1) }, now)).toBe('active');
    expect(tokenStatus({ deleted_at: null, expires_at: at(0) }, now)).toBe('expired');
    expect(tokenStatus({ deleted_at: null, expires_at: at(-1) }, now)).toBe('expired');
    expect(tokenStatus({ deleted_at: at(-5), expires_at: at(-1) }, now)).toBe('revoked');
    expect(tokenStatus({ deleted_at: at(-5), expires_at: at(1) }, now)).toBe('revoked');
    expect(tokenStatus({ deleted_at: null, expires_at: null }, now)).toBe('active');
    expect(tokenStatus({ deleted_at: null, expires_at: new Date(now - 1) }, now)).toBe('expired');
  });
});

describe('LIVE_TOKEN_SQL', () => {
  it('admits exactly the unrevoked, unexpired rows, and stays unambiguous joined with artifacts', async () => {
    const user = await account();
    const live = await mintToken('live', user.id);
    const forever = await mintToken('forever', user.id, undefined, { expiresInMs: null });
    const revoked = await mintToken('revoked', user.id);
    await revokeToken(revoked.id);
    const stale = await mintExpired(user.id);
    const db = await getDb();
    const ids = (await db.query<{ id: string }>(`SELECT id FROM tokens WHERE ${LIVE_TOKEN_SQL}`)).rows.map((r) => r.id).sort();
    expect(ids).toEqual([live.id, forever.id].sort());
    expect(ids).not.toContain(stale.id);
    await db.query('INSERT INTO artifacts (id, token_id, user_id) VALUES ($1, $2, $3), ($4, $5, $3)', ['art_live', live.id, user.id, 'art_revoked', revoked.id]);
    const joined = await db.query<{ id: string }>(`SELECT artifacts.id FROM artifacts JOIN tokens ON tokens.id = artifacts.token_id WHERE ${LIVE_TOKEN_SQL}`);
    expect(joined.rows.map((r) => r.id)).toEqual(['art_live']);
  });
});

describe('revoke', () => {
  it('the operator revoke is true once, then false; unknown ids are false', async () => {
    const minted = await mintToken('cli', (await account()).id);
    expect(await revokeToken(minted.id)).toBe(true);
    expect(await revokeToken(minted.id)).toBe(false);
    expect(await revokeToken('tok_unknown')).toBe(false);
    expect((await tokenRow(minted.id)).deleted_at).not.toBeNull();
  });

  it('a held token is revoked when unclaimed or the caller\'s own, never when someone else owns it', async () => {
    const owner = await account('owner@example.test'), other = await account('other@example.test');
    const unclaimed = await mintToken('anon', null);
    const own = await mintToken('own', owner.id);
    const foreign = await mintToken('foreign', other.id);
    expect(await revokeHeldToken(unclaimed.id, null)).toBe(true);
    expect(await revokeHeldToken(own.id, owner.id)).toBe(true);
    expect(await revokeHeldToken(own.id, owner.id)).toBe(false);
    expect(await revokeHeldToken(foreign.id, owner.id)).toBe(false);
    expect(await revokeHeldToken(foreign.id, null)).toBe(false);
    expect((await tokenRow(foreign.id)).deleted_at).toBeNull();
  });
});

describe('the account\'s web token', () => {
  it('is minted once, never expires, is reused, and replaced only after revocation', async () => {
    const user = await account();
    const first = await ensureUserToken(user.id);
    expect(await ensureUserToken(user.id)).toBe(first);
    expect((await tokenRow(first)).expires_at).toBeNull();
    await revokeToken(first);
    const second = await ensureUserToken(user.id);
    expect(second).not.toBe(first);
  });

  it('withAccountToken keeps a presented token, else charges the web token, else nobody', async () => {
    const user = await account();
    const presented = identityForUser(user.id, 'tok_presented');
    expect(await withAccountToken(presented)).toEqual(presented);
    const session = identityForUser(user.id);
    expect(await withAccountToken(session)).toEqual({ ...session, tokenId: await ensureUserToken(user.id) });
    expect(await withAccountToken(identityForUser(null))).toBeNull();
  });
});

describe('list', () => {
  it('lists the account\'s unrevoked tokens, most recently used first, never-used newest first after them', async () => {
    const user = await account(), other = await account('other@example.test');
    const db = await getDb();
    const old = await mintToken('old', user.id), recent = await mintToken('recent', user.id), unused = await mintToken('unused', user.id);
    const revoked = await mintToken('revoked', user.id);
    await revokeToken(revoked.id);
    const stale = await mintExpired(user.id);
    await mintToken('theirs', other.id);
    await db.query("UPDATE tokens SET created_at = now() - interval '1 hour' WHERE id = $1", [stale.id]);
    await db.query("UPDATE tokens SET last_used_at = now() - interval '1 hour' WHERE id = $1", [old.id]);
    await db.query('UPDATE tokens SET last_used_at = now() WHERE id = $1', [recent.id]);
    await db.query("UPDATE tokens SET created_at = now() + interval '1 second' WHERE id = $1", [unused.id]);
    const listed = await listTokensByUser(user.id);
    // Expired tokens are listed (with their expires_at); only revocation removes one.
    expect(listed.map((t) => t.name)).toEqual(['recent', 'old', 'unused', 'stale']);
    expect(listed.every((t) => t.user_id === user.id && t.deleted_at === null)).toBe(true);
  });
});

describe('touch', () => {
  it('stamps last_used_at once, then not again inside the interval, then again after it; never throws', async () => {
    const minted = await mintToken('cli', (await account()).id);
    const db = await getDb();
    expect((await tokenRow(minted.id)).last_used_at).toBeNull();
    await touchToken(minted.id);
    const first = (await tokenRow(minted.id)).last_used_at;
    expect(first).not.toBeNull();
    await touchToken(minted.id);
    expect((await tokenRow(minted.id)).last_used_at).toEqual(first);
    // The interval is measured by the database clock, so age the stamp there.
    await db.query(`UPDATE tokens SET last_used_at = now() - interval '${TOUCH_INTERVAL_MS / 1000 + 1} seconds' WHERE id = $1`, [minted.id]);
    const aged = (await tokenRow(minted.id)).last_used_at;
    await touchToken(minted.id);
    expect(new Date((await tokenRow(minted.id)).last_used_at!).getTime()).toBeGreaterThan(new Date(aged!).getTime());
    await expect(touchToken('tok_unknown')).resolves.toBeUndefined();
  });
});
