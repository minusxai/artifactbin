/**
 * Starting a document, and becoming its owner in a browser — for gates.
 *
 * `POST /api/start` hands out NOTHING but the document and the one-line
 * tokenless paste: the product's only door to a credential is the afbin CLI's
 * device approval. So a gate that needs to WRITE the document it started gets
 * a connection first (lib/cli-connection) and starts the document AS that
 * connection — which is exactly what an agent does.
 *
 * `/a/<id>` serves the app document with its story runtime inline to every
 * viewer. Owner authority still controls the surrounding editing chrome, so
 * the owner-focused gates make their browser the owner, which is what
 * `becomeOwner` does.
 */
import { connectAgent, connectionBrowserCookie } from './cli-connection.mjs';
import { loginViaEmail } from './mail-login.mjs';

/**
 * What Chromium sends on the create button's fetch (MEASURED on production):
 * `/api/start` is `browser_only` in every policy file, because it is the WEB
 * PAGE's button — an agent creates with `POST /api/artifacts`. A gate stands
 * in for the page, so it sends what the page sends, written here once.
 */
export const pageHeaders = (base) => ({ origin: new URL(base).origin, 'sec-fetch-site': 'same-origin' });

/**
 * Create an artifact the way the page does, AS a fresh CLI connection, so the
 * caller can also write it. Returns `{ id, token, editId, prompt }`.
 */
export async function startDocument(base) {
  const { token } = await connectAgent(base);
  const res = await fetch(`${base}/api/start`, {
    method: 'POST',
    headers: { ...pageHeaders(base), Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.id) {
    throw new Error(`cannot start a document (${res.status} ${JSON.stringify(body)}).`);
  }
  if (typeof body.prompt !== 'string'
    || !body.prompt.includes("\n\n---\n\nLet's build an artifact for ")
    || body.prompt.includes('\r')
    || body.prompt.includes('mx_')) {
    throw new Error('the start paste must contain tokenless instructions and an editable brief');
  }
  if ('token' in body) throw new Error('the start response handed out a credential');
  return { id: body.id, token, editId: body.edit_id, prompt: body.prompt };
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
  const response = await page.request.get(`${base}/api/page/session`);
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
