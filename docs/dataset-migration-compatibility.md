# Dataset migration compatibility

## Scope and contracts

This migration gives legacy stored datasets their catalog metadata, in the head and in
retained versions (`services/app/lib/datasets/migrate.ts`). It changes dataset metadata
only. Every document version stays byte-identical: document SQL moves to the `<Import>`
syntax and SQLite through the separate SQLite syntax migration (`services/app/lib/migrate/`),
which reads the legacy `ref_<id>` tables itself. Query names, node IDs, retained-version
transactions and fingerprints are preserved.

A migrated dataset is read the one way every dataset is: a document imports it
(`<Import name="d" src="ref:<id>" />`) and its compiled queries read `d.rows` on the SQLite
engine, with source authorization and access checks on every read.

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

Historical records that cannot be migrated are preserved byte-for-byte, including their
metadata and content. Valid
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

Migration writes metadata only; an object upload is the original bytes, content-addressed.
A batch holds at most 100 artifacts, and an artifact with more retained versions than the
history limit is a blocking conflict rather than a partial migration.
