/**
 * The dataflow at render: dataflowForRow resolves the datasets a document's
 * SQL names by ownership, runs the queries, and the served document's JSON
 * island carries the first query result and URL values — while the datasets themselves are
 * NOT inlined. Declarations live in the compiled document module.
 */
import { describe, expect, it } from 'vitest';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { dataflowForRow, getArtifactById } from '@/lib/artifacts';


import type { IslandPageData } from '@/lib/islands/contract';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { claimToken, createUser } from '@/lib/accounts';
import { agentCookie, useAppHarness, request } from '@/__tests__/harness';
import { ISLAND_DATA_ID } from '@/lib/story-runtime/contract';

const harness = useAppHarness();

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const create = async (token: string, body: Record<string, unknown>) =>
  createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: { visibility: 'public', ...body } }));

const ROWS = [{ region: 'EU', revenue: 837 }, { region: 'NA', revenue: 1200 }, { region: 'EU', revenue: 3 }];

const island = (html: string): IslandPageData => {
  const open = html.indexOf(`id="${ISLAND_DATA_ID}"`);
  const start = html.indexOf('>', open) + 1;
  const end = html.indexOf('</script>', start);
  return JSON.parse(html.slice(start, end)) as IslandPageData;
};

const DOC = (ds: string) =>
  '<Helmet><Value name="region" type="string" />' +
  `<Import name="sales_data" src="ref:${ds}" /><Query name="sales">{\`select region, sum(revenue) revenue from sales_data.rows where $region is null or region = $region group by 1 order by 1\`}</Query>` +
  '</Helmet><div><select value="$region" options="$sales" /><Question data="$sales" viz={{"kind":"table"}} /></div>';

describe('dataflowForRow', () => {
  it('runs the document over its own datasets with defaults', async () => {
    const t = await mintToken('t');
    const ds = ((await (await create(t.token, { dataset: ROWS })).json()) as { id: string }).id;
    const doc = ((await (await create(t.token, { markup: DOC(ds) })).json()) as { id: string }).id;
    const flow = await dataflowForRow((await getArtifactById(doc))!);
    expect(flow).not.toBeNull();
    expect(flow!.flow.queries.map((q) => q.name)).toEqual(['sales']);
    expect(flow!.state.values).toEqual({ region: null });
    expect(flow!.state.tables.sales.rows).toEqual([{ region: 'EU', revenue: 840 }, { region: 'NA', revenue: 1200 }]);
  });

  it('applies value overrides and can run a subset', async () => {
    const t = await mintToken('t');
    const ds = ((await (await create(t.token, { dataset: ROWS })).json()) as { id: string }).id;
    const doc = ((await (await create(t.token, { markup: DOC(ds) })).json()) as { id: string }).id;
    const flow = await dataflowForRow((await getArtifactById(doc))!, { values: { region: 'NA' }, only: ['sales'] });
    expect(flow!.state.tables.sales.rows).toEqual([{ region: 'NA', revenue: 1200 }]);
  });

  it('is null for a document with no declarations', async () => {
    const t = await mintToken('t');
    const doc = ((await (await create(t.token, { markup: '<p>plain</p>' })).json()) as { id: string }).id;
    expect(await dataflowForRow((await getArtifactById(doc))!)).toBeNull();
  });

  it('a dataset deleted after publish reads as a query error, not a crash', async () => {
    const t = await mintToken('t');
    const ds = ((await (await create(t.token, { dataset: ROWS })).json()) as { id: string }).id;
    const doc = ((await (await create(t.token, { markup: DOC(ds) })).json()) as { id: string }).id;
    const db = await harness.db();
    await db.query('DELETE FROM artifacts WHERE id = $1', [ds]);
    const flow = await dataflowForRow((await getArtifactById(doc))!);
    expect(flow!.state.errors.sales).toMatch(new RegExp(`ref:${ds}`));
    expect(flow!.state.tables.sales).toBeUndefined();
  });
});

describe('the served document', () => {
  it('carries its first query result but not the source dataset', async () => {
    const t = await mintToken('t');
    const ds = ((await (await create(t.token, { dataset: ROWS })).json()) as { id: string }).id;
    const doc = ((await (await create(t.token, { markup: DOC(ds) })).json()) as { id: string }).id;
    const res = await rawRoute(request(`/a/${doc}/raw`), params({ id: doc }));
    expect(res.status).toBe(200);
    const html = await res.text();
    const data = island(html);
    expect(data.values).toEqual({});
    expect(data.results?.tables.sales?.rows).toEqual([{ region: 'EU', revenue: 840 }, { region: 'NA', revenue: 1200 }]);
    // The raw dataset (three rows, one of them revenue 3) never reaches the page.
    expect(html).not.toContain('"revenue":3}');
    expect(JSON.stringify(data)).not.toContain(`ref:${ds}`);
  });

  it('carries no dataflow for a document without declarations', async () => {
    const t = await mintToken('t');
    const doc = ((await (await create(t.token, { markup: '<div><Badge>plain</Badge></div>' })).json()) as { id: string }).id;
    const html = await (await rawRoute(request(`/a/${doc}/raw`), params({ id: doc }))).text();
    expect(html).not.toContain(`id="${ISLAND_DATA_ID}"`);
  });

  /*
   * WHO IS READING, on the island — the wiring the runtime's own tests cannot
   * see, because they inject `viewer` as a prop.
   *
   * The third case is the one that keeps /export's cache honest: a CAPTURE is
   * photographed by a session-less browser, so it is a guest render by
   * construction, and the route pins it to nobody on purpose. A cached export
   * is therefore never one reader's view of a document (lib/export
   * exportCacheKey carries no viewer, and `$_me` can never reach the selection
   * token because only DECLARED scalars do).
   */
  it('tells the document who is reading, and tells a capture nobody', async () => {
    const user = await createUser({ email: 'mxmx_test_island_reader@example.com', name: 'Ada' });
    const t = await mintToken('reader-identity', user.id);
    await claimToken(user.id, t.token);
    const cookie = await agentCookie([t.id]);
    const doc = ((await (await create(t.token, { markup: '<p>Reading as <User userId="$_me.id" /></p>', visibility: 'public' })).json()) as { id: string }).id;

    const signedIn = island(await (await rawRoute(request(`/a/${doc}/raw`, { cookie }), params({ id: doc }))).text());
    // A claimed agent token is not an app session; no viewer identity rides in the island.
    expect(signedIn.signedIn).toBe(false);
    expect(JSON.stringify(signedIn)).not.toContain(user.id);
    expect(JSON.stringify(signedIn)).not.toContain('@');

    const guest = island(await (await rawRoute(request(`/a/${doc}/raw`), params({ id: doc }))).text());
    expect(guest.signedIn).toBe(false);

    const capture = island(await (await rawRoute(request(`/a/${doc}/raw?chrome=0`, { cookie }), params({ id: doc }))).text());
    expect(JSON.stringify(capture)).not.toContain(user.id);
  });
});
