/**
 * DRAFTS (lib/page-drafts, POST /api/page/drafts, server/pages-host): a signed-in reader's own unpublished HTML and
 * the files beside it, shown in a frame on a fresh `draft-<random>.<pages host>` origin, through the real app server.
 * A CSV linked as a dataset is a read-only table the page's `sql` answers in the frame; nothing is stored, published or
 * uploaded (the host module's half, `mountDraft`, is lib/html-reader/__tests__/host-shell-draft.test.ts). The document is released once per one-time ticket; its files are served read-only while the draft lives;
 * the draft origin reaches nothing of the app; the limits are enforced with a code the embedding app can show.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import type { Actor } from '@artifactbin/contracts';
import { getDb } from '@/lib/platform';
import { pagesSite } from '@/lib/http';
import { DRAFT_LIMITS, resetDrafts } from '@/lib/page-drafts';
import { createAppServer } from '@/server/app';
import { mintAccountToken, request, useAppHarness } from './harness';

const site = pagesSite();
const APP = site.app;
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><body></body></html>', pagesSite: site });
useAppHarness();
afterEach(() => resetDrafts());

const session = (who: { userId: string | null; email: string | null }): Actor =>
  ({ credential: 'session', sessionId: `draft-${who.userId}`, userId: who.userId!, email: who.email ?? '', emailVerified: true });
const b64 = (text: string) => Buffer.from(text).toString('base64');
const PAGE = '<!doctype html><html><head><title>Orders</title><link rel="stylesheet" href="./style.css">'
  + '<link rel="af-dataset" data-af-name="orders" href="./orders.csv"></head>'
  + '<body><h1>Orders</h1><af-chart sql="select region, sum(amount) as total from orders group by region"></af-chart>'
  + '<script type="module">import "@afbin/chart"; import {sql} from "@afbin/apollo"; document.title = String((await sql`select count(*) as n from orders`)[0].n);</script></body></html>';
const FILES = [
  { path: 'style.css', base64: b64('h1{color:teal}') },
  { path: 'orders.csv', base64: b64('region,amount,day\nWest,10,2026-01-02\nEast,2.5,2026-01-03\nWest,4,2026-01-04\n') },
];
const post = (reader: Actor | null, body: unknown, origin = APP) =>
  app.request(request('/api/page/drafts', { method: 'POST', json: body, origin, headers: { 'sec-fetch-site': origin === APP ? 'same-origin' : 'same-site' }, ...(reader ? { actor: reader } : {}) }));
const get = (url: string, headers: Record<string, string> = {}) => app.request(url, { headers });
const artifacts = async () => (await (await getDb()).query<{ n: number }>('SELECT count(*)::int n FROM artifacts')).rows[0]!.n;

describe('POST /api/page/drafts', () => {
  it('needs a signed-in reader and a same-origin caller', async () => {
    expect((await post(null, { html: PAGE, files: FILES })).status).toBe(401);
    const owner = await mintAccountToken('draft_owner');
    expect((await post(session(owner), { html: PAGE, files: FILES }, 'https://elsewhere.example')).status).toBe(403);
  });

  it('serves the page once on its own draft origin, with each CSV as a read-only table and nothing stored', async () => {
    const owner = await mintAccountToken('draft_owner');
    const before = await artifacts();
    const response = await post(session(owner), { html: PAGE, files: FILES, title: 'Orders' });
    const answer = await response.json() as { src: string; origin: string; appOrigin: string; limits: typeof DRAFT_LIMITS };
    expect(response.status, JSON.stringify(answer)).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(answer.appOrigin).toBe(APP);
    expect(new URL(answer.origin).hostname).toMatch(new RegExp(`^draft-[a-z2-7]{26}\\.${site.host.replace(/\./g, '\\.')}$`));
    expect(new URL(answer.src).origin).toBe(answer.origin);
    expect(new URL(answer.src).searchParams.get('_pt')).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(answer.limits).toEqual(DRAFT_LIMITS);

    const page = await get(answer.src);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('set-cookie')).toBeNull();
    const csp = page.headers.get('content-security-policy')!;
    expect(csp).toContain(`frame-ancestors ${APP}`);
    expect(csp).toContain("default-src 'none'");
    // No door of the app is reachable from a draft: its policy names none.
    expect(csp).not.toContain(`${APP}/a/`);
    const html = await page.text();
    const config = JSON.parse(/<script type="application\/json" data-af="runtime">([^<]*)<\/script>/.exec(html)![1]!);
    expect(config).toMatchObject({ draft: true, offline: false, appOrigin: APP, datasets: ['orders'] });
    // The hosted library and component import map stays, as on a published page.
    expect(config.libraries).toBeTypeOf('object');
    const data = JSON.parse(/<script type="application\/json" data-af="offline-data">([^<]*)<\/script>/.exec(html)![1]!);
    expect(data.tables).toEqual([{ schema: 'main', name: 'orders', columns: [{ name: '_id', type: 'string' }, { name: 'region', type: 'string' }, { name: 'amount', type: 'number' }, { name: 'day', type: 'date' }],
      rows: [{ _id: '1', region: 'West', amount: 10, day: '2026-01-02' }, { _id: '2', region: 'East', amount: 2.5, day: '2026-01-03' }, { _id: '3', region: 'West', amount: 4, day: '2026-01-04' }] }]);
    // The engine is the shared hosted module, never embedded in a draft.
    expect(html).not.toMatch(/<script[^>]*data-af="offline-sql"/);
    // Each element the reader wrote is addressed as a published page's is, and knows where its start tag is in that source.
    const h1 = /<h1 data-af-id="(af-\d+)">Orders<\/h1>/.exec(html)?.[1];
    expect(h1).toBeTruthy();
    expect(config.sourcePositions[h1!]).toEqual([1, PAGE.indexOf('<h1>') + 1]);

    // The ticket is spent: the same address releases nothing again.
    expect((await get(answer.src)).status).toBe(404);
    // Its files are served read-only, by their paths, while the draft lives.
    const css = await get(`${answer.origin}/style.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toMatch(/^text\/css/);
    expect(await css.text()).toBe('h1{color:teal}');
    expect((await get(`${answer.origin}/orders.csv`)).status).toBe(200);
    expect((await get(`${answer.origin}/missing.css`)).status).toBe(404);
    expect((await app.request(`${answer.origin}/style.css`, { method: 'POST' })).status).toBe(404);
    // The public runtime files answer on it, the SQLite engine among them; nothing else of the app does.
    const engine = await get(`${answer.origin}/af/offline-sql.js`);
    expect(engine.status).toBe(200);
    expect(engine.headers.get('content-type')).toMatch(/javascript/);
    expect((await get(`${answer.origin}/api/my/artifacts`)).status).toBe(404);
    expect((await get(`${answer.origin}/a/AbCdEf12/raw`)).status).toBe(404);
    expect(await artifacts()).toBe(before);
  });

  it('reads a CSV both as a dataset and as a file the page links, whichever reference comes first', async () => {
    const owner = await mintAccountToken('draft_owner');
    const download = '<a href="./orders.csv" download>Download the rows</a>', dataset = '<link rel="af-dataset" data-af-name="orders" href="./orders.csv">';
    for (const [html, files] of [[PAGE.replace('<h1>Orders</h1>', `<h1>Orders</h1>${download}`), FILES], [`<!doctype html><html><body>${download}${dataset}<p>Orders</p></body></html>`, [FILES[1]!]]] as const) {
      const response = await post(session(owner), { html, files });
      const answer = await response.json() as { src: string; origin: string };
      expect(response.status, JSON.stringify(answer)).toBe(200);
      const page = await (await get(answer.src)).text();
      expect(JSON.parse(/<script type="application\/json" data-af="runtime">([^<]*)<\/script>/.exec(page)![1]!)).toMatchObject({ datasets: ['orders'] });
      expect(JSON.parse(/<script type="application\/json" data-af="offline-data">([^<]*)<\/script>/.exec(page)![1]!).tables.map((t: { name: string }) => t.name)).toEqual(['orders']);
      const file = await get(`${answer.origin}/orders.csv`);
      expect(file.status).toBe(200);
      expect(await file.text()).toBe(Buffer.from(FILES[1]!.base64, 'base64').toString());
    }
  });

  it('refuses every call from a draft origin to the app, and to a document\'s doors', async () => {
    const owner = await mintAccountToken('draft_owner');
    const { origin } = await (await post(session(owner), { html: PAGE, files: FILES })).json() as { origin: string };
    const refused = await app.request(attachActor(new Request(`${APP}/api/my/artifacts`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{"html":"<p>x</p>"}' }), session(owner)));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: 'forbidden_origin' });
    expect((await post(session(owner), { html: PAGE, files: FILES }, origin)).status).toBe(403);
  });

  it('keeps one origin per reader and content, a different one for another reader, and a new ticket on every request', async () => {
    const owner = await mintAccountToken('draft_owner'), other = await mintAccountToken('draft_other');
    const first = await (await post(session(owner), { html: PAGE, files: FILES })).json() as { src: string; origin: string };
    const again = await (await post(session(owner), { html: PAGE, files: FILES })).json() as { src: string; origin: string };
    const theirs = await (await post(session(other), { html: PAGE, files: FILES })).json() as { src: string; origin: string };
    const edited = await (await post(session(owner), { html: PAGE.replace('<h1>Orders</h1>', '<h1>Orders v2</h1>'), files: FILES })).json() as { origin: string };
    expect(again.origin).toBe(first.origin);
    expect(again.src).not.toBe(first.src);
    expect(theirs.origin).not.toBe(first.origin);
    expect(edited.origin).not.toBe(first.origin);
    // A ticket opens only its own draft.
    const foreign = new URL(theirs.src); foreign.host = new URL(first.origin).host;
    expect((await get(foreign.href)).status).toBe(404);
    expect((await get(first.src)).status).toBe(200);
    expect((await get(again.src)).status).toBe(200);
  });

  it('states and enforces its limits with codes the embedding app can show', async () => {
    const owner = await mintAccountToken('draft_owner');
    const refusal = async (body: unknown) => { const response = await post(session(owner), body); return { status: response.status, body: await response.json() as { error: string; message: string } }; };
    expect(await refusal({ html: PAGE, files: [FILES[0]] })).toMatchObject({ status: 400, body: { error: 'unresolved_draft_files', message: expect.stringContaining('orders.csv') } });
    expect(await refusal({ html: 42, files: [] })).toMatchObject({ status: 400, body: { error: 'invalid_draft' } });
    expect(await refusal({ html: PAGE, files: [FILES[0], { path: 'orders.csv', base64: b64('region\n') }] })).toMatchObject({ status: 400, body: { error: 'invalid_draft_csv', message: expect.stringContaining('orders.csv') } });
    const many = 'n\n' + Array.from({ length: DRAFT_LIMITS.rows + 1 }, (_, i) => i).join('\n') + '\n';
    expect(await refusal({ html: PAGE, files: [FILES[0], { path: 'orders.csv', base64: b64(many) }] })).toMatchObject({ status: 400, body: { error: 'draft_too_large', message: expect.stringContaining(String(DRAFT_LIMITS.rows)) } });
    const big = 'x'.repeat(DRAFT_LIMITS.fileBytes + 1);
    expect(await refusal({ html: PAGE, files: [FILES[1], { path: 'style.css', base64: b64(big) }] })).toMatchObject({ status: 400, body: { error: 'draft_too_large' } });
    const made: Array<{ src: string; origin: string }> = [];
    for (let i = 0; i < DRAFT_LIMITS.perReader; i++) made.push(await (await post(session(owner), { html: `<p>${i}</p>`, files: [] })).json() as { src: string; origin: string });
    // The same content again is the same draft, never one more; it is now the most recently shown.
    const again = await (await post(session(owner), { html: '<p>0</p>', files: [] })).json() as { src: string; origin: string };
    expect(again.origin).toBe(made[0]!.origin);
    // Past the cap the least recently shown (here the second) is forgotten, never refused.
    const more = await post(session(owner), { html: '<p>one more</p>', files: [] });
    expect(more.status).toBe(200);
    expect((await get(made[1]!.src)).status).toBe(404);
    expect((await get(again.src)).status).toBe(200);
  });
});

describe('publishing a draft', () => {
  it('creates a private artifact from the same files with the reader\'s own browser session', async () => {
    const owner = await mintAccountToken('draft_owner');
    const body = { html: PAGE, title: 'Orders', visibility: 'private', publicationBundle: { entryPath: 'index.html', files: FILES.map((file) => ({ ...file, contentType: file.path.endsWith('.css') ? 'text/css' : 'text/csv' })) } };
    const created = await app.request(attachActor(new Request(`${APP}/api/my/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json', origin: APP, 'idempotency-key': 'draft-publish-0000000001' }, body: JSON.stringify(body) }), session(owner)));
    const answer = await created.json() as { id: string; visibility?: string };
    expect(created.status, JSON.stringify(answer)).toBe(201);
    const row = (await (await getDb()).query<{ visibility: string }>('SELECT visibility FROM artifacts WHERE id=$1', [answer.id])).rows[0]!;
    expect(row.visibility).toBe('private');
  });
});
