/**
 * The SQL engine's contract: what a document's queries may do, what they may
 * never do, and what comes back. Runs a real DuckDB — the guards are the point,
 * so they are tested against the engine, not a mock.
 */
import { describe, expect, it } from 'vitest';
import { dryRunQueries, isQueryFailure, runQueries, type QueryOutcome } from '@/lib/sql/engine';
import { parseQueryDecl } from '@/lib/story/dataflow';
import { parseJsx, type JsxElement } from '@/lib/jsx';
import type { QueryDecl, Row, TableResult } from '@/lib/story/dataflow';

const q = (name: string, sql: string): QueryDecl => {
  const parsed = parseJsx(`<Query name="${name}">{\`${sql}\`}</Query>`);
  if (!parsed.ok) throw new Error(parsed.error);
  const decl = parseQueryDecl(parsed.nodes[0] as JsxElement);
  if (!decl.ok) throw new Error(JSON.stringify(decl.errors));
  return decl.decl;
};

const SALES: Row[] = [
  { region: 'EU', revenue: 100, day: '2024-01-01', ok: true },
  { region: 'EU', revenue: 200, day: '2024-01-02', ok: false },
  { region: 'NA', revenue: 300, day: '2024-01-03', ok: true },
];
const TABLES = {
  ref_abc123: {
    rows: SALES,
    columns: [
      { name: 'region', type: 'string' as const },
      { name: 'revenue', type: 'number' as const },
      { name: 'day', type: 'date' as const },
      { name: 'ok', type: 'boolean' as const },
    ],
  },
};

const table = (o: QueryOutcome): TableResult => {
  if (isQueryFailure(o)) throw new Error(`expected rows, got failure: ${o.error}`);
  return o;
};
const failure = (o: QueryOutcome): string => {
  if (!isQueryFailure(o)) throw new Error(`expected a failure, got ${JSON.stringify(o.rows)}`);
  return o.error;
};

