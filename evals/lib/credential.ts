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
 *   2. the six-digit code out of the leg's MAILBOX, newest mail to the eval address sent after the
 *      request. Which mailbox is the only thing that varies: a deployment's mail goes to the eval's
 *      Resend inbound address (`GET /emails/receiving`), while a server this driver BOOTED writes its
 *      mail to a file instead of sending it (`lib/server devOutboxPath`, `services/proxy/src/mail.ts`) —
 *      so a local run needs no inbox and no key at all. One reader is swapped, nothing else;
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
import type { Harness } from './contracts';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CredentialEnv } from './env';
import { type EvalMode, actionTransport, installsSkills } from './mode';
import { slug } from './slug';

/** Where a leg's token comes from. */
export const CREDENTIAL_SOURCES = ['paste', 'inbox-oauth', 'outbox-oauth', 'secret'] as const;
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
  /**
   * The session the driver logged in WITH, kept beside the token it granted. The bearer is enough for
   * everything an agent does; it is not enough to SHARE — the sharing door is browser-only on purpose
   * (`services/app/app/api/my/artifacts/[id]/sharing/route.ts`), because handing out a link is a human
   * act. So the human half of the login travels too, and `shareForScoring` uses it. Absent for `secret`
   * (a pre-provisioned token names no session) and for `paste` (there is no credential at all).
   */
  cookie?: string;
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

/** What the run can offer a mode besides the environment: the outbox of a server the driver booted. */
export interface CredentialOptions {
  /** `lib/server devOutboxPath` for THIS run — set only when the driver booted the product itself. */
  localOutbox?: string;
}

/**
 * WHICH source a mode uses. The paste is the copy-text treatment's whole point, so it is never
 * replaced; the other three want an account, and say so loudly when no way to get one is configured
 * (a silent fall back to an anonymous token would quietly change what the column measures).
 *
 * A LOCAL server comes first, before the shared inbox and before a pre-provisioned token: it is the
 * only account that is genuinely this run's own — a fresh database, an address nobody else uses, and no
 * five-an-hour login door shared with every other run. Without it CI's `agent smoke` (which boots a
 * local server and has neither a Resend inbox nor an account token) died on the throw below.
 */
export function credentialSourceFor(mode: EvalMode, env: CredentialEnv, opts: CredentialOptions = {}): CredentialSource {
  if (!installsSkills(mode) && actionTransport(mode) === 'api') return 'paste';
  if (opts.localOutbox) return 'outbox-oauth';
  if (env.RESEND_EVAL_API_KEY && env.EVAL_LOGIN_EMAIL) return 'inbox-oauth';
  if (env.EVAL_ACCOUNT_TOKEN) return 'secret';
  throw new Error(`${mode} needs an ACCOUNT: boot a local server (the driver logs in through its dev outbox), or set RESEND_EVAL_API_KEY and EVAL_LOGIN_EMAIL (the driver logs in and grants like an MCP client), or EVAL_ACCOUNT_TOKEN (a pre-provisioned account token)`);
}

/**
 * WHO the driver is on a server it booted itself. The database is empty and the mail goes to a file, so
 * the address is a throwaway — named after the leg (the house `mxmx_*` convention) so two legs sharing an
 * outbox never read each other's code. A configured `EVAL_LOGIN_EMAIL` still wins: the caller named it.
 */
export function localLoginEmail(legLabel: string, env: CredentialEnv): string {
  return env.EVAL_LOGIN_EMAIL ?? `mxmx_eval_${slug(legLabel, 40) || 'leg'}@example.com`;
}

/**
 * The address a DEPLOYMENT is signed into for this harness: the configured inbox address with `+<harness>`
 * added to its local part — `mxmx_eval@d.test` × `pi` → `mxmx_eval+pi@d.test`. The proxy's login door is
 * keyed by address (five sends an hour — deploys run 33782951666 hit it with four harnesses on one address),
 * and the inbox is a catch-all, so a sub-address is the same mailbox with its own door and its own account.
 * A configured address that already carries a `+tag` is used verbatim: the caller named it exactly.
 */
