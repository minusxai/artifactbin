/**
 * HUMAN LOGIN — Better Auth core + emailOTP + genericOAuth, configured the
 * way the plan says is load-bearing: sessions DB-backed with the cookie cache
 * OFF (revocation is immediate), our own `usr_` ids, linking on VERIFIED
 * email only, email change verified at the new address, passwords never.
 * On one PGLite, with its tables in the `auth` schema (spike I).
 */
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eventName } from '@artifactbin/contracts';
import { fakeEvents, type FakeEvents } from '@artifactbin/utils';
import { createHumanAuth, type HumanAuth } from '../src/auth/human';
import { withHttpServer, type RunningServer } from '../../app/__tests__/net';

let pg: PGlite;
let auth: HumanAuth;
const sent: Array<{ to: string; kind: string; otp?: string; url?: string }> = [];
/** A stub OIDC issuer: authorize redirects back with a code; token answers an access token the userinfo hook decodes. */
let issuer: RunningServer; let issuerUrl = ''; let nextProfile = { id: 'oidc-1', email: 'a@example.com', emailVerified: true };
/** The log, as these hooks fill it — cleared per test beside the tables. */
const events: FakeEvents = fakeEvents();
const verbs = () => events.events.map(eventName);

beforeAll(async () => {
  issuer = await withHttpServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/authorize') {
      const back = new URL(u.searchParams.get('redirect_uri')!);
      back.searchParams.set('code', 'the-code'); back.searchParams.set('state', u.searchParams.get('state')!);
      res.writeHead(302, { location: back.toString() }); res.end(); return;
    }
    if (u.pathname === '/token') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ access_token: 'at-' + JSON.stringify(nextProfile), token_type: 'Bearer' })); return; }
    res.writeHead(404); res.end();
  });
  issuerUrl = issuer.base;
  pg = new PGlite();
  auth = await createHumanAuth({
    pglite: pg,
    secret: 'human-auth-secret'.padEnd(32, '0'),
    baseURL: 'http://localhost:4794',
    mail: { send: async (m) => { sent.push(m); } },
    oidc: { providerId: 'acme', clientId: 'cid', clientSecret: 'sec', authorizationUrl: `${issuerUrl}/authorize`, tokenUrl: `${issuerUrl}/token`, userInfo: async (accessToken) => JSON.parse(accessToken.slice(3)) },
    events,
  });
});
afterAll(async () => { await issuer.close(); await pg.close(); });
beforeEach(async () => { sent.length = 0; events.events.length = 0; await pg.exec('DELETE FROM auth.session; DELETE FROM auth.account; DELETE FROM auth.verification; DELETE FROM auth.user'); });

