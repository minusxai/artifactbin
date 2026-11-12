/**
 * LIVE DATASETS through the real handlers (lib/live-datasets): a dataset whose content is a database connection,
 * created through the ordinary create door, its secret sealed and never answered, changed only by its owner and
 * editors (a moved host needs the secret again); free SQL for owners and editors, declared queries for everyone a rule
 * admits, the viewer's values bound by the server; publish refusing a declared query from someone who cannot edit the
 * dataset; and every stored-dataset door refusing it by name. The database is a real Postgres engine on a loopback
 * socket (test-support pglite-wire); its tables key rows on the reader's email, so what each reader gets back is what
 * the bound `:viewer_email` selected.
 */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import * as connectors from '@artifactbin/connectors';
import { setUsername } from '@/lib/accounts';
import { createAppServer } from '@/server/app';
import { startPgliteWire, type PgliteWire } from '@artifactbin/test-support/pglite-wire';
import { admitGroupMember, request, setSession, useAppHarness } from './harness';
import { createGroup } from '@/lib/groups';
import { params, person, publish, sql, type Person } from './page-sql-door-fixture';
import { overrideConfig } from '@/lib/platform/config';
import { getDb, TABLES } from '@/lib/platform';
import { getArtifactById, updateSharingFor } from '@/lib/artifacts';
import { writeDatasetPermissions } from '@/lib/dataset-access';
import { createArtifactFromBody, forkArtifact, replaceArtifactWithBody } from '@/lib/publish';
import { closeLiveDatasetConnections, setLiveDatasetNetworkSeams } from '@/lib/live-datasets';
import { GET as connectionGet, PATCH as connectionPatch } from '@/app/api/artifacts/[id]/connection/route';
import { POST as connectionTest } from '@/app/api/artifacts/[id]/connection/test/route';
import { GET as schemaGet } from '@/app/api/artifacts/[id]/connection/schema/route';
import { GET as connectorsGet } from '@/app/api/connections/route';
import { POST as configTest } from '@/app/api/connections/test/route';
import { POST as queryPost } from '@/app/api/artifacts/[id]/query/route';
import { POST as mutatePost } from '@/app/api/artifacts/[id]/mutate/route';
import { GET as contentGet } from '@/app/api/artifacts/[id]/content/route';
import { GET as artifactGet } from '@/app/api/artifacts/[id]/route';
import { POST as sqlPost } from '@/app/api/artifacts/[id]/sql/route';

useAppHarness();
const PASSWORD = 'hunter2-live-secret-Zq9';
let wire: PgliteWire;
beforeAll(async () => {
  wire = await startPgliteWire(`
    create schema sales;
    create table sales.orders(id int primary key, owner_email text not null, item text, amount int);
    create table public.loose(n int); insert into public.loose values (7);`);
});
afterAll(async () => { setLiveDatasetNetworkSeams(undefined); await closeLiveDatasetConnections(); await wire?.close(); });
const allowPrivate = (on: boolean) => overrideConfig({}, { DATASETS__ALLOW_PRIVATE_NETWORK: on ? '1' : undefined });
beforeEach(() => { setSession(null); allowPrivate(true); setLiveDatasetNetworkSeams(undefined); });

