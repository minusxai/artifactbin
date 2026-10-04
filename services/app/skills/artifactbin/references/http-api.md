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

The CLI has a separate authentication entry: `npx --yes @artifactbin/cli@latest auth` opens browser approval and may continue as a guest. On Windows use `npx.cmd`. A valid CLI capability can use HTTP internally; User-Agent or caller-provided headers do not determine whether a credential is allowed.

## Operations

- `GET /api/artifacts`: list accessible artifacts; follow returned opaque pagination cursors.
- `GET /api/artifacts/<id>`: read source, metadata and current version/state.
- `POST /api/artifacts`: create from a supported content field; for example `{"csv":"name,value\nExample,2","title":"Example"}`.
- `PUT /api/artifacts/<id>`: update datasets/media conditionally. Include observed `expectedVersion` and `expectedState` with the new content. A 409 requires reconciliation.
- Markup changes require a prepared `document_update` graph with observed reads/claims and stable node identity. Raw replacement markup does not replace that contract. The direct JSON protocol and executable example below show how to prepare it without invoking the CLI.
- `GET/POST /api/artifacts/<id>/annotations`: read/create comments; document permissions still apply. Creation requires a body and node or quote anchor.
- `DELETE /api/artifacts/<id>`: move to trash.

Inspect non-success JSON and follow its recovery instructions. After an uncertain mutation, reconcile its receipt/current head before attempting another write.

Local preview, comments, import and export use your files without these remote endpoints. Downloaded `.jsx.html` edits stay local. Publishing is an explicit remote operation. Before disconnecting, prepare the npm package cache and required browser assets; the HTTP API itself requires access to the selected server.

## Direct JSX creation and graph editing

The HTTP API accepts the same JSX creation and prepared editing contracts used by the browser and CLI. HTTP clients can produce these JSON bodies themselves; no CLI invocation or installation is required. This section is also served in `/llms.txt`.

For a new document, `POST /api/artifacts` with `{"markup":"<p id=\"message\">Alpha</p>","title":"HTTP example","visibility":"unlisted"}`. Give every body element a persistent `id`; preserve it when editing/moving that element. Creation validates JSX and returns its artifact identity/URL. To allocate identities before creation, `POST /api/artifacts/reservations` with `Idempotency-Key: http_authoring_batch_001` and `{}` returns 100 IDs. Reuse that nonce for pool replay, and send one unconsumed ID as `reserved_id` in the create body, with a separate create `Idempotency-Key`. These are artifact IDs, distinct from element IDs and graph node keys. Reuse the exact create body/key after an uncertain response; do not allocate another identity blindly. `X-Artifactbin-Account`, when pinning a workspace, must be the account observed on this server's authenticated response.

Read `GET /api/artifacts/<id>` before editing. Read its `markup` source and keep its `document` (schema 3 graph), `version` and `edit_id`; source alone does not contain the concurrency/identity facts. `document.nodes` is keyed by opaque graph keys; `$root` owns the ordered top-level `children`. Each node has an encoded own `ast`, ordered child graph keys and `parts` interleaved around the children. Its own `units`/`partUnits` count UTF-16 code units; `bytes` counts UTF-8 bytes. `subtreeUnits` includes descendants. `selfVersion`, `childrenVersion` and `subtreeVersion` are revision facets. `selectors` contains facts such as `id:message`; `claimedIds` remembers every body-element ID ever claimed, including retired IDs. Do not reuse retired IDs for different elements.

Submit `POST /api/artifacts/<id>/edits` with `{"edit_id":"<observed edit_id>","document_update":{...}}`. `document_update.schema` is 1:

| Field | Required meaning |
| --- | --- |
| `patch.baseVersion` | Observed artifact version. |
| `patch.reads` | Every graph fact on which validation/operation depends: `{key,facet,version}` using the actual observed facet revision, not the artifact version. |
| `patch.selections` | Selector results the operation depended on, e.g. `{selector:"id:message",keys:["<observed paragraph key>"]}`. Preserve the sorted observed keys. |
| `patch.updated` | Map graph keys to `{patches,self,children}`. JSON paths are arrays of strings, relative to that node; patch kinds are `set`, `insert`, `delete`, or `text` (UTF-16 `start`/`deleteCount`). Own-field paths can start with `ast`, `selectors`, `refs`, `parent`, `children`, `parts`, `bytes`, `units`, `partUnits`, or `prose`. Never write revision/aggregate fields as own-field patches. |
| `patch.inserted` / `removed` | New complete graph-node records keyed by fresh internal keys / removed graph keys. Preserve parent-child links, serialized own parts, selectors/references, counts and child order. |
| `patch.touched` | Changed nodes and their surviving ancestors whose subtree revisions advance. |
| `patch.byteDelta` / `unitDeltas` | Total UTF-8 byte change / per-node subtree UTF-16 length deltas, including ancestors. |
| `patch.claims` | Newly introduced body-element IDs with their observed `claimedIds[id]` revision, or `null` if never claimed. Retain IDs for the same element; do not recycle IDs from deleted elements. A text-only edit has no new claims. |
| `effects` | `{css,references}`: true only when the corresponding classes/design inputs or reference bindings change, invalidating derived caches. |

