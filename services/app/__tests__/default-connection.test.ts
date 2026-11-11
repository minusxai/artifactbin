/**
 * THE INSTALL'S DEFAULT CONNECTION through the real handlers (lib/connections): publish accepts `default:` links only
 * where the install has one; the page SQL door runs a statement naming one wholly on it, as the signed-in reader,
 * after the page's own access check; the agent doors and the settings rows. The database is a real Postgres engine on
 * a loopback socket (test-support pglite-wire), whose view keyed on `current_setting('app.viewer_id')` shows what the
 * database sees of each reader.
 */
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { startPgliteWire, type PgliteWire } from '@artifactbin/test-support/pglite-wire';
import { request, setSession, useAppHarness } from './harness';
import { person, publish, sql, type Person } from './page-sql-door-fixture';
import { overrideConfig } from '@/lib/platform/config';
import { closeDefaultConnection, validateDefaultConnection } from '@/lib/connections';
import { getArtifactById } from '@/lib/artifacts';
import { GET as statusGet } from '@/app/api/default-connection/route';
import { GET as schemaGet } from '@/app/api/default-connection/schema/route';
import { POST as agentSql } from '@/app/api/default-connection/sql/route';
import { POST as testPost } from '@/app/api/default-connection/test/route';
import { GET as accountGet } from '@/app/api/page/account/route';

useAppHarness();
const PASSWORD = 'hunter2-default-secret';
let wire: PgliteWire, setting: string;
beforeAll(async () => {
  wire = await startPgliteWire(`
    create schema sales;
    create table sales.orders(id int primary key, owner text not null, item text, amount int);
    create view sales.mine as select id, item from sales.orders where owner = current_setting('app.viewer_id', true);
    create table public.loose(n int); insert into public.loose values (7);`);
  setting = JSON.stringify({ connector: 'postgres', host: '127.0.0.1', port: wire.port, database: 'postgres', user: 'postgres', password: PASSWORD, tls: 'disable' });
});
afterAll(async () => { await closeDefaultConnection(); await wire?.close(); });
const configure = (value: string | null = setting) => overrideConfig({}, { DATASETS__DEFAULT_CONNECTION: value ?? undefined, DATASETS__ALLOW_PRIVATE_NETWORK: '1' });
beforeEach(() => { setSession(null); configure(); });

// `wh` opens the database `warehouse/finance` (PGlite answers any name with its one database); `raw` the configured one.
const PAGE = (extra = '') => `<html><head><link rel="af-dataset" data-af-name="wh" href="default:warehouse/finance"><link rel="af-dataset" data-af-name="raw" href="default:">${extra}</head><body>Orders</body></html>`;
async function readers() {
  const alice = await person('alice'), bob = await person('bob');
  await wire.db.query('delete from sales.orders');
  await wire.db.query("insert into sales.orders values (1,$1,'tea',4),(2,$2,'cake',12),(3,$1,'pie',30)", [alice.userId, bob.userId]);
  return { alice, bob };
}
const ok = (reply: { status: number; body: unknown }) => { expect(reply.status, JSON.stringify(reply.body)).toBe(200); return reply.body as { rows: Record<string, unknown>[]; columns: unknown[] }; };

it('publish refuses a default: link where the install has none, and records it where it has one', async () => {
  const { alice } = await readers();
  configure(null);
  const refused = await publish(alice, { html: PAGE() });
  expect(refused.status).toBe(400);
  expect(refused.body).toMatchObject({ error: 'default_connection_not_configured' });
  configure();
  const page = await publish(alice, { html: PAGE() });
  expect(page.status, JSON.stringify(page.body)).toBe(201);
  expect((await getArtifactById(page.body.id))!.meta.htmlLinks).toEqual([{ kind: 'default-connection', name: 'wh', namespace: 'warehouse/finance' }, { kind: 'default-connection', name: 'raw', namespace: '' }]);
  for (const bad of ['default:sa;les', 'default:a b', `default:x'`]) expect((await publish(alice, { html: PAGE().replace('default:warehouse/finance', bad) })).status, bad).toBe(400);
  expect((await publish(alice, { html: PAGE().replace('href="default:warehouse/finance"', 'href="default:warehouse/finance" data-af-mode="pinned" data-af-revision="1"') })).status).toBe(400);
});

