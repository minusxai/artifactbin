---
name: datasets
description: CSV import, dataset schema discovery, stable IDs and permission-aware GraphQL reads and writes.
---
## Read first

Create a dataset through the retained artifact API, then link it from the page. The native dataset namespace supports stored CSV/JSON rows with platform row identities. Connected PostgreSQL catalogs and SQL-backed tables are not supported by this namespace: page publication and replacement reject these links with HTTP 400 `dataset_stable_identity_unavailable` and a hint to import stored CSV/JSON rows. Schema discovery, reads and writes enforce the same stored-row requirement if a catalog changes later. Import stored rows for native pages. The separate retained PostgreSQL dataset query API remains read-only under its original permissions. Use an origin-bound bearer outside HTML:

```json
{"dataset":"week,completed,waiting\n2026-W01,18,7\n2026-W02,24,4\n2026-W03,21,3\n","title":"Repair bench sample","visibility":"unlisted","access":"readwrite"}
```

Send this JSON to `POST [[ base ]]/api/artifacts` with a durable `Idempotency-Key`; save its returned dataset `id`. `dataset` also accepts an array of row objects. `node scripts/publish.mjs rows.csv --type dataset --title T` does this (`.json`: a bare row array). These are sample figures, not measured results. Page source contains only the dataset reference:

```html
<link rel="af-dataset" data-af-name="repairs" href="ref:DATASET_ID" data-af-mode="live">
```

Replace `DATASET_ID` with the returned ID before publication. `data-af-name` is unique across dataset and backend links. `live` is the default: a historical page with a live binding continues reading live data. A pinned binding uses `data-af-mode="pinned" data-af-revision="2"`, where revision is a positive original dataset version. A pinned dataset is read-only. Keep the original dataset’s read/write policy; page readability grants no dataset writes.

## Discover before querying

Import `client,gql` from `@afbin/apollo`, then discover the namespace’s stable table/column IDs:

```js
const {data}=await client.query({query:gql`{
 repairs{schema{revision tables{id label source{truncated totalRows storedRows} columns{id label type nullable sourceType}}}}
}`});
```

Select tables and columns by their discovered labels for this task, then address them with the returned opaque IDs. Never hard-code a display label as a table or column ID. Dates/timestamps use STRING cells; `sourceType` preserves their source meaning.

Every schema table and rows/query result carries `source:{truncated,totalRows,storedRows}`. If `truncated` is true, chart totals cover only stored rows: label them as a stored sample, for example “10,000 of 10,003 source rows.” Result pagination and source truncation are independent; fetching every page cannot recover rows discarded during import. Normal complete datasets have matching total/stored counts.

The constant dataset schema exposes `rows(tableId,columnIds,filters,order,first,after)` and `writeRows(tableId,expectedRevision,requestId,changes)`. Use GraphQL variables:

```graphql
query Rows($table:ID!,$after:String){
 repairs{rows(tableId:$table,first:100,after:$after){
  revision source{truncated totalRows storedRows} columns{id label type nullable}
  rows{id cells{columnId value{type string number boolean json}}}
  pageInfo{hasNextPage endCursor}
 }}
}
```

`first` is 1–100. Follow `endCursor` until `hasNextPage:false`. Calculate totals or chart series only after collecting every page at the same revision; restart if the revision changes. Otherwise label the result as a partial page.

## Server queries and aggregates

For grouped charts or totals, use the namespace’s `query` field. It filters and aggregates the whole stored dataset before paginating the resulting rows. Source truncation still applies: aggregate totals never include discarded upload rows. It accepts `tableId`, `columnIds`, `filters`, `parameters`, `groupBy`, `aggregates`, `order`, `first` and `after`. Use discovered column IDs. An aggregate is `{id:"total",operation:SUM,columnId:"<amount column ID>"}`; operations are COUNT, SUM, AVG, MIN and MAX. COUNT without a column counts all filtered rows; with a column it counts non-null cells. SUM requires a numeric column. Its `id` becomes the output column ID; grouped source columns retain their IDs. Order by the resulting metric, for example `{columnId:"total",direction:DESC}`. Read the same typed Rows result and follow its output cursor as needed.

Filters may reference a named parameter: `{columnId:"<amount ID>",operator:GTE,parameter:"minimum"}`, paired with `parameters:[{name:"minimum",value:{type:NUMBER,number:0}}]`. Parameter values are typed cells, never SQL strings. No arbitrary SQL endpoint exists. Use schema discovery to inspect available input enums before constructing a new operation.

CSV import infers ordinary numeric values. To preserve exact lexical values such as identifiers or high-precision quantities, supply top-level `columns:[{name:"amount",type:"string"}]` with the dataset create request; an explicit `type:"number"` requests numeric conversion and can round.

## Typed cells and writes

Cell values carry one matching slot: `{type:"STRING",string:"oak"}`, `{type:"NUMBER",number:12}`, `{type:"BOOLEAN",boolean:true}` or `{type:"JSON",json:{...}}`. A typed null uses the matching slot set to null. Stable `row.id` is separate from cell values.

`changes` accepts up to 100 INSERT, UPDATE or DELETE items atomically:

```json
{"kind":"UPDATE","rowId":"<stable row ID>","cells":[{"columnId":"<stable column ID>","value":{"type":"NUMBER","number":13}}]}
```

INSERT supplies cells; DELETE supplies rowId. Send the observed dataset revision as `expectedRevision` and keep one nonempty `requestId` for that intended mutation. Receipts return `outcome` (`committed`, `rejected` or `unknown`), `revision` and `rowIds`. Only committed is success. Reconcile conflicts or unknown results before another write. Dataset permission is checked for every write; a page link does not bypass it.

See the installed CSV dashboard example for discovery, pagination, revision consistency and a chart computed from typed cells.

CSV empty-cell rules: an unquoted empty field (or a missing trailing field) becomes null. A quoted empty field (`""`) is an empty string and keeps its column textual by default, including when other rows look numeric. Literal `null`/`NULL` remain text. An explicit non-string column type overrides inference and converts empty text to null; declare `type:"string"` to preserve it.

## Files attached to a dataset

The retained media HTTP doors accept files for a stored dataset declared by a live native page binding. A page link or accepted page membership never grants upload permission: the caller needs explicit dataset insert authority (a caller or group insert grant, or dataset editor authority on a writable dataset). Private dataset reads still require current dataset and page readership. Pinned bindings cannot upload.

For signed-in browser image uploads use `POST /a/PAGE_ID/datasets/DATASET_ID/images` with the image bytes and image Content-Type. HTTP agents can upload images through the generic file door using an image filename. For generic files use `POST /api/artifacts/PAGE_ID/datasets/DATASET_ID/files`, the file bytes and Content-Type, plus an `X-Filename` containing the percent-encoded filename. Both require `X-Edit-Id` from the observed page head and a unique `Idempotency-Key`; replay the identical bytes and key after an uncertain response. Requests use supported HTTP account authentication, never a token embedded in page HTML. The response returns the stored ref and read URL; read that URL under the same current permissions. Revoked upload permission refuses even a cached replay. File and image size, type, count and stored-byte limits still apply. These are HTTP media uploads, not GraphQL mutations.
