/**
 * THE HEADERS /a/:id/raw AND /a/:id/events ANSWER WITH, per branch: status, type and cache policy. The cache policy
 * of a document's bytes is decided in one place (lib/document-serving); these pin what a reader and a shared cache
 * observe, whatever decides it. Revalidated documents on their own origin are pinned by document-revalidation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { samplePdfDataUrl } from '../../../scripts/lib/sample-pdf.mjs';
import { mintAccountToken as mintToken, request, useAppHarness } from '@/__tests__/harness';
import { GET as rawRoute, HEAD as rawHead } from '@/app/a/[id]/raw/route';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { ObjectUnavailable } from '@/lib/object-store';
import * as imageStore from '@/lib/object-store/image-store';
import * as pdfStore from '@/lib/object-store/pdf-store';
import { nativeHtml } from './native-html-fixture';

useAppHarness();
afterEach(() => { vi.restoreAllMocks(); });

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SVG = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>').toString('base64');

async function create(body: Record<string, unknown>, visibility: 'public' | 'private' = 'public') {
  const { token } = await mintToken('headers');
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { visibility, ...body } }));
  expect(res.status, await res.clone().text()).toBe(201);
  return { id: ((await res.json()) as { id: string }).id, token };
}
const headersOf = (res: Response, ...names: string[]) => Object.fromEntries(names.map(name => [name, res.headers.get(name)]));

describe('/a/:id/raw', () => {
  it('answers a missing, malformed or refused document with the same uncached 404 page', async () => {
    const { id } = await create({ html: nativeHtml('<p>secret</p>') }, 'private');
    for (const asked of ['zzzzzz', 'NOT-A-SLUG!', id]) {
      const res = await rawRoute(request(`/a/${asked}/raw`), params(asked));
      expect(res.status, asked).toBe(404);
      expect(headersOf(res, 'content-type', 'cache-control', 'x-content-type-options', 'referrer-policy'), asked).toEqual({
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      });
    }
  });

  it('serves a document on the app origin uncached, under its own policy and without a validator, for GET and HEAD', async () => {
    const { id } = await create({ html: nativeHtml('<p>hello</p>') });
    for (const res of [await rawRoute(request(`/a/${id}/raw`), params(id)), await rawHead(request(`/a/${id}/raw`, { method: 'HEAD' }), params(id))]) {
      expect(res.status).toBe(200);
      expect(headersOf(res, 'content-type', 'cache-control', 'etag', 'x-content-type-options')).toEqual({
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', etag: null, 'x-content-type-options': 'nosniff',
      });
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    }
  });

  it('serves dataset and recipe tiers as uncached JSON', async () => {
    const dataset = await create({ title: 'rows', dataset: [{ a: 1 }] });
    const viz = await create({ title: 'bar', viz: { description: 'Bar', engine: 'vega-lite', bindings: [{ name: 'x', label: 'X', accepts: ['nominal'] }], template: { mark: 'bar', encoding: { x: { field: '{{x}}', type: '{{x:kind}}' } } } } });
    for (const { id } of [dataset, viz]) {
      const res = await rawRoute(request(`/a/${id}/raw`), params(id));
      expect(res.status).toBe(200);
      expect(headersOf(res, 'content-type', 'cache-control')).toEqual({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    }
  });

  it('caches stored image and PDF bytes by visibility and versioned address', async () => {
    const image = await create({ title: 'px', image: PIXEL }, 'private');
    const pdf = await create({ title: 'doc', pdf: samplePdfDataUrl(1) }, 'private');
    for (const { id, token } of [image, pdf]) {
      const bare = await rawRoute(request(`/a/${id}/raw`, { token }), params(id));
      const versioned = await rawRoute(request(`/a/${id}/raw?v=1`, { token }), params(id));
      expect([bare.status, bare.headers.get('cache-control')]).toEqual([200, 'private, max-age=300']);
      expect([versioned.status, versioned.headers.get('cache-control')]).toEqual([200, 'private, max-age=31536000, immutable']);
      await bare.body?.cancel(); await versioned.body?.cancel();
    }
    const publicImage = await create({ title: 'px', image: PIXEL });
    expect((await rawRoute(request(`/a/${publicImage.id}/raw`), params(publicImage.id))).headers.get('cache-control')).toBe('public, max-age=300');
    const svg = await create({ title: 'svg', image: SVG });
    expect((await rawRoute(request(`/a/${svg.id}/raw`), params(svg.id))).headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
  });

  it('answers bytes the store will not give with an uncached 503', async () => {
    const image = await create({ title: 'px', image: PIXEL });
    const pdf = await create({ title: 'doc', pdf: samplePdfDataUrl(1) });
    vi.spyOn(imageStore, 'loadImage').mockRejectedValue(new ObjectUnavailable('image/x'));
    vi.spyOn(pdfStore, 'loadPdfStream').mockRejectedValue(new ObjectUnavailable('pdf/x'));
    for (const { id } of [image, pdf]) {
      const res = await rawRoute(request(`/a/${id}/raw`), params(id));
      expect([res.status, res.headers.get('cache-control'), await res.text()]).toEqual([503, 'no-store', 'asset unavailable']);
    }
  });
});

describe('/a/:id/events', () => {
  it('answers a refused document with the plain 404', async () => {
    const { id } = await create({ html: nativeHtml('<p>secret</p>') }, 'private');
    const res = await eventsRoute(request(`/a/${id}/events`), params(id));
    expect([res.status, await res.text()]).toEqual([404, 'not found']);
  });

  it('streams an uncached, unbuffered, untransformed event stream any origin may read', async () => {
    const { id } = await create({ html: nativeHtml('<p>live</p>') });
    const controller = new AbortController();
    const res = await eventsRoute(new Request(`http://localhost/a/${id}/events`, { signal: controller.signal }), params(id));
    expect(res.status).toBe(200);
    expect(headersOf(res, 'content-type', 'cache-control', 'connection', 'x-accel-buffering', 'access-control-allow-origin')).toEqual({
      'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no', 'access-control-allow-origin': '*',
    });
    controller.abort();
    await res.body?.cancel();
  });
});