it('runs a statement naming the link on the connection, as each signed-in reader', async () => {
  const { alice, bob } = await readers();
  const page = (await publish(alice, { html: PAGE() })).body.id;
  // The database decides what each reader sees, from the viewer value set in the query's own transaction.
  expect(ok(await sql(page, alice, 'select id, item from wh.sales.mine order by id')).rows).toEqual([{ id: 1, item: 'tea' }, { id: 3, item: 'pie' }]);
  expect(ok(await sql(page, bob, 'select id, item from wh.sales.mine order by id')).rows).toEqual([{ id: 2, item: 'cake' }]);
  // `raw` names no namespace: its qualifier is removed and the connection's default schema answers.
  expect(ok(await sql(page, bob, 'select n from raw.loose')).rows).toEqual([{ n: 7 }]);
  // Values are bound, never text; a link name inside a literal is text.
  expect(ok(await sql(page, alice, 'select count(*) as n, $p0 as echo from wh.sales.orders where item = $p0', { p0: "tea' or '1'='1" })).rows).toEqual([{ n: 0, echo: "tea' or '1'='1" }]);
  expect(ok(await sql(page, alice, "select 'wh.sales.orders' as label from wh.sales.orders where id = $p0", { p0: 1 })).rows).toEqual([{ label: 'wh.sales.orders' }]);
  // Two default links of different databases are two sources.
  const two = await sql(page, alice, 'select * from wh.sales.orders, raw.loose');
  expect([two.status, two.body.message]).toEqual([400, 'a statement reads one database: wh is default:warehouse/finance, raw is default:; query them separately']);
  const typed = ok(await sql(page, alice, 'select id, amount from wh.sales.orders where id = $p0', { p0: 3 }));
  expect(typed.columns).toEqual([{ name: 'id', type: 'number' }, { name: 'amount', type: 'number' }]);
});

it('refuses anonymous readers, writes, a mix with a stored dataset, and keeps the page access check', async () => {
  const { alice, bob } = await readers();
  const stored = await publish(alice, { dataset: [{ x: 1 }], title: 'Stored' });
  const page = (await publish(alice, { html: PAGE(`<link rel="af-dataset" data-af-name="kept" href="ref:${stored.body.id}">`) })).body.id;
  const anonymous = await sql(page, null, 'select id from wh.sales.orders');
  expect([anonymous.status, anonymous.body.error]).toEqual([403, 'permission_denied']);
  for (const text of ['insert into wh.sales.orders values (9, $p0, $p0, 1)', 'delete from wh.sales.orders', "with w as (delete from wh.sales.orders returning 1) select * from w", "select set_config('app.viewer_id', $p0, false) from wh.sales.orders"]) {
    const write = await sql(page, alice, text, { p0: bob.userId });
    expect([write.status, write.body.error], text).toEqual([403, 'permission_denied']);
  }
  expect((await wire.db.query<{ n: number }>('select count(*)::int as n from sales.orders')).rows[0]!.n).toBe(3);
  const mixed = await sql(page, alice, 'select * from wh.sales.orders, kept');
  expect([mixed.status, mixed.body.error, mixed.body.message]).toEqual([400, 'validation_failed', "a statement reads one source: wh is the install's default connection and kept a stored dataset; query them separately"]);
  // A statement naming no default link is the stored datasets' as before.
  expect(ok(await sql(page, alice, 'select x from kept')).rows).toEqual([{ x: 1 }]);
  // A reader who cannot read the page gets the uniform 404 before any statement is judged.
  const secret = (await publish(alice, { html: PAGE(), visibility: 'private' })).body.id;
  const outsider = await sql(secret, bob, 'select id from wh.sales.mine');
  expect([outsider.status, outsider.body.error]).toEqual([404, 'not_found']);
});

it('answers a page whose install lost its connection with a clear refusal', async () => {
  const { alice } = await readers();
  const page = (await publish(alice, { html: PAGE() })).body.id;
  configure(null);
  const reply = await sql(page, alice, 'select id from wh.sales.orders');
  expect([reply.status, reply.body.error, reply.body.message]).toEqual([404, 'dataset_not_found', "wh reads the install's default connection, and this install has none"]);
});