const config = (extra: Record<string, unknown> = {}) => ({ connector: 'postgres', host: '127.0.0.1', port: wire.port, database: 'postgres', user: 'postgres', password: PASSWORD, tls: 'disable', ...extra });
const ok = (reply: { status: number; body: unknown }) => { expect(reply.status, JSON.stringify(reply.body)).toBe(200); return reply.body as { rows: Record<string, unknown>[]; columns: unknown[]; truncated?: boolean }; };
const answer = async (response: Response) => ({ status: response.status, body: await response.json() as Record<string, any>, text: '' });
async function call(handler: (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>, path: string, id: string, who: Person | null, init: { method?: string; json?: unknown } = {}) {
  const response = await handler(request(path, { ...init, ...(who ? { token: who.token } : {}) }), params(id));
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as Record<string, any>, text };
}
/** One request to the page SQL door with any body (a declared query is `{query, params}`). */
async function door(page: string, who: Person | null, body: Record<string, unknown>) {
  return call(sqlPost as never, `/api/artifacts/${page}/sql`, page, who, { method: 'POST', json: { revision: '1', params: {}, ...body } });
}
const createLive = (owner: Person, extra: Record<string, unknown> = {}) => publish(owner, { connection: config(), title: 'Shop', ...extra });
const SCRIPT = (name: string, link: string, text: string) => `<script type="application/sql" data-af-query="${name}" data-af-dataset="${link}">${text}</script>`;
const PAGE = (id: string, extra = '') => `<html><head><link rel="af-dataset" data-af-name="shop" href="ref:${id}">${extra}</head><body>Orders</body></html>`;
const MINE = SCRIPT('mine', 'shop', 'select id, item from sales.orders where owner_email = :viewer_email and amount >= :min order by id');
const RULE = (...roles: string[]) => ({ version: 3, tables: [{ table: { schema: 'public', name: 'queries' }, select_permissions: roles.map((role) => ({ role, permission: { columns: '*', filter: {} } })) }] });
async function setRule(owner: Person, id: string, ...roles: string[]) {
  const row = await getArtifactById(id);
  const saved = await writeDatasetPermissions(owner.actor, id, { policy: RULE(...roles), expectedPolicyRevision: row!.policy_revision ?? 0 });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
}
async function people() {
  const alice = await person('alice'), bob = await person('bob'), carol = await person('carol');
  await wire.db.query('delete from sales.orders');
  await wire.db.query("insert into sales.orders values (1,$1,'tea',4),(2,$2,'cake',12),(3,$1,'pie',30)", [alice.email, bob.email]);
  return { alice, bob, carol };
}
/** Every row of every app table, as text: where a secret must never be. */
async function everyStoredRow(): Promise<string> {
  const db = await getDb(), out: string[] = [];
  for (const table of TABLES) out.push(JSON.stringify((await db.query(`SELECT * FROM ${table.name}`)).rows));
  return out.join('\n');
}

it('creates a live dataset through the create door: a dataset with the connection summary, its secret sealed and answered nowhere', async () => {
  const { alice, bob } = await people();
  const created = await call(((r: Request) => import('@/app/api/artifacts/route').then((m) => m.POST(r))) as never, '/api/artifacts', '', alice, { method: 'POST', json: { connection: config(), title: 'Shop' } });
  expect(created.status, created.text).toBe(201);
  const id = created.body.id as string;
  const row = (await getArtifactById(id))!;
  expect([row.format, row.meta.connection, row.meta.catalog, row.dataset_policy]).toEqual(['dataset', { connector: 'postgres', label: 'PostgreSQL', fields: { host: '127.0.0.1', port: wire.port, database: 'postgres' } }, undefined, null]);
  const stored = (await (await getDb()).query<{ config: Record<string, unknown>; sealed: string }>('SELECT config, sealed FROM dataset_connections WHERE dataset_id=$1', [id])).rows[0]!;
  expect(stored.config).toEqual({ connector: 'postgres', host: '127.0.0.1', port: wire.port, database: 'postgres', user: 'postgres', tls: 'disable' });
  expect(stored.sealed).toMatch(/^[A-Za-z0-9+/=]+$/);
  // The owner's view names the secret that is set, never its value; a reader the dataset is shared with sees the summary.
  const mine = await call(connectionGet as never, `/api/artifacts/${id}/connection`, id, alice);
  expect(mine.body).toMatchObject({ role: 'owner', config: stored.config, secrets: ['password'], declaredQueryRoles: [], pages: [] });
  await updateSharingFor(alice.actor, id, { shares: [{ email: bob.email!, role: 'viewer' }] });
  const theirs = await call(connectionGet as never, `/api/artifacts/${id}/connection`, id, bob);
  expect(theirs.body).toMatchObject({ role: 'viewer', connection: row.meta.connection });
  expect(theirs.body).not.toHaveProperty('config');
  // Everywhere an answer or a stored row could carry it: nowhere.
  const answers = [created.text, mine.text, theirs.text, (await call(artifactGet as never, `/api/artifacts/${id}`, id, alice)).text, (await call(contentGet as never, `/api/artifacts/${id}/content`, id, alice)).text];
  for (const text of answers) expect(text).not.toContain(PASSWORD);
  // The artifact read (what the dataset editor opens) carries the summary as its meta, and no rows.
  expect((await call(artifactGet as never, `/api/artifacts/${id}`, id, alice)).body).toMatchObject({ format: 'dataset', meta: { connection: row.meta.connection }, rows: [] });
  expect(await everyStoredRow()).not.toContain(PASSWORD);
  // The page lists it with the datasets.
  expect((await (await getDb()).query("SELECT count(*)::int AS n FROM artifacts WHERE format='dataset' AND id=$1", [id])).rows[0]).toEqual({ n: 1 });
  // A configuration the connector refuses, or one it cannot run yet, creates nothing.
  expect((await createLive(alice, { connection: { connector: 'postgres', host: '127.0.0.1' } })).status).toBe(400);
  const bigquery = await createLive(alice, { connection: { connector: 'bigquery', project: 'p', credentials: '{}' } });
  expect([bigquery.status, (bigquery.body as unknown as { error: string }).error]).toEqual([400, 'connector_unavailable']);
  expect((await createLive(alice, { connection: config(), dataset: [{ x: 1 }] })).status).toBe(400);
});

