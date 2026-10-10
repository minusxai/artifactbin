---
name: http-api
description: Email-authenticated HTTP integration, artifact operations and conditional writes without installing Node or afbin.
---
## Read first

Authenticate with an email account using the [shared credential helper and sign-in contract](http-auth.md). Reuse CLI credentials on the same origin; authenticate as the recipient with access. Send JSON with `Content-Type: application/json`; session requests need `Origin: [[ base ]]`.

## Operations

- `GET /api/artifacts`: list accessible artifacts; follow returned opaque pagination cursors.
- `GET /api/artifacts/<id>`: read source, metadata and current version/state.
- `POST /api/artifacts`: create with one content field. Use new IDs for datasets/media; CSV on a document ID converts it to a dataset.
- `PUT /api/artifacts/<id>`: replace datasets/media with observed `expectedVersion` and `expectedState`; reconcile 409s.
- `POST /api/artifacts/<id>/prepare`: send edited JSX as `source` plus observed `edit_id` and `expectedVersion`; it returns an unsaved `document_update`. Submit that exact update and `edit_id` to `/edits`. Preserve IDs and reconcile 409s; do not publish scratch replacement documents.
- Policy: `GET /api/artifacts/<id>/policy` for `revision`, then `PUT` with `policy` and `expectedPolicyRevision`, separately from content.
- Markup edits preserve graph reads/claims and node identity; raw JSX does not replace that contract. See [JSX authoring](http-authoring.md) and [graph wire fields](http-document-graph.md).
- `GET/POST /api/artifacts/<id>/annotations`: read/create comments with a body and node/quote anchor; permissions apply.
- `DELETE /api/artifacts/<id>`: move to trash.

Follow non-success JSON recovery instructions. Reconcile uncertain mutations before another write.

## Browser preview and interactive QA

Use `POST /api/browser-sessions` with your bearer; no local Chrome is needed. Its `viewer` is fixed at creation. Each changed script needs a new `execution_id`; reuse only for exact replay and poll with that ID. Scripts run at most 20 seconds. Check receipt errors and IDs. Capacity refusal creates no session; follow its recovery message. See [live sessions](live-sessions.md).

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

Use `s.result.controls` to find accessible names, then Playwright role/name locators. Kit `<Select>` uses a button/listbox. Return text/data; `output.image` attaches PNG/JPEG (no `output.text` or `output.log`). Keep both error arrays.

- A saved page action uses `POST /api/artifacts/<page-id>/mutate` with `{"name":"vote","args":{"choice":"ramen"}}`. The API checks page access, dataset policy and membership. Public/unlisted links do not grant writes; direct dataset SQL may return 403 even to owners. See [actions](markup-data.md#declarations-helmet-only) and [dataset rules](apps.md#dataset-rules).

## Comments: create, reply, resolve and reopen

Comments require an email bearer and document comment permission. `GET /api/artifacts/<id>/annotations?status=all` lists threads as `{annotations,next_cursor}`; follow the cursor. Each has `id`, `revision`, `status` and `thread`.

Create with `POST /api/artifacts/<id>/annotations` and `{"body":"Please clarify this","node_id":"message"}` (a stored JSX ID), or a unique current `quote`. Optional `range` is allowed; creation returns 201. Re-read stale/ambiguous anchors.

Reply or transition with **POST** `/api/artifacts/<id>/annotations/<annotation_id>` using the root ID and last `expected_revision`. Send `reply`, `resolve:true` or `reopen:true`; a reply may combine with one transition, never both transitions. Use each returned revision. A `409 annotation_conflict` includes `current_revision`; reconcile before retrying.

With existing `artifactId`, `nodeId` and private `accessToken`:

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

`Idempotency-Key` recovers uncertain create/reply: retry the same key/body. Comments are separate from JSX; no remote review headers.

Publishing requires access to the selected server.

[HTTP authoring](http-authoring.md) covers creation and edits; [document graphs](http-document-graph.md) defines wire fields and concurrency. See the [public index](../SKILL.md).
