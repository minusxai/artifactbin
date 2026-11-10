/**
 * THE PAGE'S DATASETS AS SQL TABLES, for a resolver's `caps.sql`: the same load `caps.query` runs (loadLinked: the
 * page audience rule over each dataset's own sharing, `X-Hasura-Page-Id` the page), so each table is exactly what
 * the caller could read through GraphQL: the role view's rows (filter and rule limit applied by the executor),
 * hidden columns absent, tables the role cannot select absent, a dataset it reads nothing of absent as if unlinked.
 *
 * A single-table dataset is the table `<link>`; a multi-table one is `<link>.<table>` (an attached schema, as the
 * SQL service mounts imports). Every table carries `_id`, the row's generated-API id, so a result can name the
 * rows a mutation then changes through `caps.query`. Reads of one revision under one role view are shared while
 * in flight. The fences retained by the load are checked again once every table is read.
 */
import type { AccessActor } from '@/lib/accounts';
import { createSharedReads } from '@/lib/datasets';
import type { DatasetColumn, HtmlDatasetLink, Row } from '@artifactbin/contracts';
import { loadLinked } from './linked';
import { ID_COLUMN, quote, tableIdentity } from './model';

/** One mounted table: `table` is null for a single-table dataset (mounted as `<link>`). */
interface LinkedSqlTable {
  link: string;
  table: string | null;
  columns: DatasetColumn[];
  rows: Row[];
  /** May the caller's role run SQL over it (dataset-permissions `canRunSql`; owner and editor always)? */
  runsSql: boolean;
}

/** More rows than the call may take: the caller's tables together exceed `maxRows`. */
class LinkedSqlInputLimit extends Error {
  constructor() { super('sql_input_limit'); }
}

const sharedRead = createSharedReads<Record<string, unknown>[]>();
/** The engine's largest window per statement (lib/datasets executeCatalog). */
const WINDOW = 10000;

/** Retain authorized schema snapshots once; only selected, SQL-admitted links open rows. */
export async function planLinkedDatasetTables(actor: AccessActor, links: readonly HtmlDatasetLink[], options: { pageId: string; maxRows: number }, signal: AbortSignal) {
  // Fenced: every retained fence is checked below, before any table leaves.
  const loaded = await loadLinked(actor, links, { pageId: options.pageId, fenced: true, deferRowIds: true }, signal);
  const tables: Omit<LinkedSqlTable, 'rows'>[] = [];
  for (const l of loaded) {
    if (!l.snapshot) continue;
    const single = Object.keys(l.snapshot.names ?? {}).length <= 1;
    for (const { tableId, model } of l.tables) {
      if (model.select === false) continue;
      const visible = l.snapshot.catalog.tables.find((t) => tableIdentity(t) === tableId);
      if (!visible) continue;
      const columns = visible.columns.map((c): DatasetColumn => ({ name: c.name, type: c.type }));
      if (!columns.some((c) => c.name.toLowerCase() === '_id')) columns.unshift({ name: '_id', type: 'string' });
      tables.push({ link: l.link!.name, table: single ? null : visible.name, columns, runsSql: l.snapshot.runsSql?.[tableId] ?? false });
    }
  }
  return { tables, read: async (selected: ReadonlySet<string>) => {
    signal.throwIfAborted();
    const retained = loaded.filter((l) => selected.has(l.link!.name));
    // Defense in depth: denied rows never reach the executor, even through this retained seam.
    if (tables.some((t) => selected.has(t.link) && !t.runsSql)) throw new Error('sql_aggregation_denied');
    const out: LinkedSqlTable[] = [];
    let remaining = options.maxRows;
    for (const l of retained) {
      signal.throwIfAborted();
      const snapshot = l.snapshot;
      // A role that may only write reads nothing here.
      if (!snapshot) continue;
      const single = Object.keys(snapshot.names ?? {}).length <= 1;
      const seen = new Set<string>();
      for (const { tableId, model } of l.tables) {
        if (model.select === false) continue;
        const visible = snapshot.catalog.tables.find((t) => tableIdentity(t) === tableId);
        if (!visible) continue;
        if (!single && seen.has(visible.name.toLowerCase())) throw new Error('sql_table_name_collision');
        seen.add(visible.name.toLowerCase());
        const columns = visible.columns.map((c): DatasetColumn => ({ name: c.name, type: c.type }));
        const id = !columns.some((c) => c.name.toLowerCase() === '_id');
        const select = [...(id ? [`${quote(ID_COLUMN)} AS ${quote('_id')}`] : []), ...columns.map((c) => quote(c.name))];
        const statement = { sql: `SELECT ${select.join(', ')} FROM ${quote(visible.schema)}.${quote(visible.name)}`, params: {} };
        // One revision under one role view (its identity names the role, rules and session) is one shared read.
        const read = (limit: number, offset: number) => sharedRead(
          JSON.stringify([snapshot.id, snapshot.revision, snapshot.policyIdentity, tableId, actor, options.pageId, statement.sql, limit, offset]),
          signal,
          (shared) => l.port.execute(actor, snapshot, tableId, statement, { limit, offset }, shared),
        );
        const limit = Math.min(Math.max(remaining, 1), WINDOW);
        const rows = await read(limit, 0);
        if (rows.length > remaining) throw new LinkedSqlInputLimit();
        // A full window may hide more rows: one past it says whether the table fits.
        if (rows.length === limit && (await read(1, limit)).length) throw new LinkedSqlInputLimit();
        remaining -= rows.length;
        out.push({ link: l.link!.name, table: single ? null : visible.name, columns: [...(id ? [{ name: '_id', type: 'string' as const }] : []), ...columns], rows, runsSql: snapshot.runsSql?.[tableId] ?? false });
      }
    }
    // Rows leave only if the role, policy and head they were read under still hold.
    for (const l of retained) for (const verify of l.fences) { signal.throwIfAborted(); await verify(); }
    signal.throwIfAborted();
    return out;
  } };
}
