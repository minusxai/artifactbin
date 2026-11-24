/** Count app database statements through the real page SQL and publish routes, with their results pinned beside the counts. */
import { expect, it, vi } from 'vitest';
import { artifactState } from '@/lib/artifacts';
import { PUT as replace } from '@/app/api/artifacts/[id]/route';
import { nativeHtml } from './native-html-fixture';
import { head, postArtifact, publishedId } from './artifact-fixtures';
import { params, recordStatements, request, useAppHarness } from './harness';
import { person, sql } from './page-sql-door-fixture';

useAppHarness();

const BUDGET = {
  // 7 credential statements, 2 page header reads (including the verifier), 1 dataset load and its fence.
  pageSql: 11,
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
  // The admitted page uses headers only. Each retained dataset costs one full-row load and one full-row fence.
  expect(recorded.sql.filter((statement) => /^SELECT \* FROM artifacts WHERE id = \$1 AND deleted_at IS NULL$/.test(statement)),
    recorded.sql.join('\n')).toHaveLength(2);
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

// All whole-document parse5 calls, including readers that do not enter through parseSource.
const pageParses = vi.hoisted(() => [] as { source: string; stack: string }[]);
vi.mock('parse5', async (original) => {
  const actual = await original<typeof import('parse5')>();
  return { ...actual, parse: (...args: Parameters<typeof actual.parse>) => {
    pageParses.push({ source: args[0], stack: new Error().stack ?? '' });
    return actual.parse(...args);
  } };
});

it('budgets whole-page HTML parses on publish create and replace', async () => {
  const owner = await person('budget_html');
  const before = nativeHtml('<p>Original page</p>');
  const after = nativeHtml('<p>Replacement page</p>');
  pageParses.length = 0;
  const created = await postArtifact(owner.token, { html: before });
  const createdParses = pageParses.splice(0);
  expect(created.status, await created.clone().text()).toBe(201);
  const { id } = await created.json();
  const expectedState = artifactState(await head(id));
  pageParses.length = 0;
  const replaced = await replace(request(`/api/artifacts/${id}`, {
    method: 'PUT', token: owner.token, json: { html: after, expectedVersion: 1, expectedState },
  }), params(id));
  const replacedParses = pageParses.splice(0);
  expect(replaced.status, await replaced.clone().text()).toBe(200);
  console.info('[budget] HTML create=%d replace=%d', createdParses.length, replacedParses.length);
  // The first 16 parses are shared by both routes.
  // 1. portable envelope.
  // 2. bundle fetch paths.
  // 3. bundle dependency links.
  // 4. implied element check.
  // 5. core inspection.
  // 6. head after core removal.
  // 7. design selection.
  // 8. identity input.
  // 9. canonical declaration validation.
  // 10. CSP.
  // 11. listing metadata.
  // 12. PWA metadata.
  // 13. social preview image.
  // 14. social preview presence.
  // 15. asset refs.
  // 16. author declarations.
  // Create then parses for the following.
  // 17. implied element check for storage.
  // 18. core inspection for storage.
  // 19. head after core removal for storage.
  // 20. design selection for storage.
  // 21. identity allocation.
  // 22. storage declaration validation.
  // 23. legacy region conversion.
  // 24. script fingerprint.
  // 25. implied element check for source-ID index.
  // 26. core inspection for source-ID index.
  // 27. design selection for source-ID index.
  // 28. source-ID index allocation.
  // 29. source-ID index declaration validation.
  // 30. stored web assets.
  // Replace then parses for the following.
  // 17. implied element check for storage.
  // 18. core inspection for storage.
  // 19. head after core removal for storage.
  // 20. design selection for storage.
  // 21. identity allocation.
  // 22. previous IDs.
  // 23. previous ID carry.
  // 24. storage declaration validation.
  // 25. legacy region conversion.
  // 26. script fingerprint.
  // 27. stored web assets.
  // 28. implied element check for source-ID index.
  // 29. core inspection for source-ID index.
  // 30. design selection for source-ID index.
  // 31. source-ID index allocation.
  // 32. source-ID index declaration validation.
  expect(createdParses).toHaveLength(30);
  expect(replacedParses).toHaveLength(32);
});
