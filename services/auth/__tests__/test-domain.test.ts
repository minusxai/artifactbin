/**
 * TEST-DOMAIN SIGN-IN: with TEST_DOMAIN + TEST_DOMAIN_OTP, an address at exactly that domain signs in
 * with the fixed code and receives no mail; anything else (a subdomain, a longer name ending with it,
 * the feature off, a wrong code) behaves exactly as ordinary login.
 */
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {isTestDomainEmail,parseTestDomainSignIn} from '@artifactbin/contracts';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {Kysely} from 'kysely';
import {createHumanAuth,humanAuthOptions,type HumanAuth,type OutgoingMail} from '../src/auth/human';
import {pgliteDialect} from '../src/auth/pglite';
import {testDomainSignInOf} from '../src/config';

const DOMAIN = 'test.example.dev';
const CODE = 'a'.repeat(20) + 'B7_-'.repeat(5);
const BASE = 'http://localhost:4795';

describe('settings', () => {
  it('is on only with both names, a domain name and a 32-128 character code', () => {
    expect(parseTestDomainSignIn(undefined, CODE)).toEqual({state: 'off'});
    expect(parseTestDomainSignIn(DOMAIN, undefined)).toEqual({state: 'off'});
    expect(parseTestDomainSignIn('', '')).toEqual({state: 'off'});
    expect(parseTestDomainSignIn(' Test.Example.DEV ', CODE)).toEqual({state: 'on', value: {domain: DOMAIN, code: CODE}});
    expect(parseTestDomainSignIn(DOMAIN, 'x'.repeat(31)).state).toBe('invalid');
    expect(parseTestDomainSignIn(DOMAIN, 'x'.repeat(129)).state).toBe('invalid');
    expect(parseTestDomainSignIn(DOMAIN, 'x'.repeat(31) + ' ').state).toBe('invalid');
    expect(parseTestDomainSignIn('*.example.dev', CODE).state).toBe('invalid');
    expect(parseTestDomainSignIn('https://test.example.dev', CODE).state).toBe('invalid');
  });

  it('refuses a short code with a reason that never contains it', () => {
    const lines: string[] = [];
    const short = 'shortsecret123';
    expect(testDomainSignInOf({TEST_DOMAIN: DOMAIN, TEST_DOMAIN_OTP: short}, line => lines.push(line))).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/test-domain sign-in disabled: TEST_DOMAIN_OTP must be 32 to 128/);
    expect(lines[0]).not.toContain(short);
    expect(testDomainSignInOf({TEST_DOMAIN: DOMAIN}, line => lines.push(line))).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(testDomainSignInOf({TEST_DOMAIN: DOMAIN, TEST_DOMAIN_OTP: CODE})).toEqual({domain: DOMAIN, code: CODE});
  });

  it('matches the exact domain only', () => {
    expect(isTestDomainEmail(`eval-1@${DOMAIN}`, DOMAIN)).toBe(true);
    expect(isTestDomainEmail(`Eval-1@TEST.EXAMPLE.DEV`, DOMAIN)).toBe(true);
    for (const email of [`x@evil-${DOMAIN}`, `x@${DOMAIN}.evil.com`, `x@sub.${DOMAIN}`, `@${DOMAIN}`, `a@b@${DOMAIN}`, DOMAIN, `x@example.dev`]) {
      expect(isTestDomainEmail(email, DOMAIN), email).toBe(false);
    }
  });
});

describe('the constant-time path', () => {
  it('verifies the fixed code through Better Auth\'s decrypt branch, which compares with constantTimeEqual', async () => {
    const pg = new PGlite();
    const db = new Kysely<Record<string, unknown>>({dialect: pgliteDialect(pg)});
    const options = humanAuthOptions({secret: 's'.repeat(32), baseURL: BASE, mail: {send: async () => {}}, testDomain: {domain: DOMAIN, code: CODE}}, db);
    const plugin = (options.plugins ?? []).find(p => p.id === 'email-otp') as unknown as {options: {storeOTP: {encrypt(o: string): Promise<string>; decrypt(v: string): Promise<string>}}};
    const store = plugin.options.storeOTP;
    const marker = await store.encrypt(CODE);
    expect(marker).not.toContain(CODE);
    expect(await store.decrypt(marker)).toBe(CODE);
    expect(await store.encrypt('123456')).toBe('123456');
    // Better Auth 1.7.14 (pinned) verifies a decrypt-stored code as constantTimeEqual(await decrypt(stored), submitted).
    const require = createRequire(import.meta.url);
    const dist = join(dirname(require.resolve('better-auth')), 'plugins/email-otp/otp-token.mjs');
    expect(readFileSync(dist, 'utf8')).toMatch(/"decrypt" in opts\.storeOTP\) \{\s*const decryptedOtp = await opts\.storeOTP\.decrypt\(storedOtp\);\s*return constantTimeEqual\(decryptedOtp, otp\);\s*\}/);
    await pg.close();
  });
});

