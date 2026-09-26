# The SQL service contract

DuckDB or SQLite, stateless, rows by value. `@artifactbin/contracts` `SqlService` is the interface; this file is the wire.
Every method is one `POST` with a JSON body; a `Set` anywhere in a body is sent as an array.

| Method | Route | Body | Answer |
|---|---|---|---|
| `run` | `POST /run` | `RunInput` — `tables` (rows travel here), `queries` in dependency order, `params`, `limit?`, `timeoutMs?`, `page?` | `{ results: { [name]: TableResult \| QueryFailure } }` |
| `mutate` | `POST /mutate` | `MutationInput` — one table, one writing statement | `{ result: MutationResult \| QueryFailure }` |
| `dryRun` | `POST /dry-run` | `DryRunInput` — column shapes only, `paramNames: string[]` | `DryRunResult` |
| `dryRunMutations` | `POST /dry-run-mutations` | `DryRunMutationsInput` | `{ errors }` |
| — | `GET /health` | — | `200 {"ok":true}` — the liveness/readiness probe for whatever orchestrates the service; the one GET, every other route POST-only |

Rules the service enforces, whatever the caller says: one statement per query, admitted by type (reads on `/run`,
one write on `/mutate`), params bound never spliced, a row cap and a per-query interrupt (`limit`/`timeoutMs`
may lower the caps, never raise them), a 64 MiB body. A document's dependent queries MUST travel in one `run`.
No credentials, no storage, no request identity, no network from inside the engine. Private network only.

Paged reads retain `totalRows`, the count before the page window. `truncated` is true only when
the returned rows omit part of that result; requesting a page does not itself mean truncation.
A complete result (including an empty result) omits the flag, just like an unpaged read.

Trusted composition roots may supply `createSql(caps, extensions)` with a mutation connection hook.
The hook runs before preparation on mutation and dry-run connections; reads remain unaffected.
Opaque `extensions` input and `continuation` failures cross the same local/HTTP contract.
Downstream code owns extension authorization and validation. The OSS engine installs no external-effect functions.

Errors: a query that cannot run is a `QueryFailure` for that query; a malformed body is `400 {"error":"bad_request"}`
with the detail in the operator log only; an unreachable service is a `QueryFailure` on every query at the client's
deadline — including the DRY RUNS, where an empty `errors` array would admit an unchecked document and move the
author's error from publish time to render time, which is the whole reason the dry runs exist.

Entry points: `@artifactbin/sql` is the contract, the client and the server shell (no native module); `./local` is
the engine and the ONLY entry that loads DuckDB; `./shape` is the pure column inference, safe in a browser bundle.

Conformance: `__tests__/contract.test.ts` runs one suite over both engines (`createSql()`, `createSqliteSql()`), each in
process and through `sqlClient(serveSql(…))`; the policy, editable-row and typed-parameter suites do the same.

Editable mutations optionally carry `row: { columns, values }`. The engine binds it as the native `$_row`
STRUCT, with number, boolean, string and date fields matching the supplied columns. Date values travel as
strings and use DuckDB's DATE conversion; absent values bind typed NULL. Dry-run mutations accept the same
`row: { columns }` shape with every field NULL, so unknown fields and invalid typed expressions fail before
publication. The caller owns the row schema and authorization; this binding does not establish row identity.

`expectedAffected` optionally guards the exact changed-row count. A mismatch returns a failure with no new
rows: `row_changed` when fewer rows changed, `row_not_unique` when more changed. The throwaway database is
then discarded, so the caller has nothing to persist. Omitting this field preserves generic mutation behavior.
`__tests__/editable-row.test.ts` exercises these rules through both local and HTTP transports.


Catalog reads optionally carry `RunInput.catalog`: a default schema, logical table names,
permitted columns, table-data keys or stored model SQL, and optional scalar parameter types.
They contain exactly one result query. The service mounts only those columns under the logical
schema/table names; transport keys never become readable relations. DuckDB's native parser
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
orchestrate their own statements. `createSqliteSql(caps)` in `./local` is the `SqlService` over it, with the same caps
rule as DuckDB. It is not wired into the app yet.

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
  Row values arrive as ordinary named parameters: `row`/`$_row` is DuckDB-only, and so are `SqlExtensions`.
