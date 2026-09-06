/** Real PostgreSQL → connection wizard → restricted dataset → filtered document.
 * Requires a running feature build with DATASET__ALLOW_PRIVATE_NETWORKS=true,
 * the normal gate development outbox, Docker, and postgres:17-alpine.
 * Usage: node scripts/gate-postgres-datasets.mjs [base]
 * Gate manifest: needsMail:true; budget 120 seconds. Own fixture always removed.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { chromium } from 'playwright';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';
import { loginViaEmail, startMailSink } from './lib/mail-login.mjs';

const base = process.argv[2] ?? 'http://localhost:3030';
const log = label => console.log(`  ok ${label}`);
const adminPassword = randomUUID();
const readerPassword = randomUUID();
let container;
let admin;
let browser;
let sink;
const secretFree = value => {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  assert.ok(!serialized.includes(adminPassword) && !serialized.includes(readerPassword), 'credentials must not appear in returned metadata or document markup');
  assert.ok(!serialized.includes('hidden-west') && !serialized.includes('hidden-east'), 'hidden source values must not appear in public output');
};
const ownerApi = async (page, path, method = 'GET', data) => page.evaluate(async ({ path, method, data }) => {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}, { path, method, data });
const guestApi = async (path, data) => {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};
async function uiResponse(page, path, action, method = 'POST', expected = 200) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method);
  await action();
  const response = await pending;
  assert.equal(response.status(), expected, `${method} ${path} must succeed`);
  const body = await response.json(); secretFree(body); return body;
}
async function previewContains(page, text, label = 'Table preview') {
  const preview = page.getByLabel(label, { exact: true });
  await preview.waitFor();
  await page.waitForFunction(({ label, text }) => [...document.querySelectorAll('[aria-label]')].some(node => node.getAttribute('aria-label') === label && node.textContent?.includes(text)), { label, text });
}

try {
  container = execFileSync('docker', ['run', '--rm', '-d', '-e', `POSTGRES_PASSWORD=${adminPassword}`, '-p', '127.0.0.1::5432', 'postgres:17-alpine'], { encoding: 'utf8' }).trim();
  const port = Number(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1));
  for (let attempt = 0; attempt < 100; attempt++) {
    admin = new pg.Client({ host: '127.0.0.1', port, database: 'postgres', user: 'postgres', password: adminPassword, connectionTimeoutMillis: 1000 });
    try { await admin.connect(); break; }
    catch { await admin.end(); if (attempt === 99) throw new Error('disposable Postgres did not become ready'); await delay(200); }
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
  log('disposable Postgres has two schemas and a SELECT-only reader');

  const start = await startDocument(base);
  browser = await chromium.launch();
  sink = await startMailSink();
  const owner = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const guest = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await becomeOwner(owner, base, start.token);
  await loginViaEmail(owner, base, sink, `mxmx_test_postgres_${Date.now()}@example.com`);
  assert.equal((await ownerApi(owner, '/api/tokens/claim', 'POST', { token: start.token })).status, 200);
  await owner.goto(`${base}/datasets/new`, { waitUntil: 'load' });
  await owner.getByLabel('Dataset title', { exact: true }).fill('Postgres gate warehouse');
  await owner.getByLabel('PostgreSQL', { exact: true }).click();
  await owner.getByLabel('New connection', { exact: true }).click();
  for (const [label, value] of Object.entries({ 'Connection name': 'Gate Postgres', Host: '127.0.0.1', Port: String(port), Database: 'postgres', Username: 'dataset_reader', Password: readerPassword })) {
    await owner.getByLabel(label, { exact: true }).fill(value);
  }
  await owner.getByLabel('Use SSL', { exact: true }).uncheck();
  const connection = (await uiResponse(owner, '/api/my/connections', () => owner.getByLabel('Save connection', { exact: true }).click(), 'POST', 201)).connection;
  assert.ok(connection.id); assert.ok(!Object.hasOwn(connection, 'password'));
  const discovery = await uiResponse(owner, `/api/my/connections/${connection.id}/test`, () => owner.getByLabel('Test and discover', { exact: true }).click());
  assert.deepEqual(discovery.tables.map(table => `${table.schema}.${table.name}`).sort(), ['sales.orders', 'support.tickets']);
  assert.equal(await owner.getByLabel('Expose table sales.orders', { exact: true }).isChecked(), false);
  await owner.getByLabel('Toggle table sales.orders', { exact: true }).click();
  for (const column of ['id', 'region', 'amount']) await owner.getByLabel(`Expose column sales.orders.${column}`, { exact: true }).check();
  assert.equal(await owner.getByLabel('Expose column sales.orders.customer_secret', { exact: true }).isChecked(), false);
  await owner.getByLabel('Default schema', { exact: true }).selectOption('sales');
  await owner.getByLabel('Expose table support.tickets', { exact: true }).check();
  await owner.getByLabel('Toggle table support.tickets', { exact: true }).click();
  for (const column of ['id', 'subject']) assert.equal(await owner.getByLabel(`Expose column support.tickets.${column}`, { exact: true }).isChecked(), true);
  assert.equal(await owner.getByLabel('Default schema', { exact: true }).inputValue(), 'sales');
  await owner.getByLabel('Refresh interval', { exact: true }).fill('0');
  const created = await uiResponse(owner, '/api/my/artifacts', () => owner.getByLabel('Save dataset', { exact: true }).click(), 'POST', 201);
  const datasetId = created.id; assert.ok(datasetId);
  await owner.waitForURL(url => url.pathname === `/a/${datasetId}`);
  await previewContains(owner, '120');
  assert.equal(await owner.getByLabel('Dataset schema', { exact: true }).inputValue(), 'sales');
  await owner.getByLabel('Dataset schema', { exact: true }).selectOption('support');
  await previewContains(owner, 'Refund requested');
  assert.equal(await owner.getByLabel('Dataset table', { exact: true }).inputValue(), 'tickets');
  await owner.getByLabel('Dataset schema', { exact: true }).selectOption('sales');
  await previewContains(owner, '120');
  log('connection wizard discovers schemas; selected columns and stable default schema persist into table picker');

  const metadata = await ownerApi(owner, `/api/my/artifacts/${datasetId}`);
  assert.equal(metadata.status, 200); secretFree(metadata.body);
  const exposed = metadata.body.meta.catalog.tables.find(table => table.schema === 'sales' && table.name === 'orders');
  assert.deepEqual(exposed.columns.map(column => column.name), ['id', 'region', 'amount']);
  const connections = await ownerApi(owner, '/api/my/connections');
  secretFree(connections.body); assert.ok(connections.body.connections.every(item => !Object.hasOwn(item, 'password')));
  assert.equal((await guestApi(`/a/${datasetId}/tables`, { sql: 'select * from orders' })).status, 404, 'private dataset must reject an anonymous reader');
  assert.equal((await ownerApi(owner, `/api/my/artifacts/${datasetId}/sharing`, 'PUT', { visibility: 'unlisted' })).status, 200);

  const markup = '<Helmet><Value name="region" type="string" default="west" />'
    + `<Query name="orders" source="${datasetId}">{\`select id, region, amount from orders where $region is null or region=$region order by id\`}</Query></Helmet>`
    + '<div data-design="tw" className="p-8"><h1>Regional orders</h1><input aria-label="Region" value="$region" /><DataTable data="$orders" /></div>';
  const published = await fetch(`${base}/api/artifacts/${start.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${start.token}` }, body: JSON.stringify({ title: 'Postgres sourced document', markup, visibility: 'unlisted' }) });
  const publication = await published.json();
  secretFree(publication);
  assert.equal(published.status, 200, `same-owner document must accept a sourced filtered query: ${JSON.stringify(publication)}`);
  await guest.goto(`${base}/a/${start.id}`, { waitUntil: 'load' });
  await previewContains(guest, '120', 'DataTable embed');
  assert.ok(!(await guest.getByLabel('DataTable embed', { exact: true }).innerText()).includes('90'));
  await guest.getByLabel('Region', { exact: true }).fill('east');
  await previewContains(guest, '90', 'DataTable embed');
  assert.ok(!(await guest.getByLabel('DataTable embed', { exact: true }).innerText()).includes('120'));
  secretFree(await guest.content());
  log('anonymous reader sees permitted source data and a typed Value filter reruns the remote query');

  for (const sql of ['select customer_secret from orders', "select id from orders where customer_secret='hidden-west'", 'select * from sales.internal_notes', 'select * from pg_catalog.pg_authid', 'delete from orders', 'with changed as (delete from orders returning *) select * from changed']) {
    const denied = await guestApi(`/a/${datasetId}/tables`, { sql });
    assert.equal(denied.status, 400, 'forged hidden-data or write query must be rejected'); secretFree(denied.body);
  }
  assert.equal((await admin.query('select count(*)::int as n from sales.orders')).rows[0].n, 3);
  assert.equal((await admin.query('select sum(amount)::int as n from sales.orders')).rows[0].n, 240);
  log('forged reader queries cannot reach hidden columns, undeclared tables, catalogs or writes; database remains unchanged');

  await owner.getByLabel('Edit dataset', { exact: true }).click();
  await owner.getByLabel('Add SQL model', { exact: true }).click();
  await owner.getByLabel('Model schema 1', { exact: true }).fill('sales');
  await owner.getByLabel('Model name 1', { exact: true }).fill('region_totals');
  await owner.getByLabel('Model SQL 1', { exact: true }).fill('select region, sum(amount)::int as total from orders group by region order by region');
  await uiResponse(owner, '/api/my/datasets/preview', () => owner.getByLabel('Preview model 1', { exact: true }).click());
  await previewContains(owner, '150', 'Model preview 1');
  await uiResponse(owner, `/api/my/artifacts/${datasetId}`, () => owner.getByLabel('Save dataset', { exact: true }).click(), 'PUT');
  await owner.waitForURL(url => url.pathname === `/a/${datasetId}`);
  await owner.getByLabel('Dataset table', { exact: true }).selectOption('region_totals');
  await previewContains(owner, '150');
  log('owner previews and saves a SQL model; the model becomes a queryable catalog table');

  await admin.query('update sales.orders set amount=125 where id=1');
  const refreshed = await uiResponse(owner, `/a/${datasetId}/tables`, () => owner.getByLabel('Refresh dataset', { exact: true }).click());
  assert.equal(refreshed.rows.find(row => row.region === 'west').total, 155);
  await previewContains(owner, '155');
  assert.match(await owner.getByLabel('Refresh status', { exact: true }).innerText(), /Last refreshed.*Manual refresh/);
  const finalMetadata = await ownerApi(owner, `/api/my/artifacts/${datasetId}`); secretFree(finalMetadata.body);
  assert.ok(finalMetadata.body.meta.catalog.tables.some(table => table.name === 'region_totals'));
  log('manual refresh reads an external database update; model metadata stays credential-free');
  console.log('\nall good');
} finally {
  try {
    await Promise.allSettled([browser?.close(), admin?.end()]);
    sink?.close();
  } finally {
    if (container) execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
  }
}
