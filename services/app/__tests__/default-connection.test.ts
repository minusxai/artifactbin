/**
 * THE INSTALL'S DEFAULT CONNECTION through the real handlers (lib/connections): publish accepts `default:` links only
 * where the install has one; the page SQL door runs a statement naming one wholly on it, as the signed-in reader,
 * after the page's own access check; the agent doors and the settings rows. The database is a real Postgres engine on
 * a loopback socket (test-support pglite-wire), whose view keyed on `current_setting('app.viewer_id')` shows what the
 * database sees of each reader.
 */
import {htmlPageDeclarations} from '@/lib/html-page';
import {createGroup,removeGroupMember,setAccountPreferences,setGroupMember} from '@/lib/groups';
import net from 'node:net';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { SQL_FAILURES, type SqlFailureCode } from '@artifactbin/contracts/sql-failures';
import { startPgliteWire, type PgliteWire } from '@artifactbin/test-support/pglite-wire';
import { admitGroupMember, params, request, setSession, useAppHarness } from './harness';
import { person, publish, sql, type Person } from './page-sql-door-fixture';
import { overrideConfig } from '@/lib/platform/config';
import { closeDefaultConnection, validateDefaultConnection } from '@/lib/connections';
import { getArtifactById } from '@/lib/artifacts';
import { GET as statusGet } from '@/app/api/default-connection/route';
import { POST as pageSql } from '@/app/api/artifacts/[id]/sql/route';
import { POST as agentSql } from '@/app/api/default-connection/sql/route';
import { POST as testPost } from '@/app/api/default-connection/test/route';
import { GET as accountGet } from '@/app/api/page/account/route';

useAppHarness();
const PASSWORD = 'hunter2-default-secret';
let wire: PgliteWire, other: PgliteWire, setting: string;
// Both databases boot side by side (each a PGlite engine, the file's costliest step): the second is the named default
// `secondary` that 'routes named defaults independently' reads through.
beforeAll(async () => {
  [wire, other] = await Promise.all([startPgliteWire(`
    create schema sales;
    create table sales.orders(id int primary key, owner text not null, item text, amount int);
    create view sales.mine as select id, item from sales.orders where owner = current_setting('app.viewer_id', true);
    create table public.loose(n int); insert into public.loose values (7);
    create schema guarded; create table guarded.readers(id text primary key);
    create table guarded.many as select g from generate_series(1, 10001) g;
    create function guarded.shared_rows() returns table(id int, item text) language plpgsql stable as $$
    begin
      if not exists (select 1 from guarded.readers r where r.id = current_setting('app.viewer_id', true)) then
        raise exception 'orders are not shared with this reader' using errcode = 'insufficient_privilege';
      end if;
      return query select o.id, o.item from sales.orders o where o.owner = current_setting('app.viewer_id', true) order by o.id;
    end $$;
    create view guarded.shared as select * from guarded.shared_rows();`), startPgliteWire('create table public.marker(n int); insert into public.marker values (42)')]);
  setting = JSON.stringify({ connector: 'postgres', host: '127.0.0.1', port: wire.port, database: 'postgres', user: 'postgres', password: PASSWORD, tls: 'disable' });
});
afterAll(async () => { await closeDefaultConnection(); await Promise.all([wire?.close(), other?.close()]); });
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
  expect((await getArtifactById(page.body.id))!.meta.htmlLinks).toEqual(htmlPageDeclarations(PAGE()).connections);
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
  expect([anonymous.status, anonymous.body.error]).toEqual([403, 'sign_in_required']);
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

