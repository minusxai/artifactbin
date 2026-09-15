/**
 * THE SQL CONTRACT, run over BOTH transports: the engine in this process, and
 * the same engine behind `serveSql` reached through `sqlClient`. One suite,
 * two shapes — the proof that in-process and remote can never disagree.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { SqlService } from '@artifactbin/contracts';
import { isQueryFailure } from '@artifactbin/contracts';
import { SQL_ROUTES, serveSql, sqlClient } from '@artifactbin/sql';
import { createSql } from '@artifactbin/sql/local';

const local = createSql({ maxRows: 3, timeoutMs: 2000 });
const server = serveSql(local);
const listening = server.listen(0);
const remote = sqlClient(listening.url, { deadlineMs: 5000 });
afterAll(() => server.close());

const TABLE = { rows: [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }], columns: [{ name: 'a', type: 'number' as const }] };
const input = {
  tables: { t: TABLE },
  queries: [{ name: 'q', sql: 'select a*2 as b from t order by b' }, { name: 'q2', sql: 'select count(*) as n from q' }],
  params: {},
};

describe.each<[string, SqlService]>([['in-process', local], ['over HTTP', remote]])('%s', (_name, svc) => {
  it('runs a dependency chain in ONE request, with the row cap and the true count travelling', async () => {
    const r = await svc.run(input);
    if (isQueryFailure(r.q) || isQueryFailure(r.q2)) throw new Error(JSON.stringify(r));
    expect(r.q.rows).toHaveLength(3);
    expect(r.q.truncated).toBe(true);
    expect(r.q.totalRows).toBe(4);
    expect(r.q2.rows[0]).toEqual({ n: 3 });
  });
  it('refuses a write on the read path, as a per-query failure', async () => {
    const r = await svc.run({ ...input, queries: [{ name: 'x', sql: 'drop table t' }] });
    expect(isQueryFailure(r.x)).toBe(true);
  });
  it('binds params by name', async () => {
    const r = await svc.run({ tables: { t: TABLE }, queries: [{ name: 'q', sql: 'select a from t where a > $min' }], params: { min: 2 } });
    expect(!isQueryFailure(r.q) && r.q.rows).toEqual([{ a: 3 }, { a: 4 }]);
  });
  it('mutates one table and answers its new rows', async () => {
    const r = await svc.mutate({ table: { name: 'ref_x', rows: [{ a: 1 }, { a: 2 }], columns: TABLE.columns }, sql: 'insert into ref_x values ($v)', params: { v: 5 } });
    expect(!isQueryFailure(r) && r.affected).toBe(1);
    expect(!isQueryFailure(r) && r.rows).toEqual([{ a: 1 }, { a: 2 }, { a: 5 }]);
  });
  /**
   * A REQUEST MAY LOWER A CAP AND NEVER RAISE ONE. `limit: 10` against a
   * service built with `maxRows: 3` is still 3 — which matters most here,
   * where the cap is checked on what the table BECAME: the write is refused
   * whole (`full`), and nothing is stored.
   */
  it('refuses a write that would leave more rows than the cap, however large a limit is asked for', async () => {
    const r = await svc.mutate({ table: { name: 'ref_x', ...TABLE }, sql: 'insert into ref_x values (5)', params: {}, limit: 10 });
    expect(isQueryFailure(r) && r.full).toBe(true);
  });
  it('dry-runs a query against empty tables and names the bad column', async () => {
    const r = await svc.dryRun({ tables: { t: { columns: TABLE.columns } }, queries: [{ name: 'q', sql: 'select nope from t' }, { name: 'ok', sql: 'select a from t' }], paramNames: [] });
    expect(r.errors.map((e) => e.name)).toEqual(['q']);
    expect(r.columns.ok).toEqual([{ name: 'a', type: 'number' }]);
  });
  it('dry-runs a mutation against its target only', async () => {
    const r = await svc.dryRunMutations({ tables: { ref_t: { columns: TABLE.columns } }, mutations: [{ name: 'm', sql: 'insert into ref_t values ($v)', target: 't' }, { name: 'bad', sql: 'insert into ref_zz values (1)', target: 'zz' }], paramNames: ['v'] });
    expect(r.errors.map((e) => e.name)).toEqual(['bad']);
  });
});

