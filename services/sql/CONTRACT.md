# The SQL service contract

SQLite (the official wasm build), stateless, rows by value. `@artifactbin/contracts` `SqlService` is the interface; this file is the wire.
Every method is one `POST` with a JSON body; a `Set` anywhere in a body is sent as an array.

| Method | Route | Body | Answer |
|---|---|---|---|
| `run` | `POST /run` | `RunInput` — `tables` (rows travel here, in `main`), `imports` (a schema per imported artifact: `bookings.rows`), `queries` in dependency order, `params`, `paramTypes?`, `limit?`, `timeoutMs?`, `page?` | `{ results: { [name]: TableResult \| QueryFailure } }` |
| `mutate` | `POST /mutate` | `MutationInput` — the one table it writes (`table.schema` names its import), what else it `reads`, one writing statement | `{ result: MutationResult \| QueryFailure }` |
| `dryRun` | `POST /dry-run` | `DryRunInput` — column shapes only, `paramNames: string[]` | `DryRunResult` |
| `dryRunMutations` | `POST /dry-run-mutations` | `DryRunMutationsInput` | `{ errors }` |
| — | `GET /health` | — | `200 {"ok":true}` — the liveness/readiness probe for whatever orchestrates the service; the one GET, every other route POST-only |

Rules the service enforces, whatever the caller says: one statement per query, admitted by type (reads on `/run`,
one write on `/mutate`), params bound never spliced, a row cap and a per-query interrupt (`limit`/`timeoutMs`
may lower the caps, never raise them), a 64 MiB body. A document's dependent queries MUST travel in one `run`; inside it
each result is loaded WHOLE for the queries after it, and the row cap bounds only what is returned (`totalRows` counts the rest).
No credentials, no storage, no request identity, no network from inside the engine. Private network only.

Paged reads retain `totalRows`, the count before the page window. `truncated` is true only when
the returned rows omit part of that result; requesting a page does not itself mean truncation.
A complete result (including an empty result) omits the flag, just like an unpaged read.

Trusted composition roots may supply `SqlExtensions.setupMutation(database, { input, dryRun })`, an engine-neutral
hook: it receives the mutation's own guarded, throwaway database before the statement is prepared, may register
functions under names only it knows, and may return a continuation the engine calls after the statement ran —
or after a function aborted it, so a function may throw to demand an external result (a continuation it answers
makes the write a `QueryFailure` carrying it; nothing is persisted). A dry run (`dryRun: true`) should stub such a
function (return NULL). Reads are unaffected. `analyze(sql, schema, { mode: 'write', extensions })` installs the
hook as a dry run before preparing, so a mutation's analysis sees the functions its run will. In a server the hook
is a MODULE (`createSql(caps, { extensions: <module URL> })`) whose default export every engine thread imports; the
app host takes the same absolute specifier (`AppHostOptions.sqlExtensions`) for its own analysis. Opaque `extensions` input and `continuation` failures cross the same local/HTTP contract.
Downstream code owns extension authorization and validation. The OSS engine installs no external-effect functions.

Errors: a query that cannot run is a `QueryFailure` for that query; a malformed body is `400 {"error":"bad_request"}`
with the detail in the operator log only; an unreachable service is a `QueryFailure` on every query at the client's
deadline — including the DRY RUNS, where an empty `errors` array would admit an unchecked document and move the
author's error from publish time to render time, which is the whole reason the dry runs exist.

Entry points: `@artifactbin/sql` is the contract, the client and the server shell; `./core` is the browser-safe
SQLite engine (what the publish compiler analyses with); `./sqlite` is that engine as a `SqlService` in the calling
thread (a CLI, a test); `./local` is the same engine in a small pool of `worker_threads` for a server — no statement
runs on the process's event loop, a deadline is enforced inside the thread, and a thread that stays silent past its
call's deadline is terminated and replaced (`__tests__/pool.test.ts`, including `/health` answering under load);
`./shape` is the pure column inference, safe in a browser bundle.

Conformance: `__tests__/contract.test.ts` runs one suite in this thread and in worker threads, each in process and
through `sqlClient(serveSql(…))`; the policy, editable-row and typed-parameter suites do the same.

