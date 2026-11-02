/**
 * DUAL READ: a stored dataset policy (none, v1 entries, v2 grants, or v3) read as v3 permissions in memory.
 * Every write decision reads this; the stored rewrite (a later migration) runs the same function, so it
 * changes no behaviour. Each mapping row is the plan's table; anything that does not carry over exactly
 * is listed in `report`.
 */
import {
  DATASET_RULE_ROLES,
  type DatasetAccessPolicy,
  type DatasetGrantPolicy,
  type DatasetOperation,
  type DatasetPermissionEntry,
  type DatasetPermissions,
  type DatasetPolicy,
  type DatasetRuleRole,
  type DatasetSelectPermission,
  type DatasetTableName,
  type DatasetTablePermissions,
  type DatasetTablePolicy,
  type Visibility,
} from '@artifactbin/contracts';
import { parseDatasetAccessPolicy } from '@artifactbin/utils/dataset-grants';
import { validateDatasetPermissions } from '@artifactbin/utils/dataset-permissions';

type ToV3Source = 'none' | 'v1' | 'v2' | 'v3';
type ToV3ReportCode =
  | 'anonymous_write'
  | 'functions_dropped'
  | 'private_viewer_only'
  | 'read_named_user'
  | 'read_page_scoped'
  | 'write_page_scoped'
  | 'write_named_user';
interface ToV3ReportItem { code: ToV3ReportCode; message: string }
export interface ToV3Result {
  source: ToV3Source;
  policy: DatasetPermissions;
  report: ToV3ReportItem[];
  /**
   * The stored v1/v2 function allow/deny lists. v3 has no slot (the stored rewrite drops them and reports
   * it); until that rewrite the engine keeps enforcing them, so a dual read never widens a write.
   */
  execution?: DatasetPolicy['execution'];
}

const MUTATIONS: readonly DatasetOperation[] = ['insert', 'update', 'delete'];
const READ_ALL: DatasetSelectPermission = { columns: '*', filter: {}, allow_aggregations: true };
const ALL_ROWS: Record<DatasetOperation, object> = {
  insert: { columns: '*', check: {} },
  update: { columns: '*', filter: {}, check: {} },
  delete: { filter: {} },
};
const sameTable = (a: DatasetTableName, b: DatasetTableName) => a.schema === b.schema && a.name === b.name;
const clone = <T>(value: T): T => structuredClone(value);
const select = (roles: readonly DatasetRuleRole[]): DatasetPermissionEntry<DatasetSelectPermission>[] =>
  DATASET_RULE_ROLES.filter((role) => roles.includes(role)).map((role) => ({ role, permission: clone(READ_ALL) }));

/** The input: the stored policy, the dataset's visibility and its catalog tables (for policies naming no table). */
export interface ToV3Input {
  policy: unknown;
  visibility: Visibility;
  tables: readonly DatasetTableName[];
}

