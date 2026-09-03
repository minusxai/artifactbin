/**
 * The token never rides the prompt in plugin and MCP modes: the driver logs in like a person (email code, read
 * from the eval's Resend inbox) and grants like an MCP client (OAuth + PKCE), once per leg. Decided 2026-09-03.
 * Seeded RED by the orchestrator.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireCredential, callbackCode, codeFromMail, credentialSourceFor, localLoginEmail, memoizeCredential, pickLoginMail, pkcePair, writeArtifactbinEnv, codeFromOutbox, shareForScoring, deploymentLoginEmail } from '../lib/credential';

describe('credential source per mode', () => {
  const inbox = { RESEND_EVAL_API_KEY: 're_x', EVAL_LOGIN_EMAIL: 'mxmx_eval@social-worm.resend.app' };
  it('copy-text mode keeps the paste line', () => {
    expect(credentialSourceFor('fetched_skill+api_action', inbox)).toBe('paste');
  });
  it('the other three modes log in through the inbox when it is configured', () => {
    for (const m of ['installed_skill+api_action', 'fetched_skill+mcp_action', 'installed_skill+mcp_action'] as const) {
      expect(credentialSourceFor(m, inbox), m).toBe('inbox-oauth');
    }
  });
  it('a pre-provisioned account token is the fallback, and no source at all is an error that names the env', () => {
    expect(credentialSourceFor('installed_skill+mcp_action', { EVAL_ACCOUNT_TOKEN: 'mx_abc' })).toBe('secret');
    expect(() => credentialSourceFor('installed_skill+mcp_action', {})).toThrow(/RESEND_EVAL_API_KEY|EVAL_ACCOUNT_TOKEN/);
  });
});

describe('the pure pieces of the login', () => {
  it('reads the six-digit code out of the login mail', () => {
    expect(codeFromMail('Your code is 482913')).toBe('482913');
    expect(codeFromMail('nothing here')).toBeNull();
  });
  it('picks the newest mail to the eval address sent after the request, ignoring older and foreign mail', () => {
    const since = Date.parse('2026-09-03T13:00:00Z');
    const list = [
      { id: 'old', to: ['mxmx_eval@social-worm.resend.app'], created_at: '2026-09-03T12:59:00Z', subject: 'Your login code' },
      { id: 'other', to: ['someone@social-worm.resend.app'], created_at: '2026-09-03T13:00:30Z', subject: 'Your login code' },
      { id: 'a', to: ['mxmx_eval@social-worm.resend.app'], created_at: '2026-09-03T13:00:10Z', subject: 'Your login code' },
      { id: 'b', to: ['mxmx_eval@social-worm.resend.app'], created_at: '2026-09-03T13:00:20Z', subject: 'Your login code' },
    ];
    expect(pickLoginMail(list, { to: 'mxmx_eval@social-worm.resend.app', since })?.id).toBe('b');
    expect(pickLoginMail(list.slice(0, 2), { to: 'mxmx_eval@social-worm.resend.app', since })).toBeNull();
  });
  it('PKCE: the challenge is the S256 of the verifier, base64url', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkcePair().verifier).not.toBe(verifier);
  });
  it('reads the authorization code off the consent redirect', () => {
    expect(callbackCode('http://127.0.0.1:9987/cb?code=abc123&state=s')).toBe('abc123');
    expect(callbackCode('http://127.0.0.1:9987/cb?error=access_denied')).toBeNull();
  });
});

/**
 * The whole login, driven over a stubbed `fetch`: ask for a code, read it out of the eval's inbox,
 * sign in, then grant as an MCP client would (register → consent form → approve → token). Measured
 * against https://artifactbin.dev by `evals/scripts/spike-inbox-oauth.ts` before this was written.
 */
