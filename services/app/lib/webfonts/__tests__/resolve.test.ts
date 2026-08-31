/**
 * Resolving a family: the caching, the host narrowing, and the refusals.
 * The css2 fixture is local, so this never reaches Google — which also lets
 * the suite COUNT upstream hits and prove "once per deployment" rather than
 * assume it.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setWebIngestPolicyForTests } from '@/lib/web-ingest/fetch';
import { resolveWebFont, setWebFontSourcesForTests, UnknownFontError, webFontAssets, webFontObjectKey } from '../index';
import { useAppHarness } from '@/__tests__/harness';
import { withHttpServer, type RunningServer } from '@/__tests__/net';

const harness = useAppHarness();

const woff2For = (name: string) => Buffer.concat([Buffer.from('wOF2'), Buffer.from(name.padEnd(64, '.'))]);
const NOT_A_FONT = Buffer.from('<!doctype html><html>nope</html>');

let server: RunningServer;
let base: string;
let cssHits = 0;
let fileHits = 0;

const css = (family: string) => `/* latin-ext */
@font-face { font-family: '${family}'; font-style: normal; font-weight: 400; src: url(${base}/f/ext.woff2) format('woff2'); unicode-range: U+0100-02BA; }
/* latin */
@font-face { font-family: '${family}'; font-style: normal; font-weight: 400; src: url(${base}/f/lat.woff2) format('woff2'); unicode-range: U+0000-00FF; }`;

beforeAll(async () => {
  server = await withHttpServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/css2') {
      cssHits++;
      const family = (url.searchParams.get('family') ?? '').split(':')[0];
      if (family === 'Ghost Family') { res.writeHead(400); res.end(); return; }
      if (family === 'Empty Family') { res.writeHead(200, { 'Content-Type': 'text/css' }); res.end('/* nothing */'); return; }
      if (family === 'Bad Bytes') {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end(`/* latin */\n@font-face { font-family: 'Bad Bytes'; font-weight: 400; src: url(${base}/f/not-a-font.woff2) format('woff2'); unicode-range: U+0; }`);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(css(family));
      return;
    }
    if (url.pathname.startsWith('/f/')) {
      fileHits++;
      res.writeHead(200, { 'Content-Type': 'font/woff2' });
      res.end(url.pathname.includes('not-a-font') ? NOT_A_FONT : woff2For(url.pathname));
      return;
    }
    res.writeHead(404); res.end();
  });
  base = server.base;
  setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true });
  setWebFontSourcesForTests({ cssBase: base, fileHost: '127.0.0.1' });
});

afterAll(async () => {
  setWebIngestPolicyForTests(null);
  setWebFontSourcesForTests(null);
  await server.close();
});

beforeEach(async () => {
  cssHits = 0;
  fileHits = 0;
});

afterEach(() => {
  setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true });
  setWebFontSourcesForTests({ cssBase: base, fileHost: '127.0.0.1' });
});

describe('resolveWebFont', () => {
  it('copies each face to our origin and marks only the latin upright critical', async () => {
    const assets = await resolveWebFont('Lobster');
    expect(assets).toHaveLength(2);
    for (const a of assets) expect(a.url).toMatch(/^\/webfonts\/[0-9a-f]{32}\.woff2$/);
    expect(assets.filter((a) => a.preload)).toHaveLength(1);
    expect(assets.every((a) => a.family === 'Lobster')).toBe(true);
    expect(assets.find((a) => a.preload)!.unicodeRange).toContain('U+0000');
  });

  it('fetches ONCE per deployment — the second call is a table read', async () => {
    await resolveWebFont('Lobster');
    expect(cssHits).toBe(1);
    const again = await resolveWebFont('Lobster');
    expect(cssHits).toBe(1);
    expect(fileHits).toBe(2); // the two faces, not four
    expect(again).toHaveLength(2);
  });

  it('content-addresses the bytes: distinct faces differ, a shared file costs ONE object', async () => {
    const a = await resolveWebFont('Lobster');
    // Two different files ⇒ two different keys.
    expect(new Set(a.map((f) => f.url)).size).toBe(2);
    // A second family drawing the SAME two files reuses both objects.
    const b = await resolveWebFont('Pacifico');
    expect(new Set([...a, ...b].map((f) => f.url)).size).toBe(2);
  });

  it('needs no fetch for a family compiled into this build', async () => {
    expect(await resolveWebFont('Inter')).toEqual([]);
    expect(cssHits).toBe(0);
  });

  it('refuses a name that is not a family — it lands in a stylesheet', async () => {
    for (const bad of ['Inter"; } body { display:none } .x {', '', '   ', 'A'.repeat(60)]) {
      await expect(resolveWebFont(bad)).rejects.toBeInstanceOf(UnknownFontError);
    }
    expect(cssHits).toBe(0); // rejected before any request
  });

  it('refuses a family the upstream does not have, naming it', async () => {
    await expect(resolveWebFont('Ghost Family')).rejects.toThrow(/Ghost Family/);
  });

  it('refuses css that parses to no usable face', async () => {
    await expect(resolveWebFont('Empty Family')).rejects.toThrow(/not a Google Font/);
  });

  it('refuses a face whose bytes are not woff2 — the header is not evidence', async () => {
    await expect(resolveWebFont('Bad Bytes')).rejects.toThrow(/woff2/);
  });

  it('stores nothing when a face fails — no half-resolved family in the table', async () => {
    await expect(resolveWebFont('Bad Bytes')).rejects.toThrow();
    const db = await harness.db();
    const r = await db.query('SELECT 1 FROM webfonts WHERE family = $1', ['Bad Bytes']);
    expect(r.rows).toHaveLength(0);
  });

  it('will not follow the css to a file on another host', async () => {
    setWebFontSourcesForTests({ cssBase: base, fileHost: 'fonts.gstatic.com' }); // files must come from gstatic
    await expect(resolveWebFont('Lobster')).rejects.toThrow(/not an allowed source|forbidden/i);
  });
});

describe('webFontAssets', () => {
  it('reads only what is stored, and never fetches', async () => {
    await resolveWebFont('Lobster');
    cssHits = 0;
    const assets = await webFontAssets(['Lobster', 'Never Resolved']);
    expect(assets).toHaveLength(2);
    expect(cssHits).toBe(0);
  });

  it('answers empty for no families and drops unnameable ones', async () => {
    expect(await webFontAssets([])).toEqual([]);
    expect(await webFontAssets(['bad"name'])).toEqual([]);
  });
});

describe('webFontObjectKey', () => {
  it('accepts only the content-addressed shape', () => {
    expect(webFontObjectKey('0123456789abcdef0123456789abcdef.woff2')).toBe('webfont/0123456789abcdef0123456789abcdef');
    for (const bad of ['../etc/passwd', 'x.woff2', '0123456789abcdef0123456789abcdef.ttf', 'ABCDEF0123456789abcdef0123456789.woff2', '']) {
      expect(webFontObjectKey(bad), bad).toBeNull();
    }
  });
});
