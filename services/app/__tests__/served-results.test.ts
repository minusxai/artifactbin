/**
 * THE FIRST RESULTS IN THE HTML (lib/story/served-results.server): a data
 * document's reader page carries the rows its queries answer at the values
 * this request starts from, so the first paint is the numbers, not a skeleton.
 *
 * The rule under test is PARITY WITH THE QUERY ROUTE: what the page serves is
 * what `POST /a/<id>/query {values}` answers the same viewer — the same rows,
 * the same refusals, the same viewer identity — and nothing a slow query can
 * hold the HTML behind. Real handlers on the harness's isolated database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { useAppHarness, request } from '@/__tests__/harness';
import { observedRequest } from '@/__tests__/conditional-request';
import { GET as artifactPage } from '@/app/api/page/artifact/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { POST as queryRoute } from '@/app/a/[id]/query/route';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { readEvents } from '@/__tests__/sse';
import { resetLiveSubscriptions } from '@/lib/story/live';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername } from '@/lib/users';
import { setDatasetPolicy } from '@/lib/datasets/policy';
import { defaultDatasetGrants } from '@artifactbin/utils';
import { createAppServer, BOOTSTRAP_ID } from '@/server/app';
import { drainPreparedPageWarmups } from '@/lib/story/prepared-page.server';
import { services, setServices } from '@/lib/services';
import { SERVED_RESULTS_BUDGET_MS } from '@/lib/story/served-results.server';

const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null) }));

const harness = useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const asSession = (u: { id: string; email: string } | null) => { sessionUser.id = u?.id ?? ''; sessionUser.email = u?.email ?? ''; };
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>' });
const inlined = (html: string) => {
  const m = new RegExp(`<script type="application/json" id="${BOOTSTRAP_ID}">([\\s\\S]*?)</script>`).exec(html);
  return m ? JSON.parse(m[1]!) : null;
};
const storyText = (html: string) => {
  const dom = new JSDOM(html);
  const story = dom.window.document.querySelector('[data-mx-initial-story]');
  for (const style of story?.querySelectorAll('style') ?? []) style.remove();
  const text = story?.textContent ?? '';
  dom.window.close();
  return text;
};

const FIXTURES = path.resolve(process.cwd(), '../../scripts/fixtures/page-speed');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');
/** The dashboard fixture's KPI over the whole of sales.csv: sum(revenue). */
const KPI = '$744,503';

beforeEach(async () => { asSession(null); await resetLiveSubscriptions(); });

async function owner() {
  const user = await ensureUsername(await createUser({ email: `mxmx_test_served_${Math.random().toString(36).slice(2, 8)}@example.com` }));
  const t = await mintToken('served'); await claimToken(user.id, t.token);
  return { user, token: t.token, tokenId: t.id };
}
async function publish(token: string, body: Record<string, unknown>): Promise<string> {
  const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { visibility: 'public', ...body } }));
  if (made.status !== 201) throw new Error(await made.text());
  return ((await made.json()) as { id: string }).id;
}
async function dashboard() {
  const who = await owner();
  const sales = await publish(who.token, { title: 'Perf sales', dataset: fixture('sales.csv') });
  const id = await publish(who.token, { title: 'Perf C dashboard', markup: fixture('dashboard.jsx').replaceAll('{{sales}}', sales), template: 'dashboard' });
  await drainPreparedPageWarmups();
  return { ...who, sales, id };
}
const html = async (id: string, search = '') => (await app.request(`/a/${id}${search}`, { headers: { accept: 'text/html' } })).text();
const pageJson = async (id: string, search = '') => (await artifactPage(request(`/api/page/artifact/${id}${search}`), params(id))).json();
const servedOf = (body: { surface: { runtime: { data: { dataflow?: { results?: unknown } } } } }) => body.surface.runtime.data.dataflow?.results as
  { tables: Record<string, { rows: Array<Record<string, unknown>> }>; errors: Record<string, string>; mutationAccess?: Record<string, string | null>; since?: string } | undefined;
