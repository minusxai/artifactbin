/** Native HTML gate fixtures use the original start route, verified account
 * credentials and browser sessions. Account bearers never enter page HTML. */
import { connectAgent, connectionBrowserCookie } from '../gates/lib/account-connection.mjs';
import { loginViaEmail } from './mail-login.mjs';

/**
 * What Chromium sends on the create button's fetch (MEASURED on production):
 * `/api/start` is `browser_only` in every policy file, because it is the WEB
 * PAGE's button — an agent creates with `POST /api/artifacts`. A gate stands
 * in for the page, so it sends what the page sends, written here once.
 */
const pageHeaders = (base) => ({ origin: new URL(base).origin, 'sec-fetch-site': 'same-origin' });

/**
 * Create an artifact the way the page does, AS a fresh CLI connection, so the
 * caller can also write it. Returns `{ id, token, editId, prompt }`.
 */
export async function startDocument(base, options) {
  const { token } = await connectAgent(base, options);
  const res = await fetch(`${base}/api/start`, {
    method: 'POST',
    headers: { ...pageHeaders(base), Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.id) {
    throw new Error(`cannot start a document (${res.status} ${JSON.stringify(body)}).`);
  }
  if (typeof body.prompt !== 'string'
    || !body.prompt.includes("\n\nIf the user hasn't specified a task, ask what artifact they'd like to build.")
    || body.prompt.includes('\r')
    || body.prompt.includes('mx_')) {
    throw new Error('the start paste must contain tokenless instructions and a question for the user');
  }
  if ('token' in body) throw new Error('the start response handed out a credential');
  const shared = await fetch(`${base}/api/my/artifacts/${body.id}/sharing`, {
    method: 'PUT', headers: { ...pageHeaders(base), cookie: connectionBrowserCookie(base, token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ visibility: 'public' }),
  });
  if (!shared.ok) throw new Error(`cannot make gate fixture public (${shared.status})`);
  const head = await readDocumentHead(base, body.id, token);
  return { id: body.id, token, editId: body.edit_id, prompt: body.prompt, version: head.version, state: head.state, expectedVersion: head.version, expectedState: head.state };
}

/**
 * Make this browser the document's owner, so `/a/<id>` grants it owner chrome
 * (top bar and owner controls) around the inline story runtime. Retains the
 * browser cookie issued by the approval that created this CLI connection.
 * Its credential is distinct from the API-scoped CLI token.
 */
export async function becomeOwner(page, base, token) {
  const cookie = connectionBrowserCookie(base, token);
  await page.context().addCookies(cookie.split('; ').map(pair => {
    const separator = pair.indexOf('=');
    return { name: pair.slice(0, separator), value: pair.slice(separator + 1), url: base, httpOnly: true, secure: new URL(base).protocol === 'https:', sameSite: 'Lax' };
  }));
  // Establish this origin for fixtures that immediately make browser fetches.
  // Do not wait for shelf thumbnail exports during setup.
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
}

/** Adopt a guest connection into an already verified browser account. The
 * held cookie proves guest ownership; the account session performs the merge. */
export async function mergeGuestIntoAccount(page, base, token) {
  await becomeOwner(page, base, token);
  return verifiedAccountSession(page.request, base);
}

/** Verify the account after the browser established its guest connection. */
export async function verifiedAccountSession(request, base) {
  // Like the owner SSR read, allow one ECONNRESET on Playwright's shared socket.
  // Verified guest adoption is idempotent; HTTP errors and a second reset still fail.
  const response = await request.get(`${base}/api/page/session`, { maxRetries: 1 });
  if (!response.ok() || (await response.json()).kind !== 'account') {
    throw new Error(`guest merge requires a verified account (${response.status()})`);
  }
  return response.status();
}

/**
 * An ACCOUNT that owns what this browser publishes — logged in through the
 * real email-code door, and nothing else.
 *
 * Thirteen gates used to write the same three steps by hand: log in, approve a
 * CLI connection for a bearer, then POST that bearer to `/api/tokens/claim` so
 * the account adopted it. The claim door is the ACCOUNT PANEL's, not a gate's
 * setup step — a browser that is signed in already owns everything it creates
 * through `/api/my/*` (the same routes the product's own UI uses). So the
 * helper logs in and hands back a `publish` bound to that session; setup mints
 * nothing.
 *
 * @param {import('playwright').Page} page
 * @param {string} base
 * @param {{ sink: { lastCode: (address?: string) => string | null }, email: string }} mail
 * @returns {Promise<{ email: string, publish: (body: object) => Promise<any> }>}
 */
export async function becomeAccountOwner(page, base, { sink, email }) {
  await loginViaEmail(page, base, sink, email);
  return { email, publish: (body) => publishAs(page, body) };
}

/**
 * Publish AS the browser — its account session, or its anonymous agent-session
 * cookie — through the same `/api/my/artifacts` door the app's own UI uses.
 * Runs inside the page so the request carries the browser's cookies and its
 * own origin, which is what the route requires.
 *
 * @param {import('playwright').Page} page
 * @param {object} body  the artifact body (`title`, `markup`, `dataset`, …)
 */
export async function publishAs(page, body) {
  const created = await page.evaluate(async (payload) => {
    const res = await fetch('/api/my/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, body);
  if (created.status >= 300 || !created.body?.id) {
    throw new Error(`could not publish as this browser (${created.status} ${JSON.stringify(created.body)})`);
  }
  return created.body;
}

/** Read the exact native page head before a fixture's conditional replacement.
 * @param {string} base @param {string} id @param {string} token
 * @param {typeof fetch} read injected HTTP port for focused helper tests
 */
export async function readDocumentHead(base, id, token, read = fetch) {
  const response = await read(`${base}/api/artifacts/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error',
  });
  if (!response.ok) throw new Error(`cannot read gate fixture (${response.status})`);
  const head = await response.json();
  if (head.format !== 'html' || !Number.isInteger(head.version) || typeof head.state !== 'string') throw new Error('gate fixture must have a native HTML head with publication guards');
  return head;
}
