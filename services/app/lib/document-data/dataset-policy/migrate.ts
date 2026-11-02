/**
 * THE STORED DATASET POLICY MIGRATION: every stored dataset's none/v1/v2 policy rewritten as v3, by actor
 * `system` (scripts/migrate-dataset-policies.mjs runs it; docs/operations.md says when and how).
 *
 *  - Dry run (the default) reads everything in ONE read-only transaction and writes nothing.
 *  - Apply rewrites one dataset per transaction, under its row lock, with the plan made again inside that
 *    transaction (lib/dataset-permissions `planPolicyMigration`): the v3 policy, the `access` column, the
 *    shares for people a v2 grant named, a bumped policy revision and an audit row with no actor
 *    (lib/artifacts `commitMigratedDatasetPolicy`). Datasets with no report items go first.
 *  - Idempotent and resumable: a v3 row is skipped, so a rerun after a crash, a `limit` or a moved
 *    revision continues where the last one stopped and changes nothing already done.
 *  - The report names datasets, pages and accounts by ID only: no titles, emails or row data.
 * Connected PostgreSQL catalogs carry no stored policy (the policy door refuses them) and are skipped.
 */
import type { Queryable } from '@artifactbin/contracts';
import { commitMigratedDatasetPolicy, type MigratedDatasetPolicy } from '@/lib/artifacts';
import { planPolicyMigration, type PolicyMigrationPlan } from '@/lib/dataset-permissions';
import { catalogOf } from '@/lib/datasets';
import type { Db } from '@/lib/platform';

/** The database the migration runs on: a query and a transaction (the script opens its own connection). */
export type MigrationDb = Pick<Db, 'query' | 'transaction'>;

export interface DatasetPolicyMigrationOptions {
  /** Write the rewrite; otherwise a read-only dry run. */
  apply: boolean;
  /** Apply at most this many datasets in this run (a rerun continues). */
  limit?: number;
}

type Outcome = 'planned' | 'migrated' | 'already_v3' | 'skipped_postgres' | 'invalid_policy' | 'changed' | 'failed';
/** A report item beyond `toV3`'s: a named person who cannot be shared (no account, no address, or the address now belongs to someone else). */
const UNRESOLVED = 'share_unresolved';

interface MigrationDatasetReport {
  id: string;
  source?: 'none' | 'v1' | 'v2' | 'v3';
  outcome: Outcome;
  /** Report codes with their subjects (user, page or page-owner IDs). */
  items: Array<{ code: string; subjects?: string[] }>;
  /** Shares added or raised (planned in a dry run). */
  shares: Array<{ userId: string; role: 'viewer' | 'editor' }>;
  error?: string;
}

export interface DatasetPolicyMigrationReport {
  mode: 'dry-run' | 'apply';
  scanned: number;
  counts: {
    source: Record<string, number>;
    outcome: Record<string, number>;
    code: Record<string, number>;
    shares: { viewer: number; editor: number };
    accessToReadwrite: number;
  };
  /** Datasets with report items, shares, refusals or failures. Clean rewrites are counted, not listed. */
  datasets: MigrationDatasetReport[];
  /** IDs of datasets whose owner should look: anything reported, unresolved or not rewritten. */
  attention: string[];
}

interface DatasetRow {
  id: string;
  user_id: string | null;
  visibility: 'public' | 'unlisted' | 'private';
  access: string;
  meta: Record<string, unknown>;
  dataset_policy: unknown;
  policy_revision: number | null;
}
const COLUMNS = 'id,user_id,visibility,access,meta,dataset_policy,policy_revision';
const PAGE = 500;

interface Planned {
  row: DatasetRow;
  plan: Extract<PolicyMigrationPlan, { policy: unknown }>;
  shares: MigratedDatasetPolicy['shares'];
  unresolved: string[];
}
type Decision = { kind: 'skip'; outcome: Outcome; source?: MigrationDatasetReport['source']; error?: string } | ({ kind: 'plan' } & Planned);

