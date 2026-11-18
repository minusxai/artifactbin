/**
 * Internal: af-data-table's `sql` attribute read live (page-sql.ts): each answer becomes its data
 * (the same array, so its `source` labels it), a failure its error; aria-busy until a reply.
 * Used by: data-table.ts.
 */
import { failureOf } from '@/lib/html-component-specs/read-failure';
import { pageSqlRuntime, watchPageSql } from './page-sql';
import type { TableData } from './table-model';

type Host = HTMLElement & { data: TableData; error: unknown };
type Answer = TableData['rows'] & { columns?: TableData['columns']; truncated?: boolean };

export class TableSqlRead {
  private text: string | null = null;
  private close = () => {};
  constructor(private readonly host: Host) {}

  /** Read `text` (null: stop, keeping the rows); the text already read keeps its watch. */
  open(text: string | null): void {
    if (text === this.text) return;
    this.stop();
    this.text = text;
    const host = this.host, fail = (problem: Parameters<typeof failureOf>[0]) => {
      host.removeAttribute('aria-busy');
      host.error = failureOf(problem);
    };
    if (text === null) return;
    if (!text.trim()) return fail('the sql attribute is empty');
    host.setAttribute('aria-busy', 'true');
    this.close = watchPageSql(pageSqlRuntime, text, answer => {
      if (!Array.isArray(answer)) return fail('the statement is not a read: give a SELECT');
      host.removeAttribute('aria-busy');
      const rows = answer as Answer;
      host.data = { rows, truncated: rows.truncated === true, columns: rows.columns
        ?? Object.keys(rows[0] ?? {}).map(name => ({ name, type: 'string' as const })) };
    }, fail, 'this page has no @afbin/apollo to read sql');
  }

  stop(): void {
    this.close();
    this.close = () => {};
    this.text = null;
    this.host.removeAttribute('aria-busy');
  }
}
