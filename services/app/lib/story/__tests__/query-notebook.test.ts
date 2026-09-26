/**
 * The query notebook: every `<Query>` a document declares, paired with what
 * the last run made of it — and an edit to one cell's SQL that rewrites that
 * declaration alone.
 */
import { describe, expect, it } from 'vitest';
import { queryCells, updateQuerySqlInJsx } from '@/lib/story/query-notebook';
import type { DataflowState } from '@/lib/story/dataflow';

const SALES_SQL = 'select region, sum(revenue) as revenue from "public"."rows" where region = $region group by 1';
const SOURCE =
  '<Helmet><title>Doc</title><Value name="region" type="string" default="west" />'
  + `<Import name="sales_data" src="ref:ds1234" /><Query name="sales">{\`${SALES_SQL}\`}</Query>`
  + '<Query name="costs">{`select 1 as spend`}</Query></Helmet>'
  + '<div className="p-4"><h1>Title</h1><Question data="$sales" /></div>';

const STATE: DataflowState = {
  values: { region: 'west' },
  tables: {
    sales: { rows: [{ region: 'west', revenue: 10 }], columns: [{ name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }] },
  },
  errors: { costs: 'relation "nothing" does not exist' },
};

describe('queryCells', () => {
  it('lists every <Query> in authored order with its SQL, source and params', () => {
    const cells = queryCells(SOURCE, null);
    expect(cells.map((c) => c.name)).toEqual(['sales', 'costs']);
    expect(cells[0]).toMatchObject({ sql: SALES_SQL, source: 'ds1234', params: ['region'] });
    expect(cells[1]).toMatchObject({ sql: 'select 1 as spend', source: null, params: [] });
  });

  it('pairs each cell with the last run: rows, an error, or nothing yet', () => {
    const [sales, costs] = queryCells(SOURCE, STATE);
    expect(sales!.result?.rows).toEqual([{ region: 'west', revenue: 10 }]);
    expect(sales!.error).toBeNull();
    expect(costs!.result).toBeNull();
    expect(costs!.error).toBe('relation "nothing" does not exist');
    const [unrun] = queryCells(SOURCE, null);
    expect(unrun).toMatchObject({ result: null, error: null, pending: false });
  });

  it('marks every cell pending while a run is in flight', () => {
    expect(queryCells(SOURCE, STATE, true).every((c) => c.pending)).toBe(true);
  });

  it('is empty for a document without queries, and for one that does not parse', () => {
    expect(queryCells('<div><p>prose</p></div>', null)).toEqual([]);
    expect(queryCells('<div><p>unclosed', null)).toEqual([]);
  });
});

describe('what a query powers', () => {
  const BOUND_SOURCE =
    '<Helmet><Query name="sales">{`select 1 as x`}</Query><Query name="unused">{`select 2`}</Query></Helmet>'
    + '<div className="p-4"><h1>Title</h1><Question title="Revenue by region" data="$sales" />'
    + '<p>prose</p><Number data="$sales" col="x" /><select options="$sales" value="$pick" /></div>';

  it('lists every element bound to the query by BODY path, with its title when it has one', () => {
    const [sales, unused] = queryCells(BOUND_SOURCE, null);
    expect(sales!.bound).toEqual([
      { tag: 'Question', label: 'Revenue by region', path: '0.1' },
      { tag: 'Number', label: null, path: '0.3' },
      { tag: 'select', label: null, path: '0.4' },
    ]);
    expect(unused!.bound).toEqual([]);
  });

  it('paths are body paths even when the document has no Helmet offset to subtract', () => {
    const [sales] = queryCells('<Question data="$sales" /><Helmet><Query name="sales">{`select 1`}</Query></Helmet>', null);
    expect(sales!.bound).toEqual([{ tag: 'Question', label: null, path: '0' }]);
  });
});

describe('updateQuerySqlInJsx', () => {
  it('rewrites the named declaration and leaves the rest of the document alone', () => {
    const next = updateQuerySqlInJsx(SOURCE, 'costs', 'select 2 as spend');
    const cells = queryCells(next, null);
    expect(cells.map((c) => c.sql)).toEqual([SALES_SQL, 'select 2 as spend']);
    expect(cells[0]!.source).toBe('ds1234');
    expect(next).toContain('<title>Doc</title>');
    expect(next).toContain('<Question data="$sales" />');
    expect(next).toContain('<h1>Title</h1>');
  });

  it('keeps SQL that needs escaping readable after a round trip', () => {
    const tricky = 'select `a` as x, \'${y}\' as y, \'\\\\\' as z';
    const next = updateQuerySqlInJsx(SOURCE, 'costs', tricky);
    expect(queryCells(next, null)[1]!.sql).toBe(tricky);
  });

  it('returns the source unchanged for an unknown name, empty SQL, the same SQL, or a document that does not parse', () => {
    expect(updateQuerySqlInJsx(SOURCE, 'nope', 'select 1')).toBe(SOURCE);
    expect(updateQuerySqlInJsx(SOURCE, 'costs', '   ')).toBe(SOURCE);
    expect(updateQuerySqlInJsx(SOURCE, 'costs', 'select 1 as spend')).toBe(SOURCE);
    expect(updateQuerySqlInJsx('<div><p>unclosed', 'costs', 'select 1')).toBe('<div><p>unclosed');
  });
});
