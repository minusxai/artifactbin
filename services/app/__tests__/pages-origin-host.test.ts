import {nativeHtml} from '@/__tests__/native-html-fixture';
/**
 * EVERY DOCUMENT ON ITS OWN ORIGIN, through the real app server (server/pages-host): the app page frames
 * `<hex(id)>.<pages host>`, whose own origin spends the one-time ticket in the response that serves the document and sets its host-only cookie, the
 * document's origin serves only that document and its doors, and a pages Origin may call only its own
 * document's doors — anywhere. With the setting off, nothing changes.
 */
import { withHttpServer, type RunningServer } from '@artifactbin/test-support/net';
import { useLoopbackLookup } from '@artifactbin/utils/node/loopback-lookup';
import { afterEach, describe, expect, it } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import { BROWSER_SESSION_HEADER, type Actor } from '@artifactbin/contracts';
import { testIdentity, useAppHarness, request } from '@/__tests__/harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { claimToken } from '@/lib/authentication';
import { createUser, exchangePagesTicket, issuePagesTicket, revokeToken } from '@/lib/accounts';
import { pagesSessionActor } from '@/lib/accounts/pages-sessions';
import { DELETE as clearSession } from '@/app/api/session/token/route';
import { measureQueries } from '@/lib/platform';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { pagesOriginFor, pagesSiteFor } from '@/lib/http/pages-origin';
import { framedDocumentSrc } from '@/lib/document-serving';
import { POST as internalMint } from '@/app/api/internal/tokens/route';
import { ARTIFACT_SCOPE } from '@artifactbin/contracts';
import { setWebIngestPolicyForTests } from '@/lib/web-ingest/fetch';
import { POST as grantRoute } from '@/app/api/trust/route';
import { createAppServer } from '../server/app';
import {nativeHtmlPolicy} from '@/lib/document-serving/native-html.server';

useAppHarness();

const APP = 'https://app.example.test';
const site = pagesSiteFor('pages.example.test', APP)!;
const APEX = 'https://pages.example.test';
/** The statements the whole first framed load (ticket to document) may issue: 10 now; the old apex-then-document flow issued 11 on the same fixture. */
const BUDGET = { exchange: 10 };
const SHELL = '<!doctype html><html><head><title>artifactbin</title></head><body><div id="root"></div></body></html>';
const framing = () => createAppServer({ indexHtml: async () => SHELL, pagesSite: site });

const DOC = '<h1 data-af-id="plan" id="top">Private plan</h1><script type="application/json" data-af="state">{"rows":[{"id":1},{"id":2}]}</script>';

async function world() {
  const user = await createUser({ email: 'pages-owner@example.com' });
  const t = await mintToken('pages-owner', user.id);
    await claimToken(user.id, t.token);
  const publish = async (markup: string, visibility: string,head='') => {
    const res = await createRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { html:`<!doctype html><html><head>${head}</head><body>${markup}</body></html>`, visibility } }));
    expect(res.status, await res.clone().text()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const secret = await publish(DOC, 'private');
  const other = await publish('<h1>Another</h1>', 'private');
  const actor: Actor = { credential: 'session', userId: user.id, email: 'pages-owner@example.com', emailVerified: true };
  return { user, actor, secret, other, token: t, publish };
}

const as = (url: string, actor: Actor | null, init: RequestInit = {}) => {
  const built = new Request(url, init);
  return actor ? attachActor(built, actor) : built;
};
const runtime = (html:string):Record<string,unknown>|null=>{const match=/<script[^>]*data-af="runtime"[^>]*>([\s\S]*?)<\/script>/.exec(html);return match?JSON.parse(match[1]!):null;};
/** Sign in on the document's own origin the way the frame does: the app page's ticket, spent by the document's response. */
async function pagesCookie(app: ReturnType<typeof framing>, actor: Actor, id: string): Promise<string> {
  const res = await app.request((await frameSrc(app, actor, id)).href);
  expect(res.status).toBe(200);
  return cookieOf(res)!;
}
/** The https site's cookie: host-only, `__Host-` prefixed (lib/http/pages-origin pagesCookieName). */
const COOKIE = '__Host-afbin_pages';
const cookieOf = (res: Response): string | null => new RegExp(`${COOKIE}=([^;]+)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? null;
/** The frame's first URL the app page drew for `actor`. */
async function frameSrc(app: ReturnType<typeof framing>, actor: Actor | null, id: string, search = ''): Promise<URL> {
  const page = await app.request(as(`${APP}/a/${id}${search}`, actor, { headers: { accept: 'text/html' } }));
  return new URL(/<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())![1]!.replaceAll('&amp;', '&'));
}
const query = (_id: string) => JSON.stringify({ values: {}, only: ['counted'] });

describe('the app page frames the document on its own origin', () => {
  it('draws one sandboxed frame whose first URL is the document\'s own origin carrying a ticket, under the strict policy that frames only the pages origins', async () => {
    const w = await world();
    const res = await framing().request(as(`${APP}/a/${w.secret}`, w.actor, { headers: { accept: 'text/html' } }));
    expect(res.status).toBe(200);
    const html = await res.text();
    const frame = /<iframe data-mx-document-frame="" src="([^"]+)"[^>]*>/.exec(html);
    expect(frame).not.toBeNull();
    const src = new URL(frame![1]!.replaceAll('&amp;', '&'));
    expect(src.origin).toBe(pagesOriginFor(w.secret, site));
    expect(src.pathname).toBe('/');
    expect(src.searchParams.get('_pt')).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    expect(html).not.toContain(APEX);
    expect(frame![0]).toContain('sandbox="allow-scripts allow-same-origin');
    // The document runs in the frame: none of its story, data or code is in the app page.
    expect(html).not.toContain('Private plan</h1>');
    expect(html).not.toContain('data-af="runtime"');
    expect(html).not.toMatch(/\/islands\/d\/[0-9a-f]{16}\.js/);
    // The bar around it is the app's own (solid/document/DocumentChrome), drawn by the app, not the server.
    expect(html).not.toContain('data-mx-reader-chrome');
    const csp = res.headers.get('content-security-policy')!;
    expect(csp.split('; ').find((d) => d.startsWith('frame-src'))).toBe(`frame-src 'self' https://*.pages.example.test`);
    expect(csp.split('; ').find((d) => d.startsWith('script-src'))).not.toMatch(/blob:|https:/);
    // Sign-out is the app's own call: the page names no pages address to ask.
    expect(html).not.toContain('mx-pages-session');
  });

  it('frames a guest\'s page with the explicit guest marker, so the document origin clears whatever the browser held', async () => {
    const t = await mintToken('public-owner');
    const res = await createRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { html:nativeHtml('<h1>Open</h1>'), visibility: 'unlisted' } }));
    const { id } = (await res.json()) as { id: string };
    const html = await (await framing().request(`${APP}/a/${id}`, { headers: { accept: 'text/html' } })).text();
    const src = new URL(/<iframe data-mx-document-frame="" src="([^"]+)"/.exec(html)![1]!.replaceAll('&amp;', '&'));
    expect(src.searchParams.get('_pt')).toBe('-');
    const cleared = await framing().request(src.href, { headers: { cookie: `${COOKIE}=stale-value-from-before-0123456789` } });
    expect(cleared.status).toBe(200);
    expect(cleared.headers.get('set-cookie')).toBe(`${COOKIE}=; Path=/; HttpOnly; SameSite=None; Max-Age=0; Secure; Partitioned`);
  });
});

