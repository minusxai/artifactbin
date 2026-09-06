/** Real PostgreSQL → dataset connection → restricted dataset → filtered document.
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
  for (const [label, value] of Object.entries({ Host: '127.0.0.1', Port: String(port), Database: 'postgres', Username: 'dataset_reader', Password: readerPassword })) {
    await owner.getByLabel(label, { exact: true }).fill(value);
  }
  await owner.getByLabel('Use SSL', { exact: true }).uncheck();
  const secretResponse = owner.waitForResponse(response => new URL(response.url()).pathname === '/api/my/secrets' && response.request().method() === 'POST');
  const discovery = await uiResponse(owner, '/api/my/datasets/discover', () => owner.getByLabel('Test and discover', { exact: true }).click());
  const credential = await secretResponse;
  assert.equal(credential.status(), 201); secretFree(await credential.json());
  await owner.getByLabel('Password status', { exact: true }).waitFor();
  assert.equal(await owner.getByLabel('Password', { exact: true }).count(), 0);
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
  log('dataset connection discovers schemas; selected columns and stable default schema persist into table picker');

  const metadata = await ownerApi(owner, `/api/my/artifacts/${datasetId}`);
  assert.equal(metadata.status, 200); secretFree(metadata.body);
  const exposed = metadata.body.meta.catalog.tables.find(table => table.schema === 'sales' && table.name === 'orders');
  assert.deepEqual(exposed.columns.map(column => column.name), ['id', 'region', 'amount']);
  assert.ok(metadata.body.meta.catalog.connection.passwordSecretId);
  assert.ok(!Object.hasOwn(metadata.body.meta.catalog.connection, 'password'));
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

  // A fresh model-only dataset chooses its stable default schema at creation.
  await owner.goto(`${base}/datasets/new`, { waitUntil: 'load' });
  await owner.getByLabel('Dataset title', { exact: true }).fill('Postgres model-only notebook');
  await owner.getByLabel('PostgreSQL', { exact: true }).click();
  for (const [label, value] of Object.entries({ Host: '127.0.0.1', Port: String(port), Database: 'postgres', Username: 'dataset_reader', Password: readerPassword })) await owner.getByLabel(label, { exact: true }).fill(value);
  await owner.getByLabel('Use SSL', { exact: true }).uncheck();
  await uiResponse(owner, '/api/my/datasets/discover', () => owner.getByLabel('Test and discover', { exact: true }).click());
  await owner.getByLabel('Add notebook cell', { exact: true }).click();
  await owner.getByLabel('Cell name 1', { exact: true }).fill('raw_orders');
  await owner.getByLabel('Cell SQL 1', { exact: true }).fill('select region, amount from sales.orders');
  await uiResponse(owner, '/api/my/datasets/notebook/preview', () => owner.getByLabel('Run cell 1', { exact: true }).click());
  await previewContains(owner, '120', 'Cell preview 1');
  assert.equal(await owner.getByLabel('Expose cell 1', { exact: true }).isChecked(), false);
  await owner.getByLabel('Add notebook cell', { exact: true }).click();
  await owner.getByLabel('Cell name 2', { exact: true }).fill('region_totals');
  await owner.getByLabel('Cell SQL 2', { exact: true }).fill('select region, sum(amount)::int as total from raw_orders group by region order by region');
  await uiResponse(owner, '/api/my/datasets/notebook/preview', () => owner.getByLabel('Run cell 2', { exact: true }).click());
  await previewContains(owner, '150', 'Cell preview 2');
  await owner.getByLabel('Expose cell 2', { exact: true }).check();
  assert.equal(await owner.getByLabel('Expose table models.region_totals', { exact: true }).isChecked(), true);
  // Publish only the final model. The intermediate cell and physical tables stay internal.
  await owner.getByLabel('Expose schema sales', { exact: true }).uncheck();
  await owner.getByLabel('Expose schema support', { exact: true }).uncheck();
  await owner.getByLabel('Default schema', { exact: true }).selectOption('models');
  await owner.getByLabel('SQL view', { exact: true }).click();
  await owner.getByLabel('Dataset SQL', { exact: true }).fill('select * from models.region_totals');
  await uiResponse(owner, '/api/my/datasets/preview', () => owner.getByLabel('Run dataset SQL', { exact: true }).click());
  await previewContains(owner, '150');
  await owner.getByLabel('Dataset SQL', { exact: true }).fill('select * from sales.orders');
  const deniedDraft = await uiResponse(owner, '/api/my/datasets/preview', () => owner.getByLabel('Run dataset SQL', { exact: true }).click(), 'POST', 400);
  assert.ok(deniedDraft.error);
  assert.equal(await owner.getByLabel('Dataset SQL', { exact: true }).inputValue(), 'select * from sales.orders');
  await owner.getByLabel('Edit dataset source', { exact: true }).click();
  const source = await owner.getByLabel('Dataset source', { exact: true }).inputValue();
  assert.match(source, /<Dataset/); assert.match(source, /raw_orders/); secretFree(source);
  await owner.getByLabel('Apply dataset source', { exact: true }).click();
  const modelCreated = await uiResponse(owner, '/api/my/artifacts', () => owner.getByLabel('Save dataset', { exact: true }).click(), 'POST', 201);
  const modelDatasetId = modelCreated.id;
  await owner.waitForURL(url => url.pathname === `/a/${modelDatasetId}`);
  assert.equal((await ownerApi(owner, `/api/my/artifacts/${modelDatasetId}/sharing`, 'PUT', { visibility: 'unlisted' })).status, 200);
  assert.equal(await owner.getByLabel('Dataset schema', { exact: true }).inputValue(), 'models');
  assert.equal(await owner.getByLabel('Dataset table', { exact: true }).inputValue(), 'region_totals');
  await previewContains(owner, '150');
  const publicPage = await fetch(`${base}/api/page/artifact/${modelDatasetId}`).then(response => response.json());
  secretFree(publicPage);
  const publicCatalog = publicPage.surface.catalog;
  assert.equal(publicCatalog.tables.length, 1);
  assert.ok(!Object.hasOwn(publicCatalog, 'notebook'));
  assert.ok(!Object.hasOwn(publicCatalog, 'notebookSources'));
  assert.ok(!JSON.stringify(publicPage).includes('raw_orders'));
  for (const sql of ['select * from sales.orders', 'select * from raw_orders']) assert.equal((await guestApi(`/a/${modelDatasetId}/tables`, {sql})).status, 400);
  log('chained notebook cells roundtrip through markup; only the exposed final model reaches readers');

  await admin.query('update sales.orders set amount=125 where id=1');
  const refreshed = await uiResponse(owner, `/a/${modelDatasetId}/tables`, () => owner.getByLabel('Refresh dataset', { exact: true }).click());
  assert.equal(refreshed.rows.find(row => row.region === 'west').total, 155);
  await previewContains(owner, '155');
  assert.match(await owner.getByLabel('Refresh status', { exact: true }).innerText(), /Last refreshed.*Manual refresh/);
  const finalMetadata = await ownerApi(owner, `/api/my/artifacts/${modelDatasetId}`); secretFree(finalMetadata.body);
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