export function deploymentLoginEmail(configured: string, harness: Harness): string {
  // The LAST `@` splits the address: everything before it is the local part, and only a `+` in THERE is a
  // sub-address tag. A string with no `@` is not an address this function is entitled to rewrite.
  const at = configured.lastIndexOf('@');
  if (at < 0 || configured.slice(0, at).includes('+')) return configured;
  return `${configured.slice(0, at)}+${harness}${configured.slice(at)}`;
}

/**
 * ONE LOGIN PER SERVER — which is not the same as one per run. Every task and every retry of a leg reuses
 * the credential of the product they run against, so the acquisition is memoized… but only while the
 * product outlives them. A DEPLOYMENT does (`reusable: true`); a server the driver boots does NOT — the
 * `--ci` second attempt boots a new one, with an in-memory database, a fresh `AUTH__SECRET` and a
 * truncated outbox, so its predecessor's token names an account that no longer exists. There the login is
 * made again, once per boot.
 */
export function memoizeCredential<A extends unknown[]>(
  acquire: (...args: A) => Promise<Credential | null>,
  opts: { reusable: boolean },
): (...args: A) => Promise<Credential | null> {
  if (!opts.reusable) return acquire;
  let pending: Promise<Credential | null> | null = null;
  return (...args: A) => (pending ??= acquire(...args));
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

/**
 * A line of the dev outbox, as `services/proxy/src/mail.ts devOutboxMailer` writes it: one JSON object
 * per line, the whole outgoing mail plus `createdAt` (`at` is accepted too, for a hand-written fixture).
 */
export interface OutboxMail {
  to?: string;
  text?: string;
  otp?: string;
  createdAt?: string;
  at?: string;
}

/**
 * The same choice as `pickLoginMail`, against the file a local server writes instead of sending: the
 * NEWEST mail to the eval address that landed after the code was asked for. Both halves matter for the
 * same reasons — parallel legs share one outbox, and the previous run's code is still in the file.
 * The mailer records the code in `otp`; the six digits in the body are the fallback (`mail-login.mjs`).
 */
export function codeFromOutbox(lines: OutboxMail[], opts: { to: string; since: number }): string | null {
  const wanted = opts.to.toLowerCase();
  const mine = lines
    .map((mail) => ({ mail, at: Date.parse(mail.createdAt ?? mail.at ?? '') }))
    .filter(({ mail, at }) => (mail.to ?? '').toLowerCase() === wanted && at >= opts.since)
    .sort((a, b) => a.at - b.at);
  const latest = mine[mine.length - 1]?.mail;
  if (!latest) return null;
  return latest.otp ?? codeFromMail(latest.text ?? '');
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
  /** `outbox-oauth`: the dev outbox of the server the driver booted (`lib/server devOutboxPath`). */
  localOutbox?: string;
  /** The address to log in as. Defaults to `EVAL_LOGIN_EMAIL`; a local server gets `localLoginEmail`. */
  email?: string;
  /**
   * The origin the product TRUSTS, when that is not the address the driver dials. Better Auth trusts
   * exactly the public base URL (`services/proxy/src/standalone.ts` → `baseURL`), and a server this
   * driver boots publishes the leg's PROXY as that URL while the driver talks to the server port
   * behind it — measured: every login write answered `403 INVALID_ORIGIN` until this was stated.
   */
  origin?: string;
  /** Injected so the whole dance is exercised without a network. */
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The leg's credential. `paste` answers null — there is nothing to acquire, the product hands its token
 * to the agent itself and the driver only reads it back out of the paste when a task needs it.
 *
 * There is deliberately no `none` here any more. Withholding the credential is a property of the TASK
 * (`handoff: none`, `lib/tasks planAccess`), not a flag on the leg: while it was both, a run's rubric
 * and its credential were settable independently, and the token-less leg was graded on whether it
 * published by a run that had given it no way to publish.
 */
export async function acquireCredential(source: CredentialSource, opts: AcquireOptions): Promise<Credential | null> {
  if (source === 'paste') return null;
  if (source === 'secret') {
    const token = opts.env.EVAL_ACCOUNT_TOKEN;
    if (!token) throw new Error('EVAL_ACCOUNT_TOKEN is not set');
    return { token, owner: 'account' };
  }
  const call = opts.fetch ?? globalThis.fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // The dance is ONE code path from here on; only WHERE the login code is read differs.
  const email = opts.email ?? opts.env.EVAL_LOGIN_EMAIL;
  let read: CodeReader;
  if (source === 'outbox-oauth') {
    if (!opts.localOutbox || !email) throw new Error('outbox-oauth needs the local server’s dev outbox path and an address to log in as');
    read = outboxCodeReader({ path: opts.localOutbox, email });
  } else {
    const key = opts.env.RESEND_EVAL_API_KEY;
    if (!email || !key) throw new Error('inbox-oauth needs RESEND_EVAL_API_KEY and EVAL_LOGIN_EMAIL');
    read = resendCodeReader({ key, email, fetch: call });
  }
  const origin = opts.origin ?? opts.base;
  const cookie = await logIn({ base: opts.base, origin, email, read, fetch: call, sleep });
  const token = await grantAsMcpClient({ base: opts.base, origin, cookie, fetch: call });
  return { token, owner: 'account', email, cookie };
}

/** What `shareForScoring` needs: the product, the session, and the documents to hand out links to. */
export interface ShareForScoringOptions {
  /** The address to knock on — the task's proxy, so the calls are the driver's and land where they belong. */
  base: string;
  /** The owner's session (`Credential.cookie`). The door takes no bearer. */
  cookie: string;
  /** The artifacts the run produced. Duplicates are one call; order is kept. */
  ids: readonly string[];
  fetch?: typeof globalThis.fetch;
  /** Extra headers on every call — `DRIVER_HEADER`, so a task's ledger stays the AGENT's traffic. */
  headers?: Record<string, string>;
}

/**
 * SHARE THE RUN THE WAY A PERSON WOULD, so it can be scored. An account's documents are born PRIVATE
 * while every product-truth read in the scorer is anonymous, so a run that published perfectly under an
 * account token scored `published: false` (PR #16 CI, the `data` task: `doc gKFcj2`, 200 to the agent,
 * nothing to the world). The fix is not a privileged read — the scorer must keep seeing exactly what a
 * reader sees — it is to do what the person behind the agent does next: open the sharing dialog and make
 * the document unlisted. That is this, over HTTP: `PUT /api/my/artifacts/<id>/sharing {visibility:'unlisted'}`
 * with the owner's session.
 *
 * A 404 is the agent's own scratch document, created and then deleted — skipped, not an error. Anything
 * else names the id, because a document the scorer cannot read is a hole in the column either way and a
 * silent one would look like a bad run instead of a broken driver.
 */
export async function shareForScoring(opts: ShareForScoringOptions): Promise<string[]> {
  const call = opts.fetch ?? globalThis.fetch;
  const shared: string[] = [];
  for (const id of new Set(opts.ids)) {
    const res = await call(`${opts.base}/api/my/artifacts/${id}/sharing`, {
      method: 'PUT',
      // No `origin`: the door refuses a CROSS-SITE cookie mutation, and a request that states no origin
      // is not one (`services/app/lib/http.ts isCrossSiteRequest`). Stating the proxy's would be a claim
      // about a host this call does not need to make.
      headers: { 'content-type': 'application/json', cookie: opts.cookie, ...opts.headers },
      body: JSON.stringify({ visibility: 'unlisted' }),
    });
    if (res.status === 404) continue; // the agent deleted it — there is nothing left to share
    if (!res.ok) throw new Error(`sharing ${id} for scoring → ${res.status} ${await res.text()}`);
    shared.push(id);
  }
  return shared;
}

/** `fetch` has no cookie jar; the session is one header, carried by hand. */
function cookieFrom(res: Response): string {
  const pairs = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0].trim()).filter(Boolean);
  return pairs.join('; ');
}

