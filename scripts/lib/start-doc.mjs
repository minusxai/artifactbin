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

/**
 * Create an artifact AS a fresh CLI connection, so the caller can write it.
 * Returns `{ id, token, editId, prompt }`.
 */
export async function startDocument(base) {
  const { token } = await connectAgent(base);
  const res = await fetch(`${base}/api/start`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
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
  await page.goto(`${base}/`, { waitUntil: 'load' });
  const status = await page.evaluate(async (t) => (await fetch('/api/session/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: t }),
  })).status, token);
  if (status !== 204) throw new Error(`could not adopt the token into a session (${status})`);
}