it('gives each kind of failed read its own code, the reader its sentence, and never a secret', async () => {
  const { alice } = await readers();
  const dave = await person('dave'), carol = await person('carol');
  await wire.db.query('delete from guarded.readers');
  await wire.db.query('insert into guarded.readers values ($1), ($2)', [alice.userId, dave.userId]);
  const page = (await publish(alice, { html: PAGE() })).body.id;
  const shared = 'select id, item from wh.guarded.shared order by id';
  // The database names its reader: rows for one, an answer with no rows for another, its refusal for a third.
  expect(ok(await sql(page, alice, shared)).rows).toEqual([{ id: 1, item: 'tea' }, { id: 3, item: 'pie' }]);
  expect(ok(await sql(page, dave, shared)).rows).toEqual([]);
  const refused = await sql(page, carol, shared);
  expect([refused.status, refused.body]).toEqual([403, { error: 'permission_denied', message: 'orders are not shared with this reader', notice: SQL_FAILURES.permission_denied.notice }]);
  const kinds: Array<[Person | null, string, number, string]> = [
    [null, shared, 403, 'sign_in_required'],
    [alice, 'select * from wh.sales.nowhere', 404, 'dataset_not_found'],
    [alice, 'select * from wh.sales.orders where', 400, 'validation_failed'],
  ];
  for (const [who, text, status, code] of kinds) {
    const reply = await sql(page, who, text);
    expect([reply.status, reply.body.error, (reply.body as { notice?: string }).notice], text).toEqual([status, code, (SQL_FAILURES[code as SqlFailureCode] as { notice?: string }).notice]);
  }
  // Cut at the row limit: a partial answer, marked, not a failure.
  const cut = await sql(page, alice, 'select g from wh.guarded.many');
  expect([cut.status, cut.body.rows?.length, (cut.body as { truncated?: boolean }).truncated]).toEqual([200, 10_000, true]);
  // The database down: unavailable, not "not found", and the setting's secret is nowhere in it.
  const probe = net.createServer(); await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const closed = (probe.address() as net.AddressInfo).port; await new Promise((resolve) => probe.close(resolve));
  configure(JSON.stringify({ ...JSON.parse(setting), port: closed }));
  const down = await sql(page, alice, shared);
  expect([down.status, down.body.error, (down.body as { notice?: string }).notice]).toEqual([503, 'unavailable', SQL_FAILURES.unavailable.notice]);
  expect(JSON.stringify(down.body)).not.toContain(PASSWORD);
  expect(JSON.stringify(refused.body)).not.toContain(PASSWORD);
  await closeDefaultConnection();
});

const agent = async (who: Person | null, body: unknown) => { const r = await agentSql(request('/api/default-connection/sql', { method: 'POST', json: body, ...(who ? { token: who.token } : {}) })); return { status: r.status, body: await r.json() as Record<string, unknown> }; };
it('lets an agent read its schema and query it as its account, never anonymously', async () => {
  const { alice } = await readers();
  const schema = await agent(alice, { namespace: 'warehouse/finance' });
  expect(schema.status).toBe(200);
  const tables = schema.body as { connector: string; tables: { namespace: string; name: string; kind: string }[] };
  expect([tables.connector, tables.tables.filter((t) => t.namespace === 'sales').map((t) => [t.name, t.kind])]).toEqual(['postgres', [['mine', 'view'], ['orders', 'table']]]);
  expect(ok(await agent(alice, { sql: 'select id from sales.mine order by id', namespace: 'warehouse/finance' })).rows).toEqual([{ id: 1 }, { id: 3 }]);
  expect(ok(await agent(alice, { sql: 'select item from sales.orders where id = $id', params: { id: 2 } })).rows).toEqual([{ item: 'cake' }]);
  expect((await agent(alice, { sql: 'drop table sales.orders' })).body.error).toBe('permission_denied');
  expect((await agent(null, { sql: 'select 1' })).status).toBe(401);
  expect((await agent(null, {})).status).toBe(401);
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


it('routes named defaults independently, preserving the viewer, namespace and one-source rule', async () => {
  const {alice,bob}=await readers();
  try {
    configure(JSON.stringify({default:JSON.parse(setting),connections:{secondary:{...JSON.parse(setting),port:other.port}}}));
    validateDefaultConnection();
    expect(ok(await agent(alice,{sql:'select n from marker',namespace:'secondary:analytics/team'})).rows).toEqual([{n:42}]);
    expect(ok(await agent(bob,{sql:'select id from sales.mine',namespace:'warehouse/finance'})).rows).toEqual([{id:2}]);
    const page=(await publish(alice,{html:PAGE('<link rel="af-dataset" data-af-name="other" href="default:secondary:analytics/team">')})).body.id;
    expect(ok(await sql(page,alice,'select n from other.marker')).rows).toEqual([{n:42}]);
    expect((await sql(page,alice,'select * from other.marker, wh.sales.mine')).status).toBe(400);
    expect((await sql(page,null,'select n from other.marker')).status).toBe(403);
    const schema=await agent(alice,{namespace:'secondary:analytics/team'});
    expect(schema.status).toBe(200);
    expect(schema.body.tables).toEqual(expect.arrayContaining([expect.objectContaining({name:'marker'})]));
    const status=JSON.stringify(await (await statusGet(request('/api/default-connection',{token:alice.token}))).json());
    expect(status).toContain('secondary');expect(status).not.toContain(PASSWORD);
  } finally {await closeDefaultConnection();}
});

it('validates every named default without exposing a secret or accepting an unconfigured alias', async () => {
  const {alice}=await readers();
  for (const connections of [null, [], { 'Bad alias': JSON.parse(setting) }, Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`c${i}`, JSON.parse(setting)])), { secondary: { ...JSON.parse(setting), password: PASSWORD, connector: 'missing' } }]) {
    configure(JSON.stringify({default:JSON.parse(setting),connections}));
    let message='';try{validateDefaultConnection();}catch(e){message=String((e as Error).message);}
    expect(message).toContain('DATASETS__DEFAULT_CONNECTION');expect(message).not.toContain(PASSWORD);
  }
  configure(JSON.stringify({default:JSON.parse(setting),connections:{secondary:JSON.parse(setting)}}));
  const denied=await agent(alice,{sql:'select 1',namespace:'missing:db'});
  expect(denied.status).toBe(400);
});

