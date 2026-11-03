/**
 * THE AGENT POLICY DOOR for v3 dataset permissions (get_dataset_policy, set_dataset_policy,
 * get_dataset_policy_templates): what the dataset's GraphQL API lets each role do, as owners and editors read
 * and set it.
 *
 * Read: the stored v3 policy, or the default when none is stored (lib/dataset-permissions `storedPolicy`, the
 * reading every door enforces); a stored policy that does not read (not version 3, or invalid) answers
 * `source: "unreadable"` with the reason in `report`, so an owner can save over it; each table's generated root
 * and column names (./hasura-names, so the names agents see are the names the API serves); and the
 * plain-language read-back.
 *
 * Write: a v3 body is validated against the dataset's own tables and columns, every problem by JSON path; a dry
 * run answers the read-back and saves nothing; a save is a compare-and-swap on the policy revision
 * (lib/artifacts `commitDatasetPolicy`, which also fences content and sharing). `configuration` names the API,
 * so it is server-owned: a body omits it (the stored one is kept) or sends it unchanged. Any object that is not
 * version 3 (a retired version 1 or 2 body), dry run or save, is refused with LEGACY_POLICY_REFUSED, the refusal every policy
 * door gives; a null save clears the stored policy (read as the read-only template) through lib/document-data
 * `writeDatasetPolicy`.
 *
 * Anyone below editor, and any non-dataset or Postgres-backed id, gets the uniform 404.
 */
import {
  DATASET_ADMIN_ROLES,
  DATASET_PERMISSION_TEMPLATES,
  DATASET_RULE_ROLES,
  type DatasetColumn,
  type DatasetPermissions,
  type DatasetPermissionsIssue,
  type DatasetPermissionsShape,
} from '@artifactbin/contracts';
import { datasetPermissionsTemplate, readBackDatasetPermissions, validateDatasetPermissions } from '@artifactbin/utils/dataset-permissions';
import type { AccessActor } from '@/lib/accounts';
import { commitDatasetPolicy, getArtifactFor, type ArtifactRow } from '@/lib/artifacts';
import { storedPolicy, type StoredPolicy } from '@/lib/dataset-permissions';
import { catalogOf, keepDatasetConfiguration, LEGACY_POLICY_REFUSED, type DatasetTable } from '@/lib/datasets';
import { writeDatasetPolicy } from '@/lib/document-data';
import { getDb } from '@/lib/platform';
import { hasuraNames, storedConfiguration } from './hasura-names';

interface PolicyReply { status: number; body: Record<string, unknown> }
const ok = (body: Record<string, unknown>): PolicyReply => ({ status: 200, body });
const NOT_FOUND: PolicyReply = { status: 404, body: { error: 'not_found' } };
const invalid = (errors: DatasetPermissionsIssue[]): PolicyReply => ({
  status: 400,
  body: { error: 'invalid_policy', detail: errors.map((e) => `${e.path}: ${e.message}`).join('; '), errors },
});
const graphqlType = (type: DatasetColumn['type']) => (type === 'number' ? 'Float' : type === 'boolean' ? 'Boolean' : 'String');

/** A stored dataset the actor edits or owns, with its catalog tables; null for everything else. */
async function editable(actor: AccessActor, id: string): Promise<{ row: ArtifactRow; tables: DatasetTable[] } | null> {
  const row = await getArtifactFor(actor, id);
  if (!row || row.format !== 'dataset') return null;
  const catalog = catalogOf(row);
  const flat = { schema: 'public', name: 'rows', columns: (row.meta.columns ?? []) as DatasetColumn[] };
  return { row, tables: catalog?.tables ?? [flat] };
}
const shapeOf = (tables: readonly DatasetTable[]): DatasetPermissionsShape => ({
  tables: tables.map((t) => ({ table: { schema: t.schema, name: t.name }, columns: t.columns.map((c) => c.name) })),
});
const readBack = (policy: DatasetPermissions, row: ArtifactRow) => {
  const back = readBackDatasetPermissions(policy, { visibility: row.visibility });
  return { readBack: back.text, readBackTables: back.tables, warnings: back.warnings };
};