it('lets only its owner and editors change the connection, keeps an omitted secret, and demands it again when where it goes moves', async () => {
  const { alice, bob, carol } = await people();
  const id = (await createLive(alice)).body.id;
  await updateSharingFor(alice.actor, id, { shares: [{ email: bob.email!, role: 'editor' }, { email: carol.email!, role: 'viewer' }] });
  const patch = (who: Person, json: unknown) => call(connectionPatch as never, `/api/artifacts/${id}/connection`, id, who, { method: 'PATCH', json });
  expect((await patch(carol, { tls: 'disable' })).status).toBe(403);
  // No field moved: the stored password is kept and the dataset still answers.
  expect((await patch(bob, { tls: 'disable' })).status).toBe(200);
  // Any field the secret depends on, without the secret: refused, nothing changed.
  for (const moved of [{ host: 'localhost' }, { port: wire.port + 1 }, { database: 'other' }, { user: 'someone' }]) {
    const refused = await patch(bob, moved);
    expect([refused.status, refused.body.error], JSON.stringify(moved)).toEqual([400, 'secret_required']);
  }
  expect((await getArtifactById(id))!.meta.connection).toMatchObject({ fields: { host: '127.0.0.1' } });
  const moved = await patch(bob, { host: 'localhost', password: 'a-new-secret-Lk3' });
  expect(moved.status, moved.text).toBe(200);
  expect((await getArtifactById(id))!.meta.connection).toMatchObject({ fields: { host: 'localhost' } });
  expect(moved.text + (await call(connectionGet as never, `/api/artifacts/${id}/connection`, id, bob)).text).not.toMatch(/a-new-secret|hunter2/);
  expect(await everyStoredRow()).not.toContain('a-new-secret-Lk3');
  expect((await patch(bob, { connector: 'mysql' })).body.error).toBe('invalid_connection');
  // A connection changed under an open one: the next query uses the new one (an unreachable port fails, the old does not).
  expect((await patch(alice, { port: 1, password: PASSWORD })).status).toBe(200);
  const gone = await call(queryPost as never, `/api/artifacts/${id}/query`, id, alice, { method: 'POST', json: { sql: 'select 1 as one' } });
  expect(gone.status).toBe(503);
  // A sealed secret that no longer opens (AUTH__SECRET changed; here: another dataset's ciphertext) is never used and
  // never silently dropped: queries say why, and the next change must carry the secret.
  const other = (await createLive(alice)).body.id;
  await (await getDb()).query('UPDATE dataset_connections SET sealed = (SELECT sealed FROM dataset_connections WHERE dataset_id = $2) WHERE dataset_id = $1', [id, other]);
  await closeLiveDatasetConnections(); // a restart under a new AUTH__SECRET opens nothing it had
  const unsealed = await call(queryPost as never, `/api/artifacts/${id}/query`, id, alice, { method: 'POST', json: { sql: 'select 1 as one' } });
  expect([unsealed.status, unsealed.body.message]).toEqual([503, "the live dataset is unavailable: its stored secret no longer opens (this install's AUTH__SECRET changed): an owner or editor enters it again"]);
  expect((await patch(alice, { port: wire.port })).body.error).toBe('secret_required');
  expect((await patch(alice, { port: wire.port, password: PASSWORD })).status).toBe(200);
  expect((await call(queryPost as never, `/api/artifacts/${id}/query`, id, alice, { method: 'POST', json: { sql: 'select 1 as one' } })).status).toBe(200);
});

