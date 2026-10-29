/**
 * lib/http's interface and declared leaves, one rule per helper: request addressing (base URL, public origin, the
 * cross-site check, cookies, byte ranges), the 401 every door answers, pagination cursors, safe redirects, the login
 * address and its intent, the app's page paths, artifact addresses, the app build stamp, query request bodies,
 * public revalidation, the shared in-process request cache and the retrying fetch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APP_BUILD_HEADER, APP_BUILD_META, GITHUB_EXTERNAL_URL, GUEST_TICKET, LIVE_KEEPALIVE_EVENT, MARKDOWN_CONTENT_TYPE, PAGES_TICKET_PARAM,
  REPO_URL, REVALIDATE, appBuild, artifactViewPath, baseUrl, canonicalArtifactPath, decodePage, domainPostPath, encodeCursor,
  forgetShared, internalRedirectTarget, isCrossSiteRequest, liveKeepaliveFrame, loginHref, loginRedirectTarget, markPagesRequest,
  pagesRequestOf, pagesSite, parseByteRange, parseCookie, parsePrettyPath, parseQueryRequest, primeShared, publicOrigin,
  publicRevalidatedResponse, setAppBuild, sharedRequest, spaPaths, titleSlug, unauthorized,
} from '@/lib/http';
import { DEV_SPA_PATHS, SPA_PATHS, isAppPagePath } from '@/lib/http/app-pages';
import { readIntent, withIntent } from '@/lib/http/intent';
import { resetShared } from '@/lib/http/shared-request';
import { artifactEditPath } from '@/lib/http/urls';
import { retryingFetch } from '@/lib/http/retry-lazily';
import { MAX_QUERY_ROWS, PUBLIC_BASE_URL, overrideRequestHeaders, runWithRequest } from '@/lib/platform';
import { request } from '@/__tests__/harness';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); overrideRequestHeaders(undefined); resetShared(); setAppBuild(null); });

/** The harness's request (on http://localhost:3000), with these headers. */
const req = (headers: Record<string, string> = {}, method = 'GET') => request('/', { headers, method });

describe('addressing a request', () => {
  it('reads the base URL from the first forwarded proto and host, then the Host header, then the URL', () => {
    expect(baseUrl(req())).toBe('http://localhost:3000');
    expect(baseUrl(req({ host: 'app.example.com' }))).toBe('http://app.example.com');
    expect(baseUrl(req({ 'x-forwarded-proto': 'https, http', 'x-forwarded-host': 'a.example.com, b', host: 'c' }))).toBe('https://a.example.com');
  });

  it('answers the public origin from the request in scope, else the declared base URL', async () => {
    overrideRequestHeaders(() => null);
    expect(await publicOrigin()).toBe(PUBLIC_BASE_URL);
    overrideRequestHeaders(undefined);
    const inScope = await runWithRequest(req({ 'x-forwarded-host': 'pub.example.com' }), () => publicOrigin());
    expect(inScope).toBe('https://pub.example.com');
    expect(await runWithRequest(req({ 'x-forwarded-proto': 'http', host: 'h.example' }), () => publicOrigin())).toBe('http://h.example');
  });

  it('calls a request cross-site from Sec-Fetch-Site first, then a foreign or unparseable Origin', () => {
    expect(isCrossSiteRequest(req({ 'sec-fetch-site': 'cross-site' }))).toBe(true);
    expect(isCrossSiteRequest(req({ 'sec-fetch-site': 'same-site', origin: 'https://evil.example' }))).toBe(false);
    expect(isCrossSiteRequest(req())).toBe(false);
    expect(isCrossSiteRequest(req({ origin: 'http://localhost:3000' }))).toBe(false);
    expect(isCrossSiteRequest(req({ origin: 'https://app.example.com', 'x-forwarded-host': 'app.example.com' }))).toBe(false);
    expect(isCrossSiteRequest(req({ origin: 'https://evil.example', host: 'app.example.com' }))).toBe(true);
    expect(isCrossSiteRequest(req({ origin: 'null' }))).toBe(true);
  });

  it('reads one cookie by exact name', () => {
    expect(parseCookie(null, 'a')).toBeUndefined();
    expect(parseCookie('a=1; ab=2; junk; b = 3=4', 'b')).toBe('3=4');
    expect(parseCookie('ab=2', 'a')).toBeUndefined();
  });

  it('reads a single byte range, clamping to the file and refusing what cannot be served', () => {
    expect(parseByteRange(null, 10)).toBeNull();
    expect(parseByteRange('bytes=0-1', 0)).toBeNull();
    expect(parseByteRange('bytes=-', 10)).toBeNull();
    expect(parseByteRange('bytes=0-1,3-4', 10)).toBeNull();
    expect(parseByteRange('items=0-1', 10)).toBeNull();
    expect(parseByteRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 });
    expect(parseByteRange('bytes=2-', 10)).toEqual({ start: 2, end: 9 });
    expect(parseByteRange('bytes=2-99', 10)).toEqual({ start: 2, end: 9 });
    expect(parseByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseByteRange('bytes=-30', 10)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange('bytes=-0', 10)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=10-', 10)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=5-2', 10)).toBe('unsatisfiable');
  });

  it('answers 401 with the auth guides on the caller\'s own origin, never cached', async () => {
    const response = unauthorized(req({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'app.example.com' }));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ error: 'unauthorized', guide: 'https://app.example.com/llms.txt', help: expect.stringContaining('https://app.example.com/llms/http-auth') });
    expect(MARKDOWN_CONTENT_TYPE).toBe('text/plain; charset=utf-8');
  });
});

