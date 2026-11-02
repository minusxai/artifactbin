import { mintAccountToken, setSession } from '@/__tests__/harness';
/**
 * THE TOKEN LIFECYCLE — through the REAL handlers and the real module, no proxy, no mocks.
 *
 *   mint      → expires_at = now + 6 h by default; the mint answers expiresAt; a caller may ask for 1–8760 h
 *   status    → derived from the row, never stored twice: revoked > expired > active; NULL expires_at never expires
 *   resolve   → an expired token is NOTHING on both paths (bearer + cookie id), exactly like a revoked one
 *   touch     → last_used_at is stamped where the app first trusts a token-bearing actor, sampled per minute
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '@/lib/accounts';
import { DEFAULT_TOKEN_TTL_MS, ensureUserToken, listTokensByUser, mintToken, resolveToken, resolveTokenById } from '@/lib/accounts';
import { TOUCH_INTERVAL_MS } from '@/lib/accounts/tokens';
import { POST as mintAnonymous } from '@/app/api/internal/tokens/route';
import { GET as listArtifacts } from '@/app/api/artifacts/route';
import { request, useAppHarness } from '@/__tests__/harness';

const json = (r: Response) => r.json() as Promise<Record<string, unknown>>;
const HOUR = 60 * 60 * 1000;
const harness = useAppHarness();
type Stamp = { expires_at: string | null; last_used_at: string | null; deleted_at: string | null; user_id: string | null };
const row = async (id: string): Promise<Stamp> =>
  (await (await harness.db()).query<Stamp>('SELECT expires_at, last_used_at, deleted_at, user_id FROM tokens WHERE id = $1', [id])).rows[0]!;
const setExpiry = async (id: string, msFromNow: number | null) => {
  const db = await harness.db();
  if (msFromNow === null) await db.query('UPDATE tokens SET expires_at = NULL WHERE id = $1', [id]);
  else await db.query('UPDATE tokens SET expires_at = $2 WHERE id = $1', [id, new Date(Date.now() + msFromNow).toISOString()]);
};
describe('mint: expiry is a property of every token', () => {
  beforeEach(async () => { const user = await createUser({email:'mxmx_test_token_mint@example.com'}); setSession({user:{id:user.id,email:user.email}}); });
  it('a minted token expires six hours from now by default, and the mint says so', async () => {
    const before = Date.now();
    const res = await mintAnonymous(request('/api/internal/tokens', { method: 'POST' }));
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(typeof body.expiresAt).toBe('string');
    const at = Date.parse(body.expiresAt as string);
    expect(Math.abs(at - (before + DEFAULT_TOKEN_TTL_MS))).toBeLessThan(5_000);
    const stored = await row(body.id as string);
    expect(Math.abs(Date.parse(stored.expires_at!) - at)).toBeLessThan(1_000);
  });

  it('expiresInHours is honoured inside [1, 8760] and refused outside it', async () => {
    const one = await json(await mintAnonymous(request('/api/internal/tokens', { method: 'POST', json: { expiresInHours: 1 } })));
    expect(Math.abs(Date.parse(one.expiresAt as string) - (Date.now() + HOUR))).toBeLessThan(5_000);
    const month = await json(await mintAnonymous(request('/api/internal/tokens', { method: 'POST', json: { expiresInHours: 720 } })));
    expect(Math.abs(Date.parse(month.expiresAt as string) - (Date.now() + 720 * HOUR))).toBeLessThan(5_000);
    const yearResponse = await mintAnonymous(request('/api/internal/tokens', { method: 'POST', json: { expiresInHours: 8760 } }));
    expect(yearResponse.status).toBe(201);
    const year = await json(yearResponse);
    expect(Math.abs(Date.parse(year.expiresAt as string) - (Date.now() + 8760 * HOUR))).toBeLessThan(5_000);
    for (const bad of [0.5, 8761, -1, 'soon']) {
      const res = await mintAnonymous(request('/api/internal/tokens', { method: 'POST', json: { expiresInHours: bad } }));
      expect(res.status, `expiresInHours=${bad}`).toBe(400);
    }
  });

  it("the account's 'web' token never expires — it is the browser's own credential, not an agent's", async () => {
    const user = await createUser({ email: 'web@example.com' });
    const id = await ensureUserToken(user.id);
    expect((await row(id)).expires_at).toBeNull();
    expect(await ensureUserToken(user.id)).toBe(id);
  });
});

describe('resolve: expired is nothing, on both paths', () => {
  it('an expired token resolves to null by secret and by id; a grandfathered NULL still resolves', async () => {
    const t = await mintAccountToken('t');
    expect(await resolveToken(t.token)).not.toBeNull();
    expect(await resolveTokenById(t.id)).not.toBeNull();
    await setExpiry(t.id, -1_000);
    expect(await resolveToken(t.token)).toBeNull();
    expect(await resolveTokenById(t.id)).toBeNull();
    await setExpiry(t.id, null);
    expect(await resolveToken(t.token)).not.toBeNull();
    expect(await resolveTokenById(t.id)).not.toBeNull();
    await setExpiry(t.id, 5_000);
    expect(await resolveToken(t.token)).not.toBeNull();
  });
});

describe('touch: last_used_at, sampled', () => {
  it('a token-bearing actor the app trusts stamps last_used_at once, then at most once per interval', async () => {
    const t = await mintAccountToken('agent');
    expect((await row(t.id)).last_used_at).toBeNull();
    const actor = { credential: 'bearer' as const, tokenId: t.id, userId: t.userId! };
    expect((await listArtifacts(request('/api/artifacts', { actor }))).status).toBe(200);
    const first = (await row(t.id)).last_used_at;
    expect(first).not.toBeNull();
    expect(Math.abs(Date.parse(first!) - Date.now())).toBeLessThan(5_000);

    const recent = new Date(Date.now() - TOUCH_INTERVAL_MS / 2).toISOString();
    await (await harness.db()).query('UPDATE tokens SET last_used_at = $2 WHERE id = $1', [t.id, recent]);
    await listArtifacts(request('/api/artifacts', { actor }));
    expect(Date.parse((await row(t.id)).last_used_at!)).toBe(Date.parse(recent));

    const stale = new Date(Date.now() - 2 * TOUCH_INTERVAL_MS).toISOString();
    await (await harness.db()).query('UPDATE tokens SET last_used_at = $2 WHERE id = $1', [t.id, stale]);
    await listArtifacts(request('/api/artifacts', { actor }));
    expect(Date.parse((await row(t.id)).last_used_at!)).toBeGreaterThan(Date.parse(stale));
  });

  it("the account's token list carries expires_at and last_used_at", async () => {
    const user = await createUser({ email: 'list@example.com' });
    await mintToken('mine', user.id);
    const [t] = await listTokensByUser(user.id);
    expect(t).toMatchObject({ expires_at: expect.any(String), last_used_at: null });
  });

  it('orders used tokens by last use, with never-used tokens after them', async () => {
    const user = await createUser({ email: 'ordered-list@example.com' });
    const olderUse = await mintToken('older-use', user.id);
    const newerUse = await mintToken('newer-use', user.id);
    const neverUsed = await mintToken('never-used', user.id);
    const db = await harness.db();
    await db.query('UPDATE tokens SET last_used_at = $2 WHERE id = $1', [olderUse.id, new Date(Date.now() - 120_000).toISOString()]);
    await db.query('UPDATE tokens SET last_used_at = $2 WHERE id = $1', [newerUse.id, new Date(Date.now() - 60_000).toISOString()]);

    expect((await listTokensByUser(user.id)).map((token) => token.id)).toEqual([
      newerUse.id,
      olderUse.id,
      neverUsed.id,
    ]);
  });
});
