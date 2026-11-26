/**
 * Session expiry and renewal over the app's own driver settings: the app reads TIMESTAMPTZ as ISO strings
 * (services/app/lib/platform/db.ts), and Better Auth compares `expiresAt` as a Date. An expired session must be
 * refused, a session in use must roll forward, and a trusted-issuer session must be an ordinary remembered one.
 */
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {createHumanAuth,type HumanAuth} from '../src/auth/human';
import {signInByOtp} from './helpers';

const baseURL = 'http://localhost:9403';
const DAY = 86_400_000;
// The app's PGLite parsers, verbatim in effect: timestamps arrive as ISO strings, never Dates.
const toIso = (v: string) => new Date(v).toISOString();
let db: PGlite; let auth: HumanAuth; let otp = '';

beforeAll(async () => {
  db = new PGlite({parsers: {1184: toIso, 1114: (v: string) => v.replace(' ', 'T') + 'Z'}});
  auth = await createHumanAuth({pglite: db, baseURL, secret: 'session-dates-secret'.padEnd(32, '0'), mail: {send: async m => { otp = m.otp ?? ''; }}});
});
afterAll(async () => { await db.close(); });

const resolve = (cookie: string) => auth.sessions.resolve(new Request(baseURL, {headers: {cookie}}));
const expiresAt = async (id: string) => Date.parse((await db.query<{e: string}>(`SELECT "expiresAt" AS e FROM auth.session WHERE id=$1`, [id])).rows[0]?.e ?? '');
const cookieOf = (setCookies: string[]) => setCookies.map(c => c.split(';')[0]).join('; ');

describe('session dates over string timestamps', () => {
  it('refuses an expired session, as every other reader of the session does', async () => {
    const cookie = await signInByOtp(auth, baseURL, 'mxmx_test_expired@example.com', () => otp);
    const session = (await resolve(cookie))!;
    await db.query(`UPDATE auth.session SET "expiresAt" = now() - interval '1 minute' WHERE id=$1`, [session.sessionId]);
    expect(await auth.sessions.live(session.sessionId, session.userId)).toBe(false);
    expect(await resolve(cookie)).toBeNull();
  });

  it('rolls a session in use forward to a fresh seven days', async () => {
    const cookie = await signInByOtp(auth, baseURL, 'mxmx_test_rolling@example.com', () => otp);
    const session = (await resolve(cookie))!;
    await db.query(`UPDATE auth.session SET "expiresAt" = now() + interval '5 days' WHERE id=$1`, [session.sessionId]);
    const renewed = await resolve(cookie);
    expect(renewed?.setCookies?.some(c => /session_token=.*Max-Age=604800/.test(c))).toBe(true);
    expect(await expiresAt(session.sessionId)).toBeGreaterThan(Date.now() + 6 * DAY);
  });

  it('gives a trusted-issuer sign-in a remembered, renewing seven-day session', async () => {
    const first = (await resolve(await signInByOtp(auth, baseURL, 'mxmx_test_trusted@example.com', () => otp)))!;
    const started = await auth.sessions.start(first.userId);
    expect(started.find(c => /session_token=/.test(c))).toMatch(/Max-Age=604800/);
    const cookie = cookieOf(started);
    const session = (await resolve(cookie))!;
    expect(await expiresAt(session.sessionId)).toBeGreaterThan(Date.now() + 6 * DAY);
    await db.query(`UPDATE auth.session SET "expiresAt" = now() + interval '5 days' WHERE id=$1`, [session.sessionId]);
    await resolve(cookie);
    expect(await expiresAt(session.sessionId)).toBeGreaterThan(Date.now() + 6 * DAY);
  });
});