describe('acquireCredential', () => {
  const env = { RESEND_EVAL_API_KEY: 're_x', EVAL_LOGIN_EMAIL: 'mxmx_eval@social-worm.resend.app' };
  const BASE = 'https://x.test';

  /**
   * The Resend host, matched by ORIGIN — never by substring: `https://api.resend.com.evil.test/…`
   * starts with the string too, which is exactly what CodeQL's "incomplete URL substring
   * sanitization" is about (flagged high on the first version of this file).
   */
  const RESEND_ORIGIN = 'https://api.resend.com';
  const isResend = (raw: string, prefix?: string): boolean => {
    try {
      const url = new URL(raw);
      return url.origin === RESEND_ORIGIN && (prefix === undefined || url.pathname.startsWith(prefix));
    } catch {
      return false;
    }
  };

  interface Seen { url: string; method: string; body: string; headers: Record<string, string> }

  function stubFetch(seen: Seen[], over: { code?: string } = {}) {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = Object.fromEntries(new Headers(init?.headers as HeadersInit).entries());
      const body = typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '';
      seen.push({ url, method, body, headers });
      if (url.startsWith(`${BASE}/api/auth/email-otp/send-verification-otp`)) return new Response('{}', { status: 200 });
      if (isResend(url, '/emails/receiving/')) {
        return new Response(JSON.stringify({ text: `Your code is ${over.code ?? '424242'}` }), { status: 200 });
      }
      if (isResend(url, '/emails/receiving')) {
        return new Response(JSON.stringify({ data: [{ id: 'mail_1', to: [env.EVAL_LOGIN_EMAIL], created_at: new Date().toISOString(), subject: 'Your login code' }] }), { status: 200 });
      }
      if (url.startsWith(`${BASE}/api/auth/sign-in/email-otp`)) {
        return new Response('{}', { status: 200, headers: { 'set-cookie': '__Secure-better-auth.session_token=sess_1; Path=/; HttpOnly' } });
      }
      if (url.startsWith(`${BASE}/oauth/register`)) return new Response(JSON.stringify({ client_id: 'mcp_1' }), { status: 201 });
      if (url.startsWith(`${BASE}/oauth/authorize/approve`)) {
        const form = new URLSearchParams(body);
        return new Response(null, { status: 303, headers: { location: `${form.get('redirect_uri')}?code=auth_code_1&state=${form.get('state') ?? ''}` } });
      }
      if (url.startsWith(`${BASE}/oauth/authorize`)) {
        const q = new URL(url).searchParams;
        const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${value}">`;
        return new Response(`<h1>Connect to artifactbin</h1><p>will belong to <strong>${env.EVAL_LOGIN_EMAIL}</strong></p><form method="POST" action="/oauth/authorize/approve">${
          hidden('client_id', q.get('client_id') ?? '')}${hidden('redirect_uri', q.get('redirect_uri') ?? '')}${hidden('code_challenge', q.get('code_challenge') ?? '')}${
          hidden('resource', `${BASE}/mcp`)}${hidden('scope', 'artifacts')}${hidden('state', q.get('state') ?? '')}<input type="hidden" name="grant" value="user"></form>`, { status: 200 });
      }
      if (url.startsWith(`${BASE}/oauth/token`)) return new Response(JSON.stringify({ access_token: 'mx_granted', scope: 'artifacts' }), { status: 200 });
      throw new Error(`unstubbed ${method} ${url}`);
    };
  }

  it('logs in with the emailed code and comes back with an ACCOUNT token', async () => {
    const seen: Seen[] = [];
    const got = await acquireCredential('inbox-oauth', { base: BASE, env, fetch: stubFetch(seen), sleep: async () => {} });
    expect(got).toEqual({ token: 'mx_granted', owner: 'account', email: env.EVAL_LOGIN_EMAIL, cookie: '__Secure-better-auth.session_token=sess_1' });

    const send = seen.find((s) => s.url.includes('send-verification-otp'))!;
    expect(JSON.parse(send.body)).toEqual({ email: env.EVAL_LOGIN_EMAIL, type: 'sign-in' });
    const verify = seen.find((s) => s.url.includes('/sign-in/email-otp'))!;
    expect(JSON.parse(verify.body)).toEqual({ email: env.EVAL_LOGIN_EMAIL, otp: '424242' });
    // The inbox is read with the eval's own key, never the product's.
    expect(seen.find((s) => isResend(s.url))!.headers.authorization).toBe('Bearer re_x');
  });

  it('carries the session cookie into the consent screen and posts the form back verbatim', async () => {
    const seen: Seen[] = [];
    await acquireCredential('inbox-oauth', { base: BASE, env, fetch: stubFetch(seen), sleep: async () => {} });
    const authorize = seen.find((s) => s.url.includes('/oauth/authorize?'))!;
    expect(authorize.headers.cookie).toContain('__Secure-better-auth.session_token=sess_1');
    const approve = seen.find((s) => s.url.includes('/oauth/authorize/approve'))!;
    expect(approve.headers.cookie).toContain('__Secure-better-auth.session_token=sess_1');
    const form = new URLSearchParams(approve.body);
    // resource and scope come from the FORM, never hard-coded — the route rejects a mismatch.
    expect(form.get('resource')).toBe(`${BASE}/mcp`);
    expect(form.get('scope')).toBe('artifacts');
    expect(form.get('grant')).toBe('user');
    expect(form.get('client_id')).toBe('mcp_1');
  });

  it('proves possession of the PKCE verifier the challenge was made from', async () => {
    const seen: Seen[] = [];
    await acquireCredential('inbox-oauth', { base: BASE, env, fetch: stubFetch(seen), sleep: async () => {} });
    const challenge = new URL(seen.find((s) => s.url.includes('/oauth/authorize?'))!.url).searchParams.get('code_challenge');
    const exchange = new URLSearchParams(seen.find((s) => s.url.includes('/oauth/token'))!.body);
    expect(exchange.get('grant_type')).toBe('authorization_code');
    expect(exchange.get('code')).toBe('auth_code_1');
    expect(createHash('sha256').update(exchange.get('code_verifier') ?? '').digest('base64url')).toBe(challenge);
  });

  /**
   * The cookie is not a detail of the login — it is the CREDENTIAL. An account's documents are born
   * private, and the only door that makes one unlisted is the owner's own browser door
   * (`/api/my/artifacts/<id>/sharing`), which takes a session and never a bearer. So the session the
   * driver already held travels with the token. A pre-provisioned `EVAL_ACCOUNT_TOKEN` names no
   * session at all — nothing was logged in — and says so by carrying no cookie.
   */
  it('the OAuth credential carries the session cookie; a pre-provisioned token carries none', async () => {
    const seen: Seen[] = [];
    const granted = await acquireCredential('inbox-oauth', { base: BASE, env, fetch: stubFetch(seen), sleep: async () => {} });
    expect(granted?.cookie).toBe('__Secure-better-auth.session_token=sess_1');
    const pre = await acquireCredential('secret', { base: BASE, env: { EVAL_ACCOUNT_TOKEN: 'mx_pre' }, fetch: stubFetch(seen), sleep: async () => {} });
    expect(pre?.cookie).toBeUndefined();
  });

  it('a pre-provisioned account token is used as-is, with no login at all', async () => {
    const seen: Seen[] = [];
    const got = await acquireCredential('secret', { base: BASE, env: { EVAL_ACCOUNT_TOKEN: 'mx_pre' }, fetch: stubFetch(seen), sleep: async () => {} });
    expect(got).toEqual({ token: 'mx_pre', owner: 'account' });
    expect(seen).toEqual([]);
  });

  it('the paste flow acquires nothing — the product hands the token to the agent itself', async () => {
    const seen: Seen[] = [];
    expect(await acquireCredential('paste', { base: BASE, env, fetch: stubFetch(seen), sleep: async () => {} })).toBeNull();
    expect(seen).toEqual([]);
  });

  /**
   * The SAME dance against a server this driver booted: only the code reader changes. The mail is in the
   * file the local server writes instead of sending (`services/proxy/src/mail.ts devOutboxMailer`), so
   * nothing may reach Resend — a local server has no key and must never need one.
   */
  it('a local server: the code is read off its dev outbox and the same OAuth dance follows', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-outbox-'));
    const outbox = path.join(dir, 'dev-mail.jsonl');
    const address = 'mxmx_eval_claude_code_sonnet@example.com';
    const line = (mail: Record<string, unknown>) => `${JSON.stringify(mail)}\n`;
    fs.writeFileSync(outbox, [
      // A previous run's code, superseded — using it would burn an attempt.
      line({ kind: 'otp', to: address, otp: '111111', createdAt: new Date(Date.now() - 3_600_000).toISOString() }),
      // Another leg's mail in a shared outbox.
      line({ kind: 'otp', to: 'mxmx_eval_other@example.com', otp: '222222', createdAt: new Date().toISOString() }),
      line({ kind: 'otp', to: address, otp: '909090', text: 'Your artifactbin login code is 909090', createdAt: new Date().toISOString() }),
    ].join(''));

    const seen: Seen[] = [];
    const got = await acquireCredential('outbox-oauth', {
      base: BASE, env: {}, localOutbox: outbox, email: address, fetch: stubFetch(seen), sleep: async () => {},
    });
    expect(got).toEqual({ token: 'mx_granted', owner: 'account', email: address, cookie: '__Secure-better-auth.session_token=sess_1' });

    const send = seen.find((s) => s.url.includes('send-verification-otp'))!;
    expect(JSON.parse(send.body)).toEqual({ email: address, type: 'sign-in' });
    const verify = seen.find((s) => s.url.includes('/sign-in/email-otp'))!;
    expect(JSON.parse(verify.body)).toEqual({ email: address, otp: '909090' });
    expect(seen.some((s) => isResend(s.url))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * MEASURED against a locally booted server (`.agent/`, ports 5222/5223): every write the login makes
   * came back `403 {"code":"INVALID_ORIGIN"}`, because Better Auth trusts exactly the product's PUBLIC
   * base URL (`services/proxy/src/standalone.ts humanAuthOptionsFor` → `baseURL`) — which for a server
   * this driver boots is the leg's PROXY, not the server port the driver dials. So the origin is stated,
   * not assumed to be the base.
   */
  it('declares the origin the product trusts, which need not be the address the driver dials', async () => {
    const seen: Seen[] = [];
    const ORIGIN = 'http://127.0.0.1:3101';
    await acquireCredential('inbox-oauth', { base: BASE, env, origin: ORIGIN, fetch: stubFetch(seen), sleep: async () => {} });
    for (const url of ['/api/auth/email-otp/send-verification-otp', '/api/auth/sign-in/email-otp', '/oauth/authorize/approve']) {
      expect(seen.find((s) => s.url === `${BASE}${url}`)?.headers.origin, url).toBe(ORIGIN);
    }
  });

  it('the origin defaults to the base — a deployment is reached on the address it mints links from', async () => {
    const seen: Seen[] = [];
    await acquireCredential('inbox-oauth', { base: BASE, env, fetch: stubFetch(seen), sleep: async () => {} });
    expect(seen.find((s) => s.url === `${BASE}/api/auth/sign-in/email-otp`)?.headers.origin).toBe(BASE);
  });

  it('outbox-oauth says what is missing rather than silently logging in as nobody', async () => {
    const seen: Seen[] = [];
    await expect(acquireCredential('outbox-oauth', { base: BASE, env: {}, fetch: stubFetch(seen), sleep: async () => {} }))
      .rejects.toThrow(/outbox/i);
    expect(seen).toEqual([]);
  });
});

/**
 * ONE login per SERVER, which is not the same as one per run: `--ci` gives a failed flow a second attempt,
 * and that attempt boots a NEW server (`pglite://memory`, a fresh `AUTH__SECRET`, a truncated outbox), so
 * a token memoized across attempts names an account that no longer exists. Seen only now, because before
 * this phase a locally booted server could not hold an account at all.
 */
describe('memoizeCredential', () => {
  const mint = () => {
    let n = 0;
    return async (base: string) => ({ token: `mx_${++n}`, owner: 'account' as const, email: base });
  };
  it('a deployment outlives the run: one login, reused by every attempt', async () => {
    const once = memoizeCredential(mint(), { reusable: true });
    expect((await once('https://x.test'))?.token).toBe('mx_1');
    expect((await once('https://x.test'))?.token).toBe('mx_1');
  });
  it('a server the driver booted is new on every attempt, and so is its account', async () => {
    const each = memoizeCredential(mint(), { reusable: false });
    expect((await each('http://127.0.0.1:3100'))?.token).toBe('mx_1');
    expect((await each('http://127.0.0.1:3100'))?.token).toBe('mx_2');
  });
});

describe('writeArtifactbinEnv', () => {
  it('writes the skill’s own connection file into the harness home, readable only by its owner', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-cred-'));
    writeArtifactbinEnv(home, 'https://x.test', 'mx_secret');
    const file = path.join(home, '.artifactbin.env');
    expect(fs.readFileSync(file, 'utf8')).toBe('ARTIFACTBIN_URL=https://x.test\nARTIFACTBIN_TOKEN=mx_secret\n');
    expect(fs.statSync(file).mode & 0o077).toBe(0);
    fs.rmSync(home, { recursive: true, force: true });
  });
});

