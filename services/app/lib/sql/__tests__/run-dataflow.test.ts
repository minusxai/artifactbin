/**
 * runDataflow: a document's declarations + its datasets → the DataflowState
 * the island carries. Ordering, overrides, partial re-runs, and failure shape.
 */
import { describe, expect, it } from 'vitest';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { runDataflow } from '@/lib/sql/run-dataflow';
import type { Dataflow } from '@/lib/story/dataflow';

const flowOf = (helmetChildren: string): Dataflow => {
  const parsed = parseJsx(`<Helmet>${helmetChildren}</Helmet>`);
  if (!parsed.ok) throw new Error(parsed.error);
  const { content } = splitHelmet(parsed.nodes as JsxNode[]);
  return { values: content.values, queries: content.queries };
};

const DATASETS = {
  abc123: {
    rows: [{ region: 'EU', revenue: 100 }, { region: 'EU', revenue: 200 }, { region: 'NA', revenue: 300 }],
    columns: [{ name: 'region', type: 'string' as const }, { name: 'revenue', type: 'number' as const }],
  },
};

const FLOW = flowOf(
  '<Value name="region" type="string" />' +
  '<Value name="min_rev" type="number" default={0} />' +
  '<Value name="tiny" type="table" value={[{"k":"a"},{"k":"b"}]} />' +
  '<Query name="top">{`select region from sales order by revenue desc limit 1`}</Query>' +
  '<Query name="sales">{`select region, sum(revenue) revenue from ref_abc123 where ($region is null or region = $region) and revenue >= $min_rev group by 1 order by 1`}</Query>' +
  '<Query name="k">{`select count(*) n from tiny`}</Query>',
);

describe('runDataflow', () => {
  it('runs every query in dependency order with defaults bound and returns tables + values', async () => {
    const state = await runDataflow(FLOW, DATASETS);
    expect(state.values).toEqual({ region: null, min_rev: 0 });
    expect(state.tables.sales.rows).toEqual([{ region: 'EU', revenue: 300 }, { region: 'NA', revenue: 300 }]);
    expect(state.tables.top.rows).toEqual([{ region: 'EU' }]);
    expect(state.tables.k.rows).toEqual([{ n: 2 }]);
    // The inline table is carried as a table too, so an embed can bind it directly.
    expect(state.tables.tiny).toEqual({ rows: [{ k: 'a' }, { k: 'b' }], columns: [{ name: 'k', type: 'string' }] });
    expect(state.errors).toEqual({});
  });

  it('applies value overrides, ignoring undeclared names', async () => {
    const state = await runDataflow(FLOW, DATASETS, { values: { region: 'NA', bogus: 1 } });
    expect(state.values).toEqual({ region: 'NA', min_rev: 0 });
    expect(state.tables.sales.rows).toEqual([{ region: 'NA', revenue: 300 }]);
  });

  it('re-runs only the requested queries and their inputs when asked', async () => {
    const state = await runDataflow(FLOW, DATASETS, { values: { region: 'EU' }, only: ['top'] });
    // `top` reads `sales`, so `sales` had to run too — but `k` did not.
    expect(state.tables.top.rows).toEqual([{ region: 'EU' }]);
    expect(state.tables.sales.rows).toEqual([{ region: 'EU', revenue: 300 }]);
    expect(state.tables.k).toBeUndefined();
  });

  it('reports a failing query and lets the rest run; a dependent of a failure fails too', async () => {
    const flow = flowOf(
      '<Query name="bad">{`select nope from ref_abc123`}</Query>' +
      '<Query name="dep">{`select * from bad`}</Query>' +
      '<Query name="ok">{`select 1 one`}</Query>',
    );
    const state = await runDataflow(flow, DATASETS);
    expect(state.errors.bad).toMatch(/nope/);
    expect(state.errors.dep).toMatch(/bad/);
    expect(state.tables.ok.rows).toEqual([{ one: 1 }]);
    expect(state.tables.bad).toBeUndefined();
  });

  it('a dataset the caller could not resolve reads as a missing table, named', async () => {
    const flow = flowOf('<Query name="q">{`select * from ref_gone12`}</Query>');
    const state = await runDataflow(flow, {});
    expect(state.errors.q).toMatch(/ref_gone12/);
  });

  it('runs nothing for an empty flow', async () => {
    const state = await runDataflow({ values: [], queries: [] }, {});
    expect(state).toEqual({ values: {}, tables: {}, errors: {} });
  });
});
