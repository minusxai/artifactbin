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
  // The pages render in the browser from /api/page/*, so "logged in" is when
  // the SESSION has landed — not when the URL changed, and not when the chrome
  // is up: the menu button renders before the session fetch answers, and a
  // gate that read the DOM at that moment found the header without its email.
  // The header shows the signed-in address, so that is the thing to wait for;
  // a timeout is named rather than swallowed, because the assertion that
  // follows would otherwise fail one step later with nothing to say why.
  await page.waitForFunction((e) => document.body.textContent?.includes(e), email, { timeout: 20_000 }).catch(() => {
    throw new Error(`logged in as ${email}, but the page never showed the session within 20s (url ${page.url()})`);
  });
  return email;
}