it('answers free SQL for owners and editors only, through the page and the agent door, on the dataset\'s connection', async () => {
  const { alice, bob, carol } = await people();
  const id = (await createLive(alice)).body.id;
  await updateSharingFor(alice.actor, id, { shares: [{ email: bob.email!, role: 'editor' }, { email: carol.email!, role: 'viewer' }] });
  await setRule(alice, id, 'viewer', 'signed_in');
  const page = (await publish(alice, { html: PAGE(id) })).body.id;
  const stored = (await getArtifactById(page))!.meta.htmlLinks as Array<{ kind: string; name: string; datasetId?: string }>;
  expect(stored.map((link) => [link.kind, link.name, link.datasetId])).toEqual([['live-dataset', 'shop', id]]);
  expect(ok(await sql(page, alice, 'select id, item from shop.sales.orders where amount > $p0 order by id', { p0: 10 })).rows).toEqual([{ id: 2, item: 'cake' }, { id: 3, item: 'pie' }]);
  expect(ok(await sql(page, bob, 'select n from shop.loose')).rows).toEqual([{ n: 7 }]);
  // The viewer's values are bound for free SQL too.
  expect(ok(await sql(page, alice, 'select :viewer_email as me, :viewer_id as id from shop.loose')).rows).toEqual([{ me: alice.email, id: alice.userId }]);
  // A reader, even one a rule admits to declared queries, never sends SQL text.
  for (const who of [carol, null]) {
    const refused = await sql(page, who, 'select * from shop.sales.orders');
    expect([refused.status, refused.body.error]).toEqual([403, 'permission_denied']);
  }
  const agent = (who: Person, json: unknown) => call(queryPost as never, `/api/artifacts/${id}/query`, id, who, { method: 'POST', json });
  expect((await agent(bob, { sql: 'select count(*)::int as n from sales.orders where amount > $min', values: { min: 5 } })).body.results[0]).toMatchObject({ columns: [{ name: 'n', type: 'number' }], rows: [{ n: 2 }] });
  expect((await agent(carol, { sql: 'select 1' })).status).toBe(403);
  // Read-only, one statement: the database is unchanged.
  for (const text of ['delete from sales.orders', "select set_config('app.viewer_email', 'x', false)"]) expect((await agent(alice, { sql: text })).status, text).toBe(403);
  expect((await agent(alice, { sql: 'select 1; delete from sales.orders' })).body.message).toBe('one statement at a time');
  expect((await wire.db.query<{ n: number }>('select count(*)::int as n from sales.orders')).rows[0]!.n).toBe(3);
  // Schema: owner and editors.
  const schema = await call(schemaGet as never, `/api/artifacts/${id}/connection/schema`, id, bob);
  expect(schema.body.tables.map((t: { namespace: string; name: string }) => `${t.namespace}.${t.name}`)).toEqual(expect.arrayContaining(['sales.orders', 'public.loose']));
  expect((await call(schemaGet as never, `/api/artifacts/${id}/connection/schema`, id, carol)).status).toBe(403);
});

it('runs a page\'s declared query for each reader its rules admit, with the server\'s viewer values, and nothing else', async () => {
  const { alice, bob, carol } = await people();
  const id = (await createLive(alice)).body.id;
  const page = (await publish(alice, { html: PAGE(id, MINE) })).body.id;
  expect((await getArtifactById(page))!.meta.htmlQueries).toEqual([{ name: 'mine', link: 'shop', sql: 'select id, item from sales.orders where owner_email = :viewer_email and amount >= :min order by id' }]);
  // No rule yet: only the owner (and editors) run it.
  expect(ok(await door(page, alice, { query: 'mine', params: { min: 0 } })).rows).toEqual([{ id: 1, item: 'tea' }, { id: 3, item: 'pie' }]);
  expect((await door(page, bob, { query: 'mine', params: { min: 0 } })).status).toBe(403);
  await setRule(alice, id, 'signed_in');
  // Two readers, one query, each their own rows: the server bound :viewer_email.
  expect(ok(await door(page, bob, { query: 'mine', params: { min: 0 } })).rows).toEqual([{ id: 2, item: 'cake' }]);
  expect(ok(await door(page, carol, { query: 'mine', params: { min: 0 } })).rows).toEqual([]);
  expect(ok(await door(page, alice, { query: 'mine', params: { min: 10 } })).rows).toEqual([{ id: 3, item: 'pie' }]);
  // The caller cannot name another person, send SQL with a name, or leave a parameter out.
  for (const name of ['viewer_email', 'viewer_id', 'viewer_groups']) {
    const forged = await door(page, bob, { query: 'mine', params: { min: 0, [name]: alice.email } });
    expect([forged.status, forged.body.error], name).toEqual([400, 'validation_failed']);
  }
  expect((await door(page, bob, { query: 'mine', sql: 'select 1', params: { min: 0 } })).status).toBe(400);
  expect((await door(page, bob, { query: 'mine' })).status).toBe(400);
  expect((await door(page, bob, { query: 'theirs', params: {} })).body.error).toBe('unknown_query');
  // Anonymous only when a rule says so, and then as nobody (null viewer values).
  expect((await door(page, null, { query: 'mine', params: { min: 0 } })).status).toBe(403);
  await setRule(alice, id, 'signed_in', 'anonymous');
  expect(ok(await door(page, null, { query: 'mine', params: { min: 0 } })).rows).toEqual([]);
  // The page's own access check stays first: a reader who cannot read the page gets the uniform 404.
  const hidden = (await publish(alice, { html: PAGE(id, MINE), visibility: 'private' })).body.id;
  expect((await door(hidden, bob, { query: 'mine', params: { min: 0 } })).status).toBe(404);
  // The dataset page shows the roles and the pages declaring queries.
  expect((await call(connectionGet as never, `/api/artifacts/${id}/connection`, id, alice)).body).toMatchObject({ declaredQueryRoles: ['signed_in', 'anonymous'], pages: expect.arrayContaining([{ id: page, title: null, queries: ['mine'] }]) });
});

