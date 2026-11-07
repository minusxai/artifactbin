---
name: datasets
description: CSV and JSON datasets, linking them into pages, the generated GraphQL API for rows and writes, and read-only `_sql` for totals and joins.
---
## Read first

A dataset is stored CSV or JSON rows. Create it, link it from a page, then query its generated
GraphQL API (Hasura's shape). `node scripts/publish.mjs rows.csv --type dataset --title T` creates one
(`.json`: a bare array of row objects); save the returned `id`. Direct HTTP: `POST [[ base ]]/api/artifacts`
with a durable `Idempotency-Key` and an origin-bound bearer, never from page HTML:

```json
{"dataset":"week,completed,waiting\n2026-W01,18,7\n2026-W02,24,4\n","title":"Repair bench sample","visibility":"unlisted"}
```

A dataset needs at least one data row. New datasets are readable by anyone who can
open them; only the owner and editors change rows. To let readers add or edit rows,
set rules: [permissions](permissions.md). To read your own Postgres or MySQL database, use a
resolver ([`caps.db`](resolvers.md#capsdb-your-own-database)).

```html
<link rel="af-dataset" data-af-name="orders" href="ref:DATASET_ID">
```

`data-af-name` is unique per page. Live is the default; `data-af-mode="pinned" data-af-revision="2"` freezes one saved version and is read-only.

## Contents

[Names](#names-discover-before-querying) · [Read](#read) · [Totals: `_sql`](#totals-group-by-and-joins-_sql) · [Write](#write) · [Live](#live-views) · [Type together](#type-together-afbincollab) · [CSV](#csv-import) · [Files](#files-attached-to-a-dataset)

## Names: discover before querying

`node scripts/graphql.mjs schema PAGE_ID` (or `DATASET_ID`) prints the SDL (and role) you get. In a
page the root is the link's `data-af-name` (`orders`); queried directly it is the file's name
(`orders.csv` → `orders`) unless `publish.mjs --name` set one. A column keeps its name when it is a valid GraphQL name;
otherwise it is lower-cased with `_` for other characters (`Created By` → `created_by`). Every row
has `_id: ID!`, the stable row ID (a CSV `id` column stays ordinary). Types: number → `Float`,
boolean → `Boolean`, text, dates and user IDs → `String`; every column is nullable.

## Read

GraphQL reads and writes ROWS; anything computed (counts, totals, GROUP BY, joins) is one `_sql`
query ([below](#totals-group-by-and-joins-_sql)). Import `client,gql` from `@afbin/apollo`:

```js
const {data,errors}=await client.query({query:gql`query West($r:String!){
 orders(where:{region:{_eq:$r}},order_by:{date:desc},limit:50){_id date region amount}
}`,variables:{r:'West'}});
if(errors?.length)throw Error(errors[0].message);
```

- `orders(where,order_by,limit,offset)`: `limit` defaults to 100, at most 1000; `_id` is always the
  last sort key, so `offset` paging is stable.
- `orders_by_pk(_id:ID!)` is null when the row is missing or hidden from you.
- `orders_can{insert}` and a row's `_can{update delete}` say what you may change
  ([permissions](permissions.md#what-this-viewer-may-change)): show only those controls.
- `where`: `_and _or _not`; per column `_eq _neq _gt _gte _lt _lte _in _nin _is_null`, plus
  `_like _ilike _nlike _nilike` on strings. `order_by`: `asc desc` and their `_nulls_first`/`_last`.

## Totals, group by and joins: `_sql`

```js
const {data,errors}=await client.query({query:gql`query Months($p:JSON){
 _sql(sql:"select month, count(*) as n, sum(amount) as total from orders where region = $region group by month order by month",params:$p){columns{name type} rows}
}`,variables:{p:{region:'West'}}});
// data._sql.rows: [{month:'2026-01',n:4,total:1200},…]
```

One read-only SQLite `SELECT` over the page's linked datasets as the reader: a dataset is the table
named by its `data-af-name` (`orders`; multi-table `orders.<table>`), with `_id`; join them freely.
`$name` binds `params.name`. It sees only rows and columns your rule shows; each dataset it names
needs `allow_aggregations` in your rule ([permissions](permissions.md)). At most 10,000 rows, 5 s.
`watchQuery` refetches it on change; local preview runs it too.

## Write

```graphql
mutation Add($o:orders_insert_input!){insert_orders_one(object:$o){_id amount}}
mutation Fix($id:ID!){update_orders_by_pk(pk_columns:{_id:$id},_set:{amount:13}){_id amount}}
mutation Bump($id:ID!){update_orders(where:{_id:{_eq:$id}},_inc:{votes:1}){affected_rows}}
mutation Drop($id:ID!){delete_orders_by_pk(_id:$id){_id}}
```

`insert_orders(objects)` takes up to 100 rows; `update_`/`delete_orders(where)` return
`affected_rows`. One mutation is atomic, writes one dataset and changes at most 100 rows. For compare-and-set put old values in `where`; `affected_rows:0`
means "changed meanwhile". There is no upsert: read the row, then `update_…_by_pk`
or `insert_…_one`. `_id` is generated and never set. Returned rows need a select rule.

`client.mutate` sends one `Idempotency-Key` per call, so a retry applies once.
`graphql.mjs mutate DATASET_ID --document m.graphql` prints its `idempotencyKey`; after exit 5
(unknown outcome) repeat with `--idempotency-key KEY`. Errors carry
`extensions.code`: `permission_denied`, `check_violation`, `validation_failed`, `too_many_rows`,
`one_dataset_per_mutation`, `outcome_unknown`, `dataset_not_found`. Only the owner and editors write
until [permissions](permissions.md) allow more; a page link never grants writes.

## Live views

`client.watchQuery({query}).subscribe(...)` refetches after committed writes and when the dataset
changes; `onResolverChange(names=>…)` from `@afbin/apollo` names changed links. Never poll.
`examples/csv-dashboard.html` charts `_sql` group-bys;
`examples/tracker.html` writes rows directly, draws its controls from `_can`, counts with
`_sql` and, with its limits feature, adds through a resolver ([resolvers](resolvers.md)).

## Type together (`@afbin/collab`)

Bind a text cell to an `<input>` or `<textarea>`: everyone allowed to change it types in it live
(no typing lost); reads and exports see a plain string.

```js
import {collab} from '@afbin/collab';
const text=collab.text('tasks',row._id,'description'); // link name, row _id, field
const binding=text.bind(textarea); // two-way, caret kept, IME-safe
text.on('change',value=>…); text.status; // 'synced'|'pending'|'offline'|'readonly'
text.on('error',({reason,message,unsaved})=>…); // why editing ended; text that was not saved
binding.destroy(); text.destroy();
```

The owner opts each text column in with the policy's table key `"collaborative_columns":["description"]`
([permissions](permissions.md)). Who may type is the update rule for that row and column (a check.mjs browser as its
viewer); anyone else gets `readonly`: set the field to the value you read before `bind`. Keys typed
before the session starts are merged in.
Typing is saved as one dataset version when someone leaves or after a quiet spell; a GraphQL write
meanwhile is merged with the typing. A deleted row, or text the update rule's `check` refuses, ends
editing: the field turns read-only and `error` says why (`removed`, `check_violation`, `rejected`).

## CSV import

Numbers are inferred. To keep exact text (IDs, long decimals), send
`columns:[{name:"amount",type:"string"}]` on create; `type:"number"` converts and can round. An
unquoted empty field is null; a quoted `""` is an empty string; literal `null` stays text.

## Files attached to a dataset

A live page binding may upload files to its dataset when the caller may insert rows. Signed-in
browser images: `POST /a/PAGE_ID/datasets/DATASET_ID/images` (bytes, image Content-Type). Other
files: `POST /api/artifacts/PAGE_ID/datasets/DATASET_ID/files` (bytes, Content-Type, percent-encoded
`X-Filename`). Both need `X-Edit-Id` from the page head and a unique `Idempotency-Key` (replay the
same bytes and key after an uncertain response). The response returns the stored ref and a read URL
under the same permissions. Pinned bindings cannot upload.
