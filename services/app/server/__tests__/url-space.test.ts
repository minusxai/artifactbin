/**
 * THE URL MAP CANNOT DRIFT FROM THE SERVER (contracts url-space). Every route in the generated table is classified,
 * and by the place it lives: `/api/` routes as api, `/af/` as public files, a page's sub-routes as its doors (the
 * map's door list IS the table's), anything else as a fixed path the map names. No `/af/` handler reads a credential,
 * which is what lets every host pass the whole prefix. The served document is the exported constant, byte for byte.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { URL_SPACE, URL_SPACE_PATH, classifyPath, documentHostServes, isScreenPath, ownerHostServes } from '@artifactbin/contracts';
import { isBuildAssetPath } from '@artifactbin/utils';
import { ROUTES } from '../routes.generated';
import { createAppServer } from '../app';

/** A concrete path for a route directory: `[id]` → an id-shaped segment, `[...rest]` → two segments. */
const sample = (dir: string): string => dir.replace(/\[\[?\.\.\.\w+\]\]?/g, 'x/y').replace(/\[\w+\]/g, 'Abc123');

describe('the URL map classifies every route by where it lives', () => {
  it('puts each generated route in its prefix\'s class, and nothing in the screens', () => {
    for (const { dir } of ROUTES) {
      const kind = classifyPath(sample(dir));
      const expected = dir.startsWith('/api/') ? 'api' : dir.startsWith('/af/') ? 'public-file' : dir.startsWith('/a/[id]/') ? 'page-door' : 'fixed';
      expect(kind, dir).toBe(expected);
    }
  });

  it('lists exactly the page doors the route table serves (plus the app page\'s own files)', () => {
    const fromTable = ROUTES.filter(({ dir }) => dir.startsWith('/a/[id]/')).map(({ dir }) => dir.slice('/a/[id]/'.length).replace(/\[(\w+)\]/g, ':$1'));
    expect([...URL_SPACE.page.doors].sort()).toEqual([...fromTable, 'app/:asset'].sort());
  });

  it('keeps every /af/ handler free of credentials', () => {
    const files: string[] = [];
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const full = path.join(dir, name); if (statSync(full).isDirectory()) walk(full); else files.push(full); } };
    walk(path.resolve('app/af'));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) expect(readFileSync(file, 'utf8'), file).not.toMatch(/@\/lib\/(?:authentication|accounts)|sessionActor|cookie/i);
  });
});

describe('the classifier and the allowlists that derive from it', () => {
  it('answers each kind', () => {
    const cases: Array<[string, string]> = [
      ['/api/artifacts', 'api'], ['/api/people/u1', 'api'], ['/af/core.js', 'public-file'], ['/af/app/index-1.js', 'public-file'],
      ['/libraries/vega-6.3.1/index.js', 'legacy'], ['/geojson/world.json', 'legacy'], ['/fonts/a.12345678.woff2', 'legacy'],
      ['/people/u1', 'legacy'], ['/email/d1', 'legacy'], ['/workspace/Abc123', 'legacy'],
      ['/a/Abc123', 'page-screen'], ['/a/Abc123/edit', 'page-screen'], ['/a/Abc123/app/', 'page-screen'],
      ['/a/Abc123/raw', 'page-door'], ['/a/Abc123/app/manifest.webmanifest', 'page-door'],
      ['/@sam', 'handle'], ['/@sam/q3-review', 'handle'], ['/login', 'fixed'], ['/health', 'fixed'], ['/llms.txt', 'fixed'],
      ['/skills/artifactbin.zip', 'fixed'], ['/assets/' + 'a'.repeat(64), 'fixed'], ['/favicon.ico', 'fixed'],
      ['/', 'screen'], ['/assets', 'screen'], ['/trash', 'screen'], ['/no-such-page', 'screen'],
    ];
    for (const [pathname, kind] of cases) expect(classifyPath(pathname), pathname).toBe(kind);
    // The classifier's literal patterns say what the published strings say.
    for (const [pathname, kind] of cases) expect(new RegExp(URL_SPACE.handle).test(pathname), pathname).toBe(kind === 'handle');
    for (const [pathname, kind] of cases.filter(([p]) => p.startsWith('/a/'))) expect(new RegExp(`^${URL_SPACE.page.prefix}${URL_SPACE.page.id}`).test(pathname), pathname).toBe(kind.startsWith('page-'));
    for (const screen of ['/', '/trash', '/a/Abc123', '/@sam', '/@sam/q3-review']) expect(isScreenPath(screen), screen).toBe(true);
    for (const other of ['/api/me', '/af/core.js', '/a/Abc123/raw', '/login', '/geojson/world.json']) expect(isScreenPath(other), other).toBe(false);
  });

  it('lets a document origin load every public file, old file addresses and stored bytes, and nothing of the app', () => {
    for (const p of ['/af/chrome.js', '/af/host.js', '/af/v1/core.js', '/af/lib/vega-6.3.1/index.js', '/geojson/world.json', '/assets/' + 'a'.repeat(64), '/favicon.ico', '/basemap/worker.mjs']) expect(documentHostServes(p), p).toBe(true);
    for (const p of ['/api/me', '/login', '/people/u1', '/email/d1', '/a/Abc123/raw', '/islands/x.js']) expect(documentHostServes(p), p).toBe(false);
  });

  it('lets an owner host load the reader\'s part only', () => {
    for (const p of ['/af/apollo.js', '/af/reader.js', '/af/styles.css', '/af/components/tabs.js', '/af/fonts/inter-latin-standard-normal.woff2', '/af/fonts/inter-latin-standard-normal.2c295d99.woff2', '/fonts/inter-latin-standard-normal.2c295d99.woff2', '/af/lib/vega-6.3.1/index.js', '/libraries/vega-6.3.1/index.js', '/af/geojson/world.json', '/geojson/world.json', '/af/app/index-abc.css', '/favicon.ico']) expect(ownerHostServes(p), p).toBe(true);
    for (const p of ['/af/chrome.js', '/af/core.js', '/af/app/index-abc.js', '/af/v1/core.js', '/af/img/logo.png', '/assets/' + 'a'.repeat(64), '/people/u1']) expect(ownerHostServes(p), p).toBe(false);
  });

  it('gives the proxy the app build\'s shape', () => {
    expect(isBuildAssetPath('/af/app/index-abc.js')).toBe(true);
    expect(isBuildAssetPath('/assets/index-abc.js')).toBe(false);
    expect(isBuildAssetPath('/af/app/logo.png')).toBe(false);
  });
});

describe(URL_SPACE_PATH, () => {
  it('serves the exported map, public and revalidated', async () => {
    const app = createAppServer({ indexHtml: async () => '<div id="root"></div>' });
    const res = await app.request(URL_SPACE_PATH);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify(URL_SPACE));
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect((await app.request(URL_SPACE_PATH, { headers: { 'if-none-match': res.headers.get('etag')! } })).status).toBe(304);
    expect(URL_SPACE.version).toBe(1);
  });
});
