---
name: html-datasets
description: CSV import, dataset schema discovery, stable IDs and permission-aware GraphQL reads and writes.
---
## Read first

Create a dataset through the retained artifact API, then link it from the page. Use an origin-bound bearer outside HTML:

```json
{"dataset":"week,completed,waiting\n2026-W01,18,7\n2026-W02,24,4\n2026-W03,21,3\n","title":"Repair bench sample","visibility":"unlisted","access":"readwrite"}
```

Send this JSON to `POST [[ base ]]/api/artifacts` with a durable `Idempotency-Key`; save its returned dataset `id`. `dataset` also accepts an array of row objects. These are sample figures, not measured results. Page source contains only the dataset reference:

```html
<link rel="af-dataset" data-af-name="repairs" href="ref:DATASET_ID" data-af-mode="live">
```

Replace `DATASET_ID` with the returned ID before publication. `data-af-name` is unique across dataset and backend links. `live` is the default: a historical page with a live binding continues reading live data. A pinned binding uses `data-af-mode="pinned" data-af-revision="2"`, where revision is a positive original dataset version. A pinned dataset is read-only. Keep the original dataset’s read/write policy; page readability grants no dataset writes.

## Discover before querying

Import `client,gql` from `@afbin/apollo`, then discover the namespace’s stable table/column IDs:

```js
const {data}=await client.query({query:gql`{
 repairs{schema{revision tables{id label columns{id label type nullable sourceType}}}}
}`});
```

Select tables and columns by their discovered labels for this task, then address them with the returned opaque IDs. Never hard-code a display label as a table or column ID. Dates/timestamps use STRING cells; `sourceType` preserves their source meaning.

The constant dataset schema exposes `rows(tableId,columnIds,filters,order,first,after)` and `writeRows(tableId,expectedRevision,requestId,changes)`. Use GraphQL variables:

```graphql
query Rows($table:ID!,$after:String){
 repairs{rows(tableId:$table,first:100,after:$after){
  revision columns{id label type nullable}
  rows{id cells{columnId value{type string number boolean json}}}
  pageInfo{hasNextPage endCursor}
 }}
}
```

`first` is 1–100. Follow `endCursor` until `hasNextPage:false`. Calculate totals or chart series only after collecting every page at the same revision; restart if the revision changes. Otherwise label the result as a partial page. Do not invent a raw-SQL or aggregate endpoint.

## Typed cells and writes

Cell values carry one matching slot: `{type:"STRING",string:"oak"}`, `{type:"NUMBER",number:12}`, `{type:"BOOLEAN",boolean:true}` or `{type:"JSON",json:{...}}`. A typed null uses the matching slot set to null. Stable `row.id` is separate from cell values.

`changes` accepts up to 100 INSERT, UPDATE or DELETE items atomically:

```json
{"kind":"UPDATE","rowId":"<stable row ID>","cells":[{"columnId":"<stable column ID>","value":{"type":"NUMBER","number":13}}]}
```

INSERT supplies cells; DELETE supplies rowId. Send the observed dataset revision as `expectedRevision` and keep one nonempty `requestId` for that intended mutation. Receipts return `outcome` (`committed`, `rejected` or `unknown`), `revision` and `rowIds`. Only committed is success. Reconcile conflicts or unknown results before another write. Dataset permission is checked for every write; a page link does not bypass it.

See the installed CSV dashboard example for discovery, pagination, revision consistency and a chart computed from typed cells.