it('runs the declared queries of the version a reader has open, never another page\'s or another version\'s', async () => {
  const { alice, bob } = await people();
  const id = (await createLive(alice)).body.id;
  await setRule(alice, id, 'signed_in');
  const page = (await publish(alice, { html: PAGE(id, SCRIPT('total', 'shop', 'select sum(amount)::int as total from sales.orders')) })).body.id;
  const other = (await publish(alice, { html: PAGE(id, SCRIPT('secret', 'shop', 'select owner_email from sales.orders')) })).body.id;
  const row = (await getArtifactById(page))!;
  const second = await replaceArtifactWithBody({ html: PAGE(id, SCRIPT('total', 'shop', 'select count(*)::int as total from sales.orders')), expectedVersion: row.version, expectedState: (await call(artifactGet as never, `/api/artifacts/${page}`, page, alice)).body.state }, alice.actor, page, 'http://localhost:3000');
  expect(second.status, await second.clone().text()).toBe(200);
  expect(ok(await door(page, bob, { query: 'total', revision: '1' })).rows).toEqual([{ total: 46 }]);
  expect(ok(await door(page, bob, { query: 'total', revision: '2' })).rows).toEqual([{ total: 3 }]);
  expect((await door(page, bob, { query: 'secret', revision: '2' })).body.error).toBe('unknown_query');
  expect(ok(await door(other, bob, { query: 'secret' })).rows).toHaveLength(3);
  expect((await door(page, bob, { query: 'total', revision: '3' })).status).toBe(404);
});

it('refuses a declared query from a publisher who cannot edit the live dataset, on a stored link, and a pinned live link', async () => {
  const { alice, bob } = await people();
  const id = (await createLive(alice)).body.id;
  await updateSharingFor(alice.actor, id, { shares: [{ email: bob.email!, role: 'viewer' }] });
  // Bob may read (and link) it, but not declare SQL on it.
  expect((await publish(bob, { html: PAGE(id) })).status).toBe(201);
  const refused = await publish(bob, { html: PAGE(id, MINE) });
  expect([refused.status, (refused.body as unknown as { error: string }).error]).toEqual([403, 'declared_query_not_permitted']);
  // Republishing someone else's page as its editor does not borrow the owner's right either.
  const page = (await publish(alice, { html: PAGE(id) })).body.id;
  await updateSharingFor(alice.actor, page, { shares: [{ email: bob.email!, role: 'editor' }] });
  const head = await call(artifactGet as never, `/api/artifacts/${page}`, page, bob);
  const replaced = await replaceArtifactWithBody({ html: PAGE(id, MINE), expectedVersion: head.body.version, expectedState: head.body.state }, bob.actor, page, 'http://localhost:3000');
  expect([replaced.status, (await replaced.json()).error]).toEqual([403, 'declared_query_not_permitted']);
  // A page editor not shared on the dataset republishes the owner's page that links it (no declared queries): the link
  // is the owner's to hold, as a stored dataset's is.
  const carol = await person('carol');
  const closed = (await createLive(alice, { visibility: 'private' })).body.id;
  const linking = (await publish(alice, { html: PAGE(closed) })).body.id;
  await updateSharingFor(alice.actor, linking, { shares: [{ email: carol.email!, role: 'editor' }] });
  const carolHead = await call(artifactGet as never, `/api/artifacts/${linking}`, linking, carol);
  const carolSave = await replaceArtifactWithBody({ html: PAGE(closed, '<title>v2</title>'), expectedVersion: carolHead.body.version, expectedState: carolHead.body.state }, carol.actor, linking, 'http://localhost:3000');
  expect(carolSave.status, await carolSave.clone().text()).toBe(200);
  // Nor does copying a page that declares one.
  const declared = (await publish(alice, { html: PAGE(id, MINE), visibility: 'unlisted' })).body.id;
  const fork = await forkArtifact(bob.actor, (await getArtifactById(declared))!, {});
  expect(fork instanceof Response ? [fork.status, (await fork.json()).error] : 'forked').toEqual([403, 'declared_query_not_permitted']);
  const stored = (await publish(alice, { dataset: [{ x: 1 }], title: 'Stored' })).body.id;
  const onStored = await publish(alice, { html: `<html><head><link rel="af-dataset" data-af-name="kept" href="ref:${stored}">${SCRIPT('q', 'kept', 'select 1')}</head><body></body></html>` });
  expect((onStored.body as unknown as { error: string }).error).toBe('invalid_declared_query');
  const huge = await publish(alice, { html: PAGE(id, SCRIPT('big', 'shop', `select '${'x'.repeat(64_001)}'`)) });
  expect((huge.body as unknown as { error: string }).error).toBe('invalid_declared_query');
  const pinned = await publish(alice, { html: PAGE(id).replace(`href="ref:${id}"`, `href="ref:${id}" data-af-mode="pinned" data-af-revision="1"`) });
  expect((pinned.body as unknown as { error: string }).error).toBe('live_dataset_not_pinnable');
});

