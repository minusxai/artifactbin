/**
 * The dataflow at render: dataflowForRow resolves the datasets a document's
 * SQL names by ownership, runs the queries, and the served document's JSON
 * island carries the declarations + state — while the datasets themselves are
 * NOT inlined (only their query results are).
 */
import { describe, expect, it } from 'vitest';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { dataflowForRow, getArtifactById } from '@/lib/artifacts';


import { STORY_ISLAND_ID, type StoryIslandData } from '@/lib/story-runtime/contract';
import { mintToken } from '@/lib/tokens';
import { useAppHarness, request } from '@/__tests__/harness';

const harness = useAppHarness();

const BASE = 'http://localhost:3000';
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const create = async (token: string, body: Record<string, unknown>) =>
  createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));

const ROWS = [{ region: 'EU', revenue: 837 }, { region: 'NA', revenue: 1200 }, { region: 'EU', revenue: 3 }];

const island = (html: string): StoryIslandData => {
  const open = html.indexOf(`id="${STORY_ISLAND_ID}"`);
  const start = html.indexOf('>', open) + 1;
  const end = html.indexOf('</script>', start);
  return JSON.parse(html.slice(start, end)) as StoryIslandData;
};

const DOC = (ds: string) =>
  '<Helmet><Value name="region" type="string" />' +
  `<Query name="sales">{\`select region, sum(revenue) revenue from ref_${ds} where $region is null or region = $region group by 1 order by 1\`}</Query>` +
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
    expect(flow!.state.errors.sales).toMatch(new RegExp(`ref_${ds}`));
    expect(flow!.state.tables.sales).toBeUndefined();
  });
});

describe('the served document', () => {
  it('carries the declarations in its island and inlines neither the dataset nor the query results', async () => {
    const t = await mintToken('t');
    const ds = ((await (await create(t.token, { dataset: ROWS })).json()) as { id: string }).id;
    const doc = ((await (await create(t.token, { markup: DOC(ds) })).json()) as { id: string }).id;
    const res = await rawRoute(request(`/a/${doc}/raw`), params({ id: doc }));
    expect(res.status).toBe(200);
    const html = await res.text();
    const data = island(html);
    expect(data.dataflow?.flow.values.map((v) => v.name)).toEqual(['region']);
    // Paint first: the reader's copy carries no rows at all — not the dataset,
    // and not the aggregate the query would have made of it. The document asks
    // for those itself, through the queryUrl beside them here.
    expect(data.dataflow?.state).toBeUndefined();
    expect(html).not.toContain('"revenue":840');
    // The raw dataset (three rows, one of them revenue 3) never reaches the page.
    expect(html).not.toContain('"revenue":3}');
    expect(data.refData[ds]).toBeUndefined();
  });

  it('carries no dataflow for a document without declarations', async () => {
    const t = await mintToken('t');
    const doc = ((await (await create(t.token, { markup: '<div><Badge>plain</Badge></div>' })).json()) as { id: string }).id;
    const html = await (await rawRoute(request(`/a/${doc}/raw`), params({ id: doc }))).text();
    expect(island(html).dataflow).toBeUndefined();
  });
});
