/**
 * caps.sql's host port: both call forms, the caller as the only identity, only the links the SQL names, the
 * aggregation rule, the registered page queries' limits and the resolver's result cap, refusals as error codes.
 */
import { describe, expect, it, vi } from 'vitest';
import { RESOLVER_LIMITS, SQL_READ_LIMITS, type QueryOutcome, type RunInput } from '@artifactbin/contracts';
import { createResolverSql, type ResolverSqlPorts, type ResolverSqlTable } from '../sql';

const links = [
  { kind: 'dataset' as const, name: 'staff', datasetId: 'ds1', mode: 'live' as const },
  { kind: 'dataset' as const, name: 'shop', datasetId: 'ds2', mode: 'live' as const },
];
const STAFF: ResolverSqlTable = { link: 'staff', table: null, columns: [{ name: '_id', type: 'string' }, { name: 'name', type: 'string' }], rows: [{ _id: 'r1', name: 'ada' }], aggregatable: true };
const ORDERS: ResolverSqlTable = { link: 'shop', table: 'orders', columns: [{ name: '_id', type: 'string' }, { name: 'total', type: 'number' }], rows: [{ _id: 'o1', total: 5 }], aggregatable: true };
const ok = (rows: Record<string, unknown>[] = [{ n: 1 }]): QueryOutcome => ({ columns: [{ name: 'n', type: 'number', choices: [1] }], rows });

function port(options: { tables?: readonly ResolverSqlTable[]; read?: ResolverSqlPorts['read']; run?: (input: RunInput) => Record<string, QueryOutcome> | Promise<Record<string, QueryOutcome>>; scheduleDeadline?: ResolverSqlPorts['scheduleDeadline'] } = {}) {
  const read = vi.fn<ResolverSqlPorts['read']>(options.read ?? (async (_actor, named) => (options.tables ?? [STAFF, ORDERS]).filter((t) => named.some((l) => l.name === t.link))));
  const run = vi.fn<ResolverSqlPorts['run']>(async (input) => (options.run ?? ((i: RunInput) => Object.fromEntries(i.queries.map((q) => [q.name, ok()]))))(input));
  const sql = createResolverSql({ links: async (pageId) => (pageId === 'page1' ? links : []), read, run, ...(options.scheduleDeadline ? { scheduleDeadline: options.scheduleDeadline } : {}) });
  return { read, run, sql };
}
const viewer = { subject: 'u1', role: 'viewer' as const };
const call = (args: unknown, caller: { subject: string | null; role: 'viewer' | 'anonymous' } | null = viewer) => ({ pageId: 'page1', caller, operation: 'query' as const, args: args as never });
const code = (promise: Promise<unknown>) => promise.then(() => null, (e: Error & { code: string }) => [e.code, e.message]);

