# Dataset migration compatibility

## Scope and contracts

Migration covers legacy stored-dataset read queries, missing catalog metadata and explicitly
reported historical exceptions (`services/app/lib/datasets/migrate.ts`).

The planner owns token-preserving SQL rewrites and collision-safe upstream names.
Legacy read computations remain in the document SQL engine over explicitly named
source inputs. Mutations retain the dataset compiler and authorized write path.
Existing canonical source queries are unchanged by migration. Query names,
surrounding node IDs, retained-version transactions and fingerprints are preserved.

The shared dataflow evaluator distinguishes displayed query results from complete
inputs to dependent computations. For exactly `select * from public.rows`, it
can bind the complete authorized stored table internally (`lib/sql/dataflow-core.ts`).
The server composition supplies that table only for a physical stored relation (or an
already resolved computed source such as a folder). Models, remote catalogs and filtered
queries do not use this path. Source authorization and final access/snapshot checks remain
mandatory. Display pagination and output limits remain in effect.

The CLI uses the same evaluator with complete local input files.

## Metadata and diagnostics

A valid legacy object key makes its catalog available during preview, regardless of
document/dataset ID order. Planning and execution share the same pure metadata
interpretation, so there is no staged-write or proposed-state resolver.

Inventory and audit include records whose catalog is an explicit JSON null, in both heads
and retained versions, because an object key can still make them recoverable.

Records with neither a catalog nor a nonempty string object key produce explicit blocking
diagnostics, including the source ID for dependent queries. Those with no valid inline JSON
remain incomplete in the final audit and are never given invented empty datasets. A
missing-storage dataset with column metadata is reported as an unavailable source rather
than as a count of zero. These checks preserve record bytes for recovery, and the inline
adapter reads surviving flat JSON without inventing rows.

Migration plans a content-addressed object key, uploads the exact original bytes after
locking the reviewed snapshot, and commits catalog metadata while retaining original
content and version numbers. Preview never writes objects. Invalid history remains
preserved and explicitly reported.

## Historical exceptions

Historical records that cannot be transformed, or whose transformed markup fails data
validation, are preserved byte-for-byte, including their metadata and content. Valid
historical records still migrate. Current-head failures and the history resource limit
remain blocking. A thrown validator failure aborts the operation; it is not converted to a
successful exception.

Preview, apply and audit use the same classification and return
`historicalExceptions: [{artifactId, version, reason}]`. These are the exceptions
for the returned page; callers must follow `nextCursor`, even when `done` is true.
`done` means that no eligible migration changes or blocking head/resource failures
remain globally, not that every historical version was converted. Exception-only
artifacts consume the page budget, so they cannot disappear from reporting.

Before any changed artifact is written, the backup and fingerprint cover the entire
original head and history, including unchanged exceptional versions.

Exceptions are recomputed rather than stored as permanent exemptions. If content
or a referenced dataset is repaired, the next preview may find that version
eligible again. Restoring skipped markup still goes through normal publication
validation; missing-storage dataset versions are refused before archiving or
changing the head.

## Cost

Complete materialization uses memory proportional to the stored inputs, as legacy
document execution did. Source result execution adds work and the server may
decode the cached object again for the full input; this path is not a streaming
or memory optimization. Existing engine input and timeout limits still apply.
