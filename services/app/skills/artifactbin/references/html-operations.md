---
name: html-operations
description: Native HTML comment anchors and server-side browser verification.
---

## Read first

Use this guide for native HTML comments and browser QA. Read [HTML authoring](html-authoring.md) for page creation and updates; keep credentials in the API caller, never in page code.

## Contents

- [Comment on a saved HTML node](#comment-on-a-saved-html-node)
- [Verify the actual HTML in a server browser session](#verify-the-actual-html-in-a-server-browser-session)
- [Create, update and the local helper](#create-update-and-the-local-helper)

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

Retain the returned thread `id` and `revision`. Retry uncertain writes with identical body and idempotency key.

The native anchor shape is:

```json
{"kind":"html-node","v":1,"revision":"7","nodeId":"results-heading","quote":"March results"}
```

Use an empty `quote` for the whole node. A comment on a script-created node also supplies `ancestorId`, the stable `data-af-id` of its saved source ancestor. Keep IDs stable, unique and scoped beneath that ancestor.

Read the current thread list with `GET /api/artifacts/ID/annotations?status=all` before replying, editing or changing state; `GET /api/artifacts/ID` returns page source and version, not the comment list. Follow each `next_cursor` by repeating the request with the `cursor` query parameter. To reply or resolve, send `POST /api/artifacts/ID/annotations/THREAD_ID` with `reply`, `resolve:true`, or both and the last `expected_revision`. One `{reply:"Fixed in version 2",resolve:true,expected_revision:REVISION}` request atomically replies then resolves. Quote the version actually checked. To edit a comment you wrote, send `PATCH /api/artifacts/ID/annotations/COMMENT_ID` with `body` and `expected_revision`. Read the current thread after a conflict before retrying.

## Verify the actual HTML in a server browser session

`POST /api/browser-sessions` runs Playwright in an isolated browser. `/a/ID` is the reader shell, with authored HTML in its sandboxed `iframe[data-mx-document-frame]`. The session worker auto-scopes `page` locators, evaluation and actions to that frame. Use `page.getByRole(...)` and `page.locator(...)`; `page.frameLocator(...)` double-scopes. Use `page.mainFrame()` for reader chrome; navigation and full-page screenshots still use the shell.

Keep the bearer in the caller that sends the API request. It does not belong in `code`, page HTML or downloaded files. The page is signed in as the caller unless the session-creation request explicitly sets `viewer:'guest'` or an authorized `viewer:{testuser:'ID'}`. A session's viewer is fixed at creation.

```js
const code = `
const page = await context.newPage();
const pageErrors = [], failedRequests = [];
page.on('pageerror', error => pageErrors.push(error.message));
page.on('requestfailed', request => failedRequests.push({url: request.url(), error: request.failure()?.errorText}));
await page.setViewportSize({width: 390, height: 844});
await page.goto('/a/${artifactId}');
const headingLocator = page.getByRole('heading').first();
await headingLocator.waitFor();
const heading = await headingLocator.innerText();
const body = await page.locator('body').innerText();
const overflow = await page.locator('html').evaluate(html => {
  const body = html.ownerDocument.body;
  const width = Math.max(html.scrollWidth, body.scrollWidth);
  return {viewport: html.clientWidth, content: width, fits: width <= html.clientWidth + 1};
});
// Optional for image-capable reviewers: await output.image(await page.locator('body').screenshot());
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

Verify write refusals in a separate guest/test-user session. A shell screenshot alone does not prove document rendering.

## Create, update and the local helper

Create with `POST /api/artifacts`; edit with conditional `PUT /api/artifacts/ID` using observed version/state ([HTML publication](html-authoring.md)). `scripts/publish.mjs` sends saved requests; keep body and idempotency key unchanged after an uncertain result, including HTTP 502. Preserve dependency receipts for bundle updates.

Session limits: 20 s/script, 65,536 script bytes, 16 executions, eight pages, 30-minute idle expiry. Bound navigation and assertions below the script limit; avoid `networkidle`. A deadline does not identify its cause: return caught errors plus text/network/overflow before expiry; inspect page errors and the awaited condition. After a hard deadline, inspect the same receipt and use a new read-only execution for diagnostics before considering another action. Text/geometry and unread screenshots leave appearance unverified; clicking with unchanged data does not verify refresh or persistence.
For slide navigation, use the runnable [SlideDeck example](html-examples.md#slide-deck-with-viewer-local-navigation); it retains the selected index in viewer-local Apollo state.
