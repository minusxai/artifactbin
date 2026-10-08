/**
 * AN EXTERNAL POSTGRESQL SOURCE THROUGH THE REAL ROUTES — the data-journey gate's PostgreSQL leg, moved here: a
 * disposable server, the app's own handlers on the harness, and no browser (the dataset editor's controls are the
 * solid/pages/__tests__/dataset-editor-*.test.tsx suite's; the catalog view's schema browser and refresh line are
 * solid/components/__tests__/dataset-catalog-view.test.tsx's).
 *
 * A SELECT-only role is discovered, saved behind a secret, exposed column by column, read by a stranger through the
 * dataset and through a document's sourced query, refused every forged query, modelled through a notebook whose
 * intermediate cell never reaches a reader, refreshed by hand, and notified through — and no answer anywhere carries
 * the admin or reader password or a hidden source value.
 *
 * Needs Docker (`postgres:17-alpine` already pulled): the `integration` project, skipped by name elsewhere.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@artifactbin/contracts';
import { useAppHarness, request, mintAccountToken } from '@/__tests__/harness';
import { createUser, claimToken } from '@/lib/accounts';
import { POST as createSecret } from '@/app/api/my/secrets/route';
import { POST as discover } from '@/app/api/my/datasets/discover/route';
import { POST as datasetPreview } from '@/app/api/my/datasets/preview/route';
import { POST as notebookPreview } from '@/app/api/my/datasets/notebook/preview/route';
import { POST as createMine } from '@/app/api/my/artifacts/route';
import { GET as readMine } from '@/app/api/my/artifacts/[id]/route';
import { PUT as sharing } from '@/app/api/my/artifacts/[id]/sharing/route';
import { POST as membership } from '@/app/api/my/artifacts/[id]/members/route';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { POST as tables } from '@/app/a/[id]/tables/route';
import { GET as anonymousQuery } from '@/app/a/[id]/query/route';
import { POST as mutate } from '@/app/a/[id]/mutate/route';
import { GET as publicPage } from '@/app/api/page/artifact/[id]/route';
import { GET as jobs } from '@/app/api/notification-runs/[runId]/jobs/route';
import { GET as inbox } from '@/app/api/my/people/route';
import { createNotificationWorker, evaluateNotificationQuery, notificationJobStore } from '@/lib/notifications';
import { notificationDocumentPayload, notificationMutationPayload } from '../../../../../scripts/fixtures/postgres-notifications.mjs';

vi.mock('@/lib/platform/config', async (original) => ({ ...await original<object>(), DATASET_ALLOW_PRIVATE_NETWORKS: true }));

useAppHarness();

const dockerAvailable = spawnSync('docker', ['image', 'inspect', 'postgres:17-alpine'], { stdio: 'ignore' }).status === 0;
const adminPassword = randomUUID();
const readerPassword = randomUUID();
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe.skipIf(!dockerAvailable)('an external PostgreSQL source through the real routes (disposable server)', () => {
  let container: string;
  let admin: pg.Client;
  let port: number;
  beforeAll(async () => {
    container = execFileSync('docker', ['run', '--rm', '-d', '-e', `POSTGRES_PASSWORD=${adminPassword}`, '-p', '127.0.0.1::5432', 'postgres:17-alpine'], { encoding: 'utf8' }).trim();
    port = Number(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1));
    for (let attempt = 0; attempt < 100; attempt++) {
      admin = new pg.Client({ host: '127.0.0.1', port, database: 'postgres', user: 'postgres', password: adminPassword });
      try { await admin.connect(); break; } catch { await admin.end(); await delay(200); }
    }
    // Password is a generated UUID, never authored SQL or an external credential.
    await admin.query(`CREATE ROLE dataset_reader LOGIN PASSWORD '${readerPassword}';
      CREATE SCHEMA sales; CREATE SCHEMA support;
      CREATE TABLE sales.orders (id integer, region text, amount integer, customer_secret text);
      INSERT INTO sales.orders VALUES (1,'west',120,'hidden-west'),(2,'east',90,'hidden-east'),(3,'west',30,'hidden-west');
      CREATE TABLE sales.internal_notes (secret text);
      CREATE TABLE support.tickets (id integer, subject text);
      INSERT INTO support.tickets VALUES (10,'Refund requested');
      GRANT USAGE ON SCHEMA sales,support TO dataset_reader;
      GRANT SELECT ON sales.orders,support.tickets TO dataset_reader;`);
  }, 120_000);
  afterAll(async () => { await admin?.end(); if (container) execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' }); });

  /** Every answer read below passes through here: no password, no hidden source value, ever. */
  const secretFree = (value: unknown) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    expect(text).not.toContain(adminPassword);
    expect(text).not.toContain(readerPassword);
    expect(text).not.toContain('hidden-west');
    expect(text).not.toContain('hidden-east');
    return value;
  };
  const body = async (response: Response, status = 200) => {
    const text = await response.text();
    expect(response.status, text).toBe(status);
    secretFree(text);
    return JSON.parse(text);
  };

  const actorOf = (user: { id: string; email: string | null }): Actor => ({ credential: 'session', userId: user.id, email: user.email!, emailVerified: true });
  /** The owner's connection behind a secret, discovered, and the physical dataset over it (unlisted unless told). */
  async function connected(visibility: 'private' | 'unlisted' = 'unlisted') {
    const ownerUser = await createUser({ email: 'mxmx_test_pg_routes_owner@example.com' });
    const recipientUser = await createUser({ email: 'mxmx_test_pg_routes_recipient@example.com' });
    const ownerToken = await mintAccountToken('pg-owner', ownerUser.id);
    await claimToken(ownerUser.id, ownerToken.token);
    const owner = actorOf(ownerUser), recipient = actorOf(recipientUser);
    const target = { host: '127.0.0.1', port, database: 'postgres', username: 'dataset_reader', ssl: false };
    /** A connection behind a NEW secret: a secret belongs to the one dataset that claims it, as a person re-typing
     * the password in the editor for a second dataset makes a second one. */
    const freshConnection = async () => {
      const secret = await body(await createSecret(request('/api/my/secrets', { method: 'POST', origin: 'same', actor: owner, json: { value: readerPassword, connection: target } })), 201);
      return { ...target, passwordSecretId: secret.secret.id as string };
    };
    const connection = await freshConnection();
    const discovered = await body(await discover(request('/api/my/datasets/discover', { method: 'POST', origin: 'same', actor: owner, json: { connection } })));
    // Three exposed columns of orders, all of tickets, `sales` by default.
    const physical = { kind: 'postgres', connection, defaultSchema: 'sales', refreshSeconds: 0, tables: [
      { schema: 'sales', name: 'orders', source: { schema: 'sales', table: 'orders' }, columns: ['id', 'region', 'amount'] },
      { schema: 'support', name: 'tickets', source: { schema: 'support', table: 'tickets' }, columns: ['id', 'subject'] },
    ] };
    const dataset = await body(await createMine(request('/api/my/artifacts', { method: 'POST', origin: 'same', actor: owner, json: { title: 'Postgres warehouse', dataset: physical, visibility: 'private' } })), 201);
    const share = async (id: string, visibility: string) => body(await sharing(request(`/api/my/artifacts/${id}/sharing`, { method: 'PUT', origin: 'same', actor: owner, json: { visibility } }), params(id)));
    if (visibility === 'unlisted') await share(dataset.id, 'unlisted');
    return { ownerUser, recipientUser, ownerToken, owner, recipient, connection, freshConnection, discovered, dataset, share };
  }
  const NOTEBOOK = { cells: [
    { id: 'raw', name: 'raw_orders', sql: 'select region, amount from sales.orders' },
    { id: 'totals', name: 'region_totals', sql: 'select region, sum(amount)::int as total from raw_orders group by region order by region' },
  ] };
  const modelled = (connection: unknown) => ({ kind: 'postgres', connection, defaultSchema: 'models', refreshSeconds: 0, notebook: NOTEBOOK,
    tables: [{ schema: 'models', name: 'region_totals', modelCellId: 'totals', columns: ['region', 'total'] }] });
  const westTotal = async () => Number((await admin.query("select sum(amount)::int as n from sales.orders where region='west'")).rows[0].n);

  it('discovers exactly what the role may read, exposes column by column, and serves a stranger only once it is link-readable', async () => {
    const w = await connected('private');
    expect(w.discovered.tables.map((t: { schema: string; name: string }) => `${t.schema}.${t.name}`).sort()).toEqual(['sales.orders', 'support.tickets']);
    const metadata = await body(await readMine(request(`/api/my/artifacts/${w.dataset.id}`, { actor: w.owner }), params(w.dataset.id)));
    const orders = metadata.meta.catalog.tables.find((t: { schema: string; name: string }) => t.schema === 'sales' && t.name === 'orders');
    expect(orders.columns.map((c: { name: string }) => c.name)).toEqual(['id', 'region', 'amount']);
    expect(metadata.meta.catalog.connection.passwordSecretId).toBeTruthy();
    expect(Object.hasOwn(metadata.meta.catalog.connection, 'password')).toBe(false);

    expect((await tables(request(`/a/${w.dataset.id}/tables`, { method: 'POST', json: { sql: 'select * from orders' } }), params(w.dataset.id))).status).toBe(404);
    await w.share(w.dataset.id, 'unlisted');
    const strangerRows = await body(await tables(request(`/a/${w.dataset.id}/tables`, { method: 'POST', json: { sql: 'select id, amount from orders order by id' } }), params(w.dataset.id)));
    expect(strangerRows.rows.map((r: { id: number }) => r.id)).toEqual([1, 2, 3]);
    const ticketRows = await body(await tables(request(`/a/${w.dataset.id}/tables`, { method: 'POST', json: { sql: 'select subject from support.tickets' } }), params(w.dataset.id)));
    expect(ticketRows.rows).toEqual([{ subject: 'Refund requested' }]);
    const exposedPage = secretFree(JSON.stringify(await (await publicPage(request(`/api/page/artifact/${w.dataset.id}`), params(w.dataset.id))).json())) as string;
    expect(exposedPage).not.toContain('customer_secret');
  });

  it('reruns a document\'s sourced query for a stranger\'s filter, and refuses every forged query with the database unchanged', async () => {
    const w = await connected();
    const markup = '<Helmet><Value name="region" type="string" default="west" />'
      + `<Query name="orders" source="ref:${w.dataset.id}">{\`select id, region from orders where $region is null or region=$region order by id\`}</Query></Helmet>`
      + '<div><h1>Regional orders</h1><DataTable data="$orders" /></div>';
    const doc = await body(await createArtifact(request('/api/artifacts', { method: 'POST', token: w.ownerToken.token, json: { title: 'Postgres sourced document', markup, visibility: 'unlisted' } })), 201);
    // The anonymous reader's door: GET with the run in `q` (what the framed document of a session-less reader asks).
    const ran = async (region: string) => (await body(await anonymousQuery(request(`/a/${doc.id}/query?q=${encodeURIComponent(JSON.stringify({ values: { region }, only: ['orders'] }))}`), params(doc.id)))).tables.orders.rows.map((r: { id: number }) => r.id);
    expect(await ran('west')).toEqual([1, 3]);
    expect(await ran('east')).toEqual([2]);

    const before = (await admin.query('select count(*)::int as n, sum(amount)::int as total from sales.orders')).rows[0];
    for (const sql of ['select customer_secret from orders', "select id from orders where customer_secret='hidden-west'", 'select * from sales.internal_notes', 'select * from pg_catalog.pg_authid', 'delete from orders', 'with changed as (delete from orders returning *) select * from changed']) {
      await body(await tables(request(`/a/${w.dataset.id}/tables`, { method: 'POST', json: { sql } }), params(w.dataset.id)), 400);
    }
    expect((await admin.query('select count(*)::int as n, sum(amount)::int as total from sales.orders')).rows[0]).toEqual(before);
    expect(before.n).toBe(3);
  });

  it('models through a notebook whose intermediate cell never reaches a reader, and a manual refresh reads an external update', async () => {
    const w = await connected();
    const west = await westTotal();
    const notebookConnection = await w.freshConnection();
    const cell1 = await body(await notebookPreview(request('/api/my/datasets/notebook/preview', { method: 'POST', origin: 'same', actor: w.owner, json: { connection: notebookConnection, notebook: NOTEBOOK, cellId: 'raw' } })));
    expect(cell1.rows).toHaveLength(3);
    const cell2 = await body(await notebookPreview(request('/api/my/datasets/notebook/preview', { method: 'POST', origin: 'same', actor: w.owner, json: { connection: notebookConnection, notebook: NOTEBOOK, cellId: 'totals' } })));
    expect(cell2.rows).toEqual([{ region: 'east', total: 90 }, { region: 'west', total: west }]);
    const draft = await body(await datasetPreview(request('/api/my/datasets/preview', { method: 'POST', origin: 'same', actor: w.owner, json: { dataset: modelled(notebookConnection), sql: 'select * from models.region_totals' } })));
    expect(draft.rows).toEqual([{ region: 'east', total: 90 }, { region: 'west', total: west }]);
    const deniedDraft = await body(await datasetPreview(request('/api/my/datasets/preview', { method: 'POST', origin: 'same', actor: w.owner, json: { dataset: modelled(notebookConnection), sql: 'select * from sales.orders' } })), 400);
    expect(deniedDraft.error).toBeTruthy();
    const model = await body(await createMine(request('/api/my/artifacts', { method: 'POST', origin: 'same', actor: w.owner, json: { title: 'Postgres model-only notebook', dataset: modelled(notebookConnection) } })), 201);
    await w.share(model.id, 'unlisted');
    const modelPage = await body(await publicPage(request(`/api/page/artifact/${model.id}`), params(model.id)));
    expect(modelPage.surface.catalog.tables).toHaveLength(1);
    expect(Object.hasOwn(modelPage.surface.catalog, 'notebook')).toBe(false);
    expect(Object.hasOwn(modelPage.surface.catalog, 'notebookSources')).toBe(false);
    expect(JSON.stringify(modelPage)).not.toContain('raw_orders');
    for (const sql of ['select * from sales.orders', 'select * from raw_orders']) {
      await body(await tables(request(`/a/${model.id}/tables`, { method: 'POST', json: { sql } }), params(model.id)), 400);
    }

    await admin.query('update sales.orders set amount=amount+5 where id=1');
    const refreshed = await body(await tables(request(`/a/${model.id}/tables`, { method: 'POST', actor: w.owner, json: { sql: 'select * from region_totals', refresh: true } }), params(model.id)));
    expect(refreshed.rows.find((r: { region: string }) => r.region === 'west').total).toBe(west + 5);
    const finalMetadata = await body(await readMine(request(`/api/my/artifacts/${model.id}`, { actor: w.owner }), params(model.id)));
    expect(finalMetadata.meta.catalog.tables.some((t: { name: string }) => t.name === 'region_totals')).toBe(true);
  });

  it('notifies through the same native catalogs — arrays, concatenation and chained models — once per recipient and run', async () => {
    const w = await connected();
    const west = await westTotal();
    const model = await body(await createMine(request('/api/my/artifacts', { method: 'POST', origin: 'same', actor: w.owner, json: { title: 'Postgres model-only notebook', dataset: modelled(await w.freshConnection()) } })), 201);
    await w.share(model.id, 'unlisted');
    const trigger = await body(await createMine(request('/api/my/artifacts', { method: 'POST', origin: 'same', actor: w.owner, json: {
      access: 'readwrite',
      dataset: '<Dataset kind="stored"><Table schema="public" name="rows" columns={[{"name":"id","type":"number"},{"name":"recipient","type":"string"}]} rows={[{"id":1,"recipient":"initial"}]} /></Dataset>',
    } })), 201);
    await w.share(trigger.id, 'unlisted');
    const join = async (id: string) => {
      await body(await membership(request(`/api/my/artifacts/${id}/members`, { method: 'POST', origin: 'same', actor: w.recipient, json: { action: 'join' } }), params(id)));
      await body(await membership(request(`/api/my/artifacts/${id}/members`, { method: 'POST', origin: 'same', actor: w.owner, json: { action: 'approve', userId: w.recipientUser.id } }), params(id)));
    };
    const fixture = { triggerId: trigger.id, recipientId: w.recipientUser.id, modelDatasetId: model.id, datasetId: w.dataset.id };
    const notice = await body(await createMine(request('/api/my/artifacts', { method: 'POST', origin: 'same', actor: w.owner, json: notificationDocumentPayload(fixture) })), 201);
    await join(notice.id);
    const worker = createNotificationWorker({ store: await notificationJobStore(), evaluator: { evaluate: evaluateNotificationQuery } });
    const run = async (id: string) => {
      const result = await body(await mutate(request(`/a/${id}/mutate`, { method: 'POST', origin: 'same', actor: w.owner, json: notificationMutationPayload(w.recipientUser.id) }), params(id)));
      expect(typeof result.mutationRunId).toBe('string');
      expect(await worker.drainOnce()).toBe(true);
      const listed = await body(await jobs(request(`/api/notification-runs/${result.mutationRunId}/jobs`, { actor: w.owner }), { params: Promise.resolve({ runId: result.mutationRunId }) }));
      expect(listed.jobs).toHaveLength(1);
      return { runId: result.mutationRunId as string, job: listed.jobs[0] };
    };
    const received = async (runId: string) => (await body(await inbox(request('/api/my/people', { actor: w.recipient })))).notifications
      .filter((n: { kind: string; mutation_run_id?: string }) => n.kind === 'mutation' && n.mutation_run_id === runId);
    const first = await run(notice.id);
    expect(first.job.status).toBe('completed');
    expect([...first.job.notification_names].sort()).toEqual(['duplicate_notice', 'model_notice', 'physical_notice']);
    const delivered = await received(first.runId);
    expect(delivered).toHaveLength(1);
    expect([...delivered[0].messages].sort()).toEqual(['Order 1', `West total ${west}`]);
    // The current native-source authority gates both delivery and disclosure.
    await w.share(model.id, 'private');
    expect(await received(first.runId)).toEqual([]);
    const suppressed = await run(notice.id);
    expect(suppressed.job.status).toBe('completed');
    expect(await received(suppressed.runId)).toEqual([]);
    await w.share(model.id, 'unlisted');
    expect(await received(suppressed.runId)).toEqual([]);
    // PostgreSQL JSON text fails the job without partial sibling-rule delivery.
    const invalid = await body(await createMine(request('/api/my/artifacts', { method: 'POST', origin: 'same', actor: w.owner, json: notificationDocumentPayload({ ...fixture, invalid: true }) })), 201);
    await join(invalid.id);
    const failed = await run(invalid.id);
    expect(failed.job.status).toBe('failed');
    expect(await received(failed.runId)).toEqual([]);
  });
});
