/**
 * WHAT A WRITE'S REPLY MAY SHOW, for both write doors (./hasura's generated mutations, ./page-sql-door). A receipt
 * never stores rows: it stores the write's outcome identity (per field: kind, affected count, written `_id`s) and the
 * reply is built from rows read under a read authority that holds at that moment:
 *
 *  - FRESH: inside the commit transaction, with the reader's read access decided on `tx` (`readAuthorityIn`), over
 *    the rows the commit wrote (`shownRows`).
 *  - REPLAY: never executed again; the written `_id`s are read NOW through the request's own load, under the
 *    reader's current role view (`rowsNow`). A replay answers the rows' current visible state, not a snapshot: a row
 *    the reader no longer sees (or that is gone) is omitted, hidden columns are absent or null.
 */
import type { Queryable } from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import type { ArtifactRow } from '@/lib/artifacts';
import type { CatalogRowView, DatasetTable } from '@/lib/datasets';
import { datasetReadAccess, datasetView, viewCatalog } from '@/lib/dataset-permissions';
import { datasetBindingCatalog } from './authority';
import { ID_COLUMN, quote, tableIdentity } from './model';
import type { DatasetRowPort, DatasetSnapshot } from './types';

/** The reader's role view and the tables (visible columns) it shows, decided at one point in time. */
export interface ReadAuthority { view: CatalogRowView | null; tables: readonly DatasetTable[]; role: string }

/**
 * What a reply's rows and counts were decided under: the role and its role view (rules, columns, session). A receipt
 * records it; a replay compares it with the reader's authority now. Null authority: the reader read nothing.
 */
export const authorityShape = (authority: { role?: string | null; view?: CatalogRowView | null } | null): string =>
  JSON.stringify(authority ? [authority.role ?? null, authority.view?.identity ?? null] : null);

/** A receipt's record of one written field: never rows. */

/**
 * The reader's read authority over one dataset decided INSIDE `tx` (a write's commit): the dataset row as the commit
 * sees it, the role through the page (or directly) from facts read on `tx` alone. Null when the reader reads nothing.
 */
export async function readAuthorityIn(tx: Queryable, actor: AccessActor, datasetId: string, pageId: string | undefined): Promise<ReadAuthority | null> {
  const row = (await tx.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL', [datasetId])).rows[0];
  if (!row || row.format !== 'dataset') return null;
  const decision = await datasetReadAccess(row, actor, { throughPage: !!pageId, ...(pageId ? { pageId } : {}), tx });
  if (!decision.allowed) return null;
  return { view: datasetView(decision), tables: viewCatalog(decision, datasetBindingCatalog(row)).tables, role: decision.role };
}

/**
 * Of `rows` (stored shape, `ID_COLUMN` set), those of `ids` the authority shows, in `ids` order, each with only the
 * visible columns (and `ID_COLUMN`). The role view's filter and limit run over the whole of `rows`, as a read does.
 */
export function shownRows(authority: ReadAuthority | null, declared: DatasetTable, rows: readonly Record<string, unknown>[], ids: readonly unknown[]): Array<Record<string, unknown>> {
  const visible = authority?.tables.find((t) => tableIdentity(t) === tableIdentity(declared));
  if (!visible || !ids.length) return [];
  const { objectKey: _stored, ...shape } = declared;
  const shown = authority!.view ? authority!.view.rows(shape, [...rows]) : [...rows];
  const byId = new Map(shown.map((r) => [r[ID_COLUMN], r]));
  const columns = visible.columns.map((c) => c.name);
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [Object.fromEntries([[ID_COLUMN, id], ...columns.map((c) => [c, row[c] ?? null])])] : [];
  });
}

/**
 * The rows of `ids` as the reader sees them NOW, read through the request's own load (its port applies the current
 * role view; a fenced load's caller checks its fences after), in `ids` order, visible columns only.
 */
export async function rowsNow(actor: AccessActor, loaded: { snapshot: DatasetSnapshot | null; port: DatasetRowPort }, tableId: string, ids: readonly string[], signal: AbortSignal): Promise<Array<Record<string, unknown>>> {
  const snapshot = loaded.snapshot;
  const visible = snapshot?.catalog.tables.find((t) => tableIdentity(t) === tableId);
  if (!snapshot || !visible || !ids.length) return [];
  const params = Object.fromEntries(ids.map((id, i) => [`k${i}`, id]));
  const statement = {
    sql: `SELECT ${[quote(ID_COLUMN), ...visible.columns.map((c) => quote(c.name))].join(', ')} FROM ${quote(visible.schema)}.${quote(visible.name)} WHERE ${quote(ID_COLUMN)} IN (${ids.map((_, i) => `$k${i}`).join(', ')})`,
    params,
  };
  const rows = await loaded.port.execute(actor, snapshot, tableId, statement, { limit: ids.length, offset: 0 }, signal);
  const byId = new Map(rows.map((r) => [r[ID_COLUMN], r]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}
