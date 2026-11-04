/**
 * WHO MAY WRITE A DATASET, AND UNDER WHICH RULES: one decision every write door (a page's generated dataset API,
 * the direct SQL door, file and image uploads) asks, and the
 * commit transaction asks again under the row lock so a revoked share or a new policy cannot race a write.
 *
 *  - The role is the dataset's own sharing (./role). Owner and editor are admin-equivalent: no rule
 *    applies to them. Every other role writes only what a v3 entry for it allows (./stored-policy; a stored
 *    policy that is not version 3 throws for them).
 *  - `backend_only` entries apply only to a trusted program: an upload's saved-page proof that passes the
 *    program-trust checks (signed in, accepted page membership, saved edit) on a page whose owner holds owner
 *    or editor on the dataset. The engine refuses them otherwise.
 *  - A PRIVATE dataset admits signed_in and anonymous callers only through `backend_only` entries (privateCeiling).
 *  - The `access` column is a ceiling on every write, owner included.
 */
import type { DatasetBoolExp, DatasetGrantContext, DatasetMutationPolicy, DatasetOperation, DatasetPermissions, DatasetRole, DatasetRuleRole, DatasetTableName, DatasetTablePermissions, Queryable, Scalar } from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import { liveAccessFacts, writerFor, type AccessFacts, type ArtifactRow } from '@/lib/artifact-access';
import { catalogOf, DatasetError } from '@/lib/datasets';
import { getDb } from '@/lib/platform';
import { datasetRole } from './role';
import { storedPolicy } from './stored-policy';
import { keptRows } from './view';

const MUTATIONS: readonly DatasetOperation[] = ['insert', 'update', 'delete'];

export interface DatasetWriteOptions {
  /** The caller arrives through a page linking the dataset (its generated API, an upload). */
  throughPage?: boolean;
  /** The page whose GraphQL carries the write (its `X-Hasura-Page-Id`); implies `throughPage`. */
  pageId?: string;
  /** Upload trust (its own saved-link proof): program trust for backend_only. */
  trust?: (db: Queryable) => Promise<DatasetGrantContext>;
  /** Decide inside this transaction (the commit's lock), never on the shared connection. */
  tx?: Queryable;
  /** The request's facts (lib/artifact-access `memoAccessFacts`), for a decision outside a transaction; `tx` decides on its own. */
  facts?: AccessFacts;
}

export type DatasetWriteDecision =
  | { allowed: true; admin: true; role: 'owner' | 'editor'; revision: number }
  | { allowed: true; admin: false; role: DatasetRuleRole; revision: number; permissions: DatasetPermissions; trusted: boolean; session: Record<string, Scalar> }
  | { allowed: false; role: DatasetRole | null; revision: number; reason: 'dataset_read_only' | 'no_rule' };

const entryFor = (table: DatasetTablePermissions, op: DatasetOperation, role: DatasetRuleRole) =>
  table[`${op}_permissions`]?.find((entry) => entry.role === role);
const usable = (table: DatasetTablePermissions, op: DatasetOperation, role: DatasetRuleRole, trusted: boolean) => {
  const entry = entryFor(table, op, role);
  return !!entry && (!entry.permission.backend_only || trusted);
};

/** The dataset's stored tables (or the flat dataset's one), the tables a policy naming none covers. */
function tablesOf(row: Pick<ArtifactRow, 'meta'>) {
  return catalogOf(row)?.tables.map(({ schema, name }) => ({ schema, name })) ?? [];
}

/** The account that wrote a document's program: its owner's identity, for its dataset role. */
async function documentOwnerAdmin(dataset: ArtifactRow, owner: { userId: string | null; tokenId: string | null; groupId?: string | null }, db: Queryable): Promise<boolean> {
  const actor = writerFor({ user_id: owner.userId, token_id: owner.tokenId, group_id: owner.groupId ?? null });
  const role = await datasetRole(dataset, actor, { facts: liveAccessFacts(actor, db) });
  return role === 'owner' || role === 'editor';
}

