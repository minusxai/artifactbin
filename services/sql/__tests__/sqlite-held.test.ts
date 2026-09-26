/**
 * A HELD DATABASE (`SqliteEngine.held`): the page's engine runs many times
 * over the same imports, so it keeps one database open — each import table
 * loaded once, and again only when it is handed different rows — while
 * everything a run loads beside them (its main tables, each query's result)
 * is gone when the run returns. It answers exactly what a throwaway `run`
 * answers for the same input.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunInput } from '@artifactbin/contracts';
import { loadSqlite, SqliteDatabase } from '@artifactbin/sql/core';

const engine = await loadSqlite();
const BOUNDS = { limit: 100, pageLimit: 100, timeoutMs: 2000 };
const COLUMNS = [{ name: 'id', type: 'string' as const }, { name: 'region', type: 'string' as const }, { name: 'revenue', type: 'number' as const }];
const ROWS = [{ id: 'a', region: 'EU', revenue: 837 }, { id: 'b', region: 'NA', revenue: 1200 }, { id: 'c', region: 'EU', revenue: 3 }];
const sales = (rows = ROWS) => ({ rows: { rows, columns: COLUMNS } });

const input = (over: Partial<RunInput> = {}): RunInput => ({
  tables: { picks: { rows: [{ region: 'EU' }], columns: [{ name: 'region', type: 'string' }] } },
  imports: { sales: sales() },
  queries: [
    { name: 'by_region', sql: 'select region, sum(revenue) as revenue from sales.rows where $region is null or region = $region group by 1 order by 1' },
    { name: 'picked', sql: 'select b.* from by_region b join picks p using (region)' },
  ],
  params: { region: null },
  ...over,
});

/** How often rows of `schema` crossed into SQLite. */
const loadsOf = (spy: { mock: { calls: unknown[][] } }, schema: string) => spy.mock.calls.filter(([data]) => (data as { schema: string }).schema === schema).length;

afterEach(() => { vi.restoreAllMocks(); });

describe('a held database', () => {
  it('answers what a throwaway run answers, run after run', () => {
    const held = engine.held(['sales']);
    for (const region of [null, 'EU', 'NA', null]) {
      const i = input({ params: { region } });
      expect(held.run(i, BOUNDS)).toEqual(engine.run(i, BOUNDS));
    }
    held.close();
  });

  it('loads each import table once, and again only when handed different rows', () => {
    const load = vi.spyOn(SqliteDatabase.prototype, 'load');
    const held = engine.held(['sales']);
    const data = sales();
    for (let i = 0; i < 5; i++) held.run(input({ imports: { sales: data } }), BOUNDS);
    expect(loadsOf(load, 'sales')).toBe(1);
    const next = sales([...ROWS, { id: 'd', region: 'NA', revenue: 1 }]);
    const out = held.run(input({ imports: { sales: next } }), BOUNDS);
    expect(loadsOf(load, 'sales')).toBe(2);
    expect(out.by_region).toMatchObject({ rows: [{ region: 'EU', revenue: 840 }, { region: 'NA', revenue: 1201 }] });
    held.close();
  });

  it('keeps nothing a run loaded beside its imports: main tables and results are the next run\'s own', () => {
    const held = engine.held(['sales']);
    held.run(input(), BOUNDS);
    // Different main tables, and a query named like the last run's table.
    const out = held.run(input({
      tables: { picks: { rows: [{ region: 'NA' }], columns: [{ name: 'region', type: 'string' }] } },
      queries: [{ name: 'by_region', sql: 'select region from picks' }, { name: 'leak', sql: 'select count(*) as n from picked' }],
    }), BOUNDS);
    expect(out.by_region).toMatchObject({ rows: [{ region: 'NA' }] });
    expect(out.leak).toMatchObject({ error: expect.stringMatching(/no such table: picked/) });
    held.close();
  });

  it('a failing or timed-out run leaves the held database answering as before', () => {
    const held = engine.held(['sales']);
    const broken = held.run(input({ queries: [{ name: 'bad', sql: 'select nope from sales.rows' }] }), BOUNDS);
    expect(broken.bad).toMatchObject({ error: expect.stringMatching(/no such column/) });
    const slow = held.run(input({ queries: [{ name: 'spin', sql: 'with recursive n(i) as (select 1 union all select i + 1 from n) select count(*) from n' }] }), { ...BOUNDS, timeoutMs: 20 });
    expect(slow.spin).toMatchObject({ timedOut: true });
    expect(held.run(input(), BOUNDS)).toEqual(engine.run(input(), BOUNDS));
    held.close();
  });

  it('resolves an unqualified table through the schemas in their declared order, whichever was loaded first', () => {
    const other = { rows: { rows: [{ id: 'x', region: 'XX', revenue: 0 }], columns: COLUMNS } };
    const held = engine.held(['sales', 'other']);
    const unqualified = { name: 'q', sql: 'select region from rows order by 1' };
    held.run(input({ imports: { other }, queries: [{ name: 'o', sql: 'select count(*) as n from other.rows' }] }), BOUNDS);
    const both = input({ imports: { sales: sales(), other }, queries: [unqualified] });
    expect(held.run(both, BOUNDS)).toEqual(engine.run(both, BOUNDS));
    expect(held.run(both, BOUNDS).q).toMatchObject({ rows: [{ region: 'EU' }, { region: 'EU' }, { region: 'NA' }] });
    held.close();
  });
});
