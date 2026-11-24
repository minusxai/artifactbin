---
name: datasets
description: "Read before a page shows or writes dataset rows: CSV and JSON datasets, linking them into pages, reading, totals, joins and writes with sql, and live views with sql.watch."
---
## Read first

Link CSV or JSON rows to read/write with SQL:

```html
<link rel="af-dataset" data-af-name="orders" href="./orders.csv">
```

Publish the page to create the dataset. An unchanged CSV is reused. A changed CSV replaces
its rows only if the dataset still matches the last published revision and state, else publish
refuses it. Publish adds `data-af-id` to local HTML. Use a unique `data-af-name` per page.
Links follow live rows. `data-af-mode="pinned" data-af-revision="2"` freezes a read-only version.

New datasets are readable by anyone who can open them. Only owners and editors can write
until you set [permissions](permissions.md). To upload a CSV alone, publish it as below or
POST `{"dataset":"name,amount\nWest,50"}` to `[[ base ]]/api/artifacts` with an origin-bound
bearer and durable `Idempotency-Key` outside page HTML. A standalone CSV update takes `--artifact ID`.

## Contents

[Tables](#tables-discover-before-querying) · [Read](#read) · [Write](#write) · [Rows people change](#rows-people-change) · [Live](#live-views) · [Type together](#type-together-afbincollab) · [CSV](#csv-import) · [Files](#files-attached-to-a-dataset) · [Default](#the-default-connection)

## Tables: discover before querying

`node scripts/sql.mjs schema PAGE_ID` (or `DATASET_ID`) shows the tables and column types your
role can see. Page tables use the link's `data-af-name` (`orders`, or `orders.<table>`). A dataset
ID has one table, `rows`. Quote names like `"Created By"`. Every row has a stable `_id`, separate
from a CSV `id` column. Types include numbers, booleans, text, ISO dates and account IDs.

## Read

`` sql`…` `` from `@afbin/apollo` runs one SQLite statement over the page's linked datasets as the
reader. Every `${…}` is a bound parameter, never SQL text: a string, finite number, boolean, null
or Date. A read answers its rows (an array; `rows.columns` lists `{name, type}`):

```js
import {sql} from '@afbin/apollo';
const recent=await sql`select _id, date, amount from orders where region = ${'West'}
  order by date desc limit 50`;
const months=await sql`select substr(date, 1, 7) as month, count(*) as n, sum(amount) as total
  from orders group by month order by month`;
```

Count, total, group and join in SQL. `SqlError` gives a `code`,
reader `message` and `detail`. Read codes: `permission_denied`, `sign_in_required`, `unavailable` (down, or no data here),
`validation_failed`, `timeout`, `result_too_large`, `dataset_not_found`, `unknown_query`,
`consent_required` (live data not yet allowed). Show `message` in place of rows (components do).
Cut off: `rows.truncated`.
At most 10,000 input rows, 5 s and 4 MiB per answer; column and table names cannot be bound.

## Write

```js
const {affected,returning}=await sql`insert into orders (region, amount) values (${r}, ${n})`;
await sql`update orders set amount = ${n} where _id = ${id}`;
await sql`update orders set votes = votes + 1 where _id = ${id}`;
await sql`delete from orders where _id = ${id}`;
```

One `INSERT`, `UPDATE` or `DELETE` of one linked table answers `{affected, returning}` (the rows as
your rule shows them; no `RETURNING` clause). It runs as the reader under the dataset's rules
([permissions](permissions.md)) and can change only rows the reader can see: a row the rules do
not let them change is skipped, so `affected: 0` means "not allowed, or changed meanwhile": say
so, never "saved". A write changes at most 100 rows atomically; `_id` is generated and never set.
There is no upsert: read the row, then update or insert. Functions whose result changes between
runs (`random()`, `current_timestamp`) are refused: pass the value. Each write sends its own
`Idempotency-Key`, so a retry applies once. Refusals: `permission_denied`, `check_violation`,
`too_many_rows`, `validation_failed`, `outcome_unknown` (read before writing again). A page link never grants writes. Pinned links and archived page versions read only.

## Rows people change

1. Run `node scripts/publish.mjs entries.csv --create` once. Take the dataset ID from the reply.
2. Set `<link rel="af-dataset" data-af-name="entries" href="ref:ID">` and keep it on republish.
3. Change rows with [SQL](#write), never by republishing the CSV. In the page, write to `entries`.
   Owners and editors can also run `node scripts/sql.mjs query ID '…'` on the table `rows`.

## Live views

`sql.watch(statement, rows=>…, error=>…)` runs it now and again whenever a dataset it names
changes, one request at a time; it returns the stop function. The statement must name its
tables in its text. Never poll.

```js
const stop=sql.watch(sql`select count(*) as open from tasks where not done`,
  ([{open}])=>{badge.textContent=String(open);},error=>{badge.textContent=error.message;});
// When removing this UI: stop();
```

`onResolverChange(names=>…)` from `@afbin/apollo` names changed links (and `viewer` on sign-in
or out). `examples/csv-dashboard.html` watches SQL group-bys; `examples/tracker.html` writes rows
and counts with SQL.

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
([permissions](permissions.md)). Who may type is the update rule for that row and column; anyone else gets `readonly`: set the field to the value you read before `bind`.
Typing is saved as one dataset version when someone leaves or after a quiet spell; a `sql` write
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
`X-Filename`). Both need `X-Edit-Id` from the page head and a unique `Idempotency-Key`. The reply has the stored ref and a read URL
under the same permissions. Pinned bindings cannot upload.

## The default connection

`<link rel="af-dataset" data-af-name="wh" href="default:DB">` reads the install's database
([[ connectors ]]; empty DB: its default), signed in, read-only: `wh.table` in its own SQL.
Agents: `sql.mjs query default:DB 'SQL'`, `schema default:DB`; named: `default:NAME:DB`.
Declared queries too, with `data-af-params='{"r":["EU"],"d":"date"}'`; `groups.mjs --help`.

## Live datasets

A database: `publish.mjs db.json --type connection --secret-file -`. Owner/editors' `sql` names
`NAME.table`; others run only declared queries, `sql.query('mine', {…})` for
`<script type="application/sql" data-af-query="mine" data-af-dataset="NAME">SQL</script>`;
the server fills `:viewer_id`, `:viewer_email`, `:viewer_groups`.
