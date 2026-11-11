---
name: datasets
description: "Read before a page shows or writes dataset rows: CSV and JSON datasets, linking them into pages, reading, totals, joins and writes with sql, and live views with sql.watch."
---
## Read first

A dataset is stored CSV or JSON rows; a page links it and reads and writes it with SQL:

```html
<link rel="af-dataset" data-af-name="orders" href="./orders.csv">
```

Publishing the page makes a CSV linked by path a dataset named by the file, updated as it
changes; link a published one as `ref:ID`. `data-af-name` is unique per page. Live is the
default; `data-af-mode="pinned" data-af-revision="2"` freezes one saved version, read-only.
`node scripts/publish.mjs rows.csv` alone prints the `--artifact ID` that updates it; HTTP:
`POST [[ base ]]/api/artifacts` with a durable `Idempotency-Key` and an origin-bound bearer, never
from page HTML:

```json
{"dataset":"week,completed,waiting\n2026-W01,18,7\n2026-W02,24,4\n","title":"Repair bench sample","visibility":"unlisted"}
```

New datasets are readable by anyone who can
open them; only the owner and editors change rows. To let readers add or edit rows,
set rules: [permissions](permissions.md). The install's own database: [default](#the-default-connection).

## Contents

[Tables](#tables-discover-before-querying) · [Read](#read) · [Write](#write) · [Live](#live-views) · [Type together](#type-together-afbincollab) · [CSV](#csv-import) · [Files](#files-attached-to-a-dataset) · [Default](#the-default-connection)

## Tables: discover before querying

`node scripts/sql.mjs schema PAGE_ID` (or `DATASET_ID`) prints each table as a `CREATE TABLE` with
its column types, as your role sees it. In a page, a dataset is the table named by its
link's `data-af-name` (`orders`; a multi-table one is `orders.<table>`). Columns keep the file's
names: quote one that is not a plain name (`"Created By"`). Every table has `_id`, the stable row
ID (a CSV `id` column stays ordinary). Types: number, boolean, text; dates are ISO text and user
columns hold account IDs. `node scripts/sql.mjs query ID 'select …'` runs one statement.

## Read

`` sql`…` `` from `@afbin/apollo` runs one SQLite statement over the page's linked datasets as the
reader. Every `${…}` is a bound parameter, never SQL text: a string, finite number, boolean, null
or Date. A read answers its rows (an array; `rows.columns` lists `{name, type}`):

```js
import {sql} from '@afbin/apollo';
const region='West';
const recent=await sql`select _id, date, amount from orders where region = ${region}
  order by date desc limit 50`;
const months=await sql`select substr(date, 1, 7) as month, count(*) as n, sum(amount) as total
  from orders group by month order by month`;
```

Compute every count, total, group by and join in SQL, never by summing rows in script; join
linked datasets freely. A reader sees only the rows and columns their rule shows. A refusal
rejects with `SqlError` (`code`, `message`): `validation_failed`, `permission_denied`,
`timeout`, `result_too_large`, `unavailable` (no app frame: a downloaded copy or local preview).
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
`too_many_rows`, `validation_failed`, `outcome_unknown` (read before writing again). Only the
owner and editors write until [permissions](permissions.md) allow more; a page link never
grants writes. Pinned links and archived page versions read only.

## Live views

`sql.watch(statement, rows=>…, error=>…)` runs it now and again whenever a dataset it names
changes (another reader's write, a schedule's), one request at a time; it returns the stop
function. The statement must name its tables in its text. Never poll.

```js
const stop=sql.watch(sql`select count(*) as open from tasks where not done`,
  ([{open}])=>{badge.textContent=String(open);},error=>{badge.textContent=error.message;});
// When removing this UI: stop();
```

`onResolverChange(names=>…)` from `@afbin/apollo` names changed links (and `viewer` on sign-in
or out): re-call [functions](functions.md) whose answers depend on them.
`examples/csv-dashboard.html` watches its SQL group-bys; `examples/tracker.html` writes rows
directly, counts with SQL and, with its limits feature, adds through a function.

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
`X-Filename`). Both need `X-Edit-Id` from the page head and a unique `Idempotency-Key` (replay the
same bytes and key after an uncertain response). The response returns the stored ref and a read URL
under the same permissions. Pinned bindings cannot upload.

## The default connection

`<link rel="af-dataset" data-af-name="wh" href="default:DB">` reads the install's database
([[ connectors ]]; empty DB: its default), signed in, read-only: `wh.table` in its own SQL.
Agents: `sql.mjs query default:DB 'SQL'`; `schema default:DB`.
