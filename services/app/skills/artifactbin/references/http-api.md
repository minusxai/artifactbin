---
title: Direct HTTP API
description: Email-authenticated HTTP integration, artifact operations and conditional writes without installing Node or afbin.
---
## Authentication

Direct HTTP integrations use email authentication. Browser approval with guest access belongs to the CLI. A direct HTTP client does not need Node or npm.

Use your selected server, `[[ base ]]`, for all requests. JSON calls send `Content-Type: application/json`; the session steps also send `Origin: [[ base ]]`.

1. `POST /api/auth/email-otp/send-verification-otp` with `{"email":"you@example.com","type":"sign-in"}`. Ask the user for the emailed OTP.
2. `POST /api/auth/sign-in/email-otp` with `{"email":"you@example.com","otp":"<user's code>"}`. Retain the returned session cookies in a private cookie jar.
3. `POST /api/authentication/token` with those cookies and the selected server's Origin. Only verified email account sessions qualify. The response contains `access_token`, `token_type: "Bearer"`, `expires_in` (seconds), and `scope: "artifacts"`.
4. Use `Authorization: Bearer <access_token>` on this server's `/api` requests. Do not put bearer secrets in URLs, documents or logs. On expiry, repeat email authentication; this flow does not issue refresh tokens. `POST /api/auth/sign-out` closes the temporary session without revoking the separately issued bearer.

The CLI has a separate authentication entry: `afbin auth` opens browser approval and may continue as a guest. A valid CLI capability can use HTTP internally; User-Agent or caller-provided headers do not determine whether a credential is allowed.

## Operations

- `GET /api/artifacts`: list accessible artifacts; follow returned opaque pagination cursors.
- `GET /api/artifacts/<id>`: read source, metadata and current version/state.
- `POST /api/artifacts`: create from a supported content field; for example `{"dataset":[{"name":"Example","value":2}],"title":"Example"}`.
- `PUT /api/artifacts/<id>`: update datasets/media conditionally. Include observed `expectedVersion` and `expectedState` with the new content. A 409 requires reconciliation.
- `POST /api/artifacts/<id>/prepare`: send complete edited JSX as `source` plus observed `edit_id` and `expectedVersion`; receive `document_update` without saving. Submit that exact update with its `edit_id` to `POST /api/artifacts/<id>/edits`. Preserve element IDs and reconcile a 409 rather than overwriting.
- Dataset policy changes use `GET /api/artifacts/<id>/policy` to observe `revision`, then a separate `PUT /api/artifacts/<id>/policy` with `policy` and `expectedPolicyRevision`; do not combine policy with content.
- Markup changes require a prepared `document_update` graph with observed reads/claims and stable node identity. Raw replacement markup does not replace that contract. Read [direct JSX authoring](http-authoring.md) and [the graph wire contract](http-document-graph.md) to prepare it without invoking the CLI.
- `GET/POST /api/artifacts/<id>/annotations`: read/create comments; document permissions still apply. Creation requires a body and node or quote anchor.
- `DELETE /api/artifacts/<id>`: move to trash.

Inspect non-success JSON and follow its recovery instructions. After an uncertain mutation, reconcile its receipt/current head before attempting another write.

## Browser preview and interactive QA

For browser QA, use `POST /api/browser-sessions`; no local Chrome is needed. Use your email bearer; the script navigates to an existing `artifactId`. Sessions default to your identity; `viewer` is fixed at creation. Scripts run for at most 20 seconds. HTTP 200 can still contain a failed receipt: check its error and accepted session/execution IDs before polling. A capacity refusal creates no session. For `SESSION_ACTOR_CAPACITY` or `SESSION_CAPACITY`, read the returned recovery message: close one of your named sessions when done, or wait before a bounded retry of creation. Never poll or close an ID whose creation was refused.

