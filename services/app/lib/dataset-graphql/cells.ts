/**
 * ONE TEXT CELL of a stored dataset, addressed as the generated API addresses it (a row's `_id`, a column's GraphQL
 * field), for live co-editing (lib/region-sessions, contract region-sessions CellScope): where it is, what it holds,
 * whether its column is collaborative, and its merged text written back through the one write path.
 *
 *  - Row identity is the generated API's (./model `rowIdsForObject` over the table's stored object and the identity
 *    sidecar), so `_id`s a page read are the ones found here.
 *  - A write is `UPDATE … SET <column> = $v WHERE _id = $pk` for each cell, as ONE `mutateDataset` step through the
 *    page (its audience rule, `X-Hasura-Page-Id`) with the identity sidecar carried, so the row ids survive the write.
 *    It is guarded on the head it was computed from (`expectedState`): another write landing first is `row_changed`
 *    rather than overwritten, and the caller merges it in and tries again. Every cell must be written (`affected`):
 *    a rule that no longer admits one refuses the whole step.
 */
import type { AccessActor } from '@/lib/accounts';
import { artifactState, type ArtifactRow } from '@/lib/artifacts';
import { storedPolicy } from '@/lib/dataset-permissions';
import { DatasetError, loadDatasetRows, type DatasetTable } from '@/lib/datasets';
import { isMutationRefused, mutateDataset } from '@/lib/document-data';
import type { Queryable } from '@artifactbin/contracts';
import { datasetBindingCatalog } from './authority';
import { hasuraNames, storedConfiguration } from './hasura-names';
import { ID_COLUMN, quote, rowIdsForObject, tableIdentity } from './model';

export interface DatasetCell {
  table: DatasetTable;
  tableId: string;
  /** The column's source name and its GraphQL field. */
  source: string;
  field: string;
  rowId: string;
  /** The row as stored (every column), for the update rule's filter. */
  row: Record<string, unknown>;
  /** The cell's text ('' for null). */
  value: string;
  /** The column is text and the policy names it in `collaborative_columns`. */
  collaborative: boolean;
}

const sidecar = (dataset: ArtifactRow, tableId: string) => (dataset.meta as { graphqlRowIds?: Record<string, unknown> }).graphqlRowIds?.[tableId];

/** The policy's collaborative columns of one table; none when no policy is stored or it does not read. */
function collaborativeColumns(dataset: ArtifactRow, table: DatasetTable): readonly string[] {
  try {
    const { policy } = storedPolicy({ policy: dataset.dataset_policy, tables: [] });
    return policy.tables.find((t) => t.table.schema === table.schema && t.table.name === table.name)?.collaborative_columns ?? [];
  } catch { return []; }
}

/** The cell a row `_id` and a column (its field, or its source name) address in the dataset head, or why not. */
export async function locateDatasetCell(dataset: ArtifactRow, rowId: string, column: { field: string } | { source: string }): Promise<DatasetCell | 'no_row' | 'no_column'> {
  let tables: DatasetTable[];
  try { tables = datasetBindingCatalog(dataset).tables; } catch { return 'no_row'; }
  const names = hasuraNames(tables, { title: dataset.title, configuration: storedConfiguration(dataset.dataset_policy) });
  for (const [i, table] of tables.entries()) {
    const tableId = tableIdentity(table);
    const rows = await loadDatasetRows({ meta: { objectKey: table.objectKey } });
    let ids: readonly string[];
    try { ids = rowIdsForObject(dataset.id, tableId, table.objectKey!, rows.length, sidecar(dataset, tableId)); } catch { return 'no_row'; }
    const index = ids.indexOf(rowId);
    if (index < 0) continue;
    const declared = table.columns.find((c) => ('field' in column ? names[i]!.columns[c.name] === column.field : c.name === column.source));
    if (!declared) return 'no_column';
    const row = rows[index]!, raw = row[declared.name];
    return {
      table, tableId, source: declared.name, field: names[i]!.columns[declared.name]!, rowId, row,
      value: typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : String(raw),
      collaborative: declared.type === 'string' && collaborativeColumns(dataset, table).includes(declared.name),
    };
  }
  return 'no_row';
}

export type CellWriteOutcome = { written: ArtifactRow } | { refused: 'row_changed' | 'denied' | 'failed'; detail: string };

/**
 * Writes cells of one table as one dataset step through the page, guarded on `head`. `commitEffect` runs inside the
 * committing transaction (the live rows' bookkeeping), after every cell was written.
 */
export async function writeDatasetCells(actor: AccessActor, head: ArtifactRow, pageId: string, table: Pick<DatasetCell, 'table' | 'tableId'>, writes: readonly { rowId: string; source: string; value: string }[], commitEffect: (tx: Queryable, written: ArtifactRow) => Promise<void>): Promise<CellWriteOutcome> {
  const target = `${quote(table.table.schema)}.${quote(table.table.name)}`;
  const statements = writes.map((write) => ({ sql: `UPDATE ${target} SET ${quote(write.source)} = $v WHERE ${quote(ID_COLUMN)} = $pk`, params: { v: write.value, pk: write.rowId } }));
  const [first] = statements;
  if (!first) return { refused: 'failed', detail: 'nothing to write' };
  const result = await mutateDataset(head, actor, first.sql, first.params, {
    target: { schema: table.table.schema, table: table.table.name },
    statements,
    pagePolicy: pageId,
    expectedState: artifactState(head),
    casRetries: 0,
    maxAffected: writes.length,
    rowIdentity: {
      column: ID_COLUMN,
      tableId: table.tableId,
      ids: (current: ArtifactRow, objectKey: string, count: number) => rowIdsForObject(current.id, table.tableId, objectKey, count, sidecar(current, table.tableId)),
    },
    commitEffect: async (tx, applied) => {
      // A rule that no longer admits a row writes nothing there: the whole step is refused, nothing is marked saved.
      if (applied.affected !== writes.length) throw new DatasetError('a cell is no longer writable', 403);
      await commitEffect(tx, applied.row);
    },
  });
  if (!isMutationRefused(result)) return { written: result.row };
  if (result.reason === 'row_changed' || result.reason === 'contended') return { refused: 'row_changed', detail: result.detail };
  if (result.reason === 'policy_denied' || result.reason === 'dataset_read_only') return { refused: 'denied', detail: result.detail };
  return { refused: 'failed', detail: result.detail };
}
