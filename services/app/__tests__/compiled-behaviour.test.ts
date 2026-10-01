/**
 * THE COMPILED PAGE BEHAVES LIKE TODAY'S (w3-behaviour). Real routes, the harness's database, the
 * compiled-only reader.
 *
 * - A compiled `/a/:id` page with no island module (prose) still holds the document's live stream, keeps
 *   the reader's place across the reload a new version delivers, and carries their mode: the page's own
 *   behaviour (`@mx/page`), the same one a `/raw` copy runs. An interactive page loads it too (its
 *   reload keeps the place); the islands' module holds the stream there.
 * - `/raw?chrome=0` (the capture's render) carries no deck chrome — no slide rail, no present bar, no deck
 *   behaviour — exactly as today's renderer honours it; the story itself is the same.
 * - A reader who holds a credential for the document — an account session, or a held connection (the
 *   guest owner who made it) — gets the page's credentialed doors (`signedIn` in the data island), so
 *   the store's write check answers for them, as today's reader page does; a guest does not.
 */
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { useAppHarness, request, agentCookie } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createAppServer } from '@/server/app';
import { mintToken } from '@/lib/accounts';
import { drainPreparedPageWarmups } from '@/lib/story/prepared/prepared-page.server';
import { ISLAND_DATA_ID, READER_MODE_HEADER } from '@/lib/compiled-page/contract';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import type { IslandPageData } from '@/lib/islands/contract';

vi.mock('@/auth', () => ({ auth: async () => null }));
useAppHarness();
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>' });


async function publish(token: string, body: Record<string, unknown>): Promise<string> {
  const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { visibility: 'unlisted', ...body } }));
  if (made.status !== 201) throw new Error(await made.text());
  const id = ((await made.json()) as { id: string }).id;
  await drainPreparedPageWarmups();
  return id;
}
const islandData = (html: string): IslandPageData => JSON.parse(new JSDOM(html).window.document.getElementById(ISLAND_DATA_ID)?.textContent ?? 'null') as IslandPageData;

const POLL = (ds: string) => '<Helmet><Value name="choice" type="string" default="ramen" />'
  + `<Import name="votes" src="ref:${ds}" /><Mutation name="vote">{\`insert into votes.rows (choice) values ($choice)\`}</Mutation></Helmet>`
  + '<div><Button run="$vote">Vote</Button></div>';

describe('a held connection is a credentialed reader on the compiled app page', () => {
  it('the guest owner\'s page carries signedIn (the session doors); a guest\'s does not', async () => {
    const t = await mintToken('behaviour');
    const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'votes', dataset: [{ choice: 'ramen' }], columns: [{ name: 'choice', type: 'string' }], access: 'readwrite', visibility: 'unlisted' } }));
    const ds = ((await made.json()) as { id: string }).id;
    const id = await publish(t.token, { title: 'Poll', markup: POLL(ds) });

    const guest = await app.request(`/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } });
    expect(guest.headers.get(READER_MODE_HEADER)).toBe('compiled');
    expect(islandData(await guest.text()).signedIn).toBe(false);

    const held = await app.request(`/a/${id}?reader=compiled`, { headers: { accept: 'text/html', cookie: await agentCookie([t.id]) } });
    expect(held.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const data = islandData(await held.text());
    expect(data.signedIn).toBe(true);
    expect(data.mutateUrl).toBe(`/a/${id}/mutate`);
  });
});

describe('the compiled app page holds its own live stream until the app loads', () => {
  it('a prose page (no island module) loads the page behaviour and names its live identity; so does an interactive one', async () => {
    const t = await mintToken('behaviour');
    const prose = await publish(t.token, { title: 'Prose', markup: '<div><h1>Prose</h1><p>Just words.</p></div>' });
    const page = await app.request(`/a/${prose}?reader=compiled`, { headers: { accept: 'text/html' } });
    expect(page.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const doc = new JSDOM(await page.text()).window.document;
    const scripts = [...doc.querySelectorAll('script[type="module"]')].map((s) => s.getAttribute('src'));
    expect(scripts).toContain(loadCompilerBuild().manifest['@mx/page']);
    expect(doc.getElementById(ISLAND_DATA_ID), 'no island module on a prose page').toBeNull();
    expect(doc.body.getAttribute('data-mx-live-id')).toBe(prose);
    expect(doc.body.getAttribute('data-mx-live-edit')).toBeTruthy();

    const kit = await publish(t.token, { title: 'Tabs', markup: '<Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger><TabsTrigger value="b">B</TabsTrigger></TabsList><TabsContent value="a">One</TabsContent><TabsContent value="b">Two</TabsContent></Tabs>' });
    const interactive = new JSDOM(await (await app.request(`/a/${kit}?reader=compiled`, { headers: { accept: 'text/html' } })).text()).window.document;
    expect([...interactive.querySelectorAll('script[type="module"]')].map((s) => s.getAttribute('src'))).toContain(loadCompilerBuild().manifest['@mx/page']);
  });
});

describe('chrome=0 on a compiled /raw', () => {
  it('drops the deck\'s rail, present bar and behaviour, keeping the document; without it the deck chrome is there', async () => {
    const t = await mintToken('behaviour');
    const markup = readFileSync(path.resolve(process.cwd(), '../../scripts/fixtures/page-speed/deck.jsx'), 'utf8');
    const id = await publish(t.token, { title: 'Deck', markup });
    const raw = async (search: string) => {
      const res = await rawRoute(request(`/a/${id}/raw${search}`), { params: Promise.resolve({ id }) });
      expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
      return new JSDOM(await res.text()).window.document;
    };
    const deckScript = loadCompilerBuild().manifest['@mx/deck'];
    const full = await raw('?reader=compiled');
    expect(full.querySelector('nav.mx-rail')).toBeTruthy();
    expect(full.querySelector('[aria-label="Slide controls"]')).toBeTruthy();
    expect([...full.querySelectorAll('script[type="module"]')].map((s) => s.getAttribute('src'))).toContain(deckScript);

    const capture = await raw('?reader=compiled&chrome=0');
    expect(capture.querySelector('nav.mx-rail')).toBeNull();
    expect(capture.querySelector('[aria-label="Slide controls"]')).toBeNull();
    expect(capture.querySelector('.mx-deck')).toBeNull();
    expect([...capture.querySelectorAll('script[type="module"]')].map((s) => s.getAttribute('src'))).not.toContain(deckScript);
    // The same document, less its chrome.
    expect(capture.querySelector('#mx-story-root .mx-doc')?.innerHTML).toBe(full.querySelector('#mx-story-root .mx-deck > .mx-doc')?.innerHTML);
  });
});
