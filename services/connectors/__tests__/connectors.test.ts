/**
 * THE CONNECTORS, through their public entry: the statement rules (binding, the read-only gate, the page's name
 * mapping), configuration checks and secrecy, the network rule, and the Postgres connector end to end against a real
 * Postgres engine on a loopback socket (test-support pglite-wire): rows and types, bound values, the read-only session, limits,
 * and the viewer's values as the database sees them. TLS, statement timeouts, row policies and MySQL run against
 * real servers in services/app/lib/connections/__tests__/connectors-docker.test.ts (integration project).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectionSummary, connectorError, connectorList, mapQualifiers, openConnection, parseConnectionConfig, qualifierNames, type OpenConnection } from '@artifactbin/connectors';
import { startPgliteWire, type PgliteWire } from '@artifactbin/test-support/pglite-wire';

const DEV = { allowPrivateNetwork: true }, PUBLIC = { allowPrivateNetwork: false };
const failure = async (p: Promise<unknown>) => p.then(() => { throw Error('expected a refusal'); }, (e) => connectorError(e));

describe('statement rules', () => {
  it('maps a page link qualifier to its namespace, quoted, or removes it; nothing inside literals, quotes or comments', () => {
    const map = new Map([['wh', 'sales'], ['raw', '']]);
    expect(mapQualifiers('postgres', 'select * from wh.orders o join raw.items i on i.o = o.id', map)).toBe('select * from "sales".orders o join items i on i.o = o.id');
    expect(mapQualifiers('mysql', 'select * from WH . orders', map)).toBe('select * from `sales` . orders');
    expect(mapQualifiers('postgres', `select 'wh.orders', "wh".orders, x.wh.y -- wh.z\n from t /* wh.q */`, map)).toBe(`select 'wh.orders', "wh".orders, x.wh.y -- wh.z\n from t /* wh.q */`);
    expect(mapQualifiers('postgres', 'select $$ wh.a $$, $q$wh.b$q$ from wh.t', map)).toBe('select $$ wh.a $$, $q$wh.b$q$ from "sales".t');
    expect(mapQualifiers('postgres', 'select * from wh.t', new Map([['wh', 'a"b']]))).toBe('select * from "a""b".t');
    expect([...qualifierNames('mysql', "select `wh`.a, 'raw.x', s.t from wh.t")]).toEqual(['s', 'wh']);
  });
});

describe('configuration', () => {
  it('checks fields against the registry, names the field and never echoes a value', () => {
    expect(parseConnectionConfig({ connector: 'postgres', host: 'db.example.com', database: 'shop', user: 'r' })).toMatchObject({ port: 5432, tls: 'verify-full' });
    const bad = (input: unknown) => { try { parseConnectionConfig(input); } catch (e) { return connectorError(e); } return null; };
    expect(bad('{"connector":"postgres","password":"hunter2-secret"')).toEqual({ code: 'invalid_config', message: 'the configuration is not JSON' });
    expect(bad({ connector: 'postgres', host: 'h', database: 'd', user: 'u', pasword: 'hunter2-secret' })!.message).toBe('postgres has no field "pasword"');
    expect(bad({ connector: 'oracle' })!.code).toBe('invalid_config');
    expect(bad({ connector: 'mysql', host: 'h', user: 'u' })!.message).toBe('mysql needs database');
    expect(bad({ connector: 'postgres', host: 'h', database: 'd', user: 'u', port: 99999, password: 'hunter2-secret' })!.message).not.toContain('hunter2');
  });
  it('shows a connection by its shown fields alone, never the secret', () => {
    const summary = connectionSummary(parseConnectionConfig({ connector: 'postgres', host: 'db.example.com', database: 'shop', user: 'reader', password: 'hunter2-secret' }));
    expect(summary).toEqual({ connector: 'postgres', label: 'PostgreSQL', fields: { host: 'db.example.com', port: 5432, database: 'shop' } });
    expect(JSON.stringify(summary)).not.toContain('hunter2');
  });
  it('lists every registered connector and whether it runs here', () => {
    expect(connectorList().map((c) => [c.id, c.available])).toEqual([['postgres', true], ['mysql', true], ['bigquery', false]]);
  });
});

describe('the network rule', () => {
  const config = (host: string, extra = {}) => ({ connector: 'postgres', host, database: 'd', user: 'u', ...extra });
  const opened = (c: unknown, policy = PUBLIC, lookup?: (h: string) => Promise<{ address: string; family: number }[]>) => {
    try { return openConnection(c, policy, lookup ? { lookup } : {}); } catch (e) { return connectorError(e); }
  };
  it('refuses loopback, private, link-local and metadata addresses and plaintext unless the install allows private networks', async () => {
    for (const host of ['127.0.0.1', '10.1.2.3', '192.168.0.4', '::1']) expect(opened(config(host)), host).toMatchObject({ code: 'forbidden_address' });
    for (const host of ['169.254.169.254', 'fe80::1']) expect(opened(config(host), DEV), host).toMatchObject({ code: 'forbidden_address' });
    expect(opened(config('db.example.com', { tls: 'disable' }))).toMatchObject({ code: 'tls_required' });
    // A name is judged by every address it resolves to, at connect time.
    const c = opened(config('db.example.com'), PUBLIC, async () => [{ address: '203.0.113.9', family: 4 }, { address: '10.0.0.5', family: 4 }]) as OpenConnection;
    expect(await c.test()).toEqual({ ok: false, error: { code: 'forbidden_address', message: 'the host resolves to an address that is not public' } });
    const metadata = opened(config('metadata.internal', { tls: 'disable' }), DEV, async () => [{ address: '169.254.169.254', family: 4 }]) as OpenConnection;
    expect(await metadata.test()).toMatchObject({ ok: false, error: { code: 'forbidden_address' } });
    await c.close(); await metadata.close();
  });
});

describe('postgres, end to end', () => {
  let wire: PgliteWire, pg: OpenConnection;
  const alice = { id: 'u_alice', email: 'alice@example.com', groups: ['g2', 'g1'] }, bob = { id: 'u_bob', email: 'bob@example.com', groups: [] };
  beforeAll(async () => {
    wire = await startPgliteWire(`
      create schema sales;
      create table sales.orders(id int primary key, owner text not null, item text, amount numeric, big bigint, placed date, at timestamptz, meta jsonb, ok boolean);
      insert into sales.orders values (1,'u_alice','tea',4.5,9007199254740993,'2026-11-01','2026-11-01 10:00:00+00','{"a":1}',true),
        (2,'u_bob','cake',12,7,'2026-11-02','2026-11-02 11:30:00+00',null,false), (3,'u_alice','pie',30,8,null,null,'[1,2]',null);
      create view sales.my_orders as select id, item from sales.orders where owner = current_setting('app.viewer_id', true);
      create table public.notes(n text);`);
    pg = openConnection({ connector: 'postgres', host: '127.0.0.1', port: wire.port, database: 'postgres', user: 'postgres', password: 'hunter2-secret', tls: 'disable' }, DEV);
  });
  afterAll(async () => { await pg?.close(); await wire?.close(); });

  it('answers columns in the common types and rows, binding every value', async () => {
    const answer = await pg.query({ text: 'select id, item, amount, big, placed, at, meta, ok from sales.orders where amount >= $min order by id', params: { min: 4 }, viewer: null });
    expect(answer.columns).toEqual([
      { name: 'id', type: 'number' }, { name: 'item', type: 'text' }, { name: 'amount', type: 'number' }, { name: 'big', type: 'number' },
      { name: 'placed', type: 'date' }, { name: 'at', type: 'timestamp' }, { name: 'meta', type: 'json' }, { name: 'ok', type: 'boolean' }]);
    expect(answer.rows[0]).toEqual({ id: 1, item: 'tea', amount: 4.5, big: '9007199254740993', placed: '2026-11-01', at: '2026-11-01T10:00:00Z', meta: { a: 1 }, ok: true });
    expect(answer.rows[2]).toMatchObject({ big: 8, placed: null, meta: [1, 2] });
  });

  it('binds a value as a value: no injection through params', async () => {
    const evil = "x' or '1'='1'; drop table sales.orders; --";
    const answer = await pg.query({ text: 'select $v as v, count(*) as n from sales.orders where item = $v', params: { v: evil }, viewer: null });
    expect(answer.rows).toEqual([{ v: evil, n: 0 }]);
    expect((await pg.query({ text: 'select count(*) as n from sales.orders', params: {}, viewer: null })).rows).toEqual([{ n: 3 }]);
    expect(await failure(pg.query({ text: 'select $missing', params: {}, viewer: null }))).toEqual({ code: 'invalid_query', message: '$missing has no value' });
    expect(await failure(pg.query({ text: 'select $1', params: {}, viewer: null }))).toMatchObject({ code: 'invalid_query' });
  });

  it('is read-only: a write is refused by the gate and, past it, by the session', async () => {
    for (const text of ['insert into public.notes values (1)', 'drop table sales.orders', 'set role postgres', 'select 1; delete from public.notes', "select set_config('app.viewer_id', 'u_bob', false)"])
      expect((await failure(pg.query({ text, params: {}, viewer: null }))).code, text).toMatch(/read_only|invalid_query/);
    // A data-modifying CTE starts with WITH: the read-only transaction refuses it.
    expect(await failure(pg.query({ text: "with w as (insert into public.notes values ('x') returning 1) select * from w", params: {}, viewer: null }))).toMatchObject({ code: 'read_only' });
    expect((await wire.db.query('select count(*)::int as n from public.notes')).rows).toEqual([{ n: 0 }]);
  });

  it('gives the database the viewer for each query, and never a previous one', async () => {
    const mine = (viewer: typeof alice | null) => pg.query({ text: 'select id from sales.my_orders order by id', params: {}, viewer }).then((a) => a.rows.map((r) => r.id));
    expect(await mine(alice)).toEqual([1, 3]);
    expect(await mine(bob)).toEqual([2]);
    expect(await mine(null)).toEqual([]);
    const seen = await pg.query({ text: "select current_setting('app.viewer_id') as id, current_setting('app.viewer_email') as email, current_setting('app.viewer_groups') as groups", params: {}, viewer: alice });
    expect(seen.rows).toEqual([{ id: 'u_alice', email: 'alice@example.com', groups: '["g1","g2"]' }]);
    expect(pg.sessions()).toBe(1);
  });

  it('keeps to the limits: rows stop with truncated, bytes refuse', async () => {
    const some = await pg.query({ text: 'select g from generate_series(1, 5000) g', params: {}, viewer: null, limits: { rows: 1200 } });
    expect([some.rows.length, some.truncated, some.rows.at(-1)]).toEqual([1200, true, { g: 1200 }]);
    expect(await failure(pg.query({ text: "select repeat('x', 1000) as x from generate_series(1, 100)", params: {}, viewer: null, limits: { bytes: 20_000 } }))).toMatchObject({ code: 'result_too_large' });
    expect((await pg.query({ text: 'select 1 as one', params: {}, viewer: null, limits: { rows: 1e9 } })).rows).toEqual([{ one: 1 }]);
  });

  it('selects a namespace, lists the schema and tests the connection', async () => {
    expect((await pg.query({ text: 'select count(*) as n from orders', params: {}, viewer: null, namespace: 'sales' })).rows).toEqual([{ n: 3 }]);
    expect(await failure(pg.query({ text: 'select 1', params: {}, viewer: null, namespace: 'sales"; drop' }))).toMatchObject({ code: 'invalid_query' });
    const schema = await pg.schema({ namespace: 'sales' });
    expect(schema.tables.map((t) => [t.name, t.kind, t.columns.length])).toEqual([['my_orders', 'view', 2], ['orders', 'table', 9]]);
    expect(schema.tables[1]!.columns[3]).toEqual({ name: 'amount', type: 'number' });
    expect(await pg.test()).toMatchObject({ ok: true });
  });

  it('never puts the password in an error', async () => {
    const e = await failure(pg.query({ text: "select * from \"hunter2-secret\"", params: {}, viewer: null }));
    expect(e.code).toBe('database_error');
    expect(e.message).not.toContain('hunter2-secret');
  });
});