const agent = async (who: Person | null, body: unknown) => { const r = await agentSql(request('/api/default-connection/sql', { method: 'POST', json: body, ...(who ? { token: who.token } : {}) })); return { status: r.status, body: await r.json() as Record<string, unknown> }; };
it('lets an agent read its schema and query it as its account, never anonymously', async () => {
  const { alice } = await readers();
  const schema = await schemaGet(request('/api/default-connection/schema?namespace=warehouse%2Ffinance', { token: alice.token }));
  expect(schema.status).toBe(200);
  const tables = (await schema.json() as { connector: string; tables: { name: string; kind: string }[] });
  expect([tables.connector, tables.tables.filter((t) => t.namespace === 'sales').map((t) => [t.name, t.kind])]).toEqual(['postgres', [['mine', 'view'], ['orders', 'table']]]);
  expect(ok(await agent(alice, { sql: 'select id from sales.mine order by id', namespace: 'warehouse/finance' })).rows).toEqual([{ id: 1 }, { id: 3 }]);
  expect(ok(await agent(alice, { sql: 'select item from sales.orders where id = $id', params: { id: 2 } })).rows).toEqual([{ item: 'cake' }]);
  expect((await agent(alice, { sql: 'drop table sales.orders' })).body.error).toBe('permission_denied');
  expect((await agent(null, { sql: 'select 1' })).status).toBe(401);
  expect((await schemaGet(request('/api/default-connection/schema'))).status).toBe(401);
});

it('shows the settings row without the secret, and tests the connection for signed-in sessions only, within the allowance', async () => {
  const { alice } = await readers();
  const status = await statusGet(request('/api/default-connection', { token: alice.token }));
  const text = await status.text();
  expect(JSON.parse(text)).toEqual({ configured: true, connector: 'postgres', label: 'PostgreSQL', fields: { host: '127.0.0.1', port: wire.port, database: 'postgres' } });
  expect(text).not.toContain(PASSWORD);
  expect((await statusGet(request('/api/default-connection'))).status).toBe(401);
  // Test connection: a browser session, same-site.
  expect((await testPost(request('/api/default-connection/test', { method: 'POST', token: alice.token, origin: 'same' }))).status).toBe(401);
  setSession({ user: { id: alice.userId!, email: alice.email! } } as never);
  const tested = await testPost(request('/api/default-connection/test', { method: 'POST', origin: 'same' }));
  expect(await tested.json()).toMatchObject({ ok: true });
  let limited = 0;
  for (let i = 0; i < 31; i++) if ((await testPost(request('/api/default-connection/test', { method: 'POST', origin: 'same' }))).status === 429) limited++;
  expect(limited).toBeGreaterThan(0);
  const account = await (await accountGet(request('/api/page/account'))).text();
  expect(account).not.toContain(PASSWORD);
  configure(null);
  expect(await (await statusGet(request('/api/default-connection', { token: alice.token }))).json()).toEqual({ configured: false });
});

it('stops the boot on a bad value, naming the setting and never the value', () => {
  for (const value of [`{"connector":"postgres","password":"${PASSWORD}"`, JSON.stringify({ connector: 'postgres', host: 'h', database: 'd', user: 'u', password: PASSWORD, extra: PASSWORD }), JSON.stringify({ connector: 'postgres', host: '169.254.169.254', database: 'd', user: 'u', password: PASSWORD })]) {
    configure(value);
    let message = '';
    try { validateDefaultConnection(); } catch (e) { message = (e as Error).message; }
    expect(message, value).toMatch(/^DATASETS__DEFAULT_CONNECTION is not a valid connection: /);
    expect(message).not.toContain(PASSWORD);
  }
  overrideConfig({}, { DATASETS__ALLOW_PRIVATE_NETWORK: 'yes' });
  expect(() => validateDefaultConnection()).toThrow('DATASETS__ALLOW_PRIVATE_NETWORK must be 0 (the default) or 1.');
});
