/**
 * Curlable image export: `GET /a/<id>/export?format=png|jpg` renders the stored
 * HTML to image bytes on demand (headless Chromium in production),
 * and the HTML serve path grows og:image tags pointing at the export URL.
 * Real route handlers + in-memory PGLite, like api.test.ts. Route behavior is
 * isolated with the BrowserService fake; real rasterization belongs to the
 * browser contract suite and export gates.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { fakeBrowser } from '@artifactbin/utils';
import type { RenderRequest } from '@artifactbin/contracts';
import { GET as exportImage } from '@/app/a/[id]/export/route';
import { GET as serveRaw } from '@/app/a/[id]/raw/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as docsRoute } from '@/app/docs/[[...path]]/route';
const getDoc = (r: Request) => docsRoute(r, { params: Promise.resolve({ path: 'artifactbin/references/publishing-versions.md' }) });
import { POST as mintTokenRoute } from '@/app/api/tokens/route';
import { EXPORT_RENDER_GENERATION, exportStoreKey, parseExportCapture, parseExportFormat, parseExportSlide, resetExportRenderer } from '@/lib/export';
import { objectStore } from '@/lib/object-store';
import { setServices } from '@/lib/services';
import { DEFAULT_SOCIAL_PREVIEW_CROP } from '@/lib/story/social-preview';

const BASE = 'http://localhost:3000';
const SECRET = 'test-secret';
const EXPORT_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x45, 0x58, 0x50, 0x4f, 0x52, 0x54]);
useAppHarness();

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function create(markup: string, title = 'shot me') {
  const mintRes = await mintTokenRoute(request('/api/tokens', { method: 'POST', json: {}, headers: { ...(SECRET ? { 'x-shared-secret': SECRET } : {}) } }));
  const { token } = await mintRes.json();
  const res = await createArtifactRoute(
    request('/api/artifacts', { method: 'POST', token: token, json: { title, markup } }),
  );
  expect(res.status).toBe(201);
  return res.json() as Promise<{ id: string; url: string; version: number }>;
}

/** The export sub-path: `format` chooses png|jpg (the PATH already chose the handler). */
const shot = (id: string, format?: string) =>
  exportImage(request(`/a/${id}/export${format ? `?format=${format}` : ''}`), params({ id }));
const serveRawFor = (id: string) => serveRaw(request(`/a/${id}/raw`), params({ id }));

// The same two documents in markup vocabulary: one that names itself in a
// Helmet, one bare. (The exporter screenshots the served document either way.)
const WITH_HEAD = '<Helmet><title>t</title></Helmet><h1>hello</h1>';
const NO_HEAD = '<h1>bare</h1>';

beforeEach(async () => {
  await resetExportRenderer();
  setServices({ browser: fakeBrowser({ ok: true, mime: 'image/png', bytes: EXPORT_BYTES }) });
});

afterEach(() => setServices({}));

afterAll(async () => {
  await resetExportRenderer();
});

describe('parseExportFormat', () => {
  it('maps known formats and rejects everything else', () => {
    expect(parseExportFormat('png')).toBe('png');
    expect(parseExportFormat('jpg')).toBe('jpg');
    for (const bad of [null, '', 'PNG', 'gif', 'svg']) expect(parseExportFormat(bad)).toBeNull();
  });
});

describe('parseExportCapture', () => {
  it("maps the fixed export modes and rejects everything else", () => {
    expect(parseExportCapture(null)).toBe('full');
    expect(parseExportCapture('full')).toBe('full');
    expect(parseExportCapture('card')).toBe('card');
    expect(parseExportCapture('preview')).toBe('preview');
    for (const bad of ['', 'CARD', 'banner', 'viewport']) expect(parseExportCapture(bad)).toBeNull();
  });
});

