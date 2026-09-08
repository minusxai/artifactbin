/**
 * THE APP OWNS TOKENS. Every token route is served by the app itself, driven here as the real handlers, no proxy:
 * the actor arrives ATTACHED to the Request (utils attachActor), exactly as the proxy hands it over.
 */
import { describe, expect, it } from 'vitest';


import { createUser } from '@/lib/users';
import { POST as mintAdmin } from '@/app/api/tokens/route';
import { DELETE as revokeAdmin } from '@/app/api/tokens/[id]/route';
import { POST as mintAnonymous } from '@/app/api/tokens/anonymous/route';
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
  it('POST /api/tokens/anonymous mints anonymously, and binds to the user under a session actor', async () => {
    const anon = await json(await mintAnonymous(request('/api/tokens/anonymous', { method: 'POST' })));
    expect(anon.token).toMatch(/^mx_/);
    const user = await createUser({ email: 'a@example.com' });
    const owned = await json(await mintAnonymous(request('/api/tokens/anonymous', { method: 'POST', actor: { credential: 'session', userId: user.id, email: 'a@example.com', emailVerified: true } })));
    const { rows } = await (await harness.db()).query<{ user_id: string | null }>('SELECT user_id FROM tokens WHERE id = $1', [owned.id]);
    expect(rows[0]?.user_id).toBe(user.id);
  });
  it('only a session mint may create an MCP audience-bound access token', async () => {
    const grant = { audience: 'https://artifactbin.example/mcp', scope: 'artifacts' };
    expect((await mintAnonymous(request('/api/tokens/anonymous', { method: 'POST', json: grant }))).status).toBe(400);
    const user = await createUser({ email: 'oauth@example.com' });
    const actor = { credential: 'session' as const, userId: user.id, email: 'oauth@example.com', emailVerified: true };
    const minted = await json(await mintAnonymous(request('/api/tokens/anonymous', { method: 'POST', actor, json: grant })));
    const { rows } = await (await harness.db()).query<{ audience: string | null; scope: string | null }>('SELECT audience, scope FROM tokens WHERE id = $1', [minted.id]);
    expect(rows[0]).toEqual(grant);
  });
  it('GET /api/my/tokens lists only this account\'s live tokens; 401 without a session', async () => {
    expect((await listMine(request('/api/my/tokens'))).status).toBe(401);
    const user = await createUser({ email: 'b@example.com' });
    const actor = { credential: 'session' as const, userId: user.id, email: 'b@example.com', emailVerified: true };
    await mintAnonymous(request('/api/tokens/anonymous', { method: 'POST', actor }));
    await mintAnonymous(request('/api/tokens/anonymous', { method: 'POST' }));
    const list = await json(await listMine(request('/api/my/tokens', { actor })));
    expect((list.tokens as unknown[]).length).toBe(1);
  });
  it('DELETE /api/my/tokens/:id refuses another account\'s token with 404 and a cross-site request with 403', async () => {
    const a = await createUser({ email: 'c@example.com' }); const b = await createUser({ email: 'd@example.com' });
    const actorA = { credential: 'session' as const, userId: a.id, email: 'c@example.com', emailVerified: true };
    const actorB = { credential: 'session' as const, userId: b.id, email: 'd@example.com', emailVerified: true };
    const { id } = await json(await mintAnonymous(request('/api/tokens/anonymous', { method: 'POST', actor: actorA })));
    expect((await revokeMine(request(`/api/my/tokens/${id}`, { method: 'DELETE', actor: actorB }), params({ id: String(id) }))).status).toBe(404);
    expect((await revokeMine(request(`/api/my/tokens/${id}`, { method: 'DELETE', actor: actorA, origin: 'https://evil.example', headers: { host: 'localhost' } }), params({ id: String(id) }))).status).toBe(403);
    expect((await revokeMine(request(`/api/my/tokens/${id}`, { method: 'DELETE', actor: actorA }), params({ id: String(id) }))).status).toBe(204);
  });
  it('POST /api/session/token adopts a token into the agent cookie; DELETE clears it', async () => {
    const { token } = await json(await mintAnonymous(request('/api/tokens/anonymous', { method: 'POST' })));
    const res = await adoptSession(request('/api/session/token', { method: 'POST', json: { token } }));
    expect(res.status).toBe(204);
    expect(cookieValue(res).value).not.toBeNull();
    const cleared = await clearSession(request('/api/session/token', { method: 'DELETE' }));
    expect(cookieValue(cleared).cleared).toBe(true);
  });
  it('a token revoked here stops authorizing on the very next request', async () => {
    const { id, token } = await json(await mintAnonymous(request('/api/tokens/anonymous', { method: 'POST' })));
    expect((await listArtifacts(request('/api/artifacts', { token: String(token) }))).status).toBe(200);
    await revokeAdmin(request(`/api/tokens/${id}`, { method: 'DELETE', token: ADMIN }), params({ id: String(id) }));
    expect((await listArtifacts(request('/api/artifacts', { token: String(token) }))).status).toBe(401);
  });
});