/**
 * A LOCAL eval server (CI's agent smoke, a laptop) has no Resend inbox: it writes its login mail to the dev outbox the
 * browser gates read. The driver logs in through that file — same OAuth dance, a different code reader. Seeded RED.
 */
describe('a local server logs in through its dev outbox', () => {
  it('the account modes pick outbox-oauth when the driver booted the server, before any inbox or secret', () => {
    const local = { localOutbox: '/tmp/x/dev-mail.jsonl' };
    for (const m of ['installed_skill+api_action', 'fetched_skill+mcp_action', 'installed_skill+mcp_action'] as const) {
      expect(credentialSourceFor(m, {}, local), m).toBe('outbox-oauth');
      expect(credentialSourceFor(m, { EVAL_ACCOUNT_TOKEN: 'mx_abc' }, local), m).toBe('outbox-oauth');
    }
    expect(credentialSourceFor('fetched_skill+api_action', {}, local)).toBe('paste');
  });
  it('reads the newest code addressed to the eval account that landed after the request', () => {
    const since = Date.parse('2026-09-03T13:00:00Z');
    const lines = [
      { to: 'mxmx_eval_x@example.com', text: 'Your code is 111111', otp: '111111', at: '2026-09-03T12:59:00Z' },
      { to: 'someone@example.com', text: 'Your code is 222222', otp: '222222', at: '2026-09-03T13:00:05Z' },
      { to: 'mxmx_eval_x@example.com', text: 'Your code is 333333', at: '2026-09-03T13:00:10Z' },
    ];
    expect(codeFromOutbox(lines, { to: 'mxmx_eval_x@example.com', since })).toBe('333333');
    expect(codeFromOutbox(lines.slice(0, 2), { to: 'mxmx_eval_x@example.com', since })).toBeNull();
  });
  it('the local account is a throwaway named after the leg, unless the caller named one', () => {
    expect(localLoginEmail('claude_code × sonnet', {})).toBe('mxmx_eval_claude-code-sonnet@example.com');
    expect(localLoginEmail('claude_code × sonnet', { EVAL_LOGIN_EMAIL: 'mxmx_eval@social-worm.resend.app' }))
      .toBe('mxmx_eval@social-worm.resend.app');
  });
});

