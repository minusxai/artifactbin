/** Offline enrollment for a prepared company root after its audited default move. The review and
 * the durable completion record are scoped to that root. Only this command reads or writes them. */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import type {Queryable} from '@artifactbin/contracts/db';
import type {GroupRole} from '@artifactbin/contracts/groups';
import {IdentityError,type TransactionalQueryable} from '@artifactbin/contracts/identity-module';
import {readEnv} from '../src/env';
import {identityDbOf} from '../src/identity-store';
import {liveGroup,insertMissingGroupMembers,memberRole} from '../src/identity-store/group-access';
import {identityTables,internalId,type IdentityTables} from '../src/identity-store/tables';
import {plainIdentifier} from '../src/identity-store/views';
import {migrationTarget} from './migrate-account';

interface Target {
  appSchema: string;
  authSchema: string;
  ownerId: string;
  defaultId: string;
}

interface Account {
  id: string;
  admissionRevision: string;
  accountRevision: string;
  seatRevision: string | null;
  role: GroupRole | null;
  removed: boolean;
}

interface EnrollmentPlan extends Target {
  version: 1;
  moveId: string;
  hierarchyRevision: string;
  accounts: Account[];
}

interface Move {
  id: string;
  moved_at: string;
  actor_user_id: string;
  previous_default: string;
}

type LockedTarget = {
  app: string;
  tables: IdentityTables;
  revision: string;
  move: Move;
  completed?: string;
};

async function lockTarget(tx: Queryable, target: Target): Promise<LockedTarget> {
  if (!target.ownerId || !target.defaultId) throw new IdentityError('invalid_enrollment');
  const app = plainIdentifier(target.appSchema, 'app schema');
  const tables = identityTables(target.authSchema);
  // Prevent phantom admissions, account changes and membership writes through the final audit insert.
  // Take the same locks for plan and apply. Bound waits in case a writer was left running.
  await tx.query("SET LOCAL lock_timeout = '5s'");
  await tx.query(`LOCK TABLE ${tables.group_hierarchy},${tables.groups},${tables.group_members} IN SHARE ROW EXCLUSIVE MODE`);
  await tx.query(`LOCK TABLE ${tables.users},${app}.deployment_members IN SHARE MODE`);
  const state = (await tx.query<{owner_user_id: string | null; default_group_id: string | null; setup_complete: boolean}>(
    `SELECT d.owner_user_id,d.default_group_id,d.setup_complete FROM ${app}.deployment_state d
     JOIN ${app}.identity_settings i ON i.id='installation' AND i.deployment_mode='company'
     WHERE d.id='company' FOR UPDATE OF d FOR SHARE OF i`)).rows[0];
  if (!state?.setup_complete) throw new IdentityError('company_setup_required', 409);
  if (state.owner_user_id !== target.ownerId || !(await tx.query(
    `SELECT 1 FROM ${tables.users} WHERE id=$1 AND kind='account' AND email IS NOT NULL AND merged_into_user_id IS NULL`,
    [target.ownerId])).rows.length)
    throw new IdentityError('deployment_owner_required', 403);
  const group = state.default_group_id === target.defaultId && await liveGroup(tx, tables, target.defaultId);
  if (!group || group.parent_id !== null) throw new IdentityError('default_group_changed', 409);
  const revision = (await tx.query<{revision: string}>(`SELECT revision::text FROM ${tables.group_hierarchy}
    WHERE id='installation' AND role_model_version=2`)).rows[0]?.revision;
  if (revision === undefined) throw new IdentityError('group_role_upgrade_required', 409);

  await tx.query(`LOCK TABLE ${app}.group_audit IN SHARE ROW EXCLUSIVE MODE`);
  const completed = (await tx.query<{digest: string}>(`SELECT details->>'plan_digest' AS digest
    FROM ${app}.group_audit WHERE group_id=$1 AND action='company_root_enrolled'`, [target.defaultId])).rows[0]?.digest;
  const move = (await tx.query<Move>(`SELECT id,created_at::text AS moved_at,actor_user_id,
      details->>'previous_default_group_id' AS previous_default
    FROM ${app}.group_audit WHERE group_id=$1 AND action='company_default_changed' ORDER BY created_at DESC,id DESC LIMIT 1`,
    [target.defaultId])).rows[0];
  if (!move || move.actor_user_id !== target.ownerId || !move.previous_default || move.previous_default === target.defaultId ||
    !(await tx.query(`SELECT 1 FROM ${app}.group_audit WHERE group_id=$1 AND actor_user_id=$2
      AND action='company_root_prepared' AND details->>'previous_default_group_id'=$3 AND created_at <= $4::timestamptz`,
      [target.defaultId,target.ownerId,move.previous_default,move.moved_at])).rows.length)
    throw new IdentityError('prepared_default_move_required', 409);
  if (await memberRole(tx, tables, target.ownerId, target.defaultId) !== 'admin')
    throw new IdentityError('deployment_owner_required', 403);
  return {app,tables,revision,move,completed};
}

