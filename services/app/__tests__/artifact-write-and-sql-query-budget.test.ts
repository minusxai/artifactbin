/** Count app database statements through the real page SQL and publish routes, with their results pinned beside the counts. */
import { expect, it } from 'vitest';
import { artifactState } from '@/lib/artifacts';
import { PUT as replace } from '@/app/api/artifacts/[id]/route';
import { nativeHtml } from './native-html-fixture';
import { head, publishedId } from './artifact-fixtures';
import { params, recordStatements, request, useAppHarness } from './harness';
import { person, sql } from './page-sql-door-fixture';

useAppHarness();

const BUDGET = {
  // 7 credential statements, 3 page reads (including the verifier), 5 dataset loads and 5 fences.
  pageSql: 20,
  // 5 credential statements, 5 admission/owner/lock reads, 8 revision/edit/index statements and 2 events.
  publishPut: 20,
};

it('budgets a warm page SQL read that names one of five linked datasets', async () => {
  const owner = await person('budget_sql');
  const links = [];
  for (let i = 1; i <= 5; i++) {
    const id = await publishedId(owner.token, { dataset: [{ units: i * 7 }], access: 'readwrite' });
    links.push(`<link rel="af-dataset" data-af-name="data${i}" href="ref:${id}">`);
  }
  const pageId = await publishedId(owner.token, { html: nativeHtml('<p>Linked totals</p>').replace('</head>', `${links.join('')}</head>`) });
  const read = () => sql(pageId, owner, 'select units from data3');
  expect((await read()).status).toBe(200);
  const recorded = await recordStatements(read);
  expect(recorded.value).toEqual({
    status: 200,
    body: { columns: [{ name: 'units', type: 'number' }], rows: [{ units: 21 }], source: { kind: 'snapshot', at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), names: ['data3'] } },
  });
  console.info('[budget] page SQL read: statements=%d', recorded.count);
  expect(recorded.count, recorded.sql.join('\n')).toBe(BUDGET.pageSql);
});

it('budgets a publish PUT that saves a new page revision', async () => {
  const owner = await person('budget_put');
  const id = await publishedId(owner.token, { title: 'Before', html: nativeHtml('<p>Old text</p>') });
  const html = nativeHtml('<p>New text</p>');
  const expectedState = artifactState(await head(id));
  const recorded = await recordStatements(() => replace(request(`/api/artifacts/${id}`, {
    method: 'PUT', token: owner.token, json: { title: 'After', html, expectedVersion: 1, expectedState },
  }), params(id)));
  expect(recorded.value.status, await recorded.value.clone().text()).toBe(200);
  expect(await recorded.value.json()).toMatchObject({ id, version: 2, title: 'After' });
  expect(await head(id)).toMatchObject({ version: 2, title: 'After', source: expect.stringContaining('New text') });
  console.info('[budget] publish PUT: statements=%d', recorded.count);
  expect(recorded.count, recorded.sql.join('\n')).toBe(BUDGET.publishPut);
});
