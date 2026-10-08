/** Legacy ownership cookies prove adoption after email login; they are never login credentials. */
import { describe, expect, it } from 'vitest';
import { POST as exchangeRoute, DELETE as clearSession } from '@/app/api/session/token/route';
import { GET as listMine } from '@/app/api/my/artifacts/route';
import { GET as raw } from '@/app/a/[id]/raw/route';
import { GET as events } from '@/app/a/[id]/events/route';
import { AGENT_COOKIE, createGuestOwner, createUser, mintToken, resolveToken, sessionActor } from '@/lib/accounts';
import { claimTokenById, claimableTokensById } from '@/lib/accounts';
import { createArtifact } from '@/lib/artifacts';
import { agentCookie, request, setSession, useAppHarness } from './harness';

useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('retired token-to-browser login', () => {
  it.each(['unknown', 'guest', 'account'])('refuses a %s bearer without setting a cookie', async kind => {
    const owner = kind === 'account' ? (await createUser({ email: 'mxmx_test_exchange@example.com' })).id : null;
    const token = kind === 'unknown' ? 'mx_invalid' : (await mintToken('legacy', owner)).token;
    const response = await exchangeRoute(request('/api/session/token', { method: 'POST', json: { token } }));
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toMatchObject({ error: 'email_auth_required' });
  });
  it('keeps clearing the legacy cookie with HttpOnly, path and same-site attributes', async () => {
    const response = await clearSession();
    expect(response.status).toBe(204);
    const value = response.headers.get('set-cookie')!;
    expect(value).toContain(AGENT_COOKIE + '=');
    expect(value).toContain('HttpOnly');
    expect(value).toMatch(/SameSite=lax/i);
    expect(value).toContain('Path=/');
    expect(value).toContain('Max-Age=0');
  });
});

describe('legacy ownership proofs', () => {
  it.each(['guest', 'account'])('a %s token cookie cannot authenticate a browser or read its private artifact', async kind => {
    const account = kind === 'account' ? await createUser({ email: 'mxmx_test_cookie@example.com' }) : null;
    const guest = account ? null : await createGuestOwner();
    const userId = account?.id ?? guest!.userId;
    const token = await mintToken('old browser', userId);
    const cookie = await agentCookie([token.id]);
    const artifact = await createArtifact(token.id, userId, { format: 'markup', source: '<p id="private">Private</p>', visibility: 'private', meta: {} });
    expect(await sessionActor(request('/api/my/artifacts', { cookie }))).toMatchObject({ credential: 'none', viewer: null });
    expect((await listMine(request('/api/my/artifacts', { cookie }))).status).toBe(401);
    for (const [handler, path] of [[raw, `/a/${artifact.id}/raw`], [events, `/a/${artifact.id}/events`]] as const) {
      expect((await handler(request(path, { cookie }), params(artifact.id))).status).toBe(404);
    }
  });
  it('requires email login before claiming a cookie-held legacy token', async () => {
    const old = await mintToken('legacy unclaimed');
    const cookie = await agentCookie([old.id]);
    expect(await claimableTokensById([old.id])).toHaveLength(1);
    expect(await resolveToken(old.token)).toBeNull();
    const account = await createUser({ email: 'mxmx_test_claim@example.com' });
    setSession({ user: { id: account.id, email: account.email } });
    expect(await claimTokenById(account.id, old.id)).toMatchObject({ tokenId: old.id });
    expect(await resolveToken(old.token)).toMatchObject({ userId: account.id });
    setSession(null);
    expect(await sessionActor(request('/api/my/artifacts', { cookie }))).toMatchObject({ credential: 'none' });
  });
  it('an email account can read its private artifact after login', async () => {
    const account = await createUser({ email: 'mxmx_test_private_account@example.com' });
    const artifact = await createArtifact('', account.id, { format: 'markup', source: '<p id="private">Private</p>', visibility: 'private', meta: {} });
    setSession({ user: { id: account.id, email: account.email } });
    expect((await raw(request(`/a/${artifact.id}/raw`), params(artifact.id))).status).toBe(200);
  });
});