/** Throws when the stored policy does not parse: callers deny every rule write (owner and editors keep access). */
export function toV3(input: ToV3Input): ToV3Result {
  const tables = input.tables.length ? input.tables : [{ schema: 'public', name: 'rows' }];
  if (input.policy === null || input.policy === undefined) {
    return { source: 'none', report: [], policy: { version: 3, tables: tables.map((table) => ({ table: { ...table }, select_permissions: select(DATASET_RULE_ROLES) })) } };
  }
  if (typeof input.policy === 'object' && (input.policy as { version?: unknown }).version === 3) {
    const parsed = validateDatasetPermissions(input.policy);
    if (!parsed.ok) throw new Error(`Dataset permissions: ${parsed.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    return { source: 'v3', policy: parsed.policy, report: [] };
  }
  const stored: DatasetAccessPolicy = parseDatasetAccessPolicy(input.policy);
  return stored.version === 2 ? fromV2(stored, tables) : fromV1(stored, tables, input.visibility);
}

/** v1: viewer entries meant "everyone who can read the dataset", the signed-out link audience included. */
function fromV1(policy: DatasetPolicy, tables: readonly DatasetTableName[], visibility: Visibility): ToV3Result {
  const report: ToV3ReportItem[] = [];
  // A private dataset has no link audience: its readers are its shares, so the entries go to viewer only.
  const writers: readonly DatasetRuleRole[] = visibility === 'private' ? ['viewer'] : DATASET_RULE_ROLES;
  const out = tables.map((table): DatasetTablePermissions => {
    const stored = policy.tables.find((t) => sameTable(t.table, table));
    const entry: DatasetTablePermissions = { table: { ...table }, select_permissions: select(DATASET_RULE_ROLES) };
    for (const op of MUTATIONS) {
      const viewer = stored?.[`${op}_permissions`]?.find((e) => e.role === 'viewer');
      if (viewer) (entry as unknown as Record<string, unknown>)[`${op}_permissions`] = writers.map((role) => ({ role, permission: clone(viewer.permission) }));
    }
    return entry;
  });
  const writes = out.some((t) => MUTATIONS.some((op) => t[`${op}_permissions`]?.length));
  if (writes && writers.includes('anonymous')) report.push({ code: 'anonymous_write', message: 'Signed-out readers can write, as before (rate-limited to 30 writes a minute).' });
  if (writes && visibility === 'private') report.push({ code: 'private_viewer_only', message: 'The dataset is private, so its write rules apply to shared viewers only.' });
  if (policy.execution?.functions) report.push({ code: 'functions_dropped', message: 'The function allow and deny lists have no v3 equivalent and are dropped when the policy is rewritten.' });
  return { source: 'v1', policy: { version: 3, tables: out }, report, ...(policy.execution ? { execution: clone(policy.execution) } : {}) };
}

/** v2: grants by selector. Page-scoped writes become backend_only entries (trusted owner programs). */
function fromV2(policy: DatasetGrantPolicy, tables: readonly DatasetTableName[]): ToV3Result {
  const report: ToV3ReportItem[] = [];
  const note = (code: ToV3ReportCode, message: string) => { if (!report.some((r) => r.code === code)) report.push({ code, message }); };
  const readers = new Set<DatasetRuleRole>();
  const writers = Object.fromEntries(MUTATIONS.map((op) => [op, { normal: new Set<DatasetRuleRole>(), backend: new Set<DatasetRuleRole>() }])) as Record<DatasetOperation, { normal: Set<DatasetRuleRole>; backend: Set<DatasetRuleRole> }>;
  for (const grant of policy.allow) {
    const { user, artifact, artifactOwner } = grant.from;
    const pageScoped = artifact !== undefined || artifactOwner !== undefined;
    for (const action of grant.actions) {
      if (action === 'read') {
        if (user !== undefined && user !== '*') {
          // $owner reads are implicit (owner and editors always read); a named person keeps access only through a share.
          if (user !== '$owner') { readers.add('viewer'); note('read_named_user', 'A read grant names one person: it now covers shared viewers, and that person needs a share.'); }
        } else if (pageScoped) {
          readers.add('viewer'); readers.add('signed_in');
          note('read_page_scoped', 'A read grant through one page has no v3 slot: shared viewers and signed-in link holders can read.');
        } else DATASET_RULE_ROLES.forEach((role) => readers.add(role));
        continue;
      }
      if (user !== undefined && user !== '*') {
        // The owner is implicit; a named person has no rule slot (reported, no entry).
        if (user !== '$owner') note('write_named_user', 'A write grant names one person: it has no v3 rule; share the dataset with them as an editor.');
        continue;
      }
      const target = writers[action];
      if (pageScoped) {
        target.backend.add('viewer'); target.backend.add('signed_in');
        if (artifact !== undefined || artifactOwner !== '$owner') note('write_page_scoped', 'A write grant through another page or owner now needs that page owner to hold owner or editor on the dataset.');
      } else { target.normal.add('viewer'); target.normal.add('signed_in'); }
    }
  }
  const out = tables.map((table): DatasetTablePermissions => {
    const entry: DatasetTablePermissions = { table: { ...table } };
    const reads = select([...readers]);
    if (reads.length) entry.select_permissions = reads;
    // Omitted tables allow all granted writes; an explicit list restricts each table and leaves unlisted ones unwritable.
    const restricted: DatasetTablePolicy | undefined = policy.tables === undefined ? undefined : policy.tables.find((t) => sameTable(t.table, table));
    if (policy.tables !== undefined && !restricted) return entry;
    for (const op of MUTATIONS) {
      const permission = restricted ? restricted[`${op}_permissions`]?.find((e) => e.role === 'viewer')?.permission : ALL_ROWS[op];
      if (!permission) continue;
      const roles = DATASET_RULE_ROLES.filter((role) => writers[op].normal.has(role) || writers[op].backend.has(role));
      if (roles.length) (entry as unknown as Record<string, unknown>)[`${op}_permissions`] = roles.map((role) => ({ role, permission: { ...clone(permission), ...(writers[op].normal.has(role) ? {} : { backend_only: true }) } }));
    }
    return entry;
  });
  if (policy.execution?.functions) note('functions_dropped', 'The function allow and deny lists have no v3 equivalent and are dropped when the policy is rewritten.');
  return { source: 'v2', policy: { version: 3, tables: out }, report, ...(policy.execution ? { execution: clone(policy.execution) } : {}) };
}
