/** Offline PostgreSQL operator command. Review a prepared-root move, commit it once, or compensate its sealed
 * edges and default. One connection spans the identity writer and app effects. No API route uses this command. */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {Pool} from 'pg';
import type {Queryable} from '@artifactbin/contracts/db';
import {IdentityError,type GroupChange,type TransactionalQueryable} from '@artifactbin/contracts/identity-module';
import {readEnv} from '@artifactbin/auth/env';
import {identityDbOf} from '@artifactbin/auth/identity-store';
import {bumpHierarchy} from '@artifactbin/auth/identity-store/group-access';
import {writeGroupParent} from '@artifactbin/auth/identity-store/groups';
import {identityTables} from '@artifactbin/auth/identity-store/tables';
import {plainIdentifier} from '@artifactbin/auth/identity-store/views';
import {recordGroupChangesInTransaction} from '@/lib/groups';
import {projectNotifications} from '@/lib/notifications';
import {setEventProjection} from '@/lib/platform';

interface Target {
  appSchema: string;
  authSchema: string;
  readSchema: string;
  ownerId: string;
}

interface Request extends Target {
  expectedRevision: number;
  defaultId: string;
  rootId: string;
  branchIds: string[];
}

interface State {
  revision: number;
  defaultId: string;
  defaultVersion: string;
}

interface Plan extends Request {
  version: 1;
  id: string;
  preparationId: string;
  before: State;
}

interface Receipt {
  plan: Plan;
  after: State;
}

const receiptId = /^ga_move_[a-f0-9]{64}$/;
const revisionIsValid = (revision: number) => Number.isSafeInteger(revision) && revision >= 0;
const isId = (id: unknown): id is string => typeof id === 'string' && !!id;

/** Ensure unqualified app queries see the views wired to this installation before they project effects. */
async function checkIdentityViews(tx: Queryable, app: string, auth: string, read: string): Promise<void> {
  const sources = [
    ['groups', `${auth}.groups`],
    ['group_members', `${auth}.group_members`],
    ['group_admins', `${auth}.groups`],
    ['group_admins', `${auth}.group_members`],
    ['users', `${auth}.users`],
    ['users', `${app}.identity_settings`],
    ['users', `${app}.deployment_state`],
  ];
  const invalid = await tx.query(`SELECT 1 FROM unnest($1::text[],$2::text[]) AS expected(view_name,source)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_class view JOIN pg_rewrite rule ON rule.ev_class=view.oid
      JOIN pg_depend dep ON dep.objid=rule.oid AND dep.classid='pg_rewrite'::regclass AND dep.refclassid='pg_class'::regclass
      WHERE view.relkind='v' AND view.oid=to_regclass(expected.view_name)
        AND view.oid=to_regclass($3 || '.' || expected.view_name) AND dep.refobjid=to_regclass(expected.source)
    ) LIMIT 1`,[sources.map(([view])=>view),sources.map(([,source])=>source),read]);
  if (invalid.rows.length) throw new IdentityError('identity_views_mismatch',409);
}

