/**
 * Starting a document, and becoming its owner in a browser — for gates.
 *
 * Two things changed under every gate that used to do this by hand:
 *
 *  1. `POST /api/start` returns the anonymous agent token once, both as a
 *     `token` field and inline in the one-line paste. Gates take the field and
 *     assert the paste carries the same credential; no start link is spent.
 *  2. `/a/<id>` serves the app document with its story runtime inline to every
 *     viewer. Owner authority still controls the surrounding editing chrome,
 *     so the owner-focused gates make their browser the owner, which is what
 *     `becomeOwner` does.
 *
 * Both are the product working as designed, so they belong in one helper
 * rather than in thirteen copies of the old assumptions.
 */

/**
 * Create an artifact and take the agent's token from the start response.
 * Returns `{ id, token, editId, prompt }`.
 */
export async function startDocument(base) {
  const res = await fetch(`${base}/api/start`, { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.id) {
    throw new Error(
      `cannot start a document (${res.status} ${JSON.stringify(body)}).\n`
      + 'The anonymous-mint limit is per-IP and in-memory: restart the dev server to clear it.',
    );
  }
  const token = typeof body.token === 'string' && /^mx_[A-Za-z0-9_-]+$/.test(body.token)
    ? body.token
    : null;
  if (!token) throw new Error('the start response handed out no token');
  if (typeof body.prompt !== 'string'
    || body.prompt.includes('\n')
    || body.prompt.includes('\r')
    || body.prompt.includes('mx_')) {
    throw new Error('the start paste is not one tokenless line');
  }
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
