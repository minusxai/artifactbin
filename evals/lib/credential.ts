/**
 * HOW A LEG GETS ITS CREDENTIAL — and why the token stops riding the prompt.
 *
 * The copy-text treatment (`fetched_skill+api_action`) IS the paste: a logged-out person copies the
 * product's own line, token and all, into their agent. That is the product under test and it is left
 * alone. The other three treatments are what a person with the PLUGIN has, and that person never
 * pastes a token — they log in, they click Approve, and their agent finds the connection where the
 * skill says it lives (`~/.artifactbin.env`) or in its MCP configuration. So the driver does the same
 * thing, over plain HTTP, with no browser:
 *
 *   1. `POST /api/auth/email-otp/send-verification-otp {email, type:'sign-in'}` — Better Auth's own
 *      email-OTP plugin (`services/proxy/src/auth/human.ts`);
 *   2. the six-digit code out of the eval's Resend inbound mailbox (`GET /emails/receiving`), newest
 *      mail to the eval address sent after the request;
 *   3. `POST /api/auth/sign-in/email-otp {email, otp}` → the session cookie;
 *   4. the OAuth grant an MCP client makes: dynamic registration, PKCE, the consent form fetched WITH
 *      the cookie and posted back verbatim (its `resource`/`scope` are checked exactly, so they are
 *      read off the form rather than guessed), the code taken off the 303's `Location` — no listener
 *      is ever opened — and exchanged at `/oauth/token`.
 *
 * MEASURED against https://artifactbin.dev before this module was written (`scripts/spike-inbox-oauth.ts`):
 * the granted token is ACCOUNT-owned (a document it creates with no visibility is born `private`, and
 * `GET /api/artifacts` lists the account's other documents), it opens an MCP session, AND it is accepted
 * as a bearer on `/api/artifacts` — one credential serves both action transports. Login mail took 3 s
 * on one run and 50 s on another, hence the two-minute cap below.
 *
 * ONE login per leg: every task and every second attempt reuses what this returns.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CredentialEnv } from './env';
import { type EvalMode, actionTransport, installsSkills } from './mode';

/** Where a leg's token comes from. */
export const CREDENTIAL_SOURCES = ['paste', 'inbox-oauth', 'secret'] as const;
export type CredentialSource = (typeof CREDENTIAL_SOURCES)[number];

/** `--credential` — an override for the source `credentialSourceFor` would have chosen. */
export function parseCredentialSource(raw: string): CredentialSource {
  if (!(CREDENTIAL_SOURCES as readonly string[]).includes(raw)) {
    throw new Error(`unknown --credential "${raw}" — known: ${CREDENTIAL_SOURCES.join(', ')}`);
  }
  return raw as CredentialSource;
}

export interface Credential {
  token: string;
  /** `anonymous` is a token the product minted with no account behind it — what `/api/start` hands out. */
  owner: 'anonymous' | 'account';
  /** The account the token belongs to, when the driver logged in to get it. */
  email?: string;
}

/** The mail as the Resend inbound list returns it — only the fields the choice is made on. */
export interface InboundMail {
  id: string;
  to?: string[] | string;
  created_at?: string;
  subject?: string;
}

const RESEND_API = 'https://api.resend.com';
const OTP_POLL_MS = 2_000;
/** Measured: the same mailbox delivered in 3 s and in 50 s on two consecutive runs. */
const OTP_CAP_MS = 120_000;
/** Mirrors `scripts/gate-oauth-browser.mjs` — a loopback URI the product accepts. Nothing ever listens on it. */
const REDIRECT_URI = 'http://127.0.0.1:9987/cb';
const CLIENT_NAME = 'artifactbin eval driver';

/**
 * WHICH source a mode uses. The paste is the copy-text treatment's whole point, so it is never
 * replaced; the other three want an account, and say so loudly when neither way to get one is configured
 * (a silent fall back to an anonymous token would quietly change what the column measures).
 */
