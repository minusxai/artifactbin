# Dataset migration compatibility

## Scope and contracts

This implementation addresses legacy stored-dataset read queries and missing
catalog metadata. Historical exception policy remains separate.
Production has received a dry run, not an apply. No production content or
credentials are included here.

The planner owns token-preserving SQL rewrites and collision-safe upstream names.
Legacy read computations remain in the document SQL engine over explicitly named
source inputs. Mutations retain the dataset compiler and authorized write path.
Existing canonical source queries are unchanged by migration. Query names,
surrounding node IDs, retained-version transactions and fingerprints are preserved.

The shared dataflow evaluator distinguishes displayed query results from complete
inputs to dependent computations. For exactly `select * from public.rows`, it
can bind the complete authorized stored table internally. The server composition
supplies that table only for a physical stored relation (or an already resolved
computed source such as a folder). Models, remote catalogs and filtered queries
do not use this path. Source authorization and final access/snapshot checks remain
mandatory. Display pagination and output limits remain in effect.

The CLI uses the same evaluator with complete local input files. Its generated
release pointer and teaching version advance together so local and server
execution can ship consistently.

## Observed evidence

- Baseline: the planner and dataset-source API files passed, 14 tests total.
- A new API test observed migration refusing a DuckDB cast at the dataset compiler.
- A separate API test observed a 10,005-row input returning count 1,000,
  median 500.5 and sum 500,500 through the proposed upstream-query transformation.
- With complete internal inputs, that test returns count 10,005, median 5,003
  and sum 50,055,015. The displayed source remains truncated to 1,000 rows.
- The migrated computation matches direct document-engine execution, including
  column types, across three parameter values. It exercises median, strptime,
  strftime, chr, a DuckDB cast, date columns, nulls and an empty filtered result.
- Focused planner, migration transaction, dataflow and source API checks passed
  together (45 tests before additional local-input coverage).
- The routine broad test command deferred 210 files to CI under the 50-file cap;
  that is not a passing broad run. Local validation encountered errors in two
  unrelated ignored scratch files, `tmp/hasura-familiarity/run.ts` and
  `video/src/ui/Grab.tsx`. Clean-checkout CI is required.

## Costs and remaining work

### Metadata investigation

The saved production reports contain three conflicting documents referring to
five source datasets, but no plans/snapshots of those sources. Read-only CLI pulls
of the first two sources returned 404 under the available identity. This does not
distinguish missing/deleted records from access restrictions, and the production
records have not been repaired or verified. A private source-metadata snapshot or
securely configured admin environment is still needed for that inspection.

Synthetic handler tests established that a valid legacy object key already makes
its catalog available during preview, regardless of document/dataset ID order.
There is no demonstrated ordering regression requiring staged writes or a
proposed-state resolver. Planning and execution now share the same pure metadata
interpretation to preserve this contract.

The tests exposed a separate inventory bug: an explicit JSON-null catalog was
omitted in both heads and retained versions, even when its object key made it
recoverable. Inventory and audit now include those records. Preview stays
read-only; reviewed apply normalizes their metadata without copying data or
changing document versions.

Records with neither a catalog nor a nonempty string object key now produce
explicit blocking diagnostics, including the source ID for dependent queries.
They remain incomplete in the final audit and are never given invented empty
datasets. A reader regression test also observed a missing-storage dataset with
column metadata yielding count zero; the resolver now reports that source as
unavailable. These checks preserve record bytes for recovery. They do not add
support for old inline-content storage or discard invalid history.

### Remaining work

Complete materialization uses memory proportional to the stored inputs, as legacy
document execution did. Source result execution adds work and the server may
decode the cached object again for the full input; this change is not a streaming
or memory optimization. Existing engine input and timeout limits still apply.
The synthetic 10,005-row check establishes correctness beyond both source window
limits, not production-scale performance or browser verification.

Next milestones remain separate:

1. Inspect the five actual production source records through an authorized private
   snapshot or admin environment; determine storage/recovery needs. Do not infer
   their exact metadata from the synthetic reproductions or the CLI's 404s.
2. Skip and report invalid historical versions while preserving their bytes, as
   authorized by the user. Define exceptions in preview, apply, final audit and
   restore; current-head failures remain blocking. This policy is not implemented
   by the SQL compatibility change.
3. After deployment of reviewed changes, obtain a fresh production preview and
   investigate residual reference, mutation, chart, date and syntax defects.
4. Retain durable private backups and define partial-apply recovery before applying
   reviewed current fingerprints. Verify public reader charts and all eight Show
   HN queries afterward. No rollout or new production preview is part of this change.
