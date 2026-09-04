/**
 * THE BROWSER CONTRACT over both transports: Playwright in this process, and
 * the same behind `serveBrowser` through `browserClient`. Real Chromium, a
 * real page: the verdicts are the contract as much as the bytes are.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserService, RenderRequest } from '@artifactbin/contracts';
import { BROWSER_ROUTES, browserClient, serveBrowser } from '@artifactbin/browser';
import { createBrowser } from '@artifactbin/browser/local';
import sharp from 'sharp';
import { withHttpServer, type RunningServer } from '../../app/__tests__/net';

const PAGE = `<html><body style="margin:0"><main style="width:600px">
<img src="http://127.0.0.1:1/cross-origin.png" alt="">
<div data-mx-slide style="height:100px;background:#c33">one</div>
<div data-mx-slide style="height:100px;background:#3c3">two</div>
<div data-mx-slide style="height:100px;background:#33c">three</div></main></body></html>`;
let pages: RunningServer;
let url: string;

const local = createBrowser();
const server = serveBrowser(local);
const listening = server.listen(0);
const remote = browserClient(listening.url, { deadlineMs: 20_000 });
beforeAll(async () => {
  pages = await withHttpServer((_q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end(PAGE); });
  url = `${pages.base}/a/x`;
});
afterAll(async () => { await local.close?.(); await server.close(); await pages.close(); });

const base = (): RenderRequest => ({ url, format: 'png', viewport: { width: 1200, height: 630 }, selector: 'main', capture: 'full', sameOriginOnly: true, settleMs: 50, timeoutMs: 10_000 });
const pngSize = (b: Uint8Array) => { const v = new DataView(b.buffer, b.byteOffset); return { width: v.getUint32(16), height: v.getUint32(20) }; };

describe.each<[string, BrowserService]>([['in-process', local], ['over HTTP', remote]])('%s', (_name, svc) => {
  it('shoots the selected element as png, with the cross-origin request aborted', async () => {
    const r = await svc.render(base());
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.mime).toBe('image/png');
    expect(pngSize(r.bytes)).toEqual({ width: 600, height: 300 });
  });
  it('shoots one slide as jpg', async () => {
    const r = await svc.render({ ...base(), format: 'jpg', capture: { slide: 2 } });
    expect(r.ok && r.mime).toBe('image/jpeg');
  });
  it('answers no_slide with the count', async () => {
    expect(await svc.render({ ...base(), capture: { slide: 9 } })).toEqual({ ok: false, reason: 'no_slide', slides: 3 });
  });
  /**
   * `card` is a CLIP of the page, not an element shot: the stage is the
   * viewport's HEIGHT (a card is a fixed ratio — the whole point of the mode)
   * and the SURFACE's width, capped at the viewport. A served document's body
   * spans the viewport, so in the product the two coincide; here `main` is
   * 600px and the clip follows it, which is the rule that stopped a `<Video>`
   * player's box from cropping every og card to its width.
   */
  it('clips the card stage to the surface width, at the viewport height', async () => {
    const r = await svc.render({ ...base(), capture: 'card', viewport: { width: 1600, height: 840 } });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(pngSize(r.bytes)).toEqual({ width: 600, height: 840 });
  });
  it('clips the card to the VIEWPORT when the surface is wider', async () => {
    const r = await svc.render({ ...base(), capture: 'card', selector: 'body', viewport: { width: 300, height: 200 } });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(pngSize(r.bytes)).toEqual({ width: 300, height: 200 });
  });
  it('scales a positioned locked-ratio card crop to the requested output without relayout', async () => {
    const r = await svc.render({
      ...base(),
      capture: { card: { x: 200, y: 100, width: 400 } },
      viewport: { width: 1200, height: 630 },
    });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(pngSize(r.bytes)).toEqual({ width: 1200, height: 630 });
    const { data: pixels, info } = await sharp(Buffer.from(r.bytes)).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const start = (y * info.width + x) * info.channels;
      return [...pixels.subarray(start, start + 3)];
    };
    expect(at(600, 100)).toEqual([51, 204, 51]); // source y≈133: green band
    expect(at(600, 400)).toEqual([51, 51, 204]); // source y≈233: blue band
  });
  it('produces a reduced-density overview using the same layout', async () => {
    const r = await svc.render({ ...base(), capture: 'preview' });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(pngSize(r.bytes)).toEqual({ width: 400, height: 200 });
  });
  it('names a page that cannot be reached', async () => {
    const r = await svc.render({ ...base(), url: 'http://127.0.0.1:1/nope', timeoutMs: 2000 });
    expect(!r.ok && r.reason).toBe('navigation');
  });
  it('names a selector that never appears as failed', async () => {
    const r = await svc.render({ ...base(), selector: '#never', timeoutMs: 1000 });
    expect(!r.ok && r.reason).toBe('failed');
  });
});

describe('browserClient', () => {
  it('answers unavailable for a dead service within the deadline', async () => {
    const dead = browserClient('http://127.0.0.1:1', { deadlineMs: 500 });
    expect(await dead.render(base())).toEqual({ ok: false, reason: 'unavailable', detail: expect.any(String) });
  });
});

describe('serveBrowser health', () => {
  it('GET /health answers 200 {ok:true}, the docker HEALTHCHECK and the compose depends_on condition', async () => {
    const res = await fetch(`${listening.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
  it('a GET anywhere else stays 405 — render is POST-only, health is the one GET', async () => {
    const res = await fetch(`${listening.url}${BROWSER_ROUTES.render}`);
    expect(res.status).toBe(405);
  });
});

describe('serveBrowser service authentication', () => {
  it('keeps health public but refuses render without the configured service secret', async () => {
    const protectedServer = serveBrowser(local, { serviceSecret: 'browser-test-secret' });
    const protectedUrl = protectedServer.listen(0).url;
    try {
      expect((await fetch(`${protectedUrl}/health`)).status).toBe(200);
      expect((await fetch(`${protectedUrl}${BROWSER_ROUTES.render}`, { method: 'POST', body: '{}' })).status).toBe(401);
      const client = browserClient(protectedUrl, { serviceSecret: 'browser-test-secret', deadlineMs: 20_000 });
      expect((await client.render(base())).ok).toBe(true);
    } finally { await protectedServer.close(); }
  });
});
