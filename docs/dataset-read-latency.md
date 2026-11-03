# Dataset read latency

What a repeated read of one stored dataset table costs. The benchmark is
[`scripts/dataset-read-latency.ts`](../scripts/dataset-read-latency.ts), beside
[`resolver-latency.ts`](resolver-latency.md). It is never run by CI and nothing asserts a budget. It drives the
real code unchanged: `executeCatalog` (every dataset door and the generated GraphQL call it) over the SQL
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