describe('GET /a/:id/export', () => {
  /**
   * These are the exact bytes the fake BrowserService reports. Real PNG/JPEG
   * encoding and crop geometry are asserted by scripts/gate-full-kit.mjs and
   * scripts/gate-export-slice.mjs against a running server.
   */
  it(
    'answers export-shaped for a document — never a redirect to something else',
    async () => {
      const { id } = await create(WITH_HEAD);
      const res = await shot(id, 'png');
      expect(res.status).toBe(200);
      expect(res.status).not.toBe(307);
      expect(res.headers.get('location')).toBeNull();
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(EXPORT_BYTES);
    },
  );

  it(
    'reports an honest failure rather than a 200 of nothing when the render cannot run',
    async () => {
      setServices({ browser: fakeBrowser({ ok: false, reason: 'unavailable' }) });
      const { id } = await create(WITH_HEAD);
      const res = await shot(id, 'png');
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'render_unavailable' });
    },
  );

  it('rejects an unknown mode instead of guessing', async () => {
    const { id } = await create(NO_HEAD);
    const res = await exportImage(request(`/a/${id}/export?mode=banner`), params({ id }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown_mode');
  });

  it(
    'serves from the object store without rendering when the version is already shot',
    async () => {
      // Seed the store BEFORE this artifact's first-ever shot: the memory
      // layer is necessarily cold, so verbatim bytes prove the store answered
      // and no browser was involved.
      const { id, version } = await create(WITH_HEAD);
      const fake = Buffer.from('89504e47deadbeef', 'hex');
      // Addressed through the same helper the renderer uses, so a change to the
      // key (a new renderer generation) cannot leave this test seeding a stale one.
      await objectStore().put(exportStoreKey({ id, version }, 'png', 'full'), fake, 'image/png');
      const res = await shot(id, 'png');
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).equals(fake)).toBe(true);
    },
  );

  it('rejects an unknown export format instead of guessing', async () => {
    const { id } = await create(NO_HEAD);
    const res = await shot(id, 'gif');
    // The old query-string form fell through to serving the page; a path that
    // exists ONLY to produce an image must not answer with something else.
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown_format');
  });

  it('404s unknown ids regardless of export', async () => {
    // 'zzzzzz' is well-formed and unknown; the long one never passes ID_RE.
    for (const id of ['zzzzzz', 'zzzzzzzzzzzzzzzzzzz']) {
      const res = await shot(id, 'png');
      expect(res.status).toBe(404);
    }
  });
});

describe('skill doc', () => {
  it('teaches the export URL', async () => {
    const text = await (await getDoc(request('/docs/artifactbin/references/publishing-versions.md'))).text();
    expect(text).toContain('/export');
  });
});

describe('markup (story-engine) rows', () => {
  it(
    'exports by rendering the live page, and serves its source at ./raw',
    async () => {
      const mintRes = await mintTokenRoute(request('/api/tokens', { method: 'POST', json: {}, headers: { ...(SECRET ? { 'x-shared-secret': SECRET } : {}) } }));
      const { token } = await mintRes.json();
      const created = await createArtifactRoute(
        request('/api/artifacts', { method: 'POST', token: token, json: { markup: '<h1 className="text-3xl font-bold">shot me</h1>' } }),
      );
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };

      // The engine tier has no stored HTML, so export still takes the live-page
      // path. The fake makes the route's response deterministic here.
      const res = await shot(id, 'png');
      expect(res.status).toBe(200);
      expect(res.status).not.toBe(307);
      expect(res.headers.get('location')).toBeNull();

      const raw = await serveRawFor(id);
      expect(raw.status).toBe(200);
      expect(await raw.text()).toContain('shot me');
    },
  );
});