/** What the query route answers this session for these values: the parity reference. */
const routeAnswer = async (id: string, values: Record<string, unknown> = {}) =>
  (await queryRoute(request(`/a/${id}/query`, { method: 'POST', json: { values } }), params(id))).json() as Promise<{ tables: Record<string, unknown>; errors: Record<string, string>; mutationAccess?: Record<string, string | null> }>;

describe('the reader page carries its first results', () => {
  it('renders the dashboard fixture\'s KPI, table rows and select options into the anonymous HTML', async () => {
    const { id } = await dashboard();
    const page = await html(id);
    const text = storyText(page);
    expect(text).toContain(KPI);
    // The DataTable's rows are the query's at first paint, and the Select's options travel with them.
    expect(text).toContain('2025-01-01');
    const results = servedOf(inlined(page).artifact)!;
    expect(Object.keys(results.tables).sort()).toEqual(['by_product', 'monthly', 'regions']);
    expect(results.errors).toEqual({});
    expect(results.tables.regions!.rows.map((r) => r.region)).toEqual(['East', 'North', 'South', 'West']);
  });

  it('never stores data in the prepared page: its anonymous render is still the declarations alone', async () => {
    const { id } = await dashboard();
    expect(storyText(await html(id))).toContain(KPI);
    const stored = (await (await harness.db()).query<{ page: { ssr: { html: string } | null } }>('SELECT page FROM prepared_pages WHERE artifact_id = $1', [id])).rows[0]!;
    expect(stored.page.ssr?.html).toBeTruthy();
    expect(stored.page.ssr!.html).not.toContain(KPI);
  });

  it('serves exactly what the query route answers the same viewer, anonymous and signed in', async () => {
    const { id, user } = await dashboard();
    for (const who of [null, { id: user.id, email: user.email ?? '' }]) {
      asSession(who);
      const results = servedOf(await pageJson(id))!;
      const answer = await routeAnswer(id);
      expect(results.tables).toEqual(answer.tables);
      expect(results.errors).toEqual(answer.errors);
    }
  });

  it('serves the rows of the URL\'s values, as the route answers them', async () => {
    const { id } = await dashboard();
    const all = storyText(await html(id));
    const west = await html(id, '?$region=West');
    expect(storyText(west)).not.toContain(KPI);
    const results = servedOf(inlined(west).artifact)!;
    const answer = await routeAnswer(id, { region: 'West' });
    expect(results.tables).toEqual(answer.tables);
    const total = (answer.tables.monthly as { rows: Array<{ revenue: number }> }).rows.reduce((s, r) => s + r.revenue, 0);
    expect(storyText(west)).toContain(`$${total.toLocaleString('en-US')}`);
    expect(all).toContain(KPI);
  });

  it('answers the next response from the dataset as it is now', async () => {
    const { id, sales, token } = await dashboard();
    expect(storyText(await html(id))).toContain(KPI);
    const rows = fixture('sales.csv').trim().split('\n');
    const replaced = await putArtifactRoute(await observedRequest(`/api/artifacts/${sales}`, { method: 'PUT', token, json: { dataset: `${rows[0]}\n2025-01-01,North,Alpha,1000,1\n` } }), params(sales));
    expect(replaced.status, await replaced.clone().text()).toBe(200);
    await drainPreparedPageWarmups();
    const next = storyText(await html(id));
    expect(next).not.toContain(KPI);
    expect(next).toContain('$1,000');
  });
});

