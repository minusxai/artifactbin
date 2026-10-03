/**
 * EVERY DOCUMENT ON ITS OWN ORIGIN, through the real app server (server/pages-host): the app page frames
 * `<hex(id)>.<pages host>`, the pages apex exchanges a one-time ticket for the `afbin_pages` cookie, the
 * document's origin serves only that document and its doors, and a pages Origin may call only its own
 * document's doors — anywhere. With the setting off, nothing changes.
 */
import { describe, expect, it } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import type { Actor } from '@artifactbin/contracts';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { claimToken, createUser, exchangePagesTicket, issuePagesTicket, mintToken, pagesSessionActor, revokeToken } from '@/lib/accounts';
import { ISLAND_DATA_ID } from '@/lib/compiled-page/contract';
import { drainPreparedPageWarmups } from '@/lib/story/prepared/prepared-page.server';
import { pagesOriginFor, pagesSiteFor } from '@/lib/serving/pages-origin';
import { buildDocumentCsp } from '@/lib/story/styles/document-csp';
import { createAppServer } from '../server/app';

useAppHarness();

const APP = 'https://app.example.test';
const site = pagesSiteFor('pages.example.test', APP)!;
const APEX = 'https://pages.example.test';
const SHELL = '<!doctype html><html><head><title>artifactbin</title></head><body><div id="root"></div></body></html>';
const framing = () => createAppServer({ indexHtml: async () => SHELL, pagesSite: site });

const DOC = '<Helmet><Value name="rows" type="table" value={[{id: 1}, {id: 2}]} /><Query name="counted">{`select count(*) as n from rows`}</Query></Helmet><h1 id="top">Private plan</h1><DataTable data="$counted" />';

async function world() {
  const t = await mintToken('pages-owner');
  const user = await createUser({ email: 'pages-owner@example.com' });
  await claimToken(user.id, t.token);
  const publish = async (markup: string, visibility: string) => {
    const res = await createRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup, visibility } }));
    expect(res.status, await res.clone().text()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const secret = await publish(DOC, 'private');
  const other = await publish('<h1>Another</h1>', 'private');
  await drainPreparedPageWarmups();
  const actor: Actor = { credential: 'session', userId: user.id, email: 'pages-owner@example.com', emailVerified: true };
  return { user, actor, secret, other, token: t };
}

const as = (url: string, actor: Actor | null, init: RequestInit = {}) => {
  const built = new Request(url, init);
  return actor ? attachActor(built, actor) : built;
};
const island = (html: string): Record<string, unknown> | null => {
  const match = new RegExp(`<script type="application/json" id="${ISLAND_DATA_ID}">([^<]*)<\\/script>`).exec(html);
  return match ? JSON.parse(match[1]!) as Record<string, unknown> : null;
};
/** Sign in on the pages domain the way the frame does: the app page's ticket through the apex. */
async function pagesCookie(app: ReturnType<typeof framing>, actor: Actor, id: string): Promise<string> {
  const page = await app.request(as(`${APP}/a/${id}`, actor, { headers: { accept: 'text/html' } }));
  const src = /<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())![1]!.replaceAll('&amp;', '&');
  const res = await app.request(src);
  const set = res.headers.get('set-cookie')!;
  return /afbin_pages=([^;]+)/.exec(set)![1]!;
}
const query = (id: string) => JSON.stringify({ values: {}, only: ['counted'] });