it('reads one source per statement, within the common limits', async () => {
  const { alice } = await people();
  const id = (await createLive(alice)).body.id, two = (await createLive(alice)).body.id;
  const stored = (await publish(alice, { dataset: [{ x: 1 }], title: 'Stored' })).body.id;
  const page = (await publish(alice, { html: `<html><head><link rel="af-dataset" data-af-name="shop" href="ref:${id}"><link rel="af-dataset" data-af-name="crm" href="ref:${two}"><link rel="af-dataset" data-af-name="kept" href="ref:${stored}"></head><body></body></html>` })).body.id;
  for (const text of ['select * from shop.loose, kept', 'select * from shop.loose, crm.loose']) {
    const mixed = await sql(page, alice, text);
    expect([mixed.status, mixed.body.message?.startsWith('a statement reads one source')], text).toEqual([400, true]);
  }
  expect(ok(await sql(page, alice, 'select x from kept')).rows).toEqual([{ x: 1 }]);
  const bare = await sql(page, alice, 'select * from shop');
  expect([bare.status, bare.body.message]).toEqual([400, 'shop is a live dataset: name its tables as shop.table (or shop.schema.table)']);
  const many = ok(await sql(page, alice, 'select g from generate_series(1, 10005) g, shop.loose'));
  expect([many.rows.length, many.truncated]).toEqual([10000, true]);
  const big = await sql(page, alice, `select '${'x'.repeat(64_001)}' as big from shop.loose`);
  expect([big.status, big.body.message]).toEqual([400, 'a statement is at most 64000 bytes']);
});

it('applies the network rule to user connections: private addresses only where the install allows them, every resolved address judged', async () => {
  const { alice } = await people();
  allowPrivate(false);
  const loopback = await createLive(alice, { connection: config({ tls: 'verify-full' }) });
  expect([loopback.status, (loopback.body as unknown as { message: string }).message]).toEqual([400, 'the host is not a public address']);
  expect((await createLive(alice, { connection: config({ host: 'db.example.com' }) })).status).toBe(400); // tls disable
  // A name that resolves (now, or at the next session) to a private address is refused when the session opens.
  setLiveDatasetNetworkSeams({ lookup: async () => [{ address: '203.0.113.7', family: 4 }, { address: '10.0.0.5', family: 4 }] });
  const tested = await call(configTest as never, '/api/connections/test', '', alice, { method: 'POST', json: { connection: config({ host: 'db.example.com', tls: 'verify-full' }) } });
  expect(tested.body).toEqual({ ok: false, error: { code: 'forbidden_address', message: 'the host resolves to an address that is not public' } });
  // Allowed: the socket goes to the exact address judged (the name resolves to the bridge here).
  allowPrivate(true);
  setLiveDatasetNetworkSeams({ lookup: async () => [{ address: '127.0.0.1', family: 4 }] });
  const id = (await createLive(alice, { connection: config({ host: 'db.example.com' }) })).body.id;
  expect((await call(connectionTest as never, `/api/artifacts/${id}/connection/test`, id, alice, { method: 'POST' })).body).toMatchObject({ ok: true });
  // The name rebinding to the metadata address on a later session is refused, private network or not.
  await closeLiveDatasetConnections();
  setLiveDatasetNetworkSeams({ lookup: async () => [{ address: '169.254.169.254', family: 4 }] });
  const rebound = await call(queryPost as never, `/api/artifacts/${id}/query`, id, alice, { method: 'POST', json: { sql: 'select 1' } });
  expect([rebound.status, rebound.body.message]).toEqual([503, 'Shop is unavailable (forbidden_address): the host resolves to an address that is not public']);
});

