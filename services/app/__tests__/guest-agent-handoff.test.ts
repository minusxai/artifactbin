/** Legacy guest data survives, but adopting it requires a verified email login. */
import { describe, expect, it } from 'vitest';
import { agentCookie, useAppHarness, createGuestOwner } from './harness';
import { mintToken, resolveToken, revokeToken } from '@/lib/accounts';
import { createArtifact, getArtifactById } from '@/lib/artifacts';
import { createTeamApplication } from '../server/team-host';
import { createOAuthStore } from '../../auth/src/identity/oauth';
import { AUTH_SECRET, getDb } from '@/lib/platform';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

useAppHarness();
const base = 'http://localhost:3000';

describe('email adoption of legacy ownership', () => {
  it.each([false, true])('adopts legacy browser and CLI artifacts after real email login (existing account=%s)', async existing => {
    const directory = await mkdtemp(join(tmpdir(), 'email-adoption-'));
    try {
      const email = `mxmx_test_adoption_${existing ? 'existing' : 'new'}@example.test`;
      const outbox = join(directory, 'outbox.jsonl');
      const host = await createTeamApplication({ APP__PUBLIC_BASE_URL: base, AUTH__SECRET: AUTH_SECRET, EMAIL__DEV_OUTBOX_PATH: outbox }, process.cwd());
      const post = (path: string, body: unknown, cookie = '') => host.fetch(new Request(base + path, { method: 'POST', headers: { origin: base, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
      const login = async (held = '') => {
        expect((await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' }, held)).status).toBe(200);
        const messages = (await readFile(outbox, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        const otp = messages.filter(message => message.to === email).at(-1).otp;
        const response = await post('/api/auth/sign-in/email-otp', { email, otp }, held);
        expect(response.status).toBe(200);
        const cookie = [held, ...response.headers.getSetCookie().map(value => value.split(';')[0])].filter(Boolean).join('; ');
        const home = await host.fetch(new Request(base + '/api/page/home?part=core', { headers: { cookie } }));
        expect(home.status).toBe(200);
        return { accountId: (await home.json()).accountId as string, cookie };
      };
      const prior = existing ? await login() : null;
      // Seed data saved by the old release; no new guest login is exercised.
      const guest = await createGuestOwner();
      const cli = await mintToken('legacy CLI', guest.userId);
      const artifact = await createArtifact(guest.tokenId, guest.userId, { format: 'markup', source: '<h1 id="legacy">Legacy artifact</h1>', visibility: 'private', meta: {} });
      const proof = await agentCookie([guest.tokenId]);
      const api = () => host.fetch(new Request(base + `/api/artifacts/${artifact.id}`, { headers: { authorization: `Bearer ${cli.token}` } }));
      expect((await api()).status).toBe(401);
      const store = createOAuthStore(await getDb(), 'auth');
      const clientId = String((await store.register({ client_name: 'legacy CLI', redirect_uris: ['http://127.0.0.1/callback'] })).client_id);
      const refreshToken = await store.issueRefresh({ clientId, userId: guest.userId, resource: base + '/api', scope: 'artifacts', accessTokenId: cli.id });
      const signed = await login(proof);
      if (prior) expect(signed.accountId).toBe(prior.accountId);
      expect((await getArtifactById(artifact.id))?.user_id).toBe(signed.accountId);
      expect((await api()).status).toBe(200);
      const refreshed = await post('/oauth/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, resource: base + '/api' });
      expect(refreshed.status, await refreshed.clone().text()).toBe(200);
      expect(await resolveToken((await refreshed.json()).access_token)).toMatchObject({ userId: signed.accountId });
      const stillLoggedOut = await host.fetch(new Request(base + '/api/my/artifacts', { headers: { cookie: proof } }));
      expect(stillLoggedOut.status).toBe(401);
      const started = await post('/api/start', {}, signed.cookie);
      expect(started.status).toBe(201);
      expect((await getArtifactById((await started.json()).id))?.user_id).toBe(signed.accountId);
      await revokeToken(cli.id);
      expect((await api()).status).toBe(401);
      expect((await host.fetch(new Request(base + '/api/my/artifacts', { headers: { cookie: signed.cookie } }))).status).toBe(200);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
