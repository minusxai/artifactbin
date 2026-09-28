/**
 * THE COMPILED PAGE CARRIES ITS ENGINE'S TWO FACTS (w3-page-engine; lib/islands/contract IslandPageData
 * `hold` and `sqliteWasm`), decided as today's reader decides them (lib/story/prepare-runtime readerIslandData):
 *
 * - `hold`: the imports this page may hold in full, for the door the page queries through
 *   (lib/artifacts holdableImports) — the app page's reader (a guest, or the signed-in account that owns
 *   the dataset); `/raw`, whose door is credential-free, the anonymous reader's;
 * - `sqliteWasm`: the engine's content-addressed wasm (today's runtime build), only when there is
 *   something to hold.
 *
 * Real routes, the harness's database, the reader switch in shadow for this file.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { createAppServer } from '@/server/app';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername } from '@/lib/users';
import { drainPreparedPageWarmups } from '@/lib/story/prepared-page.server';
import { setCompiledReaderFlagForTests } from '@/lib/compiled-page/reader-mode';
import { ISLAND_DATA_ID, READER_MODE_HEADER } from '@/lib/compiled-page/contract';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import type { IslandPageData } from '@/lib/islands/contract';

const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null) }));
useAppHarness();
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>' });

beforeAll(() => setCompiledReaderFlagForTests('shadow'));
const asSession = (u: { id: string; email: string } | null) => { sessionUser.id = u?.id ?? ''; sessionUser.email = u?.email ?? ''; };
beforeEach(() => asSession(null));
async function account() {
  const user = await ensureUsername(await createUser({ email: `mxmx_test_page_engine_${Math.random().toString(36).slice(2, 8)}@example.com` }));
  const t = await mintToken('page-engine'); await claimToken(user.id, t.token);
  return { user, token: t.token, session: { id: user.id, email: user.email ?? '' } };
}
afterAll(() => setCompiledReaderFlagForTests(null));

async function create(token: string, body: Record<string, unknown>): Promise<string> {
  const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { visibility: 'unlisted', ...body } }));
  if (made.status !== 201) throw new Error(await made.text());
  const id = ((await made.json()) as { id: string }).id;
  await drainPreparedPageWarmups();
  return id;
}
const islandData = (html: string): IslandPageData => JSON.parse(new JSDOM(html).window.document.getElementById(ISLAND_DATA_ID)?.textContent ?? 'null') as IslandPageData;

const SALES = (ds: string) => `<Helmet><Value name="region" type="string" />
<Import name="regions_data" src="ref:${ds}" /><Query name="regions">{\`select distinct region from regions_data.rows order by 1\`}</Query>
<Import name="sales_data" src="ref:${ds}" /><Query name="sales">{\`select region, sum(revenue) revenue from sales_data.rows where $region is null or region = $region group by 1 order by 1\`}</Query>
</Helmet><div><select aria-label="Region" value="$region" options="$regions" /><p>Total <Number data="$sales" col="revenue" agg="sum" /></p></div>`;
const ROWS = [{ region: 'EU', revenue: 837 }, { region: 'NA', revenue: 1200 }];

async function appPage(id: string): Promise<IslandPageData> {
  const res = await app.request(`/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } });
  expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
  return islandData(await res.text());
}

describe('the compiled page\'s engine facts', () => {
  it('a guest on a public dataset may hold every import reading it, and gets the engine\'s wasm', async () => {
    const t = await mintToken('page-engine');
    const ds = await create(t.token, { title: 'sales', dataset: ROWS, visibility: 'public' });
    const id = await create(t.token, { title: 'Sales', markup: SALES(ds), visibility: 'public' });
    const data = await appPage(id);
    expect(data.hold).toEqual(['regions_data', 'sales_data']);
    expect(data.state, 'a healthy page must start its own engine instead of treating prepared rows as settled state').toBeUndefined();
    const wasm = loadCompilerBuild().sqliteWasm;
    expect(wasm, 'the island build records the engine\'s wasm').toMatch(/^\/islands\/sqlite3-[0-9a-f]{16}\.wasm$/);
    expect(data.sqliteWasm).toBe(wasm);
  });

  it('holdings are the door\'s reader\'s: a private dataset is its owner\'s to hold on the app page, nobody\'s on /raw or for a guest', async () => {
    const who = await account();
    const ds = await create(who.token, { title: 'private sales', dataset: ROWS, visibility: 'private' });
    const id = await create(who.token, { title: 'Sales', markup: SALES(ds), visibility: 'public' });

    const guest = await appPage(id);
    expect(guest.signedIn).toBe(false);
    expect(guest.hold).toEqual([]);
    expect(guest.sqliteWasm, 'nothing to hold: no engine').toBeUndefined();

    asSession(who.session);
    const owner = await appPage(id);
    expect(owner.signedIn).toBe(true);
    expect(owner.hold).toEqual(['regions_data', 'sales_data']);
    expect(owner.sqliteWasm).toBe(loadCompilerBuild().sqliteWasm);

    // /raw queries through the credential-free door, whoever asks: the anonymous reader's holdings (today's /raw).
    const raw = await rawRoute(request(`/a/${id}/raw?reader=compiled`), { params: Promise.resolve({ id }) });
    expect(raw.headers.get(READER_MODE_HEADER)).toBe('compiled');
    expect(islandData(await raw.text()).hold).toEqual([]);
  });

  it('a page that declares no data holds nothing', async () => {
    const t = await mintToken('page-engine');
    const id = await create(t.token, { title: 'Pick', markup: '<Helmet><Value name="size" type="string" default="S" /></Helmet><div><Segmented label="Size" value="$size" options={["S","M"]} /></div>' });
    const data = await appPage(id);
    expect(data.hold).toEqual([]);
    expect(data.sqliteWasm).toBeUndefined();
  });
});
