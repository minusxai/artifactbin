/** Offline operator entry point. Never imported or invoked by server startup. */
import {Pool} from 'pg';
import {Kysely, PostgresDialect} from 'kysely';
import {migrateHumanAccountSchema} from '../src/auth/account-migration';
import {readEnv} from '../src/env';

async function main() {
  if (process.argv.slice(2).join(' ') !== '--writes-paused-backup-verified') {
    throw new Error('Read services/auth/ACCOUNT-MIGRATION.md; stop writers and verify a restorable backup before passing --writes-paused-backup-verified');
  }
  const connectionString = readEnv(process.env, 'AUTH__MIGRATION_DATABASE_URL');
  if (!connectionString) throw new Error('AUTH__MIGRATION_DATABASE_URL must identify the reviewed target database');
  const db = new Kysely<Record<string, unknown>>({dialect:new PostgresDialect({pool:new Pool({connectionString,max:1})})});
  try {
    const result = await migrateHumanAccountSchema(db, {writesPausedAndBackupVerified:true});
    console.log(result.changed ? 'Authentication account schema migrated; issuer data retained.' : 'Authentication account schema already compatible; no changes.');
  } finally {await db.destroy();}
}
main().catch(error => {
  // Driver diagnostics can contain private connection details. Only our reviewed refusal messages escape.
  const message = error instanceof Error ? error.message : '';
  console.error(/^(Read services\/auth|AUTH__MIGRATION_DATABASE_URL|Duplicate authentication|Unexpected authentication|Unexpected legacy authentication)/.test(message)
    ? message : 'Authentication migration failed; keep writers stopped and inspect database state and diagnostics privately.');
  process.exitCode = 1;
});

// probe: pull request lane type check timing
