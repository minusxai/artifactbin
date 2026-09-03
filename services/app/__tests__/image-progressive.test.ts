/**
 * THE READER SEES SOMETHING WHILE THE IMAGE TRAVELS.
 *
 * A 1 MB photograph is a blank space for as long as it takes to arrive, and on
 * production that was seconds. The publish pipeline (lib/images/optimise) has
 * been computing a ~95-byte blurred copy of every image since #157 and storing
 * it in `meta.placeholder` — and rendering it NOWHERE, because the tests there
 * assert that a placeholder is PRODUCED and nothing asserted that anything
 * CONSUMES one. The suite stayed green while the feature did not exist.
 *
 * These tests are the consumption half, at the only level that proves it: what
 * the served document actually contains.
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { getArtifactById, refDataForRow } from '@/lib/artifacts';


import { mintToken } from '@/lib/tokens';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
/*
 * A VALID 48×32 PNG. Deliberately not the 2×2 pixel that other suites use:
 * that fixture is malformed — sharp reads its header but a full decode fails
 * with `vipspng: libpng read error`, so no thumbnail can be made of it and it
 * legitimately gets no blur. Every image on production without one is either
 * that same 2×2 (13 of them, all test artifacts) or an SVG, which the pipeline
 * does not touch by design.
 */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCF8dMpruoH2PPOFgAET03KV/drCuIgtChmqHYMtbxE8GIDtUMxZaxDqH4oKFDNUOxZcghBGOdjhwe1weeF8xbShDdKgAAAABJRU5ErkJggg==';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const create = (token: string, body: unknown) => createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));

/**
 * A WIDE image, small enough for the suite's 5 KB import cap
 * (vitest.config IMAGES__MAX_BYTES) — which is why it is a flat webp rather
 * than the photograph the rule was written for.
 */
const wideDataUrl = async (): Promise<string> => {
  const bytes = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#0a78c8' } })
    .webp({ quality: 50 }).toBuffer();
  return `data:image/webp;base64,${bytes.toString('base64')}`;
};

/** Publish an image, then a document that shows it. Returns both ids. */
async function documentWithImage(markup: (id: string) => string, image: string = PNG) {
  const t = await mintToken('t');
  const img = (await (await create(t.token, { image })).json()) as { id: string };
  const doc = (await (await create(t.token, { markup: markup(img.id) })).json()) as { id: string };
  return { img: img.id, doc: doc.id };
}

describe('a stored blur reaches the reader', () => {
  it('is carried by the ref map, beside the box it reserves', async () => {
    const { img, doc } = await documentWithImage((id) => `<div className="p-4"><img src="ref:${id}" alt="x" /></div>`);
    const stored = (await getArtifactById(img))!.meta as { placeholder?: string };
    // The pipeline stored one; if it ever stops, this test says so rather than
    // the feature silently disappearing again.
    expect(stored.placeholder).toMatch(/^data:image\/webp;base64,/);

    const refData = await refDataForRow((await getArtifactById(doc))!);
    expect(refData[img]).toMatchObject({ kind: 'image', blur: stored.placeholder });
  });

  it('is IN the served document, as a background under the image', async () => {
    const { doc } = await documentWithImage((id) => `<div className="p-4"><img src="ref:${id}" alt="x" /></div>`);
    const html = await serveArtifact(request(`/a/${doc}/raw`), params(doc)).then((r) => r.text());
    expect(html).toMatch(/background-image:\s*url\(data:image\/webp;base64,/);
    expect(html).toMatch(/background-size:\s*cover/);
  });

  // The author meant what they wrote; cloneElement would replace it outright.
  it("stays out of the way of an author's own style", async () => {
    const { doc } = await documentWithImage((id) => `<div className="p-4"><img src="ref:${id}" alt="x" style={{opacity: 0.5}} /></div>`);
    const html = await serveArtifact(request(`/a/${doc}/raw`), params(doc)).then((r) => r.text());
    expect(html).not.toMatch(/background-image:\s*url\(data:/);
  });
});


/**
 * THE PHONE DOWNLOADS THE PHONE'S COPY.
 *
 * The stored image is capped at 2048px and read in a column about 850px wide,
 * so a 390px phone was being handed roughly five times the pixels it can show,
 * on the worse of the two connections. Publish now stores a 640-wide copy
 * beside it (lib/images/optimise) and the markup offers both — the same rule,
 * and the same `sizes` hint, as a URL-kept image (lib/story/asset-url), because
 * it is the same picture in the same column.
 */
describe('an upload wide enough to be worth it is stored at two widths', () => {
  it('records the narrow copy on the row, charged with the original', async () => {
    const { img } = await documentWithImage((id) => `<img src="ref:${id}" alt="x" />`, await wideDataUrl());
    const meta = (await getArtifactById(img))!.meta as
      { objectKey: string; bytes: number; smallObjectKey?: string; smallWidth?: number };
    expect(meta.smallWidth).toBe(640);
    expect(meta.smallObjectKey).toBeTruthy();
    expect(meta.smallObjectKey).not.toBe(meta.objectKey);
  });

  it('serves the narrow copy at the address the srcset names', async () => {
    const { img } = await documentWithImage((id) => `<img src="ref:${id}" alt="x" />`, await wideDataUrl());
    const full = await serveArtifact(request(`/a/${img}/raw?v=1`), params(img));
    const narrow = await serveArtifact(request(`/a/${img}/raw?v=1&w=640`), params(img));
    expect(narrow.status).toBe(200);
    expect(narrow.headers.get('Content-Type')).toBe('image/webp');
    expect((await narrow.arrayBuffer()).byteLength).toBeLessThan((await full.arrayBuffer()).byteLength);
    // A width we never stored is the full copy, never a failure.
    expect((await serveArtifact(request(`/a/${img}/raw?v=1&w=999`), params(img))).status).toBe(200);
  });

  it('offers both widths in the served document, and only the full one to a capture', async () => {
    const { doc } = await documentWithImage((id) => `<div className="p-4"><img src="ref:${id}" alt="x" /></div>`, await wideDataUrl());
    const html = await serveArtifact(request(`/a/${doc}/raw`), params(doc)).then((r) => r.text());
    expect(html).toContain('&amp;w=640 640w');
    expect(html).toContain('sizes="(max-width: 640px) 100vw, 768px"');

    // /export photographs the chrome-less frame: a `sizes` hint against a
    // headless viewport is how an og card ends up showing the 640px copy.
    const shot = await serveArtifact(request(`/a/${doc}/raw?chrome=0`), params(doc)).then((r) => r.text());
    expect(shot).not.toContain('srcSet');
  });
});
