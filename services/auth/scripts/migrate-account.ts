/** Offline operator entry point. Never imported or invoked by server startup. */
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {Kysely, PostgresDialect} from 'kysely';
import {migrateHumanAccountSchema} from '../src/auth/account-migration';
import {readEnv} from '../src/env';

/** The database and schema to migrate. The schema is the one startup checks (`AUTH__SCHEMA`,
 * default `auth`, as in src/parts.ts), so a deployment with its own auth schema migrates that
 * schema instead of reporting `auth` as compatible. */
export function migrationTarget(env: Record<string, string | undefined>): {connectionString: string; schema: string} {
  const connectionString = readEnv(env, 'AUTH__MIGRATION_DATABASE_URL');
  if (!connectionString) throw new Error('AUTH__MIGRATION_DATABASE_URL must identify the reviewed target database');
  return {connectionString, schema: readEnv(env, 'AUTH__SCHEMA') || 'auth'};
}

/** The refusal without the acknowledgement flag: what to do first, and the exact flag. */
export const ACKNOWLEDGEMENT_REQUIRED = 'Stop all auth/account writers and verify a restorable backup (restored on a disposable database), then rerun with --writes-paused-backup-verified and AUTH__MIGRATION_DATABASE_URL naming the reviewed target database.';

/** What the operator sees: our reviewed refusals verbatim; anything else (driver diagnostics can contain private
 * connection details) as one fixed line. */
export function operatorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^(Stop all auth\/account writers|AUTH__MIGRATION_DATABASE_URL|Duplicate authentication|Unexpected authentication|Unexpected legacy authentication|Invalid authentication schema)/.test(message)
    ? message : 'Authentication migration failed; keep writers stopped and inspect database state and diagnostics privately.';
}

async function main() {
  if (process.argv.slice(2).join(' ') !== '--writes-paused-backup-verified') throw new Error(ACKNOWLEDGEMENT_REQUIRED);
  const {connectionString, schema} = migrationTarget(process.env);
  const db = new Kysely<Record<string, unknown>>({dialect:new PostgresDialect({pool:new Pool({connectionString,max:1})})});
  try {
    const result = await migrateHumanAccountSchema(db, {writesPausedAndBackupVerified:true, schema});
    console.log(result.changed ? `Authentication account schema ${schema} migrated; issuer data retained.` : `Authentication account schema ${schema} already compatible; no changes.`);
  } finally {await db.destroy();}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(operatorMessage(error));
  process.exitCode = 1;
});
