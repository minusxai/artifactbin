/**
 * `/basemap/worker.mjs` — MapLibre's module worker, served same-origin for `<DeckGL>`.
 * maplibre-gl is a BUILD dependency: the production image installs runtime
 * dependencies only, so the package is absent there. The server-reader build
 * copies the worker into lib/build-assets/ (shipped with the image), and
 * the route must serve it from there without resolving the package at request
 * time. This test makes the package unresolvable to prove it.
 *
 * The route is never an open proxy: besides the worker it forwards only
 * lib/serving/basemap's allowlist, and serves no other build file.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BASEMAP_PATH, BASEMAP_WORKER_URL } from '@/lib/serving/basemap';

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  const createRequire = (from: string | URL) => {
    const req = actual.createRequire(from);
    const absent = (id: string) => {
      if (/^maplibre-gl(\/|$)/.test(id)) throw Object.assign(new Error(`Cannot find module '${id}'`), { code: 'MODULE_NOT_FOUND' });
    };
    const guarded = ((id: string) => { absent(id); return req(id); }) as NodeJS.Require;
    Object.assign(guarded, req);
    guarded.resolve = Object.assign((id: string, opts?: { paths?: string[] }) => { absent(id); return req.resolve(id, opts); }, { paths: req.resolve.paths });
    return guarded;
  };
  return { ...actual, default: { ...actual, createRequire }, createRequire };
});

const { GET } = await import('@/app/basemap/[...path]/route');
const get = (segments: string[]) => GET(new Request(`http://localhost/basemap/${segments.join('/')}`), { params: Promise.resolve({ path: segments }) });

afterEach(() => vi.restoreAllMocks());

describe('/basemap/worker.mjs', () => {
  it('is the URL MapLibre is told to start its worker from', () => {
    expect(BASEMAP_WORKER_URL).toBe(`${BASEMAP_PATH}worker.mjs`);
  });

  it('is served from the built runtime directory, with maplibre-gl not installed', async () => {
    const res = await get(['worker.mjs']);
    const built = readFileSync(path.join(process.cwd(), 'lib/build-assets/maplibre-gl-worker.mjs'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript');
    expect(Buffer.from(await res.arrayBuffer()).equals(built)).toBe(true);
  });

  it('is one self-contained module: it imports no sibling the route would have to serve', () => {
    const built = readFileSync(path.join(process.cwd(), 'lib/build-assets/maplibre-gl-worker.mjs'), 'utf8');
    expect(built).not.toMatch(/(?:\bfrom|\bimport)\s*\(?\s*["'`]\.{1,2}\//);
    expect(built).not.toMatch(/sourceMappingURL=/);
  });
});

describe('/basemap/ outside the allowlist', () => {
  it('refuses every other path with a 404 and never reaches upstream', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch');
    const refused = [
      ['worker.js'], ['maplibre-gl-worker.mjs'], ['maplibre-gl-shared.mjs'], ['worker.mjs.map'], ['maplibre-gl-worker.mjs.map'],
      ['lucide-icons.json'], ['..', 'lib', 'build-assets', 'maplibre-gl-worker.mjs'], ['worker.mjs', 'x'],
      ['styles', 'liberty'], ['styles', 'positron', 'extra'], ['planet', '..', '..', 'etc'], ['https:', '', 'evil.example', 'x'],
    ];
    for (const segments of refused) {
      const res = await get(segments);
      expect(res.status, segments.join('/')).toBe(404);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
});