describe('the reader\'s selection in the app page\'s address reaches the frame', () => {
  it('forwards every `$` param of the page\'s address into the frame\'s first URL, and the document starts from it', async () => {
    const w = await world();
    const id = await w.publish('<Helmet><Value name="region" type="string" default="north" /><Value name="zoom" type="number" default={2} /></Helmet><p>{$region}</p>', 'private');
    const app = framing();
    const self = pagesOriginFor(id, site);
    const page = await app.request(as(`${APP}/a/${id}?$region=west&$zoom=5`, w.actor, { headers: { accept: 'text/html' } }));
    const src = new URL(/<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())![1]!.replaceAll('&amp;', '&'));
    expect(src.origin).toBe(self);
    expect(src.search).toMatch(/^\?\$region=west&\$zoom=5&_pt=[A-Za-z0-9_-]+$/);
    // The document's origin spends the ticket and serves the document, starting from the selection, in one response.
    const served = await app.request(src.href);
    expect(served.status).toBe(200);
    expect(cookieOf(served)).not.toBeNull();
    expect(runtime(await served.text())).toMatchObject({pageId:id,revision:'1'});
    // A fresh frame URL (a consent grant's reload) carries the page's address the same way.
    const fresh = await framedDocumentSrc(as(`${APP}/api/page/frame/${id}?$region=east`, w.actor), id, site, '?$region=east');
    expect(new URL(fresh!.src).origin).toBe(self);
    expect(new URL(fresh!.src).searchParams.get('$region')).toBe('east');
  });
});

describe('a fresh frame URL (app/api/page/frame, for an app page that builds its own frame)', () => {
  it('carries a one-time ticket for this reader on the document\'s own origin, and nothing for a reader who may not read it', async () => {
    const w = await world();
    const fresh = await framedDocumentSrc(as(`${APP}/api/page/frame/${w.secret}`, w.actor), w.secret, site);
    expect(fresh?.origin).toBe(pagesOriginFor(w.secret, site));
    const src = new URL(fresh!.src);
    expect(src.origin).toBe(fresh!.origin);
    const res = await framing().request(fresh!.src);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`^${COOKIE}=[A-Za-z0-9_-]{40,};`));
    expect(await framedDocumentSrc(as(`${APP}/api/page/frame/${w.secret}`, null), w.secret, site)).toBeNull();
  });
});

/** The ticket a document's app page would carry for `actor`, bound to `id` at its own origin. */
const bindingOf = (id: string) => ({ artifactId: id, origin: pagesOriginFor(id, site) });
/** Follow a frame's first URL the way a browser does: through a redirect, with the cookie it holds for that host, if there is one. */
async function loadFrame(app: ReturnType<typeof framing>, src: string, held: string | null = null): Promise<{ res: Response; cookie: string | null }> {
  let url = src, cookie = held;
  for (let hops = 0; hops < 3; hops++) {
    const res = await app.request(url, { headers: cookie ? { cookie: `${COOKIE}=${cookie}` } : {} });
    cookie = cookieOf(res) ?? cookie;
    const next = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !next) return { res, cookie };
    url = next;
  }
  throw new Error('too many redirects');
}

