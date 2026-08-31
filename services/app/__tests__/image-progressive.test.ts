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

/** Publish an image, then a document that shows it. Returns both ids. */
async function documentWithImage(markup: (id: string) => string) {
  const t = await mintToken('t');
  const img = (await (await create(t.token, { image: PNG })).json()) as { id: string };
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