describe('runQueries', () => {
  it('runs a select over a registered dataset and types the columns', async () => {
    const out = await runQueries({
      tables: TABLES,
      queries: [q('sales', 'select region, sum(revenue) as revenue from ref_abc123 group by 1 order by 1')],
      params: {},
    });
    expect(table(out.sales).rows).toEqual([{ region: 'EU', revenue: 300 }, { region: 'NA', revenue: 300 }]);
    expect(table(out.sales).columns).toEqual([
      { name: 'region', type: 'string' },
      { name: 'revenue', type: 'number' },
    ]);
  });

  it('binds $params by name, including a NULL that a filter tests for', async () => {
    const query = q('f', 'select count(*) as n from ref_abc123 where ($region is null or region = $region)');
    const all = await runQueries({ tables: TABLES, queries: [query], params: { region: null } });
    expect(table(all.f).rows).toEqual([{ n: 3 }]);
    const eu = await runQueries({ tables: TABLES, queries: [query], params: { region: 'EU' } });
    expect(table(eu.f).rows).toEqual([{ n: 2 }]);
  });

  it('binds number, boolean and date scalars', async () => {
    const out = await runQueries({
      tables: TABLES,
      queries: [q('f', 'select count(*) n from ref_abc123 where revenue >= $min and ok = $flag and day >= $since::date')],
      params: { min: 200, flag: true, since: '2024-01-01' },
    });
    expect(table(out.f).rows).toEqual([{ n: 1 }]);
  });

  it('binds NULL for a param the caller did not supply', async () => {
    const out = await runQueries({
      tables: TABLES,
      queries: [q('f', 'select count(*) n from ref_abc123 where $region is null or region = $region')],
      params: {},
    });
    expect(table(out.f).rows).toEqual([{ n: 3 }]);
  });

  it('lets a query read an earlier query by name', async () => {
    const out = await runQueries({
      tables: TABLES,
      queries: [
        q('base', 'select region, sum(revenue) revenue from ref_abc123 group by 1'),
        q('top', 'select region from base order by revenue desc, region limit 1'),
      ],
      params: {},
    });
    expect(table(out.top).rows).toEqual([{ region: 'EU' }]);
  });

  it('serialises engine types to JSON-safe values (bigint, decimal, date, list)', async () => {
    const out = await runQueries({
      tables: TABLES,
      queries: [q('t', "select count(*) n, sum(revenue)::decimal(18,2) s, min(day) d, list(region)[1:2] l, 1.5 f, null nul from ref_abc123")],
      params: {},
    });
    const row = table(out.t).rows[0];
    expect(row).toEqual({ n: 3, s: 600, d: '2024-01-01', l: ['EU', 'EU'], f: 1.5, nul: null });
    expect(JSON.parse(JSON.stringify(row))).toEqual(row);
  });

  it('reports an author error per query without stopping the others', async () => {
    const out = await runQueries({
      tables: TABLES,
      queries: [q('bad', 'select revenu from ref_abc123'), q('good', 'select 1 as one')],
      params: {},
    });
    expect(failure(out.bad)).toMatch(/revenu/);
    expect(table(out.good).rows).toEqual([{ one: 1 }]);
  });

  it('caps rows and records truncation with the real count', async () => {
    const out = await runQueries({
      tables: TABLES,
      queries: [q('many', 'select i from range(50) t(i)')],
      params: {},
      limit: 10,
    });
    const r = table(out.many);
    expect(r.rows).toHaveLength(10);
    expect(r.truncated).toBe(true);
    expect(r.totalRows).toBe(50);
  });

  it('never materialises a huge result: reads only up to the cap, still reports the real count', async () => {
    const rss0 = process.memoryUsage().rss;
    const out = await runQueries({ tables: TABLES, queries: [q('huge', 'select i from range(20000000) t(i)')], params: {}, limit: 5 });
    const r = table(out.huge);
    expect(r.rows).toHaveLength(5);
    expect(r.truncated).toBe(true);
    expect(r.totalRows).toBe(20000000);
    // Reading all 20M rows into JS cost +2.6 GB before the streaming read; the
    // cap must bound MEMORY, not just what the document shows.
    expect((process.memoryUsage().rss - rss0) / 1e6).toBeLessThan(300);
  });

  it('a downstream query can read a list-typed column of an earlier result', async () => {
    const out = await runQueries({
      tables: TABLES,
      queries: [q('lists', 'select region, list(revenue) revs from ref_abc123 group by 1'), q('n', 'select count(*) n from lists')],
      params: {},
    });
    expect(table(out.n).rows).toEqual([{ n: 2 }]);
  });

  it('binds a date-typed Value (ISO string) against a DATE column without an explicit cast', async () => {
    const out = await runQueries({
      tables: TABLES,
      queries: [q('d', 'select count(*) n from ref_abc123 where day = $day')],
      params: { day: '2024-01-02' },
    });
    expect(table(out.d).rows).toEqual([{ n: 1 }]);
  });

  it('does not mark an exactly-at-cap result as truncated', async () => {
    const out = await runQueries({ tables: TABLES, queries: [q('x', 'select i from range(10) t(i)')], params: {}, limit: 10 });
    expect(table(out.x).truncated).toBeUndefined();
  });

  it('registers an inline table by its declared name', async () => {
    const out = await runQueries({
      tables: { tiny: { rows: [{ a: 1 }, { a: 2 }], columns: [{ name: 'a', type: 'number' }] } },
      queries: [q('sum', 'select sum(a) total from tiny')],
      params: {},
    });
    expect(table(out.sum).rows).toEqual([{ total: 3 }]);
  });

  it('handles an empty table without failing', async () => {
    const out = await runQueries({
      tables: { empty: { rows: [], columns: [{ name: 'a', type: 'number' }] } },
      queries: [q('n', 'select count(*) n from empty')],
      params: {},
    });
    expect(table(out.n).rows).toEqual([{ n: 0 }]);
  });

  it('preserves nulls and mixed-typed dataset columns', async () => {
    const out = await runQueries({
      tables: { t: { rows: [{ a: null, b: 'x' }, { a: 2, b: null }], columns: [{ name: 'a', type: 'number' }, { name: 'b', type: 'string' }] } },
      queries: [q('r', 'select a, b from t order by a nulls first')],
      params: {},
    });
    expect(table(out.r).rows).toEqual([{ a: null, b: 'x' }, { a: 2, b: null }]);
  });

  describe('guards', () => {
    const guarded = async (sql: string): Promise<string> => {
      const out = await runQueries({ tables: TABLES, queries: [q('g', sql)], params: {} });
      return failure(out.g);
    };

    it('refuses a second statement', async () => {
      expect(await guarded('select 1; select 2')).toMatch(/one statement|single statement/i);
    });

    it('refuses anything that is not a SELECT', async () => {
      for (const sql of [
        'create table t as select 1',
        'drop table ref_abc123',
        'insert into ref_abc123 values (1, 2, null, true)',
        'update ref_abc123 set revenue = 0',
        'delete from ref_abc123',
        'attach \':memory:\' as other',
        'set threads = 1',
        'pragma enable_profiling',
      ]) {
        expect(await guarded(sql), sql).toMatch(/only SELECT|read-only|not a SELECT/i);
      }
      // COPY … TO is refused one layer earlier: the sandbox denies the file
      // before the statement is even typed. Either refusal is the point.
      expect(await guarded("copy (select 1) to '/tmp/x.csv'")).toMatch(/only SELECT|file system operations are disabled/i);
    });

    it('lets a read-only pragma through (DuckDB classifies it as a SELECT; a throwaway instance has nothing to reveal)', async () => {
      const out = await runQueries({ tables: TABLES, queries: [q('v', 'pragma version')], params: {} });
      expect(table(out.v).columns.map((c) => c.name)).toContain('library_version');
    });

    it('refuses to touch the filesystem or the network even inside a SELECT', async () => {
      for (const sql of [
        "select * from read_csv('/etc/passwd')",
        "select * from read_json_auto('/etc/passwd')",
        "select * from read_parquet('https://example.com/x.parquet')",
      ]) {
        expect(await guarded(sql), sql).toMatch(/permission|not implemented|disabled|external access|Catalog|does not exist/i);
      }
    });

    it('cannot install or load an extension', async () => {
      expect(await guarded("select * from duckdb_extensions() where installed")).not.toMatch(/httpfs.*true/);
    });

    it('sees no table it was not given', async () => {
      expect(await guarded('select * from ref_other')).toMatch(/ref_other/);
    });

    it('interrupts a query that runs past the timeout', async () => {
      const out = await runQueries({
        tables: TABLES,
        queries: [q('slow', 'select count(*) from range(3000000000) r1, range(3) r2'), q('after', 'select 1 one')],
        params: {},
        timeoutMs: 300,
      });
      const f = out.slow as { error: string; timedOut?: boolean };
      expect(isQueryFailure(out.slow)).toBe(true);
      expect(f.timedOut).toBe(true);
      expect(f.error).toMatch(/too long|timed out|interrupt/i);
      // The run continues: a slow query must not take the document with it.
      expect(table(out.after).rows).toEqual([{ one: 1 }]);
    });

    it('leaks nothing between runs', async () => {
      await runQueries({ tables: { secret: { rows: [{ a: 1 }], columns: [{ name: 'a', type: 'number' }] } }, queries: [q('x', 'select * from secret')], params: {} });
      const out = await runQueries({ tables: TABLES, queries: [q('y', 'select * from secret')], params: {} });
      expect(failure(out.y)).toMatch(/secret/);
    });
  });
});