describe('readable = exportable includes BEARER-readable', () => {
  it('a private doc exports for the token that owns it, and only that token', async () => {
    // The reported failure: an agent publishes a (born-private, user-owned)
    // doc, asks for its export, gets refused, and silently falls back to
    // screenshotting local files. The token that can WRITE the doc must be
    // able to export it.
    const { createUser } = await import('@/lib/users');
    const { mintToken } = await import('@/lib/tokens');
    const user = await createUser({ email: 'exporter@example.com' });
    const owned = await mintToken('agent', user.id);
    const res = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: owned.token, json: { title: 'p', markup: WITH_HEAD, visibility: 'private' } }),
    );
    expect(res.status).toBe(201);
    const { id } = await res.json();

    // No credentials → the uniform 404 (unchanged).
    expect((await exportImage(request(`/a/${id}/export`), params({ id }))).status).toBe(404);
    // A stranger's token → the uniform 404.
    const stranger = await mintToken('stranger');
    expect((await exportImage(request(`/a/${id}/export`, { token: stranger.token }), params({ id }))).status).toBe(404);

    // The owning bearer → ADMITTED and receives the fake renderer's success.
    const shot = await exportImage(request(`/a/${id}/export`, { token: owned.token }), params({ id }));
    expect(shot.status).not.toBe(404);
    expect(shot.status).toBe(200);
  });
});

/**
 * A deck is checked one slide at a time. Measured on the claude-code deck run:
 * with no way to ask for slide N, the agent PUBLISHED a scratch document
 * holding a single slide, exported that, read it, and deleted it — three extra
 * requests and a version row per look — after guessing `?slide=2`, `?full=1`,
 * `?mode=full` and `?print=1`, all of which silently returned the whole page.
 */
