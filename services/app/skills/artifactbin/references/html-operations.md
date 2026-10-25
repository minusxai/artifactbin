---
name: html-operations
description: Native HTML comment anchors and server-side browser verification.
---

# Native HTML comments and browser verification

Use these procedures with the [HTML API](html-authoring.md) and the selected server. They describe native HTML operations; JSX `node_id` anchors and CLI-only browser guidance are separate compatibility contracts.

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

The HTTP request helper sends the selected origin's bearer, `Origin` and JSON content type. Keep `commentKey` and `commentBody` if the outcome is uncertain; retry the same request with both unchanged. The create response is the comment thread receipt; retain its `id` and `revision` for replies or state changes.

The native anchor shape is:

```json
{"kind":"html-node","v":1,"revision":"7","nodeId":"results-heading","quote":"March results"}
```

`revision` is the current artifact version encoded as a string. `nodeId` is the stable page-node identity. `quote` is exact context within that node; use an empty string when commenting on the whole node without selected text. A comment on a script-created node also supplies `ancestorId`, the stable `data-af-id` of its saved source ancestor. Keep IDs stable, unique and scoped beneath that ancestor.

Read the current thread list with `GET /api/artifacts/ID/annotations?status=all` before replying, editing or changing state; `GET /api/artifacts/ID` returns page source and version, not the comment list. Follow each `next_cursor` by repeating the request with the `cursor` query parameter. To reply or resolve, send `POST /api/artifacts/ID/annotations/THREAD_ID` with `reply` or `resolve:true` and the last `expected_revision`. To edit a comment you wrote, send `PATCH /api/artifacts/ID/annotations/COMMENT_ID` with `body` and `expected_revision`. Read the current thread after a conflict before retrying.

## Verify the actual HTML in a server browser session

`POST /api/browser-sessions` runs a Playwright function body in an isolated persistent browser. The page route `/a/ID` is the Artifactbin reader shell; the authored HTML is inside its sandboxed `iframe[data-mx-document-frame]`. Use the frame locator for page content. The outer `page` is for reader chrome and full-reader screenshots.

Keep the bearer in the caller that sends the API request. It does not belong in `code`, page HTML or downloaded files. The page is signed in as the caller unless the session-creation request explicitly sets `viewer:'guest'` or an authorized `viewer:{testuser:'ID'}`. A session's viewer is fixed at creation.

```js
const code = `
const page = await context.newPage();
const pageErrors = [], failedRequests = [];
page.on('pageerror', error => pageErrors.push(error.message));
page.on('requestfailed', request => failedRequests.push({url: request.url(), error: request.failure()?.errorText}));
await page.setViewportSize({width: 390, height: 844});
await page.goto('/a/${artifactId}');
const documentFrame = page.frameLocator('iframe[data-mx-document-frame]');
await documentFrame.getByRole('heading').first().waitFor();
const heading = await documentFrame.getByRole('heading').first().innerText();
const body = await documentFrame.locator('body').innerText();
const overflow = await documentFrame.locator('html').evaluate(html => {
  const body = html.ownerDocument.body;
  const width = Math.max(html.scrollWidth, body.scrollWidth);
  return {viewport: html.clientWidth, content: width, fits: width <= html.clientWidth + 1};
});
await output.image(await documentFrame.locator('body').screenshot());
return {heading, body, overflow, pageErrors, failedRequests};
`;
const session_id = crypto.randomUUID();
const execution_id = crypto.randomUUID();
const submitted = await request('/api/browser-sessions', {method: 'POST', body: {
  op: 'script', session_id, execution_id, create: true, code
}});
const accepted = submitted.session_id === session_id && submitted.execution_id === execution_id;
if (!accepted) throw Error('Browser session was not accepted');
let run = submitted;
try {
  for (const end = Date.now() + 20000; ['queued', 'running'].includes(run.status) && Date.now() < end;) {
    await new Promise(resolve => setTimeout(resolve, 250));
    run = await request('/api/browser-sessions', {method: 'POST', body: {op: 'status', session_id, execution_id}});
  }
  if (run.status !== 'completed') throw Error(run.error?.code ?? run.status);
  const capture = run.result; // inspect the returned heading and text
} finally {
  await request('/api/browser-sessions', {method: 'POST', body: {op: 'close', session_id}});
}
```

Poll with `POST /api/browser-sessions` and `{op:'status',session_id,execution_id}` until the same execution is `completed`; inspect `result`, `error` and `attachments`. If the call outcome is uncertain, check that receipt before resubmitting. Close the accepted session with `{op:'close',session_id}` when finished. A changed script requires a new `execution_id`; do not replay a browser action with a new receipt.

Use accessible roles and names inside the document frame, inspect page errors and failed requests, and check a narrow viewport. A screenshot of the reader shell alone does not prove the authored document rendered. For authorized writes, run as the right account; use a separate guest or test-user session to verify refused actions.

## Create, update and the local helper

The normal authoring path is `POST /api/artifacts` for a new HTML page and conditional `PUT /api/artifacts/ID` for an edit, as described in [HTML publication](html-authoring.md). The installed `scripts/publish.mjs` helper prepares bounded sample publication bundles for **new** artifacts. It does not edit a published page. Use its saved request/idempotency workflow for a new sample, and use the observed `version`/`state` with `PUT` for updates.

For slide navigation, use the runnable [SlideDeck example](html-examples.md#slide-deck-with-viewer-local-navigation); it retains the selected index in viewer-local Apollo state.
