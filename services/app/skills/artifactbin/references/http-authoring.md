---
title: Direct HTTP JSX authoring
description: Direct JSX creation, artifact ID reservations and an executable graph-edit example without invoking the CLI.
---
## Direct JSX creation and graph editing

HTTP supports JSX creation and prepared edits without CLI installation; this guide is in `/llms.txt`.

See [JSX markup](markup.md), [data and actions](markup-data.md), [design systems](design-systems.md) and [templates](templates.md). Use each link target as served; `.md` appears in source labels, while public guide URLs are extensionless.

[[ urlReplyRule ]] [[ phoneAuthoringRule ]] Batch independent reads and edits; reserve time for one final response. After required checks pass, do not repeat unchanged QA. For DOM probes, use `page.evaluate`. See the [copyable HTTP browser QA example](http-api.md#browser-preview-and-interactive-qa); reuse it instead of rebuilding the session client.

For a new document, `POST /api/artifacts` with `{"markup":"<p id=\"message\">Alpha</p>","title":"HTTP example","visibility":"unlisted"}`. Give every body element a persistent `id`; preserve it when editing/moving that element. Creation validates JSX and returns its artifact identity/URL. To allocate identities before creation, `POST /api/artifacts/reservations` with `Idempotency-Key: http_authoring_batch_001` and `{}` returns 100 IDs. Reuse that nonce for pool replay, and send one unconsumed ID as `reserved_id` in the create body, with a separate create `Idempotency-Key`. These are artifact IDs, distinct from element IDs and graph node keys. Reuse the exact create body/key after an uncertain response; do not allocate another identity blindly. `X-Artifactbin-Account`, when pinning a workspace, must be the account observed on this server's authenticated response.

For `<script type="server">`, see [server handlers and runs](lambdas.md): publish JSX, invoke `POST /api/artifacts/:id/runs`, read `/api/runs/:runId` status/events. No CLI is needed.

## Prepare an edit from JSX

For ordinary JSX edits, read the original, edit its `markup` preserving element IDs, prepare the complete source against the observed head, then submit the returned update unchanged. Preparation reuses the browser/CLI compiler without saving. No CLI, bundled code or manual graph construction is needed.

```js
// BEGIN HTTP SOURCE EDIT
const headers = {'Content-Type':'application/json', Authorization:'Bearer ' + accessToken};
async function jsonRequest(path, method = 'GET', body) {
  const response = await fetch(base + path, {method, headers,
    ...(body === undefined ? {} : {body:JSON.stringify(body)})});
  if (!response.ok) throw Error(await response.text());
  return response.json();
}
const path = '/api/artifacts/' + artifactId;
const snapshot = await jsonRequest(path);
const source = snapshot.markup.replace('Alpha', 'Updated HTTP text');
const prepared = await jsonRequest(path + '/prepare', 'POST', {
  source, edit_id:snapshot.edit_id, expectedVersion:snapshot.version,
  metadata:{title:'Updated HTTP example'}
});
const edited = await jsonRequest(path + '/edits', 'POST', {
  edit_id:prepared.edit_id, document_update:prepared.document_update
});
// END HTTP SOURCE EDIT
```

A preparation request must include both `edit_id` and `expectedVersion` from the same read. Stale observations return `409 doc_changed`; read again and reconcile your intended changes with the current source. Do not silently overwrite. Once prepared, `/edits` independently checks permissions and graph dependencies: independent changes can merge, overlapping changes return 409. Invalid JSX, references or SQL return a validation error before any edit is applied. Optional `metadata` accepts only title, description, theme, template and colorMode. Sharing and dataset policy are separate operations.

A source-only `/prepare` request remains a validation-only authoring-context API for clients that already construct their own updates; it returns `{valid:true,datasetBindings?}` without a `document_update`.

## Advanced graph editing

For graph patches, read the [document graph wire contract](http-document-graph.md). Ordinary JSX changes should use the source preparation flow above; this guide does not duplicate the graph client. Graph clients must preserve observed IDs, versions, read dependencies, claims and annotation mappings as defined by that contract.