async function lockTarget(tx: Queryable, target: Target) {
  const app = plainIdentifier(target.appSchema, 'app schema');
  const auth = plainIdentifier(target.authSchema, 'auth schema');
  const read = plainIdentifier(target.readSchema, 'identity read schema');
  if (new Set([app,auth,read]).size !== 3) throw new IdentityError('split_schema_required');
  const tables = identityTables(auth);
  await tx.query("SET LOCAL lock_timeout = '5s'");
  await tx.query(`SET LOCAL search_path TO pg_catalog,${app},${read},pg_temp`);
  // Ordinary topology writers take this row first. Pausing writers is required for the maintenance window.
  const revision = Number((await tx.query<{revision: string}>(`SELECT revision FROM ${tables.group_hierarchy}
    WHERE id='installation' AND role_model_version=2 FOR UPDATE`)).rows[0]?.revision);
  if (!revisionIsValid(revision) || revision === Number.MAX_SAFE_INTEGER) throw new IdentityError('hierarchy_revision_unavailable',409);
  const deployment = (await tx.query<{owner: string; defaultId: string; defaultVersion: string; complete: boolean}>(
    `SELECT d.owner_user_id AS owner,d.default_group_id AS "defaultId",d.xmin::text AS "defaultVersion",d.setup_complete AS complete
     FROM ${app}.deployment_state d JOIN ${app}.identity_settings i ON i.id='installation' AND i.deployment_mode='company'
     WHERE d.id='company' FOR UPDATE OF d FOR SHARE OF i`)).rows[0];
  if (!deployment?.complete || !deployment.defaultId) throw new IdentityError('company_setup_required',409);
  if (deployment.owner !== target.ownerId || !(await tx.query(`SELECT u.id FROM ${tables.users} u
    JOIN ${auth}."user" h ON h.id=u.id AND lower(h.email)=lower(u.email) AND h."emailVerified"
    WHERE u.id=$1 AND u.kind='account' AND NOT u.test_account AND u.merged_into_user_id IS NULL
    FOR SHARE OF u,h`,[target.ownerId])).rows.length) throw new IdentityError('deployment_owner_required',403);
  await checkIdentityViews(tx,app,auth,read);
  const state: State = {revision,defaultId:deployment.defaultId,defaultVersion:deployment.defaultVersion};
  return {app,tables,state};
}
type Locked = Awaited<ReturnType<typeof lockTarget>>;

function normalize(request: Request): Request {
  const {appSchema,authSchema,readSchema,ownerId,expectedRevision,defaultId,rootId,branchIds} = request;
  if (!isId(ownerId) || !isId(defaultId) || !isId(rootId) || rootId===defaultId || !revisionIsValid(expectedRevision) ||
      !Array.isArray(branchIds) || branchIds.some(id=>!isId(id) || id===rootId) ||
      new Set(branchIds).size!==branchIds.length) throw new IdentityError('invalid_move_plan');
  return {appSchema,authSchema,readSchema,ownerId,expectedRevision,defaultId,rootId,branchIds:[...branchIds].sort()};
}

async function eligible(tx: Queryable, locked: Locked, request: Request, attached: boolean): Promise<void> {
  const {tables} = locked;
  const {rootId,defaultId,branchIds,ownerId} = request;
  const ids = [...new Set([rootId,defaultId,...branchIds])];
  const groups = (await tx.query<{id: string; parent_id: string|null; trusted_issuer: string|null}>(`SELECT id,parent_id,trusted_issuer
    FROM ${tables.groups} WHERE id=ANY($1::text[]) AND deleted_at IS NULL ORDER BY id COLLATE "C" FOR UPDATE`,[ids])).rows;
  const admins = new Set((await tx.query<{group_id: string}>(`SELECT group_id FROM ${tables.group_members}
    WHERE group_id=ANY($1::text[]) AND user_id=$2 AND role='admin' FOR SHARE`,[ids,ownerId])).rows.map(row=>row.group_id));
  const moving = new Set(branchIds);
  if (groups.length!==ids.length || groups.some(group=>!admins.has(group.id) ||
    group.parent_id!==(attached && moving.has(group.id) ? rootId : null) ||
    (group.id===rootId && group.trusted_issuer!==null))) throw new IdentityError('branch_ineligible',409);
  const children = (await tx.query<{id: string}>(`SELECT id FROM ${tables.groups}
    WHERE parent_id=$1 AND deleted_at IS NULL`,[rootId])).rows;
  if (children.length!==(attached ? moving.size : 0) || children.some(group=>!moving.has(group.id)))
    throw new IdentityError('branch_ineligible',409);
}

async function snapshot(tx: Queryable, locked: Locked, request: Request): Promise<Plan> {
  const {app,state} = locked;
  if (state.revision!==request.expectedRevision || state.defaultId!==request.defaultId)
    throw new IdentityError('move_state_changed',409);
  await eligible(tx,locked,request,false);
  const prep = (await tx.query<{id: string}>(`SELECT id FROM ${app}.group_audit WHERE group_id=$1 AND actor_user_id=$2
    AND action='company_root_prepared' AND details->>'previous_default_group_id'=$3`,
    [request.rootId,request.ownerId,request.defaultId])).rows;
  if (prep.length!==1) throw new IdentityError('prepared_root_required',409);
  const body = {...request,version:1 as const,preparationId:prep[0].id,before:state};
  const id = 'ga_move_'+createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return {...body,id};
}