/** Program trust for backend_only entries: the saved-document checks pass and the page owner administers the dataset. */
async function trusted(dataset: ArtifactRow, options: DatasetWriteOptions, db: Queryable): Promise<boolean> {
  const verify = options.trust;
  if (!verify) return false;
  let context: DatasetGrantContext;
  try { context = await verify(db); } catch { return false; }
  return !!context.artifact && await documentOwnerAdmin(dataset, context.artifact.owner, db);
}

/**
 * THE PRIVATE CEILING (plan §3/§8: "dataset is private: signed_in and anonymous rules never apply"). On a private
 * dataset a signed_in or anonymous caller (a page reader without a share) keeps only its `backend_only` entries,
 * which already need a trusted program on a page whose owner administers the dataset.
 */
function privateCeiling(row: Pick<ArtifactRow, 'visibility'>, role: DatasetRuleRole, policy: DatasetPermissions): DatasetPermissions {
  if (row.visibility !== 'private' || role === 'viewer') return policy;
  return {
    version: 3,
    tables: policy.tables.map((table) => {
      const out: DatasetTablePermissions = { ...table };
      for (const op of MUTATIONS) {
        const key = `${op}_permissions` as const;
        const kept = table[key]?.filter((entry) => entry.role !== role || entry.permission.backend_only);
        if (kept) (out as unknown as Record<string, unknown>)[key] = kept;
      }
      return out;
    }),
  };
}

/** The one write decision. `row` is the dataset head the caller read (its policy revision is part of the answer). */
export async function datasetWriteAccess(row: ArtifactRow, actor: AccessActor, options: DatasetWriteOptions = {}): Promise<DatasetWriteDecision> {
  const db = options.tx ?? await getDb();
  const revision = row.policy_revision ?? 0;
  // Under the commit's lock only that transaction's own facts decide, never a request's memo.
  const facts = options.tx ? liveAccessFacts(actor, options.tx) : options.facts ?? liveAccessFacts(actor, db);
  const role = await datasetRole(row, actor, { facts, throughPage: options.throughPage || !!options.pageId });
  if (row.format !== 'dataset' || row.access !== 'readwrite') return { allowed: false, role, revision, reason: 'dataset_read_only' };
  if (role === 'owner' || role === 'editor') return { allowed: true, admin: true, role, revision };
  if (!role) return { allowed: false, role, revision, reason: 'no_rule' };
  // Read only for a rule role, so an owner or editor can always replace a stored policy that does not read.
  const read = storedPolicy({ policy: row.dataset_policy, tables: tablesOf(row) });
  const policy = privateCeiling(row, role, read.policy);
  const tables = policy.tables;
  const entries = tables.flatMap((table) => MUTATIONS.map((op) => entryFor(table, op, role)).filter((entry) => !!entry));
  if (!entries.length) return { allowed: false, role, revision, reason: 'no_rule' };
  const isTrusted = entries.some((entry) => entry.permission.backend_only) && await trusted(row, options, db);
  if (!entries.some((entry) => !entry.permission.backend_only || isTrusted)) return { allowed: false, role, revision, reason: 'no_rule' };
  const session: Record<string, Scalar> = {
    'x-hasura-role': role,
    ...(actor.userId ? { 'x-hasura-user-id': actor.userId } : {}),
    ...(options.pageId ? { 'x-hasura-page-id': options.pageId } : {}),
  };
  return { allowed: true, admin: false, role, revision, permissions: policy, trusted: isTrusted, session };
}

/** Can this decision insert anything (the file and image doors, which name no table)? */
export function canInsert(decision: DatasetWriteDecision): boolean {
  if (!decision.allowed) return false;
  if (decision.admin) return true;
  return decision.permissions.tables.some((table) => usable(table, 'insert', decision.role, decision.trusted));
}

/**
 * The engine's policy for one table: undefined for owner and editor (no rule applies), the role's entries
 * otherwise. Throws when the role has no usable entry for this table.
 */
