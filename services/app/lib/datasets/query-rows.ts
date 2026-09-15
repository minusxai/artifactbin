import { tableQueryInput } from '@artifactbin/utils';
import type { DatasetColumn, QueryPage, Row, Scalar, TableResult } from '@artifactbin/contracts';
import { isQueryFailure, runQueries } from '@/lib/sql/engine';

/** A computed source exposes public.rows through the same compiler as a catalog. */
export async function queryRows(
  table: { rows: Row[]; columns: DatasetColumn[] },
  sql: string,
  params: Record<string, Scalar>,
  page?: QueryPage,
): Promise<TableResult> {
  const result = (await runQueries(tableQueryInput(table, sql, params, page))).result;
  if (!result || isQueryFailure(result)) throw new Error(result?.error ?? 'Source query failed');
  return result;
}