async function logIn(o: { base: string; origin: string; email: string; read: CodeReader; fetch: typeof globalThis.fetch; sleep: (ms: number) => Promise<void> }): Promise<string> {
  // The login door is per ADDRESS (five an hour): the SEND happens exactly once, only the INBOX is polled.
  const since = Date.now() - 5_000;
  const sent = await o.fetch(`${o.base}/api/auth/email-otp/send-verification-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: o.origin },
    body: JSON.stringify({ email: o.email, type: 'sign-in' }),
  });
  if (!sent.ok) throw new Error(`login: send-verification-otp → ${sent.status}`);

  const otp = await awaitLoginCode({ read: o.read, since, sleep: o.sleep });
  const verified = await o.fetch(`${o.base}/api/auth/sign-in/email-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: o.origin },
    body: JSON.stringify({ email: o.email, otp }),
  });
  if (!verified.ok) throw new Error(`login: sign-in/email-otp → ${verified.status}`);
  const cookie = cookieFrom(verified);
  if (!cookie) throw new Error('login: the product set no session cookie');
  return cookie;
}

/**
 * ONE look for the login code; `null` is "not here yet". The mailbox is the only thing that differs
 * between a deployment (a Resend inbox) and a server this driver booted (a file), so it is the only
 * thing injected — the polling loop, the login and the whole OAuth grant stay one code path.
 */
