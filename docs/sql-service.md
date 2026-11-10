# The SQL service

SQLite (the official wasm build), stateless, rows by value. `SqlService` in
`services/contracts/src/sql.ts` is the interface and carries every method's input and answer shape;
`SQL_ROUTES` names the routes. Every method is one `POST` with a JSON body (a `Set` travels as an array);
`GET /health` is the one GET. This page holds what the types do not say.

## What the service enforces

Whatever the caller says: one statement per query, admitted by type (reads on `run`, one write on `mutate`),
params bound and never spliced, a row cap and a per-query interrupt (`limit` and `timeoutMs` may lower the caps,
never raise them), and a 64 MiB body. A document's dependent queries must travel in one `run`: inside it each
result is loaded whole for the queries after it, and the row cap bounds only what is returned (`totalRows`
counts the rest). The engine has no credentials, storage, request identity or network. Run it on a private
network; a split deployment sets `INTERNAL__SERVICE_SECRET` on the service and its callers, and in production
the service refuses to start without it.

Paged reads keep `totalRows`, the count before the page window. `truncated` is true only when the returned rows
omit part of that result; asking for a page is not itself truncation, and a complete result (an empty one
included) omits the flag.

## Errors

A query that cannot run is a `QueryFailure` for that query. A malformed body is `400 {"error":"bad_request"}`,
with the detail in the operator log only. An unreachable service is a `QueryFailure` on every query at the
client's deadline, the dry runs included: an empty `errors` array there would admit an unchecked document and
move the author's error from publish time to render time, which is the reason the dry runs exist.

## Mutations

A row action's fields are ordinary named parameters: the app binds `$_row.<column>` as `$_row__<column>` (and
the other dotted built-ins the same way, `paramSqlName`), typed by `paramTypes`. The caller owns the row schema
and authorization; binding a row's values does not establish row identity.

`expectedAffected` optionally guards the exact changed-row count. A mismatch returns a failure with no new rows:
`row_changed` when fewer rows changed, `row_not_unique` when more did. The throwaway database is then discarded,
so the caller has nothing to persist. `services/sql/__tests__/editable-row.test.ts` runs these rules over the
local and HTTP transports.

**Extensions.** A trusted composition root may supply `SqlExtensions.setupMutation(database, { input, dryRun })`.
It receives the mutation's own guarded, throwaway database before the statement is prepared, may register
functions under names only it knows, and may return a continuation the engine calls after the statement ran, or
after a function aborted it: a function may throw to demand an external result, and a continuation that answers
makes the write a `QueryFailure` carrying it, with nothing persisted. A dry run should stub such a function
(return NULL); reads are unaffected. Analysis in write mode installs the hook as a dry run before preparing, so a
mutation's analysis sees the functions its run will. In a server the hook is a module whose default export every
engine thread imports (`createSql(caps, { extensions: <module URL> })`); the app host takes the same absolute
specifier (`AppHostOptions.sqlExtensions`) for its own analysis. Downstream code owns extension authorization and
validation; this repository installs no external-effect functions.

## Catalog reads and prepared databases

A catalog read carries `RunInput.catalog`: a default schema, logical table names, permitted columns, table-data
keys or stored model SQL, and optional scalar parameter types, with exactly one result query. The service mounts
only those columns under the logical names; transport keys never become readable relations. SQLite's authorizer
checks the original SQL and its catalog references; system and cross-catalog relations and dynamic table functions
are refused. Models resolve lazily as views, keep full intermediate data and refuse dependency cycles. The usual
read admission, deadline and pagination caps still apply.

A catalog table's `key` is the content address of the rows its source carries: the same key always travels with
the same rows, and the caller changes it whenever they could differ (another object, row-ID set or role view).
When every source has a key, each engine thread (and each `createSqliteSql`) keeps the database it built for that
catalog in a byte-capped LRU (`SqlPoolOptions.preparedBytes`, 32 MiB per thread by default), so the rows may be
left out: a hit answers from the kept database, and a miss answers every query `{ rowsRequired: true }` so the
caller resends the same read with the rows. An entry's identity covers the default schema, every table's schema,
name and columns, every model's SQL and every key, so a view with fewer columns, other rows or an emptied model
never reads another's entry. Nothing is invalidated: a write makes a new key and the old entry ages out. Each
read runs in a transaction that is rolled back, so a kept database stays as built. The worker pool sends a keyed
read to the thread its database was last sent to when that thread is idle, else to any idle one.
`services/sql/__tests__/prepared-cache.test.ts` covers hits, resends, the byte cap and isolation.