describe('pagination', () => {
  const cursor = (kind: string, position: Record<string, unknown>) => ({ cursor: encodeCursor(kind, position) });
  const refused = async (result: unknown) => (result instanceof Response ? { status: result.status, ...(await result.json()) } : result);

  it('defaults to 20 and accepts 1 through 100', async () => {
    expect(decodePage({}, 'artifacts')).toEqual({ limit: 20 });
    expect(decodePage({ limit: '1' }, 'artifacts')).toEqual({ limit: 1 });
    expect(decodePage({ limit: 100 }, 'artifacts')).toEqual({ limit: 100 });
    for (const limit of [0, 101, 1.5, 'x', -1]) expect(await refused(decodePage({ limit }, 'artifacts'))).toMatchObject({ status: 400, error: 'invalid_limit' });
  });

  it('round-trips each listing\'s cursor and refuses one from another listing or tampered', async () => {
    const created = '2026-10-29T10:00:00.000Z';
    expect(decodePage(cursor('artifacts', { id: 'abc123', created }), 'artifacts')).toEqual({ limit: 20, cursor: { id: 'abc123', created } });
    expect(decodePage(cursor('versions', { version: 3 }), 'versions')).toEqual({ limit: 20, cursor: { version: 3 } });
    expect(decodePage(cursor('comments', { seq: '42' }), 'comments')).toEqual({ limit: 20, cursor: { seq: '42' } });
    for (const [input, kind] of [
      [cursor('versions', { version: 3 }), 'comments'],
      [cursor('versions', { version: 0 }), 'versions'],
      [cursor('comments', { seq: 'x' }), 'comments'],
      [cursor('artifacts', { id: 'a b', created }), 'artifacts'],
      [cursor('artifacts', { id: 'abc', created: 'yesterday' }), 'artifacts'],
      [cursor('artifacts', {}), 'artifacts'],
      [{ cursor: 'not base64!' }, 'artifacts'],
      [{ cursor: 'a'.repeat(1025) }, 'artifacts'],
      [{ cursor: 7 }, 'artifacts'],
    ] as const) expect(await refused(decodePage(input, kind)), JSON.stringify(input)).toMatchObject({ status: 400, error: 'invalid_cursor' });
  });
});

