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
  // Record only public navigation/resource paths and session shape, never a cookie or response body.
  // Keep these listeners through OTP and welcome: a failed home chunk or initial session read
  // happens after the Email form, and a later healthy identity probe cannot explain that failure.
  const failures = [];
  let navigationStatus = null;
  let session = 'not observed';
  const pathname = url => { try { return new URL(url).pathname; } catch { return 'unknown'; } };
  const remember = value => { if (failures.length < 8) failures.push(value); };
  const onFailure = request => remember(`${request.resourceType()} ${pathname(request.url())}: ${request.failure()?.errorText ?? 'failed'}`);
  const onPageError = error => remember(`page error: ${error.name}`);
  const onResponse = response => {
    const request = response.request();
    const route = pathname(response.url());
    if (response.status() >= 400 && ['script', 'stylesheet', 'document'].includes(request.resourceType()))
      remember(`${request.resourceType()} ${route}: HTTP ${response.status()}`);
    if (route === '/api/page/session') {
      if (response.status() >= 400) remember(`session ${route}: HTTP ${response.status()}`);
      session = `HTTP ${response.status()}`;
      void response.json().then(body => { session = `HTTP ${response.status()}, kind=${body.kind}, user=${!!body.user}, onboarded=${typeof body.onboarded === 'boolean' ? body.onboarded : 'unknown'}`; }).catch(() => {});
    }
  };
  page.on('requestfailed', onFailure);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  try {
    try {
      navigationStatus = (await page.goto(`${base}/login`, { waitUntil: 'load' }))?.status() ?? null;
      // Wait for the real hydrated form; keep the established gate budget.
      await page.waitForSelector('[aria-label="Email"]', { timeout: 45_000 });
    } catch (cause) {
      throw new Error(`Login email form unavailable: navigation HTTP ${navigationStatus}, path=${pathname(page.url())}, session=${session}; ${failures.join('; ') || 'no resource or page error observed'}`, { cause });
    }
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
      throw new Error(`login did not establish the session for ${email} within 20s (path ${pathname(page.url())})`);
    });
    await passTheWelcomePage(page, email).catch(cause => {
      throw new Error(`${cause.message}; login navigation HTTP ${navigationStatus}, session=${session}; ${failures.join('; ') || 'no resource or page error observed'}`, { cause });
    });
    return email;
  } finally {
    page.off('requestfailed', onFailure);
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
  }
}

/**
 * A BRAND-NEW ACCOUNT MEETS THE WELCOME PAGE ONCE, so every gate does.
 *
 * Signing up and signing in are one flow and each gate uses a fresh
 * `mxmx_test_<gate>_<ts>` address, which means every gate is a new account:
 * the app shell (web/OnboardingGate) parks it on `/welcome`, carrying where it
 * was headed. A gate that did not expect that would begin its first check on
 * the wrong page.
 *
 * So do exactly what a person does — accept the handle the app assigned and
 * press Confirm — and nothing else. No picture, no rename, so whatever follows
 * sees the account the gate asked for and not one this helper decorated.
 *
 * `onboarded` is read FIRST rather than sampling the URL, because the redirect
 * is driven by the SPA's own session read and can land after the cookie is
 * live — a one-shot `page.url()` here would be a race. The bit is decisive: if
 * it is false the shell WILL divert, so waiting for that is correct rather than
 * hopeful. An account already through the welcome page returns at once and its
 * login is otherwise untouched.
 *
 * The bit is read only once the session names THIS account, because a caller
 * may arrive here straight after submitting the code (the fork leg of gate-accounts-and-workspace drives the form
 * where it already is), and a bit read before the cookie is live would read as
 * "nothing to do".
 */
export async function passTheWelcomePage(page, email) {
  const onWelcome = (u) => u.pathname.replace(/\/+$/, '') === '/welcome';
  const state = await page.waitForFunction(async (expectedEmail) => {
    try {
      const response = await fetch('/api/page/session', { credentials: 'same-origin' });
      if (!response.ok) return null;
      const session = await response.json();
      if (session.kind !== 'account' || session.user?.email !== expectedEmail) return null;
      return session.onboarded === false ? 'welcome' : 'through';
    } catch { return null; }
  }, email, { timeout: 20_000 }).then((handle) => handle.jsonValue()).catch(() => 'through');
  if (state !== 'welcome') return;

  await page.waitForURL(onWelcome, { timeout: 20_000 }).catch(async () => {
    // Structural first-party evidence only: never dump workspace text, session credentials or cookie values.
    const shell = await page.evaluate(async expectedEmail => {
      const root = document.getElementById('root');
      let session;
      try { const response = await fetch('/api/page/session', { credentials: 'same-origin', signal: AbortSignal.timeout(2000) }); const state = await response.json();
        session = { status: response.status, kind: state.kind, expectedAccount: state.user?.email === expectedEmail, onboarded: state.onboarded };
      } catch { session = { unavailable: true }; }
      return { readyState: document.readyState, rootChildren: root?.childElementCount ?? null,
        trustedHosts: document.querySelectorAll('[data-trusted-ui]').length, loadingPage: !!document.querySelector('main[aria-label="Loading page"]'),
        scripts: [...document.scripts].filter(script => script.src).map(script => new URL(script.src).pathname), session };
    }, email).catch(error => ({ unavailable: error.name }));
    throw new Error(
      `${email} has not been through the welcome page (session onboarded=false) but the app never went there within 20s (path ${new URL(page.url()).pathname}); shell ${JSON.stringify(shell)}`,
    );
  });
  // By its accessible name, like every other control these gates drive. It is
  // disabled until the page has its handle, which the click waits out.
  await page.getByRole('button', { name: 'Confirm', exact: true }).click({ timeout: 20_000 });
  await page.waitForURL((u) => !onWelcome(u), { timeout: 20_000 }).catch(() => {
    throw new Error(
      `the welcome page did not hand ${email} back within 20s: Confirm was pressed and the app stayed on ${new URL(page.url()).pathname}`,
    );
  });
}

/** Read the browser's authenticated identity without depending on page chrome. */
export async function isSignedInAs(page, email) {
  const response = await page.request.get(new URL('/api/page/session', page.url()).href);
  if (!response.ok()) return false;
  const session = await response.json();
  return session.kind === 'account' && session.user?.email === email;
}