it('isolates pooled page reads and schema by group and leaves an ordinary sibling alias alone', async () => {
  const {alice, bob} = await readers();
  const first = await createGroup(alice.userId!,{handle:'first_team',name:'First'});
  const parent = await createGroup(alice.userId!,{handle:'parent_team',name:'Parent'});
  const second = await createGroup(alice.userId!,{handle:'second_team',name:'Second',parent_id:parent.id});
  overrideConfig({}, {DATASETS__ALLOW_PRIVATE_NETWORK:'1',DATASETS__GROUP_SCOPED_CONNECTIONS:'gateway',
    DATASETS__DEFAULT_CONNECTION:JSON.stringify({default:JSON.parse(setting),connections:{gateway:JSON.parse(setting)}})});
  const html = PAGE().replace('default:warehouse/finance','default:gateway:warehouse');
  const personal = (await publish(alice,{html})).body.id;
  const team = (await publish(alice,{html,destination:{type:'group',id:second.id},visibility:'unlisted'})).body.id;
  await setAccountPreferences(alice.userId!,{type:'group',id:first.id});
  const start = wire.databases.length;
  const read = 'select * from wh.public.loose';
  expect((await sql(personal,alice,read)).body).toMatchObject({viewing_as:{id:first.id,name:'First'}});
  expect((await sql(team,alice,read)).body).toMatchObject({viewing_as:{id:second.id,name:'Second'}});
  expect((await sql(personal,alice,read)).status).toBe(200);
  expect((await sql(personal,bob,read)).status).toBe(403);
  expect((await sql(personal,bob,'select * from raw.public.loose')).status).toBe(200);
  expect(wire.databases.slice(start)).toEqual(['warehouse/'+first.id,'warehouse/'+second.id,'postgres']);
  await admitGroupMember(alice.userId!,first.id,bob.userId!,'member');
  expect((await sql(team,bob,read)).body).toMatchObject({viewing_as:{id:first.id}});
  await admitGroupMember(alice.userId!,parent.id,bob.userId!,'admin');
  expect((await sql(team,bob,read)).body).toMatchObject({viewing_as:{id:second.id}});
  const wireMessage = 'group_access_denied: '+JSON.stringify({reason:'table unavailable',eligible_group_ids:[second.id,'unknown']});
  await wire.db.query('CREATE TABLE public.refusals(message text)');
  await wire.db.query('INSERT INTO public.refusals VALUES ($1)',[wireMessage]);
  await wire.db.exec(`CREATE FUNCTION public.refuse() RETURNS int LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION '%' , (SELECT message FROM public.refusals) USING ERRCODE='42501'; END $$`);
  const refused = await sql(personal,bob,'select wh.public.refuse()');
  expect(refused.status).toBe(403);
  expect(refused.body).toMatchObject({viewing_as:{id:first.id},eligible_group_ids:[second.id],eligible_groups:[{id:second.id,name:'Second'}]});
  await wire.db.query('UPDATE public.refusals SET message=$1',['viewer_refused: there is no postgres connection warehouse']);
  const missing = await sql(personal,bob,'select wh.public.refuse()');
  expect(missing.body).toMatchObject({error:'permission_denied',page_message:'there is no postgres connection warehouse'});
  const switched = () => pageSql(request('/api/artifacts/'+personal+'/sql',{method:'POST',token:bob.token,
    json:{sql:read,revision:'1',reader_scope_user:bob.userId,reader_group_id:second.id}}),params(personal));
  expect(await (await switched()).json()).toMatchObject({viewing_as:{id:second.id},rows:[{n:7}]});
  const privatePage = (await publish(alice,{html,visibility:'private',destination:{type:'personal'}})).body.id;
  expect((await sql(privatePage,bob,read)).status).toBe(404);
  await setGroupMember(alice.userId!,parent.id,bob.userId!,'editor');
  expect((await switched()).status).toBe(403);
  expect((await sql(team,bob,read)).body).toMatchObject({viewing_as:{id:first.id}});
  const schema = await agentSql(request('/api/default-connection/sql',{method:'POST',token:alice.token,json:{namespace:'gateway:catalog'}}));
  expect(schema.status).toBe(200);
  expect(wire.databases.at(-1)).toBe('catalog/'+first.id);
});