// The PIXEL claims — a full export runs past the fold, a slide shot is one
// screen, slide 2 differs from slide 1 — need a live server to render against
// (here the exporter has no app to photograph), so they live in the browser
// gate: scripts/gate-export-slice.mjs. What stays here is what the route
// decides on its own: parsing, and the refusals.
describe('GET /a/:id/export?slide=N', () => {
  const DECK = '<SlideDeck><Slide title="one"><h1>First slide</h1></Slide><Slide title="two"><h1>Second slide</h1></Slide></SlideDeck>';

  it('parses a slide index, and refuses anything that is not a positive integer', () => {
    expect(parseExportSlide(null)).toBe(0);        // absent ⇒ the whole document
    expect(parseExportSlide('1')).toBe(1);
    expect(parseExportSlide('12')).toBe(12);
    for (const bad of ['0', '-1', '1.5', 'two', '']) expect(parseExportSlide(bad)).toBeNull();
  });

  it('rejects a malformed slide instead of quietly shooting the whole page', async () => {
    const { id } = await create(DECK);
    const res = await exportImage(request(`/a/${id}/export?slide=two`), params({ id }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown_slide');
  });

});

/**
 * Renders are cached by artifact VERSION, in memory and in the object store —
 * which is what makes an og card free to serve. So a change to WHAT the shot
 * covers must change the key too: without it, every document already published
 * would keep serving the picture taken by the old renderer (for the fix that
 * made "full" mean the whole document, that is the first screen, forever, on
 * exactly the documents people have already shared).
 */
describe('the cache key names the renderer', () => {
  it('carries a generation, so changing what a shot covers cannot serve stale pictures', () => {
    expect(EXPORT_RENDER_GENERATION).toBeGreaterThanOrEqual(2);
    expect(exportStoreKey({ id: 'abc123', version: 3 }, 'png', 'full', 0))
      .toBe(`exports/abc123/3.full-g${EXPORT_RENDER_GENERATION}.png`);
    // A slice and a card are their own pictures, and say so.
    expect(exportStoreKey({ id: 'abc123', version: 3 }, 'png', 'full', 2)).toContain('slide-2');
    expect(exportStoreKey({ id: 'abc123', version: 3 }, 'png', 'card', 0)).toContain('card-1600x840-r2-');
    expect(exportStoreKey({ id: 'abc123', version: 3 }, 'png', 'preview', 0)).toContain('preview-v2-');
  });
});

/**
 * A FOLDER IS A DOCUMENT, AND ITS CARD IS A PICTURE OF ITS LISTING.
 *
 * Measured on production before this: `GET /a/<folder>/export` answered a
 * 25-byte `{"error":"render_failed"}` for every folder, owner and stranger
 * alike. The cause was one predicate — `lib/export` asked `format === 'markup'`
 * to decide WHERE a row is photographed, so a folder was sent to `/a/<id>`
 * (the app shell, which the exporter's `?key=` deliberately keeps on the SPA
 * path) with `main` as its target, and the browser waited for an element the
 * shell never draws.
 *
 * Everything the shot needs already existed on the other branch: `raw` serves a
 * folder through the markup case, `chrome=0` settles its dataflow rather than
 * painting first, `<Files>` draws glyphs instead of every child's own card, and
 * the signed export key stands in for the session the headless browser has not
 * got.
 *
 * WHAT IS ASSERTED, and why it is not a PNG: this suite has no browser (the
 * BrowserService is faked), so the picture cannot be taken here. The two halves
 * that can be measured are (1) the request the route builds — the address, the
 * target and the card's crop — and (2) that the address it names actually
 * RENDERS: the recorded URL is fed back into the raw route and the listing has
 * to be in the HTML that comes out. Real bytes stay with the gates.
 */
describe('GET /a/<folder>/export', () => {
  const recording = () => {
    const fake = fakeBrowser({ ok: true, mime: 'image/png', bytes: EXPORT_BYTES });
    setServices({ browser: fake });
    // The RENDER REQUEST the route built, in the service's own contract type —
    // the fake records `unknown[]`, and every field asserted below is one this
    // route decides.
    return () => fake.calls.at(-1) as RenderRequest;
  };

  /** A public folder holding one public child, created through the real doors. */
  async function folderWithChild() {
    const mintRes = await mintTokenRoute(request('/api/tokens', { method: 'POST', json: {}, headers: { 'x-shared-secret': SECRET } }));
    const { token } = await mintRes.json();
    const folderRes = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token, json: { format: 'folder', title: 'Field Notes', visibility: 'public' } }),
    );
    expect(folderRes.status).toBe(201);
    const folder = (await folderRes.json()) as { id: string; version: number };
    const childRes = await createArtifactRoute(
      request('/api/artifacts', {
        method: 'POST', token,
        json: { title: 'Opening Note', visibility: 'public', parent_id: folder.id, markup: '<div><h1>Opening Note</h1></div>' },
      }),
    );
    expect(childRes.status).toBe(201);
    return { folder, token };
  }

  it('photographs the folder document itself, not the app shell', async () => {
    const shotOf = recording();
    const { folder } = await folderWithChild();
    const res = await exportImage(request(`/a/${folder.id}/export`), params({ id: folder.id }));
    expect(res.status).toBe(200);
    const shot = shotOf();
    // The document's OWN page, chrome stripped, carrying the signed key — the
    // same address a markup document is shot at.
    expect(shot.url).toContain(`/a/${folder.id}/raw`);
    expect(shot.url).toContain('chrome=0');
    expect(shot.url).toContain('key=');
    expect(shot.selector).toBe('body');
  });

  it('and the address it names renders the listing', async () => {
    const shotOf = recording();
    const { folder } = await folderWithChild();
    await exportImage(request(`/a/${folder.id}/export`), params({ id: folder.id }));
    const shot = shotOf();
    // Exactly what the headless browser would fetch — no session, the key
    // alone, and the capture's own settled dataflow.
    const framed = await serveRaw(request(new URL(shot.url).pathname + new URL(shot.url).search), params({ id: folder.id }));
    expect(framed.status).toBe(200);
    const html = await framed.text();
    expect(html).toContain('Opening Note');
    expect(html).toContain('aria-label="Files"');
  });

  it('gives the card the same crop every document gets', async () => {
    const shotOf = recording();
    const { folder } = await folderWithChild();
    const res = await exportImage(request(`/a/${folder.id}/export?mode=card`), params({ id: folder.id }));
    expect(res.status).toBe(200);
    expect(shotOf().capture).toEqual({ card: DEFAULT_SOCIAL_PREVIEW_CROP });
  });
});