## Entry points

- `@artifactbin/sql` (`services/sql/src/index.ts`): the contract, the HTTP client and the server shell; no engine.
- `@artifactbin/sql/core` (`services/sql/src/sqlite/index.ts`): the browser-safe engine with no Node imports, so
  the server, the runtime bundle and the offline file run the same wasm and the same functions. It is what the
  publish compiler analyses with.
- `@artifactbin/sql/sqlite` (`services/sql/src/sqlite-local.ts`): that engine as a `SqlService` in the calling
  thread (a CLI, a test).
- `@artifactbin/sql/local` (`services/sql/src/local.ts`): the engine in a small pool of worker threads for a
  server. No statement runs on the process's event loop, a deadline is enforced inside the thread, and a thread
  that stays silent past its call's deadline is terminated and replaced (`services/sql/__tests__/pool.test.ts`,
  `/health` answering under load included).

Conformance: `services/sql/__tests__/contract.test.ts` runs one suite in this thread and in worker threads, each in
process and through `sqlClient(serveSql(…))`; the policy, editable-row and typed-parameter suites do the same.

## The engine

`loadSqlite(wasmBytes?)` answers an engine whose `run`, `mutate`, `dryRun` and `dryRunMutations` take
already-clamped bounds; it also analyses a statement and opens a guarded database for callers that orchestrate
their own statements. `createSqliteSql(caps)` is the `SqlService` over it, with the same caps rule as the pool.
It is the only engine: the app and the offline file both run it.

- **Tables** load by schema, table, columns and rows: `main` for document tables and query results, an attached
  in-memory schema per import (`bookings.rows`). Columns are STRICT (`string`, `date`, `timestamp` and `user` are
  TEXT, `number` REAL, `boolean` INTEGER), with CHECKs that keep a date `YYYY-MM-DD` and a timestamp a UTC ISO
  string ending in `Z`. Values are validated on load and on bind (`normalizeDate`, `normalizeTimestamp` in
  `services/utils/src/shape.ts`). A write accepts widely and stores canonically: a timestamp written to a date
  column is stored as its UTC calendar day, a date or offset written to a timestamp column as the UTC instant;
  a non-date is refused. STRICT refuses type names SQLite does not know, so a column's `ColumnType` lives in the
  engine's registry, and an output column takes it only when SQLite reports a direct origin: `user` survives a
  direct projection (renamed, through a CTE or a join) and never a function. An expression's type is what its
  values already are; a comparison is 1 or 0.
- **The guard is SQLite's authorizer**, armed for every author statement and re-armed on any re-prepare: exactly
  one statement (the tail must prepare to nothing), a read is one SELECT, a write one INSERT, UPDATE or DELETE on
  its target with no RETURNING. PRAGMA, ATTACH and DETACH, DDL, transactions, ANALYZE and EXPLAIN are refused.
  Functions are SQLite's listed core set (`CORE_FUNCTIONS`) plus `SQL_FUNCTIONS`, and `MUTATION_ONLY_FUNCTIONS`
  are refused in reads (the skill's SQL reference renders its lists from the same sets). `sqlite_*` and
  `pragma_*` names and every virtual table but `json_each` and `json_tree` are unreadable, as is any relation the
  call did not load. Values over 32 MiB and statements over 1 MB of text are refused; a deadline interrupts
  through the progress handler.
- **Mutations are judged on their effect.** Engine-owned temp triggers with unguessable names record the rows the
  statement inserted, updated and deleted. A policy filter is row-level security (a row it does not admit is
  skipped; reads inside the statement still see it); presets and `check` apply to the written rows; an INSERT's
  columns are the ones whose DEFAULT it did not take; an effect outside the operation (REPLACE, a moved rowid) is
  refused. `policyPreview` runs the statement on the empty table and stops after admission and column checks.
