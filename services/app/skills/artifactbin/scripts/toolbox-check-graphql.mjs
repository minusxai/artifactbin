/**
 * Internal: check.mjs's capture, in the check browser, of the page's failed GraphQL fields (its
 * resolvers and datasets): each error's field, message, code and the detail the server sends only
 * to the page owner (extensions.detail), stamped with how many page and console errors came before
 * it. A failed read-only query that got no detail keeps its request body, so check can ask it again
 * as the owner. Serialized into the hosted script (PARTS): it references only its parameters.
 * Used by: toolbox-check-inspect.mjs.
 */

/** Reads one response if it is the page's GraphQL; pushes its errors (at most 20 in all) into
 * `into` and the pending body read into `waits`. Never throws. */
export function graphql(response, before, into, waits) {
  let url, sent = null;
  try {
    url = new URL(response.url());
    if (!/^\/api\/(?:artifacts|local-connection)\/[^/]+\/graphql$/i.test(url.pathname)) return;
    sent = response.request().postDataJSON();
  } catch {
    if (!url) return;
  }
  // Only a query is safe to ask again; a write (or a document starting otherwise) never is.
  const query = typeof sent?.query === 'string' && (sent.operation === 'query' ||
    (sent.operation === undefined && /^\s*(?:query\b|\{)/.test(sent.query)));
  const replay = query && JSON.stringify(sent).length <= 8000
    ? Object.fromEntries(['query', 'variables', 'operationName', 'revision', 'operation']
      .filter(key => sent[key] !== undefined).map(key => [key, sent[key]]))
    : null;
  waits.push((async () => {
    let body;
    try {
      body = await response.json();
    } catch {
      return;
    }
    const errors = Array.isArray(body?.errors) ? body.errors
      : typeof body?.error === 'string' ? [{message: body.error, extensions: {code: body.error}}]
      : [];
    for (const error of errors.slice(0, 5)) {
      if (into.length >= 20) return;
      const {code, detail} = error?.extensions ?? {};
      const path = Array.isArray(error?.path) ? error.path.join('.') : '';
      into.push({
        field: path || String(sent?.operationName ?? 'operation'),
        message: String(error?.message ?? '').slice(0, 200),
        ...(typeof code === 'string' ? {code: code.slice(0, 64)} : {}),
        ...(typeof detail === 'string' ? {detail: detail.slice(0, 200)} : {}),
        ...before,
        ...(replay && typeof detail !== 'string' ? {replay} : {})
      });
    }
  })());
}
