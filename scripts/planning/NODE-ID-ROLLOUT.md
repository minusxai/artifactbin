# Source node identity rollout

Deploy the compatibility release first. It must understand stamped source IDs,
the lifetime reservation and alias tables, multi-change edit history, and legacy
annotation anchors before any document is converted. Verify that exact build as
the sole rollback target before starting the backfill.

Preview one bounded batch (dry-run is the default):

```sh
ADMIN__SECRET=... node scripts/node-identity-migrate.mjs --url https://artifact.example
```

Apply only after reviewing the report:

```sh
ADMIN__SECRET=... node scripts/node-identity-migrate.mjs --url https://artifact.example --apply --batch-size 25
```

The CLI calls the running app over HTTP; it never opens PGLite separately. Each
artifact, its source materialization, history/edit record, comment targets,
aliases, reservations, and cursor advance commit atomically. Calls are bounded
to 1–100 artifacts and historical scanning is capped per artifact. The cursor is
durable, so retrying resumes safely.

A duplicate legacy anchor or history-cap conflict returns HTTP 409, stops the
CLI, leaves that artifact and cursor untouched, and requires manual inspection.
Never bypass it by moving the cursor or bulk-repointing annotations by key.

Rollback is compatibility-only: stop the backfill and redeploy the verified
compatibility release. Do not deploy an older binary after any conversion; old
code treats comment anchors as source-writing metadata and cannot safely edit a
converted document. There is no reverse backfill and no automatic production
execution.
