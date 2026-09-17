# Dataset migration compatibility

## Scope and contracts

This implementation addresses legacy stored-dataset read queries, missing
catalog metadata and explicitly reported historical exceptions.
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

A later read-only production inventory confirmed five legacy datasets retain their original
flat JSON rows in `content`, including a 1,700-row table. They have columns and row counts but
no object key. This is recoverable storage, distinct from absent/deleted referenced datasets.

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

Current records with neither a catalog nor a nonempty string object key produce
explicit blocking diagnostics, including the source ID for dependent queries.
Those with no valid inline JSON also remain incomplete in the final audit and are never
given invented empty datasets. A reader regression test also observed a missing-storage dataset with
column metadata yielding count zero; the resolver now reports that source as
unavailable. These checks preserve record bytes for recovery. The inline adapter now reads surviving flat JSON without inventing rows. Migration plans a
content-addressed object key, uploads the exact original bytes after locking the reviewed snapshot,
and commits catalog metadata while retaining original content and version numbers. Preview never
writes objects. Invalid history remains preserved and explicitly reported.

### Historical exceptions

As authorized, historical records that cannot be transformed or whose transformed
markup fails data validation are preserved byte-for-byte, including their metadata
and content. Valid historical records still migrate. Current-head failures and
the history resource limit remain blocking. A thrown validator failure aborts the
operation; it is not converted to a successful exception.

Preview, apply and audit use the same classification and return
`historicalExceptions: [{artifactId, version, reason}]`. These are the exceptions
for the returned page; callers must follow `nextCursor`, even when `done` is true.
`done` means that no eligible migration changes or blocking head/resource failures
remain globally, not that every historical version was converted. Exception-only
artifacts consume the page budget, so they cannot disappear from reporting.

The CLI inventories every final-audit page, saves the reports, aggregates all
exceptions and returns `completion: complete_with_historical_exceptions` when
appropriate. Its console output explicitly counts preserved exceptions. Before
any changed artifact is written, the existing backup and fingerprint still cover
the entire original head and history, including unchanged exceptional versions.

Exceptions are recomputed rather than stored as permanent exemptions. If content
or a referenced dataset is repaired, the next preview may find that version
eligible again. Restoring skipped markup still goes through normal publication
validation; missing-storage dataset versions are refused before archiving or
changing the head. Tests cover byte preservation, restore rejection, repeated
audit, exception-only pagination, repaired history and stale fingerprints.

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
2. After deployment of reviewed changes, obtain a fresh production preview and
   investigate residual reference, mutation, chart, date and syntax defects.
3. Retain durable private backups and define partial-apply recovery before applying
   reviewed current fingerprints. Verify public reader charts and all eight Show
   HN queries afterward. No rollout or new production preview is part of this change.
