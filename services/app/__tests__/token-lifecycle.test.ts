/**
 * THE TOKEN LIFECYCLE (tok-p1) — through the REAL handlers and the real module, no proxy, no mocks.
 *
 *   mint      → expires_at = now + 6 h by default; the mint answers expiresAt; a caller may ask for 1–720 h
 *   status    → derived from the row, never stored twice: revoked > expired > active; NULL expires_at never expires
 *   resolve   → an expired token is NOTHING on both paths (bearer + cookie id), exactly like a revoked one
 *   claim     → an expired token's artifacts transfer; the token is NOT reactivated (a test, not an implication)
 *   touch     → last_used_at is stamped where the app first trusts a token-bearing actor, sampled per minute
 *   reject    → POST /api/tokens/reject revokes a cookie-held token and rewrites the cookie without it
 *
 * Seeded RED by the orchestrator. The agent makes it green without changing a single expectation.
 */
import { describe, expect, it } from 'vitest';
import { claimTokenById, createUser } from '@/lib/users';
import { createArtifact } from '@/lib/artifacts';
import {
  DEFAULT_TOKEN_TTL_MS,
  TOUCH_INTERVAL_MS,
  ensureUserToken,
  listTokensByUser,
  mintToken,
  resolveToken,
  resolveTokenById,
  tokenStatus,
  touchToken,
} from '@/lib/tokens';
import { decodeAgentSession } from '@/lib/agent-session';
import { POST as mintAnonymous } from '@/app/api/tokens/anonymous/route';
import { POST as reject } from '@/app/api/tokens/reject/route';
import { GET as listArtifacts } from '@/app/api/artifacts/route';
import { agentCookie, cookieValue, request, useAppHarness } from './harness';

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
  it('a minted token expires six hours from now by default, and the mint says so', async () => {
    const before = Date.now();
    const res = await mintAnonymous(request('/api/tokens/anonymous', { method: 'POST' }));
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(typeof body.expiresAt).toBe('string');
    const at = Date.parse(body.expiresAt as string);
    expect(Math.abs(at - (before + DEFAULT_TOKEN_TTL_MS))).toBeLessThan(5_000);
    const stored = await row(body.id as string);
    expect(Math.abs(Date.parse(stored.expires_at!) - at)).toBeLessThan(1_000);
  });

  it('expiresInHours is honoured inside [1, 720] and refused outside it', async () => {
    const one = await json(await mintAnonymous(request('/api/tokens/anonymous', { method: 'POST', json: { expiresInHours: 1 } })));
    expect(Math.abs(Date.parse(one.expiresAt as string) - (Date.now() + HOUR))).toBeLessThan(5_000);
    const month = await json(await mintAnonymous(request('/api/tokens/anonymous', { method: 'POST', json: { expiresInHours: 720 } })));
    expect(Math.abs(Date.parse(month.expiresAt as string) - (Date.now() + 720 * HOUR))).toBeLessThan(5_000);
    for (const bad of [0.5, 721, -1, 'soon']) {
      const res = await mintAnonymous(request('/api/tokens/anonymous', { method: 'POST', json: { expiresInHours: bad } }));
      expect(res.status, `expiresInHours=${bad}`).toBe(400);
    }
  });

  it("the module's own mint carries the same default and range", async () => {
    const t = await mintToken('t');
    expect(Math.abs(Date.parse(t.expiresAt!) - (Date.now() + DEFAULT_TOKEN_TTL_MS))).toBeLessThan(5_000);
    await expect(mintToken('t', null, undefined, { expiresInMs: HOUR / 2 })).rejects.toThrow(RangeError);
    await expect(mintToken('t', null, undefined, { expiresInMs: 31 * 24 * HOUR })).rejects.toThrow(RangeError);
    const never = await mintToken('t', null, undefined, { expiresInMs: null });
    expect(never.expiresAt).toBeNull();
  });

  it("the account's 'web' token never expires — it is the browser's own credential, not an agent's", async () => {
    const user = await createUser({ email: 'web@example.com' });
    const id = await ensureUserToken(user.id);
    expect((await row(id)).expires_at).toBeNull();
    expect(await ensureUserToken(user.id)).toBe(id);
  });
});

describe('status: derived, never stored twice', () => {
  const now = Date.parse('2026-09-01T12:00:00Z');
  it('active, expired, revoked — and revoked wins over expired', () => {
    expect(tokenStatus({ deleted_at: null, expires_at: new Date(now + 1_000).toISOString() }, now)).toBe('active');
    expect(tokenStatus({ deleted_at: null, expires_at: new Date(now - 1_000).toISOString() }, now)).toBe('expired');
    expect(tokenStatus({ deleted_at: new Date(now - 5_000).toISOString(), expires_at: new Date(now + 1_000).toISOString() }, now)).toBe('revoked');
    expect(tokenStatus({ deleted_at: new Date(now - 5_000).toISOString(), expires_at: new Date(now - 1_000).toISOString() }, now)).toBe('revoked');
  });
  it('a NULL expires_at never expires (grandfathered rows from before this column)', () => {
    expect(tokenStatus({ deleted_at: null, expires_at: null }, now)).toBe('active');
    expect(tokenStatus({ deleted_at: null, expires_at: null }, now + 10 * 365 * 24 * HOUR)).toBe('active');
  });
  it('accepts Date values as the driver may hand them back', () => {
    expect(tokenStatus({ deleted_at: null, expires_at: new Date(now - 1) }, now)).toBe('expired');
  });
});