export function planCompanyMove(db: TransactionalQueryable, request: Request): Promise<Plan> {
  const normalized = normalize(request);
  return db.transaction(async tx=>{
    const locked = await lockTarget(tx,normalized);
    const plan = await snapshot(tx,locked,normalized);
    await tx.query(`INSERT INTO ${locked.app}.group_audit(id,group_id,actor_user_id,action,details)
      VALUES($1,$2,$3,'company_move_planned',$4::jsonb) ON CONFLICT(id) DO NOTHING`,
      [plan.id+'_plan',plan.rootId,plan.ownerId,JSON.stringify(plan)]);
    await requireSeal(tx,locked.app,plan);
    return plan;
  });
}

async function requireSeal(tx: Queryable, app: string, plan: Plan): Promise<void> {
  const sealed = (await tx.query<{details: Plan}>(`SELECT details FROM ${app}.group_audit WHERE id=$1 AND
    actor_user_id=$2 AND group_id=$3 AND action='company_move_planned'`,[plan.id+'_plan',plan.ownerId,plan.rootId])).rows[0];
  if (!sealed) throw new IdentityError('sealed_move_required',409);
  if (!isDeepStrictEqual(plan,sealed.details)) throw new IdentityError('move_plan_changed',409);
}

async function receipt(tx: Queryable, app: string, id: string, ownerId: string): Promise<Receipt|undefined> {
  return (await tx.query<{receipt: Receipt}>(`SELECT details->'sealed_move' AS receipt FROM ${app}.group_audit
    WHERE id=$1 AND actor_user_id=$2 AND action='company_default_changed' AND details ? 'sealed_move'`,[id,ownerId])).rows[0]?.receipt;
}

function expectState(current: State, expected: State) {
  if (!isDeepStrictEqual(current,expected)) throw new IdentityError('move_state_changed',409);
}

async function commit(tx: Queryable, {tables,app}: Locked, plan: Plan, inverse: boolean): Promise<void> {
  const {ownerId,rootId,defaultId,branchIds,id} = plan;
  const revision = await bumpHierarchy(tx,tables);
  const nextDefault = inverse ? defaultId : rootId;
  const oldDefault = inverse ? rootId : defaultId;
  const auditId = inverse ? id+'_inverse' : id;
  const changes: GroupChange[] = [];
  for (const branch of branchIds)
    changes.push(...await writeGroupParent(tx,tables,ownerId,branch,inverse ? rootId : null,inverse ? null : rootId,
      {company_move_id:id,...(inverse ? {compensates_move_id:id} : {})}));
  const {defaultVersion} = (await tx.query<{defaultVersion:string}>(`UPDATE ${app}.deployment_state
    SET default_group_id=$1 WHERE id='company' RETURNING xmin::text AS "defaultVersion"`,[nextDefault])).rows[0];
  const after = {revision,defaultId:nextDefault,defaultVersion};
  changes.push({id:auditId,groupId:nextDefault,actorId:ownerId,action:'company_default_changed',recipients:[],
    details:{previous_default_group_id:oldDefault,sealed_move:{plan,after},...(inverse ? {compensates_move_id:id} : {})}});
  // Only moved subtrees can lose an approval's ancestry witness.
  await recordGroupChangesInTransaction(tx,changes,{approvalChanges:changes.filter(change=>change.action==='reparented')});
  if (!isDeepStrictEqual(await receipt(tx,app,auditId,ownerId),{plan,after}))
    throw new IdentityError('move_receipt_conflict',409);
}

