---
name: html-operations
description: Native HTML comment anchors and server-side browser verification.
---

## Read first

Use this guide for native HTML comments and browser QA. Read [HTML authoring](html-authoring.md) for page creation and updates; keep credentials in the API caller, never in page code.

## Contents

- [Comment on a saved HTML node](#comment-on-a-saved-html-node)
- [Verify the actual HTML in a server browser session](#verify-the-actual-html-in-a-server-browser-session)
- [Recovery and limits](#recovery-and-limits)

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

Use `node scripts/check.mjs ID --viewport 1280x800 --viewport 390x844 --steps acceptance.mjs --output qa.json`. Explicit viewports replace defaults. `--viewer self|guest` creates an isolated fixed-identity server session; never use the user's browser for QA. It returns page/console errors, failed requests, HTTP errors, visible text, overflow, `contrast` (text below WCAG AA; under 2:1 fails smoke), task evidence and screenshot paths; `--output` also prints a per-viewport summary. Screenshots cover the viewport: `reader-viewport` includes reader chrome; `local-viewport` is the preview. Scroll to inspect more. Both success and failure expose top-level `smokePassed`, `checks`, `unverified`, `note`. Known same-origin view telemetry is separate; functional event streams and GraphQL errors are not silently excluded.

The step file is an async function body receiving document-scoped `page`:

```js
const before=await page.getByRole('status').innerText();
await page.getByRole('button',{name:'Refresh'}).click();
const after=await page.getByRole('status').innerText();
if(before===after)throw Error('Expected changed test data after refresh');
return {assertions:['refresh shows changed fixture data'],before,after};
```

Use disposable test fixtures: hooks can write data. Return the actual assertion evidence; throw on failure. A generic smoke pass proves neither full task behavior, persistence nor permissions. For persistence, change data, reload and assert the changed value. For refusals, use a separate guest session. View screenshots with an image-capable reviewer; capturing an unread image does not establish appearance. Stop once requested behavior and appearance pass at desktop and 390px; fix known defects, then avoid optional polish.

The helper creates one receipt-safe browser session, one execution per viewport, and closes it. The existing API remains `POST /api/browser-sessions` with `{op:'script',session_id,execution_id,create:true,code}`, then `{op:'status',session_id,execution_id}` until complete, and `{op:'close',session_id}`. Credentials stay in the API caller. After an uncertain submission, inspect the same receipt rather than replaying actions. A changed script needs a new execution ID. Direct scripts can return `{pageErrors,failedRequests,overflow,text}` and optionally call `output.image(await page.locator('body').screenshot())`; `page.mainFrame()` reaches reader chrome.

## Recovery and limits

`comment.mjs watch ID --once --output comments.ndjson` establishes now without a cursor. `--cursor CHECKPOINT_OR_LOG` resumes human comments; `--append --output LOG` validates origin/artifact/stream and resumes its flushed checkpoint. Events deduplicate by ID. Only delivered events advance checkpoints; cursor/access failures refuse instead of silently resetting. Agent comments, resolve and reopen are not human-feed events. Each command's `--help` lists write/revision flags.

Session limits: 20 s/script, 65,536 script bytes, 16 executions, eight pages, 30-minute idle expiry. Bound navigation and assertions below the script limit; avoid `networkidle`. A deadline does not identify its cause: return caught errors plus text/network/overflow before expiry; inspect page errors and the awaited condition. After a hard deadline, inspect the same receipt and use a new read-only execution for diagnostics before considering another action. Text/geometry and unread screenshots leave appearance unverified; clicking with unchanged data does not verify refresh or persistence.
For slide navigation, use the runnable [SlideDeck example](html-examples.md#slide-deck-with-viewer-local-navigation); it retains the selected index in viewer-local Apollo state.