/**
 * An account-owned run is scored the way a person shares it: every artifact the agent made is made unlisted through
 * the owner's own sharing door before the scorer's anonymous reads (PR #16 CI: an agent's own document was born
 * private and scored `published: false`). Seeded RED by the orchestrator.
 */
describe('shareForScoring', () => {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> = [];
  const fetchStub = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), headers: Object.fromEntries(new Headers(init.headers).entries()), body: String(init.body) });
    if (url.endsWith('/gone00/sharing')) return new Response('{"error":"not_found"}', { status: 404 });
    if (url.endsWith('/boom00/sharing')) return new Response('{"error":"boom"}', { status: 500 });
    return new Response('{"visibility":"unlisted"}', { status: 200 });
  }) as unknown as typeof fetch;
  it('PUTs unlisted to the owner sharing door with the session cookie, once per id, skipping a deleted one', async () => {
    calls.length = 0;
    const shared = await shareForScoring({ base: 'https://x.test', cookie: 'sess=abc', ids: ['abc123', 'gone00', 'abc123'], fetch: fetchStub });
    expect(shared).toEqual(['abc123']);
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts.map((c) => c.url)).toEqual(['https://x.test/api/my/artifacts/abc123/sharing', 'https://x.test/api/my/artifacts/gone00/sharing']);
    expect(puts[0].headers.cookie).toBe('sess=abc');
    expect(JSON.parse(puts[0].body)).toEqual({ visibility: 'unlisted' });
  });
  it('names the id when the door refuses', async () => {
    await expect(shareForScoring({ base: 'https://x.test', cookie: 'sess=abc', ids: ['boom00'], fetch: fetchStub })).rejects.toThrow(/boom00/);
  });
});

describe('deploymentLoginEmail — one inbox, one door per harness', () => {
  it('adds +<harness> to the configured address’s local part', () => {
    expect(deploymentLoginEmail('mxmx_eval@social-worm.resend.app', 'pi')).toBe('mxmx_eval+pi@social-worm.resend.app');
    expect(deploymentLoginEmail('mxmx_eval@social-worm.resend.app', 'claude-code')).toBe('mxmx_eval+claude-code@social-worm.resend.app');
  });
  it('an address the caller already tagged is used verbatim', () => {
    expect(deploymentLoginEmail('mxmx_eval+smoke@social-worm.resend.app', 'pi')).toBe('mxmx_eval+smoke@social-worm.resend.app');
  });
});
