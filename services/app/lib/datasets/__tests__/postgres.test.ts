import { execFileSync, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileDatasetSql } from '../sql';
import { discoverPostgres, queryPostgres } from '../postgres';
import type { DatasetCatalog, PostgresConfig } from '../types';
import type { Scalar } from '@/lib/story/dataflow';
import type { DatasetColumn } from '@/lib/story/dataset-shape';

const catalog: DatasetCatalog = { kind: 'postgres', defaultSchema: 'analytics', refreshSeconds: 60, tables: [
  { schema: 'analytics', name: 'people', source: { schema: 'private_data', table: 'people' }, columns: [{ name: 'id', type: 'number' }, { name: 'name', type: 'string' }] },
  { schema: 'analytics', name: 'names', sql: 'select id, name from people where id > $minimum', columns: [{ name: 'name', type: 'string' }] },
] };
const dockerAvailable = spawnSync('docker', ['image', 'inspect', 'postgres:17-alpine'], { stdio: 'ignore' }).status === 0;
describe.skipIf(!dockerAvailable)('Postgres catalog isolation and bounded execution (disposable real server)', () => {
  let container: string;
  let admin: pg.Client;
  let config: PostgresConfig;
  beforeAll(async () => {
    container = execFileSync('docker', ['run', '--rm', '-d', '-e', 'POSTGRES_PASSWORD=disposable-only', '-p', '127.0.0.1::5432', 'postgres:17-alpine'], { encoding: 'utf8' }).trim();
    const port = Number(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1));
    config = { host: '127.0.0.1', port, database: 'postgres', username: 'reader', password: 'reader-secret', ssl: false };
    for (let attempt = 0; attempt < 100; attempt++) {
      admin = new pg.Client({ host: config.host, port, database: 'postgres', user: 'postgres', password: 'disposable-only' });
      try { await admin.connect(); break; } catch { await admin.end(); await delay(100); }
    }
    await admin.query(`CREATE ROLE reader LOGIN PASSWORD 'reader-secret'; CREATE SCHEMA private_data;
      CREATE TABLE private_data.people (id int, name text, secret text);
      INSERT INTO private_data.people VALUES (1,'Ada','hidden-a'),(2,'Grace','hidden-b'),(3,'Linus','hidden-c');
      CREATE TABLE private_data.invisible (password text);
      GRANT USAGE ON SCHEMA private_data TO reader;
      GRANT SELECT, INSERT, UPDATE, DELETE ON private_data.people TO reader;
      CREATE TABLE private_data.partial (visible int, secret text);
      GRANT SELECT(visible) ON private_data.partial TO reader;`);
  });
  afterAll(async () => { await admin?.end(); if (container) execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' }); });
  const run = (sql: string, params = {}, opts = {}) => { const compiled = compileDatasetSql(catalog, sql, params); return queryPostgres(config, compiled.sql, compiled.values, opts); };

  it('resolves bare and qualified tables and projects exposed columns only', async () => {
    expect((await run('select * from analytics.people order by id')).rows).toEqual([{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }, { id: 3, name: 'Linus' }]);
    expect((await run('select p.name from people p where id=2')).rows).toEqual([{ name: 'Grace' }]);
  });
  it.each(['select secret from people', "select name from people where secret='hidden-a'", 'select p.name from people p join people q on p.secret=q.secret', 'select * from (select secret from people) s'])('cannot access hidden columns: %s', async sql => {
    await expect(run(sql)).rejects.toThrow();
  });
  it('keeps CTE shadowing local and qualified references catalog-bound', async () => {
    expect((await run("with people as (select 99 as id, 'CTE' as name) select * from people union all select * from analytics.people")).rows).toHaveLength(4);
    expect((await run('with x as (select * from people) select name from x where id=1')).rows).toEqual([{ name: 'Ada' }]);
  });
  it('binds parameters without touching strings, comments, dollars, nulls or repeated names', async () => {
    const c = compileDatasetSql(catalog, "select $name::text as name, $nil::text as nil, $name::text as again, '$untouched' as literal, $$dollar $untouched$$ as dollars /* $ignored /* $nested */ */ -- $line\n", { name: "O'Reilly", nil: null });
    expect(c.values).toEqual(["O'Reilly", null]);
    expect((await queryPostgres(config, c.sql, c.values)).rows[0]).toEqual({ name: "O'Reilly", nil: null, again: "O'Reilly", literal: '$untouched', dollars: 'dollar $untouched' });
  });
  it.each([null, 'Ada'])('types a nullable string filter with value %s before PostgreSQL inference', async name => {
    const compiled = compileDatasetSql(catalog, 'select name from people where $name is null or name=$name order by id', { name }, { name: 'string' });
    expect(compiled.values).toEqual([name]);
    expect((await queryPostgres(config, compiled.sql, compiled.values)).rows).toEqual(name === null ? [{ name: 'Ada' }, { name: 'Grace' }, { name: 'Linus' }] : [{ name: 'Ada' }]);
  });
  it.each([
    ['number', 2, 'id=$value', [{ name: 'Grace' }]],
    ['date', '2026-09-06', "date '2026-09-06'=$value", [{ name: 'Ada' }, { name: 'Grace' }, { name: 'Linus' }]],
    ['boolean', true, '$value=true', [{ name: 'Ada' }, { name: 'Grace' }, { name: 'Linus' }]],
  ] as const)('types %s nullable filters and native values', async (kind, value, predicate, expected) => {
    for (const bound of [value, null]) {
      const compiled = compileDatasetSql(catalog, `select name from people where $value is null or ${predicate} order by id`, { value: bound }, { value: kind });
      expect((await queryPostgres(config, compiled.sql, compiled.values)).rows).toEqual(bound === null ? [{ name: 'Ada' }, { name: 'Grace' }, { name: 'Linus' }] : expected);
    }
  });
  it('types projected parameters including nulls using result-field metadata', async () => {
    const types = { text: 'string', n: 'number', flag: 'boolean', day: 'date' } as const;
    const compiled = compileDatasetSql(catalog, 'select $text as text, $n as n, $flag as flag, $day as day', { text: 'hello', n: 1.25, flag: false, day: '2026-09-06' }, types);
    const result = await queryPostgres(config, compiled.sql, compiled.values);
    expect(result.rows).toEqual([{ text: 'hello', n: 1.25, flag: false, day: '2026-09-06' }]);
    expect(result.columns).toEqual(Object.entries(types).map(([name, type]) => ({ name, type })));
    const nulls = compileDatasetSql(catalog, 'select $text as text, $n as n, $flag as flag, $day as day', { text: null, n: null, flag: null, day: null }, types);
    expect((await queryPostgres(config, nulls.sql, nulls.values)).columns).toEqual(result.columns);
  });
  it('expands models and projects their declared columns', async () => {
    expect((await run('select * from names', { minimum: 1 })).rows).toEqual([{ name: 'Grace' }, { name: 'Linus' }]);
    await expect(run('select id from names', { minimum: 0 })).rejects.toThrow();
  });
  it('executes native aggregate, join, scalar subquery and date expressions', async () => {
    expect((await run("select count(*)::int as n, date_trunc('month', timestamp '2026-08-15') as month from people where id in (select id from people where id>1)")).rows).toEqual([{ n: 2, month: '2026-08-01T00:00:00.000Z' }]);
  });
  it('supports EXISTS and keeps model dependencies outside caller CTE scope', async () => {
    expect((await run('select name from people p where exists (select 1 from people q where q.id=p.id and q.id=1)')).rows).toEqual([{ name: 'Ada' }]);
    expect((await run("with people as (select 99 as id, 'untrusted' as name) select * from names", { minimum: 1 })).rows).toEqual([{ name: 'Grace' }, { name: 'Linus' }]);
  });
  it('caps excessive row and timeout requests and rejects invalid bounds', async () => {
    const result = await queryPostgres(config, "select generate_series(1,10005) as n, current_setting('statement_timeout') as timeout", [], { limit: 1000000, timeoutMs: 999999 });
    expect(result.rows).toHaveLength(10000); expect(result.truncated).toBe(true); expect(result.rows[0].timeout).toBe('10s');
    for (const opts of [{ limit: -1 }, { offset: -1 }, { limit: NaN }, { timeoutMs: Infinity }, { offset: 1.5 }]) {
      await expect(queryPostgres(config, 'select 1', [], opts)).rejects.toThrow(/bounds/);
    }
  });
  it('paginates remotely, reports truncation and retains types on empty results', async () => {
    const page = await run('select * from people order by id', {}, { limit: 1, offset: 1 });
    expect(page.rows).toEqual([{ id: 2, name: 'Grace' }]); expect(page.truncated).toBe(true);
    const empty = await run('select * from people where false');
    expect(empty.rows).toEqual([]); expect(empty.columns).toEqual(catalog.tables[0].columns);
    expect((await run('select * from people', {}, { limit: 3 })).truncated).not.toBe(true);
  });
  it('preserves int8 precision and serializes native values safely', async () => {
    const result = await run("select 9223372036854775807::bigint as big, 'NaN'::float8 as nan, true as flag, json_build_object('a',1) as obj");
    expect(result.rows[0]).toEqual({ big: '9223372036854775807', nan: null, flag: true, obj: { a: 1 } });
    expect(() => JSON.stringify(result)).not.toThrow();
  });
  it('discovers only current-role permitted non-system columns', async () => {
    const tables = await discoverPostgres(config);
    expect(tables.find(t => t.name === 'people')?.columns).toHaveLength(3);
    expect(tables.find(t => t.name === 'partial')?.columns.map(c => c.name)).toEqual(['visible']);
    expect(tables.some(t => t.name === 'invisible' || t.schema.startsWith('pg_') || t.schema === 'information_schema')).toBe(false);
  });
  it('enforces read-only transactions even for direct executor calls', async () => {
    expect((await queryPostgres(config, 'select 1 as n', [])).rows).toEqual([{ n: 1 }]);
    await expect(queryPostgres(config, "with changed as (delete from private_data.people returning *) select * from changed", [])).rejects.toThrow();
    expect((await admin.query('select count(*) from private_data.people')).rows[0].count).toBe('3');
  });
  it('cancels queries at the server timeout and closes failed sessions', async () => {
    const start = Date.now();
    await expect(queryPostgres(config, 'select pg_sleep(2)', [], { timeoutMs: 50 })).rejects.toThrow(/timed out/i);
    expect(Date.now() - start).toBeLessThan(1500);
    const active = await admin.query("select count(*) from pg_stat_activity where usename='reader' and state='active'");
    expect(active.rows[0].count).toBe('0');
  });
  it('sanitizes server and connection errors', async () => {
    await expect(queryPostgres({ ...config, password: 'never-leak-this' }, 'select 1', [])).rejects.toThrow(/Postgres connection failed/);
    try { await queryPostgres(config, "select 'reader-secret'::int", []); } catch (e) { expect(String(e)).not.toContain('reader-secret'); }
  });
});

describe('SQL compiler rejects unsafe or unsupported operations', () => {
  it.each([
    'delete from people', 'select 1; select 2', 'select * into copied from people', 'select * from people for update',
    'with x as (delete from people returning *) select * from x', 'select * from pg_catalog.pg_authid', 'select * from information_schema.tables',
    'select * from private_data.people', 'select * from unlisted', 'select * from generate_series(1,2)', 'select pg_sleep(1)',
    "select set_config('search_path','public',false)", 'select pg_catalog.count(*) from people', "select 'pg_authid'::regclass", "select 'x'::public.secret_type",
    'select 1 OPERATOR(public.+) 2', 'select (select pg_sleep(1))', 'select * from people p cross join lateral pg_sleep(1)', 'select current_user', 'select $missing', 'select $1',
  ])('refuses %s', sql => { expect(() => compileDatasetSql(catalog, sql)).toThrow(/Dataset SQL/); });
  it.each([
    ['regclass', null], ['number', '2'], ['boolean', 1], ['date', true], ['string', 2],
  ])('rejects invalid parameter type/value pairs %s and %s', (kind, value) => {
    expect(() => compileDatasetSql(catalog, 'select $value', { value: value as Scalar }, { value: kind as DatasetColumn['type'] })).toThrow(/Dataset SQL:.*parameter/);
  });
  it('requires metadata for each used parameter when a type map is supplied', () => {
    expect(() => compileDatasetSql(catalog, 'select $value', { value: null }, {})).toThrow(/parameter/);
  });
  it('detects model cycles', () => {
    const cyclic = { ...catalog, tables: [{ schema: 'analytics', name: 'a', sql: 'select * from b', columns: [{ name: 'id', type: 'number' as const }] }, { schema: 'analytics', name: 'b', sql: 'select * from a', columns: [{ name: 'id', type: 'number' as const }] }] };
    expect(() => compileDatasetSql(cyclic, 'select * from a')).toThrow(/cycl/i);
  });
});
