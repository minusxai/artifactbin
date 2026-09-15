import type { DatasetColumn, QueryPage, Row, RunInput, Scalar } from '@artifactbin/contracts';

/** One computed/local table uses the same native public.rows catalog on every transport. */
export function tableQueryInput(table: {rows: Row[]; columns: DatasetColumn[]}, sql: string, params: Record<string, Scalar>, page?: QueryPage): RunInput {
  return {
    tables:{source_rows:table},
    catalog:{defaultSchema:'public',tables:[{schema:'public',name:'rows',source:'source_rows',columns:table.columns}]},
    queries:[{name:'result',sql}], params,
    ...(page ? {page:{...page,name:'result'}} : {}),
  };
}
