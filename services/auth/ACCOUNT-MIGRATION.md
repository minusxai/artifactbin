# Better Auth account schema upgrade

Better Auth 1.7.0–1.7.2 required `account.issuer` and a unique
`(issuer, accountId)` index. Version 1.7.3 reversed this requirement; 1.7.7
identifies accounts by `(providerId, accountId)`. Existing 1.7.2 databases
need the explicit operation below. Fresh 1.7.7 and pre-issuer 1.6 schemas
need no issuer cleanup. Generated `SCHEMA.sql` describes fresh databases only;
never apply its issuer-column omission as a DROP COLUMN on an existing database.
Startup checks compatibility and refuses the legacy
schema with instructions; it never automatically runs this operation. It also
refuses duplicate `(providerId, accountId)` identities on already-compatible
nullable/no-issuer schemas, using a read-only audit. It never automatically
merges identities or modifies data at startup.

Upstream: [account schema change](https://github.com/better-auth/better-auth/blob/v1.7.7/docs/content/blogs/1-7-account-schema.mdx),
[upgrade guide](https://github.com/better-auth/better-auth/blob/v1.7.7/docs/content/docs/guides/1-7-upgrade-guide.mdx).

1. Inventory every auth/account writer and shared verification/cookie participant.
   Stop all such writers and keep them stopped through the coordinated upgrade.
   An exclusive transaction lock protects the operation, but does not make mixed
   old/new binaries safe after commit.
2. Take a backup and prove restoration on a disposable database. Test the
   candidate and this operation on that restored copy before scheduling cutover.
   Independently confirm the target and database owner credentials. Supply the
   connection through the protected `AUTH__MIGRATION_DATABASE_URL` environment
   setting; never place credentials in command arguments or logs.
3. From the candidate checkout with installed dependencies, run:

   ```sh
   npm run migrate:account -w services/auth -- --writes-paused-backup-verified
   ```

   The operation locks `auth.account` on its transaction connection, audits
   duplicate `(providerId, accountId)` groups, and refuses unresolved collisions
   without merging or deleting identities. Resolve identity ownership separately
   under review; do not guess. Unexpected issuer or legacy-index definitions also
   refuse without changes. It makes the existing issuer column nullable and
   removes only the verified legacy unique index. It retains the column, all
   issuer values, account IDs, users, and sessions. Repeated runs are no-ops.
4. Start all participants on the coordinated candidate version. Verify OTP,
   returning and new social sign-in, existing session resolution, and identity
   continuity before restoring traffic. Restart pending OAuth/account-linking
   flows; old pending verification state may be rejected by the security update.

Before candidate writes, rollback can restore the coordinated, verified snapshot
and old runtime with writers stopped. After candidate writes, **do not roll back
only the package/binary**: new accounts have NULL issuer, and the old runtime can
create duplicate identities. Either restore a coordinated snapshot with explicitly
accepted loss of intervening writes, or develop a separately reviewed forward-data
reconciliation using verified provider configuration and collision audits. Never
invent issuer values, drop the issuer column, or silently delete/merge identities.

The exported `migrateHumanAccountSchema` also accepts an existing Kysely handle
for isolated PGLite/Postgres tests. All inspection and mutation inside the migration
use the transaction handle; no out-of-transaction query is enqueued on PGLite.
