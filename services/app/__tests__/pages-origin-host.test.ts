/**
 * EVERY DOCUMENT ON ITS OWN ORIGIN, through the real app server (server/pages-host): the app page frames
 * `<hex(id)>.<pages host>`, the pages apex exchanges a one-time ticket for the `afbin_pages` cookie, the
 * document's origin serves only that document and its doors, and a pages Origin may call only its own
 * document's doors — anywhere. With the setting off, nothing changes.
 */
import { withHttpServer, type RunningServer } from '@artifactbin/test-support/net';
import { afterEach, describe, expect, it } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import { BROWSER_SESSION_HEADER, type Actor } from '@artifactbin/contracts';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { claimToken, createUser, exchangePagesTicket, issuePagesTicket, mintToken, pagesSessionActor, revokeToken } from '@/lib/accounts';
import { ISLAND_DATA_ID } from '@/lib/compiled-page/contract';
import { drainPreparedPageWarmups } from '@/lib/story/prepared/prepared-page.server';
import { pagesOriginFor, pagesSiteFor } from '@/lib/serving/pages-origin';
import { framedDocumentSrc } from '@/lib/serving/artifact-page';
import { POST as internalMint } from '@/app/api/internal/tokens/route';
import { ARTIFACT_SCOPE } from '@artifactbin/contracts';
import { buildDocumentCsp } from '@/lib/story/styles/document-csp';
import { setWebIngestPolicyForTests } from '@/lib/web-ingest/fetch';
import { POST as grantRoute } from '@/app/api/trust/route';
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
  return { user, actor, secret, other, token: t, publish };
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
const query = (_id: string) => JSON.stringify({ values: {}, only: ['counted'] });