describe('sign-in', () => {
  let pg: PGlite;
  let on: HumanAuth, off: HumanAuth;
  const sent: OutgoingMail[] = [];
  const mail = {send: async (m: OutgoingMail) => { sent.push(m); }};
  beforeAll(async () => {
    pg = new PGlite();
    const common = {pglite: pg, secret: 'test-domain-secret'.padEnd(32, '0'), baseURL: BASE, mail};
    on = await createHumanAuth({...common, testDomain: {domain: DOMAIN, code: CODE}});
    off = await createHumanAuth(common);
  });
  afterAll(async () => { await pg.close(); });
  beforeEach(async () => { sent.length = 0; await pg.exec('DELETE FROM auth.session; DELETE FROM auth.verification; DELETE FROM auth.user'); });

  const call = (auth: HumanAuth, path: string, body: unknown) => auth.handler(new Request(`${BASE}/api/auth${path}`, {
    method: 'POST', headers: {'content-type': 'application/json', origin: BASE}, body: JSON.stringify(body),
  }));
  const send = (auth: HumanAuth, email: string) => call(auth, '/email-otp/send-verification-otp', {email, type: 'sign-in'});
  const signIn = (auth: HumanAuth, email: string, otp: string) => call(auth, '/sign-in/email-otp', {email, otp});
  const stored = async () => (await pg.query<{value: string}>('SELECT value FROM auth.verification')).rows.map(r => r.value);

  it('signs a test-domain address in with the fixed code and sends no mail', async () => {
    const email = `eval-run1-x7@${DOMAIN}`;
    expect((await send(on, email)).status).toBe(200);
    expect(sent).toEqual([]);
    expect((await stored()).join()).not.toContain(CODE);
    const res = await signIn(on, email, CODE);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({user: {email}, account_created_this_login: true});
    // Single use, like every code: a second sign-in needs a new send.
    expect((await signIn(on, email, CODE)).status).toBe(400);
    expect((await send(on, email)).status).toBe(200);
    expect((await signIn(on, email.toUpperCase(), CODE)).status).toBe(200);
  });

  it('refuses a wrong code, counting it like any other attempt', async () => {
    const email = `eval-wrong@${DOMAIN}`;
    await send(on, email);
    const sameLength = CODE.slice(0, -1) + (CODE.endsWith('a') ? 'b' : 'a');
    for (const wrong of [sameLength, CODE.slice(0, 32), CODE + 'x', '123456']) {
      expect((await signIn(on, email, wrong)).status, wrong.length.toString()).toBe(400);
    }
    expect((await stored())[0]).toMatch(/:4$/);
    expect((await signIn(on, email, CODE)).status).toBe(200);
  });

  it('locks the address after the attempt cap, as ordinary login does', async () => {
    const email = `eval-cap@${DOMAIN}`;
    await send(on, email);
    for (let i = 0; i < 5; i++) await signIn(on, email, 'z'.repeat(40));
    expect((await signIn(on, email, CODE)).status).toBe(403);
  });

  it('treats subdomains and longer names as ordinary addresses', async () => {
    for (const email of [`x@sub.${DOMAIN}`, `x@${DOMAIN}.evil.com`, `x@evil-${DOMAIN}`]) {
      sent.length = 0;
      await send(on, email);
      expect(sent.map(m => m.to), email).toEqual([email]);
      expect(sent[0]!.otp).toMatch(/^\d{6}$/);
      expect((await signIn(on, email, CODE)).status, email).toBe(400);
      expect((await signIn(on, email, sent[0]!.otp!)).status, email).toBe(200);
    }
  });

  it('keeps ordinary addresses on mailed six-digit codes', async () => {
    await send(on, 'person@example.com');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.otp).toMatch(/^\d{6}$/);
    expect((await signIn(on, 'person@example.com', sent[0]!.otp!)).status).toBe(200);
  });

  it('is fully off without the setting: mail goes out and the fixed code is refused', async () => {
    const email = `eval-off@${DOMAIN}`;
    await send(off, email);
    expect(sent.map(m => m.to)).toEqual([email]);
    expect((await signIn(off, email, CODE)).status).toBe(400);
  });

  it('turned off, a code sent while it was on no longer signs in', async () => {
    const email = `eval-leftover@${DOMAIN}`;
    await send(on, email);
    expect((await signIn(off, email, CODE)).status).toBe(400);
  });

  it('mails nothing else to the test domain either', async () => {
    const email = `eval-mail@${DOMAIN}`;
    await send(on, email);
    await call(on, '/email-otp/send-verification-otp', {email, type: 'email-verification'});
    expect(sent).toEqual([]);
  });
});
