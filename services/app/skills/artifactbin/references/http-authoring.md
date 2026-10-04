---
title: Direct HTTP JSX authoring
description: Direct JSX creation, artifact ID reservations and an executable graph-edit example without invoking the CLI.
---
## Direct JSX creation and graph editing

The HTTP API accepts the same JSX creation and prepared editing contracts used by the browser and CLI. HTTP clients can produce these JSON bodies themselves; no CLI invocation or installation is required. This section is also served in `/llms.txt`.

For a new document, `POST /api/artifacts` with `{"markup":"<p id=\"message\">Alpha</p>","title":"HTTP example","visibility":"unlisted"}`. Give every body element a persistent `id`; preserve it when editing/moving that element. Creation validates JSX and returns its artifact identity/URL. To allocate identities before creation, `POST /api/artifacts/reservations` with `Idempotency-Key: http_authoring_batch_001` and `{}` returns 100 IDs. Reuse that nonce for pool replay, and send one unconsumed ID as `reserved_id` in the create body, with a separate create `Idempotency-Key`. These are artifact IDs, distinct from element IDs and graph node keys. Reuse the exact create body/key after an uncertain response; do not allocate another identity blindly. `X-Artifactbin-Account`, when pinning a workspace, must be the account observed on this server's authenticated response.

Read [the graph wire contract](http-document-graph.md) before deriving a patch. The example below preserves its observed revisions and identity; full guide contents are also served together in `/llms.txt`.

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