export function credentialSourceFor(mode: EvalMode, env: CredentialEnv): CredentialSource {
  if (!installsSkills(mode) && actionTransport(mode) === 'api') return 'paste';
  if (env.RESEND_EVAL_API_KEY && env.EVAL_LOGIN_EMAIL) return 'inbox-oauth';
  if (env.EVAL_ACCOUNT_TOKEN) return 'secret';
  throw new Error(`${mode} needs an ACCOUNT: set RESEND_EVAL_API_KEY and EVAL_LOGIN_EMAIL (the driver logs in and grants like an MCP client), or EVAL_ACCOUNT_TOKEN (a pre-provisioned account token)`);
}

/** The login mail says "Your code is NNNNNN" (`humanAuthOptions`'s `sendVerificationOTP`). */
export function codeFromMail(text: string): string | null {
  return /\b(\d{6})\b/.exec(text)?.[1] ?? null;
}

/**
 * The NEWEST mail to the eval address that arrived after the code was asked for. Both halves matter:
 * the mailbox is shared with whatever else the deployment sends, and a previous run's code is still
 * sitting in it — using that one burns an attempt against a code the product has already superseded.
 */
export function pickLoginMail(mails: InboundMail[], opts: { to: string; since: number }): InboundMail | null {
  const wanted = opts.to.toLowerCase();
  const mine = mails
    .filter((m) => {
      const to = Array.isArray(m.to) ? m.to : [m.to ?? ''];
      return to.some((r) => (r ?? '').toLowerCase().includes(wanted)) && Date.parse(m.created_at ?? '') >= opts.since;
    })
    .sort((a, b) => Date.parse(a.created_at ?? '') - Date.parse(b.created_at ?? ''));
  return mine[mine.length - 1] ?? null;
}

/** PKCE S256: the verifier is kept, only its hash travels to the authorization endpoint. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** The authorization code off the consent redirect; null when the grant was refused. */
export function callbackCode(location: string): string | null {
  try {
    return new URL(location).searchParams.get('code');
  } catch {
    return null;
  }
}

/**
 * The skill's own contract (`~/.artifactbin.env`, `ARTIFACTBIN_URL` / `ARTIFACTBIN_TOKEN`), written into
 * the harness's home before its turn — exactly what a person's machine looks like after they connected
 * once. 0600: the run's transcript and the report are artifacts a CI job uploads.
 */
