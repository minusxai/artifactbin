/**
 * `/basemap/worker.js` — MapLibre's CSP worker, served same-origin for `<DeckGL>`.
 * maplibre-gl is a BUILD dependency: the production image installs runtime
 * dependencies only, so the package is absent there. The story-runtime build
 * copies the worker into lib/story-runtime/dist/ (shipped with the image), and
 * the route must serve it from there without resolving the package at request
 * time. This test makes the package unresolvable to prove it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

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

describe('/basemap/worker.js', () => {
  it('is served from the built runtime directory, with maplibre-gl not installed', async () => {
    const res = await GET(new Request('http://localhost/basemap/worker.js'), { params: Promise.resolve({ path: ['worker.js'] }) });
    const built = readFileSync(path.join(process.cwd(), 'lib/story-runtime/dist/maplibre-gl-csp-worker.js'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript');
    expect(Buffer.from(await res.arrayBuffer()).equals(built)).toBe(true);
  });
});
