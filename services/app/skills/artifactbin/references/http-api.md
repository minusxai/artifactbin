---
title: Direct HTTP API
description: Email-authenticated HTTP integration, artifact operations and conditional writes without installing Node or afbin.
---
## Authentication

CLI browser approval and direct HTTP authentication require an email account.

Send JSON to `[[ base ]]` with `Content-Type: application/json`; session requests also send `Origin: [[ base ]]`.

1. `POST /api/auth/email-otp/send-verification-otp` with `{"email":"you@example.com","type":"sign-in"}`; ask for the emailed OTP.
2. `POST /api/auth/sign-in/email-otp` with `{"email":"you@example.com","otp":"<user's code>"}`; retain returned cookies in a private jar.
3. `POST /api/authentication/token` with those cookies and the selected server's Origin. Only verified email sessions qualify; the response has `access_token`, `token_type: "Bearer"`, `expires_in` (seconds) and `scope: "artifacts"`.
4. Use `Authorization: Bearer <access_token>` on this server's `/api` requests. Never put bearer secrets in URLs, docs or logs. On expiry, repeat email auth; there is no refresh token. Sign-out closes the temporary session, not the bearer.

## Operations

- `GET /api/artifacts`: list accessible artifacts; follow returned opaque pagination cursors.
- `GET /api/artifacts/<id>`: read source, metadata and current version/state.
- `POST /api/artifacts`: create with exactly one supported content field, which assigns a new ID. Use a new ID for supporting datasets/media; putting CSV onto a document ID converts that document into a dataset.
- `PUT /api/artifacts/<id>`: conditionally replace an existing dataset/media artifact with observed `expectedVersion` and `expectedState`; reconcile a 409.
- `POST /api/artifacts/<id>/prepare`: send edited JSX as `source` plus observed `edit_id` and `expectedVersion`; it returns an unsaved `document_update`. Submit that exact update and `edit_id` to `/edits`. Preserve IDs and reconcile 409s; do not publish scratch replacement documents.
- Dataset policy changes use `GET /api/artifacts/<id>/policy` to observe `revision`, then a separate `PUT /api/artifacts/<id>/policy` with `policy` and `expectedPolicyRevision`; do not combine policy with content.
- Markup edits preserve graph reads/claims and node identity; raw JSX does not replace that contract. See [JSX authoring](http-authoring.md) and [graph wire fields](http-document-graph.md).
- `GET/POST /api/artifacts/<id>/annotations`: read/create comments; document permissions still apply. Creation requires a body and node or quote anchor.
- `DELETE /api/artifacts/<id>`: move to trash.

Inspect non-success JSON and follow its recovery instructions. After an uncertain mutation, reconcile its receipt/current head before attempting another write.

## Browser preview and interactive QA

For browser QA, use `POST /api/browser-sessions` with your email bearer; no local Chrome is needed. A session browses as you unless `viewer` is set at creation; it cannot change later. Each changed script needs a new `execution_id`; reuse one only for an exact code replay. Poll with that ID. Scripts run at most 20 seconds. Check receipt errors and IDs; HTTP 200 alone is not success. Capacity refusal creates no session: read its recovery message, then close your session or wait before retrying. See [live sessions](live-sessions.md) for Playwright patterns and limits.

