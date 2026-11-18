/**
 * Internal: one live page SQL read, shared by af-chart and af-data-table: `@afbin/apollo`'s
 * `sql.watch` as the reader, rerun when a dataset it names changes; after close, nothing arrives.
 * Used by: chart-data.ts, data-table-sql.ts.
 */
import { readFailure, type ReadFailure } from '@/lib/html-component-specs/read-failure';

/** A statement as the `sql` tag of `@afbin/apollo` builds it. */
export interface PageStatement extends PromiseLike<unknown> {
  readonly text: string;
  readonly params: Readonly<Record<string, unknown>>;
}
interface SqlTag {
  (strings: TemplateStringsArray): PageStatement;
  watch(s: PageStatement, next: (rows: unknown) => void, error: (e: Error) => void): () => void;
}
export interface PageSqlRuntime { apollo(): Promise<{ sql: SqlTag }> }
/** The hosted module (a constant template esbuild folds to the import map's literal name). */
export const pageSqlRuntime: PageSqlRuntime = {
  apollo: () => import(/* @vite-ignore */ `@afbin/${'apollo'}`),
};

/** Watch `read` (text or statement); `missing` fails a page without apollo. Returns the close. */
export function watchPageSql(runtime: PageSqlRuntime, read: string | PageStatement,
  next: (answer: unknown) => void, fail: (failure: ReadFailure | string) => void,
  missing: string): () => void {
  let open = true, stop = () => {};
  runtime.apollo().then(({ sql }) => {
    if (!open) return;
    const statement = typeof read === 'string'
      ? sql(Object.assign([read], { raw: [read] }) as unknown as TemplateStringsArray) : read;
    stop = sql.watch(statement, answer => { if (open) next(answer); }, error => {
      if (open) fail(readFailure(error, 'Could not read the rows: '));
    });
  }, () => { if (open) fail(missing); });
  return () => { open = false; stop(); };
}
