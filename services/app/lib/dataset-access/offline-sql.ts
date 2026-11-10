/**
 * WHAT AN OFFLINE COPY'S `sql` READS: the tables the page SQL door (./page-sql-door) would mount for this reader, with
 * their rows, so a downloaded page (lib/html-runtime offline-sql) answers its own `sql` reads with no network.
 *
 * Exactly the door's read world, never more: the page audience rule through `loadLinked`, each table the reader's role
 * view (hidden columns absent, the select rule's filter applied, tables the role cannot select absent, a dataset the
 * reader cannot read absent as if unlinked), `_id` the row's id, the load's read fences checked after the rows are
 * read. Every link the page has is carried, not only those a statement names: an offline page's statements are built
 * by its own code, which the server never runs. Null when there is nothing to carry, the fences failed, or the rows
 * would not fit `maxBytes`: the copy then carries no data and its `sql` says so.
 */
import type { ColumnType, HtmlDatasetLink, Row } from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import { readMountRows } from '@/lib/datasets';
import { loadLinked } from './linked';
import { pageSqlMounts } from './page-sql';

/** The embedded tables, by SQL name: `main.<link>` for a single-table dataset, `<link>.<table>` otherwise. */
export interface OfflineSqlData { tables: Array<{ schema: string; name: string; columns: Array<{ name: string; type: ColumnType }>; rows: Row[] }> }

export async function offlinePageSqlData(actor: AccessActor, links: readonly HtmlDatasetLink[], pageId: string, maxBytes: number, signal: AbortSignal): Promise<OfflineSqlData | null> {
  if (!links.length) return null;
  const loaded = await loadLinked(actor, links, { pageId, fenced: true }, signal);
  const linked = loaded.map((l) => ({ link: l.link!.name, snapshot: l.snapshot, tables: l.tables.map((t) => ({ tableId: t.tableId, selectable: t.model.select !== false })) }));
  const mounts = pageSqlMounts(linked, new Set(linked.map((l) => l.link)), false);
  if (!mounts.length) return null;
  const tables: OfflineSqlData['tables'] = [];
  let bytes = 0;
  for (const m of mounts) {
    signal.throwIfAborted();
    const rows = await readMountRows(m);
    bytes += new TextEncoder().encode(JSON.stringify(rows)).length;
    if (bytes > maxBytes) return null;
    tables.push({ schema: m.schema, name: m.name, columns: m.columns.map((c) => ({ name: c.name, type: c.type })), rows });
  }
  try { for (const l of loaded) for (const verify of l.fences) await verify(); } catch { return null; }
  return { tables };
}