it('requests a pinned group on a readable third-group page before either read reaches the connector', async () => {
  const {alice, bob} = await readers();
  const a = await createGroup(alice.userId!, {handle:'analytics', name:'Analytics'});
  const parent = await createGroup(alice.userId!, {handle:'parent_team', name:'Parent'});
  const b = await createGroup(alice.userId!, {handle:'operations', name:'Operations', parent_id:parent.id});
  const c = await createGroup(alice.userId!, {handle:'publishing', name:'Publishing'});
  await admitGroupMember(alice.userId!, a.id, bob.userId!, 'member');
  await admitGroupMember(alice.userId!, parent.id, bob.userId!, 'admin');
  overrideConfig({}, {DATASETS__ALLOW_PRIVATE_NETWORK:'1', DATASETS__GROUP_SCOPED_CONNECTIONS:'@default', DATASETS__DEFAULT_CONNECTION:setting});
  const statement = 'select n from wh.public.loose';
  const html = PAGE('<script type="application/sql" data-af-query="counted" data-af-dataset="wh">select 7 as n</script>')
    .replace('warehouse/finance','warehouse/operations');
  const page = (await publish(alice,{html,destination:{type:'group',id:c.id},visibility:'unlisted'})).body.id;
  const read = async (call: Record<string,string>, group?: string) => {
    const response = await pageSql(request('/api/artifacts/'+page+'/sql',{method:'POST',token:bob.token,
      json:{...call, revision:'1', reader_scope_user:bob.userId, reader_group_id:group}}),params(page));
    return {status:response.status,body:await response.json()};
  };
  const calls = [{sql:statement}, {query:'counted'}] as Record<string,string>[];
  const start = wire.databases.length;
  for (const call of calls) {
    const denied = await read(call);
    expect(denied).toMatchObject({status:403,body:{reader_id:bob.userId,viewing_as:{id:a.id},required_group:{id:b.id,name:'Operations'}}});
    expect(denied.body).not.toHaveProperty('eligible_group_ids');
  }
  expect(wire.databases.length).toBe(start);
  for (const call of calls) expect(await read(call,b.id)).toMatchObject({status:200,body:{reader_id:bob.userId,viewing_as:{id:b.id},rows:[{n:7}]}});
  expect(wire.databases.slice(start)).toEqual(['warehouse/'+b.id]);
  // Even an administered pin can be denied by the database after selection.
  const policy = await read({sql:'select * from wh.guarded.shared'},b.id);
  expect(policy).toMatchObject({status:403,body:{error:'permission_denied',viewing_as:{id:b.id}}});
  expect(policy.body).not.toHaveProperty('required_group');
  await removeGroupMember(alice.userId!,parent.id,bob.userId!);
  for (const call of calls) {
    expect((await read(call,b.id)).status).toBe(403);
    const refusal = await read(call);
    expect(refusal.status).toBe(403);
    expect(refusal.body).not.toHaveProperty('required_group');
    expect(JSON.stringify(refusal.body)).not.toContain(b.id);
  }
});
