/** Count app database statements through the real page SQL and publish routes, with their results pinned beside the counts. */
import { expect, it, vi } from 'vitest';
import { artifactState } from '@/lib/artifacts';
import { POST as sqlPost } from '@/app/api/artifacts/[id]/sql/route';
import { createAppServer } from '@/server/app';
import { getDb, runWithRequest, services, setServices } from '@/lib/platform';
import { revokeToken } from '@/lib/accounts';
import { PUT as replace } from '@/app/api/artifacts/[id]/route';
import { nativeHtml } from './native-html-fixture';
import { head, postArtifact, publishedId } from './artifact-fixtures';
import { params, recordStatements, request, useAppHarness } from './harness';
import { person } from './page-sql-door-fixture';

useAppHarness();

const BUDGET = {
  // 3 credential statements per decision, 2 page headers, 1 dataset load and its fence.
  pageSql: 10,
  // 4 credential statements, 5 admission/owner/lock reads, 8 revision/edit/index statements and 2 events.
  publishPut: 19,
};

async function linkedPage() {
  const owner = await person('budget_sql');
  const links = [];
  for (let i = 1; i <= 5; i++) {
    const id = await publishedId(owner.token, { dataset: [{ units: i * 7 }], access: 'readwrite' });
    links.push(`<link rel="af-dataset" data-af-name="data${i}" href="ref:${id}">`);
  }
  const pageId = await publishedId(owner.token, { visibility: 'private', html: nativeHtml('<p>Linked totals</p>').replace('</head>', `${links.join('')}</head>`) });
  const app = createAppServer({ indexHtml: async () => '<main></main>' });
  const readRequest = () => request(`/api/artifacts/${pageId}/sql`, {
    method: 'POST', token: owner.token, json: { sql: 'select units from data3', revision: '1' },
  });
  return {
    owner,
    direct: () => sqlPost(readRequest(), params(pageId)),
    mounted: () => app.request(readRequest()),
  };
}

it('budgets a warm page SQL read that names one of five linked datasets', async () => {
  const read = await linkedPage();
  expect((await read.mounted()).status).toBe(200);
  for (const entry of ['direct', 'mounted'] as const) {
    const recorded = await recordStatements(async () => read[entry]());
    expect(recorded.value.status).toBe(200);
    expect(await recorded.value.json()).toEqual({
      columns: [{ name: 'units', type: 'number' }],
      rows: [{ units: 21 }],
      source: { kind: 'snapshot', at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), names: ['data3'] },
    });
    // The admitted page uses headers only. Each retained dataset costs one full-row load and one full-row fence.
    expect(recorded.sql.filter((statement) => /^SELECT \* FROM artifacts WHERE id = \$1 AND deleted_at IS NULL$/.test(statement)),
      recorded.sql.join('\n')).toHaveLength(2);
    console.info('[budget] page SQL %s: statements=%d', entry, recorded.count);
    expect(recorded.count, recorded.sql.join('\n')).toBe(BUDGET.pageSql);
    expect(recorded.sql.filter(statement => /FROM auth\.tokens WHERE token_hash/.test(statement))).toHaveLength(2);
    expect(recorded.sql.filter(statement => /FROM users u WHERE u\.id=\$1/.test(statement))).toHaveLength(2);
    expect(recorded.sql.filter(statement => /request_authority.*AS touch_due/.test(statement))).toHaveLength(2);
    expect(recorded.sql.some(statement => /UPDATE .*tokens SET last_used_at/.test(statement))).toBe(false);
  }
});

it('stamps a due bearer once and skips the next warm read', async () => {
  const { owner, mounted } = await linkedPage();
  const db = await getDb();
  await db.query("UPDATE tokens SET last_used_at=now()-interval '2 minutes' WHERE id=$1", [owner.id]);
  const writes = async () => {
    const recorded = await recordStatements(async () => mounted());
    expect(recorded.value.status).toBe(200);
    return recorded.sql.filter(statement => /UPDATE .*tokens SET last_used_at/.test(statement)).length;
  };
  expect(await writes()).toBe(1);
  expect(await writes()).toBe(0);
});

it.each(['revoked', 'expired', 'scoped', 'account-ineligible'] as const)(
  'withholds an already-executed mounted read when its ordinary bearer becomes %s',
  async (change) => {
    const { owner, mounted } = await linkedPage();
    expect((await mounted()).status).toBe(200);
    const engine = services().sql;
    let changed = false;
    setServices({ sql: { ...engine, async run(input, context) {
      const reply = await engine.run(input, context);
      if (!changed) {
        // A different request changes the credential after the engine runs. It cannot clear the SQL request's memo.
        await runWithRequest(request('/other-request'), async () => {
          const db = await getDb();
          if (change === 'revoked') expect(await revokeToken(owner.id)).toBe(true);
          if (change === 'expired') await db.query("UPDATE tokens SET expires_at=now() WHERE id=$1", [owner.id]);
          if (change === 'scoped') await db.query("UPDATE tokens SET request_authority=true WHERE id=$1", [owner.id]);
          if (change === 'account-ineligible') await db.query("UPDATE users SET email=NULL WHERE id=$1", [owner.userId]);
        });
        changed = true;
      }
      return reply;
    } } });
    try {
      const response = await mounted();
      expect(changed).toBe(true);
      expect({ status: response.status, body: await response.json() }).toEqual({ status: 404, body: { error: 'not_found' } });
    } finally {
      setServices({ sql: engine });
    }
    expect((await mounted()).status).toBe(404);
  },
);

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
const pageParses = vi.hoisted(() => ({ sources: [] as string[] | undefined }));
vi.mock('parse5', async (original) => {
  const actual = await original<typeof import('parse5')>();
  return { ...actual, parse: (...args: Parameters<typeof actual.parse>) => {
    pageParses.sources?.push(args[0]);
    return actual.parse(...args);
  } };
});

async function recordPageParses<T>(work: () => Promise<T>) {
  const sources: string[] = [];
  pageParses.sources = sources;
  try { return { value: await work(), sources }; }
  finally { pageParses.sources = undefined; }
}

it('budgets whole-page HTML parses on publish create and replace', async () => {
  const owner = await person('budget_html');
  const before = nativeHtml('<p>Original page</p>');
  const after = nativeHtml('<p>Replacement page</p>');
  // Create shares the authored parse across portable checks, bundle admission and storage.
  const created = await recordPageParses(() => postArtifact(owner.token, { html: before }));
  expect(created.value.status, await created.value.clone().text()).toBe(201);
  const { id } = await created.value.json();
  const previous = await head(id);
  const expectedState = artifactState(previous);
  const replaced = await recordPageParses(() => replace(request(`/api/artifacts/${id}`, {
    method: 'PUT', token: owner.token, json: { html: after, expectedVersion: 1, expectedState },
  }), params(id)));
  expect(replaced.value.status, await replaced.value.clone().text()).toBe(200);
  expect(await replaced.value.json()).toMatchObject({id, version: 2});
  console.info('[budget] HTML create=%d replace=%d', created.sources.length, replaced.sources.length);
  expect(created.sources).toEqual([before]);
  // Replace parses the authored page once and the locked previous page once to carry IDs.
  expect(replaced.sources).toEqual([after, previous.source]);
});