export function applyCompanyMove(db: TransactionalQueryable, target: Target, reviewed: Plan): Promise<'applied'|'already_applied'> {
  if (!reviewed || typeof reviewed.id!=='string' || !receiptId.test(reviewed.id)) throw new IdentityError('invalid_move_plan');
  const request = normalize({...reviewed,...target});
  return db.transaction(async tx=>{
    const locked = await lockTarget(tx,target);
    await requireSeal(tx,locked.app,reviewed);
    const applied = await receipt(tx,locked.app,reviewed.id,target.ownerId);
    if (applied) {
      if (!isDeepStrictEqual(applied.plan,reviewed)) throw new IdentityError('move_plan_changed',409);
      expectState(locked.state,applied.after);
      await eligible(tx,locked,request,true);
      return 'already_applied';
    }
    const current = await snapshot(tx,locked,request);
    if (!isDeepStrictEqual(current,reviewed)) throw new IdentityError('move_plan_changed',409);
    await commit(tx,locked,current,false);
    return 'applied';
  });
}

export function invertCompanyMove(db: TransactionalQueryable, target: Target, id: string, expectedRevision: number): Promise<'inverted'|'already_inverted'> {
  if (!receiptId.test(id) || !revisionIsValid(expectedRevision)) throw new IdentityError('invalid_move_plan');
  return db.transaction(async tx=>{
    const locked = await lockTarget(tx,target);
    const applied = await receipt(tx,locked.app,id,target.ownerId);
    if (!applied) throw new IdentityError('sealed_move_required',409);
    if (applied.after.revision!==expectedRevision) throw new IdentityError('move_state_changed',409);
    const plan = applied.plan;
    const request = normalize({...plan,...target});
    if (!isDeepStrictEqual(plan,{...plan,...request}) || plan.id!==id) throw new IdentityError('move_plan_changed',409);
    await requireSeal(tx,locked.app,plan);
    const inverted = await receipt(tx,locked.app,id+'_inverse',target.ownerId);
    expectState(locked.state,(inverted ?? applied).after);
    await eligible(tx,locked,request,!inverted);
    if (inverted) return 'already_inverted';
    await commit(tx,locked,plan,true);
    return 'inverted';
  });
}

const usage = `Usage: move:company-root -- --writes-paused-backup-verified OWNER_ID
  plan CURRENT_DEFAULT NEW_ROOT REVISION [BRANCH_ID ...] | apply REVIEWED_PLAN.json | invert MOVE_ID APPLIED_REVISION`;
async function main() {
  const [ack,ownerId,operation,...args] = process.argv.slice(2);
  if (ack!=='--writes-paused-backup-verified' || !ownerId) throw new Error(usage);
  const connectionString = readEnv(process.env,'AUTH__MIGRATION_DATABASE_URL');
  if (!connectionString) throw new Error('AUTH__MIGRATION_DATABASE_URL must identify the reviewed target database');
  const target = {ownerId,authSchema:readEnv(process.env,'AUTH__SCHEMA')||'auth',appSchema:readEnv(process.env,'APP__SCHEMA')||'app',
    readSchema:readEnv(process.env,'IDENTITY__SCHEMA')||'identity'};
  const pool = new Pool({connectionString,max:1,connectionTimeoutMillis:5000});
  try {
    setEventProjection(projectNotifications);
    const db = identityDbOf(pool);
    const [first,second,third,...branchIds] = args;
    if (operation==='plan' && first && second && third && /^\d+$/.test(third))
      console.log(JSON.stringify(await planCompanyMove(db,{...target,defaultId:first,rootId:second,expectedRevision:Number(third),branchIds}),null,2));
    else if (operation==='apply' && first && args.length===1)
      console.log(await applyCompanyMove(db,target,JSON.parse(await readFile(first,'utf8'))));
    else if (operation==='invert' && first && second && /^\d+$/.test(second) && args.length===2)
      console.log(await invertCompanyMove(db,target,first,Number(second)));
    else throw new Error(usage);
  } finally {
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(error=>{
  if (error instanceof IdentityError) console.error(`Company move refused (${error.code}).`);
  else if (error instanceof Error && (error.message===usage || error.message.startsWith('AUTH__MIGRATION_DATABASE_URL must')))
    console.error(error.message);
  else console.error('Company move failed. Inspect the database state and diagnostics privately.');
  process.exitCode = 1;
});