describe('who may see which rows', () => {
  it('gives a reader who may not read a dataset the route\'s own refusal and none of its rows', async () => {
    const who = await owner();
    const ds = await publish(who.token, { dataset: [{ region: 'EU', n: 7 }] });
    await setDatasetPolicy({ userId: who.user.id, tokenId: who.tokenId }, ds, { version: 2, allow: [{ actions: ['read'], from: { user: '$owner' } }] }, 0);
    const id = await publish(who.token, { markup: `<Helmet><Import name="d" src="ref:${ds}" /><Query name="q">{\`select sum(n) as total from d.rows\`}</Query></Helmet><p>Total <Number data="$q" col="total" /></p>` });
    await drainPreparedPageWarmups();
    // The owner reads the dataset: served rows, the route's rows.
    asSession({ id: who.user.id, email: who.user.email ?? '' });
    const own = servedOf(await pageJson(id))!;
    expect(own.tables.q).toEqual((await routeAnswer(id)).tables.q);
    expect(own.tables.q).toMatchObject({ rows: [{ total: 7 }] });
    expect(storyText(await html(id))).toMatch(/Total\s*7/);
    // A stranger does not: no rows, and the refusal is the route's own, word for word.
    asSession(null);
    const stranger = servedOf(await pageJson(id))!;
    const answer = await routeAnswer(id);
    expect(stranger.tables).not.toHaveProperty('q');
    expect(answer.tables).not.toHaveProperty('q');
    expect(stranger.errors).toEqual(answer.errors);
    expect(stranger.errors.q).toEqual(expect.any(String));
    expect(storyText(await html(id))).not.toMatch(/Total\s*7/);
  });

  it('runs a query that reads the viewer as the viewer, as the route does', async () => {
    const who = await owner();
    const id = await publish(who.token, { markup: `<Helmet><Query name="me">{\`select coalesce($_me.id, 'guest') as who\`}</Query></Helmet><DataTable data="$me" height="120px" />` });
    await drainPreparedPageWarmups();
    asSession({ id: who.user.id, email: who.user.email ?? '' });
    const mine = servedOf(await pageJson(id))!;
    expect(mine.tables.me).toMatchObject({ rows: [{ who: who.user.id }] });
    expect(mine.tables).toEqual((await routeAnswer(id)).tables);
    asSession(null);
    const guest = servedOf(await pageJson(id))!;
    expect(guest.tables.me).toMatchObject({ rows: [{ who: 'guest' }] });
  });

  it('answers the write checks the route answers beside its rows, anonymous and as the owner', async () => {
    const who = await owner();
    const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: who.token, json: { dataset: [{ n: 1 }], access: 'readwrite' } }));
    expect(made.status).toBe(201);
    const ds = ((await made.json()) as { id: string }).id;
    await setDatasetPolicy({ userId: who.user.id, tokenId: who.tokenId }, ds, defaultDatasetGrants(), 0);
    const id = await publish(who.token, { markup: `<Helmet><Import name="d" src="ref:${ds}" /><Query name="rows">{\`select count(*) as n from d.rows\`}</Query><Mutation name="add">{\`insert into d.rows values (2)\`}</Mutation></Helmet><p><Number data="$rows" col="n" /></p><Button run="$add">Add</Button>` });
    await drainPreparedPageWarmups();
    const seen: Array<Record<string, string | null> | undefined> = [];
    for (const who2 of [null, { id: who.user.id, email: who.user.email ?? '' }]) {
      asSession(who2);
      const results = servedOf(await pageJson(id))!;
      const answer = await routeAnswer(id);
      expect(answer.mutationAccess).toBeDefined();
      expect(results.mutationAccess).toEqual(answer.mutationAccess);
      expect(results.tables).toEqual(answer.tables);
      seen.push(results.mutationAccess);
    }
    // The two viewers are answered differently, so the parity above compares something.
    expect(seen[0]).not.toEqual(seen[1]);
  });

  it('serves nothing on a render the query route would not answer for this viewer: an archived version', async () => {
    const { id, user, token, sales } = await dashboard();
    const edited = await putArtifactRoute(await observedRequest(`/api/artifacts/${id}`, { method: 'PUT', token, json: { markup: fixture('dashboard.jsx').replace('Sales dashboard', 'Sales board').replaceAll('{{sales}}', sales) } }), params(id));
    expect(edited.status, await edited.clone().text()).toBe(200);
    asSession({ id: user.id, email: user.email ?? '' });
    // The head, for the same viewer, does carry them.
    expect(servedOf(await pageJson(id))!.tables).toHaveProperty('monthly');
    const archived = await pageJson(id, '?version=1');
    expect(archived.archived).toMatchObject({ version: 1 });
    expect(servedOf(archived)).toBeUndefined();
  });

  it('leaves a query that reads the reader\'s time zone to the page, which alone knows it', async () => {
    const who = await owner();
    const id = await publish(who.token, { markup: `<Helmet><Query name="zone">{\`select $_tz as tz\`}</Query><Query name="n">{\`select 41 + 1 as n\`}</Query></Helmet><p><Number data="$n" col="n" /></p><DataTable data="$zone" height="120px" />` });
    await drainPreparedPageWarmups();
    const results = servedOf(await pageJson(id))!;
    expect(results.tables).toHaveProperty('n');
    expect(results.tables).not.toHaveProperty('zone');
    expect(results.errors).not.toHaveProperty('zone');
  });
});