describe('the app page frames the document on its own origin', () => {
  it('draws the chrome and one sandboxed frame whose first URL spends a ticket, under the strict policy that frames only the pages origins', async () => {
    const w = await world();
    const res = await framing().request(as(`${APP}/a/${w.secret}`, w.actor, { headers: { accept: 'text/html' } }));
    expect(res.status).toBe(200);
    const html = await res.text();
    const frame = /<iframe data-mx-document-frame="" src="([^"]+)"[^>]*>/.exec(html);
    expect(frame).not.toBeNull();
    const src = new URL(frame![1]!.replaceAll('&amp;', '&'));
    expect(src.origin).toBe(APEX);
    expect(src.pathname).toBe('/pages-session');
    expect(src.searchParams.get('ticket')).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    expect(src.searchParams.get('next')).toBe(`${pagesOriginFor(w.secret, site)}/`);
    expect(frame![0]).toContain('sandbox="allow-scripts allow-same-origin');
    // The document runs in the frame: none of its story, data or code is in the app page.
    expect(html).not.toContain('Private plan</h1>');
    expect(html).not.toContain(`id="${ISLAND_DATA_ID}"`);
    expect(html).not.toMatch(/\/islands\/d\/[0-9a-f]{16}\.js/);
    expect(html).toContain('data-mx-reader-chrome');
    const csp = res.headers.get('content-security-policy')!;
    expect(csp.split('; ').find((d) => d.startsWith('frame-src'))).toBe(`frame-src 'self' ${APEX} https://*.pages.example.test`);
    expect(csp.split('; ').find((d) => d.startsWith('script-src'))).not.toMatch(/blob:|https:/);
  });

  it('frames a guest\'s page with no ticket, so the apex clears whatever the browser held', async () => {
    const t = await mintToken('public-owner');
    const res = await createRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<h1>Open</h1>', visibility: 'unlisted' } }));
    const { id } = (await res.json()) as { id: string };
    await drainPreparedPageWarmups();
    const html = await (await framing().request(`${APP}/a/${id}`, { headers: { accept: 'text/html' } })).text();
    const src = new URL(/<iframe data-mx-document-frame="" src="([^"]+)"/.exec(html)![1]!.replaceAll('&amp;', '&'));
    expect(src.searchParams.has('ticket')).toBe(false);
    const cleared = await framing().request(src.href, { headers: { cookie: 'afbin_pages=stale-value-from-before-0123456789' } });
    expect(cleared.status).toBe(302);
    expect(cleared.headers.get('set-cookie')).toMatch(/^afbin_pages=; Domain=\.pages\.example\.test; .*Max-Age=0/);
  });
});

describe('the pages session', () => {
  it('sets an HttpOnly, Secure, Lax cookie for the whole pages domain from a single-use ticket, and redirects only to a document origin', async () => {
    const w = await world();
    const app = framing();
    const ticket = (await issuePagesTicket({ viewer: { userId: w.user.id, email: null }, tokenId: null, credential: 'session' }))!;
    const next = `${pagesOriginFor(w.secret, site)}/`;
    const url = `${APEX}/pages-session?ticket=${ticket}&next=${encodeURIComponent(next)}`;
    const res = await app.request(url);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(next);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('set-cookie')).toMatch(/^afbin_pages=[A-Za-z0-9_-]{40,}; Domain=\.pages\.example\.test; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
    const replay = await app.request(url);
    expect(replay.status).toBe(302);
    expect(replay.headers.get('set-cookie')).toBeNull();
    for (const bad of ['https://evil.test/', `${APEX}/`, 'https://app.example.test/', `http://${new URL(next).host}/`, 'javascript:alert(1)']) {
      expect((await app.request(`${APEX}/pages-session?next=${encodeURIComponent(bad)}`)).status, bad).toBe(400);
    }
    expect((await app.request(`${APEX}/`)).status).toBe(404);
    expect((await app.request(`${APEX}/api/artifacts`)).status).toBe(404);
  });

  it('spends a ticket once, within 60 s; a guest gets none; a revoked token ends the session it rode', async () => {
    const w = await world();
    expect(await issuePagesTicket({ viewer: null, tokenId: null, credential: 'none' })).toBeNull();
    const now = Date.now();
    const late = (await issuePagesTicket({ viewer: { userId: w.user.id, email: null }, tokenId: null, credential: 'session' }, {}, now))!;
    expect(await exchangePagesTicket(late, now + 61_000)).toBeNull();
    const guest = await mintToken('guest-owner');
    const ticket = (await issuePagesTicket({ viewer: null, tokenId: guest.id, credential: 'agent-cookie' }))!;
    const session = (await exchangePagesTicket(ticket))!;
    expect(await pagesSessionActor(session.cookie)).toEqual({ credential: 'agent-cookie', tokenId: guest.id });
    await revokeToken(guest.id);
    expect(await pagesSessionActor(session.cookie)).toBeNull();
  });

  it('ends at logout: the app origin deletes it, a document origin may not', async () => {
    const w = await world();
    const app = framing();
    const cookie = await pagesCookie(app, w.actor, w.secret);
    const self = pagesOriginFor(w.secret, site);
    const refused = await app.request(`${APEX}/pages-session`, { method: 'DELETE', headers: { origin: self, cookie: `afbin_pages=${cookie}` } });
    expect(refused.status).toBe(403);
    const preflight = await app.request(`${APEX}/pages-session`, { method: 'OPTIONS', headers: { origin: APP, 'access-control-request-method': 'DELETE' } });
    expect(preflight.headers.get('access-control-allow-origin')).toBe(APP);
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');
    const out = await app.request(`${APEX}/pages-session`, { method: 'DELETE', headers: { origin: APP, cookie: `afbin_pages=${cookie}` } });
    expect(out.status).toBe(204);
    expect(out.headers.get('access-control-allow-origin')).toBe(APP);
    expect(out.headers.get('set-cookie')).toMatch(/^afbin_pages=; .*Max-Age=0/);
    const after = await app.request(`${self}/a/${w.secret}/query`, { method: 'POST', headers: { origin: self, cookie: `afbin_pages=${cookie}`, 'content-type': 'text/plain' }, body: query(w.secret) });
    expect(after.status).toBe(404);
  });
});

