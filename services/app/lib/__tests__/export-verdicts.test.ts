/**
 * WHAT A FAILED RENDER MEANS, AS AN HTTP ANSWER.
 *
 * The browser answers a VERDICT — it never throws — and this is the only place
 * those verdicts become the product's own vocabulary. `__tests__/export.test.ts`
 * cannot see any of it: it runs with no HTTP server to photograph, so every
 * render there is allowed to be 200, 500 OR 503 and the mapping could be
 * rewired underneath it in silence. This pins it by REGISTERING a browser that
 * answers each verdict on demand.
 *
 * The split it protects is the one an agent acts on: 503 says "this deployment
 * has no browser, the HTML link still works", 500 says "it tried and failed",
 * and 404 says "that slide does not exist — here is how many there are".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrowserService, RenderRequest, RenderResult } from '@artifactbin/contracts';
import { exportImageResponse, resetExportRenderer } from '@/lib/export';
import { setServices } from '@/lib/services';

/** A browser that answers whatever this test says, and counts the asks. */
function scripted(...answers: RenderResult[]): BrowserService & { seen: RenderRequest[] } {
  const seen: RenderRequest[] = [];
  return {
    seen,
    async render(request) {
      seen.push(request);
      return answers[Math.min(seen.length - 1, answers.length - 1)];
    },
  };
}

const PNG: RenderResult = { ok: true, mime: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) };

let n = 0;
/** A fresh version every time, so neither cache layer can answer for the browser. */
// `source` rides along because the export door reads the document's own
// `<Value>` declarations to canonicalize a link's selection (lib/export).
const row = () => ({ id: 'exprt1', version: ++n + 1000, format: 'markup' as const, source: '<p>hi</p>' });

beforeEach(async () => { await resetExportRenderer(); });
afterEach(async () => { await resetExportRenderer(); setServices({ browser: undefined }); });

const shoot = (browser: BrowserService, query: Record<string, string> = {}) => {
  setServices({ browser });
  return exportImageResponse(row(), query, 'http://localhost:3000');
};

describe('the browser verdict becomes the HTTP answer', () => {
  it('bytes → 200, with the image type and nosniff', async () => {
    const res = await shoot(scripted(PNG));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG.ok ? PNG.bytes : new Uint8Array());
  });

  /** No browser in this image. An agent must hear "not here", never "it broke". */
  it("unavailable → 503 render_unavailable", async () => {
    const res = await shoot(scripted({ ok: false, reason: 'unavailable' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'render_unavailable' });
  });

  /**
   * The page could not be reached. It is a FAILURE, not an absent browser:
   * saying 503 here would tell an agent the deployment cannot export at all.
   */
  it('navigation → 500 render_failed, never 503', async () => {
    const res = await shoot(scripted({ ok: false, reason: 'navigation', detail: 'ERR_CONNECTION_REFUSED' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'render_failed' });
  });

  it('failed → 500 render_failed', async () => {
    const res = await shoot(scripted({ ok: false, reason: 'failed', detail: 'selector never appeared' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'render_failed' });
  });

  /** A missing slide is a missing RESOURCE, and the count is what fixes it in one step. */
  it('no_slide → 404 slide_not_found, carrying the real count', async () => {
    const res = await shoot(scripted({ ok: false, reason: 'no_slide', slides: 3 }), { slide: '9' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'slide_not_found', slides: 3 });
  });
});

describe('the one retry', () => {
  /**
   * A shot taken immediately after a write can race the fresh version: the
   * page loads but what the exporter waits for is not there yet. That is the
   * ONLY failure worth a second attempt.
   */
  it("re-renders once after a fast 'failed', and serves the second answer", async () => {
    const browser = scripted({ ok: false, reason: 'failed' }, PNG);
    const res = await shoot(browser);
    expect(browser.seen).toHaveLength(2);
    expect(res.status).toBe(200);
  });

  it('does NOT retry an absent browser — retrying it only doubles the wait', async () => {
    const browser = scripted({ ok: false, reason: 'unavailable' });
    await shoot(browser);
    expect(browser.seen).toHaveLength(1);
  });

  it('does NOT retry an unreachable page: it answers no faster the second time', async () => {
    const browser = scripted({ ok: false, reason: 'navigation' });
    await shoot(browser);
    expect(browser.seen).toHaveLength(1);
  });

  it('does NOT retry a missing slide — the count is already the answer', async () => {
    const browser = scripted({ ok: false, reason: 'no_slide', slides: 2 });
    await shoot(browser, { slide: '5' });
    expect(browser.seen).toHaveLength(1);
  });
});

describe('what the app asks the browser for', () => {
  it('shoots a markup document from its own page, by a key it mints per attempt', async () => {
    const browser = scripted({ ok: false, reason: 'failed' }, PNG);
    await shoot(browser);
    for (const request of browser.seen) {
      expect(request.url).toMatch(/\/a\/exprt1\/raw\?chrome=0&key=/);
      expect(request.selector).toBe('body');
      expect(request.sameOriginOnly).toBe(true);
    }
    // A FRESH key per attempt: minted at call time, because a key that expired
    // in the queue produced a 200 PNG of a 404 page.
    expect(browser.seen[0].url).not.toBe(browser.seen[1].url);
  });

  it('names the slide as a capture mode, not a separate verb', async () => {
    const browser = scripted(PNG);
    await shoot(browser, { slide: '2' });
    expect(browser.seen[0].capture).toEqual({ slide: 2 });
  });

  it('asks for the card stage at the card viewport', async () => {
    const browser = scripted(PNG);
    await shoot(browser, { mode: 'card' });
    expect(browser.seen[0].capture).toBe('card');
    expect(browser.seen[0].viewport).toEqual({ width: 1600, height: 840 });
  });
});
