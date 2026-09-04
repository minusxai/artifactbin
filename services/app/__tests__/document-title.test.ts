/**
 * What a document is CALLED follows its own heading until someone names it.
 *
 * The failure this guards: /api/start seeds a document, an agent rewrites its
 * heading through an ordinary edit, and every surface keeps saying the seeded
 * name — because `artifacts.title` is a column nothing re-derives.
 */
import { describe, expect, it } from 'vitest';
import { artifactMetadata } from '@/test/helpers/pages';
import { POST as startRoute } from '@/app/api/start/route';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();



const BASE = 'http://localhost:3000';

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

interface Start { id: string; token: string; edit_id: string }

/**
 * A started anonymous document plus the token `/api/start` returns once.
 */
const start = async (): Promise<Start> => {
  const res = await startRoute(request('/api/start', { method: 'POST', json: {} }));
  expect(res.status).toBe(201);
  return (await res.json()) as Start;
};

/** The heading /api/start seeds, verbatim — the anchor an agent's first edit uses. */
const PLACEHOLDER_H1 = '<h1 className="text-2xl font-semibold tracking-tight">Untitled</h1>';

const retitle = async (doc: Start, heading: string) => {
  const res = await editRoute(
    request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: doc.token, json: { edit_id: doc.edit_id, old_string: PLACEHOLDER_H1, new_string: `<h1 className="text-2xl font-semibold tracking-tight">${heading}</h1>` } }),
    params({ id: doc.id }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { edit_id: string };
};

/** The page's PageProps: the id from the path, and no query string. */
const pageProps = (id: string) => ({ ...params({ id }), searchParams: Promise.resolve({}) });

const pageTitle = async (id: string) => {
  const meta = await artifactMetadata(id);
  return meta.title;
};

describe('the page title follows the document', () => {
  it('reads the heading an agent wrote, not the seeded name', async () => {
    const doc = await start();
    expect(await pageTitle(doc.id)).toBe('Untitled'); // the placeholder's own heading
    await retitle(doc, 'Q3 Revenue Review');
    expect(await pageTitle(doc.id)).toBe('Q3 Revenue Review');
  });

  it('keeps following later edits — the derived name never sticks', async () => {
    const doc = await start();
    const after = await retitle(doc, 'First Draft');
    const res = await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: doc.token, json: { edit_id: after.edit_id, old_string: 'First Draft', new_string: 'Second Draft' } }),
      params({ id: doc.id }),
    );
    expect(res.status).toBe(200);
    expect(await pageTitle(doc.id)).toBe('Second Draft');
  });

  it('stops following once someone names it explicitly', async () => {
    const doc = await start();
    const res = await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: doc.token, json: { edit_id: doc.edit_id, title: 'Named by hand' } }),
      params({ id: doc.id }),
    );
    expect(res.status).toBe(200);
    const after = (await res.json()) as { edit_id: string };
    await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: doc.token, json: { edit_id: after.edit_id, old_string: PLACEHOLDER_H1, new_string: '<h1 className="text-2xl font-semibold tracking-tight">A New Heading</h1>' } }),
      params({ id: doc.id }),
    );
    expect(await pageTitle(doc.id)).toBe('Named by hand');
  });

  it('unfurls under the same name it tabs under', async () => {
    const doc = await start();
    await retitle(doc, 'Q3 Revenue Review');
    const meta = await artifactMetadata(doc.id);
    expect(meta.openGraph?.title).toBe('Q3 Revenue Review');
  });

  it('unfurls with the og-ratio card image, version-busted so a stale cache cannot outlive an edit', async () => {
    const doc = await start();
    const meta = await artifactMetadata(doc.id);
    const images = meta.openGraph?.images as { url: string; width?: number; height?: number }[];
    // ABSOLUTE, not relative: Next resolves a relative og:image against
    // `metadataBase`, which is the origin this process listens on — behind a
    // reverse proxy that is the container's own address, and production
    // unfurled every link with an image at http://localhost:3000. Out of a
    // request scope the origin falls back to PUBLIC_BASE_URL, which is what
    // this sees.
    expect(images[0].url).toMatch(new RegExp(`^https?://[^/]+/a/${doc.id}/export\\?mode=card&v=\\d+&r=2$`));
    expect(images[0].url).toContain('://');
    expect(images[0]).toMatchObject({ width: 1600, height: 840 });
  });
});