describe('a document\'s own origin', () => {
  it('serves its standalone page under the document policy, with direct absolute doors, to its pages session alone', async () => {
    const w = await world();
    const app = framing();
    const cookie = await pagesCookie(app, w.actor, w.secret);
    const self = pagesOriginFor(w.secret, site);
    const res = await app.request(`${self}/`, { headers: { cookie: `afbin_pages=${cookie}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(buildDocumentCsp({ self, app: APP, id: w.secret }));
    expect(res.headers.get('content-security-policy')).not.toContain('sandbox');
    const html = await res.text();
    expect(html).toContain('Private plan');
    expect(html).not.toContain('data-mx-reader-chrome=""');
    expect(html).toContain('data-mx-live-direct=""');
    const data = island(html)!;
    expect(data).toMatchObject({ direct: true, signedIn: true, queryUrl: `${self}/a/${w.secret}/query` });
    // Nobody's cookie, or no cookie: the uniform 404 a private document answers.
    expect((await app.request(`${self}/`)).status).toBe(404);
    expect((await app.request(`${self}/`, { headers: { cookie: 'afbin_pages=not-a-session-0123456789abcdef' } })).status).toBe(404);
  });

  it('answers its own doors with its reader and credentialed CORS for exactly its own origin', async () => {
    const w = await world();
    const app = framing();
    const cookie = await pagesCookie(app, w.actor, w.secret);
    const self = pagesOriginFor(w.secret, site);
    const res = await app.request(`${self}/a/${w.secret}/query`, { method: 'POST', headers: { origin: self, cookie: `afbin_pages=${cookie}`, 'content-type': 'text/plain' }, body: query(w.secret) });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(self);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('vary')).toMatch(/Origin/);
    const body = (await res.json()) as { tables: Record<string, { rows: Array<Record<string, unknown>> }> };
    expect(body.tables.counted!.rows[0]).toMatchObject({ n: 2 });
    // The same door with no cookie is a stranger's.
    const stranger = await app.request(`${self}/a/${w.secret}/query`, { method: 'POST', headers: { origin: self, 'content-type': 'text/plain' }, body: query(w.secret) });
    expect(stranger.status).toBe(404);
    const preflight = await app.request(`${self}/a/${w.secret}/mutate`, { method: 'OPTIONS', headers: { origin: self, 'access-control-request-method': 'POST' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(self);
  });

  it('serves nothing else: not the app, not another document, not its own raw or export', async () => {
    const w = await world();
    const app = framing();
    const cookie = `afbin_pages=${await pagesCookie(app, w.actor, w.secret)}`;
    const self = pagesOriginFor(w.secret, site);
    for (const path of ['/login', '/api/artifacts', `/a/${w.secret}`, `/a/${w.secret}/raw`, `/a/${w.secret}/export`, `/a/${w.other}/query`, '/@someone']) {
      expect((await app.request(`${self}${path}`, { headers: { cookie } })).status, path).toBe(404);
    }
    // The public runtime directories pass (a miss is the directory's own 404, never a refusal).
    expect((await app.request(`${self}/islands/nothing-here.js`)).status).not.toBe(403);
  });
});

describe('the origin gate', () => {
  it('refuses another document\'s origin with 403 forbidden_origin, on its host and on the app\'s', async () => {
    const w = await world();
    const app = framing();
    const cookie = `afbin_pages=${await pagesCookie(app, w.actor, w.secret)}`;
    const self = pagesOriginFor(w.secret, site);
    const intruder = pagesOriginFor(w.other, site);
    for (const url of [`${self}/a/${w.secret}/query`, `${APP}/a/${w.secret}/query`]) {
      const res = await app.request(url, { method: 'POST', headers: { origin: intruder, cookie, 'content-type': 'text/plain' }, body: query(w.secret) });
      expect(res.status, url).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe('forbidden_origin');
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });

  it('refuses a document origin on every app route that is not its own door — the same-site guard would not', async () => {
    const w = await world();
    const app = framing();
    const self = pagesOriginFor(w.secret, site);
    for (const [method, path] of [['POST', '/api/artifacts'], ['GET', '/api/my/artifacts'], ['POST', `/api/my/artifacts/${w.secret}/like`], ['GET', `/a/${w.secret}/raw`]] as const) {
      const res = await app.request(as(`${APP}${path}`, w.actor, { method, headers: { origin: self, 'sec-fetch-site': 'same-site', 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) }));
      expect(res.status, path).toBe(403);
    }
    // Its own door on the app's host answers cross-origin with credentialed CORS for exactly that origin.
    const own = await app.request(`${APP}/a/${w.secret}/query`, { method: 'POST', headers: { origin: self, 'content-type': 'text/plain' }, body: query(w.secret) });
    expect(own.status).toBe(404); // no pages cookie reaches the app host here: a stranger, honestly answered
    expect(own.headers.get('access-control-allow-origin')).toBe(self);
  });

  it('keeps today\'s behaviour for no Origin and for the app\'s own', async () => {
    const w = await world();
    const app = framing();
    for (const headers of [{}, { origin: APP }]) {
      const res = await app.request(as(`${APP}/a/${w.secret}/query`, w.actor, { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: query(w.secret) }));
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    }
  });
});

describe('with APP__PAGES_HOST unset', () => {
  it('serves the document inside the app page under the in-page document policy, and a pages hostname is nobody\'s', async () => {
    const w = await world();
    const app = createAppServer({ indexHtml: async () => SHELL, pagesSite: null });
    const res = await app.request(as(`${APP}/a/${w.secret}`, w.actor, { headers: { accept: 'text/html' } }));
    const html = await res.text();
    expect(html).toContain('Private plan');
    expect(html).not.toContain('data-mx-document-frame');
    const csp = res.headers.get('content-security-policy')!;
    expect(csp.split('; ').find((d) => d.startsWith('script-src'))).toMatch(/'self' 'wasm-unsafe-eval' blob: https:/);
    expect(csp.split('; ').find((d) => d.startsWith('frame-src'))).toBe("frame-src 'self'");
    const self = pagesOriginFor(w.secret, site);
    const elsewhere = await app.request(`${self}/a/${w.secret}/query`, { method: 'POST', headers: { origin: self, 'content-type': 'text/plain' }, body: query(w.secret) });
    expect(elsewhere.status).toBe(404);
    expect(elsewhere.headers.get('access-control-allow-credentials')).toBeNull();
  });
});