describe('the budget', () => {
  it('never holds the HTML behind a slow query: past the budget the rows are left to the page', async () => {
    const who = await owner();
    const id = await publish(who.token, { markup: `<Helmet><Query name="slow">{\`select 'slow_marker' as label, 5 as n\`}</Query></Helmet><p><Number data="$slow" col="n" /></p>` });
    await drainPreparedPageWarmups();
    const real = services();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    setServices({ ...real, sql: { ...real.sql, run: async (input) => {
      if (JSON.stringify(input.queries).includes('slow_marker')) await held;
      return real.sql.run(input);
    } } });
    try {
      const started = performance.now();
      const body = await pageJson(id);
      const took = performance.now() - started;
      expect(servedOf(body)).toBeUndefined();
      expect(took).toBeLessThan(SERVED_RESULTS_BUDGET_MS + 1000);
      expect(took).toBeGreaterThanOrEqual(SERVED_RESULTS_BUDGET_MS - 5);
    } finally {
      release();
      setServices(real);
    }
    // Once the engine answers in time, the same page carries the rows.
    expect(servedOf(await pageJson(id))!.tables.slow).toMatchObject({ rows: [{ label: 'slow_marker', n: 5 }] });
  });
});

describe('the standalone document', () => {
  it('keeps /raw on the page\'s own first run: its live stream cannot yet pick up where served rows left off', async () => {
    const { id } = await dashboard();
    const res = await rawRoute(request(`/a/${id}/raw`), params(id));
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('"results":');
  });
});

describe('the live stream picks up where the served results left off', () => {
  const stream = (id: string, since?: string) => eventsRoute(request(`/a/${id}/events${since ? `?since=${encodeURIComponent(since)}` : ''}`), params(id));

  it('sends a data frame at once for a dataset that changed between the page and the stream', async () => {
    const { id, sales, token } = await dashboard();
    const since = servedOf(await pageJson(id))!.since!;
    expect(since).toEqual(expect.any(String));
    const rows = fixture('sales.csv').trim().split('\n');
    const replaced = await putArtifactRoute(await observedRequest(`/api/artifacts/${sales}`, { method: 'PUT', token, json: { dataset: `${rows[0]}\n2025-01-01,North,Alpha,1000,1\n` } }), params(sales));
    expect(replaced.status).toBe(200);
    const res = await stream(id, since);
    expect(res.status).toBe(200);
    const data = (await readEvents(res.body!, 2)).find((e) => e.event === 'data');
    expect(data?.data).toMatchObject({ datasets: [sales] });
  });

  it('covers a change to who may read the dataset, not only to its rows', async () => {
    const { id, sales } = await dashboard();
    const since = servedOf(await pageJson(id))!.since!;
    await (await harness.db()).query('UPDATE artifacts SET sharing_revision = sharing_revision + 1 WHERE id = $1', [sales]);
    const data = (await readEvents((await stream(id, since)).body!, 2)).find((e) => e.event === 'data');
    expect(data?.data).toMatchObject({ datasets: [sales] });
  });

  it('sends nothing when nothing changed, and ignores a token it cannot read', async () => {
    const { id } = await dashboard();
    const since = servedOf(await pageJson(id))!.since!;
    for (const token of [since, 'not a token', `${'x'.repeat(6)}.deadbeef0000`]) {
      const events = await readEvents((await stream(id, token)).body!, 2, 800);
      expect(events.filter((e) => e.event === 'data')).toEqual([]);
    }
  });
});
