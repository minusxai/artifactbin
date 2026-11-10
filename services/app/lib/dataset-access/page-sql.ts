/**
 * A PAGE'S `_sql`: one read-only statement over the datasets the page VERSION links, as the reader, on the SQL
 * service (lib/datasets `executeMounted`). The links are the ones the request already loaded for the page's dataset
 * roots (`loadPageDatasets`): the same page audience rule, pinned revisions and read fences, so `_sql` never reads
 * more than the reader's GraphQL reads. A single-table dataset is the table `<link>`; a multi-table one is
 * `<link>.<table>`; every table carries `_id`, the row's GraphQL id. Each table is the role view's: hidden columns
 * absent, the rule's filter and limit applied, tables the role cannot select absent.
 *
 * SQL can aggregate, so like a resolver's caps.sql (lib/page-operations sql) only the links the SQL text names are
 * mounted, and a mounted table whose rule for the reader does not allow SQL (`allow_aggregations`,
 * dataset-permissions `canRunSql`) refuses the call (owner and editor always may). caps.sql reads the page HEAD's links (a resolver run names a page, not a revision); `_sql`
 * answers for the revision the reader has open. Limits: SQL_READ_LIMITS rows and statement deadline; the page
 * response's own 4 MiB cap bounds the answer.
 *
 * Mounts are keyed by content (object, columns, row IDs, role view), so repeated reads of unchanged rows under one
 * view answer from the engine's prepared database: a live refetch after an unrelated write costs one query.
 */
import { GraphQLError } from 'graphql';
import { SQL_READ_LIMITS, type ColumnType, type DatasetColumn, type Scalar } from '@artifactbin/contracts';
import { CatalogQueryFailure, executeMounted, selectSqlLinks, type CatalogMount } from '@/lib/datasets';
import { sqlRefusalMessage } from '@/lib/dataset-permissions';
import { ID_COLUMN, tableIdentity } from './model';
import type { DatasetSnapshot } from './types';

/** One loaded link as `_sql` mounts it: its page name, the reader's snapshot (null: it only writes) and its tables. */
export interface SqlLinkedDataset { link: string; snapshot: DatasetSnapshot | null; tables: ReadonlyArray<{ tableId: string; selectable: boolean }> }
export interface PageSqlCall { sql: string; params: Readonly<Record<string, Scalar>> }
export interface PageSqlAnswer { columns: Array<{ name: string; type: ColumnType }>; rows: Array<Record<string, unknown>> }

const refuse = (code: string, message: string): never => { throw new GraphQLError(message, { extensions: { code } }); };

/** The reader's tables of the links the statement names, refused whole when one may not run SQL. */
export function pageSqlMounts(loaded: readonly SqlLinkedDataset[], selected: ReadonlySet<string>, authorize = true): CatalogMount[] {
  const mounts: CatalogMount[] = [];
  for (const l of loaded) {
    const snapshot = l.snapshot;
    if (!snapshot || !selected.has(l.link)) continue;
    const single = Object.keys(snapshot.names ?? {}).length <= 1;
    for (const { tableId, selectable } of l.tables) {
      const visible = selectable ? snapshot.catalog.tables.find((t) => tableIdentity(t) === tableId) : undefined;
      if (!visible || visible.sql !== undefined) continue;
      if (authorize && !snapshot.runsSql?.[tableId]) refuse('permission_denied', `_sql: ${sqlRefusalMessage(l.link)}`);
      const id = !visible.columns.some((c) => c.name.toLowerCase() === '_id');
      const columns: DatasetColumn[] = [...(id ? [{ name: '_id', type: 'string' as const }] : []), ...visible.columns.map((c) => ({ name: c.name, type: c.type }))];
      mounts.push({
        schema: single ? 'main' : l.link, name: single ? l.link : visible.name, columns, stored: visible, view: snapshot.view ?? null,
        rowIds: { column: ID_COLUMN, ids: snapshot.rowIds[tableId] ?? [], ...(id ? { as: '_id' } : {}) },
      });
    }
  }
  return mounts;
}

/**
 * `aggregates: 'visible'` (the page SQL door, ./page-sql-door): no `allow_aggregations` gate; the reader aggregates
 * over the rows its role view shows, which is all a mount ever holds.
 */
export async function runPageSql(loaded: readonly SqlLinkedDataset[], call: PageSqlCall, signal: AbortSignal, options: { aggregates?: 'gated' | 'visible' } = {}): Promise<PageSqlAnswer> {
  let result;
  const deadline = performance.now() + SQL_READ_LIMITS.timeoutMs;
  try {
    const relations = loaded.flatMap((l) => pageSqlMounts([l], new Set([l.link]), false).map((m) => ({ link: l.link, schema: m.schema, table: m.name, columns: m.columns })));
    let selected: Set<string>;
    try { const plan = await selectSqlLinks(relations, { tables: {}, queries: [{ name: 'result', sql: call.sql }], paramNames: Object.keys(call.params) }, { signal, deadline });
      if (plan.errors.result?.timedOut) throw new CatalogQueryFailure('SQL statement timed out', true);
      if (Object.keys(plan.errors).length) return refuse('validation_failed', 'SQL statement could not be prepared');
      selected = plan.selected; }
    catch (e) {
      if (e instanceof CatalogQueryFailure) throw e;
      signal.throwIfAborted();
      if (performance.now() >= deadline) return refuse('timeout', `a statement runs at most ${SQL_READ_LIMITS.timeoutMs} ms`);
      return refuse('validation_failed', 'SQL statement could not be prepared');
    }
    signal.throwIfAborted();
    const mounts = pageSqlMounts(loaded, selected, options.aggregates !== 'visible');
    result = await executeMounted(mounts, call.sql, { ...call.params }, { limit: SQL_READ_LIMITS.rows, timeoutMs: Math.max(1, deadline - performance.now()), outputBytes: SQL_READ_LIMITS.outputBytes, signal });
  } catch (e) {
    if (e instanceof CatalogQueryFailure && e.tooLarge) return refuse('result_too_large', TOO_LARGE);
    if (e instanceof CatalogQueryFailure) return refuse(e.timedOut ? 'timeout' : 'validation_failed', e.timedOut ? `a statement runs at most ${SQL_READ_LIMITS.timeoutMs} ms` : e.message);
    if (e instanceof Error && e.message.startsWith('Dataset SQL: ')) return refuse('validation_failed', e.message);
    throw e;
  }
  if (result.truncated) refuse('result_too_large', `a result is at most ${SQL_READ_LIMITS.rows} rows; aggregate or filter in SQL`);
  const answer = { columns: result.columns.map((c) => ({ name: c.name, type: c.type })), rows: result.rows as Array<Record<string, unknown>> };
  // The engine's count is a lower bound of the JSON (text by length); the answer as it will travel is measured exactly.
  if (jsonBytes(answer) > SQL_READ_LIMITS.outputBytes) refuse('result_too_large', TOO_LARGE);
  return answer;
}
const TOO_LARGE = `a result is at most ${SQL_READ_LIMITS.outputBytes} bytes; select fewer rows or columns`;
/** A value's serialized size in UTF-8 bytes. */
export const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;
