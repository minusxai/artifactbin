import {beforeEach,describe,expect,it,afterAll,beforeAll} from 'vitest';
import {createHash} from 'node:crypto';
import {ACTOR_HEADER,ANONYMOUS} from '@artifactbin/contracts';
import {signActor,assemble,cookieName,encodeAgentSession,createTokenReader,inProcess} from '@artifactbin/utils';
import {proxyParts,type ProxyOptions} from '../src/parts';
import {mintTestToken,resetTestDb,testDb,testProxyOptions} from './helpers';
import {getDb,resetDb} from '@/lib/db';
import {createAppServer} from '@/server/app';

/**
 * THE SESSION PART — who is asking, resolved once and attached to nothing
 * (the actor travels as `c.get('actor')` to the forwarder, which hands it to
 * the upstream — utils attachActor, never a part).
 *
 * The rate-limit cases that used to sit at the bottom of this file moved to
 * `rate-limits-parts.test.ts`: they were here because a composed app was
 * already standing up, not because they were about who is asking.
 */

let seenActor: unknown = null;
let seenHeaders: Headers | null = null;
let answer: Response = new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
const upstream = async (request: Request, actor: unknown): Promise<Response> => {
  seenActor = actor; seenHeaders = request.headers;
  return answer;
};
const proxy = async (o: Partial<ProxyOptions> = {}) => assemble(proxyParts(await testProxyOptions({ upstream: upstream as ProxyOptions['upstream'], ...o })));

beforeEach(async () => { await resetTestDb(); seenActor = null; seenHeaders = null; answer = new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); });

describe('the session part', () => {
  it('forwards an unauthenticated request as credential none, and the app\'s 401 is the app\'s — the proxy never answers one', async () => {
    answer = new Response('{"error":"unauthorized"}', { status: 401, headers: { 'www-authenticate': 'Bearer realm="x"' } });
    const res = await (await proxy()).request('/api/my/artifacts/x');
    expect(seenActor).toEqual(ANONYMOUS);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer realm="x"');
  });
  it('resolves a bearer to credential bearer with its ids, and a bad bearer to none', async () => {
    const app = await proxy();
    const token = await mintTestToken({ id: 'tok_9', userId: 'usr_1', query: testDb().query });
    await app.request('/api/artifacts', { headers: { authorization: `Bearer ${token}` } });
    expect(seenActor).toEqual({ credential: 'bearer', tokenId: 'tok_9', userId: 'usr_1' });
    await app.request('/api/artifacts', { headers: { authorization: 'Bearer mx_badbadbadbadbadbadbadbadbadbadbadbadbad01' } });
    expect(seenActor).toEqual(ANONYMOUS);
  });
  it('resolves a session with its claims and the cookie\'s held ids', async () => {
    const app = await proxy({
      sessions: { resolve: async () => ({ userId: 'usr_2', email: 's@example.com', emailVerified: true }) },
    });
    const sessionId='h'.repeat(43);
    await testDb().query("INSERT INTO auth.credentials(kind,credential_hash,subject_id,expires_at) VALUES ('agent-browser',$1,'tok_h',now()+interval '30 days')",[createHash('sha256').update(sessionId).digest('hex')]);
    await app.request('/api/artifacts', { headers: { cookie: `${cookieName(false)}=${await encodeAgentSession({ tokenIds: ['tok_h'],sessionId }, 'test-cookie-secret-00000000000000000000')}` } });
    expect(seenActor).toMatchObject({ credential: 'session', userId: 'usr_2', email: 's@example.com', emailVerified: true, heldTokenIds: ['tok_h'] });
  });
  it('authenticates the agent cookie as agent-cookie by its primary (last) id', async () => {
    const app = await proxy();
    await mintTestToken({ id: 'tok_c', userId: null, query: testDb().query });
    const sessionId='c'.repeat(43);
    await testDb().query("INSERT INTO auth.credentials(kind,credential_hash,subject_id,expires_at) VALUES ('agent-browser',$1,'tok_c',now()+interval '30 days')",[createHash('sha256').update(sessionId).digest('hex')]);
    await app.request('/api/artifacts', { headers: { cookie: `${cookieName(false)}=${await encodeAgentSession({ tokenIds: ['tok_x', 'tok_c'],sessionId }, 'test-cookie-secret-00000000000000000000')}` } });
    expect(seenActor).toEqual({ credential: 'agent-cookie', tokenId: 'tok_c', heldTokenIds: ['tok_x', 'tok_c'] });
  });
  it('ignores a forged inbound actor header, even one signed with a real key — the actor never travelled by header', async () => {
    const app = await proxy({ secret: 'forged-secret-00000000000000000000000' });
    await app.request('/api/artifacts', { headers: { [ACTOR_HEADER]: signActor({ credential: 'session', userId: 'usr_mallory' }, 'forged-secret-00000000000000000000000') } });
    expect(seenActor).toEqual(ANONYMOUS);
    expect(seenHeaders?.get(ACTOR_HEADER)).toBeNull();
  });
  it('passes every other request header through untouched', async () => {
    const app = await proxy();
    await app.request('/a/Ab3xK9/mutate', { method: 'POST', body: 'x', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'x-custom': 'kept' } });
    expect(seenHeaders?.get('origin')).toBe('https://evil.example');
    expect(seenHeaders?.get('sec-fetch-site')).toBe('cross-site');
    expect(seenHeaders?.get('x-custom')).toBe('kept');
  });
});

describe('revocation reaches the reader at once', () => {
  /** A revoke in the app reaches the proxy's reader at once in the full image: the composition root hands the app `reader.invalidate`. */

  const ADMIN = 'admin-secret-for-tests';
  process.env.ADMIN__SECRET = ADMIN;

  describe('revocation through the composed proxy', () => {
    let proxy: ReturnType<typeof assemble<any>>;
    let mint: () => Promise<{ id: string; token: string }>;
    beforeAll(async () => {
      const db = { query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => (await getDb()).query<T>(sql, params as never) };
      const reader = createTokenReader({ db, ttlMs: 60_000 });
      const app = createAppServer({ indexHtml: async () => '<div id="root">SPA</div>', onTokenRevoked: (id?: string) => reader.invalidate(id) } as never);
      const base = await testProxyOptions();
      proxy = assemble(proxyParts({ ...base, tokens: reader, upstream: inProcess(app) }));
      // The mint is INTERNAL: the proxy refuses the prefix at the edge, so a
      // credential is issued the way the device exchange issues one — straight
      // at the app, never through the parts.
      mint = async () => await (await app.request('/api/internal/tokens', { method: 'POST' })).json() as { id: string; token: string };
    });
    afterAll(() => resetDb());
    it('mint through the app, resolve through the proxy, revoke through the app: the very next request is nobody', async () => {
      const minted = await mint();
      expect(minted.token).toMatch(/^mx_/);
      expect((await proxy.request('/api/artifacts', { headers: { authorization: `Bearer ${minted.token}` } })).status).toBe(200);
      expect((await proxy.request(`/api/tokens/${minted.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${ADMIN}` } })).status).toBe(204);
      expect((await proxy.request('/api/artifacts', { headers: { authorization: `Bearer ${minted.token}` } })).status).toBe(401);
    });
  });
});
