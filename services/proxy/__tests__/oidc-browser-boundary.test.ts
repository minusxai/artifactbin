import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHumanAuth, type HumanAuth } from '../src/auth/human';
import { withHttpServer, type RunningServer } from '../../app/__tests__/net';

const main = 'https://example.test', controls = 'https://i.example.test';
let pg: PGlite, auth: HumanAuth, issuer: RunningServer;
let exchanges = 0;
beforeAll(async () => {
  issuer = await withHttpServer((req, res) => {
    const url = new URL(req.url!, 'http://issuer');
    if (url.pathname === '/authorize') {
      const back = new URL(url.searchParams.get('redirect_uri')!);
      back.searchParams.set('code', 'test-code');
      back.searchParams.set('state', url.searchParams.get('state')!);
      res.writeHead(302, {location: back.href}); res.end(); return;
    }
    if (url.pathname === '/token') {
      exchanges++;
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify({access_token: 'test-access', token_type: 'Bearer'})); return;
    }
    res.writeHead(404); res.end();
  });
  pg = new PGlite();
  auth = await createHumanAuth({pglite: pg, baseURL: main, controlsOrigin: controls, secure: true,
    secret: 'oidc-browser-boundary'.padEnd(32, '0'), mail: {send: async () => {}},
    oidc: {providerId: 'acme', clientId: 'client', clientSecret: 'secret',
      authorizationUrl: `${issuer.base}/authorize`, tokenUrl: `${issuer.base}/token`,
      userInfo: async () => ({id: 'issuer-user', email: 'oidc@example.test', emailVerified: true})}});
});
afterAll(async () => {await issuer.close(); await pg.close();});
const pairs = (response: Response) => response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
async function begin() {
  const start = await auth.handler(new Request(`${main}/api/auth/sign-in/social`, {
    method: 'POST', headers: {origin: main, 'content-type': 'application/json'},
    body: JSON.stringify({provider: 'acme', callbackURL: '/'})}));
  expect(start.status).toBe(200);
  const {url} = await start.json() as {url: string};
  expect(new URL(new URL(url).searchParams.get('redirect_uri')!).origin).toBe(main);
  const redirect = await fetch(url, {redirect: 'manual'});
  return {back: redirect.headers.get('location')!, cookie: pairs(start)};
}
describe('real Better Auth OIDC on the trusted hostname', () => {
  it('rejects a retired-host callback and missing state, then issues only a full session once', async () => {
    const {back, cookie} = await begin();
    const wrongHost = back.replace(main, controls);
    expect((await auth.handler(new Request(wrongHost, {headers: {cookie}}))).status).toBe(403);
    const before = exchanges;
    const bad = new URL(back); bad.searchParams.set('state', 'forged');
    const rejected = await auth.handler(new Request(bad, {headers: {cookie}}));
    expect(rejected.headers.get('location')).toMatch(/error/);
    expect(exchanges).toBe(before);
    const done = await auth.handler(new Request(back, {headers: {cookie}}));
    expect(done.status).toBe(302);
    expect(new URL(done.headers.get('location')!, back).href).toBe(`${main}/`);
    const issued = pairs(done);
    expect(issued).toContain('__Host-mx.session_token=');
    expect(issued).not.toContain('__Secure-mx-read=');
    const full = await auth.sessions.resolve(new Request(main, {headers: {cookie: issued}}));
    expect(full?.email).toBe('oidc@example.test');
    expect(await auth.sessions.resolve(new Request(controls, {headers: {cookie: issued}}))).toBeNull();
    const replay = await auth.handler(new Request(back, {headers: {cookie}}));
    expect(replay.headers.get('location')).toMatch(/error/);
    expect(exchanges).toBe(before + 1);
  });
});
