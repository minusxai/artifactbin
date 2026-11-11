/**
 * Internal: check.mjs's capture, in the check browser, of the page's failed calls to the app: a
 * `sql` statement (/sql) or a backend function (/fn/NAME). Each failure keeps its field (sql or
 * fn/NAME), message, code and the detail the server sends only to the page owner, stamped with
 * how many page and console errors came before it. A failed read (a SELECT, a GET function) that
 * got no detail keeps what it sent, so check can ask it again as the owner; a write never is. A
 * page published before sql may still post to /graphql: that counts as a call too (a data read,
 * and a failure when refused), nothing more. Serialized into the hosted script (PARTS): it
 * references only its parameters.
 * Used by: toolbox-check-inspect.mjs.
 */

/** Which page call a URL is: 'sql', 'fn' (with the function's name) or 'graphql', or null. */
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
  if (call.kind === 'sql') {
    replay = typeof sent?.sql === 'string' && /^\s*(?:select|with|values)\b/i.test(sent.sql)
      ? {sql: sent.sql, params: sent.params ?? {}, revision: sent.revision} : null;
  } else if (call.kind === 'fn' && method === 'GET') replay = {search: url.search};
  if (replay && JSON.stringify(replay).length > 8000) replay = null;
  if (response.status() < 400) return;
  waits.push((async () => {
    let body;
    try {
      body = await response.json();
    } catch {
      body = {error: 'http_' + response.status()};
    }
    // sql and functions answer {error, message, detail?}; any other refusal keeps its status.
    if (into.length >= 20) return;
    const code = typeof body?.error === 'string' ? body.error : 'http_' + response.status();
    const {detail} = body ?? {};
    into.push({
      field: call.kind === 'fn' ? 'fn/' + call.name : call.kind,
      kind: call.kind,
      message: String(body?.message ?? code).slice(0, 200),
      code: code.slice(0, 64),
      ...(typeof detail === 'string' ? {detail: detail.slice(0, 200)} : {}),
      ...before,
      ...(replay && typeof detail !== 'string' ? {replay} : {})
    });
  })());
}
