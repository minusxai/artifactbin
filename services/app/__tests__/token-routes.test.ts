/**
 * THE APP OWNS TOKENS. Every token route is served by the app itself, driven here as the real handlers, no proxy:
 * the actor arrives ATTACHED to the Request (utils attachActor), exactly as the proxy hands it over.
 *
 * The only route that ISSUES one is `/api/internal/tokens`, which the proxy
 * spends after a human approved the CLI's device pairing (the operator's
 * `/api/tokens` aside). It is unreachable from outside — proxy parts
 * `internalBoundary` — so it is driven here the way the proxy drives it.
 */
import { describe, expect, it } from 'vitest';


import { createUser } from '@/lib/users';
import { mintToken } from '@/lib/tokens';
import { POST as mintAdmin } from '@/app/api/tokens/route';
import { DELETE as revokeAdmin } from '@/app/api/tokens/[id]/route';
import { POST as mintInternal } from '@/app/api/internal/tokens/route';
import { GET as listMine } from '@/app/api/my/tokens/route';
import { DELETE as revokeMine } from '@/app/api/my/tokens/[id]/route';
import { POST as adoptSession, DELETE as clearSession } from '@/app/api/session/token/route';
import { GET as listArtifacts } from '@/app/api/artifacts/route';
import { cookieValue, request } from './harness';
import { useAppHarness } from '@/__tests__/harness';

const harness = useAppHarness();

const ADMIN = 'admin-secret-for-tests';
process.env.ADMIN__SECRET = ADMIN;
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });
const json = (r: Response) => r.json() as Promise<Record<string, unknown>>;
type TokenRow = { id: string; status: string; expires_at: string | null; last_used_at: string | null };

