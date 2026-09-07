/** Real document acceptance: SQL local state through direct and session-relayed transports. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mintAnon } from './lib/mint-anon.mjs';
import { becomeOwner } from './lib/start-doc.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5400';
const {token} = await mintAnon(base);
const api = async (path, method, body) => {
  const response = await fetch(base + path, {method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})});
  assert(response.ok, `${method} ${path}: ${response.status} ${response.ok ? '' : await response.text()}`);
  return response.json();
};
const markup = `<Helmet>
<Value name="count" type="number" default={0} />
<Value name="drafts" type="table" value={[{id: 1, name: "First"}]} />
<Query name="current">{\`select id, name, count from drafts cross join _signals order by id\`}</Query>
<Mutation name="inc">{\`update _signals set count=count+1\`}</Mutation>
<Mutation name="add">{\`insert into drafts values (2, 'Second')\`}</Mutation>
<Mutation name="rename" expectedAffected={1}>{\`update drafts set name=$_value where id=$_row.id and name is not distinct from $_row.name\`}</Mutation>
</Helmet>
<h1>Local SQL state</h1><Button run="$inc">Increment</Button><Button run="$add">Add draft</Button>
<DataTable data="$current" rowKey="id"><Column col="id" /><Column col="name"><input aria-label="Name {$_row.id}" value="$_row.name" run="$rename" /></Column><Column col="count" /></DataTable>`;
const doc = await api('/api/artifacts', 'POST', {title: 'mxmx_test_local_sql_state', markup});
const browser = await chromium.launch();
try {
  for (const owner of [false, true]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    if (owner) await becomeOwner(page, base, token);
    await page.goto(`${base}/a/${doc.id}`);
    const surface = owner ? await (await page.waitForSelector('iframe[title="artifact"]')).contentFrame() : page;
    await surface.getByLabel('Name 1', {exact: true}).waitFor();
    assert.equal(await surface.evaluate(() => window.mx.params.get('count')), 0);
    await surface.getByRole('button', {name: 'Increment', exact: true}).click();
    await surface.waitForFunction(() => window.mx.params.get('count') === 1);
    await surface.getByRole('button', {name: 'Add draft', exact: true}).click();
    const second = surface.getByLabel('Name 2', {exact: true});
    await second.waitFor();
    await second.fill('Edited locally');
    await second.press('Enter');
    await surface.waitForFunction(() => window.mx.data.get('current')?.rows.some(row => row.id === 2 && row.name === 'Edited locally'));
    assert.equal((await api(`/api/artifacts/${doc.id}`, 'GET')).version, 1);
    await page.reload();
    const reloaded = owner ? await (await page.waitForSelector('iframe[title="artifact"]')).contentFrame() : page;
    await reloaded.getByLabel('Name 1', {exact: true}).waitFor();
    assert.equal(await reloaded.getByLabel('Name 2', {exact: true}).count(), 0, 'inline rows reset on reload');
    await context.close();
  }
  console.log('PASS: direct and relayed local SQL signals, inline inserts, editable cells, query refresh, viewer isolation, reload reset, no persistence');
} finally {
  await browser.close();
  await api(`/api/artifacts/${doc.id}`, 'DELETE');
}