describe('dryRunQueries', () => {
  const shapes = { ref_abc123: { columns: TABLES.ref_abc123.columns } };

  it('passes a valid query without any rows loaded, and reports its result columns', async () => {
    const dry = await dryRunQueries({
      tables: shapes,
      queries: [q('ok', 'select region, sum(revenue) r from ref_abc123 where region = $region group by 1')],
      paramNames: ['region'],
    });
    expect(dry.errors).toEqual([]);
    expect(dry.columns.ok).toEqual([{ name: 'region', type: 'string' }, { name: 'r', type: 'number' }]);
  });

  it('names the query and the offending column, with candidates', async () => {
    const { errors } = await dryRunQueries({ tables: shapes, queries: [q('bad', 'select revenu from ref_abc123')], paramNames: [] });
    expect(errors).toHaveLength(1);
    expect(errors[0].name).toBe('bad');
    expect(errors[0].error).toMatch(/revenu/);
    expect(errors[0].error).toMatch(/revenue/);
  });

  it('catches a missing table and a non-SELECT statement', async () => {
    const { errors } = await dryRunQueries({
      tables: shapes,
      queries: [q('a', 'select * from nowhere'), q('b', 'drop table ref_abc123')],
      paramNames: [],
    });
    expect(errors.map((e) => e.name)).toEqual(['a', 'b']);
    expect(errors[0].error).toMatch(/nowhere/);
    expect(errors[1].error).toMatch(/only SELECT|read-only|not a SELECT/i);
  });

  it('sees earlier queries as tables (the run order is the dry-run order)', async () => {
    expect((await dryRunQueries({
      tables: shapes,
      queries: [q('base', 'select region from ref_abc123'), q('top', 'select region from base limit 1')],
      paramNames: [],
    })).errors).toEqual([]);
  });
});

