---
name: html-operations
description: Native HTML comment anchor contract, HTTP comment operations and the server browser session.
---

## Read first

Use this guide for the native HTML comment contract over HTTP and the browser session API. Prefer `scripts/comment.mjs` and `scripts/check.mjs`. Read [HTML authoring](html-authoring.md) for page creation and updates; keep credentials in the API caller, never in page code.

## Contents

- [Comment on a saved HTML node](#comment-on-a-saved-html-node)
- [The server browser session and its document frame](#the-server-browser-session-and-its-document-frame)
- [Recovery and limits](#recovery-and-limits)

# Native HTML comments and the browser session

Use these procedures with the [HTML API](html-authoring.md) and the selected server.

## Comment on a saved HTML node

Read `GET /api/artifacts/ID` first. Use its current `version` as the string `revision`, and take `nodeId` from the element's canonical saved `data-af-id`. A text comment's `quote` is the exact current text inside that element. The comment is a sidecar relation and does not change the saved HTML. The snippets assume `artifactId` and `accessToken` came from the selected artifact and the private sign-in flow in [HTTP authentication](http-auth.md); the token stays in the caller and is never sent to the page:

```js
const base = 'https://example.test'; // replace with the selected server origin
async function request(path, {method = 'GET', body, headers = {}} = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: {Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Origin: base, ...headers},
    ...(body === undefined ? {} : {body: JSON.stringify(body)})
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error ?? `HTTP ${response.status}`);
  return result;
}
const head = await request(`/api/artifacts/${artifactId}`);
const anchor = {
  kind: 'html-node',
  v: 1,
  revision: String(head.version),
  nodeId: 'results-heading',
  quote: 'March results'
};
const commentKey = crypto.randomUUID();
const commentBody = {anchor, body: 'Please explain this result.'};
const created = await request(`/api/artifacts/${artifactId}/annotations`, {
  method: 'POST',
  headers: {'Idempotency-Key': commentKey},
  body: commentBody
});
```

Retain the returned thread `id` and `revision`. Retry uncertain writes with identical body and idempotency key.

The native anchor shape is:

```json
{"kind":"html-node","v":1,"revision":"7","nodeId":"results-heading","quote":"March results"}
```

Use an empty `quote` for the whole node. A comment on a script-created node also supplies `ancestorId`, the stable `data-af-id` of its saved source ancestor. Keep IDs stable, unique and scoped beneath that ancestor.

Read the current thread list with `GET /api/artifacts/ID/annotations?status=all` before replying, editing or changing state; `GET /api/artifacts/ID` returns page source and version, not the comment list. Follow each `next_cursor` via the `cursor` query parameter. To reply or resolve, send `POST /api/artifacts/ID/annotations/THREAD_ID` with `reply`, `resolve:true`, or both; a plain reply needs no `expected_revision`, resolve needs the last one (stale + reply: reply kept, `status_conflict:true`). One `{reply:"Fixed in version 2",resolve:true,expected_revision:REVISION}` request atomically replies then resolves. Quote the version checked. To edit your comment, send `PATCH /api/artifacts/ID/annotations/COMMENT_ID` with `body` and `expected_revision`.

Reactions: `PUT /api/artifacts/ID/annotations/COMMENT_ID/reactions`; the top of `scripts/comment.mjs` describes them.

## The server browser session and its document frame

`/a/ID` is the reader shell; the authored HTML runs in its sandboxed `iframe[data-mx-document-frame]`. A session worker auto-scopes `page` locators, evaluation and actions to that frame, so use `page.getByRole(...)` and `page.locator(...)`; `page.frameLocator(...)` double-scopes. Use `page.mainFrame()` for reader chrome; navigation and full-page screenshots still use the shell. `scripts/check.mjs` wraps all of this (steps, viewports, viewers, evidence); read its top first.

Call the API directly only when the script cannot: `POST /api/browser-sessions` with `{op:'script',session_id,execution_id,create:true,code}`, then `{op:'status',session_id,execution_id}` until complete, then `{op:'close',session_id}`. Keep the bearer in the calling process, never in `code`, page HTML or downloaded files. The page is signed in as the caller unless creation sets `viewer:'guest'` or an authorized `viewer:{testuser:'ID'}`; a session's viewer is fixed at creation. After an uncertain submission, inspect the same receipt instead of replaying actions; a changed script needs a new execution ID. A script can return `{pageErrors,failedRequests,overflow,text}` and call `output.image(await page.locator('body').screenshot())`.

## Recovery and limits

Session limits: 20 s/script, 65,536 script bytes, 16 executions, eight pages, 30-minute idle expiry. Bound navigation and assertions below the script limit; avoid `networkidle`. A deadline does not identify its cause: return caught errors plus text/network/overflow before expiry; inspect page errors and the awaited condition. After a hard deadline, inspect the same receipt and use a new read-only execution for diagnostics before considering another action. Text/geometry and unread screenshots leave appearance unverified; clicking with unchanged data does not verify refresh or persistence.
For slide navigation, use the example at the top of `components/slide-deck.ts`; it retains the selected index in viewer-local Apollo state.