describe('redirects and login', () => {
  const ORIGIN = 'https://app.example.com';
  it('keeps a redirect on our own origin, and never sends a login back to a login or an OAuth handshake', () => {
    expect(internalRedirectTarget(null, ORIGIN)).toBe('/');
    expect(internalRedirectTarget('/a/x?y=1#z', ORIGIN)).toBe('/a/x?y=1#z');
    expect(internalRedirectTarget('https://app.example.com/docs', ORIGIN)).toBe('/docs');
    expect(internalRedirectTarget('//evil.example/x', ORIGIN)).toBe('/');
    expect(internalRedirectTarget('https://evil.example/x', ORIGIN)).toBe('/');
    expect(internalRedirectTarget('http://[bad', ORIGIN)).toBe('/');
    expect(loginRedirectTarget('/a/x', ORIGIN)).toBe('/a/x');
    for (const loop of ['/login', '/login/', '/login/code', '/oauth/loopback?x=1', '/oauth/device']) expect(loginRedirectTarget(loop, ORIGIN), loop).toBe('/');
  });

  it('carries the reader\'s place and intent into the login address', () => {
    expect(loginHref({ pathname: '/', search: '', hash: '' })).toBe('/login');
    expect(loginHref({ pathname: '/login', search: '?x', hash: '' })).toBe('/login');
    expect(loginHref({ pathname: '/a/x', search: '?v=2', hash: '#c' })).toBe(`/login?callbackUrl=${encodeURIComponent('/a/x?v=2#c')}`);
    expect(loginHref({ pathname: '/', search: '?intent=like&v=1', hash: '' }, 'fork')).toBe(`/login?callbackUrl=${encodeURIComponent('/?v=1&intent=fork')}`);
  });

  it('reads only a known intent, and replaces rather than repeats it', () => {
    expect(readIntent('?intent=comment')).toBe('comment');
    expect(readIntent('intent=join&x=1')).toBe('join');
    expect(readIntent('?intent=delete')).toBeNull();
    expect(readIntent('?%E0%A4%A=1&intent=%E0%A4%A')).toBeNull();
    expect(readIntent('')).toBeNull();
    expect(withIntent('', 'like')).toBe('?intent=like');
    expect(withIntent('?intent=fork&a=1', 'follow')).toBe('?a=1&intent=follow');
  });
});

describe('paths', () => {
  it('knows the app\'s own pages, profiles included, and the development-only kit page', () => {
    for (const path of ['/', '/login', '/account', '/datasets/new', '/programs/p1/edit']) expect(isAppPagePath(path), path).toBe(true);
    for (const path of ['/a/x', '/programs/new/x', '/dev/ui', '/@Bad']) expect(isAppPagePath(path), path).toBe(false);
    expect(isAppPagePath('/@alice_1')).toBe(true);
    expect(spaPaths({ dev: false })).toBe(SPA_PATHS);
    expect(spaPaths({ dev: true })).toBe(DEV_SPA_PATHS);
    expect(DEV_SPA_PATHS.test('/dev/ui')).toBe(true);
    expect(SPA_PATHS.test('/dev/ui')).toBe(false);
    expect(DEV_SPA_PATHS.test('/login')).toBe(true);
  });

  it('builds and reads artifact addresses', () => {
    expect(titleSlug('Hello, World!')).toBe('hello-world');
    expect(canonicalArtifactPath({ id: 'abc123', title: 'Hello World' }, 'alice')).toBe('/@alice/abc123-hello-world');
    expect(canonicalArtifactPath({ id: 'abc123', title: null }, 'alice')).toBe('/@alice/abc123');
    expect(canonicalArtifactPath({ id: 'abc123', title: 'Hello' }, null)).toBe('/a/abc123');
    expect(domainPostPath({ id: 'abc123', title: 'Hello World' })).toBe('/abc123-hello-world');
    expect(domainPostPath({ id: 'abc123', title: '' })).toBe('/abc123');
    expect(parsePrettyPath(['@alice', 'abc123-hello-world'])).toEqual({ id: 'abc123' });
    expect(parsePrettyPath([])).toBeNull();
    expect(artifactViewPath('/a/abc123/edit')).toBe('/a/abc123');
    expect(artifactViewPath('/a/abc123/edit/')).toBe('/a/abc123');
    expect(artifactViewPath('/a/abc123')).toBe('/a/abc123');
    expect(artifactEditPath('a b')).toBe('/a/a%20b/edit');
    expect(REPO_URL).toBe('https://github.com/minusxai/artifactbin');
    expect(GITHUB_EXTERNAL_URL).toBe('/api/external/github');
  });
});