A row action's fields are ordinary named parameters: the app binds `$_row.<column>` as `$_row__<column>` (and the
other dotted built-ins the same way, `paramSqlName`), typed by `paramTypes`. The caller owns the row schema and
authorization; binding a row's values does not establish row identity.

`expectedAffected` optionally guards the exact changed-row count. A mismatch returns a failure with no new
rows: `row_changed` when fewer rows changed, `row_not_unique` when more changed. The throwaway database is
then discarded, so the caller has nothing to persist. Omitting this field preserves generic mutation behavior.
`__tests__/editable-row.test.ts` exercises these rules through both local and HTTP transports.


Catalog reads optionally carry `RunInput.catalog`: a default schema, logical table names,
permitted columns, table-data keys or stored model SQL, and optional scalar parameter types.
They contain exactly one result query. The service mounts only those columns under the logical
schema/table names; transport keys never become readable relations. SQLite's authorizer
checks the original SQL and catalog references. System/cross-catalog relations and dynamic table
functions are rejected. Models resolve lazily as views, retaining full intermediate data and
rejecting dependency cycles. Typed parameters remain bound values; query literal bytes are preserved.
The ordinary read admission, external-access lock, deadline and pagination caps still apply.
PostgreSQL catalogs continue to use the app's PostgreSQL compiler before the PostgreSQL transport.


## The SQLite engine

`@artifactbin/sql/core` is the same contract on the official `@sqlite.org/sqlite-wasm` build (pinned exactly), with
no Node imports, so the server, the runtime bundle and the offline file run the same wasm and the same functions.
`loadSqlite(wasmBytes?)` answers an engine whose `run`/`mutate`/`dryRun`/`dryRunMutations` take already-clamped
bounds, `analyze(sql, relations)` answers a `StatementAnalysis`, and `open()` a guarded database for callers that
orchestrate their own statements. `createSqliteSql(caps)` in `./sqlite` is the `SqlService` over it, with the same
caps rule as the server pool. It is the only engine: the app, the CLI and the offline file all run it.

- **Tables** load by `{schema, table, columns, rows}`: `main` for document tables and query results, an attached
  in-memory schema per import (`bookings.rows`). Columns are STRICT (`string`/`date`/`timestamp`/`user` TEXT,
  `number` REAL, `boolean` INTEGER), with CHECKs that keep a date `YYYY-MM-DD` and a timestamp UTC ISO with `Z` on
  every write. Values are validated on load and on bind (`@artifactbin/utils/shape` normalizes timestamps).
  STRICT refuses non-SQLite type names ("unknown datatype" for `user`), so a column's `ColumnType` lives in the
  engine's registry, and an output column is typed from it only when SQLite reports a direct origin — `user`
  survives a direct projection (renamed, through a CTE or join) and never a function. An expression's type is what
  its values already are (number, canonical date, canonical timestamp, else string); a comparison is 1/0.
- **The guard is SQLite's authorizer**, armed for every author statement and re-armed on any re-prepare: exactly one
  statement (the tail must prepare to nothing), a read is one SELECT, a write one INSERT/UPDATE/DELETE on its target
  and no RETURNING; PRAGMA, ATTACH/DETACH, DDL, transactions, ANALYZE, EXPLAIN are refused; functions are SQLite's
  listed core set plus `SQL_FUNCTIONS`, and `MUTATION_ONLY_FUNCTIONS` are refused in reads; `sqlite_*`, `pragma_*`
  and every virtual table but `json_each`/`json_tree` are unreadable, as is any relation the call did not load.
  Values over 32 MiB and statements over 1 MB of text are refused; a deadline interrupts through the progress handler.
- **Mutations are judged on their effect.** Engine-owned temp triggers (unguessable names) record the rows the
  statement inserted, updated and deleted by rowid; a policy filter is row-level security (a row it does not admit is
  skipped, reads inside the statement still see it); presets and `check` apply to the written rows; an INSERT's
  columns are the ones whose DEFAULT it did not take; an effect outside the operation (REPLACE, a moved rowid) is
  refused. `policyPreview` runs the statement on the (empty) table and stops after admission and column checks.
  Row values arrive as ordinary named parameters.
