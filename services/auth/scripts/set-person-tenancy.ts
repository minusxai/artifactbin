/** PostgreSQL operator entry point for assigning or clearing an account's data tenancy. */
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import type {Queryable} from '@artifactbin/contracts/db';
import {IdentityError} from '@artifactbin/contracts/identity-module';
import {identityTables} from '../src/identity-store/tables';
import {migrationTarget} from './migrate-account';

export async function setPersonTenancy(db: Queryable, schema: string, id: string, expected: string | null, tenancy: string | null) {
  const valid = (value: string | null) => value === null || (value.trim() && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value));
  if (!id || !valid(expected) || !valid(tenancy)) throw new IdentityError('invalid_person_tenancy');
  const {users} = identityTables(schema);
  const {rows} = await db.query(`UPDATE ${users} SET tenancy_id=$3
    WHERE id=$1 AND kind='account' AND merged_into_user_id IS NULL
      AND tenancy_id IS NOT DISTINCT FROM $2::text
    RETURNING id`, [id, expected, tenancy]);
  if (rows.length !== 1) throw new IdentityError('person_tenancy_changed_or_missing', 409);
}

const usage = "Usage: set:person-tenancy -- PERSON_ID EXPECTED_TENANCY NEW_TENANCY (use '' for no binding)";
async function main() {
  const [id, expected, value, ...extra] = process.argv.slice(2);
  if (!id || expected === undefined || value === undefined || extra.length) throw new Error(usage);
  const {connectionString, schema} = migrationTarget(process.env);
  const pool = new Pool({connectionString, max: 1});
  try {
    await setPersonTenancy(pool, schema, id, expected || null, value || null);
    console.log('Personal tenancy updated.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  if (error instanceof IdentityError) console.error(`Personal tenancy refused (${error.code}).`);
  else if (error instanceof Error && (error.message === usage || error.message.startsWith('AUTH__MIGRATION_DATABASE_URL must')))
    console.error(error.message);
  else console.error('Personal tenancy update failed. Inspect database diagnostics privately.');
  process.exitCode = 1;
});
