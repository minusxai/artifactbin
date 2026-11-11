# Platform

Infrastructure every product module stands on: settings (`config.ts`), the two database adapters (`db.ts`), the
schema as data (`schema.ts`), ids, the event outbox, the request scope, the injected services and conflict retry.
No product rules live here. Server-only.

## Rules
- Other modules import the index, `index.ts`, never a file here, and never from browser-bundled code. Export a new
  name through the index. A downstream deployment also imports `config.ts`, `db.ts` and `services.ts` by path, so
  their exports are pinned by `services/app/__tests__/downstream-exports.test.ts`: renaming one breaks it.
- The boot is the migration: every start runs `SCHEMA_STATEMENTS` (idempotent DDL) and then `applyBackfills`.
  So a schema change is additive. A column added to an existing table is nullable or has a `default`. A unique
  constraint on an existing table goes in `indexes` with `unique: true` (`uniques` render only inside CREATE TABLE).
  A rename is `renamedFrom` (copies, then drops). A row migration is an idempotent statement in `applyBackfills`.
- `dropped` (columns) and `DROPPED_TABLES` delete data on every boot, with no undo: only for data nothing reads.
- Schema procedure: edit the table in `schema.ts` (a new table also joins `TABLES`), then `npm run render:schema`,
  which rewrites `SCHEMA.sql`, `roles.sql`, `grants.sql` and `IDENTITY.sql` (the shared identity views MinusX reads, from
  lib/groups `identity-views.ts`; MinusX copies it byte for byte) at the repo root. `schema-sql-fresh.test.ts` fails on a
  stale file; `schema-ownership.test.ts` fails when two packages declare one table.
- Settings procedure: read it in `config.ts`, the only file that reads the process environment, through
  `env(module, name)` (one `MODULE__NAME` spelling, no fallback), and export it through the index. Add it to
  `.env.example`, then run `npm run generate:env-snapshot`, which rewrites `ENV_EXAMPLE_BASE64` in
  `scripts/lib/setup-plan.mjs`.
- `PgliteDb` is one connection: every operation, whole transactions and closing included, goes through its
  `serialize` queue. Never add one that bypasses it, and never serialize `PostgresDb`, whose pool is
  concurrency-safe. Both implement one `Db` interface; keep their behaviour the same.
- Events leave through the outbox: `recordEvent` and `enqueueEvent` write in the caller's transaction, and
  `startEventPublisher` sends after commit (`publishEventOutbox` flushes on demand, for the public events feed).
  Never call the events service inside a transaction. A type `/api/events` serves is recorded this way, never `emit`.
- `retryOnConflict` re-runs the whole transaction: wrap only work whose effects stay inside it or are idempotent.

## Checks
- After a schema edit: `npm run render:schema`, then
  `npm test -- --files services/app/lib/__tests__/schema-sql-fresh.test.ts services/app/lib/__tests__/schema-ownership.test.ts scripts/__tests__/render-schema-runs.test.mjs`
- After a settings edit: `npm run generate:env-snapshot`, then
  `npm test -- --files services/app/lib/platform/__tests__/config.test.ts services/app/lib/__tests__/env-namespacing.test.ts scripts/__tests__/setup-plan.test.mjs`
- Adapters, outbox, index:
  `npm test -- --files services/app/lib/platform/__tests__/db-and-outbox.test.ts services/app/lib/platform/__tests__/platform-contract.test.ts services/app/__tests__/downstream-exports.test.ts`
