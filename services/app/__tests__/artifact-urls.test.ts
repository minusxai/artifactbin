/**
 * The artifact URL namespace. An artifact has ONE identifier — its file id,
 * 6 chars of [a-zA-Z0-9] — which is the API handle, the `ref:<id>` target and
 * the URL address all at once. There is no second, secret name: the id is an
 * ADDRESS, so every surface below is reachable by anyone who may read the
 * document, and none of them is gated on guessing the identifier.
 *
 * ONE shareable URL, with the machine-facing surfaces as sub-paths of the
 * same URL rather than sibling top-level routes:
 *
 *   /a/<id>          the page a human opens
 *   /a/<id>/raw      the bytes: stored html, dataset/viz JSON, image, markup source
 *   /a/<id>/export   the page as png/jpg
 *
 * A query string cannot select between these: in the App Router the PATH
 * picks the handler before the query is read, and a page (React) can neither
 * return bytes nor set the per-row CSP that the html tier's sandbox depends on.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from '@artifactbin/utils';
import { GET as exportImage } from '@/app/a/[id]/export/route';
import { getArtifactById } from '@/lib/artifacts';
import { GET as raw } from '@/app/a/[id]/raw/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';


import { resetExportRenderer } from '@/lib/export';
import { setServices } from '@/lib/services';
import { mintToken } from '@/lib/tokens';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const EXPORT_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x55, 0x52, 0x4c]);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const MARKUP = '<div data-design="tw" className="p-8"><h1 className="text-3xl">Raw tier</h1></div>';
const HTML_DOC = '<Helmet><script>{`window.x=1;`}</script></Helmet><h1>Stored html</h1>';

let token: string;
async function publish(body: Record<string, unknown>): Promise<{ id: string; url: string }> {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return res.json();
}

beforeEach(async () => {
  await resetExportRenderer();
  setServices({ browser: fakeBrowser({ ok: true, mime: 'image/png', bytes: EXPORT_BYTES }) });
  token = (await mintToken('urls')).token;
});

afterEach(() => setServices({}));

afterAll(async () => {
  await resetExportRenderer();
});

describe('/a/<id>/raw', () => {
  it('serves the document under the sandboxing CSP (the headers ARE the sandbox)', async () => {
    const { id } = await publish({ title: 'h', markup: HTML_DOC });
    const res = await raw(request(`/a/${id}/raw`), params(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    // Each clause is load-bearing: no network, opaque origin, images inline only.
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(await res.text()).toContain('Stored html');
  });

  it('serves dataset rows as JSON', async () => {
    const { id } = await publish({ title: 'd', dataset: [{ a: 1 }, { a: 2 }] });
    const res = await raw(request(`/a/${id}/raw`), params(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(await res.json()).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('serves a viz recipe as JSON', async () => {
    const { id } = await publish({
      title: 'v',
      viz: {
        description: 'bar', engine: 'vega-lite',
        bindings: [{ name: 'x', label: 'X', accepts: ['nominal'] }],
        template: { mark: 'bar', encoding: { x: { field: '{{x}}', type: 'nominal' } } },
      },
    });
    const res = await raw(request(`/a/${id}/raw`), params(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect((await res.json()).engine).toBe('vega-lite');
  });

  it('serves image bytes with the stored content type', async () => {
    const { id } = await publish({ title: 'i', image: PNG });
    // What was UPLOADED is not necessarily what is stored: an image is
    // converted at the door (lib/images/optimise). The row is the record of
    // what it became, and the response must agree with the row.
    const stored = ((await getArtifactById(id))!.meta as { contentType?: string }).contentType;
    const res = await raw(request(`/a/${id}/raw`), params(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(stored);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it('serves the markup document as SSR html (source read-back is the API)', async () => {
    const { id } = await publish({ title: 'm', markup: MARKUP });
    const res = await raw(request(`/a/${id}/raw`), params(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(await res.text()).toContain('Raw tier');
  });

  it('404s unknown and malformed ids without revealing which', async () => {
    // Both arms answer the same: 'zzzzzz' is well-formed and names no row,
    // while the rest never pass ID_RE (too short, underscore, hyphen, too
    // long, bad charset). Mixed case is legal id syntax, so it is not a
    // malformed fixture on its own.
    for (const id of ['zzzzzz', 'abc12', 'art_abc123', 'abc-12', 'zzzzzzzzzzzzzzzzzzz', 'UPPER-not_valid!']) {
      const res = await raw(request(`/a/${id}/raw`), params(id));
      expect(res.status).toBe(404);
    }
  });
});

describe('/a/<id>/export', () => {
  it(
    'answers export-shaped for a document (real bytes: scripts/gate-full-kit.mjs)',
    async () => {
      // The route receives the exact bytes its BrowserService rendered. Real
      // rasterization remains owned by scripts/gate-full-kit.mjs.
      const { id } = await publish({ title: 'h', markup: HTML_DOC });
      const res = await exportImage(request(`/a/${id}/export?format=png`), params(id));
      expect(res.status).toBe(200);
      expect(res.status).not.toBe(307);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(EXPORT_BYTES);
    },
  );

  it('rejects a format it cannot produce instead of guessing', async () => {
    const { id } = await publish({ title: 'h', markup: HTML_DOC });
    const res = await exportImage(request(`/a/${id}/export?format=gif`), params(id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown_format');
  });

  it('404s an unknown id, well-formed or not', async () => {
    for (const id of ['zzzzzz', 'zzzzzzzzzzzzzzzzzzz']) {
      const res = await exportImage(request(`/a/${id}/export`), params(id));
      expect(res.status).toBe(404);
    }
  });
});
