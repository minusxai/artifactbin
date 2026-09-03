/**
 * F2 — the SERVING half: a shared link's `?$name=value` reaches the document.
 *
 * Three doors, one grammar (lib/story/url-values):
 *  - the READER's document (`/a/<id>/raw`) is seeded through the island's
 *    third dataflow field — values, no rows — so paint-first is untouched and
 *    the control the server paints already shows the reader's pick;
 *  - the CAPTURE (`chrome=0`, what /export photographs) has to be SETTLED
 *    rather than fast, so its selection is threaded into `dataflowForRow`
 *    instead and the rows it carries are the selected ones;
 *  - `/a/<id>/export?$name=…` passes the selection down to the page it shoots,
 *    and does NOT serve the default shot out of the cache instead.
 *
 * The reserved keys the server itself reads on this URL — `key`, `chrome`,
 * `edit`, `comment`, `v` — carry no `$`, and a Value can never be named with
 * one, so nothing here can shadow them.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { fakeBrowser } from '@artifactbin/utils';
import type { RenderRequest } from '@artifactbin/contracts';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as exportRoute } from '@/app/a/[id]/export/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { resetExportRenderer } from '@/lib/export';
import { setServices } from '@/lib/services';
import { STORY_ISLAND_ID, type StoryIslandData } from '@/lib/story-runtime/contract';
import { mintToken } from '@/lib/tokens';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const create = async (token: string, body: Record<string, unknown>) =>
  createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: body }));

const ROWS = [{ region: 'EU', revenue: 800 }, { region: 'NA', revenue: 1200 }, { region: 'EU', revenue: 40 }];

const DOC = (ds: string) =>
  '<Helmet><Value name="region" type="string" default="EU" /><Value name="top" type="number" default={10} />' +
  `<Query name="sales">{\`select region, sum(revenue) revenue from ref_${ds} where $region is null or region = $region group by 1 order by 1\`}</Query>` +
  '</Helmet><div><select aria-label="Region" value="$region" options="$sales" /><Question data="$sales" viz={{"kind":"table"}} /></div>';

const island = (html: string): StoryIslandData => {
  const open = html.indexOf(`id="${STORY_ISLAND_ID}"`);
  const start = html.indexOf('>', open) + 1;
  return JSON.parse(html.slice(start, html.indexOf('</script>', start))) as StoryIslandData;
};

/** A published dataset + document over it. */
async function published(): Promise<{ id: string; token: string }> {
  const t = await mintToken('t');
  const ds = ((await (await create(t.token, { dataset: ROWS })).json()) as { id: string }).id;
  const doc = ((await (await create(t.token, { markup: DOC(ds) })).json()) as { id: string }).id;
  return { id: doc, token: t.token };
}

const raw = async (id: string, search = ''): Promise<string> => {
  const res = await rawRoute(new Request(`${BASE}/a/${id}/raw${search}`), params(id));
  expect(res.status).toBe(200);
  return res.text();
};

describe('the reader\'s document, opened at a link that names a selection', () => {
  it('seeds the island with the URL values — and still no rows (paint first)', async () => {
    const { id } = await published();
    const data = island(await raw(id, '?$region=NA'));
    expect(data.dataflow?.values).toEqual({ region: 'NA' });
    expect(data.dataflow?.state).toBeUndefined();
  });

  it('ignores what the flow does not declare, and a value the type refuses', async () => {
    const { id } = await published();
    // `nope` is undeclared; `top` is a number and "ten" is not one; `chrome`,
    // `edit` and `v` are the server's own keys and carry no `$`.
    const data = island(await raw(id, '?$nope=1&$top=ten&chrome=1&edit=0&v=2'));
    expect(data.dataflow?.values).toBeUndefined();
  });

  it('a link with no selection carries none — the plain address is the document at rest', async () => {
    const { id } = await published();
    expect(island(await raw(id, '')).dataflow?.values).toBeUndefined();
  });
});

describe('the CAPTURE render (chrome=0), which /export photographs', () => {
  it('runs the dataflow WITH the selection, so the photograph is of the selected document', async () => {
    const { id } = await published();
    const data = island(await raw(id, '?chrome=0&$region=NA'));
    expect(data.dataflow?.state?.values.region).toBe('NA');
    expect(data.dataflow?.state?.tables.sales?.rows).toEqual([{ region: 'NA', revenue: 1200 }]);
    // A settled render seeds through `state`; the third field would be a
    // second, redundant answer to the same question.
    expect(data.dataflow?.values).toBeUndefined();
  });

  it('keeps the declared defaults when the link names nothing', async () => {
    const { id } = await published();
    const data = island(await raw(id, '?chrome=0'));
    expect(data.dataflow?.state?.values.region).toBe('EU');
    expect(data.dataflow?.state?.tables.sales?.rows).toEqual([{ region: 'EU', revenue: 840 }]);
  });
});