describe('the pages origin', () => {
  it('is the deployment\'s pages host under its public URL, and a request carries the mark the pages host gave it', () => {
    expect(pagesSite()).toMatchObject({ host: 'lvh.me', app: new URL(PUBLIC_BASE_URL).origin });
    expect(PAGES_TICKET_PARAM).toBe('_pt');
    expect(GUEST_TICKET).toBe('-');
    const marked = req();
    expect(pagesRequestOf(marked)).toBeNull();
    const mark = { id: 'doc', self: 'https://646f63.pages.example.test', site: pagesSite() };
    expect(markPagesRequest(marked, mark as never)).toBe(marked);
    expect(pagesRequestOf(marked)).toBe(mark);
    expect(pagesRequestOf(req())).toBeNull();
  });
});

describe('the app build', () => {
  it('stamps keepalive frames with the build the server is running', () => {
    expect(APP_BUILD_HEADER).toBe('x-artifactbin-build');
    expect(APP_BUILD_META).toBe('artifactbin-build');
    expect(appBuild()).toBeNull();
    expect(liveKeepaliveFrame()).toBe(`event: ${LIVE_KEEPALIVE_EVENT}\ndata: {}\n\n`);
    setAppBuild('b42');
    expect(appBuild()).toBe('b42');
    expect(liveKeepaliveFrame()).toBe('event: keepalive\ndata: {"build":"b42"}\n\n');
  });
});

describe('query requests', () => {
  const refusal = async (body: Record<string, unknown>) => { const r = parseQueryRequest(body); return r instanceof Response ? { status: r.status, ...(await r.json()) } : r; };
  it('accepts the declared fields', async () => {
    expect(await refusal({})).toEqual({});
    expect(await refusal({ values: { a: 1, b: 'x', c: null, d: true }, only: ['q'], tz: 'UTC', page: { name: 'q', offset: 0, limit: 1, sort: { col: 'a', dir: 'desc' } } }))
      .toEqual({ values: { a: 1, b: 'x', c: null, d: true }, only: ['q'], tz: 'UTC', page: { name: 'q', offset: 0, limit: 1, sort: { col: 'a', dir: 'desc' } } });
    expect(await refusal({ hold: 'imp' })).toEqual({ hold: 'imp' });
    expect(await refusal({ people: ['u1'] })).toEqual({ people: ['u1'] });
  });

  it('refuses unknown fields, SQL, malformed values and pages past the row cap', async () => {
    expect(await refusal({ sql: 'select 1' })).toMatchObject({ status: 400, error: 'unknown_query_fields' });
    expect(await refusal({ hold: 'imp', only: [] })).toMatchObject({ error: 'invalid_hold' });
    expect(await refusal({ people: 'u1' })).toMatchObject({ error: 'invalid_people' });
    expect(await refusal({ people: ['x'.repeat(201)] })).toMatchObject({ error: 'invalid_people' });
    expect(await refusal({ tz: 3 })).toMatchObject({ error: 'invalid_tz' });
    expect(await refusal({ values: [] })).toMatchObject({ error: 'invalid_values' });
    expect(await refusal({ values: { a: Number.NaN } })).toMatchObject({ error: 'invalid_values' });
    expect(await refusal({ values: { a: {} } })).toMatchObject({ error: 'invalid_values' });
    expect(await refusal({ only: 'q' })).toMatchObject({ error: 'invalid_only' });
    expect(await refusal({ localTables: 'x' })).toMatchObject({ error: 'invalid_local_state' });
    expect(await refusal({ page: { name: 'q', offset: 0, limit: MAX_QUERY_ROWS + 1 } })).toMatchObject({ error: 'invalid_page' });
    expect(await refusal({ page: { name: 'q', offset: -1, limit: 1 } })).toMatchObject({ error: 'invalid_page' });
    expect(await refusal({ page: { name: 'q', offset: 0, limit: 1, sort: { col: 'a', dir: 'up' } } })).toMatchObject({ error: 'invalid_page' });
    expect(await refusal({ page: null })).toMatchObject({ error: 'invalid_page' });
  });
});

