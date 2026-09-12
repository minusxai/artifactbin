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
import { connectAgent } from './cli-connection.mjs';
import { fixtureFetch } from './fixture-http.mjs';
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
    || body.prompt.includes('\n')
    || body.prompt.includes('\r')
    || body.prompt.includes('mx_')) {
    throw new Error('the start paste is not one tokenless line');
  }
  if ('token' in body) throw new Error('the start response handed out a credential');
  return { id: body.id, token, editId: body.edit_id, prompt: body.prompt };
}

/**
 * Make this browser the document's owner, so `/a/<id>` grants it owner chrome
 * (top bar and owner controls) around the inline story runtime. Exchanges the
 * token for the httpOnly session cookie — the same call the app's own UI makes.
 *
 * Must run from a page on the app's origin so `page.evaluate` can make the
 * same-origin cookie exchange; the canonical artifact page uses the inline
 * runtime and is not an opaque child frame.
 */
export async function becomeOwner(page, base, token) {
  /*
   * `domcontentloaded`, not `load`. All this navigation is for is a document on
   * the app's origin to run one same-origin fetch from — and the home page's
   * cards carry preview images the server renders on demand through its own
   * headless browser. A run that has already seeded documents can queue several
   * of those renders behind one navigation, and `load` waits for every one of
   * them: MEASURED as a 30 s `page.goto` timeout inside becomeOwner on
   * claim-flow, inplace-edit and layout-shift, each passing on a re-run. The
   * cookie exchange below needs the DOM and the origin, nothing more.
   */
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  const status = await page.evaluate(async (t) => (await fetch('/api/session/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: t }),
  })).status, token);
  if (status !== 204) throw new Error(`could not adopt the token into a session (${status})`);
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

/**
 * The bearer-carrying API caller thirteen gates each wrote inline. Returns the
 * raw `Response`; `.json(path, init)` throws on a non-2xx and parses, which is
 * what seeding code wants.
 *
 * @param {string} base
 * @param {string} [token]  omit for an unauthenticated call
 */
export function apiAs(base, token) {
  const call = (path, init = {}) => fixtureFetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  call.json = async (path, init) => {
    const res = await call(path, init);
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res.json();
  };
  return call;
}
