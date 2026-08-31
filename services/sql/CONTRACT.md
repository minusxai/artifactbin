# The SQL service contract

DuckDB, stateless, rows by value. `@artifactbin/contracts` `SqlService` is the interface; this file is the wire.
Every method is one `POST` with a JSON body; a `Set` anywhere in a body is sent as an array.

| Method | Route | Body | Answer |
|---|---|---|---|
| `run` | `POST /run` | `RunInput` — `tables` (rows travel here), `queries` in dependency order, `params`, `limit?`, `timeoutMs?`, `page?` | `{ results: { [name]: TableResult \| QueryFailure } }` |
| `mutate` | `POST /mutate` | `MutationInput` — one table, one writing statement | `{ result: MutationResult \| QueryFailure }` |
| `dryRun` | `POST /dry-run` | `DryRunInput` — column shapes only, `paramNames: string[]` | `DryRunResult` |
| `dryRunMutations` | `POST /dry-run-mutations` | `DryRunMutationsInput` | `{ errors }` |
| — | `GET /health` | — | `200 {"ok":true}` — the Docker HEALTHCHECK and the compose `depends_on` condition; the one GET, every other route POST-only |

Rules the service enforces, whatever the caller says: one statement per query, admitted by type (reads on `/run`,
one write on `/mutate`), params bound never spliced, a row cap and a per-query interrupt (`limit`/`timeoutMs`
may lower the caps, never raise them), a 64 MiB body. A document's dependent queries MUST travel in one `run`.
No credentials, no storage, no request identity, no network from inside the engine. Private network only.

Errors: a query that cannot run is a `QueryFailure` for that query; a malformed body is `400 {"error":"bad_request"}`
with the detail in the operator log only; an unreachable service is a `QueryFailure` on every query at the client's
deadline — including the DRY RUNS, where an empty `errors` array would admit an unchecked document and move the
author's error from publish time to render time, which is the whole reason the dry runs exist.

Entry points: `@artifactbin/sql` is the contract, the client and the server shell (no native module); `./local` is
the engine and the ONLY entry that loads DuckDB; `./shape` is the pure column inference, safe in a browser bundle.

Conformance: `__tests__/contract.test.ts` runs one suite over `createSql()` and over `sqlClient(serveSql(createSql()))`.
