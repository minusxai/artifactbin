/**
 * WHICH READ THE ROUTE CHOOSES — the seam this milestone's whole memory
 * argument rests on, and the one nothing was watching.
 *
 * The store's streaming contract is covered by lib/object-store's own suite: an
 * implementation of `getStream` that buffers goes red there. What that cannot
 * see is a CALLER changing its mind. Review proved it by rewriting
 * `loadPdfStream` to `Readable.from([await objectStore().get(key)])` — exactly
 * the 25 MB whole-read-through-the-cache this tier exists to prevent, at the one
 * call site `/a/<id>/raw` uses — and pdf-serving, pdf-range, pdf-tier,
 * object-store and file-embed all stayed green: 56 passed.
 *
 * So this file asks the only question that closes it: across a real request for
 * a real stored PDF, was `getStream` called and `get` not?
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { samplePdfDataUrl } from '../../../scripts/lib/sample-pdf.mjs';
import { POST as bearerCreate } from '@/app/api/artifacts/route';
import { mintToken } from '@/lib/tokens';
import { request, useAppHarness } from '@/__tests__/harness';

useAppHarness();

afterEach(() => { vi.restoreAllMocks(); });

/** The real store, with every read named — a spy that delegates rather than fakes. */
async function watchedStore() {
  const mod = await import('@/lib/object-store');
  const real = mod.objectStore();
  const calls: string[] = [];
  vi.spyOn(mod, 'objectStore').mockReturnValue({
    backend: real.backend,
    put: (key, body, type) => real.put(key, body, type),
    delete: (key) => real.delete(key),
    get: (key) => { calls.push(`get ${key}`); return real.get(key); },
    getStream: (key, range) => { calls.push(`getStream ${key}`); return real.getStream(key, range); },
  });
  return calls;
}

describe('a PDF is read as a stream, at the route', () => {
  it('calls getStream and never get — for the whole file and for a range alike', async () => {
    const t = await mintToken('t');
    const created = await bearerCreate(request('/api/artifacts', {
      method: 'POST', token: t.token, json: { title: 'Streamed', pdf: samplePdfDataUrl(2), visibility: 'public' },
    }));
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };

    // The spy goes up AFTER the upload, so `put` is not what is being watched.
    const calls = await watchedStore();
    const { GET } = await import('@/app/a/[id]/raw/route');
    const params = { params: Promise.resolve({ id }) };

    const whole = await GET(request(`/a/${id}/raw`), params);
    expect(whole.status).toBe(200);
    await whole.arrayBuffer();

    const part = await GET(request(`/a/${id}/raw`, { headers: { range: 'bytes=0-9' } }), params);
    expect(part.status).toBe(206);
    await part.arrayBuffer();

    expect(calls.filter((c) => c.startsWith('getStream'))).toHaveLength(2);
    // The assertion that matters: not one whole read. `get` admits the object
    // to the 32 MB read cache, which one 25 MB PDF would empty.
    expect(calls.filter((c) => c.startsWith('get '))).toEqual([]);
  });

  it('opens no read at all for a HEAD — the size comes from the row', async () => {
    const t = await mintToken('t');
    const created = await bearerCreate(request('/api/artifacts', {
      method: 'POST', token: t.token, json: { pdf: samplePdfDataUrl(1), visibility: 'public' },
    }));
    const { id } = await created.json() as { id: string };

    const calls = await watchedStore();
    const { HEAD } = await import('@/app/a/[id]/raw/route');
    const res = await HEAD(request(`/a/${id}/raw`, { method: 'HEAD' }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect(calls).toEqual([]);
  });
});
