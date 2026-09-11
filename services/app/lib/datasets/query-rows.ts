import type { DatasetColumn, QueryPage, Row, Scalar, TableResult } from '@artifactbin/contracts';
import { isQueryFailure, runQueries } from '@/lib/sql/engine';
import { compileDatasetSql } from './sql';

/** A computed source exposes public.rows through the same compiler as a catalog. */
export async function queryRows(
  table: { rows: Row[]; columns: DatasetColumn[] },
  sql: string,
  params: Record<string, Scalar>,
  page?: QueryPage,
): Promise<TableResult> {
  const compiled = compileDatasetSql({
    kind: 'stored', defaultSchema: 'public', refreshSeconds: 0,
    tables: [{schema: 'public', name: 'rows', columns: table.columns, source: {schema: 'main', table: 'source_rows'}}],
  }, sql, params);
  const result = (await runQueries({
    tables: {source_rows: table}, queries: [{name: 'result', sql: compiled.sql}],
    params: Object.fromEntries(compiled.values.map((value, i) => [String(i + 1), value])),
    ...(page ? {page: {...page, name: 'result'}} : {}),
  })).result;
  if (!result || isQueryFailure(result)) throw new Error(result?.error ?? 'Source query failed');
  return result;
}
