/**
 * Internal: check.mjs's capture, in the check browser, of the page's failed calls to the app: a
 * `sql` statement (/sql), a backend function (/fn/NAME) or an older page's GraphQL field. Each
 * failure keeps its field (sql, fn/NAME or the GraphQL path), message, code and the detail the
 * server sends only to the page owner, stamped with how many page and console errors came before
 * it. A failed read (a SELECT, a GET function, a GraphQL query) that got no detail keeps what it
 * sent, so check can ask it again as the owner; a write never is. Serialized into the hosted
 * script (PARTS): it references only its parameters.
 * Used by: toolbox-check-inspect.mjs.
 */

/** Which page call a URL is: 'sql', 'fn' or 'graphql' (with the function's name), or null. */
export function callKind(value) {
  try {
    const path = new URL(value).pathname;
    const fn = /^\/api\/artifacts\/[^/]+\/fn\/([_A-Za-z][_0-9A-Za-z]{0,63})$/.exec(path);
    if (fn) return {kind: 'fn', name: fn[1]};
    if (/^\/api\/artifacts\/[^/]+\/sql$/i.test(path)) return {kind: 'sql'};
    if (/^\/api\/(?:artifacts|local-connection)\/[^/]+\/graphql$/i.test(path))
      return {kind: 'graphql'};
  } catch {}
  return null;
}

/** Reads one response if it is a page call (`kind`: callKind, passed in, since each part is
 * serialized alone); pushes its errors (at most 20 in all) into `into` and the pending body read
 * into `waits`. Never throws. */
export function calls(response, before, into, waits, kind) {
  let url, call = null, sent = null;
  try {
    url = new URL(response.url());
    call = kind(url.href);
    if (!call) return;
    sent = response.request().postDataJSON();
  } catch {
    if (!call) return;
  }
  let method = 'POST';
  try { method = response.request().method(); } catch {}
  // Only a read is safe to ask again; a write (or a statement starting otherwise) never is.
  let replay = null;
  if (call.kind === 'graphql') {
    const query = typeof sent?.query === 'string' && (sent.operation === 'query' ||
      (sent.operation === undefined && /^\s*(?:query\b|\{)/.test(sent.query)));
    replay = query ? Object.fromEntries(['query', 'variables', 'operationName', 'revision',
      'operation'].filter(key => sent[key] !== undefined).map(key => [key, sent[key]])) : null;
  } else if (call.kind === 'sql') {
    replay = typeof sent?.sql === 'string' && /^\s*(?:select|with|values)\b/i.test(sent.sql)
      ? {sql: sent.sql, params: sent.params ?? {}, revision: sent.revision} : null;
  } else if (method === 'GET') replay = {search: url.search};
  if (replay && JSON.stringify(replay).length > 8000) replay = null;
  if (call.kind !== 'graphql' && response.status() < 400) return;
  waits.push((async () => {
    let body;
    try {
      body = await response.json();
    } catch {
      body = {error: 'http_' + response.status()};
    }
    // GraphQL answers {errors: [...]}; sql and functions answer {error, message, detail?}.
    const errors = Array.isArray(body?.errors) ? body.errors
      : typeof body?.error === 'string' ? [{message: String(body.message ?? body.error),
        extensions: {code: body.error, detail: body.detail}}]
      : [];
    for (const error of errors.slice(0, 5)) {
      if (into.length >= 20) return;
      const {code, detail} = error?.extensions ?? {};
      const path = Array.isArray(error?.path) ? error.path.join('.') : '';
      into.push({
        field: call.kind === 'fn' ? 'fn/' + call.name : call.kind === 'sql' ? 'sql'
          : path || String(sent?.operationName ?? 'operation'),
        kind: call.kind,
        message: String(error?.message ?? '').slice(0, 200),
        ...(typeof code === 'string' ? {code: code.slice(0, 64)} : {}),
        ...(typeof detail === 'string' ? {detail: detail.slice(0, 200)} : {}),
        ...before,
        ...(replay && typeof detail !== 'string' ? {replay} : {})
      });
    }
  })());
}
