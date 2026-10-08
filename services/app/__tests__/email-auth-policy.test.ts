import { expect, it } from 'vitest';
import { mintToken, createUser, createGuestOwner, resolveToken, sessionActor } from '@/lib/accounts';
import { POST as start } from '@/app/api/start/route';
import { POST as connect } from '@/app/api/internal/artifact-approval/route';
import { POST as mint } from '@/app/api/internal/tokens/route';
import { POST as exchange } from '@/app/api/session/token/route';
import { agentCookie, request, useAppHarness } from './harness';

useAppHarness();

it('does not authenticate legacy unclaimed or guest-owned bearer tokens', async () => {
  const unclaimed = await mintToken('legacy');
  const guest = await createGuestOwner();
  const bearer = await mintToken('legacy guest CLI', guest.userId);
  expect(await resolveToken(unclaimed.token)).toBeNull();
  expect(await resolveToken(bearer.token)).toBeNull();
});

it('keeps email-account bearer authentication', async () => {
  const account = await createUser({ email: 'mxmx_test_email_auth@example.com' });
  const bearer = await mintToken('account CLI', account.id);
  expect(await resolveToken(bearer.token)).toMatchObject({ id: bearer.id, userId: account.id });
});

it('does not authenticate an ownership cookie without an email login', async () => {
  const guest = await createGuestOwner();
  const actor = await sessionActor(request('/api/my/artifacts', { cookie: await agentCookie([guest.tokenId]) }));
  expect(actor).toMatchObject({ credential: 'none', tokenId: null, viewer: null });
});

it('refuses anonymous artifact creation without creating ownership', async () => {
  const response = await start(request('/api/start', { method: 'POST' }));
  expect(response.status).toBe(401);
  expect(response.headers.get('set-cookie')).toBeNull();
});

it('refuses anonymous connection and internal minting', async () => {
  for (const handler of [connect, mint]) {
    const response = await handler(request('/api/internal/tokens', { method: 'POST', json: { action: 'connect' } }));
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  }
});

it('refuses exchanging a bearer for a browser login', async () => {
  const account = await createUser({ email: 'mxmx_test_no_token_login@example.com' });
  const bearer = await mintToken('account CLI', account.id);
  const response = await exchange(request('/api/session/token', { method: 'POST', json: { token: bearer.token } }));
  expect(response.status).toBe(401);
  expect(response.headers.get('set-cookie')).toBeNull();
});
