/**
 * Starting a document, and becoming its owner in a browser — for gates.
 *
 * Two things changed under every gate that used to do this by hand:
 *
 *  1. `POST /api/start` returns the anonymous agent token once, both as a
 *     `token` field and inline in the one-line paste. Gates take the field and
 *     assert the paste carries the same credential; no start link is spent.
 *  2. `/a/<id>` mounts authored prose in the main document for every role.
 *     A gate that edits must still establish ownership via `becomeOwner`;
 *     shared first-party chrome never implies document permissions.
 *
 * Both are the product working as designed, so they belong in one helper
 * rather than in thirteen copies of the old assumptions.
 */

/**
 * Create an artifact and take the agent's token from the start response.
 * Returns `{ id, token, editId, prompt }`.
 */
export async function startDocument(base, headers = {}, fetchImpl = fetch) {
  const res = await fetchImpl(`${base}/api/start`, { method: 'POST', headers });
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
    || !body.prompt.includes(`using this token: ${token}`)) {
    throw new Error('the start paste is not one line carrying the response token');
  }
  return { id: body.id, token, editId: body.edit_id, prompt: body.prompt };
}

/**
 * Make this browser the document's owner, enabling its editing controls.
 * Exchanges the token for the httpOnly session cookie — the
 * same call the app's own UI makes.
 *
 * The exchange happens in the first-party main document, never an i. frame.
 */
export async function becomeOwner(page, base, token) {
  // Establish the main document; decorative home images are not session setup.
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  const app=page;
  await app.locator('#root').waitFor({state:'attached'});
  const status = await app.locator('body').evaluate(async (_,t) => (await fetch('/api/session/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-artifactbin-csrf': '1' },
    body: JSON.stringify({ token: t }),
  })).status, token);
  if (status !== 204) throw new Error(`could not adopt the token into a session (${status})`);
  const session=await app.evaluate(async()=>{
    const response=await fetch('/api/page/session',{headers:{'x-artifactbin-csrf':'1'}});
    return response.ok?response.json():null;
  });
  if(!['anon','account'].includes(session?.kind))throw new Error('adopted token did not establish a validated browser session');
}
