---
title: Direct HTTP JSX authoring
description: Direct JSX creation, artifact ID reservations and an executable graph-edit example without invoking the CLI.
---
## Direct JSX creation and graph editing

HTTP supports JSX creation and prepared edits without CLI installation; this guide is in `/llms.txt`.

See [JSX markup](markup.md), [data and actions](markup-data.md), [design systems](design-systems.md) and [templates](templates.md). Use each link target as served; `.md` appears in source labels, while public guide URLs are extensionless.

[[ urlReplyRule ]] [[ phoneAuthoringRule ]] [[ progressiveAuthoringRule ]] Batch independent reads and edits; reserve time for one final response. After required checks pass, do not repeat unchanged QA. For DOM probes, use `page.evaluate`. See the [copyable HTTP browser QA example](http-api.md#browser-preview-and-interactive-qa); reuse it instead of rebuilding the session client.

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


Read [the graph wire contract](http-document-graph.md) before deriving patches; it is also served in `/llms.txt`.

This builder edits an inert paragraph's single plain-text child, preserving IDs and computing UTF-8/UTF-16 deltas. It excludes JSX syntax/entities, structural edits and compiler-dependent nodes. Endpoint tests execute this block and reject stale replay.

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
  const parentKey = selected[0], parent = graph.nodes[parentKey];
  if (parent.children.length !== 1) throw Error('Expected one plain-text child');
  const key = parent.children[0], node = graph.nodes[key];
  if (!node.prose || node.children.length || node.ast?.roots[0]?.type !== 'text'
      || node.ast.roots[0].value !== before || node.parts.length !== 1
      || node.parts[0] !== before) throw Error('Observed text does not match');
  const touched = [key], reads = [
    {key, facet:'subtreeVersion', version:node.subtreeVersion},
    {key:parentKey, facet:'childrenVersion', version:parent.childrenVersion}
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

Apply it with standard fetch/JSON:

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