describe('resolve: expired is nothing, on both paths', () => {
  it('an expired token resolves to null by secret and by id; a grandfathered NULL still resolves', async () => {
    const t = await mintToken('t');
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

describe('claim: ownership transfers, usability never returns', () => {
  it('claiming an EXPIRED held token moves its artifacts to the account and leaves the token expired', async () => {
    const t = await mintToken('draft');
    const artifact = await createArtifact(t.id, null, { format: 'markup', content: '', source: '<div />', meta: {}, title: 'draft', description: null });
    await setExpiry(t.id, -60_000);
    const user = await createUser({ email: 'claimer@example.com' });
    const claimed = await claimTokenById(user.id, t.id);
    expect(claimed?.claimedArtifacts).toBe(1);
    const db = await harness.db();
    const owner = (await db.query<{ user_id: string | null }>('SELECT user_id FROM artifacts WHERE id = $1', [artifact.id])).rows[0];
    expect(owner?.user_id).toBe(user.id);
    const after = await row(t.id);
    expect(after.user_id).toBe(user.id);
    expect(tokenStatus(after)).toBe('expired');
    expect(await resolveTokenById(t.id)).toBeNull();
    expect(await resolveToken(t.token)).toBeNull();
  });
});

describe('touch: last_used_at, sampled', () => {
  it('a token-bearing actor the app trusts stamps last_used_at once, then at most once per interval', async () => {
    const t = await mintToken('agent');
    expect((await row(t.id)).last_used_at).toBeNull();
    const actor = { credential: 'bearer' as const, tokenId: t.id };
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

  it('touchToken itself never throws for an unknown id', async () => {
    await expect(touchToken('tok_doesnotexist')).resolves.toBeUndefined();
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

describe('reject: POST /api/tokens/reject', () => {
  it('revokes a held token and rewrites the cookie without it, keeping the others in order', async () => {
    const a = await mintToken('a');
    const b = await mintToken('b');
    const res = await reject(request('/api/tokens/reject', { method: 'POST', cookie: await agentCookie([a.id, b.id]), json: { tokenId: a.id } }));
    expect(res.status).toBe(204);
    const { value } = cookieValue(res);
    expect(await decodeAgentSession(value)).toEqual({ tokenIds: [b.id] });
    expect(await resolveTokenById(a.id)).toBeNull();
    expect(tokenStatus(await row(a.id))).toBe('revoked');
    expect(await resolveTokenById(b.id)).not.toBeNull();
  });

  it('rejecting the last held token clears the cookie', async () => {
    const a = await mintToken('a');
    const res = await reject(request('/api/tokens/reject', { method: 'POST', cookie: await agentCookie([a.id]), json: { tokenId: a.id } }));
    expect(res.status).toBe(204);
    expect(cookieValue(res).cleared).toBe(true);
    expect(await resolveTokenById(a.id)).toBeNull();
  });

  it('404 when the cookie does not hold the id, and nothing is revoked', async () => {
    const a = await mintToken('a');
    const b = await mintToken('b');
    const res = await reject(request('/api/tokens/reject', { method: 'POST', cookie: await agentCookie([b.id]), json: { tokenId: a.id } }));
    expect(res.status).toBe(404);
    expect(await resolveTokenById(a.id)).not.toBeNull();
    const none = await reject(request('/api/tokens/reject', { method: 'POST', json: { tokenId: a.id } }));
    expect(none.status).toBe(404);
  });

  it("a token claimed by ANOTHER account is never revoked here; the owner's own session may", async () => {
    const owner = await createUser({ email: 'owner@example.com' });
    const c = await mintToken('c', owner.id);
    const cookie = await agentCookie([c.id]);
    const stranger = await reject(request('/api/tokens/reject', { method: 'POST', cookie, json: { tokenId: c.id } }));
    expect(stranger.status).toBe(404);
    expect(await resolveTokenById(c.id)).not.toBeNull();
    const asOwner = await reject(request('/api/tokens/reject', {
      method: 'POST',
      cookie,
      json: { tokenId: c.id },
      actor: { credential: 'session', userId: owner.id, email: 'owner@example.com', emailVerified: true },
    }));
    expect(asOwner.status).toBe(204);
    expect(await resolveTokenById(c.id)).toBeNull();
  });

  it('refuses a cross-site request with 403, like claim', async () => {
    const a = await mintToken('a');
    const res = await reject(request('/api/tokens/reject', { method: 'POST', cookie: await agentCookie([a.id]), origin: 'https://evil.example', json: { tokenId: a.id } }));
    expect(res.status).toBe(403);
    expect(await resolveTokenById(a.id)).not.toBeNull();
  });
});
