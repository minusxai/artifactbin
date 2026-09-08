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
  const form=await page.locator('iframe[title="Artifactbin app"]').count()?page.frameLocator('iframe[title="Artifactbin app"]'):page;
  // The pages render in the browser now: wait for the form rather than assuming
  // it is in the HTML the server sent.
  await form.getByLabel('Email',{exact:true}).waitFor({timeout:20_000});
  await form.getByLabel('Email',{exact:true}).fill(email);
  await form.getByLabel('Log in with email',{exact:true}).click();
  await form.getByLabel('Login code',{exact:true}).waitFor({timeout:15_000});

  const code = sink.lastCode(email);
  if (!code) {
    throw new Error(
      `No login code reached the development outbox ${outboxPath()}. ` +
      `Request a new code, then run: npm run dev:otp -- ${email}`,
    );
  }
  await form.getByLabel('Login code',{exact:true}).fill(code);
  await form.getByLabel('Verify code',{exact:true}).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
  // Verify the cookie-backed identity through the same endpoint the app uses.
  // The dashboard no longer prints an email or a profile link in its chrome.
  // Await the actual response. A polling predicate that returns a Promise
  // can finish on its truthiness even when that Promise resolves to false.
  const current=await page.locator('iframe[title="Home workspace"],iframe[title="Artifactbin app"]').count()
    ?page.frameLocator('iframe[title="Home workspace"],iframe[title="Artifactbin app"]').first():page;
  const session = await current.locator('body').evaluate(async () => {
    const response = await fetch('/api/page/session', { credentials: 'same-origin', headers: {'x-artifactbin-csrf':'1'} });
    return response.ok ? response.json() : null;
  });
  if (session?.kind !== 'account' || session.user?.email !== email) throw new Error(`login did not establish the session for ${email} (url ${page.url()})`);
  return email;
}

/** Read the browser's authenticated identity without depending on page chrome. */
export async function isSignedInAs(page, email) {
  const response = await page.request.get(new URL('/api/page/session', page.url()).href, {headers:{'x-artifactbin-csrf':'1',origin:new URL(page.url()).origin}});
  if (!response.ok()) return false;
  const session = await response.json();
  return session.kind === 'account' && session.user?.email === email;
}