export type CodeReader = (since: number) => Promise<string | null>;

/** The eval's own inbound mailbox, read with the EVAL's key — never the product's. */
function resendCodeReader(o: { key: string; email: string; fetch: typeof globalThis.fetch }): CodeReader {
  const headers = { authorization: `Bearer ${o.key}` };
  return async (since) => {
    const list = await o.fetch(`${RESEND_API}/emails/receiving?limit=10`, { headers });
    if (!list.ok) return null;
    const body = await list.json() as { data?: InboundMail[] } | InboundMail[];
    const mail = pickLoginMail(Array.isArray(body) ? body : body.data ?? [], { to: o.email, since });
    if (!mail) return null;
    const detail = await o.fetch(`${RESEND_API}/emails/receiving/${mail.id}`, { headers });
    if (!detail.ok) return null;
    const full = await detail.json() as { text?: string; html?: string };
    return codeFromMail(full.text ?? full.html ?? '');
  };
}

/** The dev outbox of a locally booted server: the same mail, in a file it appends to. */
function outboxCodeReader(o: { path: string; email: string }): CodeReader {
  return async (since) => {
    let raw: string;
    try {
      raw = fs.readFileSync(o.path, 'utf8');
    } catch (error) {
      // The server writes the file when it sends its first mail — until then there is nothing to read.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const lines: OutboxMail[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      // A line being appended as this reads is half-written, not a failure: it will be whole next poll.
      try { lines.push(JSON.parse(line) as OutboxMail); } catch { continue; }
    }
    return codeFromOutbox(lines, { to: o.email, since });
  };
}

async function awaitLoginCode(o: { read: CodeReader; since: number; sleep: (ms: number) => Promise<void> }): Promise<string> {
  const deadline = Date.now() + OTP_CAP_MS;
  for (;;) {
    const code = await o.read(o.since);
    if (code) return code;
    if (Date.now() >= deadline) throw new Error(`login: no code reached the eval mailbox within ${OTP_CAP_MS} ms`);
    await o.sleep(OTP_POLL_MS);
  }
}

/** The consent form's hidden fields — `resource` and `scope` are validated exactly, so they are READ, never guessed. */
function hiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) fields[m[1]] = m[2];
  return fields;
}

async function grantAsMcpClient(o: { base: string; origin: string; cookie: string; fetch: typeof globalThis.fetch }): Promise<string> {
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
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: o.cookie, origin: o.origin },
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
