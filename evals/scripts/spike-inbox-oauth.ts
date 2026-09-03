/**
 * SPIKE — can the eval driver log in like a person and grant like an MCP client, over plain HTTP?
 *
 *   RESEND_EVAL_API_KEY=… EVAL_LOGIN_EMAIL=… npx tsx evals/scripts/spike-inbox-oauth.ts [base]
 *
 * De-risks the credential handoff BEFORE any driver wiring exists (brief 2026-09-03): one line per
 * step with its HTTP status and measured latency, and a PROBE block that answers the question the
 * design turns on — WHICH credential can do WHAT. An OAuth access token is minted for one exact MCP
 * resource (`services/proxy/src/parts.ts tokenFitsRequest`), so whether it reaches `/api/artifacts`
 * at all is measured here rather than assumed.
 *
 * Secrets are read from the environment and NEVER printed: no key, no code, no cookie, no token —
 * only shapes, lengths and statuses. The address is masked to its domain.
 *
 * Side effects on the target deployment are intended and small: one login, one OAuth client, one or
 * two tokens, one or two unlisted placeholder documents.
 */
import { callbackCode, codeFromMail, pickLoginMail, pkcePair, type InboundMail } from '../lib/credential';

const BASE = process.argv[2] ?? 'https://artifactbin.dev';
const RESEND_API = 'https://api.resend.com';
const REDIRECT_URI = 'http://127.0.0.1:9987/cb';
const POLL_MS = 2_000;
const POLL_CAP_MS = 120_000;

const env = process.env as Record<string, string | undefined>;
const apiKey = env.RESEND_EVAL_API_KEY ?? '';
const loginEmail = env.EVAL_LOGIN_EMAIL ?? '';
if (!apiKey || !loginEmail) {
  console.error('spike: set RESEND_EVAL_API_KEY and EVAL_LOGIN_EMAIL in the environment (never on the command line)');
  process.exit(2);
}

const maskEmail = (email: string) => `<local>@${email.split('@')[1] ?? '?'}`;
let step = 0;
const t0 = () => Date.now();
const line = (label: string, status: number | string, since: number, note = '') =>
  console.log(`[${String(++step).padStart(2, '0')}] ${label} → ${status} in ${Date.now() - since} ms${note ? ` · ${note}` : ''}`);
const fail = (why: string): never => {
  console.error(`\nSPIKE FAILED: ${why}`);
  process.exit(1);
};

/** `fetch` has no cookie jar; the session rides these pairs by hand. */
const jar = new Map<string, string>();
function absorb(res: Response): void {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

// ── 1. ask for a login code ────────────────────────────────────────────────────────────────────
const sentAt = Date.now();
{
  const at = t0();
  const res = await fetch(`${BASE}/api/auth/email-otp/send-verification-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: loginEmail, type: 'sign-in' }),
  });
  line(`POST /api/auth/email-otp/send-verification-otp (${maskEmail(loginEmail)})`, res.status, at);
  if (!res.ok) fail(`send-verification-otp answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ── 2. read the code out of the eval's inbox ───────────────────────────────────────────────────
// The pure pieces are the DRIVER's own (`lib/credential`), so the spike and the shipped path cannot drift.
let otp = '';
{
  const at = t0();
  const deadline = at + POLL_CAP_MS;
  let polls = 0;
  let lastStatus: number | string = 'no answer';
  while (Date.now() < deadline && !otp) {
    polls++;
    const list = await fetch(`${RESEND_API}/emails/receiving?limit=10`, { headers: { authorization: `Bearer ${apiKey}` } });
    lastStatus = list.status;
    if (list.ok) {
      const body = await list.json() as { data?: InboundMail[] } | InboundMail[];
      const mails = Array.isArray(body) ? body : body.data ?? [];
      const mail = pickLoginMail(mails, { to: loginEmail, since: sentAt - 5_000 });
      if (mail) {
        const detail = await fetch(`${RESEND_API}/emails/receiving/${mail.id}`, { headers: { authorization: `Bearer ${apiKey}` } });
        lastStatus = detail.status;
        if (detail.ok) {
          const full = await detail.json() as { text?: string; html?: string };
          otp = codeFromMail(full.text ?? full.html ?? '') ?? '';
        }
      }
    }
    if (!otp) await new Promise((r) => setTimeout(r, POLL_MS));
  }
  line(`GET ${RESEND_API}/emails/receiving (poll ${POLL_MS} ms, cap ${POLL_CAP_MS} ms)`, lastStatus, at, `${polls} poll(s), code ${otp ? `${otp.length} digits` : 'NOT FOUND'}`);
  if (!otp) fail('no login code arrived in the eval inbox within the cap');
}

// ── 3. sign in with the code ───────────────────────────────────────────────────────────────────
{
  const at = t0();
  const res = await fetch(`${BASE}/api/auth/sign-in/email-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: loginEmail, otp }),
  });
  absorb(res);
  line('POST /api/auth/sign-in/email-otp', res.status, at, `cookies: ${[...jar.keys()].join(', ') || 'NONE'}`);
  if (!res.ok || jar.size === 0) fail(`sign-in answered ${res.status} with ${jar.size} cookie(s)`);
}

// ── 4. the OAuth grant, as an MCP client would ────────────────────────────────────────────────
const { verifier, challenge } = pkcePair();

let clientId = '';
{
  const at = t0();
  const res = await fetch(`${BASE}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'artifactbin eval driver (spike)', redirect_uris: [REDIRECT_URI] }),
  });
  const body = await res.json().catch(() => ({})) as { client_id?: string };
  clientId = body.client_id ?? '';
  line('POST /oauth/register', res.status, at, `client_id ${clientId ? `${clientId.slice(0, 4)}… (${clientId.length} chars)` : 'MISSING'}`);
  if (!clientId) fail(`register answered ${res.status}`);
}