```js
const headers = {Authorization:'Bearer ' + accessToken,'Content-Type':'application/json',Origin:base};
const call = async body => {const r=await fetch(base+'/api/browser-sessions',{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('HTTP '+r.status);const x=await r.json();if(x.error)throw Error(x.error.code+': '+x.error.message);return x};
const session_id=crypto.randomUUID(), execution_id=crypto.randomUUID();
let accepted=false;
try {
  let s=await call({op:'script',session_id,execution_id,create:true,code:`const page=await context.newPage(),pageErrors=[],failedRequests=[];page.on('pageerror',e=>pageErrors.push(e.message));page.on('requestfailed',r=>failedRequests.push({url:r.url(),error:r.failure()?.errorText}));await page.setViewportSize({width:390,height:844});await page.goto('/a/${artifactId}');const heading=await page.getByRole('heading').first().innerText(),controls=await page.locator('body').ariaSnapshot();await output.image(await page.screenshot());return {heading,controls,pageErrors,failedRequests};`});
  accepted=s.session_id===session_id;
  if(!accepted||s.execution_id!==execution_id||!['queued','running','completed'].includes(s.status))throw Error('Session was not accepted');
  for(let end=Date.now()+20000;['queued','running'].includes(s.status)&&Date.now()<end;){await new Promise(r=>setTimeout(r,250));s=await call({op:'status',session_id,execution_id});}
  if(s.status!=='completed')throw Error(s.error?.code||s.status||'timeout');
  // Read s.result.heading, controls, pageErrors and failedRequests; screenshot: s.attachments[0].base64.
} finally {if(accepted)await call({op:'close',session_id});}
```

Use `s.result.controls` to find accessible names, then Playwright role/name locators. The kit `<Select>` is a button with a listbox, not a native `<select>`. Return text/data from the script; `output.image` attaches PNG/JPEG only (no `output.text` or `output.log`). Keep both error arrays with the QA result.

- A saved page action uses `POST /api/artifacts/<page-id>/mutate` with `{"name":"vote","args":{"choice":"ramen"}}`. The stored `<Mutation>` supplies its SQL and context; the API rechecks page access, dataset policy and any required membership. A public or unlisted link does not grant writes. Direct SQL against a dataset ID is a separate path and may return 403 even to its owner under the default policy. See [actions](markup-data.md#declarations-helmet-only) and [dataset rules](apps.md#dataset-rules).

## Comments: create, reply, resolve and reopen

Use the email bearer and document comment permission; guests cannot comment. `GET /api/artifacts/<id>/annotations?status=all` lists threads as `{annotations,next_cursor}`; follow the cursor. Each has `id`, `revision`, `status` and `thread`.

Create with `POST /api/artifacts/<id>/annotations` and `{"body":"Please clarify this","node_id":"message"}` (`node_id` is a stored JSX ID), or send a unique current `quote`. Optional `range` is allowed; creation returns 201 and needs no `edit_id` or `expectedVersion`. Re-read source if an anchor is stale or ambiguous.

Reply or transition with **POST** `/api/artifacts/<id>/annotations/<annotation_id>` using the root ID and last `expected_revision`. Send `reply`, `resolve:true` or `reopen:true`; a reply may combine with one transition, never both transitions. Use each returned revision. A `409 annotation_conflict` includes `current_revision`; reconcile before retrying.

Example with existing `artifactId` and `nodeId`, and private `accessToken` from email auth:

```js
// BEGIN HTTP COMMENTS
const headers = {'Content-Type':'application/json', Authorization:'Bearer ' + accessToken};
const commentsPath = '/api/artifacts/' + artifactId + '/annotations';
async function commentRequest(path, body) {
  const response = await fetch(base + path, {method:'POST', headers, body:JSON.stringify(body)});
  if (!response.ok) throw Error(await response.text());
  return response.json();
}
const created = await commentRequest(commentsPath, {body:'Please clarify this',node_id:nodeId});
const threadPath = commentsPath + '/' + created.id;
const replied = await commentRequest(threadPath, {reply:'I have clarified it', expected_revision:created.revision});
const resolved = await commentRequest(threadPath, {resolve:true, expected_revision:replied.revision});
const reopened = await commentRequest(threadPath, {reopen:true, expected_revision:resolved.revision});
// END HTTP COMMENTS
```

An optional `Idempotency-Key` recovers an uncertain create/reply; retry with the same key and body. Comment actions do not need remote review headers. Comments are separate from JSX.

Publishing is explicit; HTTP requires access to the selected server.


[HTTP authoring](http-authoring.md) covers creation and edits; [document graphs](http-document-graph.md) defines wire fields and concurrency. See the [public index](/llms.txt).