/** GET: the policy as v3, its revision, the roles rules may name, each table's GraphQL names and the read-back. */
export async function readDatasetPermissions(actor: AccessActor, id: string): Promise<PolicyReply> {
  const found = await editable(actor, id);
  if (!found) return NOT_FOUND;
  const { row, tables } = found;
  const names = hasuraNames(tables, { title: row.title, configuration: storedConfiguration(row.dataset_policy) });
  let reading: StoredPolicy | null = null, unreadable = '';
  try { reading = storedPolicy({ policy: row.dataset_policy, tables: tables.map(({ schema, name }) => ({ schema, name })) }); }
  catch (error) { unreadable = error instanceof Error ? error.message : String(error); }
  return ok({
    revision: row.policy_revision ?? 0,
    source: reading?.source ?? 'unreadable',
    report: reading ? [] : [{ code: 'unreadable', message: `${unreadable} Until then nobody below editor can use the data.` }],
    policy: reading?.policy ?? null,
    roles: { rules: DATASET_RULE_ROLES, admin: DATASET_ADMIN_ROLES },
    templates: DATASET_PERMISSION_TEMPLATES,
    tables: tables.map((t, i) => ({
      table: { schema: t.schema, name: t.name },
      root: names[i]!.root,
      columns: t.columns.map((c) => ({ name: c.name, field: names[i]!.columns[c.name], type: c.type, graphqlType: graphqlType(c.type) })),
    })),
    ...(reading ? readBack(reading.policy, row) : { readBack: '', readBackTables: [], warnings: [] }),
  });
}

/** PUT: validate a v3 policy against the dataset; a dry run answers the read-back, a save needs the current revision. */
export async function writeDatasetPermissions(actor: AccessActor, id: string, body: Record<string, unknown>): Promise<PolicyReply> {
  const value = body.policy, dryRun = body.dryRun === true;
  const v3 = !!value && typeof value === 'object' && (value as { version?: unknown }).version === 3;
  if (!v3 && value && typeof value === 'object') {
    if (!await editable(actor, id)) return NOT_FOUND;
    return invalid([{ path: 'version', message: LEGACY_POLICY_REFUSED }]);
  }
  if (value === null && !dryRun && Object.hasOwn(body, 'policy')) {
    const response = await writeDatasetPolicy(actor, id, body);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }
  const found = await editable(actor, id);
  if (!found) return NOT_FOUND;
  const { row, tables } = found;
  if (!v3) return invalid([{ path: Object.hasOwn(body, 'policy') && value && typeof value === 'object' ? 'version' : 'policy', message: 'expected a version 3 policy object; GET the policy for the current rules' }]);
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') return invalid([{ path: 'dryRun', message: 'expected true or false' }]);
  const expected = body.expectedPolicyRevision;
  if (!dryRun && (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0))
    return invalid([{ path: 'expectedPolicyRevision', message: 'expected the nonnegative integer revision GET answered' }]);
  const checked = validateDatasetPermissions(value, shapeOf(tables));
  if (!checked.ok) return invalid(checked.errors);
  const kept = keepDatasetConfiguration(checked.policy, row.dataset_policy);
  if (kept.errors.length) return invalid(kept.errors);
  const current = row.policy_revision ?? 0;
  if (dryRun) return ok({ dryRun: true, saved: false, revision: current, policy: kept.policy, ...readBack(kept.policy, row) });
  const committed = await commitDatasetPolicy(await getDb(), actor, row, kept.policy, expected as number);
  if (committed === null)
    return { status: 409, body: { error: 'policy_changed', detail: 'The policy, the dataset or its sharing changed: GET the policy, reapply the change and send the new revision.', revision: current } };
  return ok({ saved: true, revision: committed, policy: kept.policy, ...readBack(kept.policy, row) });
}

/** The three starting policies built for this dataset's tables (own-rows needs `ownerColumn`), each with its read-back. */
export async function datasetPermissionTemplates(actor: AccessActor, id: string, ownerColumn?: string): Promise<PolicyReply> {
  const found = await editable(actor, id);
  if (!found) return NOT_FOUND;
  const { row, tables } = found, shape = shapeOf(tables);
  return ok({
    revision: row.policy_revision ?? 0,
    templates: DATASET_PERMISSION_TEMPLATES.map((name) => {
      const built = datasetPermissionsTemplate(name, shape, ownerColumn ? { ownerColumn } : {});
      if (!built.ok) return { name, ok: false, errors: built.errors };
      const policy = keepDatasetConfiguration(built.policy, row.dataset_policy).policy;
      return { name, ok: true, policy, ...readBack(policy, row) };
    }),
  });
}