async function snapshot(tx: Queryable, target: Target, {app,tables,revision,move}: LockedTarget): Promise<EnrollmentPlan> {
  const accounts = (await tx.query<Account>(`SELECT u.id, d.xmin::text AS "admissionRevision",
    u.xmin::text AS "accountRevision", m.xmin::text AS "seatRevision", m.role, EXISTS (
      SELECT 1 FROM ${app}.group_audit a WHERE a.group_id=$1 AND a.action='member_removed' AND a.details->>'user_id'=u.id
    ) AS removed
    FROM ${app}.deployment_members d JOIN ${tables.users} u ON u.id=d.user_id
    LEFT JOIN ${tables.group_members} m ON m.group_id=$1 AND m.user_id=u.id
    WHERE d.admitted_at <= $2::timestamptz AND u.kind='account' AND u.email IS NOT NULL AND u.merged_into_user_id IS NULL
    ORDER BY u.id COLLATE "C"`, [target.defaultId,move.moved_at])).rows;
  return {...target,version:1,moveId:move.id,hierarchyRevision:revision,accounts};
}

export function planCompanyRootEnrollment(db: TransactionalQueryable, target: Target): Promise<EnrollmentPlan> {
  return db.transaction(async tx => {
    const locked = await lockTarget(tx, target);
    if (locked.completed) throw new IdentityError('root_already_enrolled', 409);
    return snapshot(tx, target, locked);
  });
}

export function enrollCompanyRoot(db: TransactionalQueryable, target: Target, reviewed: unknown): Promise<'applied' | 'already_applied'> {
  return db.transaction(async tx => {
    const locked = await lockTarget(tx, target);
    const digest = createHash('sha256').update(JSON.stringify(reviewed ?? null)).digest('hex');
    if (locked.completed) {
      if (locked.completed === digest) return 'already_applied';
      throw new IdentityError('root_already_enrolled', 409);
    }
    const current = await snapshot(tx, target, locked);
    if (!isDeepStrictEqual(reviewed, current)) throw new IdentityError('enrollment_plan_changed', 409);
    const {app,tables} = locked;
    const added = await insertMissingGroupMembers(tx, tables, target.defaultId,
      current.accounts.filter(account => account.role === null && !account.removed).map(account => account.id));
    await tx.query(`INSERT INTO ${app}.group_audit(id,group_id,actor_user_id,action,details)
      VALUES($1,$2,$3,'company_root_enrolled',jsonb_build_object(
        'default_move_id',$4::text,'plan_digest',$5::text,'added_user_ids',$6::text[],'role','member'))`,
      ['ga_' + internalId(),target.defaultId,target.ownerId,current.moveId,digest,added]);
    return 'applied';
  });
}

const usage = 'Usage: enroll:company-root -- --writes-paused-backup-verified OWNER_ID CURRENT_DEFAULT_ID plan | apply REVIEWED_PLAN.json';
async function main() {
  const [ack,ownerId,defaultId,operation,file,...extra] = process.argv.slice(2);
  if (ack !== '--writes-paused-backup-verified' || !ownerId || !defaultId || extra.length ||
    !(operation === 'plan' && !file || operation === 'apply' && file)) throw new Error(usage);
  const {connectionString,schema:authSchema} = migrationTarget(process.env);
  const appSchema = readEnv(process.env,'APP__SCHEMA') || 'app';
  const target = {appSchema,authSchema,ownerId,defaultId};
  const pool = new Pool({connectionString,max:1});
  try {
    const db = identityDbOf(pool);
    if (operation === 'plan') console.log(JSON.stringify(await planCompanyRootEnrollment(db,target),null,2));
    else console.log(await enrollCompanyRoot(db,target,JSON.parse(await readFile(file!,'utf8'))));
  } finally {
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  if (error instanceof IdentityError) console.error(`Root enrollment refused (${error.code}).`);
  else if (error instanceof Error && (error.message === usage || error.message.startsWith('AUTH__MIGRATION_DATABASE_URL must')))
    console.error(error.message);
  else console.error('Root enrollment failed. Inspect the database state and diagnostics privately.');
  process.exitCode = 1;
});
