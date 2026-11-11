/**
 * THE RULES OF A LIVE DATASET, in the dataset's ordinary version 3 rules document: its one table is the conventional
 * `public.queries`, and a select entry on it for a rule role (`viewer`, `signed_in`, `anonymous`) means "this role may
 * run the queries pages declare on this dataset". Owner and editors may always run any SQL. Nothing else applies to a
 * connection (it has no rows here to filter, hide or write), so anything else is refused by name.
 *
 *   {"version":3,"tables":[{"table":{"schema":"public","name":"queries"},
 *     "select_permissions":[{"role":"signed_in","permission":{"columns":"*","filter":{}}}]}]}
 */
import type { DatasetPermissions, DatasetPermissionsIssue, DatasetTableName } from '@artifactbin/contracts';

export const LIVE_QUERY_TABLE: DatasetTableName = Object.freeze({ schema: 'public', name: 'queries' });

const isEmptyObject = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length;

/** Every way `policy` says more than "these roles run declared queries". */
export function liveRulesProblems(policy: DatasetPermissions): DatasetPermissionsIssue[] {
  const problems: DatasetPermissionsIssue[] = [];
  policy.tables.forEach((t, i) => {
    const at = `tables[${i}]`;
    if (t.table.schema !== LIVE_QUERY_TABLE.schema || t.table.name !== LIVE_QUERY_TABLE.name) problems.push({ path: `${at}.table`, message: 'a live dataset\'s rules name one table, public.queries: who may run the queries pages declare' });
    for (const op of ['insert_permissions', 'update_permissions', 'delete_permissions'] as const)
      if ((t[op]?.length ?? 0) > 0) problems.push({ path: `${at}.${op}`, message: 'a live dataset is read-only: only select_permissions apply' });
    if (t.collaborative_columns?.length) problems.push({ path: `${at}.collaborative_columns`, message: 'a live dataset has no collaborative columns' });
    if (t.configuration !== undefined) problems.push({ path: `${at}.configuration`, message: 'a live dataset has no GraphQL names' });
    (t.select_permissions ?? []).forEach((entry, j) => {
      const p = entry.permission;
      if (p.columns !== '*' && !(Array.isArray(p.columns) && !p.columns.length)) problems.push({ path: `${at}.select_permissions[${j}].permission.columns`, message: 'write "*": a rule admits a role to the declared queries, whole' });
      if (!isEmptyObject(p.filter) && p.filter !== undefined) problems.push({ path: `${at}.select_permissions[${j}].permission.filter`, message: 'write {}: a declared query decides its own rows (it may use :viewer_id, :viewer_email and :viewer_groups)' });
    });
  });
  return problems;
}

/** The roles `policy` admits to the declared queries. */
export const liveQueryRoles = (policy: DatasetPermissions): string[] =>
  policy.tables.filter((t) => t.table.schema === LIVE_QUERY_TABLE.schema && t.table.name === LIVE_QUERY_TABLE.name).flatMap((t) => (t.select_permissions ?? []).map((e) => e.role));