describe('the pages session', () => {
  it('spends the ticket on the document\'s own origin, in the response that serves the document, and sets that origin\'s host-only cookie', async () => {
    const w = await world();
    const app = framing();
    const self = pagesOriginFor(w.secret, site);
    const ticket = (await issuePagesTicket(testIdentity('session', { userId: w.user.id, email: null }), {}, Date.now(), bindingOf(w.secret)))!;
    const url = `${self}/?_pt=${ticket}`;
    const res = await app.request(url);
    expect(res.status).toBe(200);
    // One response: no redirect, no other host. The cookie has no Domain and no Max-Age (a session cookie; the row carries the 8 h).
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('set-cookie')).toMatch(/^__Host-afbin_pages=[A-Za-z0-9_-]{40,}; Path=\/; HttpOnly; SameSite=None; Secure; Partitioned$/);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    const html = await res.text();
    expect(html).toContain('Private plan');
    expect(runtime(html)).toMatchObject({pageId:w.secret,revision:'1',appOrigin:APP});expect(runtime(html)).not.toHaveProperty('signedIn');
    expect(html).not.toContain(ticket);
    // The replay (a back navigation to the frame's first URL) mints nothing, and reads as nobody: the uniform 404.
    const replay = await app.request(url);
    expect(replay.status).toBe(404);
    expect(replay.headers.get('set-cookie')).toBeNull();
    // The apex mints nothing and answers nothing: not the old exchange, not logout's old call.
    for (const [method, path] of [['GET', `/pages-session?ticket=${ticket}&next=${encodeURIComponent(`${self}/`)}`], ['DELETE', '/pages-session'], ['GET', '/'], ['GET', '/api/artifacts']] as const) {
      const apex = await app.request(`${APEX}${path}`, { method });
      expect(apex.status, `${method} ${path}`).toBe(404);
      expect(apex.headers.get('set-cookie')).toBeNull();
    }
  });

  it('hands a browser session\'s scripted browser across as its token, and a plain bearer page fetch nothing', async () => {
    const w = await world();
    const app = framing();
    // What the session transport (services/browser forwardSessionFetch) sends: the session's actor attached, the
    // session mark, the addressed host, no Origin — and, on the pages site, the cookie the parent holds.
    const owner: Actor = { credential: 'bearer', tokenId: w.token.id, userId: w.user.id, email: w.user.email!, emailVerified: true };
    const frameOf = async (headers: Record<string, string>) => {
      const html = await (await app.request(as(`${APP}/a/${w.secret}`, owner, { headers: { accept: 'text/html', ...headers } }))).text();
      return new URL(/<iframe data-mx-document-frame="" src="([^"]+)"/.exec(html)![1]!.replaceAll('&amp;', '&'));
    };
    expect((await frameOf({})).searchParams.get('_pt')).toBe('-');
    const src = await frameOf({ [BROWSER_SESSION_HEADER]: '1' });
    expect(src.searchParams.get('_pt')).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    const exchanged = await app.request(as(src.href, owner, { headers: { [BROWSER_SESSION_HEADER]: '1' } }));
    expect(exchanged.status).toBe(200);
    const cookie = cookieOf(exchanged)!;
    expect(await pagesSessionActor(cookie, w.secret)).toEqual({ credential: 'agent-cookie', userId: w.user.id, tokenId: w.token.id, email: w.user.email! });
    // The document's own door reads the private document as the session's reader.
    const self = pagesOriginFor(w.secret, site);
    const read = await app.request(as(`${self}/a/${w.secret}/query`, owner, { method: 'POST', headers: { [BROWSER_SESSION_HEADER]: '1', 'x-forwarded-host': new URL(self).host, cookie: `${COOKIE}=${cookie}`, 'content-type': 'text/plain' }, body: query(w.secret) }));
    expect(read.status, await read.clone().text()).toBe(200);
    expect(await read.json()).toEqual({tables:{},errors:{}});
    // The session mark with no transport behind it is nobody's session: a guest page, the guest marker.
    const open = await w.publish('<h1>Open</h1>', 'unlisted');
    const unmarked = await (await app.request(`${APP}/a/${open}`, { headers: { accept: 'text/html', [BROWSER_SESSION_HEADER]: '1', authorization: `Bearer ${w.token.token}` } })).text();
    expect(unmarked).toMatch(/_pt=-/);
  });

  it('spends a ticket once, within 60 s; a guest gets none; a revoked token ends the session it rode', async () => {
    const w = await world();
    const bind = bindingOf(w.secret);
    expect(await issuePagesTicket(testIdentity('none'), {}, Date.now(), bind)).toBeNull();
    const now = Date.now();
    const late = (await issuePagesTicket(testIdentity('session', { userId: w.user.id, email: null }), {}, now, bind))!;
    expect(await exchangePagesTicket(late, bind, now + 61_000)).toBeNull();
    const guest = await mintToken('guest-owner', null);
    expect(await issuePagesTicket(testIdentity('agent-cookie', { tokenId: guest.id }), {}, Date.now(), bind)).toBeNull();
    const ticket = (await issuePagesTicket(testIdentity('bearer', { userId: w.user.id, email: w.user.email!, emailVerified: true, tokenId: w.token.id }), {}, now, { ...bind, browserSession: true }))!;
    const session = (await exchangePagesTicket(ticket, bind))!;
    expect(await exchangePagesTicket(ticket, bind)).toBeNull();
    expect(await pagesSessionActor(session.cookie, w.secret)).toEqual({ credential: 'agent-cookie', userId:w.user.id, email:w.user.email!, emailVerified:true, tokenId: w.token.id });
    await revokeToken(w.token.id);
    expect(await pagesSessionActor(session.cookie, w.secret)).toBeNull();
    // …and a token revoked between the app page and the exchange never renders once: the reader is read back.
    const stale = (await issuePagesTicket(testIdentity('bearer', { userId: w.user.id, email: w.user.email!, emailVerified: true, tokenId: w.token.id }), {}, now, { ...bind, browserSession: true }))!;
    expect(await exchangePagesTicket(stale, bind)).toBeNull();
  });

  it('is bound to its document and its exact origin: a foreign ticket mints nothing and renders as nobody', async () => {
    const w = await world();
    const app = framing();
    const actor = testIdentity('session', { userId: w.user.id, email: null });
    const forX = (await issuePagesTicket(actor, {}, Date.now(), bindingOf(w.secret)))!;
    // Spent at another document's origin: refused, and consumed (a wrong guess is never tried twice).
    const atOther = await app.request(`${pagesOriginFor(w.other, site)}/?_pt=${forX}`);
    expect(atOther.status).toBe(404);
    expect(atOther.headers.get('set-cookie')).toBeNull();
    expect((await app.request(`${pagesOriginFor(w.secret, site)}/?_pt=${forX}`)).status).toBe(404);
    // The right id at another origin is refused the same way.
    const wrongOrigin = (await issuePagesTicket(actor, {}, Date.now(), { artifactId: w.secret, origin: 'https://evil.pages.example.test' }))!;
    const atRight = await app.request(`${pagesOriginFor(w.secret, site)}/?_pt=${wrongOrigin}`);
    expect(atRight.status).toBe(404);
    expect(atRight.headers.get('set-cookie')).toBeNull();
    expect(await exchangePagesTicket(forX, bindingOf(w.secret))).toBeNull();
    // A malformed value is a spent ticket.
    expect((await app.request(`${pagesOriginFor(w.secret, site)}/?_pt=not%20a%20ticket`)).status).toBe(404);
  });

  it('renders a guest as nobody even when a cookie is held, and clears it in the same response', async () => {
    const w = await world();
    const app = framing();
    const cookie = await pagesCookie(app, w.actor, w.secret);
    const self = pagesOriginFor(w.secret, site);
    const held = { cookie: `${COOKIE}=${cookie}` };
    expect((await app.request(`${self}/`, { headers: held })).status).toBe(200);
    // The guest frame of the SAME private document: nobody sees it, whoever this browser was signed in as before.
    const guest = await app.request(`${self}/?_pt=-`, { headers: held });
    expect(guest.status).toBe(404);
    expect(await guest.text()).not.toContain('Private plan');
    expect(guest.headers.get('set-cookie')).toBe(`${COOKIE}=; Path=/; HttpOnly; SameSite=None; Max-Age=0; Secure; Partitioned`);
    // The row is gone too: the old cookie value names nobody on the doors.
    const after = await app.request(`${self}/a/${w.secret}/query`, { method: 'POST', headers: { origin: self, ...held, 'content-type': 'text/plain' }, body: query(w.secret) });
    expect(after.status).toBe(404);
    // A public document rendered to a guest carries nothing of the reader's.
    const open = await w.publish('<Helmet><Value name="region" type="string" default="north" /></Helmet><p>{$region}</p>', 'unlisted');
    const reader = await pagesCookie(app, w.actor, open);
    const asGuest = await app.request(`${pagesOriginFor(open, site)}/?_pt=-`, { headers: { cookie: `${COOKIE}=${reader}` } });
    expect(asGuest.status).toBe(200);
    expect(runtime(await asGuest.text())).toMatchObject({pageId:open,appOrigin:APP});
  });

  it('keeps today\'s behaviour for a visit with no parameter: the browser\'s own cookie for this host decides', async () => {
    const w = await world();
    const app = framing();
    const cookie = await pagesCookie(app, w.actor, w.secret);
    const self = pagesOriginFor(w.secret, site);
    expect((await app.request(`${self}/`, { headers: { cookie: `${COOKIE}=${cookie}` } })).status).toBe(200);
    expect((await app.request(`${self}/`)).status).toBe(404);
    // A replayed (spent) ticket keeps what the browser holds, and nothing more.
    const spent = (await issuePagesTicket(testIdentity('session', { userId: w.user.id, email: null }), {}, Date.now(), bindingOf(w.secret)))!;
    expect((await app.request(`${self}/?_pt=${spent}`)).status).toBe(200);
    const replayHeld = await app.request(`${self}/?_pt=${spent}`, { headers: { cookie: `${COOKIE}=${cookie}` } });
    expect(replayHeld.status).toBe(200);
    expect(replayHeld.headers.get('set-cookie')).toBeNull();
  });

  it('never spends a ticket on a HEAD, and never lets the parameter reach the document', async () => {
    const w = await world();
    const app = framing();
    const self = pagesOriginFor(w.secret, site);
    const ticket = (await issuePagesTicket(testIdentity('session', { userId: w.user.id, email: null }), {}, Date.now(), bindingOf(w.secret)))!;
    const head = await app.request(`${self}/?_pt=${ticket}`, { method: 'HEAD' });
    expect(head.headers.get('set-cookie')).toBeNull();
    expect((await app.request(`${self}/?_pt=${ticket}`)).status).toBe(200);
    const id = await w.publish('<Helmet><Value name="region" type="string" default="north" /></Helmet><p>{$region}</p>', 'public');
    const html = await (await app.request(`${pagesOriginFor(id, site)}/?$region=west&_pt=-&x=1`)).text();
    expect(runtime(html)).toMatchObject({pageId:id});
    expect(html).not.toContain('_pt');
  });

  it('keeps the cookie the document origin\'s alone: another document never receives it, and a cookie shown there names nobody', async () => {
    const w = await world();
    const app = framing();
    const cookie = await pagesCookie(app, w.actor, w.secret);
    const readable = await w.publish('<h1>Second</h1>', 'private');
    // The same value presented at another document's origin (a buggy proxy, a stolen value) is not that document's session.
    expect((await app.request(`${pagesOriginFor(readable, site)}/`, { headers: { cookie: `${COOKIE}=${cookie}` } })).status).toBe(404);
    const door = await app.request(`${pagesOriginFor(readable, site)}/a/${readable}/query`, { method: 'POST', headers: { origin: pagesOriginFor(readable, site), cookie: `${COOKIE}=${cookie}`, 'content-type': 'text/plain' }, body: '{}' });
    expect(door.status).toBe(404);
    // The server reads only the prefixed name: a planted plain-named cookie (a sibling's toss) is ignored, first or last.
    const self = pagesOriginFor(w.secret, site);
    const planted = await app.request(`${self}/`, { headers: { cookie: `afbin_pages=${cookie}` } });
    expect(planted.status).toBe(404);
    const both = await app.request(`${self}/`, { headers: { cookie: `afbin_pages=junk-0123456789abcdef; ${COOKIE}=${cookie}` } });
    expect(both.status).toBe(200);
  });

  it('keeps a spent ticket in a document\'s location from being a credential', async () => {
    const w = await world();
    const app = framing();
    const src = await frameSrc(app, w.actor, w.secret);
    const first = await app.request(src.href);
    expect(first.status).toBe(200);
    const text = await first.text();
    // What a script reading `location.href` holds is the frame's first URL. Presented again, anywhere, it buys nothing.
    for (const url of [src.href, `${src.origin}/${src.search}`, `${pagesOriginFor(w.other, site)}/${src.search}`]) {
      const again = await app.request(url);
      expect(again.status, url).toBe(404);
      expect(again.headers.get('set-cookie'), url).toBeNull();
    }
    expect(text).not.toContain(src.searchParams.get('_pt')!);
    // The response that carried it is private and revalidated on every use (never shared), and never sent on as a referrer.
    expect(first.headers.get('cache-control')).toBe('private, no-cache');
    expect(first.headers.get('referrer-policy')).toBe('no-referrer');
    // …and a script cannot ask for a new one: a pages origin is refused on every app route.
    const asked = await app.request(`${APP}/api/page/frame/${w.secret}`, { headers: { origin: src.origin } });
    expect(asked.status).toBe(403);
  });

  it('ends at logout: the app ends every session of the reader, a document origin may not end any', async () => {
    const w = await world();
    const app = framing();
    const cookie = await pagesCookie(app, w.actor, w.secret);
    const second = await w.publish('<h1>Second</h1>', 'private');
    const cookie2 = await pagesCookie(app, w.actor, second);
    const self = pagesOriginFor(w.secret, site);
    const door = (id: string, value: string) => app.request(`${pagesOriginFor(id, site)}/a/${id}/query`, { method: 'POST', headers: { origin: pagesOriginFor(id, site), cookie: `${COOKIE}=${value}`, 'content-type': 'text/plain' }, body: query(id) });
    expect((await door(w.secret, cookie)).status).toBe(200);
    // A document origin has no way to end a session (nor the apex).
    for (const base of [self, APEX]) expect((await app.request(`${base}/pages-session`, { method: 'DELETE', headers: { origin: self, cookie: `${COOKIE}=${cookie}` } })).status).toBe(404);
    expect((await door(w.secret, cookie)).status).toBe(200);
    // Someone else's sign-out ends nothing of theirs.
    const stranger = await createUser({ email: 'pages-stranger@example.com' });
    await clearSession(as(`${APP}/api/session/token`, { credential: 'session', userId: stranger.id, email: 'pages-stranger@example.com', emailVerified: true }, { method: 'DELETE' }));
    expect((await door(w.secret, cookie)).status).toBe(200);
    // The app's own sign-out call ends them all, whichever document, whatever cookies the browser still holds.
    const out = await clearSession(as(`${APP}/api/session/token`, w.actor, { method: 'DELETE' }));
    expect(out.status).toBe(204);
    expect((await door(w.secret, cookie)).status).toBe(404);
    expect((await door(second, cookie2)).status).toBe(404);
    expect((await app.request(`${self}/`, { headers: { cookie: `${COOKIE}=${cookie}` } })).status).toBe(404);
  });

  it('loads the framed document in a query budget, without the apex\'s statements', async () => {
    const w = await world();
    const app = framing();
    const src = await frameSrc(app, w.actor, w.secret);
    const { value, stats } = await measureQueries(() => loadFrame(app, src.href));
    expect(value.res.status).toBe(200);
    expect(value.cookie).not.toBeNull();
    // ticket claim + expired sweep + insert + the account check + the document's own statements: no second session read.
    expect(stats.count).toBeLessThanOrEqual(BUDGET.exchange);
  });

  it('on a development http site uses the plain host-only name, still HttpOnly and Lax, never Secure', async () => {
    const dev = pagesSiteFor('lvh.me', 'http://app.lvh.me:11001')!;
    const w = await world();
    const devApp = createAppServer({ indexHtml: async () => SHELL, pagesSite: dev });
    const page = await devApp.request(as('http://app.lvh.me:11001/a/' + w.secret, w.actor, { headers: { accept: 'text/html' } }));
    const src = new URL(/<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())![1]!.replaceAll('&amp;', '&'));
    expect(src.origin).toBe(pagesOriginFor(w.secret, dev));
    const res = await devApp.request(src.href);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^afbin_pages=[A-Za-z0-9_-]{40,}; Path=\/; HttpOnly; SameSite=Lax$/);
    const value = /^afbin_pages=([^;]+)/.exec(res.headers.get('set-cookie')!)![1]!;
    expect((await devApp.request(`${src.origin}/`, { headers: { cookie: `afbin_pages=${value}` } })).status).toBe(200);
    // …and the prefixed name is not read there.
    expect((await devApp.request(`${src.origin}/`, { headers: { cookie: `__Host-afbin_pages=${value}` } })).status).toBe(404);
    const guest = await devApp.request(`${src.origin}/?_pt=-`, { headers: { cookie: `afbin_pages=${value}` } });
    expect(guest.headers.get('set-cookie')).toBe('afbin_pages=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  });
});