export function tableMutationPolicy(decision: DatasetWriteDecision, table: { schema: string; name: string }): DatasetMutationPolicy | undefined {
  if (!decision.allowed) throw new Error('No policy permits writes to this table');
  if (decision.admin) return undefined;
  const { role, trusted: isTrusted } = decision;
  const found = decision.permissions.tables.find((t) => t.table.schema === table.schema && t.table.name === table.name);
  const operations = found ? MUTATIONS.filter((op) => usable(found, op, role, isTrusted)) : [];
  if (!found || !operations.length) throw new Error('No policy permits writes to this table');
  const only = <E extends { role: string }>(entries: E[] | undefined) => entries?.filter((entry) => entry.role === role);
  return {
    table: {
      table: found.table,
      insert_permissions: only(found.insert_permissions) as DatasetMutationPolicy['table']['insert_permissions'],
      update_permissions: only(found.update_permissions) as DatasetMutationPolicy['table']['update_permissions'],
      delete_permissions: only(found.delete_permissions) as DatasetMutationPolicy['table']['delete_permissions'],
    },
    role,
    session: decision.session,
    operations,
    trusted: isTrusted,
  };
}

const decisionKey = (d: DatasetWriteDecision) => JSON.stringify([d.allowed, d.role, d.revision, d.allowed && !d.admin ? d.trusted : null]);

/**
 * Inside the commit transaction: lock the dataset, re-read the head and decide
 * again with this transaction's facts. Anything but the same decision refuses the commit.
 */
export async function assertWriteCommit(tx: Queryable, dataset: ArtifactRow, actor: AccessActor, before: DatasetWriteDecision, options: Omit<DatasetWriteOptions, 'tx'> = {}): Promise<void> {
  await tx.query('SELECT id FROM artifacts WHERE id=$1 FOR UPDATE', [dataset.id]);
  const current = (await tx.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL', [dataset.id])).rows[0];
  if (!current || (current.policy_revision ?? 0) !== before.revision) throw new DatasetError('Mutation permission changed', 403);
  const now = await datasetWriteAccess(current, actor, { ...options, tx });
  if (!now.allowed || decisionKey(now) !== decisionKey(before)) throw new DatasetError('Mutation permission changed', 403);
}

/**
 * The update rule's `check` on a cell's new text: would the row, with `value` in `column`, still pass? Owner and editor
 * always. Read as the role view reads a filter (TRUE only). The engine checks again when the cell is saved.
 */
export function cellCheckAdmits(decision: DatasetWriteDecision, table: DatasetTableName & { columns: readonly { name: string }[] }, column: string, row: Record<string, unknown>, value: string): boolean {
  if (!decision.allowed) return false;
  if (decision.admin) return true;
  let policy: DatasetMutationPolicy | undefined;
  try { policy = tableMutationPolicy(decision, table); } catch { return false; }
  const check = policy?.table.update_permissions?.find((entry) => entry.role === decision.role)?.permission.check as DatasetBoolExp | null | undefined;
  if (!check || !Object.keys(check).length) return true;
  return keptRows([{ ...row, [column]: value }], table.columns.map((c) => c.name), { columns: '*', filter: check }, decision.session).length === 1;
}

/**
 * May this decision change one column of one row (a live text cell, lib/region-sessions)? Owner and editor always;
 * a rule role when its update entry names the column (and does not preset it) and its filter admits the row, read
 * with the decision's session as the role view reads a select filter (./view keptRows: TRUE only, fail closed). The
 * engine stays the authority when the cell is saved (its filter as row security, its check on the effect); this is
 * the gate that decides who may open and type.
 */
export function canUpdateCell(decision: DatasetWriteDecision, table: DatasetTableName & { columns: readonly { name: string }[] }, column: string, row: Record<string, unknown>): boolean {
  if (!decision.allowed) return false;
  if (decision.admin) return true;
  let policy: DatasetMutationPolicy | undefined;
  try { policy = tableMutationPolicy(decision, table); } catch { return false; }
  if (!policy?.operations.includes('update')) return false;
  const rule = policy.table.update_permissions?.find((entry) => entry.role === decision.role)?.permission;
  if (!rule || (rule.columns !== '*' && !rule.columns.includes(column)) || Object.hasOwn(rule.set ?? {}, column)) return false;
  return keptRows([row], table.columns.map((c) => c.name), { columns: '*', filter: (rule.filter ?? {}) as DatasetBoolExp }, decision.session).length === 1;
}
