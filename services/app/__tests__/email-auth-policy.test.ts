import { expect, it } from 'vitest';
import { mintToken, createUser, resolveToken, sessionActor } from '@/lib/accounts';
import { POST as start } from '@/app/api/start/route';
import { POST as connect } from '@/app/api/internal/artifact-approval/route';
import { POST as mint } from '@/app/api/internal/tokens/route';
import { POST as exchange } from '@/app/api/session/token/route';
import { issuePagesTicket, exchangePagesTicket, pagesSessionOf } from '@/lib/accounts/pages-sessions';
import { getDb } from '@/lib/platform/db';
import { sha256 } from '@/lib/accounts/tokens';
import { markPagesRequest, pagesSiteFor } from '@/lib/http/pages-origin';
import { agentCookie, request, useAppHarness, createGuestOwner } from './harness';

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


it('does not issue authenticated pages tickets for legacy guest identities', async () => {
  const guest = await createGuestOwner();
  expect(await issuePagesTicket({ credential: 'agent-cookie', tokenId: guest.tokenId, viewer: { userId: guest.userId, email: null } })).toBeNull();
});

it('invalidates persisted legacy guest pages sessions', async () => {
  const guest = await createGuestOwner();
  const cookie = 'mxmx_test_legacy_pages_cookie';
  await (await getDb()).query("INSERT INTO pages_sessions (id_hash, credential, user_id, token_id, expires_at) VALUES ($1,'agent-cookie',$2,$3,$4)", [sha256(cookie), guest.userId, guest.tokenId, new Date(Date.now() + 60_000).toISOString()]);
  expect(await pagesSessionOf(cookie)).toBeNull();
});

it('admits account-backed scripted browser pages cookies only on the trusted pages boundary', async () => {
  const account = await createUser({ email: 'mxmx_test_pages_account@example.com' });
  const bearer = await mintToken('scripted account', account.id);
  const ticket = await issuePagesTicket({ credential: 'bearer', tokenId: bearer.id, viewer: { userId: account.id, email: account.email } }, {}, Date.now(), { browserSession: true });
  expect(ticket).not.toBeNull();
  const session = await exchangePagesTicket(ticket!);
  const pages = await pagesSessionOf(session!.cookie);
  expect(pages?.actor).toMatchObject({ credential: 'agent-cookie', userId: account.id });
  const plain = request('/', { actor: pages!.actor });
  expect(await sessionActor(plain)).toMatchObject({ credential: 'none' });
  const trusted = markPagesRequest(request('/', { actor: pages!.actor }), { id: 'testdoc', self: 'https://74657374646f63.pages.example.test', site: pagesSiteFor('pages.example.test', 'https://app.example.test') });
  expect(await sessionActor(trusted)).toMatchObject({ credential: 'agent-cookie', viewer: { userId: account.id }, tokenId: bearer.id });
});
