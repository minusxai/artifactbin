import { describe, expect, it, vi } from 'vitest';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';
import { GroupError } from '@/lib/groups';
import type { RequestIdentity } from '@/lib/accounts';
import { groupRoute } from '..';

useAppHarness();
const context = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
const echo = async (_request: Request, userId: string, params: Record<string, string>, actor: RequestIdentity) =>
  Response.json({ userId, params, credential: actor.credential });

describe('groupRoute', () => {
  it('runs the handler for a bearer token with the token account and the route params', async () => {
    const owner = await mintAccountToken('group-route');
    const response = await groupRoute(echo)(request('/api/groups/g1', { token: owner.token }), context({ id: 'g1' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: owner.userId, params: { id: 'g1' }, credential: 'bearer' });
  });

  it('runs the handler for a signed-in browser session, with empty params when the route has none', async () => {
    const response = await groupRoute(echo)(request('/api/me/preferences', { actor: { credential: 'session', userId: 'usr_session', email: 'mxmx_test_s@example.com', emailVerified: true } }));
    expect(await response.json()).toEqual({ userId: 'usr_session', params: {}, credential: 'session' });
  });

  it('refuses an unauthenticated request, and a bearer header never falls back to the browser session', async () => {
    const handler = vi.fn(echo);
    expect((await groupRoute(handler)(request('/api/groups'), context())).status).toBe(401);
    const forged = request('/api/groups', { actor: { credential: 'session', userId: 'usr_session' }, headers: { authorization: 'Bearer not-a-token' } });
    expect((await groupRoute(handler)(forged, context())).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses a credential without an account and a cross-site cookie mutation', async () => {
    const handler = vi.fn(echo);
    const legacy = await mintAccountToken('group-route-legacy', null);
    const tokenOnly = await groupRoute(handler)(request('/api/groups', { token: legacy.token }), context());
    expect(tokenOnly.status).toBe(401);
    const crossSite = await groupRoute(handler)(request('/api/groups', { method: 'POST', origin: 'https://evil.example', actor: { credential: 'session', userId: 'usr_session' } }), context());
    expect(crossSite.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('answers a GroupError as its code and status, and rethrows any other error', async () => {
    const actor = { credential: 'session' as const, userId: 'usr_session' };
    const refused = await groupRoute(async () => { throw new GroupError('last_editor', 409); })(request('/api/groups', { actor }), context());
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'last_editor' });
    const plain = await groupRoute(async () => { throw new GroupError('invalid_group'); })(request('/api/groups', { actor }), context());
    expect(plain.status).toBe(400);
    await expect(groupRoute(async () => { throw new Error('boom'); })(request('/api/groups', { actor }), context())).rejects.toThrow('boom');
  });
});