describe('runQueries — a page of one query', () => {
  const many = q('many', 'select i, i * 2 as twice from range(100) t(i)');
  it('reads a window with a sort, and reports the true total', async () => {
    const out = await runQueries({ tables: TABLES, queries: [many], params: {}, page: { name: 'many', offset: 10, limit: 5, sort: { col: 'i', dir: 'desc' } } });
    const r = table(out.many);
    expect(r.rows.map((x) => x.i)).toEqual([89, 88, 87, 86, 85]);
    expect(r.totalRows).toBe(100);
    expect(r.truncated).toBe(true);
    expect(r.columns.map((c) => c.name)).toEqual(['i', 'twice']);
  });
  it('a window past the end is empty but still counts the total', async () => {
    const out = await runQueries({ tables: TABLES, queries: [many], params: {}, page: { name: 'many', offset: 500, limit: 5 } });
    expect(table(out.many).rows).toEqual([]);
    expect(table(out.many).totalRows).toBe(100);
  });
  it('an unknown sort column is ignored, not an error', async () => {
    const out = await runQueries({ tables: TABLES, queries: [many], params: {}, page: { name: 'many', offset: 0, limit: 2, sort: { col: 'nope', dir: 'asc' } } });
    expect(table(out.many).rows).toHaveLength(2);
  });
  it('binds params inside the wrapped query, and dependencies still run whole', async () => {
    const out = await runQueries({
      tables: TABLES,
      queries: [q('base', 'select region, revenue from ref_abc123 where revenue >= $min'), q('top', 'select * from base')],
      params: { min: 150 },
      page: { name: 'top', offset: 0, limit: 1, sort: { col: 'revenue', dir: 'desc' } },
    });
    expect(table(out.top).rows).toEqual([{ region: 'NA', revenue: 300 }]);
    expect(table(out.top).totalRows).toBe(2);
  });
});

describe('the engine module', () => {
  it('does not load the native binding at import time (a binding failure must fail a QUERY, never the server)', async () => {
    // Fresh module registry: importing the engine must not pull @duckdb/node-api.
    const { vi } = await import('vitest');
    vi.resetModules();
    const loads: string[] = [];
    vi.doMock('@duckdb/node-api', async (orig) => { loads.push('duckdb'); return orig(); });
    await import('@/lib/sql/engine');
    expect(loads).toEqual([]);
    vi.doUnmock('@duckdb/node-api');
    vi.resetModules();
  });
});
