import { describe, expect, it } from 'vitest';
import { useAppHarness } from './harness';
import { mintToken, resolveToken, revokeToken } from '@/lib/tokens';
import { createArtifact, getArtifactFor } from '@/lib/artifacts';
import { createUser, listDraftsByTokenIds } from '@/lib/users';
import { createTeamApplication } from '../../cli/src/team-application';
import { AUTH_SECRET } from '@/lib/config';
import { getArtifactById } from '@/lib/artifacts';
import { createGuestOwner, mergeGuestUsers } from '@/lib/guest-owner';
import { request } from './harness';
import { GET as homePage } from '@/app/api/page/home/route';
import { effectiveRole } from '@/lib/artifacts';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

useAppHarness();
describe('shared guest ownership', () => {
  it.each([false, true])('merges on real verified login and keeps CLI refresh working (existing account=%s)', async existing => {
    const directory = await mkdtemp(join(tmpdir(), 'guest-login-'));
    try {
      const base = 'http://localhost:3000', email = `mxmx_test_guest_login_${existing ? 'existing' : 'new'}@example.test`;
      const host = await createTeamApplication({ APP__PUBLIC_BASE_URL: base, AUTH__SECRET: AUTH_SECRET, EMAIL__DEV_OUTBOX_PATH: join(directory, 'outbox.jsonl') }, process.cwd());
      const post = (path: string, body: unknown, cookie = '') => host.fetch(new Request(base + path, { method: 'POST', headers: { origin: base, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
      const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      const login = async (guestCookie = '') => {
        expect((await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' }, guestCookie)).status).toBe(200);
        const messages = (await readFile(join(directory, 'outbox.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        const otp = messages.filter(message => message.to === email).at(-1).otp;
        const response = await post('/api/auth/sign-in/email-otp', { email, otp }, guestCookie);
        expect(response.status).toBe(200);
        const cookie = [guestCookie, cookies(response)].filter(Boolean).join('; ');
        const home = await host.fetch(new Request(base + '/api/page/home?part=core', { headers: { cookie } }));
        expect(home.status).toBe(200);
        return (await home.json()).accountId as string;
      };
      const previousUserId = existing ? await login() : undefined;
      const started = await post('/api/start', {});
      const cookie = cookies(started), artifactId = (await started.json()).id;
      const pending = await (await post('/oauth/device', {})).json();
      const approved = await host.fetch(new Request(base + '/oauth/device/approve', { method: 'POST', headers: { cookie, origin: base }, body: new URLSearchParams({ user_code: pending.user_code, decision: 'anonymous' }) }));
      expect(approved.status).toBe(200);
      const credential = await (await post('/oauth/device/token', { device_code: pending.device_code })).json();
      const cliCheck = () => host.fetch(new Request(base + '/api/agent-approvals', { method: 'POST', headers: { authorization: `Bearer ${credential.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ artifactId }) }));
      expect(await (await cliCheck()).json()).toEqual({ authorized: true });
      const accountId = await login(cookie);
      if (previousUserId) expect(accountId).toBe(previousUserId);
      expect((await getArtifactById(artifactId))?.user_id).toBe(accountId);
      expect(await (await cliCheck()).json()).toEqual({ authorized: true });
      const refresh = await post('/oauth/token', { grant_type: 'refresh_token', client_id: credential.client_id, refresh_token: credential.refresh_token, resource: base + '/api' });
      expect(refresh.status).toBe(200);
      expect(await resolveToken((await refresh.json()).access_token)).toMatchObject({ userId: accountId });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it.each([true, false])('shares browser and CLI creation with one approval (browser first=%s)', async browserFirst => {
    const base = 'http://localhost:3000';
    const host = await createTeamApplication({ APP__PUBLIC_BASE_URL: base, AUTH__SECRET: AUTH_SECRET }, process.cwd());
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => host.fetch(new Request(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
    let cookie = '', originalId = '';
    if (browserFirst) {
      const created = await post('/api/start', {});
      originalId = (await created.json()).id;
      cookie = created.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    }
    const pending = await (await post(browserFirst ? '/api/agent-approvals' : '/oauth/device', browserFirst ? { artifactId: originalId } : {})).json();
    const approval = await host.fetch(new Request(base + '/oauth/device/approve', {
      method: 'POST', headers: { cookie, origin: base }, body: new URLSearchParams({ user_code: pending.user_code, decision: browserFirst ? 'approve' : 'anonymous' }),
    }));
    expect(approval.status, await approval.clone().text()).toBe(200);
    cookie = approval.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') || cookie;
    expect(cookie).not.toBe('');
    const exchanged = await post('/oauth/device/token', { device_code: pending.device_code });
    expect(exchanged.status, await exchanged.clone().text()).toBe(200);
    const credential = await exchanged.json();
    const identity = (await resolveToken(credential.access_token))!;
    expect(identity).not.toBeNull();
    const later = await post('/api/start', {}, { cookie });
    const laterId = (await later.json()).id;
    expect((await getArtifactById(laterId))?.user_id).toBe(identity.userId);
    if (originalId) expect((await getArtifactById(originalId))?.user_id).toBe(identity.userId);
    const cliCreated = await post('/api/artifacts', { markup: '<h1>From the CLI</h1>' }, { authorization: `Bearer ${credential.access_token}` });
    expect(cliCreated.status, await cliCreated.clone().text()).toBe(201);
    expect((await getArtifactById((await cliCreated.json()).id))?.user_id).toBe(identity.userId);
    expect(await (await post('/api/agent-approvals', { artifactId: laterId }, { authorization: `Bearer ${credential.access_token}` })).json()).toEqual({ authorized: true });
    const refreshed = await post('/oauth/token', { grant_type: 'refresh_token', client_id: credential.client_id, refresh_token: credential.refresh_token, resource: base + '/api' });
    expect(refreshed.status, await refreshed.clone().text()).toBe(200);
    expect(await resolveToken((await refreshed.json()).access_token)).toMatchObject({ userId: identity.userId });
    const home = await host.fetch(new Request(base + '/api/page/home', { headers: { cookie } }));
    expect((await home.json()).drafts.map((row: { id: string }) => row.id)).toContain(laterId);
  });
  it('only merges after a verified login and preserves the guest ceiling on unrelated links', async () => {
    const guest = await createGuestOwner();
    const owned = await createArtifact(guest.tokenId, guest.userId, { format: 'markup', source: '<h1>Guest</h1>', content: '<h1>Guest</h1>', meta: {} });
    const user = await createUser({ email: 'mxmx_test_verified_merge@example.test' });
    const other = await createArtifact('', user.id, { format: 'markup', source: '<h1>Other</h1>', content: '<h1>Other</h1>', meta: {}, visibility: 'public', link_role: 'editor' });
    expect(await effectiveRole({ ...other, link_role: 'editor' }, { tokenId: guest.tokenId, userId: guest.userId })).toBe('viewer');
    expect(await getArtifactFor({ tokenId: guest.tokenId, userId: guest.userId }, other.id)).toBeNull();
    const login = (verified: boolean) => homePage(request('/api/page/home', { actor: { credential: 'session', userId: user.id, email: user.email, emailVerified: verified, heldTokenIds: [guest.tokenId] } }));
    await login(false);
    expect((await getArtifactById(owned.id))?.user_id).toBe(guest.userId);
    await login(true);
    expect((await getArtifactById(owned.id))?.user_id).toBe(user.id);
    expect(await listDraftsByTokenIds([guest.tokenId])).toEqual([]);
  });
  it('merges guest artifacts and all approved CLI credentials into a verified account', async () => {
    const guest = await createGuestOwner();
    const first = await createArtifact(guest.tokenId, guest.userId, { format: 'markup', source: '<h1>First</h1>', content: '<h1>First</h1>', meta: {} });
    const cli = await mintToken('cli', guest.userId);
    const account = await createUser({ email: 'mxmx_test_merge@example.test' });
    const stranger = await createGuestOwner();
    await mergeGuestUsers(account.id, [guest.tokenId]);
    expect((await getArtifactById(first.id))?.user_id).toBe(account.id);
    expect(await resolveToken(cli.token)).toMatchObject({ id: cli.id, userId: account.id });
    expect(await getArtifactFor({ tokenId: cli.id, userId: account.id }, first.id)).not.toBeNull();
    const sibling = await mintToken('unrelated', stranger.userId);
    expect(await resolveToken(sibling.token)).toMatchObject({ userId: stranger.userId });
  });
  it('revokes CLI credentials independently of the browser and other CLI connections', async () => {
    const guest = await createGuestOwner();
    const first = await mintToken('cli-one', guest.userId);
    const second = await mintToken('cli-two', guest.userId);
    await revokeToken(first.id);
    expect(await resolveToken(first.token)).toBeNull();
    expect(await resolveToken(second.token)).toMatchObject({ id: second.id, userId: guest.userId });
  });
});