/**
 * A FIRST URL LOADED TWICE: the browser asks for the frame's first URL, the server spends the ticket, and the response never
 * arrives — WebKit reloads a frame the page re-parents, a prefetch or a retried connection does the same — so the browser
 * asks again with the same ticket and the cookie it held before. The second request must find the session the first one
 * bought; nobody else's request ever may.
 */
describe('a first URL loaded twice', () => {
  const held = (value: string) => ({ headers: { cookie: `${COOKIE}=${value}` } });

  it('a repeat view whose response never arrived: the same browser, asking again, is sent on with the SAME session, and reads the private document', async () => {
    const w = await world();
    const app = framing();
    const self = pagesOriginFor(w.secret, site);
    const before = await pagesCookie(app, w.actor, w.secret);
    const src = (await frameSrc(app, w.actor, w.secret)).href;
    // The response is lost: the browser keeps `before`.
    const lost = await app.request(src, held(before));
    expect(lost.status).toBe(302);
    const minted = cookieOf(lost)!;
    expect(minted).not.toBe(before);
    // WebKit's second load: the same URL, the same cookie. The same answer, the same session — nothing new minted.
    const again = await app.request(src, held(before));
    expect(again.status).toBe(302);
    expect(again.headers.get('location')).toBe('/');
    expect(again.headers.get('cache-control')).toBe('no-store');
    expect(again.headers.get('referrer-policy')).toBe('no-referrer');
    expect(cookieOf(again)).toBe(minted);
    const doc = await app.request(`${self}/`, held(minted));
    expect(doc.status).toBe(200);
    expect(await doc.text()).toContain('Private plan');
    // …as many times as the browser asks within the window (a reload, then back).
    expect(cookieOf(await app.request(src, held(before)))).toBe(minted);
    // The session the browser held before is still replaced: it names nobody.
    expect(await pagesSessionActor(before, w.secret)).toBeNull();
    expect(await pagesSessionActor(minted, w.secret)).toMatchObject({ userId: w.user.id });
  });

  it('hands nothing to a browser whose cookie proves nothing: a dead one, or one a document\'s author could have planted', async () => {
    const w = await world();
    const app = framing();
    // A dead cookie (signed out since): the spent ticket stays spent, as for a browser that held nothing.
    const dead = await pagesCookie(app, w.actor, w.secret);
    await clearSession(as(`${APP}/api/session/token`, w.actor, { method: 'DELETE' }));
    const src = (await frameSrc(app, w.actor, w.secret)).href;
    expect((await app.request(src, held(dead))).status).toBe(200);
    const again = await app.request(src, held(dead));
    expect(again.status).toBe(404);
    expect(again.headers.get('set-cookie')).toBeNull();
    // The author's own live session for their unlisted document, planted by its script in a guest's browser (document.cookie
    // can write the pages name while no HttpOnly cookie is held). The visitor signs in and opens it: the script reads the
    // ticket from its location, and the author holds the planted value. Together they buy nothing.
    const open = await w.publish('<h1>Open</h1>', 'unlisted');
    const planted = await pagesCookie(app, w.actor, open);
    const visitor = await createUser({ email: 'mxmx_test_pages_visitor@example.com' });
    const visitorActor: Actor = { credential: 'session', userId: visitor.id, email: visitor.email!, emailVerified: true };
    const visit = new URL(await frameSrc(app, visitorActor, open));
    const first = await app.request(visit.href, held(planted));
    expect(first.status).toBe(200);
    const visitorCookie = cookieOf(first)!;
    expect(await pagesSessionActor(visitorCookie, open)).toMatchObject({ userId: visitor.id });
    for (const init of [held(planted), {}]) {
      const replay = await app.request(visit.href, init);
      expect(replay.headers.get('set-cookie')).toBeNull();
      expect(await replay.text()).not.toContain(visitor.id);
    }
    expect(await exchangePagesTicket(visit.searchParams.get('_pt')!, { ...bindingOf(open), held: planted })).toBeNull();
  });

  it('hands that session to nobody else: no cookie, another cookie, another document, after the window, after sign-out', async () => {
    const w = await world();
    const app = framing();
    const self = pagesOriginFor(w.secret, site);
    const before = await pagesCookie(app, w.actor, w.secret);
    const src = new URL(await frameSrc(app, w.actor, w.secret));
    const minted = cookieOf(await app.request(src.href, held(before)))!;
    // The ticket alone — what a document's script could read from its location, or a log could hold — buys nothing.
    for (const [label, init] of [
      ['no cookie', {}],
      ['another cookie', held('another-browser-0123456789abcdefghij')],
      ['a cookie for another document', held(await pagesCookie(app, w.actor, w.other))],
    ] as const) {
      const replay = await app.request(src.href, init);
      expect(replay.status, label).toBe(404);
      expect(replay.headers.get('set-cookie'), label).toBeNull();
    }
    // The same browser's cookie at another document's origin is not that document's.
    const elsewhere = await app.request(`${pagesOriginFor(w.other, site)}/${src.search}`, held(before));
    expect(elsewhere.status).toBe(404);
    expect(elsewhere.headers.get('set-cookie')).toBeNull();
    // A browser that received the new session reads as it, and is handed nothing more.
    const received = await app.request(src.href, held(minted));
    expect(received.status).toBe(200);
    expect(received.headers.get('set-cookie')).toBeNull();
    // After the window the ticket is only spent; after sign-out the session it bought is gone and is never handed out again.
    const ticket = src.searchParams.get('_pt')!;
    expect(await exchangePagesTicket(ticket, { ...bindingOf(w.secret), held: before }, Date.now() + 31_000)).toBeNull();
    expect(await exchangePagesTicket(ticket, { ...bindingOf(w.secret), held: before })).toMatchObject({ cookie: minted });
    await clearSession(as(`${APP}/api/session/token`, w.actor, { method: 'DELETE' }));
    const afterSignOut = await app.request(src.href, held(before));
    expect(afterSignOut.status).toBe(404);
    expect(afterSignOut.headers.get('set-cookie')).toBeNull();
    expect((await app.request(`${self}/`, held(minted))).status).toBe(404);
  });

  it('keeps a browser that held nothing to today\'s rule: the spent ticket renders as nobody', async () => {
    const w = await world();
    const app = framing();
    const src = (await frameSrc(app, w.actor, w.secret)).href;
    expect((await app.request(src)).status).toBe(200);
    const again = await app.request(src);
    expect(again.status).toBe(404);
    expect(again.headers.get('set-cookie')).toBeNull();
  });
});

