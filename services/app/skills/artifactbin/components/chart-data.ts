/**
 * Internal: where af-chart's rows come from: its one source (chart.ts). The SQL sources run
 * through the page SQL plumbing af-data-table shares (page-sql.ts): `@afbin/apollo`'s `sql.watch`
 * as the reader, rerun when a dataset they name changes, a closed opening's late answer dropped.
 * Used by: chart.ts.
 */
import { CHART_LIMITS } from '@/lib/html-component-specs/chart-spec';
import type { ReadFailure } from '@/lib/html-component-specs/read-failure';
import type { ChartRows } from './chart-model';
import { watchPageSql, type PageSqlRuntime, type PageStatement } from './page-sql';

/** A statement as the `sql` tag of `@afbin/apollo` builds it. */
export type ChartStatement = PageStatement;
/** The page runtime the SQL sources need; chart-render.ts supplies the hosted module. */
export type ChartRuntime = PageSqlRuntime;

export type ChartSource =
  | { kind: 'sql'; text: string }
  | { kind: 'query'; statement: ChartStatement }
  | { kind: 'dataset'; name: string }
  | { kind: 'rows'; rows: ChartRows }
  | { kind: 'none' };

/** The one source the element was given, or what to fix when it was given several or a bad one. */
export function chooseSource(sql: string | null, dataset: string | null,
  query: ChartStatement | null, rows: unknown): ChartSource | { error: string } {
  const given = [sql !== null && 'sql', dataset !== null && 'dataset', query !== null && 'query',
    rows != null && 'rows'].filter((name): name is string => Boolean(name));
  if (given.length > 1) {
    return { error: `give the chart one data source, not ${given.join(' and ')}` };
  }
  if (sql !== null) {
    return sql.trim() ? { kind: 'sql', text: sql } : { error: 'the sql attribute is empty' };
  }
  if (dataset !== null) {
    return dataset.trim() ? { kind: 'dataset', name: dataset.trim() }
      : { error: 'the dataset attribute names no linked dataset (its data-af-name)' };
  }
  if (query !== null) {
    return typeof query?.text === 'string' && typeof query.then === 'function'
      ? { kind: 'query', statement: query }
      : { error: 'query takes a statement made with the sql tag of @afbin/apollo' };
  }
  if (rows != null) {
    const objects = Array.isArray(rows)
      && rows.every(row => row != null && typeof row === 'object' && !Array.isArray(row));
    return objects ? { kind: 'rows', rows: rows as ChartRows }
      : { error: 'rows is an array of objects, one per row' };
  }
  return { kind: 'none' };
}

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Column names: the answer's own, else every key the rows use, in first-seen order. */
export function columnsOf(rows: ChartRows): string[] {
  const named = (rows as { columns?: unknown }).columns;
  if (Array.isArray(named) && named.every(c => typeof c?.name === 'string')) {
    return named.map(c => c.name as string);
  }
  const names = new Set<string>();
  for (const row of rows.slice(0, 200)) for (const key of Object.keys(row)) names.add(key);
  return [...names];
}

/**
 * Start `source`: `deliver` gets each answer (now for rows and none), `fail` what to fix. Returns
 * the close; after it nothing more is delivered.
 */
export function openSource(source: ChartSource, runtime: ChartRuntime,
  deliver: (rows: ChartRows, columns: string[], truncated: boolean) => void,
  fail: (failure: ReadFailure | string) => void): () => void {
  let open = true, stop = () => {};
  const accept = (answer: unknown) => {
    if (!open) return;
    if (!Array.isArray(answer)) return fail('the statement is not a read: give the chart a SELECT');
    if (answer.length > CHART_LIMITS.rows) {
      return fail(`more than ${CHART_LIMITS.rows.toLocaleString('en')} rows: aggregate in SQL ` +
        '(GROUP BY) so the chart draws a summary');
    }
    deliver(answer as ChartRows, columnsOf(answer as ChartRows),
      (answer as { truncated?: unknown }).truncated === true);
  };
  if (source.kind === 'rows') accept(source.rows);
  else if (source.kind === 'none') deliver([], [], false);
  else {
    stop = watchPageSql(runtime, source.kind === 'query' ? source.statement
      : source.kind === 'sql' ? source.text
        : `select * from ${quoted(source.name)} limit ${CHART_LIMITS.rows + 1}`,
    accept, fail, 'this page has no @afbin/apollo to read sql, query or dataset: give rows');
  }
  return () => { open = false; stop(); };
}
