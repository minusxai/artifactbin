/**
 * CHROMIUM, IN THIS PROCESS. The only entry of this package that loads
 * Playwright; import it from a composition root only. One browser, launched
 * on first use, closed after a minute idle; renders are SERIALISED — one page
 * at a time bounds memory, and a failed launch never poisons the next try.
 */
import { chromium, type Browser } from 'playwright';
import sharp from 'sharp';
import type { BrowserService, RenderRequest, RenderResult } from '@artifactbin/contracts';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SETTLE_MS = 1_500;
// The editor can display the overview at ~850 CSS px on a 2x screen. Keeping
// canonical horizontal resolution avoids enlarging a thumbnail while the
// height cap still bounds unusually tall documents.
const PREVIEW_WIDTH = 1_600;
const PREVIEW_MAX_HEIGHT = 4_096;

class NavigationError extends Error {}
class NoSlideError extends Error { constructor(readonly slides: number) { super(`document has ${slides} slides`); } }

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function createBrowser(opts: { idleShutdownMs?: number } = {}): BrowserService & { close(): Promise<void> } {
  const idleMs = opts.idleShutdownMs ?? 60_000;
  let browser: Promise<Browser> | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  let idle: ReturnType<typeof setTimeout> | undefined;

  const get = (): Promise<Browser> => {
    if (!browser) {
      const p = chromium.launch({ headless: true }).catch((e) => { if (browser === p) browser = undefined; throw e; });
      browser = p;
    }
    return browser;
  };
  const close = async () => {
    const b = browser; browser = undefined;
    if (idle) clearTimeout(idle); idle = undefined;
    if (b) await b.then((x) => x.close()).catch(() => {});
  };
  const scheduleIdle = () => { if (idle) clearTimeout(idle); idle = setTimeout(() => void close(), idleMs); idle.unref?.(); };

  async function shoot(req: RenderRequest): Promise<{ mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array }> {
    let b = await get();
    if (!b.isConnected()) { await close(); b = await get(); }
    const timeout = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const requestedCrop = typeof req.capture === 'object' && 'card' in req.capture ? req.capture.card : null;
    // A crop narrower than the output must be RASTERIZED at the corresponding
    // density. Scaling a 637px screenshot to 1600px only enlarges its pixels.
    const cardDensity = requestedCrop
      ? clamp(req.viewport.width / Math.max(1, requestedCrop.width), 1, 4)
      : 1;
    // reducedMotion: the motion kit never arms scroll reveals under it, so a capture always sees the finished page.
    const page = await b.newPage({ viewport: req.viewport, reducedMotion: 'reduce', deviceScaleFactor: cardDensity });
    try {
      const shotOpts = { timeout, ...(req.format === 'jpg' ? { type: 'jpeg' as const, quality: req.quality ?? 85 } : { type: 'png' as const }) };
      const mime = req.format === 'jpg' ? 'image/jpeg' as const : 'image/png' as const;
      if (req.sameOriginOnly) {
        const origin = new URL(req.url).origin;
        await page.route('**/*', (route) => { const t = route.request().url(); return t.startsWith(origin) || t.startsWith('data:') ? route.continue() : route.abort(); });
      }
      await page.goto(req.url, { waitUntil: 'load', timeout }).catch((e) => { throw new NavigationError((e as Error).message); });
      if (req.injectCss) await page.addStyleTag({ content: req.injectCss }).catch(() => {});
      const surface = page.locator(req.selector).first();
      await surface.waitFor({ timeout });
      await page.waitForTimeout(req.settleMs ?? DEFAULT_SETTLE_MS);
      if (typeof req.capture === 'object' && 'slide' in req.capture) {
        const slides = surface.locator('[data-mx-slide]');
        const count = await slides.count();
        if (req.capture.slide > count) throw new NoSlideError(count);
        const one = slides.nth(req.capture.slide - 1);
        await one.scrollIntoViewIfNeeded({ timeout });
        return { mime, bytes: new Uint8Array(await one.screenshot(shotOpts)) };
      }
      if (req.capture === 'full') return { mime, bytes: new Uint8Array(await surface.screenshot(shotOpts)) };
      if (req.capture === 'preview' || typeof req.capture === 'object') {
        const { width: outputWidth, height: outputHeight } = req.viewport;
        const box = (await surface.boundingBox()) ?? { x: 0, y: 0, width: outputWidth, height: outputHeight };
        const crop = requestedCrop;
        const sourceWidth = crop
          ? clamp(crop.width, 1, Math.max(1, box.width))
          : Math.min(Math.max(1, box.width), outputWidth);
        const sourceHeight = crop
          ? sourceWidth * outputHeight / outputWidth
          : Math.max(1, box.height);
        const x = crop ? clamp(crop.x, 0, Math.max(0, box.width - sourceWidth)) : 0;
        const y = crop ? clamp(crop.y, 0, Math.max(0, box.height - sourceHeight)) : 0;
        if (crop) {
          // page.screenshot honors deviceScaleFactor; CDP clip.scale does not
          // increase raster density and produced a visibly enlarged bitmap.
          const initialScrollY = await page.evaluate(() => window.scrollY);
          const documentY = initialScrollY + box.y + y;
          await page.evaluate((top) => window.scrollTo(0, top), documentY);
          const scrollY = await page.evaluate(() => window.scrollY);
          const bytes = await page.screenshot({
            // Keep the high-density intermediate lossless. JPEG is encoded
            // once, after the fractional clip is normalized to exact output.
            type: 'png',
            timeout,
            clip: { x: box.x + x, y: documentY - scrollY, width: sourceWidth, height: sourceHeight },
          });
          // Fractional clip edges round at device pixels. The public contract
          // remains exact even when the chosen width is not a clean divisor.
          const exactPipeline = sharp(bytes).resize(outputWidth, outputHeight, { fit: 'fill' });
          const exact = req.format === 'jpg'
            ? await exactPipeline.jpeg({ quality: req.quality ?? 85 }).toBuffer()
            : await exactPipeline.png().toBuffer();
          return { mime, bytes: new Uint8Array(exact) };
        }
        const client = await page.context().newCDPSession(page);
        try {
          const scale = Math.min(PREVIEW_WIDTH / sourceWidth, PREVIEW_MAX_HEIGHT / sourceHeight);
          const captured = await client.send('Page.captureScreenshot', {
            format: req.format === 'jpg' ? 'jpeg' : 'png',
            ...(req.format === 'jpg' ? { quality: req.quality ?? 85 } : {}),
            fromSurface: true,
            captureBeyondViewport: true,
            clip: {
              x: box.x + x,
              y: box.y + y,
              width: sourceWidth,
              height: sourceHeight,
              scale,
            },
          });
          const bytes = Buffer.from(captured.data, 'base64');
          return { mime, bytes: new Uint8Array(bytes) };
        } finally {
          await client.detach().catch(() => {});
        }
      }
      // card: clip the PAGE to the surface's top stage; grow the viewport by the surface's offset so the clip is full height.
      const { width, height } = req.viewport;
      let box = (await surface.boundingBox()) ?? { x: 0, y: 0, width, height };
      await page.setViewportSize({ width, height: Math.ceil(box.y) + height });
      box = (await surface.boundingBox()) ?? box;
      const bytes = await page.screenshot({ clip: { x: box.x, y: box.y, width: Math.min(box.width, width) || width, height }, ...shotOpts });
      return { mime, bytes: new Uint8Array(bytes) };
    } finally {
      await page.close().catch(() => {});
      scheduleIdle();
    }
  }

  return {
    render(req): Promise<RenderResult> {
      const run = chain.then(() => shoot(req)).then(
        (r): RenderResult => ({ ok: true, ...r }),
        (e): RenderResult => {
          if (e instanceof NoSlideError) return { ok: false, reason: 'no_slide', slides: e.slides };
          if (e instanceof NavigationError) return { ok: false, reason: 'navigation', detail: e.message };
          if (!browser) return { ok: false, reason: 'unavailable', detail: (e as Error).message };
          return { ok: false, reason: 'failed', detail: (e as Error).message };
        },
      );
      chain = run;
      return run;
    },
    close,
  };
}
