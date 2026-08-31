/**
 * Logging in, for gates.
 *
 * Auth is email + a one-time code, so every gate that needs a session needs a
 * mailbox. This serves a Resend-compatible sink and points the app's REAL send
 * path at it, which is deliberate: it means no endpoint in the app has to
 * expose a live login code, not even to an admin.
 *
 * The dev server must be started pointed at the sink:
 *
 *   EMAIL__RESEND_API_KEY=x EMAIL__RESEND_BASE_URL=http://127.0.0.1:<port> npm run dev
 *
 * Ports differ per gate so two can run at once without stealing each other's
 * mail — and because the relay in front of them fans every message out to all
 * of them, a code is read by the ADDRESS it was sent to, never by arrival
 * order (scripts/gates.mjs runs the set against parallel servers).
 */
import { createServer } from 'http';

export async function startMailSink(port) {
  const inbox = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try { inbox.push(JSON.parse(body)); } catch { /* not an email payload */ }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    inbox,
    /**
     * The 6 digits from the most recent email, as a user would read them —
     * addressed to `address` when one is given.
     *
     * The relay copies EVERY message to EVERY gate's sink, so this inbox has
     * never been ours alone; while the set ran one gate at a time nothing else
     * was sending, and `at(-1)` was our own mail by luck. Running the gates
     * against parallel servers spends that luck: another gate's code can land
     * last, and this would hand it over. The address is the thing that was
     * always ours (mxmx_test_<gate>_<ts>), so it is what we read by.
     */
    lastCode: (address) => {
      const mine = address ? inbox.filter((m) => m.to?.includes?.(address)) : inbox;
      return /\b(\d{6})\b/.exec(mine.at(-1)?.text ?? '')?.[1] ?? null;
    },
    close: () => server.close(),
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
      'No login code reached the sink. Start the dev server with ' +
      'EMAIL__RESEND_API_KEY=x EMAIL__RESEND_BASE_URL=http://127.0.0.1:<port> npm run dev',
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
