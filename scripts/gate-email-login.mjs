/**
 * Gate: log in with an emailed code, in a real browser, end to end.
 *
 * The unit tests cover the code store and the form's state machine separately.
 * What neither can see is the seam between them — the request-code route, the
 * NextAuth credentials round trip, the session cookie actually landing, and the
 * OAuth consent screen recognising that session. That seam is the feature.
 *
 * The code is read from the development mail outbox written by the real send
 * path. That is deliberately how the gate gets the code —
 * no endpoint anywhere in the app reveals a live one, not even to an admin.
 *
 *   usage:
 * Local dev writes login mail to `.artifactbin/dev-mail.jsonl`; use `npm run dev:otp -- <email>`.

 *     node scripts/gate-email-login.mjs [base]
 */
import { chromium } from 'playwright';
import { startMailSink } from './lib/mail-login.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };

const EMAIL = `mxmx_test_login_${Date.now().toString(36)}@example.com`;

const sink = await startMailSink();

/**
 * This run's own mail. Parallel gates share the outbox, so the inbox is not
 * ours alone; the unique address is the ownership boundary.
 */
const mine = () => sink.inbox.filter((m) => m.to === EMAIL);

/** The 6 digits as the user would read them out of the email. */
const codeFromInbox = () => {
  const last = mine().at(-1);
  if (!last) throw new Error('no email was sent — is the dev server pointed at the sink?');
  return last.otp ?? /\b(\d{6})\b/.exec(last.text)?.[1] ?? null;
};

const browser = await chromium.launch();
const page = await browser.newPage();

// ── Step one: ask for a code ────────────────────────────────────────────────
await page.goto(`${BASE}/login`, { waitUntil: 'load' });
check(await page.locator('[aria-label="Email"]').isVisible(), 'the login page asks for an email');
check((await page.locator('[aria-label="Password"]').count()) === 0, 'there is no password field anywhere');

await page.fill('[aria-label="Email"]', EMAIL);
const codeResponse = page.waitForResponse((r) => r.url().includes('/api/auth/email-otp/send-verification-otp'));
await page.click('[aria-label="Log in with email"]');
const res = await codeResponse;
const bodyText = await res.text();
check(res.status() === 200, `the OTP door answered 200 (${res.status()})`);
check(!/\d{6}/.test(bodyText), `the response body carries NO code (${bodyText})`);

await page.waitForSelector('[aria-label="Login code"]', { timeout: 10_000 });
check((await page.locator('[aria-label="Login code"]').count()) === 1, 'the form advanced to the code screen');

// ── The typo escape hatch ───────────────────────────────────────────────────
await page.click('[aria-label="Change email"]');
await page.waitForSelector('[aria-label="Email"]');
check(await page.inputValue('[aria-label="Email"]') === EMAIL, 'change email returns to a prefilled, editable field');
await page.click('[aria-label="Log in with email"]');
await page.waitForSelector('[aria-label="Login code"]', { timeout: 10_000 });

// ── The code arrives by EMAIL and only by email ─────────────────────────────
if (mine().length === 0) {
  console.log('\nNo email reached the development outbox. Request a code, then run');
  console.log(`  npm run dev:otp -- ${EMAIL}`);
  await browser.close();
  sink.close();
  process.exit(1);
}
const code = codeFromInbox();
check(/^\d{6}$/.test(code ?? ''), 'a 6-digit code arrived by email');
check(mine().at(-1).to.includes(EMAIL), 'addressed to the account being logged in');
check(mine().length === 2, `one email per request, including the re-send after change-email (${mine().length})`);

// ── Step two: a wrong code must not log anyone in ───────────────────────────
await page.fill('[aria-label="Login code"]', code === '000000' ? '111111' : '000000');
await page.click('[aria-label="Verify code"]');
await page.waitForTimeout(1500);
check(page.url().includes('/login'), 'a wrong code keeps you on the login page');

// ── Step two: the right code ────────────────────────────────────────────────
await page.fill('[aria-label="Login code"]', code);
await page.click('[aria-label="Verify code"]');
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 }).catch(() => {});
check(!new URL(page.url()).pathname.startsWith('/login'), `logged in and left /login (at ${page.url()})`);

const cookies = await page.context().cookies();
check(cookies.some((c) => /better-auth.*session_token|authjs.session-token/.test(c.name)), 'a session cookie was set');

// ── OAuth consent now recognises the session ────────────────────────────────
const consentQuery = new URLSearchParams({
  client_id: 'artifactbin-mcp',
  response_type: 'code',
  redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256',
  state: 'gate',
});
await page.goto(`${BASE}/oauth/authorize?${consentQuery}`, { waitUntil: 'load' });
const consent = await page.content();
check(!consent.includes('Continue without an account'), 'the consent screen offers no guest grant');
check(consent.includes(EMAIL), 'the consent screen names the logged-in account');
check((await page.locator('[aria-label="Approve connection"]').count()) === 1, 'and offers Approve');

await browser.close();
sink.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall good');
process.exit(failures.length ? 1 : 0);