describe('a document\'s own origin', () => {
  it('admits only its own file-upload door and its filename header', async () => {
    const w = await world();
    const app = framing();
    const self = pagesOriginFor(w.secret, site);
    const path = `/a/${w.secret}/datasets/Attach01/files`;
    const preflight = await app.request(`${self}${path}`, { method: 'OPTIONS', headers: { origin: self, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-edit-id,idempotency-key,x-filename' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('x-filename');
    const refused = await app.request(`${self}/a/${w.other}/datasets/Attach01/files`, { method: 'OPTIONS', headers: { origin: self } });
    expect(refused.status).toBe(404);
    const anonymous = await app.request(`${self}${path}`, { method: 'POST', headers: { origin: self }, body: 'synthetic' });
    expect(anonymous.status).toBe(403);
    expect(await anonymous.json()).toMatchObject({ error: 'dataset_file_upload_failed' });
  });

  it('serves its standalone page under the document policy, with direct absolute doors, to its pages session alone', async () => {
    const w = await world();
    const app = framing();
    const cookie = await pagesCookie(app, w.actor, w.secret);
    const self = pagesOriginFor(w.secret, site);
    const res = await app.request(`${self}/`, { headers: { cookie: `${COOKIE}=${cookie}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(nativeHtmlPolicy(w.secret,APP,{self,app:APP}));
    expect(res.headers.get('content-security-policy')).not.toMatch(/(^|; )sandbox/);
    const html = await res.text();
    expect(html).toContain('Private plan');
    expect(html).not.toContain('data-mx-reader-chrome=""');
    expect(html).toContain('data-af="core"');
    expect(runtime(html)).toMatchObject({pageId:w.secret,appOrigin:APP});
    // Nobody's cookie, or no cookie: the uniform 404 a private document answers.
    expect((await app.request(`${self}/`)).status).toBe(404);
    expect((await app.request(`${self}/`, { headers: { cookie: `${COOKIE}=not-a-session-0123456789abcdef` } })).status).toBe(404);
  });

  it('answers its own doors with its reader and credentialed CORS for exactly its own origin', async () => {
    const w = await world();
    const app = framing();
    const cookie = await pagesCookie(app, w.actor, w.secret);
    const self = pagesOriginFor(w.secret, site);
    const res = await app.request(`${self}/a/${w.secret}/query`, { method: 'POST', headers: { origin: self, cookie: `${COOKIE}=${cookie}`, 'content-type': 'text/plain' }, body: query(w.secret) });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(self);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('vary')).toMatch(/Origin/);
    const body = (await res.json()) as { tables: Record<string, { rows: Array<Record<string, unknown>> }> };
    expect(body).toEqual({tables:{},errors:{}});
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
    const cookie = `${COOKIE}=${await pagesCookie(app, w.actor, w.secret)}`;
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
    const cookie = `${COOKIE}=${await pagesCookie(app, w.actor, w.secret)}`;
    const self = pagesOriginFor(w.secret, site);
    const t = await mintToken('embedded-owner');
    const res = await createRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { html:nativeHtml('<h1>Open</h1>'), visibility: 'unlisted' } }));
    const { id: open } = (await res.json()) as { id: string };
    expect((await app.request(`${self}/a/${open}/raw`, { headers: { cookie } })).status).toBe(200);
    // The reader may read `other`, but its document's origin asks as nobody.
    expect((await app.request(`${self}/a/${w.other}/raw`, { headers: { cookie } })).status).toBe(404);
    expect((await app.request(`${self}/a/${open}/raw`, { method: 'POST', headers: { cookie } })).status).toBe(404);
  });

  it('serves nothing else: not the app, not another document, not its own raw or export', async () => {
    const w = await world();
    const app = framing();
    const cookie = `${COOKIE}=${await pagesCookie(app, w.actor, w.secret)}`;
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
    const cookie = `${COOKIE}=${await pagesCookie(app, w.actor, w.secret)}`;
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
  /** A private document of the owner's whose native head declares `connect` (its publish is the owner's consent). */
  const declaring = async (w: Awaited<ReturnType<typeof world>>, connect: string[], visibility = 'private') => {
    const id = await w.publish('<h1>Rates</h1>', visibility,`<meta name="csp-connect" content="${connect.join(' ')}">`);
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
    const cookie = `${COOKIE}=${await pagesCookie(app, w.actor, id)}`;
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
    const id = await declaring(w, ['https://api.example.org', 'https://127.0.0.1', 'https://10.0.0.7', 'https://anything.localhost', 'https://x.lvh.me']);
    // The server resolves loopback names itself (server.ts installs the loopback lookup): a declared one is still loopback.
    useLoopbackLookup();
    const cookie = `${COOKIE}=${await pagesCookie(app, w.actor, id)}`;
    const self = pagesOriginFor(id, site);
    const door = (url: string, init: RequestInit = {}) => app.request(`${self}/a/${id}/fetch?url=${encodeURIComponent(url)}`, { ...init, headers: { origin: self, cookie, ...(init.headers ?? {}) } });
    const undeclared = await door('https://evil.example.net/steal');
    expect(undeclared.status).toBe(403);
    expect(((await undeclared.json()) as { error: string }).error).toBe('undeclared_host');
    for (const url of ['https://127.0.0.1/admin', 'https://10.0.0.7/', 'https://anything.localhost/admin', 'https://x.lvh.me/admin']) {
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
    const id = await w.publish('<h1>Weather</h1>','public',`<meta name="csp-connect" content="https://127.0.0.1:${port}"><meta name="csp-script" content="${PLOTLY}">`);
    const user = await createUser({ email: 'mxmx_test_pages_reader@example.com' });
    const t = await mintToken('pages-reader', user.id);
    await claimToken(user.id, t.token);
    const reader: Actor = { credential: 'session', userId: user.id, email: 'mxmx_test_pages_reader@example.com', emailVerified: true };
    const self = pagesOriginFor(id, site);
    /** The reader opens the app page (with whatever app-origin cookie they hold) and loads its frame. */
    const framedAs = async (appCookie: string | null) => {
      const page = await app.request(as(`${APP}/a/${id}`, reader, { headers: { accept: 'text/html', ...(appCookie ? { cookie: appCookie } : {}) } }));
      const src = /<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())![1]!.replaceAll('&amp;', '&');
      const exchanged = await app.request(src);
      const cookie = `${COOKIE}=${cookieOf(exchanged)!}`;
      const doc = await app.request(`${self}/`, { headers: { cookie } });
      expect(doc.status).toBe(200);
      const script = (doc.headers.get('content-security-policy') ?? '').split('; ').find((d) => d.startsWith('script-src ')) ?? '';
      const fetched = await app.request(`${self}/a/${id}/fetch?url=${encodeURIComponent(`http://127.0.0.1:${port}/now`)}`, { headers: { origin: self, cookie } });
      const etag=doc.headers.get('etag');expect(etag).toBeTruthy();
      const cached=await app.request(`${self}/`,{headers:{cookie,'if-none-match':etag!}});expect(cached.status).toBe(304);
      const head=await app.request(`${self}/`,{method:'HEAD',headers:{cookie}});expect(head.headers.get('etag')).toBe(etag);expect(head.headers.get('content-security-policy')).toBe(doc.headers.get('content-security-policy'));
      return { script, fetched,etag };
    };

    const before = await framedAs(null);
    expect(before.script).not.toContain(PLOTLY);
    expect(before.fetched.status).toBe(403);
    expect(((await before.fetched.json()) as { error: string }).error).toBe('host_not_allowed');

    const granted = await grantRoute(request('/api/trust', { method: 'POST', json: { artifactId: id, grant: 'once' }, origin: 'same', actor: reader }));
    expect(granted.status, await granted.clone().text()).toBe(200);
    const trust = /((?:__Host-)?afbin_trust=[^;]+)/.exec(granted.headers.get('set-cookie') ?? '')![1]!;
    const after = await framedAs(trust);
    expect(after.etag).not.toBe(before.etag);
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
    const id = await w.publish('<h1>Chart</h1>','public',`<meta name="csp-script" content="${PLOTLY}">`);
    const self = pagesOriginFor(id, site);
    /** A signed-out reader opens the app page (with whatever app-origin cookie they hold) and loads its frame. */
    const framedAsGuest = async (appCookie: string | null) => {
      const page = await app.request(`${APP}/a/${id}`, { headers: { accept: 'text/html', ...(appCookie ? { cookie: appCookie } : {}) } });
      const src = new URL(/<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())![1]!.replaceAll('&amp;', '&'));
      const exchanged = await app.request(src.href);
      expect(exchanged.status).toBe(200);
      const pages = cookieOf(exchanged);
      const doc = await app.request(`${self}/`, { headers: pages ? { cookie: `${COOKIE}=${pages}` } : {} });
      expect(doc.status).toBe(200);
      const script = (doc.headers.get('content-security-policy') ?? '').split('; ').find((d) => d.startsWith('script-src ')) ?? '';
      return { ticket: src.searchParams.get('_pt') !== '-', pages, script };
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
    expect(await pagesSessionActor(after.pages, id)).toBeNull();
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
