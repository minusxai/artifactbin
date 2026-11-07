---
name: datasets
description: CSV and JSON datasets, linking them into pages and the generated GraphQL API for reads, aggregates and writes.
---
## Read first

A dataset is stored CSV or JSON rows. Create it, link it from a page, then query its generated
GraphQL API (Hasura's shape). `node scripts/publish.mjs rows.csv --type dataset --title T` creates one
(`.json`: a bare array of row objects); save the returned `id`. Direct HTTP: `POST [[ base ]]/api/artifacts`
with a durable `Idempotency-Key` and an origin-bound bearer, never from page HTML:

```json
{"dataset":"week,completed,waiting\n2026-W01,18,7\n2026-W02,24,4\n","title":"Repair bench sample","visibility":"unlisted"}
```

These are sample figures. A dataset needs at least one data row. New datasets are readable by
anyone who can open them; only the owner and editors change rows. To let readers add or edit rows,
set rules: [permissions](permissions.md). To read your own Postgres or MySQL database, use a
resolver ([`caps.db`](resolvers.md#capsdb-your-own-database)).

```html
<link rel="af-dataset" data-af-name="orders" href="ref:DATASET_ID">
```

`data-af-name` is unique across a page's links. Live is the
default; `data-af-mode="pinned" data-af-revision="2"` freezes one saved version and is read-only.

## Contents

[Names](#names-discover-before-querying) · [Read](#read) · [Write](#write) · [Live](#live-views) · [Type together](#type-together-afbincollab) · [CSV](#csv-import) · [Files](#files-attached-to-a-dataset)

## Names: discover before querying

`node scripts/graphql.mjs schema PAGE_ID` (or `DATASET_ID`) prints the exact SDL your role sees, and
for a dataset your role. In a page the root is the link's `data-af-name` (`orders`); queried directly
it comes from the title (or `data`); `publish.mjs` `--name orders` (create body `name`) fixes it at
creation, and it never changes afterwards. A column keeps its name when it is a valid GraphQL name;
otherwise it is lower-cased with `_` for other characters (`Created By` → `created_by`). Every row
has `_id: ID!`, the stable row ID (a CSV `id` column stays ordinary). Types: number → `Float`,
boolean → `Boolean`, text, dates and user IDs → `String`; every column is nullable.

## Read

Import `client,gql` from `@afbin/apollo`:

```js
const {data,errors}=await client.query({query:gql`query West($r:String!){
 orders(where:{region:{_eq:$r}},order_by:{date:desc},limit:50){_id date region amount}
 orders_aggregate(where:{region:{_eq:$r}}){aggregate{count sum{amount} avg{amount}}}
}`,variables:{r:'West'}});
if(errors?.length)throw Error(errors[0].message);
```

- `orders(where,order_by,limit,offset)`: `limit` defaults to 100, at most 1000; `_id` is always the
  last sort key, so `offset` paging is stable. Read pages until one is shorter than `limit`.
- `orders_by_pk(_id:ID!)` returns null when the row is missing or hidden from you.
- `orders_can{insert}` and a row's `_can{update delete}` say what you may change
  ([permissions](permissions.md#what-this-viewer-may-change)): show only those controls.
- `orders_aggregate{aggregate{count(columns,distinct) sum avg min max} nodes}` takes the same
  arguments; it exists only when your rule allows aggregations. For GROUP BY, joins or window
  functions, read the rows with SQL in a resolver ([`caps.sql`](resolvers.md#capssql-read-only-sql)).
- `where`: `_and _or _not`; per column `_eq _neq _gt _gte _lt _lte _in _nin _is_null`, plus
  `_like _ilike _nlike _nilike` on strings. `order_by`: `asc desc` and their `_nulls_first`/`_last`.

Every number a page shows comes from the rows, read in page script: typed-in numbers go stale.
Totals and charts need every row: read all pages first, or use `orders_aggregate`.

## Write

```graphql
mutation Add($o:orders_insert_input!){insert_orders_one(object:$o){_id amount}}
mutation Fix($id:ID!){update_orders_by_pk(pk_columns:{_id:$id},_set:{amount:13}){_id amount}}
mutation Bump($id:ID!){update_orders(where:{_id:{_eq:$id}},_inc:{votes:1}){affected_rows}}
mutation Drop($id:ID!){delete_orders_by_pk(_id:$id){_id}}
```

`insert_orders(objects)` takes up to 100 rows; `update_`/`delete_orders(where)` return
`affected_rows`. One mutation operation is atomic, writes one dataset and changes at most 100 rows.
It applies to the current rows: for compare-and-set put the old values in `where` and treat
`affected_rows:0` as "changed meanwhile". There is no upsert: read the row, then `update_…_by_pk`
or `insert_…_one`. `_id` is generated and never set. Returned rows need a select rule.

`client.mutate` sends one `Idempotency-Key` per call, so a retried request applies once.
`graphql.mjs mutate DATASET_ID --document m.graphql` prints its `idempotencyKey`; after exit 5
(unknown outcome) repeat with `--idempotency-key KEY` (it applies at most once). Errors carry
`extensions.code`: `permission_denied`, `check_violation`, `validation_failed`, `too_many_rows`,
`one_dataset_per_mutation`, `outcome_unknown`, `dataset_not_found`. Only the owner and editors write
until [permissions](permissions.md) allow more; a page link never grants writes.

## Live views

`client.watchQuery({query}).subscribe(...)` refetches after committed writes and when the dataset
changes; `onResolverChange(names=>…)` from `@afbin/apollo` names changed links. Use these rather
than polling. The installed `examples/csv-dashboard.html` reads every page and charts it;
`examples/shared-app.html` writes through a resolver ([resolvers](resolvers.md));
`examples/shared-list.html` writes rows directly and draws its controls from `_can`.

## Type together (`@afbin/collab`)

Bind a text cell to an `<input>` or `<textarea>`: everyone allowed to change it types in it live
(Google Docs style, no typing lost); reads, exports and history still see a plain string.

```js
import {collab} from '@afbin/collab';
const text=collab.text('tasks',row._id,'description'); // link name, row _id, field
const binding=text.bind(textarea); // two-way, caret kept, IME-safe
text.on('change',value=>…); text.status; // 'synced'|'pending'|'offline'|'readonly'
text.on('error',({reason,message,unsaved})=>…); // why editing ended; text that was not saved
binding.destroy(); text.destroy();
```

The owner opts each text column in with the policy's table key `"collaborative_columns":["description"]`
([permissions](permissions.md)); other columns never open. Who may type is the update rule for that row
and column (a check.mjs browser types as its viewer); everyone else (and anyone signed out, or a downloaded copy) gets `readonly`: set the field to
the value you read before `bind`. Keys typed before the live session starts are kept and merged in.
Typing is saved as one dataset version when someone leaves or after a quiet spell; a GraphQL write
meanwhile is merged with the typing. A deleted row, or text the update rule's `check` refuses, ends
editing: the field turns read-only and `error` says why (`removed`, `check_violation`, `rejected`).

## CSV import

Numbers are inferred. To keep exact text (IDs, long decimals), send
`columns:[{name:"amount",type:"string"}]` with the create request; `type:"number"` converts and can
round. An unquoted empty field becomes null; a quoted `""` is an empty string and keeps the column
textual; literal `null` stays text.

## Files attached to a dataset

A live page binding may upload files to its dataset when the caller may insert rows. Signed-in
browser images: `POST /a/PAGE_ID/datasets/DATASET_ID/images` with the bytes and image Content-Type.
Other files: `POST /api/artifacts/PAGE_ID/datasets/DATASET_ID/files` with the bytes, Content-Type and
a percent-encoded `X-Filename`. Both need `X-Edit-Id` from the page head and a unique
`Idempotency-Key` (replay the same bytes and key after an uncertain response). The response returns
the stored ref and a read URL under the same permissions. Pinned bindings cannot upload.