describe('public revalidation', () => {
  it('serves a public body with a strong tag, 304 on a match, and no body for HEAD', async () => {
    const first = publicRevalidatedResponse(req(), 'hello', 'text/plain');
    const etag = first.headers.get('etag')!;
    expect(first.status).toBe(200);
    expect(await first.text()).toBe('hello');
    expect(first.headers.get('content-length')).toBe('5');
    expect(first.headers.get('access-control-allow-origin')).toBe('*');
    expect(publicRevalidatedResponse(req(), 'hello', 'text/plain').headers.get('etag')).toBe(etag);
    expect(publicRevalidatedResponse(req({ 'if-none-match': `W/${etag}` }), 'hello', 'text/plain').status).toBe(304);
    expect(publicRevalidatedResponse(req({ 'if-none-match': etag }), 'changed', 'text/plain').status).toBe(200);
    const head = publicRevalidatedResponse(req({}, 'HEAD'), 'hello', 'text/plain');
    expect(head.body).toBeNull();
    expect(head.headers.get('content-length')).toBe('5');
    expect(REVALIDATE).toBe('private, no-cache');
  });
});

describe('the shared request', () => {
  it('runs a key once while in flight, serves it within the ttl, and runs again when forced, forgotten or primed', async () => {
    vi.useFakeTimers();
    let runs = 0;
    const run = () => Promise.resolve(++runs);
    const [a, b] = await Promise.all([sharedRequest('k', run, { ttl: 1000 }), sharedRequest('k', run, { ttl: 1000 })]);
    expect([a, b, runs]).toEqual([1, 1, 1]);
    expect(await sharedRequest('k', run, { ttl: 1000 })).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(await sharedRequest('k', run, { ttl: 1000 })).toBe(2);
    expect(await sharedRequest('k', run, { ttl: 1000, force: true })).toBe(3);
    forgetShared('k');
    forgetShared('never-seen');
    expect(await sharedRequest('k', run, { ttl: 1000 })).toBe(4);
    primeShared('k', 'primed');
    expect(await sharedRequest('k', run, { ttl: 1000 })).toBe('primed');
    expect(await sharedRequest('k', run)).toBe(5);
    resetShared();
    primeShared('fresh', 'value');
    expect(await sharedRequest('fresh', run, { ttl: 10 })).toBe('value');
  });

  it('forgets a failed run so the next caller tries again', async () => {
    await expect(sharedRequest('f', () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    expect(await sharedRequest('f', () => Promise.resolve('up'))).toBe('up');
  });
});

describe('the retrying fetch', () => {
  it('answers a final status from the first attempt, and an aborted reader\'s failure without asking again', async () => {
    const fetch = vi.fn(async () => new Response('nope', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    expect((await retryingFetch('https://x/a')).status).toBe(404);
    const controller = new AbortController();
    controller.abort();
    fetch.mockRejectedValueOnce(new Error('aborted'));
    await expect(retryingFetch('https://x/b', { signal: controller.signal })).rejects.toMatchObject({ message: 'aborted', attempts: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
