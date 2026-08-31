/**
 * CHROMIUM, IN THIS PROCESS. The only entry of this package that loads
 * Playwright; import it from a composition root only. One browser, launched
 * on first use, closed after a minute idle; renders are SERIALISED — one page
 * at a time bounds memory, and a failed launch never poisons the next try.
 */
import { chromium, type Browser } from 'playwright';
import type { BrowserService, RenderRequest, RenderResult } from '@artifactbin/contracts';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SETTLE_MS = 1_500;

class NavigationError extends Error {}
class NoSlideError extends Error { constructor(readonly slides: number) { super(`document has ${slides} slides`); } }

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
    // reducedMotion: the motion kit never arms scroll reveals under it, so a capture always sees the finished page.
    const page = await b.newPage({ viewport: req.viewport, reducedMotion: 'reduce' });
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
      if (typeof req.capture === 'object') {
        const slides = surface.locator('[data-mx-slide]');
        const count = await slides.count();
        if (req.capture.slide > count) throw new NoSlideError(count);
        const one = slides.nth(req.capture.slide - 1);
        await one.scrollIntoViewIfNeeded({ timeout });
        return { mime, bytes: new Uint8Array(await one.screenshot(shotOpts)) };
      }
      if (req.capture === 'full') return { mime, bytes: new Uint8Array(await surface.screenshot(shotOpts)) };
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