The commit checks permissions and these dependencies atomically. A conflicting read, selection or claim returns 409 without partial writes. Independent changes may succeed from an older base; do not guess revisions or omit dependencies to force an edit through. On 409, read again and rebuild the proposed change against the new snapshot.

Here is a complete wire-body builder for an inert paragraph's single plain-text child. It changes text while preserving element and graph identity, and computes both UTF-8 and UTF-16 deltas. Its restrictions deliberately exclude JSX syntax/entities, structural edits and compiler-dependent nodes. The actual endpoint test executes this exact block with a real email-authenticated bearer; it also proves stale replay is refused.

```js
// BEGIN HTTP TEXT EDIT
function buildPlainTextUpdate(snapshot, nodeId, before, after) {
  const graph = snapshot.document;
  if (graph?.schema !== 3 || graph.kind !== 'graph') throw Error('Read a graph snapshot first');
  if (/[<>{}&\u0000]/.test(after) || !after.isWellFormed()) throw Error('This example only edits inert plain text');
  const selected = Object.entries(graph.nodes)
    .filter(([, node]) => node.selectors.includes('id:' + nodeId))
    .map(([key]) => key).sort();
  if (selected.length !== 1) throw Error('Expected one persistent element ID');
  const parent = graph.nodes[selected[0]];
  if (parent.children.length !== 1) throw Error('Expected one plain-text child');
  const key = parent.children[0], node = graph.nodes[key];
  if (!node.prose || node.children.length || node.ast?.roots[0]?.type !== 'text'
      || node.ast.roots[0].value !== before || node.parts.length !== 1
      || node.parts[0] !== before) throw Error('Observed text does not match');
  const touched = [key], reads = [
    {key, facet:'subtreeVersion', version:node.subtreeVersion},
    {key:selected[0], facet:'childrenVersion', version:parent.childrenVersion}
  ];
  let ancestor = node.parent;
  while (ancestor !== null) {
    if (touched.includes(ancestor) || !graph.nodes[ancestor]) throw Error('Invalid ancestor chain');
    touched.push(ancestor);
    reads.push({key:ancestor, facet:'selfVersion', version:graph.nodes[ancestor].selfVersion});
    ancestor = graph.nodes[ancestor].parent;
  }
  const delta = after.length - before.length;
  const bytes = new TextEncoder().encode(after).length;
  return {
    schema:1,
    patch:{
      baseVersion:snapshot.version, reads,
      selections:[{selector:'id:' + nodeId, keys:selected}],
      inserted:{}, removed:[], claims:[], touched,
      byteDelta:bytes - node.bytes,
      unitDeltas:delta ? Object.fromEntries(touched.map(key => [key, delta])) : {},
      updated:{[key]:{self:true, children:false, patches:[
        {kind:'set', path:['ast','roots','0','value'], value:after},
        {kind:'set', path:['parts','0'], value:after},
        {kind:'set', path:['partUnits','0'], value:after.length},
        {kind:'set', path:['units'], value:after.length},
        {kind:'set', path:['bytes'], value:bytes}
      ]}}
    },
    effects:{css:false, references:false}
  };
}
// END HTTP TEXT EDIT
```

After creating the example paragraph, this uses only standard HTTP/fetch and JSON, with no afbin imports:

```js
const headers = {'Content-Type':'application/json', Authorization:'Bearer ' + accessToken};
const snapshot = await (await fetch(base + '/api/artifacts/' + artifactId, {headers})).json();
const document_update = buildPlainTextUpdate(snapshot, 'message', 'Alpha', 'Updated HTTP text');
const prepared = await fetch(base + '/api/artifacts/' + artifactId + '/prepare', {
  method:'POST', headers, body:JSON.stringify({source:'<p id="message">Updated HTTP text</p>'})
});
if (!prepared.ok) throw Error(await prepared.text());
const resources = await prepared.json();
if (resources.datasetBindings) document_update.datasetBindings = resources.datasetBindings;
const edited = await fetch(base + '/api/artifacts/' + artifactId + '/edits', {
  method:'POST', headers, body:JSON.stringify({edit_id:snapshot.edit_id, document_update})
});
if (!edited.ok) throw Error(await edited.text());
```

For arbitrary JSX, prepare the full final candidate on the client: parse/normalize/stamp stable IDs, validate the composite markup and dependencies, derive its graph and exact patch/read/selector/claim set. `POST /api/artifacts/<id>/prepare` with `{"source":"<complete candidate JSX>"}` validates authoring context (references, SQL, icons/fonts) and returns `{valid:true,datasetBindings?}`. Attach returned dataset bindings to the update; the commit rechecks their ownership and revisions. This endpoint neither edits the target nor turns raw source into a graph patch. The source implementation of this protocol is `prepareClientDocumentPublication` in `services/app/lib/story/graph/document-update-client.ts`, with wire types in `services/contracts/src/document-update.ts`; HTTP clients may implement the contract in any language.

For an intentional whole replacement, the same update has `whole:true`, a full `replacement` schema-3 graph and the observed base version; include the `$root` subtree dependency and use current IDs for surviving elements. Whole replacements consume the observed head and do not merge silently. Moves retain element IDs and internal graph keys; insertion uses fresh keys and claims unused element IDs. Annotation remapping requires `annotationOps` with exact observed text maps; sharing/parent changes require their observed revisions/parent IDs. Do not hand-wave these dependencies for a more complex edit.