export function writeArtifactbinEnv(homeDir: string, base: string, token: string): string {
  fs.mkdirSync(homeDir, { recursive: true });
  const file = path.join(homeDir, '.artifactbin.env');
  fs.writeFileSync(file, `ARTIFACTBIN_URL=${base}\nARTIFACTBIN_TOKEN=${token}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600); // an existing file keeps its old mode through writeFileSync
  return file;
}

export interface AcquireOptions {
  /** Where the product is, from the DRIVER's side. */
  base: string;
  env: CredentialEnv;
  /** Injected so the whole dance is exercised without a network. */
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The leg's credential. `paste` answers null — there is nothing to acquire, the product hands its token
 * to the agent itself and the driver only reads it back out of the paste when a task needs it.
 */
export async function acquireCredential(source: CredentialSource, opts: AcquireOptions): Promise<Credential | null> {
  if (source === 'paste') return null;
  if (source === 'secret') {
    const token = opts.env.EVAL_ACCOUNT_TOKEN;
    if (!token) throw new Error('EVAL_ACCOUNT_TOKEN is not set');
    return { token, owner: 'account' };
  }
  const email = opts.env.EVAL_LOGIN_EMAIL;
  const key = opts.env.RESEND_EVAL_API_KEY;
  if (!email || !key) throw new Error('inbox-oauth needs RESEND_EVAL_API_KEY and EVAL_LOGIN_EMAIL');
  const call = opts.fetch ?? globalThis.fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const cookie = await logIn({ base: opts.base, email, key, fetch: call, sleep });
  const token = await grantAsMcpClient({ base: opts.base, cookie, fetch: call });
  return { token, owner: 'account', email };
}

/** `fetch` has no cookie jar; the session is one header, carried by hand. */
function cookieFrom(res: Response): string {
  const pairs = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0].trim()).filter(Boolean);
  return pairs.join('; ');
}

async function logIn(o: { base: string; email: string; key: string; fetch: typeof globalThis.fetch; sleep: (ms: number) => Promise<void> }): Promise<string> {
  // The login door is per ADDRESS (five an hour): the SEND happens exactly once, only the INBOX is polled.
  const since = Date.now() - 5_000;
  const sent = await o.fetch(`${o.base}/api/auth/email-otp/send-verification-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: o.base },
    body: JSON.stringify({ email: o.email, type: 'sign-in' }),
  });
  if (!sent.ok) throw new Error(`login: send-verification-otp → ${sent.status}`);

  const otp = await readLoginCode({ ...o, since });
  const verified = await o.fetch(`${o.base}/api/auth/sign-in/email-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: o.base },
    body: JSON.stringify({ email: o.email, otp }),
  });
  if (!verified.ok) throw new Error(`login: sign-in/email-otp → ${verified.status}`);
  const cookie = cookieFrom(verified);
  if (!cookie) throw new Error('login: the product set no session cookie');
  return cookie;
}

async function readLoginCode(o: { key: string; email: string; since: number; fetch: typeof globalThis.fetch; sleep: (ms: number) => Promise<void> }): Promise<string> {
  const headers = { authorization: `Bearer ${o.key}` };
  const deadline = Date.now() + OTP_CAP_MS;
  for (;;) {
    const list = await o.fetch(`${RESEND_API}/emails/receiving?limit=10`, { headers });
    if (list.ok) {
      const body = await list.json() as { data?: InboundMail[] } | InboundMail[];
      const mail = pickLoginMail(Array.isArray(body) ? body : body.data ?? [], { to: o.email, since: o.since });
      if (mail) {
        const detail = await o.fetch(`${RESEND_API}/emails/receiving/${mail.id}`, { headers });
        if (detail.ok) {
          const full = await detail.json() as { text?: string; html?: string };
          const code = codeFromMail(full.text ?? full.html ?? '');
          if (code) return code;
        }
      }
    }
    if (Date.now() >= deadline) throw new Error(`login: no code reached the eval inbox within ${OTP_CAP_MS} ms`);
    await o.sleep(OTP_POLL_MS);
  }
}

/** The consent form's hidden fields — `resource` and `scope` are validated exactly, so they are READ, never guessed. */
function hiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) fields[m[1]] = m[2];
  return fields;
}

async function grantAsMcpClient(o: { base: string; cookie: string; fetch: typeof globalThis.fetch }): Promise<string> {
  const registered = await o.fetch(`${o.base}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: CLIENT_NAME, redirect_uris: [REDIRECT_URI] }),
  });
  const clientId = ((await registered.json().catch(() => ({}))) as { client_id?: string }).client_id;
  if (!clientId) throw new Error(`oauth: register → ${registered.status}`);

  const { verifier, challenge } = pkcePair();
  const authorize = await o.fetch(`${o.base}/oauth/authorize?${new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT_URI,
    code_challenge: challenge, code_challenge_method: 'S256', state: randomBytes(8).toString('hex'),
  })}`, { headers: { cookie: o.cookie } });
  if (!authorize.ok) throw new Error(`oauth: authorize → ${authorize.status}`);
  const fields = hiddenFields(await authorize.text());
  if (!fields.client_id) throw new Error('oauth: the consent screen was not the account-bound one (no session?)');

  // No listener, ever: the code is on the 303's Location, which `redirect: 'manual'` keeps readable.
  const approved = await o.fetch(`${o.base}/oauth/authorize/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: o.cookie, origin: o.base },
    body: new URLSearchParams({ ...fields, grant: 'user' }),
    redirect: 'manual',
  });
  const code = callbackCode(approved.headers.get('location') ?? '');
  if (!code) throw new Error(`oauth: approve → ${approved.status} with no code`);

  const exchanged = await o.fetch(`${o.base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier }),
  });
  const token = ((await exchanged.json().catch(() => ({}))) as { access_token?: string }).access_token;
  if (!token) throw new Error(`oauth: token → ${exchanged.status}`);
  return token;
}