/** Plan one row inside `q`: the policy, the access column, and the shares resolved against accounts and existing shares. */
async function decide(q: Queryable, row: DatasetRow): Promise<Decision> {
  if (catalogOf(row)?.kind === 'postgres') return { kind: 'skip', outcome: 'skipped_postgres' };
  let plan: PolicyMigrationPlan;
  try {
    plan = planPolicyMigration({
      policy: row.dataset_policy, visibility: row.visibility, access: row.access, ownerUserId: row.user_id,
      tables: catalogOf(row)?.tables.map(({ schema, name }) => ({ schema, name })) ?? [],
    });
  } catch (error) {
    return { kind: 'skip', outcome: 'invalid_policy', error: error instanceof Error ? error.message : 'Invalid policy' };
  }
  if (plan.source === 'v3') return { kind: 'skip', outcome: 'already_v3', source: 'v3' };
  const shares: MigratedDatasetPolicy['shares'] = [];
  const unresolved: string[] = [];
  if (plan.shares.length) {
    const ids = plan.shares.map((s) => s.userId);
    const people = new Map((await q.query<{ id: string; email: string | null }>('SELECT id,email FROM users WHERE id=ANY($1::text[])', [ids])).rows.map((u) => [u.id, u.email]));
    const existing = (await q.query<{ email: string; role: string; user_id: string | null }>('SELECT email,role,user_id FROM artifact_shares WHERE artifact_id=$1', [row.id])).rows;
    for (const { userId, role } of plan.shares) {
      const email = people.get(userId)?.toLowerCase();
      const held = existing.find((s) => s.user_id === userId) ?? (email ? existing.find((s) => s.email === email) : undefined);
      if (held && held.user_id !== null && held.user_id !== userId) { unresolved.push(userId); continue; }
      if (held) { if (held.role !== 'editor' && role === 'editor') shares.push({ email: held.email, userId, role }); continue; }
      if (!email) { unresolved.push(userId); continue; }
      shares.push({ email, userId, role });
    }
  }
  return { kind: 'plan', row, plan, shares, unresolved };
}

function emptyReport(mode: DatasetPolicyMigrationReport['mode']): DatasetPolicyMigrationReport {
  return { mode, scanned: 0, counts: { source: {}, outcome: {}, code: {}, shares: { viewer: 0, editor: 0 }, accessToReadwrite: 0 }, datasets: [], attention: [] };
}
const bump = (counts: Record<string, number>, key: string) => { counts[key] = (counts[key] ?? 0) + 1; };
const itemsOf = (report: Extract<PolicyMigrationPlan, { report: unknown }>['report'], unresolved: string[]) => [
  ...report.map(({ code, subjects }) => ({ code, ...(subjects ? { subjects } : {}) })),
  ...(unresolved.length ? [{ code: UNRESOLVED, subjects: unresolved }] : []),
];

/** Fold one dataset's decision (and, when applying, its outcome) into the report. */
function record(report: DatasetPolicyMigrationReport, id: string, decision: Decision, outcome: Outcome, error?: string) {
  const source = decision.kind === 'plan' ? decision.plan.source : decision.source;
  if (source) bump(report.counts.source, source);
  bump(report.counts.outcome, outcome);
  const entry: MigrationDatasetReport = { id, ...(source ? { source } : {}), outcome, items: [], shares: [] };
  if (decision.kind === 'plan') {
    entry.items = itemsOf(decision.plan.report, decision.unresolved);
    for (const item of entry.items) bump(report.counts.code, item.code);
    if (outcome === 'planned' || outcome === 'migrated') {
      entry.shares = decision.shares.map(({ userId, role }) => ({ userId, role }));
      for (const share of entry.shares) report.counts.shares[share.role]++;
      if (decision.plan.access !== decision.row.access) report.counts.accessToReadwrite++;
    }
  }
  const message = error ?? (decision.kind === 'skip' ? decision.error : undefined);
  if (message) entry.error = message;
  const listed = entry.items.length > 0 || entry.shares.length > 0 || !['planned', 'migrated', 'already_v3', 'skipped_postgres'].includes(outcome);
  if (listed) report.datasets.push(entry);
  if (entry.items.length > 0 || !['planned', 'migrated', 'already_v3', 'skipped_postgres'].includes(outcome)) report.attention.push(id);
}

