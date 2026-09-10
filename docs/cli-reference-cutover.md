# Reference cutover

This is a maintenance migration, not a runtime compatibility layer. Published Query/Mutation sources
use `ref:<id>`; SQL names tables. Old bare source IDs and SQL `ref_<id>` artifact aliases are rejected
by normal reads and writes. Local query bindings such as `$sales` keep their separate meaning.

Run the migration on a disposable copy first, then during a write-maintenance window. Keep a full
SQL/object-store backup before the release. Stop agent/browser writes and background writers while
inventorying and applying; per-artifact transactions detect concurrent head or history changes, but
there is no database-wide snapshot spanning the entire inventory.

The operator command takes ADMIN__SECRET from its environment and never prints it:

```sh
node scripts/dataset-catalog-migrate.mjs --url https://your-server.example --backup-dir /private/path/preview
node scripts/dataset-catalog-migrate.mjs --url https://your-server.example --backup-dir /private/path/apply --apply
```

The first command makes no server writes and walks every preview page. Each page contains the original
head and all retained versions, proposed source/catalog changes, a fingerprint, and any ambiguity.
Reports are private files (0600 in a newly created 0700 directory). Use a new private backup directory
for each run. Treat these reports as database backups: they contain document data and metadata.

`--apply` inventories again and saves every page durably before its first write. If any page contains a
conflict, nothing is applied. Each apply request names only reviewed artifact IDs and fingerprints;
the server refuses a changed snapshot. It locks the head and retained versions and checks them again
before committing. A lost apply response can produce a snapshot conflict on retry; keep the backup
and run a new preview, which recognizes already-migrated content. Never bypass the fingerprint check.

A successful batch preserves artifact IDs/URLs, content version numbers, node IDs, ACLs, comments,
and object-store keys. Changed heads receive a fresh edit ID so outstanding editors must refresh.
Deleted artifacts and all retained markup versions are included. Unknown targets, conflicting explicit
sources, unsupported SQL spans, excessive history, or failed data validation require manual review;
the migration leaves those artifacts unchanged.

`--apply` finishes with a fresh audit and fails if any changes or conflicts remain. Run a new dry-run
to confirm the maintenance snapshot before resuming writes. Check representative
rendered documents, joined dataset queries, comments, and restoration of historical versions. Then
resume writes on the CLI-first release. Keep the pre-release database backup for rollback. For a
partial migration failure, keep writes stopped and restore the full backup with the pre-release
application; do not restore selected source strings under a running newer application.

Executable evidence lives in the dataset-catalog migration, admin, rehearsal, and operator CLI tests.
The rehearsal executes joined queries and restores migrated history through real HTTP handlers.
