/**
 * A SESSION OVER A FRAMED DOCUMENT, in a real worker and a real Chromium: the app page frames the document
 * from the pages apex's ticket exchange, the exchange redirects to the document's own origin, and the
 * session script's `page.evaluate(() => window.page.get(...))` reads the document's declared value — as the
 * reader the ticket named, with the pages cookie held by the parent and never by the worker's browser.
 *
 * The upstream is a stand-in for the app (server/pages-host and the app page), answering by the host the
 * request addressed exactly as the app does; the worker, its routing and its browser are the shipped ones.
 */
import { afterEach, expect, it } from 'vitest';
import { FORWARDED_HOST, type Actor } from '@artifactbin/contracts';
import { createSessionProcess } from '../src/session-process';
import type { SessionWorker } from '../src/sessions';

const BASE = 'http://app.lvh.me:7999';
const PAGES = 'lvh.me';
const DOC = Buffer.from('doc1').toString('hex');
const DOC_ORIGIN = `http://${DOC}.${PAGES}:7999`;
const TICKET = 'ticket-0123456789abcdef';
const COOKIE = 'cookie-0123456789abcdef0123456789';

interface Seen { url: string; host: string | null; cookie: string | null; actor: Actor }

/** The app's three answers a framed read needs: the app page, the apex exchange, the document. */
function framingApp(seen: Seen[]) {
  let spent = false;
  return async (request: Request, actor: Actor): Promise<Response> => {
    const url = new URL(request.url);
    seen.push({ url: url.href, host: request.headers.get(FORWARDED_HOST), cookie: request.headers.get('cookie'), actor });
    const html = (body: string, headers: Record<string, string> = {}) => new Response(body, { headers: { 'content-type': 'text/html', ...headers } });
    if (url.origin === BASE && url.pathname === '/a/doc1') {
      const src = `http://${PAGES}:7999/pages-session?ticket=${TICKET}&next=${encodeURIComponent(`${DOC_ORIGIN}/`)}`;
      return html(`<!doctype html><html><body><header>App bar</header><iframe data-mx-document-frame="" name="mx-document" src="${src}"></iframe></body></html>`);
    }
    if (url.origin === `http://${PAGES}:7999` && url.pathname === '/pages-session') {
      const ticket = url.searchParams.get('ticket');
      const headers = new Headers({ location: url.searchParams.get('next') ?? '/' });
      if (ticket === TICKET && !spent) { spent = true; headers.append('set-cookie', `afbin_pages=${COOKIE}; Domain=.${PAGES}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`); }
      return new Response(null, { status: 302, headers });
    }
    if (url.origin === DOC_ORIGIN && url.pathname === '/') {
      // The reader is whoever the pages cookie names; without it the document reads as a guest.
      const reader = request.headers.get('cookie')?.split('; ').includes(`afbin_pages=${COOKIE}`) ? 'reader' : 'guest';
      // window.page and the ready mark arrive after the load, as the page runtime's import does.
      return html(`<!doctype html><html><body><p id="who">${reader}</p><script id="mx-story-data" type="application/json">{}</script>`
        + `<script>setTimeout(() => { window.page = Object.freeze({ get: name => name === 'count' ? (${JSON.stringify(reader)} === 'reader' ? 3 : 0) : undefined }); document.documentElement.setAttribute('data-mx-ready', ''); }, 300);</script></body></html>`);
    }
    return new Response('not found', { status: 404 });
  };
}

let worker: SessionWorker | undefined;
afterEach(async () => { await worker?.close(); worker = undefined; });

it('reads window.page of the framed document as the session reader, with the pages cookie kept out of the worker', async () => {
  const seen: Seen[] = [];
  const owner: Actor = { credential: 'bearer', tokenId: 'tok_owner', userId: 'usr_owner' };
  worker = await createSessionProcess(owner, { baseURL: BASE, pagesHost: PAGES, request: framingApp(seen), sandbox: { mode: 'none' } });
  const out = await worker.run(`
    const page = await context.newPage();
    await page.goto('/a/doc1');
    // No wait of its own: evaluate resolves in the document once it has settled.
    const declared = await page.evaluate(() => typeof window.page);
    await page.waitForFunction(() => Boolean(window.page));
    return {
      declared,
      count: await page.evaluate(() => window.page.get('count')),
      who: await page.locator('#who').textContent(),
      appBar: await page.mainFrame().locator('header').textContent(),
      url: page.url(),
      cookies: await context.cookies(),
    };
  `);
  expect(out.error).toBeUndefined();
  expect(out.result).toEqual({ declared: 'object', count: 3, who: 'reader', appBar: 'App bar', url: `${BASE}/a/doc1`, cookies: [] });
  expect(out.pages.map(page => page.url)).toEqual([`${BASE}/a/doc1`]);
  const document = seen.find(entry => entry.url === `${DOC_ORIGIN}/`);
  expect(document, JSON.stringify(seen)).toBeDefined();
  expect(document!.host).toBe(`${DOC}.${PAGES}:7999`);
  expect(document!.cookie).toBe(`afbin_pages=${COOKIE}`);
  expect(document!.actor).toEqual(owner);
  // The app's own origin never receives the pages cookie.
  expect(seen.filter(entry => entry.url.startsWith(BASE)).every(entry => entry.cookie === null)).toBe(true);
}, 60_000);

it('refuses a frame that tries to leave the session origins', async () => {
  const seen: Seen[] = [];
  worker = await createSessionProcess({ credential: 'bearer', userId: 'usr_owner' }, { baseURL: BASE, pagesHost: PAGES, sandbox: { mode: 'none' },
    request: async (request, actor) => {
      seen.push({ url: request.url, host: null, cookie: null, actor });
      return new URL(request.url).pathname === '/a/doc1'
        ? new Response('<iframe data-mx-document-frame="" name="mx-document" src="http://elsewhere.test/"></iframe><iframe src="http://app.lvh.me.evil.test:7999/"></iframe>', { headers: { 'content-type': 'text/html' } })
        : new Response('never', { status: 200 });
    } });
  const out = await worker.run(`const page = await context.newPage(); await page.goto('/a/doc1'); await page.waitForTimeout(500); return page.frames().length;`);
  expect(out.error).toBeUndefined();
  expect(seen.map(entry => entry.url)).toEqual([`${BASE}/a/doc1`]);
}, 60_000);
