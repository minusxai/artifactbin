/**
 * THE CONNECTORS AGAINST REAL SERVERS: a disposable `postgres:17-alpine` with TLS (certificates made here by openssl)
 * and a `mysql:8`. What the fast suite's PGlite cannot show: a row policy keyed on `current_setting('app.viewer_id')`
 * giving two viewers different rows through a non-superuser account, the startup parameters, the database a
 * `default:` namespace opens (and 3D000 for one that does not exist), statement timeouts, TLS refusals, a refused
 * sign-in without the password in the error, and MySQL's viewer variables (read through a function, reset after each
 * query, hostile values kept literal). Runs in the `integration` project; skipped without the images.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectorError, openConnection, type OpenConnection } from '@artifactbin/connectors';

const has = (image: string) => spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0;
const DEV = { allowPrivateNetwork: true };
const PASSWORD = 'reader-pa55-f0r-connector-tests';
const portOf = (id: string, port: number) => Number(execFileSync('docker', ['port', id, `${port}/tcp`], { encoding: 'utf8' }).trim().split('\n')[0]!.split(':').at(-1));
const failure = async (p: Promise<unknown>) => p.then(() => { throw Error('expected a refusal'); }, (e) => connectorError(e));
const alice = { id: 'u_alice', email: 'alice@example.com', groups: ['g1'] }, bob = { id: 'u_bob', email: "b'o\\b@example.com", groups: [] };

describe.skipIf(!has('postgres:17-alpine'))('postgres 17 over TLS', () => {
  let container = '', plain = '', dir = '', port = 0, plainPort = 0, ca = '';
  const opened: OpenConnection[] = [];
  const open = (extra: Record<string, unknown> = {}) => { const c = openConnection({ connector: 'postgres', host: 'db.example.com', port, database: 'shop', user: 'reader', password: PASSWORD, ca, ...extra }, DEV, { lookup: async () => [{ address: '127.0.0.1', family: 4 }] }); opened.push(c); return c; };
  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'afbin-connector-pg-'));
    const ssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
    for (const name of ['ca', 'other']) ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.crt`, '-subj', `/CN=connector ${name} root`, '-days', '2', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
    ssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=db.example.com');
    writeFileSync(path.join(dir, 'server.ext'), 'subjectAltName=DNS:db.example.com\nextendedKeyUsage=serverAuth\n');
    ssl('x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.crt', '-days', '2', '-extfile', 'server.ext');
    const read = (name: string) => readFileSync(path.join(dir, name), 'utf8');
    ca = read('ca.crt');
    container = execFileSync('docker', ['run', '--rm', '-d', '-e', 'POSTGRES_PASSWORD=owner-pass', '-e', 'POSTGRES_DB=shop', '-e', `CERT=${read('server.crt')}`, '-e', `KEY=${read('server.key')}`, '-p', '127.0.0.1::5432', '--entrypoint', 'sh', 'postgres:17-alpine', '-c',
      'printf "%s\\n" "$CERT" > /tmp/server.crt && printf "%s\\n" "$KEY" > /tmp/server.key && chown postgres /tmp/server.crt /tmp/server.key && chmod 600 /tmp/server.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key'], { encoding: 'utf8' }).trim();
    plain = execFileSync('docker', ['run', '--rm', '-d', '-e', 'POSTGRES_PASSWORD=owner-pass', '-p', '127.0.0.1::5432', 'postgres:17-alpine'], { encoding: 'utf8' }).trim();
    port = portOf(container, 5432); plainPort = portOf(plain, 5432);
    for (const id of [container, plain]) for (let attempt = 0; ; attempt++) {
      if (spawnSync('docker', ['exec', id, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { stdio: 'ignore' }).status === 0) break;
      if (attempt > 120) throw Error('postgres:17-alpine never became ready');
      await new Promise((r) => setTimeout(r, 500));
    }
    const psql = (db: string, script: string) => execFileSync('docker', ['exec', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db, '-c', script], { stdio: 'pipe' });
    psql('shop', `create role reader login password '${PASSWORD}';
      create table orders(id int primary key, owner text not null, item text);
      insert into orders values (1, 'u_alice', 'tea'), (2, 'u_bob', 'cake'), (3, 'u_alice', 'pie');
      alter table orders enable row level security;
      create policy mine on orders for select using (owner = current_setting('app.viewer_id', true));
      grant select, insert, delete on orders to reader;`);
    psql('shop', 'create database analytics');
    psql('analytics', 'create table facts(n int); insert into facts values (42); grant select on facts to reader;');
  }, 120_000);
  afterAll(async () => {
    await Promise.all(opened.map((c) => c.close()));
    for (const id of [container, plain]) if (id) spawnSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('gives each viewer the rows the database\'s own policy gives them', async () => {
    const pg = open();
    const ids = async (viewer: typeof alice | null) => (await pg.query({ text: 'select id from orders order by id', params: {}, viewer })).rows.map((r) => r.id);
    expect(await ids(alice)).toEqual([1, 3]);
    expect(await ids(bob)).toEqual([2]);
    expect(await ids(null)).toEqual([]);
    expect(await ids(alice)).toEqual([1, 3]);
    expect(pg.sessions()).toBe(1);
  });

  it('opens with the startup parameters, read-only, TLS on', async () => {
    const pg = open();
    const row = (await pg.query({ text: "select current_setting('application_name') as app, current_setting('TimeZone') as tz, current_setting('statement_timeout') as st, current_setting('default_transaction_read_only') as ro, current_setting('transaction_read_only') as tro, (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as ssl, current_user as who", params: {}, viewer: alice })).rows[0];
    expect(row).toEqual({ app: 'artifactbin', tz: 'UTC', st: '5s', ro: 'on', tro: 'on', ssl: true, who: 'reader' });
  });

  it('opens the database default: names, and says when there is none', async () => {
    const pg = open();
    expect((await pg.query({ text: 'select current_database() as db, n from facts', params: {}, viewer: alice, namespace: 'analytics' })).rows).toEqual([{ db: 'analytics', n: 42 }]);
    expect(await failure(pg.query({ text: 'select 1', params: {}, viewer: alice, namespace: 'nowhere' }))).toMatchObject({ code: 'invalid_config' });
    const schema = await pg.schema({ viewer: alice });
    expect(schema.tables.map((t) => [t.namespace, t.name, t.columns.map((c) => c.type)])).toEqual([['public', 'orders', ['number', 'text', 'text']]]);
  });

  it('refuses writes the account may make, and stops a query at its time limit', async () => {
    const pg = open();
    expect(await failure(pg.query({ text: "with w as (insert into orders values (9, 'x', 'x') returning 1) select * from w", params: {}, viewer: alice }))).toMatchObject({ code: 'read_only' });
    const started = Date.now();
    expect(await failure(pg.query({ text: 'select pg_sleep(30)', params: {}, viewer: alice, limits: { timeoutMs: 500 } }))).toMatchObject({ code: 'timeout' });
    expect(Date.now() - started).toBeLessThan(5000);
    expect((await pg.query({ text: 'select 1 as one', params: {}, viewer: alice })).rows).toEqual([{ one: 1 }]);
  });

  it('refuses an untrusted certificate, a server without TLS and a wrong password, never echoing it', async () => {
    expect(await open({ ca: readFileSync(path.join(dir, 'other.crt'), 'utf8') }).test({ viewer: alice })).toMatchObject({ ok: false, error: { code: 'tls_untrusted_certificate' } });
    expect(await open({ port: plainPort }).test({ viewer: alice })).toMatchObject({ ok: false, error: { code: 'tls_unsupported' } });
    const wrong = await open({ password: 'not-the-password-but-long' }).test({ viewer: alice });
    expect(wrong).toMatchObject({ ok: false, error: { code: 'auth_failed' } });
    expect(JSON.stringify(wrong)).not.toContain('not-the-password-but-long');
    expect(await open().test({ viewer: alice })).toMatchObject({ ok: true });
  });
});

describe.skipIf(!has('mysql:8'))('mysql 8', () => {
  let container = '', port = 0;
  let my: OpenConnection;
  beforeAll(async () => {
    container = execFileSync('docker', ['run', '--rm', '-d', '-e', 'MYSQL_ROOT_PASSWORD=owner-pass', '-e', 'MYSQL_DATABASE=shop', '-p', '127.0.0.1::3306', 'mysql:8'], { encoding: 'utf8' }).trim();
    port = portOf(container, 3306);
    const mysql = (script: string) => spawnSync('docker', ['exec', container, 'mysql', '-uroot', '-powner-pass', '-e', script], { encoding: 'utf8' });
    for (let attempt = 0; ; attempt++) {
      if (mysql('select 1').status === 0 && mysql("select 1 from information_schema.schemata where schema_name = 'shop'").stdout.includes('1')) break;
      if (attempt > 240) throw Error('mysql:8 never became ready');
      await new Promise((r) => setTimeout(r, 500));
    }
    const done = mysql(`use shop;
      create table orders(id int primary key, owner varchar(64) not null, item varchar(64), placed datetime, at timestamp null, big bigint, price decimal(6,2), meta json);
      insert into orders values (1, 'u_alice', 'tea', '2026-11-01 10:00:00', '2026-11-01 10:00:00', 9007199254740993, 4.50, '{"a":1}'), (2, 'u_bob', 'cake', null, null, 7, 12, null), (3, 'u_alice', 'pie', null, null, 8, 30, null);
      create function app_viewer_id() returns varchar(255) deterministic return @app.viewer_id;
      create sql security definer view mine as select id, item from orders where owner = app_viewer_id();
      create user 'reader'@'%' identified by '${PASSWORD}';
      grant select, insert, delete on shop.* to 'reader'@'%'; grant execute on shop.* to 'reader'@'%'; create database analytics; grant select on analytics.* to 'reader'@'%';`);
    expect(done.status, done.stderr).toBe(0);
    my = openConnection({ connector: 'mysql', host: '127.0.0.1', port, database: 'shop', user: 'reader', password: PASSWORD, tls: 'disable' }, DEV);
  }, 180_000);
  afterAll(async () => { await my?.close(); if (container) spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' }); });

  it('gives each viewer their rows through the database\'s function, and resets the values after each query', async () => {
    const ids = async (viewer: typeof alice | null) => (await my.query({ text: 'select id from mine order by id', params: {}, viewer })).rows.map((r) => r.id);
    expect(await ids(alice)).toEqual([1, 3]);
    expect(await ids(bob)).toEqual([2]);
    expect(await ids(null)).toEqual([]);
    // Hostile values arrive as written, one literal each.
    expect((await my.query({ text: 'select @app.viewer_id as id, @app.viewer_email as email, @app.viewer_groups as g', params: {}, viewer: bob })).rows).toEqual([{ id: 'u_bob', email: "b'o\\b@example.com", g: '[]' }]);
    expect(my.sessions()).toBe(1);
  });

  it('maps types, binds values, refuses writes, INTO and :=, and stops at the time limit', async () => {
    const answer = await my.query({ text: 'select id, placed, at, big, price, meta from orders where item = $item or id = $id order by id', params: { item: "tea' or '1'='1", id: 1 }, viewer: alice });
    expect(answer.columns.map((c) => c.type)).toEqual(['number', 'timestamp', 'timestamp', 'number', 'number', 'json']);
    expect(answer.rows).toEqual([{ id: 1, placed: '2026-11-01T10:00:00', at: '2026-11-01T10:00:00Z', big: '9007199254740993', price: 4.5, meta: { a: 1 } }]);
    expect((await my.query({text: "SELECT CAST('9876543210987654.3210' AS DECIMAL(24,4)) AS amount, CAST('0.1234567890123456789' AS DECIMAL(24,19)) AS fraction", params:{}, viewer:null})).rows).toEqual([{amount:'9876543210987654.3210',fraction:'0.1234567890123456789'}]);
    expect(await failure(my.query({ text: 'with x as (select 1) delete from orders', params: {}, viewer: alice }))).toMatchObject({ code: 'read_only' });
    for (const text of ["select 1 into outfile '/tmp/x'", "select @app.viewer_id := 'u_bob'", "set @app.viewer_id = 'u_bob'", 'drop table orders'])
      expect((await failure(my.query({ text, params: {}, viewer: alice }))).code, text).toBe('read_only');
    expect(await failure(my.query({ text: 'select sleep(30)', params: {}, viewer: alice, limits: { timeoutMs: 500 } }))).toMatchObject({ code: 'timeout' });
    expect((await my.query({ text: 'select current_database_ok from (select database() as current_database_ok) d', params: {}, viewer: alice, namespace: 'analytics' })).rows).toEqual([{ current_database_ok: 'analytics' }]);
    // A database the account may not see is the server's 1044, a refusal of this account: permission_denied.
    expect((await failure(my.query({ text: 'select 1', params: {}, viewer: alice, namespace: 'nowhere' }))).code).toMatch(/^(invalid_config|permission_denied)$/);
    const schema = await my.schema({ viewer: alice });
    expect(schema.tables.map((t) => [t.name, t.kind])).toEqual([['mine', 'view'], ['orders', 'table']]);
  });
});

// The MySQL connector must detect protocol-compatible engines itself: callers pass no engine flag.
describe.skipIf(!has('apache/doris:all-in-one-4.1.3'))('Doris through the MySQL connector', () => {
  let container = '', my: OpenConnection;
  beforeAll(async () => {
    container = execFileSync('docker', ['run', '--rm', '-d', '-p', '127.0.0.1::9030', 'apache/doris:all-in-one-4.1.3'], {encoding:'utf8'}).trim();
    const port = portOf(container, 9030);
    const sql = (text: string) => spawnSync('docker', ['exec', container, 'mysql', '-h127.0.0.1', '-P9030', '-uroot', '-e', text], {encoding:'utf8'});
    for(let attempt=0;;attempt++) {
      const backends = sql('SHOW BACKENDS');
      const [header = '', ...rows] = backends.stdout.trim().split('\n');
      const columns = header.split('\t');
      if (backends.status === 0 && rows.some(row => {
        const values = row.split('\t');
        return values[columns.indexOf('Alive')] === 'true' && parseFloat(values[columns.indexOf('TotalCapacity')] ?? '0') > 0;
      })) break;
      if(attempt > 180) throw Error('Doris never became ready');
      await new Promise(r=>setTimeout(r,500));
    }
    const seeded = sql(`CREATE DATABASE shop;
      CREATE TABLE shop.orders(id INT, price DECIMAL(18,2), placed DATETIME, big BIGINT, note VARCHAR(100)) DUPLICATE KEY(id) DISTRIBUTED BY HASH(id) BUCKETS 1 PROPERTIES ("replication_num"="1");
      INSERT INTO shop.orders VALUES (1,12.34,'2026-11-01 12:00:00',9007199254740993,'tea'),(2,NULL,'2099-01-01 00:00:00',1,NULL);
      CREATE USER 'reader' IDENTIFIED BY '${PASSWORD}'; GRANT SELECT_PRIV ON shop.* TO 'reader';`);
    expect(seeded.status, seeded.stderr).toBe(0);
    my = openConnection({connector:'mysql',host:'127.0.0.1',port,database:'shop',user:'reader',password:PASSWORD,tls:'disable'},DEV);
  },120_000);
  afterAll(async()=>{await my?.close();if(container)spawnSync('docker',['rm','-f',container],{stdio:'ignore'});});
  it('tests and discovers schema without engine-specific caller configuration',async()=>{
    expect(await my.test({viewer:alice})).toMatchObject({ok:true});
    expect((await my.schema({viewer:alice})).tables.map(t=>t.name)).toEqual(['orders']);
  });
  it('binds typed values, keeps precision and nulls, rejects writes, and reuses a clean session',async()=>{
    const q={text:'SELECT id,price,placed,big,note FROM orders WHERE placed >= $start AND placed <= CURRENT_TIMESTAMP',params:{start:'2026-11-01'},viewer:alice};
    expect((await my.query(q)).rows).toEqual([{id:1,price:12.34,placed:'2026-11-01T12:00:00',big:'9007199254740993',note:'tea'}]);
    expect((await my.query({text: "SELECT CAST('9876543210987654.3210' AS DECIMAL(24,4)) AS amount, CAST('0.1234567890123456789' AS DECIMAL(24,19)) AS fraction", params:{}, viewer:null})).rows).toEqual([{amount:'9876543210987654.3210',fraction:'0.1234567890123456789'}]);
    expect((await my.query({text:'SELECT price,note FROM orders WHERE id=$id',params:{id:2},viewer:bob})).rows).toEqual([{price:null,note:null}]);
    expect(await failure(my.query({text:'DELETE FROM orders',params:{},viewer:alice}))).toMatchObject({code:'read_only'});
    expect(await failure(my.query({text:'WITH x AS (SELECT 1) DELETE FROM orders',params:{},viewer:alice}))).toMatchObject({code:'read_only'});
    for (const viewer of [alice, bob, null]) {
      expect((await my.query({text:'SELECT @`app.viewer_id` AS id',params:{},viewer})).rows).toEqual([{id:viewer?.id ?? ''}]);
    }
    expect((await my.query(q)).rows).toHaveLength(1);
  });
});
