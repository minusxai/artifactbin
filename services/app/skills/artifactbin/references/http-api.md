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
- Dataset policy changes use `GET /api/artifacts/<id>/policy` to observe `policy_revision`, then a separate `PUT /api/artifacts/<id>/policy` with `policy` and `expectedPolicyRevision`; do not combine policy with content.
- Markup changes require a prepared `document_update` graph with observed reads/claims and stable node identity. Raw replacement markup does not replace that contract. Read [direct JSX authoring](http-authoring.md) and [the graph wire contract](http-document-graph.md) to prepare it without invoking the CLI.
- `GET/POST /api/artifacts/<id>/annotations`: read/create comments; document permissions still apply. Creation requires a body and node or quote anchor.
- `DELETE /api/artifacts/<id>`: move to trash.

Inspect non-success JSON and follow its recovery instructions. After an uncertain mutation, reconcile its receipt/current head before attempting another write.

## Comments: create, reply, resolve and reopen

Use the email-authenticated bearer above, with permission to comment on the document; guest credentials cannot comment. Read `GET /api/artifacts/<id>` for its open annotations, or `GET /api/artifacts/<id>/annotations?status=all` for open and resolved threads. Listings return `{annotations,next_cursor}`; follow `next_cursor` with the same filters. Each root thread has `id`, `revision`, `status` and `thread` (its comments).

Create with `POST /api/artifacts/<id>/annotations` and `{"body":"Please clarify this","node_id":"message"}`. `node_id` is an existing persistent element ID in the stored JSX, not a graph key. Alternatively send `{"body":"Please clarify this","quote":"unique text from the document"}`; the quote must identify one current anchor. Creation accepts `body`, `node_id`, `quote` and optional `range`; it returns the created thread (201). It does not require document `edit_id` or `expectedVersion` fields. A stale or ambiguous anchor requires reading the current source and choosing a valid node/unique quote again.

Reply or change state with **POST** `/api/artifacts/<id>/annotations/<annotation_id>` (the root thread's ID): `{"reply":"Done","expected_revision":2}`, `{"resolve":true,"expected_revision":2}`, or `{"reopen":true,"expected_revision":2}`. You can combine a reply with one transition, for example `{"reply":"Fixed","resolve":true,"expected_revision":2}`. Never combine resolve and reopen. Each successful response is the updated thread; use its returned revision for the next action. `expected_revision` is optional in the wire contract, but send the last observed thread revision to prevent stale actions. It is a conversation fence, not the document version. A `409 annotation_conflict` includes `current_revision`; re-read the conversation and reconcile before retrying. No reply or state transition was applied.

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

For creation or thread actions, an optional `Idempotency-Key` makes retries of the exact same request recover its receipt; keep the key and body unchanged after an uncertain response, rather than creating a duplicate comment/reply. Ordinary comment actions do not need remote review `request_id`, `phase` or remote session/proof headers. Comments are stored separately from JSX and do not replace document source.

Local preview, comments, import and export use your files without these remote endpoints. Downloaded `.jsx.html` edits stay local. Publishing is an explicit remote operation. Before disconnecting, prepare the npm package cache and required browser assets; the HTTP API itself requires access to the selected server.


For direct JSX creation, reservation and executable editing examples, read [HTTP authoring](http-authoring.md). The exact wire fields and concurrency obligations are in [document graphs](http-document-graph.md). All three HTTP guides are served together in `/llms.txt`.
