/**
 * runDataflow: a document's declarations + its datasets → the DataflowState
 * the island carries. Ordering, overrides, partial re-runs, and failure shape.
 */
import { describe, expect, it } from 'vitest';
import { DISPLAY_ROWS } from '@artifactbin/contracts';
import { runDataflow } from '@/lib/sql/run-dataflow';
import { EMPTY_COMPILED_DATAFLOW } from '@/lib/story/compiled-dataflow';
import { compiledOf } from '@/test/helpers/compiled';

const SALES = {
  rows: [{ region: 'EU', revenue: 100 }, { region: 'EU', revenue: 200 }, { region: 'NA', revenue: 300 }],
  columns: [{ name: 'region', type: 'string' as const }, { name: 'revenue', type: 'number' as const }],
};
const N = [{ name: 'n', type: 'number' as const }];
/** Imports by name, as the server hands them to the engine: `sales_data.rows`. */
const DATASETS = { sales_data: { rows: SALES } };

const FLOW = await compiledOf(
  '<Value name="region" type="string" />' +
  '<Value name="min_rev" type="number" default={0} />' +
  '<Value name="tiny" type="table" value={[{"k":"a"},{"k":"b"}]} />' +
  '<Query name="top">{`select region from sales order by revenue desc limit 1`}</Query>' +
  '<Import name="sales_data" src="ref:abc123" /><Query name="sales">{`select region, sum(revenue) revenue from sales_data.rows where ($region is null or region = $region) and revenue >= $min_rev group by 1 order by 1`}</Query>' +
  '<Query name="k">{`select count(*) n from tiny`}</Query>',
  { abc123: SALES.columns },
);

describe('runDataflow', () => {
  // An import is the whole stored table: a query that reads it aggregates every row, past the display window.
  it('uses complete local source inputs for joins and aggregates, including empty and null rows', async () => {
    const flow=await compiledOf('<Import name="left_rows_data" src="ref:abc123" /><Query name="left_rows">{`select * from left_rows_data.rows`}</Query><Import name="right_rows_data" src="ref:def456" /><Query name="right_rows">{`select * from right_rows_data.rows`}</Query><Query name="stats">{`select count(*) as n, median(a.n) as middle from left_rows_data.rows a join right_rows_data.rows b on true`}</Query>',{abc123:N,def456:N});
    const columns=N;
    for(const rows of [Array.from({length:10005},(_,n)=>({n:n+1})),[{n:null}],[]]) {
      const state=await runDataflow(flow,{left_rows_data:{rows:{rows,columns}},right_rows_data:{rows:{rows:[{n:1}],columns}}},{only:['stats','left_rows']});
      expect(state.errors).toEqual({});
      expect(state.tables.stats!.rows).toEqual([{n:rows.length,middle:rows.length===10005?5003:null}]);
      expect(state.tables.left_rows!.rows.length).toBe(Math.min(rows.length,DISPLAY_ROWS));
    }
  });

  // What travels per query is the display window, with the true count; a query reading another reads it WHOLE.
  it('ships the display window with the total, while a downstream query reads the whole upstream result', async () => {
    const flow = await compiledOf('<Import name="d" src="ref:abc123" /><Query name="all_rows">{`select n from d.rows order by n`}</Query><Query name="counted">{`select count(*) as n, max(n) as top from all_rows`}</Query>', { abc123: N });
    const rows = Array.from({ length: 2500 }, (_, n) => ({ n: n + 1 }));
    const state = await runDataflow(flow, { d: { rows: { rows, columns: N } } });
    expect(state.errors).toEqual({});
    expect(state.tables.all_rows).toMatchObject({ truncated: true, totalRows: 2500 });
    expect(state.tables.all_rows!.rows).toHaveLength(DISPLAY_ROWS);
    expect(state.tables.counted!.rows).toEqual([{ n: 2500, top: 2500 }]);
  });

  it('runs every query in dependency order with defaults bound and returns tables + values', async () => {
    const state = await runDataflow(FLOW, DATASETS);
    expect(state.values).toEqual({ region: null, min_rev: 0 });
    expect(state.tables.sales!.rows).toEqual([{ region: 'EU', revenue: 300 }, { region: 'NA', revenue: 300 }]);
    expect(state.tables.top!.rows).toEqual([{ region: 'EU' }]);
    expect(state.tables.k!.rows).toEqual([{ n: 2 }]);
    // The inline table is carried as a table too, so an embed can bind it directly.
    expect(state.tables.tiny).toEqual({ rows: [{ k: 'a' }, { k: 'b' }], columns: [{ name: 'k', type: 'string' }] });
    expect(state.errors).toEqual({});
  });

  it('applies value overrides, ignoring undeclared names', async () => {
    const state = await runDataflow(FLOW, DATASETS, { values: { region: 'NA', bogus: 1 } });
    expect(state.values).toEqual({ region: 'NA', min_rev: 0 });
    expect(state.tables.sales!.rows).toEqual([{ region: 'NA', revenue: 300 }]);
  });

  it('re-runs only the requested queries and their inputs when asked', async () => {
    const state = await runDataflow(FLOW, DATASETS, { values: { region: 'EU' }, only: ['top'] });
    // `top` reads `sales`, so `sales` had to run too — but `k` did not.
    expect(state.tables.top!.rows).toEqual([{ region: 'EU' }]);
    expect(state.tables.sales!.rows).toEqual([{ region: 'EU', revenue: 300 }]);
    expect(state.tables.k).toBeUndefined();
  });

  it('reports a failing query and lets the rest run; a dependent of a failure fails too', async () => {
    // A statement that compiled can still fail at run time (here: a value that does not cast).
    const flow = await compiledOf(
      '<Value name="d" type="string" default="x" />' +
      '<Import name="bad_data" src="ref:abc123" /><Query name="bad">{`select * from bad_data.rows where revenue = json_extract($d, \'$.a\')`}</Query>' +
      '<Query name="dep">{`select * from bad`}</Query>' +
      '<Query name="ok">{`select 1 one`}</Query>',
      { abc123: SALES.columns },
    );
    const state = await runDataflow(flow, { bad_data: { rows: SALES } });
    expect(state.errors.bad).toMatch(/json/i);
    expect(state.errors.dep).toMatch(/bad/);
    expect(state.tables.ok!.rows).toEqual([{ one: 1 }]);
    expect(state.tables.bad).toBeUndefined();
  });

  it('an import the caller could not resolve reads as a missing table, named', async () => {
    const flow = await compiledOf('<Import name="q_data" src="ref:gone12" /><Query name="q">{`select * from q_data.rows`}</Query>', { gone12: N });
    const state = await runDataflow(flow, {});
    expect(state.errors.q).toMatch(/q_data/);
  });

  it('runs nothing for an empty flow', async () => {
    const state = await runDataflow(EMPTY_COMPILED_DATAFLOW, {});
    expect(state).toEqual({ values: {}, tables: {}, errors: {} });
  });
});