```js
const headers = {Authorization:'Bearer ' + accessToken,'Content-Type':'application/json'};
const call = async body => {const r=await fetch(base+'/api/browser-sessions',{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('HTTP '+r.status);const receipt=await r.json();if(receipt.error)throw Error(receipt.error.code+': '+receipt.error.message);return receipt};
const session_id=crypto.randomUUID(), execution_id=crypto.randomUUID();
let accepted=false;
try {
  const receipt=await call({op:'script',session_id,execution_id,create:true,code:`const page=await context.newPage();await page.goto('/a/${artifactId}');await page.getByRole('heading').first().waitFor();await output.image(await page.screenshot());`});
  if(receipt.session_id!==session_id||receipt.execution_id!==execution_id||!['queued','running','completed'].includes(receipt.status))throw Error('Session was not accepted');
  accepted=true;
  let s=receipt;
  for(let end=Date.now()+20000;['queued','running'].includes(s.status)&&Date.now()<end;){s=await call({op:'status',session_id,execution_id});if(!['queued','running'].includes(s.status))break;await new Promise(r=>setTimeout(r,250));}
  if(s?.status!=='completed')throw Error(s?.error?.code||s?.status||'timeout');
  // s.attachments[0].base64 is the PNG screenshot.
} finally {if(accepted)await call({op:'close',session_id});}
```

- A saved page action uses `POST /api/artifacts/<page-id>/mutate` with `{"name":"vote","args":{"choice":"ramen"}}`. The stored `<Mutation>` supplies its SQL and context; the API rechecks page access, dataset policy and any required membership. A public or unlisted link does not grant writes. Direct SQL against a dataset ID is a separate path and may return 403 even to its owner under the default policy. See [actions](markup-data.md#declarations-helmet-only) and [dataset rules](apps.md#dataset-rules).

## Comments: create, reply, resolve and reopen

Use the email bearer and document comment permission; guests cannot comment. `GET /api/artifacts/<id>/annotations?status=all` lists open and resolved threads as `{annotations,next_cursor}`; follow the cursor. Each thread has `id`, `revision`, `status` and `thread`.

Create with `POST /api/artifacts/<id>/annotations` and `{"body":"Please clarify this","node_id":"message"}`; `node_id` is a persistent ID in stored JSX. Or send a unique current `quote`. Creation accepts optional `range`, returns the thread (201), and needs no document `edit_id` or `expectedVersion`. Re-read source if an anchor is stale or ambiguous.

Reply or transition with **POST** `/api/artifacts/<id>/annotations/<annotation_id>` using the root ID and last `expected_revision`. Send `reply`, `resolve:true` or `reopen:true`; a reply may combine with one transition, never resolve and reopen together. Use each returned revision. A `409 annotation_conflict` includes `current_revision`; re-read and reconcile before retrying.

This executable example uses an existing `artifactId` and its `nodeId`, plus `base` and the private `accessToken` from email authentication:

```js
// BEGIN HTTP COMMENTS
const headers = {'Content-Type':'application/json', Authorization:'Bearer ' + accessToken};
const commentsPath = '/api/artifacts/' + artifactId + '/annotations';
async function commentRequest(path, body) {
  const response = await fetch(base + path, {method:'POST', headers, body:JSON.stringify(body)});
  if (!response.ok) throw Error(await response.text());
  return response.json();
}
const created = await commentRequest(commentsPath, {body:'Please clarify this', node_id:nodeId});
const threadPath = commentsPath + '/' + created.id;
const replied = await commentRequest(threadPath, {reply:'I have clarified it', expected_revision:created.revision});
const resolved = await commentRequest(threadPath, {resolve:true, expected_revision:replied.revision});
const reopened = await commentRequest(threadPath, {reopen:true, expected_revision:resolved.revision});
// END HTTP COMMENTS
```

An optional `Idempotency-Key` recovers an uncertain create/reply; retry with the same key and body. Comment actions do not need remote review headers. Comments are separate from JSX.

Local file and CLI commands do not call these endpoints. Publishing is explicit; HTTP requires access to the selected server.


For direct JSX creation, reservation and executable editing examples, read [HTTP authoring](http-authoring.md). The exact wire fields and concurrency obligations are in [document graphs](http-document-graph.md). All three HTTP guides are served together in `/llms.txt`.