it('rate-limits connection tests and answers them to owners and editors only', async () => {
  const { alice, bob } = await people();
  const id = (await createLive(alice)).body.id;
  await updateSharingFor(alice.actor, id, { shares: [{ email: bob.email!, role: 'viewer' }] });
  expect((await call(connectionTest as never, `/api/artifacts/${id}/connection/test`, id, bob, { method: 'POST' })).status).toBe(403);
  expect((await call(configTest as never, '/api/connections/test', '', null, { method: 'POST', json: { connection: config() } })).status).toBe(401);
  let limited = 0;
  for (let i = 0; i < 31; i++) if ((await call(connectionTest as never, `/api/artifacts/${id}/connection/test`, id, alice, { method: 'POST' })).status === 429) limited++;
  expect(limited).toBeGreaterThan(0);
  const list = await connectorsGet();
  const connectors = (await list.json()).connectors as Array<{ id: string; available: boolean; group: string }>;
  expect(connectors.map((c) => [c.id, c.available, c.group])).toEqual([['postgres', true, 'live'], ['mysql', true, 'live'], ['bigquery', false, 'live']]);
});

it('keeps a live dataset\'s rules to "who may run declared queries", and every stored-dataset door refuses it by name', async () => {
  const { alice } = await people();
  const id = (await createLive(alice)).body.id;
  const row = (await getArtifactById(id))!;
  for (const policy of [
    { version: 3, tables: [{ table: { schema: 'public', name: 'queries' }, select_permissions: [], insert_permissions: [{ role: 'viewer', permission: { columns: '*', check: {} } }] }] },
    { version: 3, tables: [{ table: { schema: 'public', name: 'queries' }, select_permissions: [{ role: 'viewer', permission: { columns: '*', filter: { x: { _eq: 1 } } } }] }] },
    { version: 3, tables: [{ table: { schema: 'public', name: 'rows' }, select_permissions: [{ role: 'viewer', permission: { columns: '*', filter: {} } }] }] },
  ]) expect((await writeDatasetPermissions(alice.actor, id, { policy, expectedPolicyRevision: row.policy_revision ?? 0 })).status, JSON.stringify(policy)).toBe(400);
  const refusedBy = async (response: Promise<Response>) => { const r = await answer(await response); return [r.status, r.body.error]; };
  expect(await refusedBy(contentGet(request(`/api/artifacts/${id}/content`, { token: alice.token }), params(id)))).toEqual([400, 'live_dataset']);
  expect(await refusedBy(mutatePost(request(`/api/artifacts/${id}/mutate`, { method: 'POST', token: alice.token, json: { sql: 'delete from rows' } }), params(id)))).toEqual([400, 'live_dataset']);
  const replaced = await replaceArtifactWithBody({ dataset: [{ x: 1 }] }, alice.actor, id, 'http://localhost:3000');
  expect([replaced.status, (await replaced.json()).error]).toEqual([400, 'live_dataset_connection']);
  const fork = await forkArtifact(alice.actor, row, {});
  expect(fork instanceof Response ? [fork.status, (await fork.json()).error] : 'forked').toEqual([400, 'not_forkable']);
});

it('ignores retired GraphQL naming metadata without granting live query access', async () => {
  const { alice, bob } = await people();
  const created = await createLive(alice, { name: 'shop_api' });
  expect(created.status).toBe(201);
  const id = created.body.id;
  const row = (await getArtifactById(id))!;
  expect(row.meta).not.toHaveProperty('name');
  expect(row.dataset_policy).toBeNull();
  await updateSharingFor(alice.actor, id, { shares: [{ email: bob.email!, role: 'viewer' }] });
  expect((await call(queryPost as never, `/api/artifacts/${id}/query`, id, bob, { method: 'POST', json: { sql: 'select * from sales.orders' } })).status).toBe(403);
  const page = await publish(alice, { html: PAGE(id, MINE), visibility: 'public' });
  expect(page.status).toBe(201);
  expect((await door(page.body.id, bob, { query: 'mine', params: { min: 0 } })).status).toBe(403);
});

