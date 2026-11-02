/**
 * WHO MAY WRITE A DATASET, AND UNDER WHICH RULES: one decision every write door (generic page writeRows,
 * markup <Mutation>, registered page mutations, the direct SQL door, file and image uploads) asks, and the
 * commit transaction asks again under the row lock so a revoked share or a new policy cannot race a write.
 *
 *  - The role is the dataset's own sharing (./role). Owner and editor are admin-equivalent: no rule
 *    applies to them. Every other role writes only what a v3 entry for it allows (./to-v3 reads stored
 *    v1/v2 policies as v3).
 *  - `backend_only` entries apply only to a trusted program: a saved-document proof that passes the
 *    program-trust checks (signed in, accepted page membership, saved edit, registered attestation) on a
 *    page whose owner holds owner or editor on the dataset. The engine refuses them otherwise.
 *  - A write carried by a document is that document's SQL: the document must be live at the attested edit,
 *    readable by the caller, and its owner must hold owner or editor on the dataset (provenance).
 *  - A PRIVATE dataset admits signed_in and anonymous callers only through `backend_only` entries (privateCeiling).
 *  - The `access` column stays a ceiling for datasets without v2 grants, owner included (v2 grants never
 *    read it; the stored rewrite sets it to readwrite on every migrated v2 dataset, ./migrate).
 */
import type { DatasetGrantContext, DatasetMutationPolicy, DatasetOperation, DatasetPermissions, DatasetRole, DatasetRuleRole, DatasetTablePermissions, Queryable, Scalar } from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import { grantContext, liveAccessFacts, readThrough, writerFor, type ArtifactRow, type GrantDocument } from '@/lib/artifact-access';
import { catalogOf, DatasetError } from '@/lib/datasets';
import { getDb } from '@/lib/platform';
import { datasetRole } from './role';
import { toV3, type ToV3Result } from './to-v3';

const MUTATIONS: readonly DatasetOperation[] = ['insert', 'update', 'delete'];

export interface DatasetWriteOptions {
  /** The caller arrives through a page linking the dataset (page writeRows, a page program, an upload). */
  throughPage?: boolean;
  /** A saved-document program carrying the write: provenance always, program trust for backend_only. */
  document?: GrantDocument;
  /** The page whose GraphQL carries the write (its `X-Hasura-Page-Id`); implies `throughPage`. */
  pageId?: string;
  /** Upload trust (its own saved-link proof); a document program uses `document` instead. */
  trust?: (db: Queryable) => Promise<DatasetGrantContext>;
  /** Decide inside this transaction (the commit's lock), never on the shared connection. */
  tx?: Queryable;
}

export type DatasetWriteDecision =
  | { allowed: true; admin: true; role: 'owner' | 'editor'; revision: number }
  | { allowed: true; admin: false; role: DatasetRuleRole; revision: number; permissions: DatasetPermissions; trusted: boolean; session: Record<string, Scalar>; execution?: ToV3Result['execution'] }
  | { allowed: false; role: DatasetRole | null; revision: number; reason: 'dataset_read_only' | 'no_rule' | 'document_changed' };

const entryFor = (table: DatasetTablePermissions, op: DatasetOperation, role: DatasetRuleRole) =>
  table[`${op}_permissions`]?.find((entry) => entry.role === role);
const usable = (table: DatasetTablePermissions, op: DatasetOperation, role: DatasetRuleRole, trusted: boolean) => {
  const entry = entryFor(table, op, role);
  return !!entry && (!entry.permission.backend_only || trusted);
};

/** The dataset's stored tables (or the flat dataset's one), the tables a policy naming none covers. */
function tablesOf(row: ArtifactRow) {
  return catalogOf(row)?.tables.map(({ schema, name }) => ({ schema, name })) ?? [];
}

/** The stored policy read as v3, or null when it does not parse (no rule then applies). */
function permissionsOf(row: Pick<ArtifactRow, 'dataset_policy' | 'visibility' | 'meta'>): ToV3Result | null {
  try {
    return toV3({ policy: row.dataset_policy, visibility: row.visibility, tables: tablesOf(row as ArtifactRow) });
  } catch {
    return null;
  }
}