describe('token routes served by the app', () => {
  it('POST /api/tokens mints with the admin secret and 404s without it', async () => {
    expect((await mintAdmin(request('/api/tokens', { method: 'POST', json: {} }))).status).toBe(404);
    const res = await mintAdmin(request('/api/tokens', { method: 'POST', token: ADMIN, json: { name: 't' } }));
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ token: expect.stringMatching(/^mx_/) });
  });
  it('POST /api/tokens applies the shared expiry contract and reports it', async () => {
    const res = await mintAdmin(request('/api/tokens', {
      method: 'POST',
      token: ADMIN,
      json: { name: 'short-job', expiresInHours: 2 },
    }));
    expect(res.status).toBe(201);
    const minted = await json(res);
    expect(Math.abs(Date.parse(minted.expiresAt as string) - (Date.now() + 2 * 60 * 60 * 1000))).toBeLessThan(5_000);

    const invalid = await mintAdmin(request('/api/tokens', {
      method: 'POST',
      token: ADMIN,
      json: { expiresInHours: 'tomorrow' },
    }));
    expect(invalid.status).toBe(400);
    expect(await json(invalid)).toEqual({ error: 'invalid_expiry' });
  });
  it('DELETE /api/tokens/:id revokes; a second call 404s', async () => {
    const { id } = await json(await mintAdmin(request('/api/tokens', { method: 'POST', token: ADMIN, json: {} })));
    expect((await revokeAdmin(request(`/api/tokens/${id}`, { method: 'DELETE', token: ADMIN }), params({ id: String(id) }))).status).toBe(204);
    expect((await revokeAdmin(request(`/api/tokens/${id}`, { method: 'DELETE', token: ADMIN }), params({ id: String(id) }))).status).toBe(404);
  });
  it('the internal mint issues anonymously, and binds to the user under a session actor', async () => {
    const anon = await json(await mintInternal(request('/api/internal/tokens', { method: 'POST' })));
    expect(anon.token).toMatch(/^mx_/);
    const user = await createUser({ email: 'a@example.com' });
    const owned = await json(await mintInternal(request('/api/internal/tokens', { method: 'POST', actor: { credential: 'session', userId: user.id, email: 'a@example.com', emailVerified: true } })));
    const { rows } = await (await harness.db()).query<{ user_id: string | null }>('SELECT user_id FROM tokens WHERE id = $1', [owned.id]);
    expect(rows[0]?.user_id).toBe(user.id);
  });
  it('only a session mint may create an API audience-bound access token', async () => {
    const grant = { audience: 'https://artifactbin.example/api', scope: 'artifacts' };
    expect((await mintInternal(request('/api/internal/tokens', { method: 'POST', json: grant }))).status).toBe(400);
    const user = await createUser({ email: 'oauth@example.com' });
    const actor = { credential: 'session' as const, userId: user.id, email: 'oauth@example.com', emailVerified: true };
    const minted = await json(await mintInternal(request('/api/internal/tokens', { method: 'POST', actor, json: grant })));
    const { rows } = await (await harness.db()).query<{ audience: string | null; scope: string | null }>('SELECT audience, scope FROM tokens WHERE id = $1', [minted.id]);
    expect(rows[0]).toEqual(grant);
    expect((await mintInternal(request('/api/internal/tokens',{method:'POST',actor,json:{...grant,audience:'https://artifactbin.example/mcp'}}))).status).toBe(400);
  });
  it('GET /api/my/tokens lists only this account\'s live tokens; 401 without a session', async () => {
    expect((await listMine(request('/api/my/tokens'))).status).toBe(401);
    const user = await createUser({ email: 'b@example.com' });
    const actor = { credential: 'session' as const, userId: user.id, email: 'b@example.com', emailVerified: true };
    await mintInternal(request('/api/internal/tokens', { method: 'POST', actor }));
    await mintInternal(request('/api/internal/tokens', { method: 'POST' }));
    const list = await json(await listMine(request('/api/my/tokens', { actor })));
    expect((list.tokens as unknown[]).length).toBe(1);
  });
  /*
   * What the Account page's tokens panel is fed, from my-tokens-shape.test.ts:
   * `status` is computed server-side (web code may not import lib/tokens), and the
   * order is most-recently-used first, then newest minted.
   */
  it('GET /api/my/tokens rows carry status, expires_at and last_used_at, last-used first', async () => {
    const user = await createUser({ email: 'mxmx_test_tokens@example.com' });
    const actor = { credential: 'session' as const, userId: user.id, email: user.email ?? '', emailVerified: true };
    const used = await mintToken('used', user.id);
    const expired = await mintToken('expired', user.id);
    const fresh = await mintToken('fresh', user.id);
    const db = await harness.db();
    await db.query('UPDATE tokens SET last_used_at = now() WHERE id = $1', [used.id]);
    await db.query("UPDATE tokens SET expires_at = now() - interval '1 minute' WHERE id = $1", [expired.id]);

    const res = await listMine(request('/api/my/tokens', { actor }));
    expect(res.status).toBe(200);
    const rows = ((await res.json()) as { tokens: TokenRow[] }).tokens;
    expect(rows.map((r) => r.id)).toEqual([used.id, fresh.id, expired.id]);
    for (const r of rows) expect(Object.keys(r)).toEqual(expect.arrayContaining(['status', 'expires_at', 'last_used_at']));
    expect(rows.find((r) => r.id === used.id)?.status).toBe('active');
    expect(rows.find((r) => r.id === expired.id)?.status).toBe('expired');
    expect(rows.find((r) => r.id === fresh.id)).toMatchObject({ status: 'active', last_used_at: null, expires_at: expect.any(String) });
  });
  it('GET /api/my/tokens shows the account\'s non-expiring web token as a null expiry, still active', async () => {
    const user = await createUser({ email: 'mxmx_test_web@example.com' });
    const actor = { credential: 'session' as const, userId: user.id, email: user.email ?? '', emailVerified: true };
    await mintToken('web', user.id, undefined, { expiresInMs: null });
    const rows = ((await (await listMine(request('/api/my/tokens', { actor }))).json()) as { tokens: TokenRow[] }).tokens;
    expect(rows[0]).toMatchObject({ status: 'active', expires_at: null });
  });
  it('DELETE /api/my/tokens/:id refuses another account\'s token with 404 and a cross-site request with 403', async () => {
    const a = await createUser({ email: 'c@example.com' }); const b = await createUser({ email: 'd@example.com' });
    const actorA = { credential: 'session' as const, userId: a.id, email: 'c@example.com', emailVerified: true };
    const actorB = { credential: 'session' as const, userId: b.id, email: 'd@example.com', emailVerified: true };
    const { id } = await json(await mintInternal(request('/api/internal/tokens', { method: 'POST', actor: actorA })));
    expect((await revokeMine(request(`/api/my/tokens/${id}`, { method: 'DELETE', actor: actorB }), params({ id: String(id) }))).status).toBe(404);
    expect((await revokeMine(request(`/api/my/tokens/${id}`, { method: 'DELETE', actor: actorA, origin: 'https://evil.example', headers: { host: 'localhost' } }), params({ id: String(id) }))).status).toBe(403);
    expect((await revokeMine(request(`/api/my/tokens/${id}`, { method: 'DELETE', actor: actorA }), params({ id: String(id) }))).status).toBe(204);
  });
  it('POST /api/session/token adopts a token into the agent cookie; DELETE clears it', async () => {
    const { token } = await json(await mintInternal(request('/api/internal/tokens', { method: 'POST' })));
    const res = await adoptSession(request('/api/session/token', { method: 'POST', json: { token } }));
    expect(res.status).toBe(204);
    expect(cookieValue(res).value).not.toBeNull();
    const cleared = await clearSession(request('/api/session/token', { method: 'DELETE' }));
    expect(cookieValue(cleared).cleared).toBe(true);
  });
  it('a token revoked here stops authorizing on the very next request', async () => {
    const { id, token } = await json(await mintInternal(request('/api/internal/tokens', { method: 'POST' })));
    expect((await listArtifacts(request('/api/artifacts', { token: String(token) }))).status).toBe(200);
    await revokeAdmin(request(`/api/tokens/${id}`, { method: 'DELETE', token: ADMIN }), params({ id: String(id) }));
    expect((await listArtifacts(request('/api/artifacts', { token: String(token) }))).status).toBe(401);
  });
});