it('lets a group own a live dataset (its editors change and query it), and keeps the secret out of the creation ledger', async () => {
  const { alice, bob, carol } = await people();
  const group = await createGroup(alice.userId!, { handle: 'live_group', name: 'Live' });
  await admitGroupMember(alice.userId!, group.id, bob.userId!, 'editor');
  await admitGroupMember(alice.userId!, group.id, carol.userId!, 'viewer');
  const keyed = await createArtifactFromBody({ connection: config(), title: 'Team DB', destination: { type: 'group', id: group.id } }, alice.actor, 'http://localhost:3000', request('/api/artifacts', { method: 'POST', headers: { 'Idempotency-Key': 'live-dataset-key-0001' } }));
  expect(keyed.status, await keyed.clone().text()).toBe(201);
  const id = ((await keyed.json()) as { id: string }).id;
  expect((await getArtifactById(id))!.group_id).toBe(group.id);
  expect((await call(connectionPatch as never, `/api/artifacts/${id}/connection`, id, bob, { method: 'PATCH', json: { tls: 'disable' } })).status).toBe(200);
  expect((await call(connectionPatch as never, `/api/artifacts/${id}/connection`, id, carol, { method: 'PATCH', json: { tls: 'disable' } })).status).toBe(403);
  expect((await call(queryPost as never, `/api/artifacts/${id}/query`, id, bob, { method: 'POST', json: { sql: 'select count(*)::int as n from sales.orders' } })).body.results[0].rows).toEqual([{ n: 3 }]);
  expect((await (await getDb()).query('SELECT count(*)::int AS n FROM artifact_creation_operations')).rows[0]).toEqual({ n: 1 });
  // The ledger's fingerprint leaves the secret out: the same request with another password is the same request (a replay).
  const again = await createArtifactFromBody({ connection: config({ password: 'another-one' }), title: 'Team DB', destination: { type: 'group', id: group.id } }, alice.actor, 'http://localhost:3000', request('/api/artifacts', { method: 'POST', headers: { 'Idempotency-Key': 'live-dataset-key-0001' } }));
  expect([again.status, ((await again.json()) as { id: string }).id]).toEqual([201, id]);
  expect(await everyStoredRow()).not.toContain(PASSWORD);
});

// Hold a real connector answer until a concurrent access change has committed. Neither
// the public page nor its owner host changes; the live dataset must fence its own rows.
it.each(['canonical', 'owner-host'] as const)('withholds live declared-query rows after revocation through %s', async (surface) => {
  const { alice } = await people();
  await setUsername(alice.userId!, 'livereader');
  overrideConfig({ userPagesHost: 'public.example.test', publicBaseUrl: 'https://app.example.test' }, { DATASETS__ALLOW_PRIVATE_NETWORK: '1' });
  const server = createAppServer({ indexHtml: async () => '<html><body>App</body></html>' });
  for (const change of ['policy', 'private', 'deleted'] as const) {
    const id = (await createLive(alice)).body.id;
    await setRule(alice, id, 'anonymous');
    const page = (await publish(alice, { html: PAGE(id, SCRIPT('total', 'shop', 'select n from public.loose')) })).body.id;
    const read = async () => surface === 'canonical'
      ? door(page, null, { query: 'total' })
      : answer(await server.request(`https://livereader.public.example.test/api/artifacts/${page}/sql`, {
        method: 'POST', headers: { 'content-type': 'text/plain', origin: 'null' },
        body: JSON.stringify({ query: 'total', params: {}, revision: '1' }),
      }));
    expect(ok(await read()).rows).toEqual([{ n: 7 }]);
    await closeLiveDatasetConnections();
    const original = connectors.openConnection;
    let executions = 0;
    const spy = vi.spyOn(connectors, 'openConnection').mockImplementation((...args) => {
      const connection = original(...args);
      return { ...connection, async query(input) {
        const result = await connection.query(input);
        executions++;
        expect(result.rows).toEqual([{ n: 7 }]);
        if (change === 'policy') await setRule(alice, id);
        else if (change === 'private') await updateSharingFor(alice.actor, id, { visibility: 'private' });
        else await (await getDb()).query('UPDATE artifacts SET deleted_at=now() WHERE id=$1', [id]);
        return result;
      } };
    });
    try {
      const response = await read();
      expect(response.status, change).not.toBe(200);
      expect(response.body, change).not.toHaveProperty('rows');
      expect(executions).toBe(1);
    } finally { spy.mockRestore(); await closeLiveDatasetConnections(); }
  }
});
