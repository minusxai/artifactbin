# Dataset read latency

A dated record of measurements taken in November 2026; the settings and code it describes may have changed since.

What a repeated read of one stored dataset table costs. The benchmark is
[`scripts/dataset-read-latency.ts`](../scripts/dataset-read-latency.ts), beside
[resolver call latency](resolver-latency.md). It is never run by CI and nothing asserts a budget. It drives the
real code unchanged: `executeCatalog` (every dataset door calls it: the page SQL door, `query_resource` and older pages' GraphQL) over the SQL
engine's worker pool (`createSql`), in this process (`pool`) and behind `serveSql` and `sqlClient` on loopback
(`http`). The rows come from an in-memory object store that answers the same bytes every time, as the store's
read cache does, so the time is the app's and the engine's, never the bucket's.

```sh
node --import tsx scripts/dataset-read-latency.ts              # 5,000 rows; 50 runs, 5 warm-ups, 3 × 8 concurrent
node --import tsx scripts/dataset-read-latency.ts --runs 30 --modes pool --json /tmp/after.json
```

Each mode reads as the owner (no role view) and as a viewer whose role view keeps a third of the rows:
`list` is a filtered, sorted window of 100 rows, `aggregate` a `GROUP BY`. Cold is the first read of a fresh
pool (thread start included); warm is the same read repeated one at a time; concurrent is 8 reads at once.

## Before the prepared database cache, 2026-11-04

Main at `54e81686b`, a Mac laptop, Node 22.22.3, the pool's default thread count, `--runs 30`. Every read
loads and parses the stored object, applies the role view, copies every row into the engine and builds a
fresh SQLite database. Times are in ms.

### pool (RSS after: 583 MB)

| read | cold | warm p50 | warm p95 | concurrent p50 | concurrent p95 |
|---|---|---|---|---|---|
| owner list | 286 | 25 | 26 | 58 | 277 |
| owner aggregate | 24 | 24 | 26 | 39 | 62 |
| viewer list | 11 | 11 | 13 | 25 | 37 |
| viewer aggregate | 11 | 10 | 11 | 23 | 33 |

### http (RSS after: 599 MB)

| read | cold | warm p50 | warm p95 | concurrent p50 | concurrent p95 |
|---|---|---|---|---|---|
| owner list | 244 | 29 | 31 | 73 | 292 |
| owner aggregate | 28 | 28 | 30 | 56 | 78 |
| viewer list | 13 | 13 | 14 | 55 | 181 |
| viewer aggregate | 26 | 17 | 32 | 43 | 57 |

## After: prepared databases, keys first, pool affinity, 2026-11-04

Main `606b8f219` plus this change (the app sending keys first and the pool's affinity), the same machine and
session, same options. A repeated read sends each table's content key alone; the engine thread that prepared
the database for those keys answers from it, so the object is neither read, parsed, filtered, sent nor loaded
again. Cold still builds (and includes thread start); the 8-concurrent p95 includes the first read on threads
the batch starts, which build their own copy.

### pool (RSS after: 562 MB)

| read | cold | warm p50 | warm p95 | concurrent p50 | concurrent p95 |
|---|---|---|---|---|---|
| owner list | 226 | 3.6 | 4.0 | 10 | 234 |
| owner aggregate | 3.7 | 3.3 | 3.6 | 3.6 | 6.9 |
| viewer list | 12 | 1.6 | 1.7 | 3.7 | 18 |
| viewer aggregate | 1.1 | 1.0 | 1.1 | 1.7 | 2.3 |

### http (RSS after: 572 MB)

| read | cold | warm p50 | warm p95 | concurrent p50 | concurrent p95 |
|---|---|---|---|---|---|
| owner list | 251 | 4.2 | 5.1 | 16 | 244 |
| owner aggregate | 4.3 | 3.7 | 4.1 | 6.1 | 10 |
| viewer list | 14 | 2.2 | 2.5 | 5.3 | 31 |
| viewer aggregate | 1.6 | 1.4 | 1.5 | 2.4 | 3.5 |

Warm p50 of the owner's 5,000-row list: 25 → 3.6 ms in process, 29 → 4.2 ms over HTTP; the viewer's
11 → 1.6 ms and 13 → 2.2 ms.

## Dataset GraphQL

What a generated-API read costs through the dataset's own endpoint (`POST /api/artifacts/<id>/graphql`), for the
owner and for a viewer whose select rule filters half the rows and hides a column. The benchmark is
[`scripts/dataset-graphql-latency.ts`](../scripts/dataset-graphql-latency.ts): the real route handler in process,
an in-memory PGLite, and the server's SQL worker pool (`--sql thread` runs the engine on the calling thread, as
the test suite does). Statements are one warm request's (lib/platform `measureQueries`); times are 30 sequential
requests after 3 warm-ups; RSS is the process peak, sampled every 10 ms. The statement budgets are pinned by
`services/app/lib/graphql-compat/__tests__/dataset-graphql-budget.test.ts`.

The tables below are historical: their `2 roots (list + count)` and `count + sum + nodes` rows used the removed
`<root>_aggregate` root. Counts and totals are now SQL (a new page's `` sql`…` `` door; older pages' `_sql` field, on the same engine); `--page-sql` measures the latter under
concurrent readers and live refetches (9,900 rows, 20 readers: warm 17 CPU ms/request against 18 for a 100-row
list; a write then every reader refetching, 31 against 35).

```sh
node --import tsx scripts/dataset-graphql-latency.ts                 # 20,000 rows, worker pool
node --import tsx scripts/dataset-graphql-latency.ts --rows 2000 --sql thread --json out.json
```

### Before one authorization per request, 2026-11-04, `54e81686b`

Apple M5 Pro, Node 22.22.3, 20,000 rows. Times in ms.

| caller | query | statements | p50 | p95 | peak RSS MiB |
|---|---|---|---|---|---|
| owner | list (100 rows) | 14 | 124 | 132 | 1414 |
| owner | 2 roots (list + count) | 17 | 127 | 131 | 1603 |
| owner | count + sum + nodes | 20 | 159 | 169 | 1620 |
| viewer | list (100 rows) | 46 | 87 | 104 | 1622 |
| viewer | 2 roots (list + count) | 61 | 98 | 112 | 1614 |
| viewer | count + sum + nodes | 76 | 126 | 133 | 1447 |

Each engine statement re-reads the dataset row three times (and, for a viewer, the four role queries with
each), so cost grows per statement rather than per request.

### One authorization per request, 2026-11-04

Before is `e216958ff` (main: the engine threads keep each prepared database and are sent keys first, #1076 and
#1078), after is this change; same session, same machine. The request authorizes the dataset once (its row, and
for a viewer the role facts once each through a per-request memo), every engine statement runs under that
authorization, and one fresh final fence (the head and the facts asked again) is checked before the reply
leaves. A page's schema GET and every mutation load keep their checks after loading and around each statement.
Times in ms.

| caller | query | statements before → after | p50 before → after | p95 before → after |
|---|---|---|---|---|
| owner | list (100 rows) | 14 → 8 | 37 → 38 | 43 → 40 |
| owner | 2 roots (list + count) | 17 → 8 | 39 → 34 | 43 → 35 |
| owner | count + sum + nodes | 20 → 8 | 35 → 33 | 36 → 34 |
| viewer | list (100 rows) | 46 → 14 | 37 → 30 | 40 → 47 |
| viewer | 2 roots (list + count) | 61 → 14 | 37 → 29 | 39 → 31 |
| viewer | count + sum + nodes | 76 → 14 | 39 → 34 | 43 → 38 |

On in-process PGLite a statement costs well under a millisecond, so these times understate the saving;
production Postgres round trips weigh more per statement. With the engine's prepared databases most of what
remains is the snapshot: it parses each stored object to count its rows and derives every row's ID. Through a
page the same reads cost 14 / 32 statements (owner / viewer), down from 20 / 64; the rest of a page request
reads the page itself.

### Row counts remembered by object key, 2026-11-04

Before is `58bf498d5` (main, one authorization per request), after is this change; same session, same
machine. Each request numbered every table's rows by parsing its stored object for the count; the count is now
remembered by object key (lib/datasets `storedRowCount`), which is safe because keys are content hashes. A warm
request loads no stored object at all. Statements are unchanged (8 owner, 14 viewer). Times in ms.

| caller | query | p50 before → after | p95 before → after |
|---|---|---|---|
| owner | list (100 rows) | 37 → 30 | 40 → 35 |
| owner | 2 roots (list + count) | 36 → 30 | 39 → 30 |
| owner | count + sum + nodes | 32 → 26 | 35 → 31 |
| viewer | list (100 rows) | 32 → 24 | 33 → 25 |
| viewer | 2 roots (list + count) | 31 → 24 | 32 → 28 |
| viewer | count + sum + nodes | 29 → 24 | 32 → 26 |

What remains per request is mostly deriving every row's ID (one digest per row when no IDs are stored).