let fields: Record<string, string> = {};
{
  const at = t0();
  const url = `${BASE}/oauth/authorize?${new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT_URI,
    code_challenge: challenge, code_challenge_method: 'S256', state: 'spike-state',
  })}`;
  const res = await fetch(url, { headers: { cookie: cookieHeader() } });
  const html = await res.text();
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) fields[m[1]] = m[2];
  const accountBound = /belong to/.test(html);
  line('GET /oauth/authorize (with the session cookie)', res.status, at, `hidden fields: ${Object.keys(fields).join(', ') || 'NONE'} · account-bound consent: ${accountBound}`);
  if (!res.ok || !accountBound || !fields.client_id) fail('the consent screen was not the account-bound one');
}

let authCode = '';
{
  const at = t0();
  const res = await fetch(`${BASE}/oauth/authorize/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(), origin: BASE },
    body: new URLSearchParams({ ...fields, grant: 'user' }),
    redirect: 'manual',
  });
  const location = res.headers.get('location') ?? '';
  authCode = callbackCode(location) ?? '';
  line('POST /oauth/authorize/approve (redirect: manual)', res.status, at, `Location ${location ? new URL(location).origin + new URL(location).pathname : 'MISSING'} · code ${authCode ? `${authCode.length} chars` : 'MISSING'}`);
  if (!authCode) fail(`approve answered ${res.status} with no code on Location`);
}

let oauthToken = '';
{
  const at = t0();
  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: authCode, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier }),
  });
  const body = await res.json().catch(() => ({})) as { access_token?: string; scope?: string };
  oauthToken = body.access_token ?? '';
  line('POST /oauth/token', res.status, at, `access_token ${oauthToken ? `mx_… (${oauthToken.length} chars), scope "${body.scope ?? ''}"` : 'MISSING'}`);
  if (!oauthToken.startsWith('mx_')) fail(`token exchange answered ${res.status}`);
}

// ── 5. PROBES — which credential reaches which surface ────────────────────────────────────────
const PLACEHOLDER = '<div data-design="tw" className="p-8"><h1 className="text-2xl font-bold">Waiting for your agent…</h1></div>';
const createDoc = (headers: Record<string, string>) => fetch(`${BASE}/api/artifacts`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify({ markup: PLACEHOLDER, title: 'eval spike placeholder', visibility: 'unlisted' }),
});

{
  const at = t0();
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${oauthToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const text = await res.text();
  line('PROBE oauth token → POST /mcp tools/list', res.status, at, `create_artifact listed: ${text.includes('create_artifact')}`);
}

{
  const at = t0();
  const res = await createDoc({ authorization: `Bearer ${oauthToken}` });
  const body = (await res.text()).slice(0, 160);
  line('PROBE oauth token → POST /api/artifacts', res.status, at, body.replace(/\s+/g, ' '));
}

let accountToken = '';
{
  const at = t0();
  const res = await fetch(`${BASE}/api/tokens/anonymous`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader(), origin: BASE },
    body: JSON.stringify({ expiresInHours: 6 }),
  });
  const body = await res.json().catch(() => ({})) as { token?: string };
  accountToken = body.token ?? '';
  line('PROBE session cookie → POST /api/tokens/anonymous', res.status, at, `token ${accountToken ? `mx_… (${accountToken.length} chars)` : 'MISSING'}`);
}

let docId = '';
if (accountToken) {
  const at = t0();
  const res = await createDoc({ authorization: `Bearer ${accountToken}` });
  const body = await res.json().catch(() => ({})) as { id?: string; visibility?: string; error?: string };
  docId = body.id ?? '';
  line('PROBE account token → POST /api/artifacts {visibility: unlisted}', res.status, at, `id ${docId || 'MISSING'} · visibility ${body.visibility ?? body.error ?? '?'}`);
}

if (docId) {
  const at = t0();
  const res = await fetch(`${BASE}/a/${docId}/raw?chrome=0`);
  const html = await res.text();
  line('PROBE anonymous GET /a/<id>/raw?chrome=0', res.status, at, `${html.length} bytes · placeholder visible: ${html.includes('Waiting for your agent')}`);
}

{
  const at = t0();
  const res = await createDoc({ cookie: cookieHeader(), origin: BASE });
  const body = (await res.text()).slice(0, 160);
  line('PROBE session cookie → POST /api/artifacts', res.status, at, body.replace(/\s+/g, ' '));
}

// Ownership: an ACCOUNT-owned markup document is born `private`, an anonymous one `public`
// (lib/artifacts.ts) — so the DEFAULT visibility says which account, if any, a token belongs to.
{
  const at = t0();
  const res = await fetch(`${BASE}/api/artifacts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${oauthToken}` },
    body: JSON.stringify({ markup: PLACEHOLDER, title: 'eval spike default-visibility probe' }),
  });
  const body = await res.json().catch(() => ({})) as { id?: string; visibility?: string };
  line('PROBE oauth token → POST /api/artifacts (no visibility)', res.status, at, `visibility ${body.visibility ?? '?'} (private ⇒ account-owned)`);
}

{
  const at = t0();
  const res = await fetch(`${BASE}/api/artifacts`, { headers: { authorization: `Bearer ${oauthToken}` } });
  const body = await res.json().catch(() => ({})) as { artifacts?: { id: string }[] } | { id: string }[];
  const rows = Array.isArray(body) ? body : body.artifacts ?? [];
  line('PROBE oauth token → GET /api/artifacts (the account list)', res.status, at, `${rows.length} row(s) · includes the account-token doc ${docId}: ${rows.some((a) => a.id === docId)}`);
}

console.log('\nspike complete — read the PROBE lines: they decide where each leg gets its credential.');
