import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHumanAuth, type HumanAuth, type OutgoingMail } from '../src/auth/human';
import { createReadSessions, type ReadSessions } from '../src/auth/read-session';
import { ensureProxySchema } from '../src/schema';

let pg: PGlite, auth: HumanAuth, reads: ReadSessions;
const mail: OutgoingMail[] = [];
const base = 'https://i.example.test';
beforeAll(async () => {
  pg = new PGlite();
  await ensureProxySchema(pg);
  auth = await createHumanAuth({ pglite: pg, secret: 'read-session-tests'.padEnd(32, '0'),
    baseURL: base, secure: true, mail: { send: async m => { mail.push(m); } } });
  reads = createReadSessions(pg);
});
beforeEach(async () => {
  mail.length = 0;
  await pg.exec('DELETE FROM auth.credentials; DELETE FROM auth.session; DELETE FROM auth.account; DELETE FROM auth.verification; DELETE FROM auth.user');
});
afterAll(async () => { await pg.close(); });

async function login() {
  const call = (path: string, body: unknown) => auth.handler(new Request(`${base}/api/auth${path}`, {
    method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  const email = 'reader@example.test';
  expect((await call('/email-otp/send-verification-otp', { email, type: 'sign-in' })).status).toBe(200);
  expect((await call('/sign-in/email-otp', { email, otp: mail.at(-1)!.otp })).status).toBe(200);
  return (await pg.query<{ id: string; userId: string; token: string }>('SELECT id, "userId", token FROM auth.session')).rows[0];
}

describe('read handles backed by actual Better Auth sessions', () => {
  it('stores only a hash, returns only read identity, and cannot authenticate as a full session', async () => {
    const session = await login();
    const handle = await reads.issue(session.id);
    expect(handle).not.toBeNull();
    expect(handle!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(handle!.token).not.toBe(session.token);
    expect(await reads.resolve(handle!.token)).toEqual({ userId: session.userId, email: 'reader@example.test' });
    await pg.query('UPDATE auth."user" SET "emailVerified"=false WHERE id=$1', [session.userId]);
    expect(await reads.resolve(handle!.token)).toEqual({ userId: session.userId });
    const stored = JSON.stringify((await pg.query('SELECT * FROM auth.credentials')).rows);
    expect(stored).not.toContain(handle!.token);
    expect(stored).not.toContain(session.token);
    expect(await auth.sessions.resolve(new Request(base, { headers: {
      cookie: `__Secure-better-auth.session_token=${handle!.token}`,
    } }))).toBeNull();
    expect(await reads.resolve(session.token)).toBeNull();
  });

  it('invalidates every handle immediately when the underlying session is revoked', async () => {
    const session = await login();
    const one = await reads.issue(session.id), two = await reads.issue(session.id);
    expect(one!.token).not.toBe(two!.token);
    await pg.query('DELETE FROM auth.session WHERE id=$1', [session.id]);
    expect(await reads.resolve(one!.token)).toBeNull();
    expect(await reads.resolve(two!.token)).toBeNull();
    expect(await reads.issue(session.id)).toBeNull();
  });

  it('honors session expiry and independent handle revocation', async () => {
    const session = await login();
    const one = await reads.issue(session.id), two = await reads.issue(session.id);
    await pg.query('UPDATE auth.credentials SET deleted_at=now() WHERE credential_hash=(SELECT credential_hash FROM auth.credentials ORDER BY created_at LIMIT 1)');
    expect(await reads.resolve(one!.token)).toBeNull();
    expect(await reads.resolve(two!.token)).not.toBeNull();
    await pg.query('UPDATE auth.session SET "expiresAt"=now()-interval \'1 second\' WHERE id=$1', [session.id]);
    expect(await reads.resolve(two!.token)).toBeNull();
    expect(await reads.issue(session.id)).toBeNull();
  });

  it('rejects malformed handles and schema identifiers', async () => {
    expect(await reads.resolve('')).toBeNull();
    expect(await reads.resolve('x'.repeat(10000))).toBeNull();
    expect(() => createReadSessions(pg, 'auth; DROP SCHEMA auth')).toThrow(/schema/);
  });
});