const call = (path: string, body?: unknown, cookie?: string) => auth.handler(new Request(`http://localhost:4794/api/auth${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://localhost:4794', ...(cookie ? { cookie } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}));
const cookieOf = (res: Response) => (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? '']).filter(Boolean).map((c) => c.split(';')[0]).join('; ');
const signInByOtp = async (email: string) => {
  await call('/email-otp/send-verification-otp', { email, type: 'sign-in' });
  const otp = sent.find((m) => m.to === email && m.otp)!.otp!;
  const res = await call('/sign-in/email-otp', { email, otp });
  return cookieOf(res);
};

describe('boot', () => {
  it('is idempotent: a second boot against the same database keeps the tables and the sessions', async () => {
    const cookie = await signInByOtp('boot@example.com');
    const again = await createHumanAuth({ pglite: pg, secret: 'human-auth-secret'.padEnd(32, '0'), baseURL: 'http://localhost:4794', mail: { send: async (m) => { sent.push(m); } } });
    expect((await again.sessions.resolve(new Request('http://x', { headers: { cookie } })))?.email).toBe('boot@example.com');
  });
});

describe('email OTP', () => {
  it('signs in with a code sent by our mailer, under our usr_ ids, and the session resolves to a session actor', async () => {
    const cookie = await signInByOtp('a@example.com');
    expect(cookie).toContain('better-auth');
    const session = await auth.sessions.resolve(new Request('http://localhost:4794/x', { headers: { cookie } }));
    expect(session).toMatchObject({ email: 'a@example.com', emailVerified: true });
    expect(session!.userId).toMatch(/^usr_[a-z0-9]+$/);
    const tables = (await pg.query<{ t: string }>("select table_schema||'.'||table_name t from information_schema.tables where table_name in ('user','session') order by 1")).rows.map((r) => r.t);
    expect(tables).toEqual(['auth.session', 'auth.user']);
  });

  it('passwords are never a way in', async () => {
    const res = await call('/sign-up/email', { email: 'p@example.com', password: 'hunter2hunter2', name: 'p' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('revocation is immediate: the very next request after the session row goes is anonymous', async () => {
    const cookie = await signInByOtp('b@example.com');
    expect(await auth.sessions.resolve(new Request('http://x', { headers: { cookie } }))).not.toBeNull();
    await pg.exec('DELETE FROM auth.session');
    expect(await auth.sessions.resolve(new Request('http://x', { headers: { cookie } }))).toBeNull();
  });

  it('email change reaches the NEW address, and the old one keeps the login until it is confirmed', async () => {
    const cookie = await signInByOtp('c@example.com');
    sent.length = 0;
    const res = await call('/change-email', { newEmail: 'c-new@example.com', callbackURL: '/' }, cookie);
    expect(res.status).toBe(200);
    expect(sent.some((m) => m.to === 'c-new@example.com')).toBe(true);
    expect((await auth.sessions.resolve(new Request('http://x', { headers: { cookie } })))!.email).toBe('c@example.com');
  });
});

describe('OIDC', () => {
  const oidcRoundTrip = async (profile: typeof nextProfile, cookie = '') => {
    nextProfile = profile;
    // In Better Auth 1.7 a generic provider registers into the core's social providers: sign-in is the core endpoint.
    const start = await call('/sign-in/social', { provider: 'acme', callbackURL: '/' }, cookie);
    const { url } = await start.json() as { url: string };
    const stateCookie = start.headers.get('set-cookie')?.split(';')[0] ?? '';
    // follow the issuer's redirect back to the callback by hand (the stub issuer answers 302)
    const cb = await fetch(url, { redirect: 'manual' });
    const back = new URL(cb.headers.get('location')!);
    const done = await auth.handler(new Request(back.toString(), { headers: { cookie: [cookie, stateCookie].filter(Boolean).join('; ') } }));
    return { status: done.status, cookie: cookieOf(done), location: done.headers.get('location') ?? '' };
  };

  it('a VERIFIED email links to the existing user — the OTP user who later clicks the IdP keeps their usr_', async () => {
    const otpCookie = await signInByOtp('link@example.com');
    const before = (await auth.sessions.resolve(new Request('http://x', { headers: { cookie: otpCookie } })))!.userId;
    const r = await oidcRoundTrip({ id: 'oidc-link', email: 'link@example.com', emailVerified: true });
    expect(r.status, r.location).toBeGreaterThanOrEqual(300);
    expect(r.location, 'the callback did not land on an error').not.toMatch(/error/);
    const after = (await auth.sessions.resolve(new Request('http://x', { headers: { cookie: r.cookie } })))!.userId;
    expect(after).toBe(before);
    expect((await pg.query<{ n: string }>("select count(*)::text n from auth.user where email = 'link@example.com'")).rows[0].n).toBe('1');
  });

  it('an UNVERIFIED email creates nothing and is refused', async () => {
    const r = await oidcRoundTrip({ id: 'oidc-unv', email: 'unverified@example.com', emailVerified: false });
    expect(r.cookie).not.toContain('better-auth.session_token');
    expect((await pg.query<{ n: string }>("select count(*)::text n from auth.user where email = 'unverified@example.com'")).rows[0].n).toBe('0');
  });

  /**
   * THE LOG'S SIDE OF THE SAME THREE JOURNEYS. `oauth_linked` has no other
   * harness: it needs a real provider round trip, and this stub issuer is the
   * only one there is. The rows are what the hooks watch, so a link that
   * happens on a SECOND way in says only what actually changed — the account,
   * and the session it opened.
   */
  it('says the identity moments: a first IdP sign-in signs up, links and verifies; a later link says only the link and the login; an unverified email says nothing', async () => {
    await oidcRoundTrip({ id: 'oidc-new', email: 'fresh@example.com', emailVerified: true });
    expect(verbs()).toEqual(['user.signed_up', 'user.oauth_linked', 'user.login_verified']);
    const [signedUp, linked, verified] = events.events;
    expect(signedUp).toMatchObject({ source: 'proxy', subject_kind: 'user', object_kind: 'user', payload: { email: 'fresh@example.com' } });
    expect(signedUp!.object_id).toMatch(/^usr_/);
    expect(linked).toMatchObject({ source: 'proxy', verb: 'oauth_linked', object_id: signedUp!.object_id, payload: { provider: 'acme' } });
    expect(verified).toMatchObject({ verb: 'login_verified', object_id: signedUp!.object_id, payload: { email: 'fresh@example.com' } });
    // A provider name is not an address: the link carries no email.
    expect(JSON.stringify(linked)).not.toMatch(/@/);

    // The OTP user who later clicks the IdP: the usr_ already exists, so only the account and the session are new.
    await signInByOtp('later@example.com');
    events.events.length = 0;
    await oidcRoundTrip({ id: 'oidc-later', email: 'later@example.com', emailVerified: true });
    expect(verbs()).toEqual(['user.oauth_linked', 'user.login_verified']);
    expect(events.events[0]).toMatchObject({ payload: { provider: 'acme' } });

    // Refused at the userinfo hook: no row is written, so no hook fires.
    events.events.length = 0;
    await oidcRoundTrip({ id: 'oidc-quiet', email: 'quiet@example.com', emailVerified: false });
    expect(verbs()).toEqual([]);
  });
});
