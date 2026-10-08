import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {createHumanAuth,type HumanAuth} from '../src/auth/human';
import {createAuthHost,type AuthApp} from '../src/parts';

/** A browser session rolls forward: Better Auth refreshes once expiresAt is 5 of the 7 days away (updateAge 1 day). */
const baseURL = 'http://localhost:9402';
const noTokens = {byToken: async () => null, byId: async () => null, invalidate: () => {}};
let db: PGlite; let auth: HumanAuth; let app: AuthApp; let cookie = ''; let otp = '';
let upstreamSetCookie: string | null = null;

beforeAll(async () => {
  db = new PGlite();
  auth = await createHumanAuth({pglite: db, baseURL, secret: 'session-refresh-secret'.padEnd(32, '0'), mail: {send: async m => { otp = m.otp ?? ''; }}});
  app = createAuthHost({
    env: {}, cookieSecret: 'test', tokens: noTokens, sessions: auth.sessions,
    upstream: async () => new Response('{"ok":true}', {headers: upstreamSetCookie ? {'set-cookie': upstreamSetCookie} : {}}),
  });
  const call = (path: string, body: unknown) => auth.handler(new Request(`${baseURL}/api/auth${path}`, {method: 'POST', headers: {'content-type': 'application/json', origin: baseURL}, body: JSON.stringify(body)}));
  const email = 'mxmx_test_refresh@example.com';
  await call('/email-otp/send-verification-otp', {email, type: 'sign-in'});
  const login = await call('/sign-in/email-otp', {email, otp});
  cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
});
afterAll(async () => { await db.close(); });

const sessionCookies = (res: Response) => res.headers.getSetCookie().filter(c => c.includes('session_token'));

describe('session refresh', () => {
  it('sends no cookie while the session is younger than updateAge', async () => {
    const res = await app.request(`${baseURL}/api/artifacts`, {headers: {cookie}});
    expect(res.status).toBe(200);
    expect(sessionCookies(res)).toEqual([]);
  });

  it('re-issues the session cookie with a fresh Max-Age once the row is older than updateAge', async () => {
    await db.exec(`UPDATE auth.session SET "expiresAt" = now() + interval '5 days'`);
    const res = await app.request(`${baseURL}/api/artifacts`, {headers: {cookie}});
    const [set, ...rest] = sessionCookies(res);
    expect(rest).toEqual([]);
    expect(set).toMatch(/Max-Age=604800/);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    expect(set).not.toMatch(/Domain=/i);
    const again = await app.request(`${baseURL}/api/artifacts`, {headers: {cookie}});
    expect(sessionCookies(again)).toEqual([]);
  });

  it('does not duplicate a session cookie the response already sets', async () => {
    await db.exec(`UPDATE auth.session SET "expiresAt" = now() + interval '5 days'`);
    upstreamSetCookie = 'better-auth.session_token=x; Path=/; Max-Age=0';
    try {
      const res = await app.request(`${baseURL}/api/artifacts`, {headers: {cookie}});
      expect(sessionCookies(res)).toHaveLength(1);
    } finally { upstreamSetCookie = null; }
  });

  it('answers 503 no-store, not anonymous, when session resolution throws', async () => {
    let reached = false;
    const broken = createAuthHost({env: {}, cookieSecret: 'test', tokens: noTokens,
      sessions: {resolve: async () => { throw new Error('db down'); }},
      upstream: async () => { reached = true; return new Response('ok'); }});
    const res = await broken.request(`${baseURL}/api/artifacts`, {headers: {cookie}});
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(reached).toBe(false);
  });
});
