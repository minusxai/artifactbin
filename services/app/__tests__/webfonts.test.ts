/**
 * Google Fonts, ingest-and-own — end to end through the real doors.
 *
 * A document asks for a face with Helmet metadata it can already write
 * (`<meta name="font-display" content="Lobster">`); the PUBLISH resolves the
 * family ONCE — css2 fetched, the woff2 files copied into the object store,
 * one `webfonts` row — and every render serves @font-face rules pointing at
 * `/webfonts/<hash>.woff2` on our own origin. Readers never talk to Google:
 * that is the GDPR half of the design, not an implementation detail.
 *
 * The Google endpoints here are a local fixture via the source seam — tests
 * never reach the network — which also lets the suite COUNT upstream hits and
 * prove the once-per-deployment cache.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as webfontRoute } from '@/app/webfonts/[file]/route';
import { POST as createArtifact } from '@/app/api/artifacts/route';


import { mintToken } from '@/lib/tokens';
import { setWebIngestPolicyForTests } from '@/lib/web-ingest/fetch';
import { setWebFontSourcesForTests } from '@/lib/webfonts';
import { useAppHarness, request } from '@/__tests__/harness';
import { withHttpServer, type RunningServer } from '@/__tests__/net';

useAppHarness();

const BASE = 'http://localhost:3000';
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.from([1, 2, 3, 4, 5, 6])]);

let server: RunningServer;
let google: string;
let css2Hits = 0;
let fileHits = 0;

beforeAll(async () => {
  server = await withHttpServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/css2') {
      css2Hits++;
      const family = url.searchParams.get('family') ?? '';
      if (!family.startsWith('Lobster')) { res.writeHead(400); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(`/* latin-ext */
@font-face { font-family: 'Lobster'; font-style: normal; font-weight: 400; src: url(${google}/s/lobster/ext.woff2) format('woff2'); unicode-range: U+0100-02BA; }
/* latin */
@font-face { font-family: 'Lobster'; font-style: normal; font-weight: 400; src: url(${google}/s/lobster/lat.woff2) format('woff2'); unicode-range: U+0000-00FF; }`);
      return;
    }
    if (url.pathname.startsWith('/s/')) {
      fileHits++;
      res.writeHead(200, { 'Content-Type': 'font/woff2' });
      res.end(WOFF2);
      return;
    }
    res.writeHead(404); res.end();
  });
  google = server.base;
  setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true });
  setWebFontSourcesForTests({ cssBase: google, fileHost: '127.0.0.1' });
});

afterAll(async () => {
  setWebIngestPolicyForTests(null);
  setWebFontSourcesForTests(null);
  await server.close();
});

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const DOC = `<Helmet><title>Fonts</title><meta name="font-display" content="Lobster" /></Helmet>
<div className="p-8"><h1 className="text-4xl font-bold">Headlined</h1><p>body</p></div>`;

describe('a document asks for a Google font by Helmet metadata', () => {
  it('publish resolves it; the served head carries self-origin @font-face, a preload, and the var override', async () => {
    const t = await mintToken('t');
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: DOC } }));
    expect(res.status).toBe(201);
    const { id } = await res.json();

    const page = await rawRoute(request(`/a/${id}/raw`), params({ id }));
    const html = await page.text();
    // Two faces (latin + latin-ext), OUR urls, never Google's.
    const faces = [...html.matchAll(/@font-face\s*{[^}]*font-family:\s*"Lobster"[^}]*}/g)];
    expect(faces).toHaveLength(2);
    expect(html).toMatch(/\/webfonts\/[0-9a-f]{32}\.woff2/);
    expect(html).not.toContain('gstatic');
    expect(html).not.toContain('127.0.0.1'); // the fixture host must not leak either
    // The latin upright is preloaded like a bundled family's.
    expect(html).toMatch(/<link rel="preload" href="\/webfonts\/[0-9a-f]{32}\.woff2" as="font" type="font\/woff2" crossorigin>/);
    // The display var now names the family, so headings actually change.
    expect(html).toContain('--font-display: "Lobster"');
  });

  it('/webfonts serves the copied bytes — immutable, CORS-open, no app CSP', async () => {
    const t = await mintToken('t');
    const { id } = await (await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: DOC } }))).json();
    const html = await (await rawRoute(request(`/a/${id}/raw`), params({ id }))).text();
    const file = /\/webfonts\/([0-9a-f]{32}\.woff2)/.exec(html)![1];

    const res = await webfontRoute(request(`/webfonts/${file}`), params({ file }));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(WOFF2)).toBe(true);
    expect(res.headers.get('Content-Type')).toBe('font/woff2');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');

    expect((await webfontRoute(request('/webfonts/deadbeef.woff2'), params({ file: 'deadbeef.woff2' }))).status).toBe(404);
    expect((await webfontRoute(request('/webfonts/../etc/passwd'), params({ file: '../etc/passwd' }))).status).toBe(404);
  });

  it('resolves a family ONCE per deployment — the second document is a table hit', async () => {
    const t = await mintToken('t');
    const before = css2Hits;
    await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: DOC } }));
    await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: DOC, title: 'again' } }));
    expect(css2Hits - before).toBe(1);
  });

  it('an unknown family fails the PUBLISH, naming it — never a document with silent fallback', async () => {
    const t = await mintToken('t');
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: {
      markup: '<Helmet><meta name="font-display" content="Not A Real Font" /></Helmet><p>x</p>',
    } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unknown_font');
    expect(String(JSON.stringify(body))).toContain('Not A Real Font');
  });

  it('a BUNDLED family needs no fetch — the override var is the whole change', async () => {
    const t = await mintToken('t');
    const before = css2Hits;
    const res = await createArtifact(request('/api/artifacts', { method: 'POST', token: t.token, json: {
      markup: '<Helmet><meta name="font-body" content="JetBrains Mono" /></Helmet><p>mono body</p>',
    } }));
    expect(res.status).toBe(201);
    expect(css2Hits - before).toBe(0);
    const { id } = await res.json();
    const html = await (await rawRoute(request(`/a/${id}/raw`), params({ id }))).text();
    expect(html).toContain('--font-body: "JetBrains Mono"');
  });
});
