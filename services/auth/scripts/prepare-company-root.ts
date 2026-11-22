/** Offline PostgreSQL entry point for the installation operator. No application or identity route calls it. */
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {IdentityError,type TransactionalQueryable} from '@artifactbin/contracts/identity-module';
import {normalizeCreateGroup} from '@artifactbin/contracts/groups';
import {readEnv} from '../src/env';
import {identityDbOf} from '../src/identity-store';
import {bumpHierarchy,insertGroup,liveGroup} from '../src/identity-store/group-access';
import {identityTables,internalId} from '../src/identity-store/tables';
import {plainIdentifier} from '../src/identity-store/views';
import {migrationTarget} from './migrate-account';

interface Preparation {
  appSchema: string;
  authSchema: string;
  ownerId: string;
  defaultId: string;
  expectedRevision: number;
  handle: string;
  name: string;
}

export async function prepareCompanyRoot(db: TransactionalQueryable, input: Preparation): Promise<string> {
  const {ownerId, defaultId, expectedRevision} = input;
  const group = normalizeCreateGroup({handle: input.handle, name: input.name});
  if (!group || !ownerId || !defaultId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new IdentityError('invalid_preparation');
  const app = plainIdentifier(input.appSchema, 'app schema');
  const t = identityTables(input.authSchema);
  return db.transaction(async tx => {
    // Same first lock as ordinary topology writes. Any refusal rolls the increment back.
    const revision = await bumpHierarchy(tx, t);
    if (revision - 1 !== expectedRevision) throw new IdentityError('hierarchy_changed', 409);
    // Serialize with company setup. Hold the mode stable too, throughout the preparation.
    const state = (await tx.query<{owner_user_id: string | null; default_group_id: string | null; setup_complete: boolean}>(
      `SELECT d.owner_user_id,d.default_group_id,d.setup_complete FROM ${app}.deployment_state d
       JOIN ${app}.identity_settings i ON i.id='installation' AND i.deployment_mode='company'
       WHERE d.id='company' FOR UPDATE OF d FOR SHARE OF i`)).rows[0];
    if (!state?.setup_complete) throw new IdentityError('company_setup_required', 409);
    if (state.owner_user_id !== ownerId || !(await tx.query(
      `SELECT id FROM ${t.users} WHERE id=$1 AND kind='account' AND email IS NOT NULL AND merged_into_user_id IS NULL`, [ownerId])).rows.length)
      throw new IdentityError('deployment_owner_required', 403);
    const previous = state.default_group_id === defaultId && await liveGroup(tx, t, defaultId);
    if (!previous || previous.parent_id !== null) throw new IdentityError('default_group_changed', 409);
    const id = await insertGroup(tx, t, ownerId, group);
    // This maintenance transaction spans both schemas. The new root has no audience to invalidate.
    await tx.query(`INSERT INTO ${app}.group_audit(id,group_id,actor_user_id,action,details)
      VALUES($1,$2,$3,'company_root_prepared',jsonb_build_object('previous_default_group_id',$4::text))`,
      ['ga_' + internalId(), id, ownerId, defaultId]);
    return id;
  });
}

const usage = 'Usage: prepare:company-root -- --writes-paused-backup-verified OWNER_ID CURRENT_DEFAULT_ID HIERARCHY_REVISION HANDLE "NAME"';
async function main() {
  const [ack, ownerId, defaultId, revision, handle, name, ...extra] = process.argv.slice(2);
  if (ack !== '--writes-paused-backup-verified' || !ownerId || !defaultId || !revision || !/^\d+$/.test(revision) || !handle || !name || extra.length)
    throw new Error(usage);
  const {connectionString, schema: authSchema} = migrationTarget(process.env);
  const appSchema = readEnv(process.env, 'APP__SCHEMA') || 'app';
  const pool = new Pool({connectionString, max: 1});
  try {
    console.log(await prepareCompanyRoot(identityDbOf(pool), {
      appSchema, authSchema, ownerId, defaultId, expectedRevision: Number(revision), handle, name,
    }));
  } finally {
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  if (error instanceof IdentityError) console.error(`Root preparation refused (${error.code}).`);
  else if (error instanceof Error && (error.message === usage || error.message.startsWith('AUTH__MIGRATION_DATABASE_URL must')))
    console.error(error.message);
  else console.error('Root preparation failed. Inspect the database state and diagnostics privately.');
  process.exitCode = 1;
});