/** Every stored dataset, page by page (by ID), inside `q`. */
async function* datasets(q: Queryable): AsyncGenerator<DatasetRow> {
  for (let after = ''; ;) {
    const rows = (await q.query<DatasetRow>(`SELECT ${COLUMNS} FROM artifacts WHERE format='dataset' AND id>$1 ORDER BY id LIMIT ${PAGE}`, [after])).rows;
    yield* rows;
    if (rows.length < PAGE) return;
    after = rows[rows.length - 1]!.id;
  }
}

export async function migrateDatasetPolicies(db: MigrationDb, options: DatasetPolicyMigrationOptions): Promise<DatasetPolicyMigrationReport> {
  const report = emptyReport(options.apply ? 'apply' : 'dry-run');
  // Pass 1, read-only: every row's decision. A dry run reports it; apply takes the order from it.
  const decisions: Array<{ id: string; decision: Decision }> = [];
  await db.transaction(async (tx) => {
    await tx.query('SET TRANSACTION READ ONLY');
    for await (const row of datasets(tx)) decisions.push({ id: row.id, decision: await decide(tx, row) });
  });
  report.scanned = decisions.length;
  if (!options.apply) {
    for (const { id, decision } of decisions) record(report, id, decision, decision.kind === 'plan' ? 'planned' : decision.outcome);
    return report;
  }
  const clean = (d: Decision) => d.kind === 'plan' && !d.plan.report.length && !d.unresolved.length;
  const todo = decisions.filter((d) => d.decision.kind === 'plan').sort((a, b) => Number(clean(b.decision)) - Number(clean(a.decision)));
  for (const { id, decision } of decisions) if (decision.kind === 'skip') record(report, id, decision, decision.outcome);
  let applied = 0;
  for (const { id, decision: before } of todo) {
    if (options.limit !== undefined && applied >= options.limit) break;
    applied++;
    try {
      // Pass 2, per dataset: lock, plan again on what is there now, commit.
      const [decision, outcome] = await db.transaction(async (tx): Promise<[Decision, Outcome]> => {
        const row = (await tx.query<DatasetRow>(`SELECT ${COLUMNS} FROM artifacts WHERE id=$1 AND format='dataset' FOR UPDATE`, [id])).rows[0];
        if (!row) return [{ kind: 'skip', outcome: 'changed' }, 'changed'];
        const now = await decide(tx, row);
        if (now.kind === 'skip') return [now, now.outcome];
        const revision = await commitMigratedDatasetPolicy(tx, {
          id, revision: row.policy_revision ?? 0, policy: now.plan.policy, access: now.plan.access, shares: now.shares,
        });
        return [now, revision === null ? 'changed' : 'migrated'];
      });
      record(report, id, decision, outcome);
    } catch (error) {
      record(report, id, before, 'failed', error instanceof Error ? error.message : String(error));
    }
  }
  return report;
}

/** The human summary of a report: counts, then one line per listed dataset (IDs only). */
export function formatMigrationReport(report: DatasetPolicyMigrationReport): string {
  const counts = (record: Record<string, number>) => Object.entries(record).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(' ') || 'none';
  const lines = [
    `Dataset policy migration (${report.mode}): ${report.scanned} datasets scanned`,
    `  stored shape: ${counts(report.counts.source)}`,
    `  outcome: ${counts(report.counts.outcome)}`,
    `  report items: ${counts(report.counts.code)}`,
    `  shares: editor=${report.counts.shares.editor} viewer=${report.counts.shares.viewer}; access set to readwrite: ${report.counts.accessToReadwrite}`,
    `  needing owner attention: ${report.attention.length}`,
  ];
  for (const d of report.datasets) {
    const items = d.items.map((i) => (i.subjects?.length ? `${i.code}[${i.subjects.join(',')}]` : i.code)).join(' ');
    const shares = d.shares.map((s) => `${s.role}:${s.userId}`).join(',');
    lines.push(`  ${d.id} ${d.source ?? '-'} ${d.outcome}${items ? ` ${items}` : ''}${shares ? ` share ${shares}` : ''}${d.error ? ` error: ${d.error}` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}