describe('createResolverSql', () => {
  it('one SQL string answers {columns, rows}, run on the read door with the registered queries\' limits', async () => {
    const { read, run, sql } = port();
    expect(await sql(call({ sql: 'SELECT count(*) AS n FROM staff WHERE name = $who', params: { who: 'ada' } }))).toEqual({ columns: [{ name: 'n', type: 'number' }], rows: [{ n: 1 }] });
    // The caller's bare account, only the link the SQL names, the rows left after inline tables.
    expect(read).toHaveBeenCalledWith({ userId: 'u1', tokenId: null, email: null, documentEditor: false }, [links[0]], { pageId: 'page1', maxRows: 10000 }, expect.any(AbortSignal));
    expect(run.mock.calls[0]![0]).toEqual({ tables: { staff: { columns: STAFF.columns, rows: STAFF.rows } }, queries: [{ name: 'result', sql: 'SELECT count(*) AS n FROM staff WHERE name = $who' }], params: { who: 'ada' }, paramTypes: {}, limit: 10000, timeoutMs: 5000 });
  });

  it('the batched form mirrors RunInput: multi-table links as schemas, inline typed tables, every result by name', async () => {
    const { run, sql } = port({ run: () => ({ a: ok(), b: { error: 'no such column: x' } }) });
    const answer = await sql(call({
      queries: [{ name: 'a', sql: 'SELECT * FROM staff JOIN shop.orders ON 1 JOIN goals USING (name)' }, { name: 'b', sql: 'SELECT x FROM a' }],
      params: { d: '2026-01-01' }, paramTypes: { d: 'date' },
      tables: { goals: { columns: [{ name: 'name', type: 'string' }, { name: 'target', type: 'number' }], rows: [{ name: 'ada', target: 3, extra: 'dropped' }, { name: 'bo' }] } },
    }));
    expect(answer).toEqual({ a: { columns: [{ name: 'n', type: 'number' }], rows: [{ n: 1 }] }, b: { error: 'no such column: x' } });
    expect(run.mock.calls[0]![0]).toMatchObject({
      tables: { goals: { rows: [{ name: 'ada', target: 3 }, { name: 'bo', target: null }] }, staff: { rows: STAFF.rows } },
      imports: { shop: { orders: { columns: ORDERS.columns, rows: ORDERS.rows } } },
      params: { d: '2026-01-01' }, paramTypes: { d: 'date' },
    });
  });

  it('works with no linked dataset at all: pure expressions and inline tables read nothing', async () => {
    const { read, run, sql } = port();
    await sql(call({ sql: 'SELECT 1 + 1 AS n' }, { subject: null, role: 'anonymous' }));
    await sql(call({ queries: [{ name: 'q', sql: 'SELECT sum(v) AS n FROM t' }], tables: { t: { columns: [{ name: 'v', type: 'number' }], rows: [{ v: 2 }] } } }));
    expect(read).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('refuses the call when a mounted table\'s rule for the caller does not allow aggregations', async () => {
    const { run, sql } = port({ tables: [{ ...STAFF, aggregatable: false }, ORDERS] });
    expect(await code(sql(call({ sql: 'SELECT name FROM staff' })))).toEqual(['permission_denied', expect.stringContaining('does not allow aggregations')]);
    // A dataset the SQL never names is not mounted, so its rule does not matter.
    expect(await sql(call({ sql: 'SELECT count(*) AS n FROM shop.orders' }))).toMatchObject({ rows: [{ n: 1 }] });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refuses a run without an attested caller and malformed arguments before reading anything', async () => {
    const { read, run, sql } = port();
    expect(await code(sql(call({ sql: 'SELECT 1' }, null)))).toEqual(['caller_unavailable', expect.any(String)]);
    for (const args of [null, 'SELECT 1', { sql: 7 }, { queries: [] }, { queries: [{ name: 'a b', sql: 'SELECT 1' }] }, { queries: [{ name: 'a', sql: 'SELECT 1' }, { name: 'A', sql: 'SELECT 2' }] },
      { sql: 'SELECT 1', params: [1] }, { sql: 'SELECT 1', params: { p: { nested: 1 } } }, { queries: [{ name: 'a', sql: 'SELECT 1' }], paramTypes: { p: 'date' } },
      { queries: [{ name: 'a', sql: 'SELECT 1' }], tables: { t: { columns: [{ name: 'v', type: 'json' }], rows: [] } } },
      { queries: [{ name: 'a', sql: 'SELECT 1' }], tables: { t: { columns: [{ name: 'v', type: 'number' }], rows: [{ v: [1] }] } } },
      { queries: [{ name: 'staff', sql: 'SELECT 1 FROM staff' }] }, { queries: [{ name: 'a', sql: 'SELECT * FROM staff' }], tables: { staff: { columns: [{ name: 'v', type: 'number' }], rows: [] } } },
      { sql: 'x'.repeat(SQL_READ_LIMITS.sqlBytes + 1) }])
      expect(await code(sql(call(args))), JSON.stringify(args).slice(0, 80)).toEqual(['validation_failed', expect.any(String)]);
    expect(read).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('trips the input limits (10k rows, cells, 8 MiB) before the engine runs', async () => {
    const t = (rows: number, cell: unknown = 1) => ({ columns: [{ name: 'v', type: typeof cell === 'string' ? 'string' : 'number' }], rows: Array.from({ length: rows }, () => ({ v: cell })) });
    const { read, run, sql } = port({ read: async (_a, _l, options) => { expect(options.maxRows).toBe(10000 - 9000); throw new Error('sql_input_limit'); } });
    expect(await code(sql(call({ queries: [{ name: 'a', sql: 'SELECT 1' }], tables: { t: t(10001) } })))).toEqual(['input_too_large', expect.stringContaining('10000 rows')]);
    expect(await code(sql(call({ queries: [{ name: 'a', sql: 'SELECT 1' }], tables: { t: t(6000), u: t(4001) } })))).toEqual(['input_too_large', expect.any(String)]);
    // Inline rows count against the dataset rows the call may read.
    expect(await code(sql(call({ queries: [{ name: 'a', sql: 'SELECT * FROM staff' }], tables: { t: t(9000) } })))).toEqual(['input_too_large', expect.any(String)]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(await code(sql(call({ queries: [{ name: 'a', sql: 'SELECT 1' }], tables: { t: t(9, 'x'.repeat(1024 * 1024)) } })))).toEqual(['input_too_large', expect.stringContaining(String(SQL_READ_LIMITS.inputBytes))]);
    expect(run).not.toHaveBeenCalled();
  });

  it('bounds the answer by the resolver result cap and the row cap, and names a statement timeout', async () => {
    const big = port({ run: () => ({ result: ok([{ n: 'x'.repeat(RESOLVER_LIMITS.queryResultBytes) }]) }) });
    expect(await code(big.sql(call({ sql: 'SELECT 1' })))).toEqual(['result_too_large', expect.any(String)]);
    const truncated = port({ run: () => ({ result: { ...ok(), truncated: true } }) });
    expect(await code(truncated.sql(call({ sql: 'SELECT 1' })))).toEqual(['result_too_large', 'result_too_large: a result is at most 10000 rows']);
    const slow = port({ run: () => ({ result: { error: 'interrupted', timedOut: true } }) });
    expect(await code(slow.sql(call({ sql: 'SELECT 1' })))).toEqual(['timeout', 'timeout: a query runs at most 5000 ms']);
    const failed = port({ run: () => ({ result: { error: 'no such table: nope' } }) });
    expect(await code(failed.sql(call({ sql: 'SELECT 1' })))).toEqual(['validation_failed', 'validation_failed: no such table: nope']);
  });

  it('gives up at the 20 s wall time, dataset reads included', async () => {
    let expire: () => void = () => {};
    const scheduleDeadline = vi.fn((ms: number, fire: () => void) => { expect(ms).toBe(20000); expire = fire; return () => {}; });
    const { sql } = port({ scheduleDeadline, read: () => new Promise(() => {}) });
    const pending = code(sql(call({ sql: 'SELECT * FROM staff' })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expire();
    expect(await pending).toEqual(['timeout', 'timeout: a caps.sql call runs at most 20000 ms']);
  });

  it('maps dataset read failures to the caps.query codes', async () => {
    for (const [message, expected] of [['dataset_changed', 'conflict'], ['dataset_not_found', 'unavailable'], ['connection reset with row data', 'unavailable']]) {
      const { sql } = port({ read: async () => { throw new Error(message); } });
      expect(await code(sql(call({ sql: 'SELECT * FROM staff' })))).toEqual([expected, expected]);
    }
  });
});