describe('sqlClient', () => {
  it('turns a dead service into per-query failures within the deadline, never a hang', async () => {
    const dead = sqlClient('http://127.0.0.1:1', { deadlineMs: 500 });
    const t0 = Date.now();
    const r = await dead.run(input);
    expect(isQueryFailure(r.q) && isQueryFailure(r.q2)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(isQueryFailure(await dead.mutate({ table: { name: 't', ...TABLE }, sql: 'delete from t', params: {} }))).toBe(true);
  });

  /**
   * A DRY RUN THAT COULD NOT RUN IS NOT A CLEAN ONE. These two are the
   * publish-time check: an empty `errors` array from an unreachable service
   * would admit the document unchecked and the author would meet the error at
   * render time — precisely what the dry run exists to prevent. (A rejection
   * would be no better: it becomes a 500 on the publish path.)
   */
  it('reports a dead service as every query failing, never as a clean dry run', async () => {
    const dead = sqlClient('http://127.0.0.1:1', { deadlineMs: 500 });
    const r = await dead.dryRun({ tables: {}, queries: [{ name: 'q', sql: 'select 1' }], paramNames: [] });
    expect(r.errors.map((e) => e.name)).toEqual(['q']);
    const m = await dead.dryRunMutations({ tables: {}, mutations: [{ name: 'm', sql: 'delete from t', target: 't' }], paramNames: [] });
    expect(m.errors.map((e) => e.name)).toEqual(['m']);
  });
  it('sends paramNames as an array even when handed a Set', async () => {
    const r = await remote.dryRun({ tables: { t: { columns: TABLE.columns } }, queries: [{ name: 'q', sql: 'select a from t where a > $min' }], paramNames: new Set(['min']) as unknown as string[] });
    expect(r.errors).toEqual([]);
  });
});

describe('serveSql health', () => {
  it('GET /health answers 200 {ok:true}, the docker HEALTHCHECK and the compose depends_on condition', async () => {
    const res = await fetch(`${listening.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
  it('a GET anywhere else stays 405 — the methods are POST-only, health is the one GET', async () => {
    const res = await fetch(`${listening.url}${SQL_ROUTES.run}`);
    expect(res.status).toBe(405);
  });

  /**
   * THE URL IS DATA, NEVER THE FORMAT STRING (CodeQL js/tainted-format-string).
   * The route table gates the url before this log line, so only a SQL_ROUTES
   * value can reach it today — but a format string ASSEMBLED FROM A REQUEST is
   * a shape, not an accident: the url goes in as an argument, so no future
   * route key can turn a `%s` in a request target into an operator line whose
   * error was swallowed by its own specifier. The verbatim `%s%d` case is
   * proved on `jsonServer`, whose route table is the caller's
   * (services/utils/__tests__/http.test.ts).
   */
  it('logs a failed request with the url as an ARGUMENT, never as the format string', async () => {
    const calls: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { calls.push(args); });
    try {
      const res = await fetch(`${listening.url}${SQL_ROUTES.run}`, { method: 'POST', body: 'not json' });
      expect(res.status).toBe(400);
    } finally {
      spy.mockRestore();
    }
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('[sql-shell] %s failed:');
    expect(calls[0][1]).toBe(SQL_ROUTES.run);
  });
});

describe('serveSql service authentication', () => {
  it('keeps health public but refuses operations without the configured service secret', async () => {
    const protectedServer = serveSql(local, { serviceSecret: 'sql-test-secret' });
    const protectedUrl = protectedServer.listen(0).url;
    try {
      expect((await fetch(`${protectedUrl}/health`)).status).toBe(200);
      expect((await fetch(`${protectedUrl}${SQL_ROUTES.run}`, { method: 'POST', body: '{}' })).status).toBe(401);
      const client = sqlClient(protectedUrl, { serviceSecret: 'sql-test-secret' });
      const result = await client.run({ tables: {}, queries: [{ name: 'q', sql: 'select 1 as n' }], params: {} });
      expect(isQueryFailure(result.q)).toBe(false);
    } finally { await protectedServer.close(); }
  });
});

// The same native dialect and isolation must survive the HTTP boundary.
describe.each<[string, SqlService]>([['in-process', local], ['over HTTP', remote]])('%s catalog reads', (_name, svc) => {
  const base = {
    tables: { payload: { ...TABLE, rows: TABLE.rows.map(row => ({...row, secret: 'hidden'})) } },
    catalog: { defaultSchema: 'public', tables: [{schema:'public',name:'rows',source:'payload',columns:TABLE.columns}] },
    params: {},
  };
  const run = (sql: string) => svc.run({...base,queries:[{name:'q',sql}]});
  it('uses DuckDB syntax, functions and casts and returns the correct aggregate', async () => {
    const r=await run("select median(a::double) as median, strftime(strptime('2026-01', '%Y-%m'), '%Y-%m') as month from public.rows");
    expect(r.q).toMatchObject({rows:[{median:2.5,month:'2026-01'}]});
  });
  it('supports native QUALIFY, CTEs, exact literals and unaliased subqueries', async () => {
    const r=await run("with q as (select * from rows) select a, cast(9007199254740993 as varchar) as exact from (select * from q) qualify row_number() over(order by a desc)=1");
    expect(r.q).toMatchObject({rows:[{a:4,exact:'9007199254740993'}]});
  });
  it('retains pagination and reports the full count', async () => {
    const r=await svc.run({...base,queries:[{name:'q',sql:'select * from rows'}],page:{name:'q',limit:2,offset:1,sort:{col:'a',dir:'desc'}}});
    expect(r.q).toMatchObject({rows:[{a:3},{a:2}],totalRows:4});
  });
  it.each(['select secret from rows','select * from payload','select * from main.payload','select * from information_schema.tables','select * from pg_catalog.pg_tables',"select * from query('select * from payload')","select * from read_csv('/etc/passwd')",'select * from rows; drop table rows','delete from rows returning *'])('refuses forbidden access: %s', async sql => {
    expect((await run(sql)).q).toHaveProperty('error');
  });
  it('binds typed date and nullable parameters without touching quoted text', async () => {
    const r=await svc.run({...base,catalog:{...base.catalog,paramTypes:{day:'date',empty:'string'}},params:{day:'2026-09-15',empty:null},queries:[{name:'q',sql:"select date_part('year', $day) as year, $empty is null as missing, '$day' as literal"}]});
    expect(r.q).toMatchObject({rows:[{year:2026,missing:true,literal:'$day'}]});
  });
  it('resolves model dependencies without exposing unselected model columns or truncating intermediate rows', async () => {
    const catalog={...base.catalog,tables:[...base.catalog.tables,{schema:'public',name:'model',sql:'select a, a*10 as hidden from rows',columns:TABLE.columns},{schema:'public',name:'unused',sql:'INVALID UNUSED DRAFT',columns:[]}]};
    const read=(sql:string)=>svc.run({...base,catalog,queries:[{name:'q',sql}]});
    expect((await read('select sum(a) as total from model')).q).toMatchObject({rows:[{total:10}]});
    expect((await read('select hidden from model')).q).toHaveProperty('error');
    expect((await read('select * from unused')).q).toHaveProperty('error');
  });
});

it('catalog reads keep schema bindings, quoted names, model isolation and native parameters', async () => {
 const catalog={defaultSchema:'sales',tables:[
   {schema:'sales',name:'Odd " Rows',source:'a',columns:TABLE.columns},
   {schema:'support',name:'Odd " Rows',source:'b',columns:TABLE.columns},
   {schema:'sales',name:'bad',sql:"select * from query('select * from information_schema.tables')",columns:[]},
   {schema:'sales',name:'cycle',sql:'select * from cycle',columns:[]},
 ]};
 const run=(sql:string)=>local.run({catalog,tables:{a:TABLE,b:{...TABLE,rows:[{a:9}]}},queries:[{name:'q',sql}],params:{},page:{name:'q',limit:3,offset:0}});
 expect((await run('select sum(s.a) as total from "Odd "" Rows" s join support."Odd "" Rows" t on true; -- trailing comment')).q).toMatchObject({rows:[{total:10}]});
 for(const sql of ['select * from bad','select * from cycle','with payload as (select * from main.payload) select * from payload','with pg_tables as (select 1) select * from pg_catalog.pg_tables','select * from memory.sales."Odd "" Rows"']) expect((await run(sql)).q).toHaveProperty('error');
});
