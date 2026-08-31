/**
 * THE BROWSER SEAM, pinned (cleanup/testmig-1, milestone 1 of the test redesign). Route-level export tests must not
 * launch Chromium: the app reaches its BrowserService through lib/services (`setServices`/`services()`), so a route
 * test injects utils' `fakeBrowser` and asserts the REQUEST the route builds and the VERDICT it maps — every field
 * of RenderRequest the route decides, every RenderResult branch the route answers. Real bytes stay with the browser
 * contract suite and the gates (`gate-full-kit`, `gate-export-slice`).
 *
 * Seeded by the orchestrator. Blue → red → blue: break the forwarding of `capture`/`format` in lib/export and this
 * file must go red; restore and it is blue again.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from '@artifactbin/utils';
import type { RenderRequest, RenderResult } from '@artifactbin/contracts';
import { GET as exportImage } from '@/app/a/[id]/export/route';
import { createArtifact } from '@/lib/artifacts';


import { resetExportRenderer } from '@/lib/export';
import { setServices } from '@/lib/services';
import { mintToken } from '@/lib/tokens';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
type Fake = ReturnType<typeof fakeBrowser> & { calls: unknown[] };
let fake: Fake;
const browser = (result?: RenderResult) => { fake = fakeBrowser(result) as Fake; setServices({ browser: fake }); return fake; };
const lastRequest = () => fake.calls.at(-1) as RenderRequest;

beforeEach(async () => {
  await resetExportRenderer();
});
afterEach(() => setServices({}));

async function doc(): Promise<string> {
  const t = await mintToken('t');
  const row = await createArtifact(t.id, null, { format: 'markup', content: '', source: '<div>hi</div>', meta: {}, title: 'hi', description: null });
  return row.id;
}

describe('the export route through the browser seam', () => {
  it('a full-page png: the route asks for the document URL, body, png, full capture, and returns the bytes', async () => {
    browser();
    const id = await doc();
    const res = await exportImage(new Request(`${BASE}/a/${id}/export`), params(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    expect(new Uint8Array(await res.arrayBuffer()).slice(0, 4)).toEqual(PNG.slice(0, 4));
    const req = lastRequest();
    expect(req.url).toContain(`/a/${id}`);
    expect(req.format).toBe('png');
    expect(req.capture).toBe('full');
    expect(req.selector).toBe('body');
    expect(req.viewport.width).toBeGreaterThan(0);
    expect(req.viewport.height).toBeGreaterThan(0);
  });

  it('a card capture forwards capture=card; jpg forwards format=jpg and answers image/jpeg', async () => {
    browser({ ok: true, mime: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff]) });
    const id = await doc();
    const res = await exportImage(new Request(`${BASE}/a/${id}/export?mode=card&format=jpg`), params(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/jpeg');
    expect(lastRequest().capture).toBe('card');
    expect(lastRequest().format).toBe('jpg');
  });

  it('a slide capture forwards { slide: n }', async () => {
    browser();
    const id = await doc();
    await exportImage(new Request(`${BASE}/a/${id}/export?slide=2`), params(id));
    expect(lastRequest().capture).toEqual({ slide: 2 });
  });

  it('an unavailable browser is 503 render_unavailable — the verdict, not a crash', async () => {
    browser({ ok: false, reason: 'unavailable' });
    const id = await doc();
    const res = await exportImage(new Request(`${BASE}/a/${id}/export`), params(id));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'render_unavailable' });
  });

  it('a missing slide is a client error naming how many slides exist', async () => {
    browser({ ok: false, reason: 'no_slide', slides: 2 });
    const id = await doc();
    const res = await exportImage(new Request(`${BASE}/a/${id}/export?slide=9`), params(id));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(await res.json())).toContain('2');
  });

  it('a failed navigation is a server-side error, and the fake was asked exactly once', async () => {
    browser({ ok: false, reason: 'navigation', detail: 'boom' });
    const id = await doc();
    const res = await exportImage(new Request(`${BASE}/a/${id}/export`), params(id));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(fake.calls).toHaveLength(1);
  });
});
