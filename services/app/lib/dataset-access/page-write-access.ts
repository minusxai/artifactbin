/**
 * Edit hints for a stored link, from the page SQL door's own table model. Evaluate old-row filters against
 * only the viewer's SQL mount. A filter needing a hidden column cannot be answered. The post-write check,
 * type constraints, and concurrent changes are decided by the actual write.
 */
import type { HtmlDatasetLink } from '@artifactbin/contracts/html-page';
import { SQL_WRITE_ACCESS_LIMIT, type SqlWriteAccessRequest, type SqlWriteAccess, type SqlWriteAccessStatus } from '@artifactbin/contracts/sql';
import type { PolicyPredicate } from '@artifactbin/contracts/dataset-policy';
import { compilePolicyPredicate, policyValue } from '@artifactbin/utils/dataset-policy';
import type { AccessActor } from '@/lib/accounts';
import { loadLinked } from './linked';
import { ID_COLUMN, quote } from './model';
import { mountsOf } from './page-sql-door';

const name = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const list = (value: unknown): value is string[] => Array.isArray(value) && value.length <= SQL_WRITE_ACCESS_LIMIT && value.every(name);

export function checkedWriteAccess(value: unknown): SqlWriteAccessRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const {link, table, insert, update, ids} = value as Record<string, unknown>;
  if (!name(link) || (table !== undefined && !name(table)) || (ids !== undefined && !list(ids))
      || (insert !== undefined && (!list(insert) || !insert.length))
      || (update !== undefined && (!list(update) || !update.length))) return null;
  return {link, table, insert, update, ids};
}

export async function pageWriteAccess(
  actor: AccessActor, links: readonly HtmlDatasetLink[], request: SqlWriteAccessRequest,
  scope: {pageId: string; readOnly: boolean; retainReadFence: (verify: () => Promise<void>) => void}, signal: AbortSignal,
): Promise<SqlWriteAccess> {
  const {ids = []} = request;
  const denied: SqlWriteAccess = {insert: 'denied', rows: ids.map(() => ({update: 'denied', delete: false}))};
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const link = links.find(link => same(link.name, request.link));
  if (scope.readOnly || !link || link.mode === 'pinned') return denied;
  const loaded = await loadLinked(actor, [link], {...scope, fenced: true, deferRowIds: true}, signal);
  const mount = mountsOf(loaded).find(m => m.loaded.snapshot && m.table.model.select !== false &&
    (request.table === undefined ? m.schema === 'main' : same(m.schema, link.name) && same(m.name, request.table!)));
  const write = mount?.table.model.write;
  if (!mount || !write) return denied;
  const {table, loaded: dataset} = mount;
  const snapshot = dataset.snapshot!;
  const policy = table.mutationPolicy;
  const visible = snapshot.catalog.tables.find(t => t.schema === table.declared.schema && t.name === table.declared.name)!;
  const declared = [ID_COLUMN, ...table.declared.columns.map(c => c.name)];
  const visibleColumns = [ID_COLUMN, ...visible.columns.map(c => c.name)];
  const session = policy?.session ?? {};
  const target = `${quote(visible.schema)}.${quote(visible.name)}`;
  const key = quote(ID_COLUMN);
  const permitsColumns = (requested: string[] | undefined, allowed: typeof write.insert) =>
    !!requested && requested.every(name => allowed?.some(c => same(c.source, name)));

  const insert = policy?.table.insert_permissions?.[0]?.permission;
  const update = policy?.table.update_permissions?.[0]?.permission;
  const del = policy?.table.delete_permissions?.[0]?.permission;
  const status = (rule: typeof insert | typeof update): SqlWriteAccessStatus => {
    try {
      for (const value of Object.values(rule?.set ?? {})) policyValue(value, session);
      if (!rule?.check || !Object.keys(rule.check).length) return 'allowed';
      compilePolicyPredicate(rule.check, declared, session, 'check', {rowId: ID_COLUMN});
      return 'conditional';
    } catch { return 'denied'; }
  };
  const filter = (rule: {filter?: PolicyPredicate} | undefined, prefix: string) => {
    try { return compilePolicyPredicate(rule?.filter ?? {}, visibleColumns, session, prefix, {rowId: ID_COLUMN}); }
    catch { return null; }
  };
  const insertStatus = permitsColumns(request.insert, write.insert) ? status(insert) : 'denied';
  const updateStatus = permitsColumns(request.update, write.update) ? status(update) : 'denied';
  const updateFilter = updateStatus !== 'denied' ? filter(update, 'edit') : null;
  const deleteFilter = write.delete ? filter(del, 'remove') : null;
  if (!ids.length || (!updateFilter && !deleteFilter)) return {...denied, insert: insertStatus};

  const rows = await dataset.port.execute(actor, snapshot, table.tableId, {
    sql: `SELECT ${key}, COALESCE(${updateFilter?.sql ?? '0'}, 0) AS can_update,
      COALESCE(${deleteFilter?.sql ?? '0'}, 0) AS can_delete
      FROM ${target} WHERE ${key} IN (SELECT value FROM json_each($ids))`,
    params: {...updateFilter?.params, ...deleteFilter?.params, ids: JSON.stringify(ids)},
  }, {offset: 0, limit: ids.length}, signal);
  const byId = new Map(rows.map(row => {
    return [row[ID_COLUMN], {update: row.can_update ? updateStatus : 'denied' as const, delete: !!row.can_delete}];
  }));
  return {insert: insertStatus, rows: ids.map((id, i) => byId.get(id) ?? denied.rows[i]!)};
}