/** The account that wrote a document's program: its owner's identity, for its dataset role. */
export async function documentOwnerAdmin(dataset: ArtifactRow, owner: { userId: string | null; tokenId: string | null; groupId?: string | null }, db: Queryable): Promise<boolean> {
  const actor = writerFor({ user_id: owner.userId, token_id: owner.tokenId, group_id: owner.groupId ?? null });
  const role = await datasetRole(dataset, actor, { facts: liveAccessFacts(actor, db) });
  return role === 'owner' || role === 'editor';
}

/** The document carrying the write is live at its attested edit, the caller reads it, and its owner administers the dataset. */
async function documentProvenance(dataset: ArtifactRow, actor: AccessActor, document: GrantDocument, db: Queryable): Promise<boolean> {
  const doc = (await db.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL', [document.id])).rows[0];
  if (!doc || doc.edit_id !== document.editId || !(await readThrough(db, doc, actor))) return false;
  return documentOwnerAdmin(dataset, { userId: doc.group_id ? null : doc.user_id, tokenId: doc.group_id ? null : doc.token_id, groupId: doc.group_id ?? null }, db);
}

/** Program trust for backend_only entries: the saved-document checks pass and the page owner administers the dataset. */
async function trusted(dataset: ArtifactRow, actor: AccessActor, options: DatasetWriteOptions, db: Queryable): Promise<boolean> {
  const verify = options.trust ?? (options.document ? (q: Queryable) => grantContext(dataset, actor, options.document, q) : undefined);
  if (!verify) return false;
  let context: DatasetGrantContext;
  try { context = await verify(db); } catch { return false; }
  return !!context.artifact && await documentOwnerAdmin(dataset, context.artifact.owner, db);
}

/**
 * COMPATIBILITY until the stored migration (scripts/migrate-dataset-policies.ts) has been APPLIED everywhere: it shares
 * the dataset with each named person (editor) and stores v3, after which no row reaches this. Remove it, the
 * read-side twin in ./read and the harness's v1/v2 seeding then (docs/operations.md). Until then: a v2 write grant
 * naming this account (`from:{user:<id>}`, no page) keeps admitting exactly its granted operations outside a program, and through
 * a trusted program (as v2 did with accepted membership), unrestricted like v2, for this caller only. v3 has no slot for one person, so this lives here and nowhere else.
 */
function namedUserWrites(policy: unknown, userId: string): DatasetOperation[] {
  const allow = (policy as { allow?: { actions?: unknown[]; from?: Record<string, unknown> }[] } | null)?.allow ?? [];
  const ops = new Set<DatasetOperation>();
  for (const grant of allow) {
    const from = grant.from ?? {};
    if (from.user !== userId || from.artifact !== undefined || from.artifactOwner !== undefined) continue;
    for (const action of grant.actions ?? []) if ((MUTATIONS as readonly unknown[]).includes(action)) ops.add(action as DatasetOperation);
  }
  return MUTATIONS.filter((op) => ops.has(op));
}

function namedUserPermissions(tables: readonly DatasetTablePermissions[], role: DatasetRuleRole, ops: readonly DatasetOperation[]): DatasetPermissions {
  return {
    version: 3,
    tables: tables.map((t) => ({
      table: { ...t.table },
      ...(ops.includes('insert') ? { insert_permissions: [{ role, permission: { columns: '*' as const, check: {} } }] } : {}),
      ...(ops.includes('update') ? { update_permissions: [{ role, permission: { columns: '*' as const, filter: {} } }] } : {}),
      ...(ops.includes('delete') ? { delete_permissions: [{ role, permission: { filter: {} } }] } : {}),
    })),
  };
}

/**
 * THE PRIVATE CEILING (plan §3/§8: "dataset is private: signed_in and anonymous rules never apply"). On a private
 * dataset a signed_in or anonymous caller (a page reader without a share) keeps only its `backend_only` entries,
 * which already need a trusted program on a page whose owner administers the dataset. Stored v1 entries are
 * viewer-only there already (./to-v3); for v2 and v3 this is the ceiling v2 grants always had.
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
  const read = permissionsOf(row);
  const v2 = read?.source === 'v2' || (!read && !!row.dataset_policy && (row.dataset_policy as { version?: unknown }).version === 2);
  const role = await datasetRole(row, actor, { facts: liveAccessFacts(actor, db), throughPage: options.throughPage || !!options.document || !!options.pageId });
  if (row.format !== 'dataset' || catalogOf(row)?.kind === 'postgres' || (!v2 && row.access !== 'readwrite')) return { allowed: false, role, revision, reason: 'dataset_read_only' };
  if (options.document && !(await documentProvenance(row, actor, options.document, db))) return { allowed: false, role, revision, reason: 'document_changed' };
  if (role === 'owner' || role === 'editor') return { allowed: true, admin: true, role, revision };
  if (!role || !read) return { allowed: false, role, revision, reason: 'no_rule' };
  // Outside a program as v2 did; through a program only when it is trusted (the caller's accepted page membership
  // and saved-page proof, as v2's grant context required).
  const granted = v2 && actor.userId ? namedUserWrites(row.dataset_policy, actor.userId) : [];
  const named = granted.length && (!options.document || await trusted(row, actor, options, db)) ? granted : [];
  if (named.length) {
    const session: Record<string, Scalar> = { 'x-hasura-role': role, 'x-hasura-user-id': actor.userId! };
    return { allowed: true, admin: false, role, revision, permissions: namedUserPermissions(read.policy.tables, role, named), trusted: false, session, ...(read.execution ? { execution: read.execution } : {}) };
  }
  const policy = privateCeiling(row, role, read.policy);
  const tables = policy.tables;
  const entries = tables.flatMap((table) => MUTATIONS.map((op) => entryFor(table, op, role)).filter((entry) => !!entry));
  if (!entries.length) return { allowed: false, role, revision, reason: 'no_rule' };
  const isTrusted = entries.some((entry) => entry.permission.backend_only) && await trusted(row, actor, options, db);
  if (!entries.some((entry) => !entry.permission.backend_only || isTrusted)) return { allowed: false, role, revision, reason: 'no_rule' };
  const session: Record<string, Scalar> = {
    'x-hasura-role': role,
    ...(actor.userId ? { 'x-hasura-user-id': actor.userId } : {}),
    ...(options.document ? { 'x-hasura-page-id': options.document.id } : options.pageId ? { 'x-hasura-page-id': options.pageId } : {}),
  };
  return { allowed: true, admin: false, role, revision, permissions: policy, trusted: isTrusted, session, ...(read.execution ? { execution: read.execution } : {}) };
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
    ...(decision.execution ? { execution: decision.execution } : {}),
  };
}

const decisionKey = (d: DatasetWriteDecision) => JSON.stringify([d.allowed, d.role, d.revision, d.allowed && !d.admin ? d.trusted : null]);

/**
 * Inside the commit transaction: lock the dataset (and the carrying document), re-read the head and decide
 * again with this transaction's facts. Anything but the same decision refuses the commit.
 */
export async function assertWriteCommit(tx: Queryable, dataset: ArtifactRow, actor: AccessActor, before: DatasetWriteDecision, options: Omit<DatasetWriteOptions, 'tx'> = {}): Promise<void> {
  await tx.query('SELECT id FROM artifacts WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [[...new Set([dataset.id, ...(options.document ? [options.document.id] : [])])]]);
  const current = (await tx.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL', [dataset.id])).rows[0];
  if (!current || (current.policy_revision ?? 0) !== before.revision) throw new DatasetError('Mutation permission changed', 403);
  const now = await datasetWriteAccess(current, actor, { ...options, tx });
  if (!now.allowed || decisionKey(now) !== decisionKey(before)) throw new DatasetError('Mutation permission changed', 403);
}