describe('the app page frames the document on its own origin', () => {
  it('draws one sandboxed frame whose first URL spends a ticket, under the strict policy that frames only the pages origins', async () => {
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
    // The bar around it is the app's own (solid/document/DocumentChrome), drawn by the app, not the server.
    expect(html).not.toContain('data-mx-reader-chrome');
    const csp = res.headers.get('content-security-policy')!;
    expect(csp.split('; ').find((d) => d.startsWith('frame-src'))).toBe(`frame-src 'self' ${APEX} https://*.pages.example.test`);
    expect(csp.split('; ').find((d) => d.startsWith('script-src'))).not.toMatch(/blob:|https:/);
    // Sign-out ends the pages session at the address the page names (lib/accounts/browser-session).
    expect(html).toContain(`<meta name="mx-pages-session" content="${APEX}/pages-session">`);
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

describe('the reader\'s selection in the app page\'s address reaches the frame', () => {
  it('forwards every `$` param of the page\'s address into the frame\'s first URL, and the document starts from it', async () => {
    const w = await world();
    const id = await w.publish('<Helmet><Value name="region" type="string" default="north" /><Value name="zoom" type="number" default={2} /></Helmet><p>{$region}</p>', 'private');
    await drainPreparedPageWarmups();
    const app = framing();
    const self = pagesOriginFor(id, site);
    const page = await app.request(as(`${APP}/a/${id}?$region=west&$zoom=5`, w.actor, { headers: { accept: 'text/html' } }));
    const src = new URL(/<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())![1]!.replaceAll('&amp;', '&'));
    expect(src.searchParams.get('next')).toBe(`${self}/?$region=west&$zoom=5`);
    // The apex spends the ticket and lands the frame on the document's origin with the selection intact.
    const exchanged = await app.request(src.href);
    expect(exchanged.status).toBe(302);
    const landed = exchanged.headers.get('location')!;
    expect(new URL(landed).search).toBe('?$region=west&$zoom=5');
    const cookie = /afbin_pages=([^;]+)/.exec(exchanged.headers.get('set-cookie')!)![1]!;
    const html = await (await app.request(landed, { headers: { cookie: `afbin_pages=${cookie}` } })).text();
    expect(island(html)).toMatchObject({ values: { region: 'west', zoom: 5 } });
    // A fresh frame URL (a consent grant's reload) carries the page's address the same way.
    const fresh = await framedDocumentSrc(as(`${APP}/api/page/frame/${id}?$region=east`, w.actor), id, site, '?$region=east');
    expect(new URL(fresh!.src).searchParams.get('next')).toBe(`${self}/?$region=east`);
  });
});

describe('a fresh frame URL (app/api/page/frame, for an app page that builds its own frame)', () => {
  it('carries a one-time ticket for this reader to the document\'s origin, and nothing for a reader who may not read it', async () => {
    const w = await world();
    const fresh = await framedDocumentSrc(as(`${APP}/api/page/frame/${w.secret}`, w.actor), w.secret, site);
    expect(fresh?.origin).toBe(pagesOriginFor(w.secret, site));
    const src = new URL(fresh!.src);
    expect(src.searchParams.get('next')).toBe(`${fresh!.origin}/`);
    const res = await framing().request(fresh!.src);
    expect(res.headers.get('set-cookie')).toMatch(/^afbin_pages=[A-Za-z0-9_-]{40,};/);
    expect(await framedDocumentSrc(as(`${APP}/api/page/frame/${w.secret}`, null), w.secret, site)).toBeNull();
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

  it('hands a browser session\'s scripted browser across as its token, and a plain bearer page fetch nothing', async () => {
    const w = await world();
    const app = framing();
    // What the session transport (services/browser forwardSessionFetch) sends: the session's actor attached, the
    // session mark, the addressed host, no Origin — and, on the pages site, the cookie the parent holds.
    const owner: Actor = { credential: 'bearer', tokenId: w.token.id, userId: w.user.id };
    const frameSrc = async (headers: Record<string, string>) => {
      const html = await (await app.request(as(`${APP}/a/${w.secret}`, owner, { headers: { accept: 'text/html', ...headers } }))).text();
      return new URL(/<iframe data-mx-document-frame="" src="([^"]+)"/.exec(html)![1]!.replaceAll('&amp;', '&'));
    };
    expect((await frameSrc({})).searchParams.has('ticket')).toBe(false);
    const src = await frameSrc({ [BROWSER_SESSION_HEADER]: '1' });
    expect(src.searchParams.get('ticket')).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    const exchanged = await app.request(as(src.href, owner, { headers: { [BROWSER_SESSION_HEADER]: '1' } }));
    expect(exchanged.status).toBe(302);
    const cookie = /afbin_pages=([^;]+)/.exec(exchanged.headers.get('set-cookie')!)![1]!;
    expect(await pagesSessionActor(cookie)).toEqual({ credential: 'agent-cookie', userId: w.user.id, tokenId: w.token.id });
    // The document's own door reads the private document as the session's reader.
    const self = pagesOriginFor(w.secret, site);
    const read = await app.request(as(`${self}/a/${w.secret}/query`, owner, { method: 'POST', headers: { [BROWSER_SESSION_HEADER]: '1', 'x-forwarded-host': new URL(self).host, cookie: `afbin_pages=${cookie}`, 'content-type': 'text/plain' }, body: query(w.secret) }));
    expect(read.status, await read.clone().text()).toBe(200);
    expect(((await read.json()) as { tables: Record<string, { rows: Array<Record<string, unknown>> }> }).tables.counted!.rows[0]).toMatchObject({ n: 2 });
    // The session mark with no transport behind it is nobody's session: a guest page, no ticket.
    const unmarked = await (await app.request(`${APP}/a/${w.secret}`, { headers: { accept: 'text/html', [BROWSER_SESSION_HEADER]: '1', authorization: `Bearer ${w.token.token}` } })).text();
    expect(unmarked).not.toMatch(/ticket=/);
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
    expect(html).toMatch(new RegExp(`<html [^>]*data-mx-app-origin="${APP.replaceAll('.', '\\.')}"`));
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

  it('streams its own live events and frames to its reader', async () => {
    const w = await world();
    const app = framing();
    const cookie = `afbin_pages=${await pagesCookie(app, w.actor, w.secret)}`;
    const self = pagesOriginFor(w.secret, site);
    const events = await app.request(`${self}/a/${w.secret}/events`, { headers: { cookie } });
    expect(events.status).toBe(200);
    expect(events.headers.get('content-type')).toMatch(/^text\/event-stream/);
    await events.body?.cancel();
    const frame = await app.request(`${self}/a/${w.secret}/events/frame`, { headers: { cookie } });
    expect(frame.status).toBe(200);
    expect(((await frame.json()) as Record<string, unknown>)).toBeTypeOf('object');
    expect((await app.request(`${self}/a/${w.secret}/events`)).status).toBe(404);
  });

  it('loads another artifact\'s embedded bytes anonymously — what anyone with the link may — and never with its reader', async () => {
    const w = await world();
    const app = framing();
    const cookie = `afbin_pages=${await pagesCookie(app, w.actor, w.secret)}`;
    const self = pagesOriginFor(w.secret, site);
    const t = await mintToken('embedded-owner');
    const res = await createRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<h1>Open</h1>', visibility: 'unlisted' } }));
    const { id: open } = (await res.json()) as { id: string };
    expect((await app.request(`${self}/a/${open}/raw`, { headers: { cookie } })).status).toBe(200);
    // The reader may read `other`, but its document's origin asks as nobody.
    expect((await app.request(`${self}/a/${w.other}/raw`, { headers: { cookie } })).status).toBe(404);
    expect((await app.request(`${self}/a/${open}/raw`, { method: 'POST', headers: { cookie } })).status).toBe(404);
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
    for (const headers of [{}, { origin: APP }] as Array<Record<string, string>>) {
      const res = await app.request(as(`${APP}/a/${w.secret}/query`, w.actor, { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: query(w.secret) }));
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    }
  });
});

describe('the document\'s /fetch door: a script reaches the hosts its document declares, through us', () => {
  let fixture: RunningServer | null = null;
  afterEach(async () => {
    setWebIngestPolicyForTests(null);
    await fixture?.close();
    fixture = null;
  });
  /** A private document of the owner's whose Helmet declares `connect` (its publish is the owner's consent). */
  const declaring = async (w: Awaited<ReturnType<typeof world>>, connect: string[], visibility = 'private') => {
    const id = await w.publish(`<Helmet><meta name="csp-connect" content="${connect.join(' ')}" /></Helmet><h1>Rates</h1>`, visibility);
    await drainPreparedPageWarmups();
    return id;
  };

  it('answers a declared host\'s bytes with their type, for the document\'s reader, never forwarding a credential', async () => {
    const w = await world();
    const app = framing();
    const seen: Array<{ cookie?: string; authorization?: string }> = [];
    fixture = await withHttpServer((req, res) => { seen.push({ cookie: req.headers.cookie, authorization: req.headers.authorization }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"rate":1.23}'); });
    const port = fixture.port;
    const upstream = `http://127.0.0.1:${port}`;
    // Loopback stands in for the open web here only: the test policy admits it (and a declared https origin's http
    // twin), as the dev switch does.
    setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true });
    const id = await declaring(w, [`https://127.0.0.1:${port}`]);
    const cookie = `afbin_pages=${await pagesCookie(app, w.actor, id)}`;
    const self = pagesOriginFor(id, site);
    const res = await app.request(`${self}/a/${id}/fetch?url=${encodeURIComponent(`${upstream}/rates?base=eur`)}`, { headers: { origin: self, cookie } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('access-control-allow-origin')).toBe(self);
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(await res.json()).toEqual({ rate: 1.23 });
    expect(seen).toEqual([{ cookie: undefined, authorization: undefined }]);
    // A stranger to the private document gets the uniform 404, before anything is fetched.
    expect((await app.request(`${self}/a/${id}/fetch?url=${encodeURIComponent(`${upstream}/x`)}`, { headers: { origin: self } })).status).toBe(404);
    expect(seen).toHaveLength(1);
  });

  it('refuses an undeclared host, a private or loopback address, and every method but GET', async () => {
    const w = await world();
    const app = framing();
    setWebIngestPolicyForTests({ allowPrivate: false, allowHttp: false });
    const id = await declaring(w, ['https://api.example.org', 'https://127.0.0.1', 'https://10.0.0.7']);
    const cookie = `afbin_pages=${await pagesCookie(app, w.actor, id)}`;
    const self = pagesOriginFor(id, site);
    const door = (url: string, init: RequestInit = {}) => app.request(`${self}/a/${id}/fetch?url=${encodeURIComponent(url)}`, { ...init, headers: { origin: self, cookie, ...(init.headers ?? {}) } });
    const undeclared = await door('https://evil.example.net/steal');
    expect(undeclared.status).toBe(403);
    expect(((await undeclared.json()) as { error: string }).error).toBe('undeclared_host');
    for (const url of ['https://127.0.0.1/admin', 'https://10.0.0.7/']) {
      const res = await door(url);
      expect(res.status, url).toBe(403);
      expect(((await res.json()) as { error: string }).error, url).toBe('forbidden_address');
    }
    const post = await door('https://api.example.org/write', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET');
  });
});

describe('a reader\'s consent reaches the document\'s own origin with the pages session (lib/trust/document-trust)', () => {
  let fixture: RunningServer | null = null;
  afterEach(async () => {
    setWebIngestPolicyForTests(null);
    await fixture?.close();
    fixture = null;
  });

  it('a reader who allowed once gets the declared hosts in the framed document\'s policy, and its /fetch door opens', async () => {
    const w = await world();
    const app = framing();
    fixture = await withHttpServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
    const port = fixture.port;
    setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true });
    const PLOTLY = 'https://cdn.plot.ly';
    const id = await w.publish(`<Helmet><meta name="csp-connect" content="https://127.0.0.1:${port}" /><meta name="csp-script" content="${PLOTLY}" /></Helmet><h1>Weather</h1>`, 'public');
    await drainPreparedPageWarmups();
    const t = await mintToken('pages-reader');
    const user = await createUser({ email: 'mxmx_test_pages_reader@example.com' });
    await claimToken(user.id, t.token);
    const reader: Actor = { credential: 'session', userId: user.id, email: 'mxmx_test_pages_reader@example.com', emailVerified: true };
    const self = pagesOriginFor(id, site);
    /** The reader opens the app page (with whatever app-origin cookie they hold) and loads its frame. */
    const framedAs = async (appCookie: string | null) => {
      const page = await app.request(as(`${APP}/a/${id}`, reader, { headers: { accept: 'text/html', ...(appCookie ? { cookie: appCookie } : {}) } }));
      const src = /<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())![1]!.replaceAll('&amp;', '&');
      const exchanged = await app.request(src);
      const cookie = `afbin_pages=${/afbin_pages=([^;]+)/.exec(exchanged.headers.get('set-cookie')!)![1]!}`;
      const doc = await app.request(`${self}/`, { headers: { cookie } });
      expect(doc.status).toBe(200);
      const script = (doc.headers.get('content-security-policy') ?? '').split('; ').find((d) => d.startsWith('script-src ')) ?? '';
      const fetched = await app.request(`${self}/a/${id}/fetch?url=${encodeURIComponent(`http://127.0.0.1:${port}/now`)}`, { headers: { origin: self, cookie } });
      return { script, fetched };
    };

    const before = await framedAs(null);
    expect(before.script).not.toContain(PLOTLY);
    expect(before.fetched.status).toBe(403);
    expect(((await before.fetched.json()) as { error: string }).error).toBe('host_not_allowed');

    const granted = await grantRoute(request('/api/trust', { method: 'POST', json: { artifactId: id, grant: 'once' }, origin: 'same', actor: reader }));
    expect(granted.status, await granted.clone().text()).toBe(200);
    const trust = /((?:__Host-)?afbin_trust=[^;]+)/.exec(granted.headers.get('set-cookie') ?? '')![1]!;
    const after = await framedAs(trust);
    expect(after.script.split(' ')).toContain(PLOTLY);
    expect(after.fetched.status, await after.fetched.clone().text()).toBe(200);
    expect(await after.fetched.json()).toEqual({ ok: true });

    // The grant rides the ticket the app page minted: the document's own request carries no trust cookie at all.
    const forged = await app.request(`${self}/`, { headers: { cookie: trust } });
    expect((forged.headers.get('content-security-policy') ?? '')).not.toContain(PLOTLY);
  });

  it('a guest who allowed once gets the declared hosts in the framed document\'s policy, in a session that is nobody\'s', async () => {
    const w = await world();
    const app = framing();
    const PLOTLY = 'https://cdn.plot.ly';
    const id = await w.publish(`<Helmet><meta name="csp-script" content="${PLOTLY}" /></Helmet><h1>Chart</h1>`, 'public');
    await drainPreparedPageWarmups();
    const self = pagesOriginFor(id, site);
    /** A signed-out reader opens the app page (with whatever app-origin cookie they hold) and loads its frame. */
    const framedAsGuest = async (appCookie: string | null) => {
      const page = await app.request(`${APP}/a/${id}`, { headers: { accept: 'text/html', ...(appCookie ? { cookie: appCookie } : {}) } });
      const src = new URL(/<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())![1]!.replaceAll('&amp;', '&'));
      const exchanged = await app.request(src.href);
      expect(exchanged.status).toBe(302);
      const pages = /afbin_pages=([^;]*)/.exec(exchanged.headers.get('set-cookie') ?? '')?.[1] || null;
      const doc = await app.request(`${self}/`, { headers: pages ? { cookie: `afbin_pages=${pages}` } : {} });
      expect(doc.status).toBe(200);
      const script = (doc.headers.get('content-security-policy') ?? '').split('; ').find((d) => d.startsWith('script-src ')) ?? '';
      return { ticket: src.searchParams.has('ticket'), pages, script };
    };

    const before = await framedAsGuest(null);
    expect(before.ticket).toBe(false);
    expect(before.script).not.toContain(PLOTLY);

    const granted = await grantRoute(request('/api/trust', { method: 'POST', json: { artifactId: id, grant: 'once' }, origin: 'same' }));
    expect(granted.status, await granted.clone().text()).toBe(200);
    const trust = /((?:__Host-)?afbin_trust=[^;]+)/.exec(granted.headers.get('set-cookie') ?? '')![1]!;
    const after = await framedAsGuest(trust);
    // The once-grant rides a ticket of its own: a guest's page that carries something mints one.
    expect(after.ticket).toBe(true);
    expect(after.script.split(' ')).toContain(PLOTLY);
    // The session it made is nobody's: the doors read the guest as anonymous, it only holds what was carried.
    expect(after.pages).not.toBeNull();
    expect(await pagesSessionActor(after.pages)).toBeNull();
  });
});

describe('development on lvh.me', () => {
  it('mints a connection bound to the same-site development app (lvh.me names are loopback), and nothing else on http', async () => {
    const w = await world();
    const mint = (audience: string) => internalMint(as('http://app.lvh.me:11001/api/internal/tokens', w.actor, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expiresInHours: 1, audience, scope: ARTIFACT_SCOPE }) }));
    expect((await mint('http://app.lvh.me:11001/api')).status).toBe(201);
    expect((await mint('http://lvh.me.example.com/api')).status).toBe(400);
  });
});
