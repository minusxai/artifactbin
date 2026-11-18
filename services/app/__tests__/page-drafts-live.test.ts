/**
 * A DRAFT'S LIVE DATA (lib/page-drafts, POST /api/page/drafts/sql): a draft's `default:` links read the install's default
 * connection only when the embedding app allowed it for that mount, and then as the signed-in reader, read-only, through
 * the same code a published page's door runs (lib/connections pageConnectionSql). The database is a real Postgres engine
 * on a loopback socket (test-support pglite-wire) whose view shows each reader only their own rows.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { startPgliteWire, type PgliteWire } from '@artifactbin/test-support/pglite-wire';
import type { Actor } from '@artifactbin/contracts';
import { pagesSite } from '@/lib/http';
import { overrideConfig } from '@/lib/platform/config';
import { closeDefaultConnection } from '@/lib/connections';
import { resetDrafts } from '@/lib/page-drafts';
import { createAppServer } from '@/server/app';
import { request, useAppHarness } from './harness';
import { person, type Person } from './page-sql-door-fixture';

const site = pagesSite();
const APP = site.app;
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><body></body></html>', pagesSite: site });
useAppHarness();
let wire: PgliteWire, setting: string;
beforeAll(async () => {
  wire = await startPgliteWire(`
    create schema sales;
    create table sales.orders(id int primary key, owner text not null, item text);
    create view sales.mine as select id, item from sales.orders where owner = current_setting('app.viewer_id', true);`);
  setting = JSON.stringify({ connector: 'postgres', host: '127.0.0.1', port: wire.port, database: 'postgres', user: 'postgres', password: 'draft-live-secret', tls: 'disable' });
});
afterAll(async () => { await closeDefaultConnection(); await wire?.close(); });
beforeEach(() => overrideConfig({}, { DATASETS__DEFAULT_CONNECTION: setting, DATASETS__ALLOW_PRIVATE_NETWORK: '1' }));
afterEach(() => resetDrafts());

const session = (who: Person): Actor => ({ credential: 'session', sessionId: `live-${who.userId}`, userId: who.userId!, email: who.email ?? '', emailVerified: true });
const call = (who: Person | null, path: string, body: unknown, origin = APP) =>
  app.request(request(path, { method: 'POST', json: body, origin, headers: { 'sec-fetch-site': origin === APP ? 'same-origin' : 'same-site' }, ...(who ? { actor: session(who) } : {}) }));
const PAGE = '<html><head><link rel="af-dataset" data-af-name="wh" href="default:warehouse/finance"><link rel="af-dataset" data-af-name="orders" href="./orders.csv"></head><body></body></html>';
const FILES = [{ path: 'orders.csv', base64: Buffer.from('n\n1\n').toString('base64') }];
async function readers() {
  const alice = await person('alice'), bob = await person('bob');
  await wire.db.query('delete from sales.orders');
  await wire.db.query("insert into sales.orders values (1,$1,'tea'),(2,$2,'cake'),(3,$1,'pie')", [alice.userId, bob.userId]);
  return { alice, bob };
}
const draft = async (who: Person, liveSql?: boolean) => {
  const response = await call(who, '/api/page/drafts', { html: PAGE, files: FILES, ...(liveSql === undefined ? {} : { liveSql }) });
  const body = await response.json() as { origin: string; src: string; connections: string[]; liveSql: boolean };
  expect(response.status, JSON.stringify(body)).toBe(200);
  return { ...body, label: new URL(body.origin).hostname.split('.')[0]! };
};
const live = async (who: Person | null, label: string, sql: string, origin = APP) => { const r = await call(who, '/api/page/drafts/sql', { draft: label, sql, params: {} }, origin); return { status: r.status, body: await r.json() as Record<string, unknown> }; };

it('names its live links and reads none of them unless the embedding app allowed it for this mount', async () => {
  const { alice } = await readers();
  const closed = await draft(alice);
  expect(closed).toMatchObject({ connections: ['wh'], liveSql: false });
  const page = await (await app.request(closed.src)).text();
  expect(JSON.parse(/data-af="runtime">([^<]*)</.exec(page)![1]!)).toMatchObject({ draftConnections: ['wh'], draftLive: false });
  // The reader's own draft, not yet allowed: paused, with its own code; anyone else's answers as a missing one.
  expect(await live(alice, closed.label, 'select item from wh.sales.mine')).toMatchObject({ status: 403, body: { error: 'consent_required', notice: expect.stringMatching(/paused until you allow it/) } });
  const { bob } = await readers();
  expect(await live(bob, closed.label, 'select item from wh.sales.mine')).toMatchObject({ status: 404, body: { error: 'unavailable' } });
  const open = await draft(alice, true);
  expect(open.origin).not.toBe(closed.origin);
  expect(JSON.parse(/data-af="runtime">([^<]*)</.exec(await (await app.request(open.src)).text())![1]!)).toMatchObject({ draftConnections: ['wh'], draftLive: true });
});

it('reads as the signed-in reader who is shown the draft, read-only, and only that reader\'s own draft', async () => {
  const { alice, bob } = await readers();
  const mine = await draft(alice, true), theirs = await draft(bob, true);
  expect(await live(alice, mine.label, 'select item from wh.sales.mine order by id')).toMatchObject({ status: 200, body: { rows: [{ item: 'tea' }, { item: 'pie' }] } });
  expect(await live(bob, theirs.label, 'select item from wh.sales.mine order by id')).toMatchObject({ status: 200, body: { rows: [{ item: 'cake' }] } });
  // Another reader's draft answers as a missing one; a signed-out caller, another origin and the draft's own origin are refused.
  expect((await live(bob, mine.label, 'select item from wh.sales.mine')).status).toBe(404);
  expect((await live(null, mine.label, 'select 1')).status).toBe(401);
  expect((await live(alice, mine.label, 'select 1 from wh.sales.mine', 'https://elsewhere.example')).status).toBe(403);
  expect(await live(alice, mine.label, 'select 1 from wh.sales.mine', mine.origin)).toMatchObject({ status: 403, body: { error: 'forbidden_origin' } });
  // Read-only, as on a published page; a statement naming no live link is not this door's.
  expect(await live(alice, mine.label, "insert into wh.sales.orders values (9,'x','y')")).toMatchObject({ status: 403, body: { error: 'permission_denied' } });
  expect(await live(alice, mine.label, 'select * from orders')).toMatchObject({ status: 400, body: { error: 'validation_failed' } });
  expect(Number((await wire.db.query<{ n: number }>('select count(*)::int n from sales.orders')).rows[0]!.n)).toBe(3);
});
