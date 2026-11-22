/** Operator-run company root backfill. The account binding proves a handle sign-in. For an email subject
 * only creating an issuer group leaves comparable provenance. Membership, admission and sessions alone
 * can all come from a manual invitation. Other email subjects join on their next verified sign-in.
 * Run with AUTH__MIGRATION_DATABASE_URL and the deployment's AUTH__SCHEMA and APP__SCHEMA.
 */
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {identityDbOf} from '../src/identity-store';
import {backfillTrustedRoot} from '../src/identity-store/trusted-root-backfill';
import {migrationTarget} from './migrate-account';

async function main() {
  const {connectionString,schema} = migrationTarget(process.env);
  const pool = new Pool({connectionString,max:1});
  try {
    const count = await backfillTrustedRoot(identityDbOf(pool),schema,process.env.APP__SCHEMA || 'public');
    console.log(`Added ${count} company root memberships.`);
  } finally {await pool.end();}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error('Company root backfill failed. Check the target database, schemas and company setup.');
  process.exitCode=1;
});
