/**
 * Logging in, for gates.
 *
 * Auth is email + a one-time code, so every gate that needs a session needs a
 * mailbox. Local and gate servers write their real outgoing messages to a
 * protected JSONL outbox. A code is read by the ADDRESS it was sent to, never
 * by arrival order, so parallel gates cannot steal each other's mail.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const outboxPath = () => process.env.EMAIL__DEV_OUTBOX_PATH ?? path.join(ROOT, '.artifactbin', 'dev-mail.jsonl');
const inbox = () => {
  try { return fs.readFileSync(outboxPath(), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
};

export async function startMailSink() {
  return {
    get inbox() { return inbox(); },
    /**
     * The 6 digits from the most recent email, as a user would read them —
     * addressed to `address` when one is given.
     *
     * Parallel gates share one outbox, so another gate's code may land last.
     * The unique address (mxmx_test_<gate>_<ts>) is the ownership boundary.
     */
    lastCode: (address) => {
      const messages = inbox();
      const mine = address ? messages.filter((m) => m.to === address) : messages;
      const latest = mine.at(-1);
      return latest?.otp ?? /\b(\d{6})\b/.exec(latest?.text ?? '')?.[1] ?? null;
    },
    close: () => {},
  };
}

/**
 * Drive the real two-step form: address → emailed code → session. Returns the
 * address, so a caller can assert the page shows who is signed in.
 *
 * Signing up and signing in are the SAME flow, so callers that used to hit
 * /signup and /login separately both come here.
 */
export async function loginViaEmail(page, base, sink, email) {
  await page.goto(`${base}/login`, { waitUntil: 'load' });
  // The pages render in the browser now: wait for the form rather than assuming
  // it is in the HTML the server sent.
  await page.waitForSelector('[aria-label="Email"]', { timeout: 20_000 });
  await page.fill('[aria-label="Email"]', email);
  await page.click('[aria-label="Log in with email"]');
  await page.waitForSelector('[aria-label="Login code"]', { timeout: 15_000 });

  const code = sink.lastCode(email);
  if (!code) {
    throw new Error(
      `No login code reached the development outbox ${outboxPath()}. ` +
      `Request a new code, then run: npm run dev:otp -- ${email}`,
    );
  }
  await page.fill('[aria-label="Login code"]', code);
  await page.click('[aria-label="Verify code"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
  // Verify the cookie-backed identity through the same endpoint the app uses.
  // The dashboard no longer prints an email or a profile link in its chrome.
  await page.waitForFunction(async (expectedEmail) => {
    try {
      const response = await fetch('/api/page/session', { credentials: 'same-origin' });
      if (!response.ok) return false;
      const session = await response.json();
      return session.kind === 'account' && session.user?.email === expectedEmail;
    } catch { return false; }
  }, email, { timeout: 20_000 }).catch(() => {
    throw new Error(`login did not establish the session for ${email} within 20s (url ${page.url()})`);
  });
  return email;
}

/** Read the browser's authenticated identity without depending on page chrome. */
export async function isSignedInAs(page, email) {
  const response = await page.request.get(new URL('/api/page/session', page.url()).href);
  if (!response.ok()) return false;
  const session = await response.json();
  return session.kind === 'account' && session.user?.email === email;
}