describe('GET /a/<id>/export with a selection', () => {
  let fake: ReturnType<typeof fakeBrowser> & { calls: unknown[] };
  beforeEach(async () => {
    await resetExportRenderer();
    fake = fakeBrowser() as typeof fake;
    setServices({ browser: fake });
  });
  afterEach(() => setServices({}));
  const shot = (n: number) => (fake.calls[n] as RenderRequest).url;

  it('photographs the SELECTED document, and does not serve the default shot from the cache', async () => {
    const { id, token } = await published();
    const req = (search: string) => exportRoute(request(`/a/${id}/export${search}`, { token }), params(id));
    expect((await req('')).status).toBe(200);
    expect((await req('?$region=NA')).status).toBe(200);
    expect(fake.calls.length).toBe(2);
    expect(shot(0)).not.toContain('$region');
    expect(shot(1)).toContain('$region=NA');
    expect(shot(1)).toContain('chrome=0');
  });

  it('the og CARD keeps the defaults — an unfurl is of the document, not of one reader\'s view', async () => {
    const { id, token } = await published();
    const res = await exportRoute(request(`/a/${id}/export?mode=card&$region=NA`, { token }), params(id));
    expect(res.status).toBe(200);
    expect(shot(0)).not.toContain('$region');
  });
});

/**
 * F2 ROUND 2 — THE SHOT'S IDENTITY IS THE SELECTION THE DOCUMENT ACTUALLY HAS,
 * not the `$` params somebody typed.
 *
 * Making the selection part of the render cache key is what stopped `?$region=NA`
 * being answered with the picture of the defaults. But keying on the RAW params
 * gave the same document unlimited distinct keys: the raw route ignores a name
 * the document does not declare, a value its type refuses, and a value already at
 * its default — so `?$junk=17` renders bytes identical to the default shot and
 * then stores them under a key of their own, permanently (export objects are
 * version-keyed and never invalidated). At the EXPORT door's own ceiling — 30 a
 * minute per actor, ~43,000 a day — that is a cache-fill vector any reader of a
 * public document can pull.
 *
 * So the token is derived through the FLOW, the same way the served document is:
 * `readUrlValues` then the non-default values only, canonically ordered. Anything
 * the document would ignore collapses onto the default shot's key byte for byte,
 * and one selection has exactly one key however its link was written.
 */
describe('the export cache key is the SELECTION, canonicalized through the flow', () => {
  let fake: ReturnType<typeof fakeBrowser> & { calls: unknown[] };
  beforeEach(async () => {
    await resetExportRenderer();
    fake = fakeBrowser() as typeof fake;
    setServices({ browser: fake });
  });
  afterEach(() => setServices({}));
  const urls = () => fake.calls.map((c) => (c as RenderRequest).url);

  it('a name the document does not declare is the DEFAULT shot, not a new one', async () => {
    const { id, token } = await published();
    const req = (search: string) => exportRoute(request(`/a/${id}/export${search}`, { token }), params(id));
    expect((await req('')).status).toBe(200);
    expect((await req('?$junk=17')).status).toBe(200);
    expect(fake.calls.length).toBe(1);
    expect(urls()[0]).not.toContain('junk');
  });

  it('a value already at its default is the DEFAULT shot', async () => {
    const { id, token } = await published();
    const req = (search: string) => exportRoute(request(`/a/${id}/export${search}`, { token }), params(id));
    expect((await req('')).status).toBe(200);
    // `region` is declared `default="EU"`; asking for EU is asking for the document.
    expect((await req('?$region=EU')).status).toBe(200);
    expect(fake.calls.length).toBe(1);
    expect(urls()[0]).not.toContain('$region');
  });

  it('a value the declared type refuses is the DEFAULT shot', async () => {
    const { id, token } = await published();
    const req = (search: string) => exportRoute(request(`/a/${id}/export${search}`, { token }), params(id));
    expect((await req('')).status).toBe(200);
    // `top` is a number; the document ignores "ten", so the picture is the default one.
    expect((await req('?$top=ten')).status).toBe(200);
    expect(fake.calls.length).toBe(1);
  });

  it('the same selection written in either order is ONE shot', async () => {
    const { id, token } = await published();
    const req = (search: string) => exportRoute(request(`/a/${id}/export${search}`, { token }), params(id));
    expect((await req('?$region=NA&$top=5')).status).toBe(200);
    expect((await req('?$top=5&$region=NA')).status).toBe(200);
    expect(fake.calls.length).toBe(1);
  });

  it('…and a real, non-default selection still gets its own shot', async () => {
    const { id, token } = await published();
    const req = (search: string) => exportRoute(request(`/a/${id}/export${search}`, { token }), params(id));
    expect((await req('')).status).toBe(200);
    expect((await req('?$region=NA')).status).toBe(200);
    expect((await req('?$region=NA&$top=5')).status).toBe(200);
    expect(fake.calls.length).toBe(3);
    expect(urls()[1]).toContain('$region=NA');
    expect(urls()[2]).toContain('$top=5');
  });
});
